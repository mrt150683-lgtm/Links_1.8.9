import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';

describe('Health endpoint', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await createServer({
      NODE_ENV: 'test',
      PORT: 3000,
      HOST: '127.0.0.1',
      LOG_LEVEL: 'silent',
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('GET /health should return 200 with correct schema', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body).toMatchObject({
      ok: true,
      service: 'api',
      version: '0.1.0',
    });
    expect(body.time).toBeTypeOf('number');
  });

  it('GET /health should include x-request-id header', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('GET /health should use provided request ID', async () => {
    const customId = 'test-request-123';

    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'x-request-id': customId,
      },
    });

    expect(response.headers['x-request-id']).toBe(customId);
  });
});
