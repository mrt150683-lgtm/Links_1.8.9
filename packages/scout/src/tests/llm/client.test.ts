import { describe, it, expect } from 'vitest';
import {
  callOpenRouterJson,
  OpenRouterError,
  OpenRouterInvalidOutputError,
} from '../../llm/client.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../fixtures/openrouter');
const validFixture = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, 'valid_analysis_response.json'), 'utf-8')
) as object;

const noopSleep = (): Promise<void> => Promise.resolve();

function makeValidFetch(): typeof fetch {
  return ((_url: string | URL | Request): Promise<Response> =>
    Promise.resolve({
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify(validFixture)),
    } as unknown as Response)) as typeof fetch;
}

function makeMalformedContentFetch(): typeof fetch {
  return ((_url: string | URL | Request): Promise<Response> =>
    Promise.resolve({
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id: 'gen-bad',
            choices: [{ message: { role: 'assistant', content: 'this is not json at all!!!' }, finish_reason: 'stop' }],
            model: 'test',
          })
        ),
    } as unknown as Response)) as typeof fetch;
}

function makeHttpErrorFetch(status: number): typeof fetch {
  return ((_url: string | URL | Request): Promise<Response> =>
    Promise.resolve({
      status,
      ok: false,
      headers: { get: () => null },
      text: () => Promise.resolve(`HTTP ${status} error`),
    } as unknown as Response)) as typeof fetch;
}

describe('callOpenRouterJson', () => {
  it('returns parsed JSON content on successful response', async () => {
    const result = await callOpenRouterJson({
      model: 'test-model',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'analyze this' }],
      _fetch: makeValidFetch(),
      _sleep: noopSleep,
    });
    expect(result).toBeTruthy();
    expect(typeof result).toBe('object');
  });

  it('throws OpenRouterInvalidOutputError after retries for malformed content', async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = ((_url: string | URL | Request): Promise<Response> => {
      callCount++;
      return Promise.resolve({
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: () =>
          Promise.resolve(
            JSON.stringify({
              id: 'gen-bad',
              choices: [{ message: { role: 'assistant', content: 'NOT JSON!!!' }, finish_reason: 'stop' }],
              model: 'test',
            })
          ),
      } as unknown as Response);
    }) as typeof fetch;

    await expect(
      callOpenRouterJson({
        model: 'test-model',
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'analyze this' }],
        _fetch: mockFetch,
        _sleep: noopSleep,
      })
    ).rejects.toBeInstanceOf(OpenRouterInvalidOutputError);

    // Should have retried MAX_RETRIES (3) times
    expect(callCount).toBe(3);
  });

  it('throws OpenRouterError on non-retriable 4xx', async () => {
    await expect(
      callOpenRouterJson({
        model: 'test-model',
        apiKey: 'bad-key',
        messages: [{ role: 'user', content: 'analyze this' }],
        _fetch: makeHttpErrorFetch(401),
        _sleep: noopSleep,
      })
    ).rejects.toBeInstanceOf(OpenRouterError);
  });

  it('retries on 429 rate limit', async () => {
    let callCount = 0;
    const mockFetch: typeof fetch = ((_url: string | URL | Request): Promise<Response> => {
      callCount++;
      if (callCount < 3) {
        return Promise.resolve({
          status: 429,
          ok: false,
          headers: { get: (k: string) => (k === 'Retry-After' ? '0' : null) },
          text: () => Promise.resolve('rate limited'),
        } as unknown as Response);
      }
      return Promise.resolve({
        status: 200,
        ok: true,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify(validFixture)),
      } as unknown as Response);
    }) as typeof fetch;

    const result = await callOpenRouterJson({
      model: 'test-model',
      apiKey: 'test-key',
      messages: [{ role: 'user', content: 'analyze this' }],
      _fetch: mockFetch,
      _sleep: noopSleep,
    });

    expect(result).toBeTruthy();
    expect(callCount).toBe(3);
  });

  it('uses malformed content fetch correctly (validates test helper)', async () => {
    await expect(
      callOpenRouterJson({
        model: 'test-model',
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'test' }],
        _fetch: makeMalformedContentFetch(),
        _sleep: noopSleep,
      })
    ).rejects.toBeInstanceOf(OpenRouterInvalidOutputError);
  });
});
