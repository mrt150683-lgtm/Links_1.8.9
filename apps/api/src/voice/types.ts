/**
 * Voice Addon v1 — Runtime Types
 *
 * State machine definition, event constants, and adapter interfaces
 * for the voice pipeline: Mic → VAD → STT → Chat → TTS → Playback.
 */

// ── State Machine ─────────────────────────────────────────────────────────

export enum VoiceRuntimeState {
  Idle                    = 'idle',
  Listening               = 'listening',
  DetectingSpeech         = 'detecting_speech',
  TranscribingPartial     = 'transcribing_partial',
  WaitingForSilenceCommit = 'waiting_for_silence_commit',
  SubmittingToLLM         = 'submitting_to_llm',
  AwaitingResponse        = 'awaiting_response',
  Speaking                = 'speaking',
  Interrupted             = 'interrupted',
  Errored                 = 'errored',
}

export const VALID_TRANSITIONS: Partial<Record<VoiceRuntimeState, VoiceRuntimeState[]>> = {
  [VoiceRuntimeState.Idle]: [
    VoiceRuntimeState.Listening,
    VoiceRuntimeState.Errored,
  ],
  [VoiceRuntimeState.Listening]: [
    VoiceRuntimeState.DetectingSpeech,
    VoiceRuntimeState.Idle,
    VoiceRuntimeState.Errored,
  ],
  [VoiceRuntimeState.DetectingSpeech]: [
    VoiceRuntimeState.TranscribingPartial,
    VoiceRuntimeState.WaitingForSilenceCommit,
    VoiceRuntimeState.Listening,
    VoiceRuntimeState.Interrupted,
    VoiceRuntimeState.Errored,
  ],
  [VoiceRuntimeState.TranscribingPartial]: [
    VoiceRuntimeState.WaitingForSilenceCommit,
    VoiceRuntimeState.Interrupted,
    VoiceRuntimeState.Errored,
  ],
  [VoiceRuntimeState.WaitingForSilenceCommit]: [
    VoiceRuntimeState.SubmittingToLLM,
    VoiceRuntimeState.Listening,
    VoiceRuntimeState.Interrupted,
    VoiceRuntimeState.Errored,
  ],
  [VoiceRuntimeState.SubmittingToLLM]: [
    VoiceRuntimeState.AwaitingResponse,
    VoiceRuntimeState.Interrupted,
    VoiceRuntimeState.Errored,
  ],
  [VoiceRuntimeState.AwaitingResponse]: [
    VoiceRuntimeState.Speaking,
    VoiceRuntimeState.Interrupted,
    VoiceRuntimeState.Errored,
  ],
  [VoiceRuntimeState.Speaking]: [
    VoiceRuntimeState.Listening,
    VoiceRuntimeState.Interrupted,
    VoiceRuntimeState.Idle,
    VoiceRuntimeState.Errored,
  ],
  [VoiceRuntimeState.Interrupted]: [
    VoiceRuntimeState.Listening,
    VoiceRuntimeState.Idle,
    VoiceRuntimeState.Errored,
  ],
  [VoiceRuntimeState.Errored]: [
    VoiceRuntimeState.Idle,
  ],
};

// ── Event Constants ───────────────────────────────────────────────────────

export const VOICE_EVENTS = {
  SESSION_STARTED:         'SESSION_STARTED',
  SESSION_STOPPED:         'SESSION_STOPPED',
  VAD_SPEECH_START:        'VAD_SPEECH_START',
  VAD_SPEECH_STOP:         'VAD_SPEECH_STOP',
  SILENCE_TIMEOUT_STARTED: 'SILENCE_TIMEOUT_STARTED',
  SILENCE_TIMEOUT_COMMITTED: 'SILENCE_TIMEOUT_COMMITTED',
  TRANSCRIPT_PARTIAL:      'TRANSCRIPT_PARTIAL',
  TRANSCRIPT_FINAL:        'TRANSCRIPT_FINAL',
  LLM_REQUEST_STARTED:     'LLM_REQUEST_STARTED',
  LLM_REQUEST_COMPLETED:   'LLM_REQUEST_COMPLETED',
  TTS_SYNTHESIS_STARTED:   'TTS_SYNTHESIS_STARTED',
  TTS_SYNTHESIS_COMPLETED: 'TTS_SYNTHESIS_COMPLETED',
  PLAYBACK_STARTED:        'PLAYBACK_STARTED',
  PLAYBACK_STOPPED:        'PLAYBACK_STOPPED',
  INTERRUPTION_DETECTED:   'INTERRUPTION_DETECTED',
  ERROR:                   'ERROR',
} as const;

export type VoiceEventName = (typeof VOICE_EVENTS)[keyof typeof VOICE_EVENTS];

// ── Adapter Result Types ──────────────────────────────────────────────────

export interface STTResult {
  text: string;
  is_final: boolean;
  confidence?: number;
  latency_ms?: number;
}

export interface TTSResult {
  audio_buffer?: Buffer;
  latency_ms: number;
  voice_id: string;
}

export interface ChatAdapterRequest {
  transcript: string;
  session_id: string;
  pot_id?: string;
  thread_id?: string;
}

export interface ChatAdapterResponse {
  text: string;
  latency_ms: number;
}
