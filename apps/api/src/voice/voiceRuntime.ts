/**
 * Voice Runtime
 *
 * Per-session state machine. Instantiated on POST /voice/session/start,
 * registered in a module-level Map, removed on stop.
 *
 * Phase A: state transitions are validated but all adapter calls are
 * placeholder no-ops. Real logic wired in Phases B–F.
 */

import { createLogger } from '@links/logging';
import { insertVoiceSessionEvent } from '@links/storage';
import { VoiceRuntimeState, VALID_TRANSITIONS } from './types.js';
import type { VADAdapter } from './adapters/vadAdapter.js';
import type { STTAdapter } from './adapters/sttAdapter.js';
import type { TTSAdapter } from './adapters/ttsAdapter.js';
import type { PlaybackController } from './adapters/playbackController.js';
import type { ChatAdapter } from './adapters/chatAdapter.js';

const logger = createLogger({ name: 'voice:runtime' });

// ── Runtime class ─────────────────────────────────────────────────────────

export interface VoiceRuntimeOptions {
  sessionId: string;
  vad: VADAdapter;
  stt: STTAdapter;
  tts: TTSAdapter;
  playback: PlaybackController;
  chat: ChatAdapter;
}

export class VoiceRuntime {
  private state: VoiceRuntimeState = VoiceRuntimeState.Idle;
  readonly sessionId: string;

  readonly vad: VADAdapter;
  readonly stt: STTAdapter;
  readonly tts: TTSAdapter;
  readonly playback: PlaybackController;
  readonly chat: ChatAdapter;

  constructor(opts: VoiceRuntimeOptions) {
    this.sessionId = opts.sessionId;
    this.vad = opts.vad;
    this.stt = opts.stt;
    this.tts = opts.tts;
    this.playback = opts.playback;
    this.chat = opts.chat;
  }

  getState(): VoiceRuntimeState {
    return this.state;
  }

  isActive(): boolean {
    return (
      this.state !== VoiceRuntimeState.Errored &&
      this.state !== VoiceRuntimeState.Idle
    );
  }

  async transition(
    next: VoiceRuntimeState,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    const allowed = VALID_TRANSITIONS[this.state] ?? [];
    if (!allowed.includes(next)) {
      logger.warn({
        msg: 'voice:runtime invalid transition',
        session_id: this.sessionId,
        from: this.state,
        to: next,
      });
      return;
    }

    const prev = this.state;
    this.state = next;

    logger.info({
      msg: 'voice:runtime transition',
      session_id: this.sessionId,
      from: prev,
      to: next,
    });

    await this.logEvent(`STATE_${next.toUpperCase()}`, payload).catch(() => {
      // non-fatal
    });
  }

  async logEvent(
    eventType: string,
    payload?: Record<string, unknown>,
    latencyMs?: number,
  ): Promise<void> {
    try {
      await insertVoiceSessionEvent(this.sessionId, eventType, payload, latencyMs);
    } catch (err) {
      // log-only, never throw
      logger.error({ msg: 'voice:runtime event log failed', session_id: this.sessionId, err });
    }
  }
}

// ── Session registry ──────────────────────────────────────────────────────

const runtimes = new Map<string, VoiceRuntime>();

export function registerRuntime(runtime: VoiceRuntime): void {
  runtimes.set(runtime.sessionId, runtime);
}

export function getRuntime(sessionId: string): VoiceRuntime | undefined {
  return runtimes.get(sessionId);
}

export function removeRuntime(sessionId: string): void {
  runtimes.delete(sessionId);
}

export function getActiveRuntimeCount(): number {
  return runtimes.size;
}
