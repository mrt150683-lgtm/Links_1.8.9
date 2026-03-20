/**
 * VAD Adapter — Voice Activity Detection
 *
 * Phase A: Placeholder. Real implementation in Phase B.
 */

import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'voice:vad' });

export interface VADConfig {
  threshold?: number;
  silence_timeout_ms?: number;
}

export interface VADAdapter {
  configure(config: VADConfig): void;
  onSpeechStart(cb: () => void): void;
  onSpeechStop(cb: () => void): void;
  onSilenceTimeout(cb: () => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

export class PlaceholderVADAdapter implements VADAdapter {
  configure(_config: VADConfig): void {
    logger.warn({ msg: 'VAD.configure: NOT_IMPLEMENTED (Phase B)' });
  }

  onSpeechStart(_cb: () => void): void {
    logger.warn({ msg: 'VAD.onSpeechStart: NOT_IMPLEMENTED (Phase B)' });
  }

  onSpeechStop(_cb: () => void): void {
    logger.warn({ msg: 'VAD.onSpeechStop: NOT_IMPLEMENTED (Phase B)' });
  }

  onSilenceTimeout(_cb: () => void): void {
    logger.warn({ msg: 'VAD.onSilenceTimeout: NOT_IMPLEMENTED (Phase B)' });
  }

  async start(): Promise<void> {
    logger.warn({ msg: 'VAD.start: NOT_IMPLEMENTED (Phase B)' });
  }

  async stop(): Promise<void> {
    logger.warn({ msg: 'VAD.stop: NOT_IMPLEMENTED (Phase B)' });
  }

  isRunning(): boolean {
    return false;
  }
}
