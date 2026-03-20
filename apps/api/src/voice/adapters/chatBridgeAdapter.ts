/**
 * Chat Bridge Adapter — Phase D
 *
 * Routes a finalized voice transcript into the Links LLM pipeline
 * and returns the assistant's text response.
 *
 * Maintains per-session conversation history so the model remembers
 * the full voice conversation. History is capped at 10 turns (20 messages)
 * to stay within model context limits.
 */

import { createChatCompletion, createChatCompletionStream } from '@links/ai';
import { getAIPreferences } from '@links/storage';
import { createLogger } from '@links/logging';
import type { ChatAdapter } from './chatAdapter.js';
import type { ChatAdapterRequest, ChatAdapterResponse } from '../types.js';

const logger = createLogger({ name: 'voice:chat-bridge' });

const VOICE_SYSTEM_PROMPT = [
  "You are Links' voice assistant. Respond in a natural, conversational spoken tone.",
  'Keep responses concise — 1 to 3 sentences unless the user explicitly asks for detail.',
  'Do not use markdown formatting (no bullet points, headers, or bold). Speak plainly.',
  'If you do not know something, say so briefly and directly.',
].join('\n');

const MAX_HISTORY_TURNS = 10; // keep last 10 user+assistant pairs

interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Per-session conversation history — lives in memory for the duration of the API process.
// Keyed by session_id, cleaned up on session stop (not implemented here — memory is small).
const sessionHistory = new Map<string, HistoryMessage[]>();

function getHistory(sessionId: string): HistoryMessage[] {
  if (!sessionId) return [];
  return sessionHistory.get(sessionId) ?? [];
}

function appendHistory(sessionId: string, userText: string, assistantText: string): void {
  if (!sessionId || !assistantText) return;
  const history = sessionHistory.get(sessionId) ?? [];
  history.push({ role: 'user', content: userText });
  history.push({ role: 'assistant', content: assistantText });

  // Trim to last MAX_HISTORY_TURNS pairs
  const maxMessages = MAX_HISTORY_TURNS * 2;
  if (history.length > maxMessages) {
    history.splice(0, history.length - maxMessages);
  }

  sessionHistory.set(sessionId, history);
}

export function clearSessionHistory(sessionId: string): void {
  sessionHistory.delete(sessionId);
}

export class ChatBridgeAdapter implements ChatAdapter {
  async submit(request: ChatAdapterRequest): Promise<ChatAdapterResponse> {
    const start = Date.now();

    const aiPrefs = await getAIPreferences();
    const modelId =
      aiPrefs.task_models?.chat ?? aiPrefs.default_model ?? 'x-ai/grok-4.1-fast';

    const history = getHistory(request.session_id);

    logger.info(
      { model: modelId, transcript_len: request.transcript.length, session_id: request.session_id, history_turns: history.length / 2 },
      'chat bridge: submitting transcript',
    );

    const response = await createChatCompletion(
      {
        model: modelId,
        messages: [
          { role: 'system', content: VOICE_SYSTEM_PROMPT },
          ...history,
          { role: 'user', content: request.transcript },
        ],
        temperature: 0.5,
        max_tokens: 300,
      },
      30000,
    );

    const text = response.choices[0]?.message?.content ?? '';
    const latency_ms = Date.now() - start;

    appendHistory(request.session_id, request.transcript, text);
    logger.info({ text_len: text.length, latency_ms }, 'chat bridge: response received');
    return { text, latency_ms };
  }

  async *streamSubmit(request: ChatAdapterRequest): AsyncGenerator<string, void, unknown> {
    const aiPrefs = await getAIPreferences();
    const modelId =
      aiPrefs.task_models?.chat ?? aiPrefs.default_model ?? 'x-ai/grok-4.1-fast';

    const history = getHistory(request.session_id);

    logger.info(
      { model: modelId, transcript_len: request.transcript.length, session_id: request.session_id, history_turns: history.length / 2 },
      'chat bridge: streaming transcript',
    );

    let fullResponse = '';
    try {
      for await (const token of createChatCompletionStream(
        {
          model: modelId,
          messages: [
            { role: 'system', content: VOICE_SYSTEM_PROMPT },
            ...history,
            { role: 'user', content: request.transcript },
          ],
          temperature: 0.5,
          max_tokens: 300,
        },
        30000,
      )) {
        fullResponse += token;
        yield token;
      }
    } finally {
      // Record this turn once streaming completes (or errors — save what we got)
      appendHistory(request.session_id, request.transcript, fullResponse);
      logger.info({ session_id: request.session_id, response_len: fullResponse.length }, 'chat bridge: history updated');
    }
  }
}
