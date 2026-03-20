/**
 * TTS Adapter — Text-to-Speech (Piper)
 *
 * Phase A: Placeholder. Real implementation in Phase E (Piper binary).
 */

import { createLogger } from '@links/logging';
import type { TTSResult } from '../types.js';

const logger = createLogger({ name: 'voice:tts' });

export interface TTSAdapter {
  configure(voiceId: string, voicePath: string): void;
  synthesize(text: string): Promise<TTSResult>;
  isReady(): boolean;
}

export class PlaceholderTTSAdapter implements TTSAdapter {
  configure(_voiceId: string, _voicePath: string): void {
    logger.warn({ msg: 'TTS.configure: NOT_IMPLEMENTED (Phase E)' });
  }

  async synthesize(_text: string): Promise<TTSResult> {
    logger.warn({ msg: 'TTS.synthesize: NOT_IMPLEMENTED (Phase E)' });
    return { latency_ms: 0, voice_id: 'none' };
  }

  isReady(): boolean {
    return false;
  }
}
