export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterRequestOpts {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
  apiKey: string;
  _fetch?: typeof fetch;
  _sleep?: (ms: number) => Promise<void>;
}

export interface OpenRouterChoice {
  message: { role: string; content: string };
  finish_reason: string;
}

export interface OpenRouterResponse {
  id: string;
  choices: OpenRouterChoice[];
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: string
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

export class OpenRouterRateLimitError extends OpenRouterError {
  constructor(
    public readonly retryAfterMs: number,
    body: string
  ) {
    super(`OpenRouter rate limited; retry after ${retryAfterMs}ms`, 429, body);
    this.name = 'OpenRouterRateLimitError';
  }
}

export class OpenRouterInvalidOutputError extends Error {
  constructor(
    message: string,
    public readonly raw: string
  ) {
    super(message);
    this.name = 'OpenRouterInvalidOutputError';
  }
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_RETRIES = 3;

/**
 * Call the OpenRouter chat completions API with retry logic.
 * Retries on network errors, rate limits, and invalid JSON output.
 * Throws on non-retriable HTTP errors (4xx except 429).
 */
export async function callOpenRouter(opts: OpenRouterRequestOpts): Promise<OpenRouterResponse> {
  const fetcher = opts._fetch ?? fetch;
  const sleep =
    opts._sleep ??
    ((ms: number): Promise<void> => new Promise<void>((res) => setTimeout(res, ms)));

  let lastError: Error = new Error('No attempts made');

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffMs = 1000 * Math.pow(2, attempt - 1);
      await sleep(backoffMs);
    }

    let resp: Response;
    try {
      resp = await fetcher(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({
          model: opts.model,
          messages: opts.messages,
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.max_tokens ?? 1500,
          response_format: { type: 'json_object' },
        }),
      });
    } catch (networkErr) {
      lastError = networkErr instanceof Error ? networkErr : new Error(String(networkErr));
      continue;
    }

    const bodyText = await resp.text();

    if (resp.status === 429) {
      const retryAfterSec = parseInt(resp.headers.get('Retry-After') ?? '5', 10);
      lastError = new OpenRouterRateLimitError(retryAfterSec * 1000, bodyText);
      continue;
    }

    if (!resp.ok) {
      // Non-retriable HTTP error
      throw new OpenRouterError(`OpenRouter HTTP ${resp.status}`, resp.status, bodyText);
    }

    let parsed: OpenRouterResponse;
    try {
      parsed = JSON.parse(bodyText) as OpenRouterResponse;
    } catch {
      lastError = new OpenRouterInvalidOutputError(
        'OpenRouter response body is not valid JSON',
        bodyText
      );
      continue;
    }

    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      lastError = new OpenRouterInvalidOutputError(
        'OpenRouter response missing choices[0].message.content',
        bodyText
      );
      continue;
    }

    // Validate the content field is itself valid JSON (required for structured outputs)
    try {
      JSON.parse(content);
    } catch {
      lastError = new OpenRouterInvalidOutputError(
        'OpenRouter content field is not valid JSON',
        content
      );
      continue;
    }

    return parsed;
  }

  throw lastError;
}

/**
 * Call OpenRouter and return the parsed JSON object from choices[0].message.content.
 */
export async function callOpenRouterJson(opts: OpenRouterRequestOpts): Promise<unknown> {
  const response = await callOpenRouter(opts);
  return JSON.parse(response.choices[0].message.content) as unknown;
}
