/**
 * STT Adapter — Speech-to-Text
 *
 * Phase A: Placeholder. Real implementation in Phase C (OpenRouter Whisper).
 */

import { createLogger } from '@links/logging';
import type { STTResult } from '../types.js';

const logger = createLogger({ name: 'voice:stt' });

export interface STTAdapter {
  transcribeChunk(chunk: Buffer, mimeType?: string): Promise<STTResult | null>;
  transcribeFinal(audio: Buffer, mimeType?: string): Promise<STTResult>;
  reset(): void;
}

export class PlaceholderSTTAdapter implements STTAdapter {
  async transcribeChunk(_chunk: Buffer, _mimeType?: string): Promise<STTResult | null> {
    logger.warn({ msg: 'STT.transcribeChunk: NOT_IMPLEMENTED (Phase C)' });
    return null;
  }

  async transcribeFinal(_audio: Buffer, _mimeType?: string): Promise<STTResult> {
    logger.warn({ msg: 'STT.transcribeFinal: NOT_IMPLEMENTED (Phase C)' });
    return { text: '', is_final: true };
  }

  reset(): void {
    logger.warn({ msg: 'STT.reset: NOT_IMPLEMENTED (Phase C)' });
  }
}
