import { z } from 'zod';

// ── Request schemas ─────────────────────────────────────────────────
export const ChatSendRequestSchema = z.object({
  thread_id: z.string().optional(),
  content: z.string().min(1).max(50000),
  active_context_entry_ids: z.array(z.string()).optional().default([]),
  model_id: z.string().optional(),
  personality_prompt: z.string().optional(),
});

export type ChatSendRequest = z.infer<typeof ChatSendRequestSchema>;

// ── Response schemas ────────────────────────────────────────────────
export const ChatCitationSchema = z.object({
  entryId: z.string(),
  confidence: z.number().min(0).max(1),
  snippet: z.string().optional(),
});

export const ChatMessageResponseSchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  citations: z.array(ChatCitationSchema).optional(),
  timestamp: z.string(),
  token_usage: z.object({
    prompt_tokens: z.number().int(),
    completion_tokens: z.number().int(),
    total_tokens: z.number().int(),
  }).optional(),
});

export const ChatThreadResponseSchema = z.object({
  id: z.string(),
  pot_id: z.string(),
  title: z.string().nullable(),
  model_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  messages: z.array(ChatMessageResponseSchema),
  message_count: z.number().int(),
});

export type ChatCitation = z.infer<typeof ChatCitationSchema>;
export type ChatMessageResponse = z.infer<typeof ChatMessageResponseSchema>;
export type ChatThreadResponse = z.infer<typeof ChatThreadResponseSchema>;
