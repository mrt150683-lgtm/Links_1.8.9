/**
 * Phase 6: OpenRouter Client Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchModels, createChatCompletion, OpenRouterError, TimeoutError } from '../src/client.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Mock config
vi.mock('@links/config', () => ({
  getConfig: () => ({
    OPENROUTER_API_KEY: 'sk-or-v1-test-key-placeholder',
  }),
}));

// Mock logger
vi.mock('@links/logging', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('OpenRouter Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('fetchModels', () => {
    it('should fetch models successfully', async () => {
      const mockResponse = {
        data: [
          {
            id: 'anthropic/claude-3-5-sonnet',
            name: 'Claude 3.5 Sonnet',
            context_length: 200000,
            pricing: {
              prompt: '0.000003',
              completion: '0.000015',
            },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await fetchModels();

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/models',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-test-key-12345',
          }),
        })
      );
    });

    it('should throw OpenRouterError on 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => JSON.stringify({
          error: {
            message: 'Invalid API key',
            type: 'authentication_error',
          },
        }),
        headers: new Map(),
      });

      await expect(fetchModels()).rejects.toThrow(OpenRouterError);
      await expect(fetchModels()).rejects.toThrow('Invalid API key');
    });

    it('should retry on 429 with backoff', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          text: async () => JSON.stringify({
            error: { message: 'Rate limit exceeded' },
          }),
          headers: new Map([['Retry-After', '2']]),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        });

      const promise = fetchModels();

      // Fast-forward timers to simulate retry delay
      await vi.advanceTimersByTimeAsync(2000);

      const result = await promise;

      expect(result).toEqual({ data: [] });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on 500 server error', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Server error',
          headers: new Map(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        });

      const promise = fetchModels();

      // Fast-forward timers
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result).toEqual({ data: [] });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw ValidationError on invalid schema', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ invalid: 'schema' }),
      });

      await expect(fetchModels()).rejects.toThrow('Invalid models response schema');
    });
  });

  describe('createChatCompletion', () => {
    it('should create chat completion successfully', async () => {
      const mockResponse = {
        id: 'chatcmpl-123',
        model: 'anthropic/claude-3-5-sonnet',
        created: 1234567890,
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello!',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await createChatCompletion({
        model: 'anthropic/claude-3-5-sonnet',
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should handle timeout and retry', async () => {
      // First call: timeout (abort)
      mockFetch.mockImplementationOnce(() => {
        return new Promise((_, reject) => {
          setTimeout(() => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          }, 0);
        });
      });

      // Second call: success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'test',
          model: 'test',
          created: 123,
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Success' },
              finish_reason: 'stop',
            },
          ],
        }),
      });

      const promise = createChatCompletion(
        {
          model: 'test',
          messages: [{ role: 'user', content: 'test' }],
        },
        1000
      );

      // Advance timers for timeout and retry
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result.choices[0].message.content).toBe('Success');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
