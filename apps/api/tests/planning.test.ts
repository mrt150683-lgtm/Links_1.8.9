import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unlinkSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/server.js';

const TEST_DB = './test-api-planning.db';

describe('Planning API', () => {
  let server: FastifyInstance;
  let potId = '';

  beforeAll(async () => {
    server = await createServer({
      NODE_ENV: 'test',
      PORT: 3010,
      HOST: '127.0.0.1',
      LOG_LEVEL: 'silent',
      DATABASE_PATH: TEST_DB,
    });

    const potResp = await server.inject({ method: 'POST', url: '/pots', payload: { name: 'Planning Pot' } });
    potId = JSON.parse(potResp.body).id;
  });

  afterAll(async () => {
    await server.close();
    try {
      unlinkSync(TEST_DB);
      unlinkSync(TEST_DB + '-wal');
      unlinkSync(TEST_DB + '-shm');
    } catch {
      // ignore
    }
  });

  it('creates planning run and enqueues question generation job', async () => {
    const createRun = await server.inject({
      method: 'POST',
      url: '/planning/runs',
      payload: { pot_id: potId, project_name: 'My Project', project_type: 'software' },
    });
    expect(createRun.statusCode).toBe(201);
    const runId = JSON.parse(createRun.body).run.id;

    const genQ = await server.inject({
      method: 'POST',
      url: `/planning/runs/${runId}/questions:generate`,
      payload: {},
    });
    expect(genQ.statusCode).toBe(202);
  });
});
