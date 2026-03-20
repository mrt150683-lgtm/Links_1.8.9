/**
 * Phase 6: OpenRouter API Client
 *
 * Safe HTTP client wrapper with:
 * - Timeout handling
 * - Exponential backoff with jitter
 * - Retry on transient errors
 * - Schema validation
 * - Structured logging
 */

import { getConfig } from '@links/config';
import { createLogger } from '@links/logging';
import {
  ModelsListResponseSchema,
  ChatCompletionResponseSchema,
  OpenRouterErrorSchema,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ModelsListResponse,
} from './schemas.js';

const logger = createLogger({ name: 'ai-client' });

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1 second
const MAX_DELAY_MS = 30000; // 30 seconds

/**
 * Retryable HTTP status codes (transient errors)
 */
const RETRYABLE_STATUS_CODES = new Set([
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoffDelay(attempt: number): number {
  const exponential = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_DELAY_MS);
  const jitter = exponential * 0.1 * (Math.random() * 2 - 1); // ±10%
  return Math.max(0, exponential + jitter);
}

/**
 * Error classes
 */
export class OpenRouterError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorType?: string,
    public errorCode?: string
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string = 'Request timeout') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Make HTTP request with timeout and retry
 */
async function makeRequest<T>(
  url: string,
  options: RequestInit,
  timeout: number,
  attempt: number = 1
): Promise<T> {
  const config = getConfig();
  const apiKey = config.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new OpenRouterError('OPENROUTER_API_KEY not configured');
  }

  // Add authorization header
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/links-app/links',
    'X-Title': 'Links Research Backend',
    ...options.headers,
  };

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    logger.info({
      url,
      method: options.method || 'GET',
      attempt,
      timeout,
    });

    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle error responses
    if (!response.ok) {
      const errorBody = await response.text();
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      let errorType: string | undefined;
      let errorCode: string | undefined;

      // Try to parse OpenRouter error format
      try {
        const parsed = JSON.parse(errorBody);
        const validated = OpenRouterErrorSchema.safeParse(parsed);
        if (validated.success) {
          errorMessage = validated.data.error.message;
          errorType = validated.data.error.type;
          errorCode = validated.data.error.code;
        }
      } catch {
        // Use raw error body if not parseable
        errorMessage = errorBody || errorMessage;
      }

      logger.warn({
        status: response.status,
        errorMessage,
        errorType,
        errorCode,
        rawBody: errorBody.slice(0, 500), // First 500 chars for diagnosis
        attempt,
      }, 'OpenRouter API error');

      // Retry on transient errors
      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRIES) {
        const delay = calculateBackoffDelay(attempt);

        // Check for Retry-After header (rate limiting)
        const retryAfter = response.headers.get('Retry-After');
        const retryDelay = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;

        logger.info({
          attempt,
          delay: retryDelay,
          retryAfter,
        }, 'Retrying after backoff');

        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return makeRequest(url, options, timeout, attempt + 1);
      }

      throw new OpenRouterError(errorMessage, response.status, errorType, errorCode);
    }

    // Parse response
    const json = await response.json();
    return json as T;
  } catch (error) {
    clearTimeout(timeoutId);

    // Handle abort/timeout
    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn({ url, timeout, attempt }, 'Request timeout');

      if (attempt < MAX_RETRIES) {
        const delay = calculateBackoffDelay(attempt);
        logger.info({ attempt, delay }, 'Retrying after timeout');
        await new Promise(resolve => setTimeout(resolve, delay));
        return makeRequest(url, options, timeout, attempt + 1);
      }

      throw new TimeoutError(`Request timeout after ${attempt} attempts`);
    }

    // Rethrow OpenRouter errors
    if (error instanceof OpenRouterError) {
      throw error;
    }

    // Network errors
    logger.error({ error, url, attempt }, 'Network error');

    if (attempt < MAX_RETRIES) {
      const delay = calculateBackoffDelay(attempt);
      logger.info({ attempt, delay }, 'Retrying after network error');
      await new Promise(resolve => setTimeout(resolve, delay));
      return makeRequest(url, options, timeout, attempt + 1);
    }

    throw new OpenRouterError(`Network error: ${(error as Error).message}`);
  }
}

/**
 * Fetch available models from OpenRouter
 */
export async function fetchModels(): Promise<ModelsListResponse> {
  const url = `${OPENROUTER_BASE_URL}/models`;

  const raw = await makeRequest<unknown>(
    url,
    { method: 'GET' },
    DEFAULT_TIMEOUT_MS
  );

  // Validate response schema
  const validated = ModelsListResponseSchema.safeParse(raw);
  if (!validated.success) {
    logger.error({
      issues: validated.error.issues.slice(0, 5).map(i => ({
        path: i.path.join('.'),
        code: i.code,
        message: i.message,
      })),
      issue_count: validated.error.issues.length,
    }, 'Models response validation failed');
    throw new ValidationError('Invalid models response schema');
  }

  logger.info({
    count: validated.data.data.length,
  }, 'Fetched models successfully');

  return validated.data;
}

/**
 * Transcribe audio via OpenRouter Whisper
 * Sends multipart/form-data; does NOT use the JSON makeRequest helper.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string = 'audio/webm',
  model: string = 'openai/whisper-1',
  timeout: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const config = getConfig();
  const apiKey = config.OPENROUTER_API_KEY;
  if (!apiKey) throw new OpenRouterError('OPENROUTER_API_KEY not configured');

  const url = `${OPENROUTER_BASE_URL}/audio/transcriptions`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // Determine file extension from mimeType (e.g. 'audio/webm' → 'webm')
    const ext = mimeType.split('/')[1]?.split(';')[0] ?? 'webm';
    const formData = new FormData();
    // Convert Node.js Buffer to ArrayBuffer for cross-env Blob compatibility
    const arrayBuf = audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength) as ArrayBuffer;
    const blob = new Blob([arrayBuf], { type: mimeType });
    formData.append('file', blob, `audio.${ext}`);
    formData.append('model', model);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/links-app/links',
        'X-Title': 'Links Voice Transcription',
        // Do NOT set Content-Type — fetch sets it with the multipart boundary
      },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      logger.error({ status: response.status, body: errorBody.slice(0, 500), model }, 'Transcription HTTP error');
      throw new OpenRouterError(
        `Transcription failed HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
        response.status,
      );
    }

    const rawText = await response.text();
    logger.info({ rawResponseLength: rawText.length, rawPreview: rawText.slice(0, 300), model }, 'Transcription raw response');

    let result: Record<string, unknown>;
    try {
      result = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      logger.error({ rawText: rawText.slice(0, 500) }, 'Transcription response is not valid JSON');
      throw new OpenRouterError('Transcription response is not valid JSON');
    }

    // OpenRouter Whisper returns { text: string } — log the full structure for debugging
    const text = typeof result.text === 'string' ? result.text : '';
    if (!text) {
      logger.warn({ responseKeys: Object.keys(result), result: JSON.stringify(result).slice(0, 500) }, 'Transcription returned empty text — check response format');
    } else {
      logger.info({ model, textLength: text.length }, 'Audio transcription successful');
    }
    return text;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof OpenRouterError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new TimeoutError('Transcription request timeout');
    }
    throw new OpenRouterError(`Transcription network error: ${(err as Error).message}`);
  }
}

/**
 * Make chat completion request
 */
export async function createChatCompletion(
  request: ChatCompletionRequest,
  timeout: number = DEFAULT_TIMEOUT_MS
): Promise<ChatCompletionResponse> {
  const url = `${OPENROUTER_BASE_URL}/chat/completions`;

  const raw = await makeRequest<unknown>(
    url,
    {
      method: 'POST',
      body: JSON.stringify(request),
    },
    timeout
  );

  // Validate response schema
  const validated = ChatCompletionResponseSchema.safeParse(raw);
  if (!validated.success) {
    logger.error({
      error: validated.error,
      raw,
    }, 'Chat completion response validation failed');
    throw new ValidationError('Invalid chat completion response schema');
  }

  // Detect provider errors (e.g. 502 provider_unavailable) where content is null
  const firstChoice = validated.data.choices[0];
  if (firstChoice && firstChoice.message.content === null) {
    const choiceError = (firstChoice as any).error;
    const errMsg = choiceError?.message ?? 'Provider returned null content';
    const errCode = choiceError?.code ?? 'unknown';
    logger.error({ model: validated.data.model, errCode, errMsg }, 'Provider error in chat completion');
    throw new OpenRouterError(`Provider error (${errCode}): ${errMsg}`);
  }

  logger.info({
    model: validated.data.model,
    usage: validated.data.usage,
  }, 'Chat completion successful');

  return validated.data;
}

/**
 * Stream a chat completion from OpenRouter.
 * Yields token strings as they arrive via SSE.
 * No retries — streaming connections are not safely retryable mid-stream.
 */
export async function* createChatCompletionStream(
  request: ChatCompletionRequest,
  timeout: number = DEFAULT_TIMEOUT_MS,
): AsyncGenerator<string, void, unknown> {
  const config = getConfig();
  const apiKey = config.OPENROUTER_API_KEY;
  if (!apiKey) throw new OpenRouterError('OPENROUTER_API_KEY not configured');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  let response: Response;
  try {
    response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/links-app/links',
        'X-Title': 'Links Voice',
      },
      body: JSON.stringify({ ...request, stream: true }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new OpenRouterError(
      `Chat stream HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
      response.status,
    );
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      // SSE lines are separated by \n; events separated by \n\n
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) yield delta;
        } catch { /* skip malformed chunks */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
