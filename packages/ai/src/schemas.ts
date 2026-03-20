/**
 * Phase 6: OpenRouter API Response Schemas
 *
 * Zod schemas for validating OpenRouter API responses
 */

import { z } from 'zod';

/**
 * Model pricing schema
 */
export const ModelPricingSchema = z.object({
  prompt: z.string().optional(),
  completion: z.string().optional(),
  request: z.string().optional(),
  image: z.string().optional(),
}).passthrough();

/**
 * Model metadata schema (from OpenRouter /models endpoint)
 * Uses passthrough() to allow new fields from the API without breaking validation
 */
export const ModelMetadataSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  created: z.number().optional(),
  description: z.string().optional(),
  context_length: z.number(),
  architecture: z
    .object({
      tokenizer: z.string().optional(),
      instruct_type: z.string().nullable().optional(),
      modality: z.string().optional(),
      input_modalities: z.array(z.string()).optional(),
      output_modalities: z.array(z.string()).optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
  pricing: ModelPricingSchema.nullable().optional(),
  top_provider: z
    .object({
      context_length: z.number().nullable().optional(),
      max_completion_tokens: z.number().nullable().optional(),
      is_moderated: z.boolean().nullable().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
  per_request_limits: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
}).passthrough();

/**
 * OpenRouter models list response schema
 */
export const ModelsListResponseSchema = z.object({
  data: z.array(ModelMetadataSchema),
}).passthrough();

/**
 * Multimodal content part schemas (for vision/image messages)
 */
export const TextContentPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export const ImageUrlContentPartSchema = z.object({
  type: z.literal('image_url'),
  image_url: z.object({
    url: z.string(),
    detail: z.enum(['auto', 'low', 'high']).optional(),
  }),
});

export const InputAudioContentPartSchema = z.object({
  type: z.literal('input_audio'),
  input_audio: z.object({
    data: z.string(), // base64-encoded audio
    format: z.string(), // e.g. "mp3", "wav", "ogg"
  }),
});

export const ContentPartSchema = z.discriminatedUnion('type', [
  TextContentPartSchema,
  ImageUrlContentPartSchema,
  InputAudioContentPartSchema,
]);

/**
 * Chat completion message schema (request)
 * Supports both simple string content and multimodal content parts array
 */
export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.union([z.string(), z.array(ContentPartSchema)]),
});

/**
 * Chat completion response message schema
 * Response messages always have string content
 */
export const ChatResponseMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().nullable(),
});

/**
 * Chat completion request schema
 */
export const ChatCompletionRequestSchema = z.object({
  model: z.string(),
  messages: z.array(ChatMessageSchema),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  response_format: z
    .object({
      type: z.enum(['text', 'json_object']),
    })
    .optional(),
});

/**
 * Chat completion choice schema
 */
export const ChatCompletionChoiceSchema = z.object({
  message: ChatResponseMessageSchema,
  finish_reason: z.string().nullable(),
  index: z.number(),
  error: z.object({
    code: z.number().optional(),
    message: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }).optional(),
});

/**
 * Chat completion usage schema
 */
export const ChatCompletionUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
});

/**
 * Chat completion response schema
 */
export const ChatCompletionResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  created: z.number(),
  object: z.literal('chat.completion'),
  choices: z.array(ChatCompletionChoiceSchema),
  usage: ChatCompletionUsageSchema.optional(),
});

/**
 * OpenRouter error response schema
 */
export const OpenRouterErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    code: z.string().optional(),
  }),
});

/**
 * Type exports
 */
export type ModelMetadata = z.infer<typeof ModelMetadataSchema>;
export type ModelsListResponse = z.infer<typeof ModelsListResponseSchema>;
export type TextContentPart = z.infer<typeof TextContentPartSchema>;
export type ImageUrlContentPart = z.infer<typeof ImageUrlContentPartSchema>;
export type InputAudioContentPart = z.infer<typeof InputAudioContentPartSchema>;
export type ContentPart = z.infer<typeof ContentPartSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;
export type OpenRouterError = z.infer<typeof OpenRouterErrorSchema>;
