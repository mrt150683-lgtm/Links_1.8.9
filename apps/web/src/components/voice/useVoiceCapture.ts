/**
 * useVoiceCapture — Phase B
 *
 * Handles microphone capture with energy-based VAD.
 * Uses Web Audio API AnalyserNode for speech detection and
 * MediaRecorder to collect audio chunks during speech.
 *
 * Flow:
 *   start() → getUserMedia → AnalyserNode polls RMS energy every 50ms
 *   → energy above vadThreshold → startRecording()
 *   → silence (energy below threshold) for silenceTimeoutMs → stopRecording()
 *   → MediaRecorder ondataavailable → onAudioReady(blob, mimeType)
 *
 * Callbacks:
 *   onAudioReady(blob, mimeType) — fired when a turn is complete
 *   onSpeechStart()              — fired on every speech onset (for barge-in)
 *   onPhaseChange(phase)         — phase: 'idle'|'listening'|'detected'|'processing'
 */

import { useRef, useCallback } from 'react';

export type CapturePhase = 'idle' | 'listening' | 'detected' | 'processing';

// RMS energy threshold defaults — speech is usually 0.02+, silence < 0.01
const DEFAULT_VAD_THRESHOLD = 0.015;
const DEFAULT_SILENCE_TIMEOUT_MS = 1100;
const VAD_POLL_INTERVAL_MS = 50;
const MIN_BLOB_BYTES = 1000; // Ignore clips shorter than 1 KB

export interface UseVoiceCaptureOptions {
  silenceTimeoutMs?: number;
  vadThreshold?: number;
  onAudioReady: (blob: Blob, mimeType: string) => void;
  onSpeechStart?: () => void;
  onPhaseChange?: (phase: CapturePhase) => void;
}

export function useVoiceCapture(opts: UseVoiceCaptureOptions) {
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSpeakingRef = useRef(false);
  const activeRef = useRef(false);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const silenceTimeoutMs = opts.silenceTimeoutMs ?? DEFAULT_SILENCE_TIMEOUT_MS;
  const vadThreshold = opts.vadThreshold ?? DEFAULT_VAD_THRESHOLD;

  const emit = useCallback(
    (phase: CapturePhase) => opts.onPhaseChange?.(phase),
    [opts],
  );

  const stopRecorder = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      emit('detected');
      recorderRef.current.stop();
    }
  }, [emit]);

  const startRecorder = useCallback(
    (stream: MediaStream) => {
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/ogg;codecs=opus';

      const recorder = new MediaRecorder(stream, { mimeType });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        if (!activeRef.current) return;
        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size >= MIN_BLOB_BYTES) {
          opts.onAudioReady(blob, mimeType.split(';')[0]!);
        }
        isSpeakingRef.current = false;
        if (activeRef.current) emit('listening');
      };

      recorder.start(100); // collect chunks every 100 ms
    },
    [opts, emit],
  );

  const stop = useCallback(() => {
    activeRef.current = false;
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    pollTimerRef.current = null;
    silenceTimerRef.current = null;

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close().catch(() => {});
    streamRef.current = null;
    ctxRef.current = null;
    analyserRef.current = null;
    recorderRef.current = null;
    isSpeakingRef.current = false;
    emit('idle');
  }, [emit]);

  const start = useCallback(async () => {
    if (activeRef.current) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    streamRef.current = stream;
    activeRef.current = true;

    // Set up Web Audio API for VAD
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);
    analyserRef.current = analyser;
    dataArrayRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize));

    emit('listening');

    // VAD poll
    pollTimerRef.current = setInterval(() => {
      if (!activeRef.current || !analyserRef.current || !dataArrayRef.current) return;

      analyserRef.current.getByteTimeDomainData(dataArrayRef.current);

      // Compute RMS energy
      let sum = 0;
      for (let i = 0; i < dataArrayRef.current.length; i++) {
        const norm = (dataArrayRef.current[i]! - 128) / 128;
        sum += norm * norm;
      }
      const rms = Math.sqrt(sum / dataArrayRef.current.length);
      const speech = rms > vadThreshold;

      if (speech) {
        // Cancel any pending silence commit
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
        if (!isSpeakingRef.current) {
          isSpeakingRef.current = true;
          opts.onSpeechStart?.();
          if (streamRef.current) startRecorder(streamRef.current);
        }
      } else if (isSpeakingRef.current && !silenceTimerRef.current) {
        // Silence after speech — start commit timer
        silenceTimerRef.current = setTimeout(() => {
          silenceTimerRef.current = null;
          stopRecorder();
        }, silenceTimeoutMs);
      }
    }, VAD_POLL_INTERVAL_MS);
  }, [opts, vadThreshold, silenceTimeoutMs, startRecorder, stopRecorder, emit]);

  return { start, stop };
}
