/**
 * OpenRouter STT Adapter — Phase C
 *
 * Transcribes audio chunks using OpenRouter's Whisper endpoint.
 * Implements STTAdapter interface from sttAdapter.ts.
 */

import { transcribeAudio } from '@links/ai';
import { createLogger } from '@links/logging';
import type { STTAdapter } from './sttAdapter.js';
import type { STTResult } from '../types.js';

const logger = createLogger({ name: 'voice:stt:openrouter' });

export class OpenRouterSTTAdapter implements STTAdapter {
  private readonly model: string;

  constructor(model = 'openai/whisper-1') {
    this.model = model;
  }

  /** Partial transcription not supported via REST Whisper — return null */
  async transcribeChunk(_chunk: Buffer, _mimeType?: string): Promise<STTResult | null> {
    return null;
  }

  async transcribeFinal(audio: Buffer, mimeType = 'audio/webm'): Promise<STTResult> {
    const start = Date.now();
    logger.info({ bytes: audio.byteLength, mimeType, model: this.model }, 'STT transcribe start');

    const text = await transcribeAudio(audio, mimeType, this.model);
    const latency_ms = Date.now() - start;

    logger.info({ text_len: text.length, latency_ms }, 'STT transcribe complete');
    return { text, is_final: true, latency_ms };
  }

  reset(): void {
    // Stateless — nothing to reset
  }
}
