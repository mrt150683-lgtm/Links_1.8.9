import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import requestIdPlugin from '../src/fastify-request-id.js';

describe('requestIdPlugin', () => {
  it('should generate request ID when missing', async () => {
    const fastify = Fastify({ logger: false });
    await fastify.register(requestIdPlugin);

    fastify.get('/test', async (request) => {
      return { id: request.id };
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    const body = JSON.parse(response.body);
    expect(body.id).toBe(response.headers['x-request-id']);
  });

  it('should use provided request ID from header', async () => {
    const fastify = Fastify({ logger: false });
    await fastify.register(requestIdPlugin);

    fastify.get('/test', async (request) => {
      return { id: request.id };
    });

    const providedId = 'custom-request-id-123';
    const response = await fastify.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'x-request-id': providedId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe(providedId);

    const body = JSON.parse(response.body);
    expect(body.id).toBe(providedId);
  });
});
