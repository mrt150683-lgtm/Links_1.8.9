/**
 * Chat Adapter — Routes voice transcript to chat backend
 *
 * Phase A: Placeholder. Real implementation in Phase D
 * (routes to POST /pots/:potId/chat/send or main chat).
 */

import { createLogger } from '@links/logging';
import type { ChatAdapterRequest, ChatAdapterResponse } from '../types.js';

const logger = createLogger({ name: 'voice:chat' });

export interface ChatAdapter {
  submit(request: ChatAdapterRequest): Promise<ChatAdapterResponse>;
}

export class PlaceholderChatAdapter implements ChatAdapter {
  async submit(_request: ChatAdapterRequest): Promise<ChatAdapterResponse> {
    logger.warn({ msg: 'Chat.submit: NOT_IMPLEMENTED (Phase D)' });
    return { text: '', latency_ms: 0 };
  }
}
