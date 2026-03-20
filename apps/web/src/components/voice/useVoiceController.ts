/**
 * useVoiceController — Phases B–F (Streaming TTS)
 *
 * Orchestrates the full voice turn loop:
 *   1. Start voice session (POST /api/voice/session/start)
 *   2. Mic capture via useVoiceCapture (VAD + MediaRecorder)
 *   3. On audio ready → POST /api/voice/process (returns SSE stream)
 *   4. SSE events: transcript → audio_chunk(s) → done
 *   5. Audio chunks queued via Web Audio API for gapless playback
 *   6. Barge-in: new speech during playback stops all queued audio
 */

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { useVoiceCapture } from './useVoiceCapture.js';

// ── WAV conversion ─────────────────────────────────────────────────────────
// Whisper.cpp requires 16kHz mono 16-bit PCM WAV.

function encodeWavMono16k(channelData: Float32Array): ArrayBuffer {
  const sampleCount = channelData.length;
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);       // PCM
  view.setUint16(22, 1, true);       // mono
  view.setUint32(24, 16000, true);   // 16 kHz
  view.setUint32(28, 32000, true);   // byte rate
  view.setUint16(32, 2, true);       // block align
  view.setUint16(34, 16, true);      // 16-bit
  writeStr(36, 'data');
  view.setUint32(40, sampleCount * 2, true);

  let offset = 44;
  for (let i = 0; i < sampleCount; i++) {
    const s = Math.max(-1, Math.min(1, channelData[i]!));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }
  return buffer;
}

async function convertToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const tempCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await tempCtx.decodeAudioData(arrayBuffer);
  } finally {
    tempCtx.close().catch(() => {});
  }

  const targetSampleRate = 16000;
  const targetLength = Math.ceil(decoded.duration * targetSampleRate);
  const offlineCtx = new OfflineAudioContext(1, Math.max(targetLength, 1), targetSampleRate);
  const src = offlineCtx.createBufferSource();
  src.buffer = decoded;
  src.connect(offlineCtx.destination);
  src.start(0);

  const resampled = await offlineCtx.startRendering();
  const wavBuffer = encodeWavMono16k(resampled.getChannelData(0));
  return new Blob([wavBuffer], { type: 'audio/wav' });
}

// ── Web Audio queue ────────────────────────────────────────────────────────
// Schedules WAV buffers back-to-back for gapless playback.

function createAudioQueue() {
  let ctx: AudioContext | null = null;
  let nextStartTime = 0;
  const activeSources = new Set<AudioBufferSourceNode>();

  function getCtx(): AudioContext {
    if (!ctx || ctx.state === 'closed') {
      ctx = new AudioContext();
      nextStartTime = 0;
    }
    return ctx;
  }

  async function enqueue(base64: string): Promise<void> {
    const audioCtx = getCtx();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    // slice() creates a detached copy so decodeAudioData doesn't transfer ownership
    const decoded = await audioCtx.decodeAudioData(bytes.buffer.slice(0));

    const source = audioCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(audioCtx.destination);

    // Schedule 20ms after previous chunk ends (or immediately if first)
    const startAt = Math.max(nextStartTime, audioCtx.currentTime + 0.02);
    nextStartTime = startAt + decoded.duration;

    activeSources.add(source);
    source.onended = () => activeSources.delete(source);
    source.start(startAt);
  }

  function stopAll(): void {
    for (const s of activeSources) {
      try { s.stop(); } catch { /* already stopped */ }
    }
    activeSources.clear();
    nextStartTime = 0;
  }

  async function waitUntilDone(): Promise<void> {
    if (!ctx) return;
    const remaining = nextStartTime - ctx.currentTime;
    if (remaining > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, remaining * 1000 + 250));
    }
  }

  function isPlaying(): boolean {
    return activeSources.size > 0;
  }

  return { enqueue, stopAll, waitUntilDone, isPlaying };
}

// ── Types ──────────────────────────────────────────────────────────────────

export type VoicePhase =
  | 'idle'
  | 'listening'
  | 'detected'
  | 'processing'
  | 'speaking'
  | 'error';

export interface VoiceControllerState {
  phase: VoicePhase;
  isActive: boolean;
  transcript: string;
  response: string;
  error: string | null;
  sessionId: string | null;
}

export interface UseVoiceControllerOptions {
  potId?: string;
  silenceTimeoutMs?: number;
  vadThreshold?: number;
  onTurnComplete?: (transcript: string, response: string) => void;
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useVoiceController(opts: UseVoiceControllerOptions = {}) {
  const [state, setState] = useState<VoiceControllerState>({
    phase: 'idle',
    isActive: false,
    transcript: '',
    response: '',
    error: null,
    sessionId: null,
  });

  const sessionIdRef = useRef<string | null>(null);
  const isPlayingRef = useRef(false);
  const processingRef = useRef(false);
  const onTurnCompleteRef = useRef(opts.onTurnComplete);
  useLayoutEffect(() => { onTurnCompleteRef.current = opts.onTurnComplete; });

  // Single Web Audio queue, lives for the lifetime of the hook
  const audioQueueRef = useRef(createAudioQueue());

  const setPhase = useCallback((phase: VoicePhase) => {
    setState((s) => ({ ...s, phase }));
  }, []);

  // ── Barge-in ──────────────────────────────────────────────────────────────
  const handleSpeechStart = useCallback(() => {
    if (isPlayingRef.current) {
      audioQueueRef.current.stopAll();
      window.speechSynthesis?.cancel();
      isPlayingRef.current = false;

      if (sessionIdRef.current) {
        fetch('/api/voice/session/interruption', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionIdRef.current }),
        }).catch(() => {});
      }

      setPhase('listening');
    }
  }, [setPhase]);

  // ── Main pipeline: audio → SSE stream → Web Audio ─────────────────────────
  const handleAudioReady = useCallback(
    async (blob: Blob, _mimeType: string) => {
      if (!sessionIdRef.current || processingRef.current) return;
      processingRef.current = true;
      setPhase('processing');
      setState((s) => ({ ...s, transcript: '', response: '' }));

      try {
        // Convert browser audio → 16kHz mono WAV for Whisper
        let wavBlob: Blob;
        try {
          wavBlob = await convertToWav(blob);
        } catch {
          wavBlob = blob;
        }

        const form = new FormData();
        form.append('session_id', sessionIdRef.current);
        form.append('audio', wavBlob, 'audio.wav');
        if (opts.potId) form.append('pot_id', opts.potId);

        const res = await fetch('/api/voice/process', { method: 'POST', body: form });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`voice/process HTTP ${res.status}: ${errText.slice(0, 200)}`);
        }

        // ── Read SSE stream ────────────────────────────────────────────────
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let sseBuf = '';
        let currentEvent = '';
        let hadAudio = false;
        let textChunks: string[] = [];
        let finalTranscript = '';
        let finalText = '';

        const processLine = async (line: string) => {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
            return;
          }
          if (!line.startsWith('data: ')) return;

          let data: Record<string, unknown>;
          try { data = JSON.parse(line.slice(6)); } catch { return; }

          if (currentEvent === 'transcript') {
            finalTranscript = String(data.text ?? '');
            if (!finalTranscript) {
              // Silence — go straight back to listening
              setPhase('listening');
              processingRef.current = false;
              return;
            }
            setState((s) => ({ ...s, transcript: finalTranscript }));

          } else if (currentEvent === 'audio_chunk') {
            if (!hadAudio) {
              setPhase('speaking');
              isPlayingRef.current = true;
            }
            hadAudio = true;
            const base64 = String(data.audio_base64 ?? '');
            if (base64) await audioQueueRef.current.enqueue(base64);
            setState((s) => ({ ...s, response: finalText + String(data.text ?? '') }));

          } else if (currentEvent === 'text_chunk') {
            textChunks.push(String(data.text ?? ''));

          } else if (currentEvent === 'done') {
            finalText = String(data.full_text ?? '');
            setState((s) => ({ ...s, response: finalText }));

          } else if (currentEvent === 'error') {
            throw new Error(String(data.message ?? 'Stream error'));
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuf += decoder.decode(value, { stream: true });

          const lines = sseBuf.split('\n');
          sseBuf = lines.pop() ?? '';
          for (const line of lines) {
            await processLine(line);
          }
        }

        // ── Wait for audio to finish or fallback to Web Speech ─────────────
        if (hadAudio) {
          await audioQueueRef.current.waitUntilDone();
        } else if (textChunks.length > 0) {
          setPhase('speaking');
          isPlayingRef.current = true;
          const combined = textChunks.join(' ');
          await new Promise<void>((resolve) => {
            const utt = new SpeechSynthesisUtterance(combined);
            utt.onend = () => resolve();
            utt.onerror = () => resolve();
            window.speechSynthesis.speak(utt);
          });
        }

        isPlayingRef.current = false;

        // Inject full turn into chat timeline once playback ends
        if (finalTranscript) {
          onTurnCompleteRef.current?.(finalTranscript, finalText);
        }

      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Voice processing failed';
        console.error('[voice] Processing error:', msg);
        setState((s) => ({ ...s, error: msg }));
        setPhase('error');
        setTimeout(() => {
          if (sessionIdRef.current) {
            setState((s) => ({ ...s, error: null }));
            setPhase('listening');
          }
        }, 3000);
      } finally {
        processingRef.current = false;
        isPlayingRef.current = false;
        if (sessionIdRef.current && state.phase !== 'error') {
          setPhase('listening');
        }
      }
    },
    [opts.potId, setPhase, state.phase],
  );

  // ── Voice capture hook ────────────────────────────────────────────────────
  const capture = useVoiceCapture({
    silenceTimeoutMs: opts.silenceTimeoutMs,
    vadThreshold: opts.vadThreshold,
    onAudioReady: handleAudioReady,
    onSpeechStart: handleSpeechStart,
    onPhaseChange: (p) => {
      setState((s) => {
        if (s.phase === 'processing' || s.phase === 'speaking') return s;
        return { ...s, phase: p as VoicePhase };
      });
    },
  });

  // ── Start ─────────────────────────────────────────────────────────────────
  const startVoice = useCallback(async () => {
    try {
      setState((s) => ({ ...s, error: null, isActive: true, phase: 'listening' }));

      const res = await fetch('/api/voice/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pot_id: opts.potId }),
      });

      if (!res.ok) throw new Error(`session/start HTTP ${res.status}`);
      const data = await res.json() as { session: { id: string } };
      sessionIdRef.current = data.session.id;
      setState((s) => ({ ...s, sessionId: data.session.id }));

      await capture.start();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start voice';
      setState({ phase: 'error', isActive: false, transcript: '', response: '', error: msg, sessionId: null });
      sessionIdRef.current = null;
    }
  }, [opts.potId, capture]);

  // ── Stop ──────────────────────────────────────────────────────────────────
  const stopVoice = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;

    audioQueueRef.current.stopAll();
    window.speechSynthesis?.cancel();
    isPlayingRef.current = false;

    capture.stop();
    setState({ phase: 'idle', isActive: false, transcript: '', response: '', error: null, sessionId: null });

    if (sessionId) {
      fetch('/api/voice/session/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      }).catch(() => {});
    }
  }, [capture]);

  // ── Toggle ────────────────────────────────────────────────────────────────
  const toggleVoice = useCallback(() => {
    if (state.isActive) return stopVoice();
    return startVoice();
  }, [state.isActive, startVoice, stopVoice]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (sessionIdRef.current) {
        capture.stop();
        const sid = sessionIdRef.current;
        sessionIdRef.current = null;
        fetch('/api/voice/session/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sid }),
        }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, startVoice, stopVoice, toggleVoice };
}
