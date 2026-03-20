/**
 * Jobs API integration tests
 * Phase 5: Processing Engine
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/server.js';
import { getConfig } from '@links/config';
import { closeDatabase, initDatabase, runMigrations } from '@links/storage';
// Import job-types to ensure handlers are registered
import '@links/storage/dist/job-types.js';
import type { FastifyInstance} from 'fastify';
import { runWorkerOnce } from '../../worker/src/worker.js';

describe('Jobs API', () => {
  let server: FastifyInstance;
  let testDbPath: string;

  beforeEach(async () => {
    // Use unique DB file per test to avoid cross-test contamination
    testDbPath = `./test-api-jobs-${Date.now()}-${Math.random().toString(36).substring(7)}.db`;

    // Initialize test database
    initDatabase({ filename: testDbPath });
    runMigrations();

    // Create server
    const config = getConfig();
    server = await createServer(config);
    await server.listen({ port: 0 }); // Random port
  });

  afterEach(async () => {
    await server.close();
    closeDatabase();

    // Cleanup test database file
    try {
      const fs = await import('node:fs/promises');
      await fs.unlink(testDbPath);
      await fs.unlink(`${testDbPath}-shm`).catch(() => {});
      await fs.unlink(`${testDbPath}-wal`).catch(() => {});
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  it('should enqueue a job', async () => {
    // Create a pot first
    const potRes = await server.inject({
      method: 'POST',
      url: '/pots',
      payload: { name: 'Test Pot' },
    });
    const pot = JSON.parse(potRes.body);

    // Enqueue job
    const res = await server.inject({
      method: 'POST',
      url: '/jobs/enqueue',
      payload: {
        job_type: 'noop',
        pot_id: pot.id,
        priority: 5,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.job).toBeDefined();
    expect(body.job.job_type).toBe('noop');
    expect(body.job.pot_id).toBe(pot.id);
    expect(body.job.status).toBe('queued');
    expect(body.job.priority).toBe(5);
    expect(body.job.attempts).toBe(0);
  });

  it('should list jobs with filters', async () => {
    // Enqueue multiple jobs
    await server.inject({
      method: 'POST',
      url: '/jobs/enqueue',
      payload: { job_type: 'noop' },
    });
    await server.inject({
      method: 'POST',
      url: '/jobs/enqueue',
      payload: { job_type: 'always_fail' },
    });

    // List all jobs
    const res = await server.inject({
      method: 'GET',
      url: '/jobs',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.jobs.length).toBeGreaterThanOrEqual(2);

    // Filter by job_type (use unique job type to avoid cross-test contamination)
    const uniqueType = `test-${Date.now()}`;
    await server.inject({
      method: 'POST',
      url: '/jobs/enqueue',
      payload: { job_type: uniqueType },
    });

    const filteredRes = await server.inject({
      method: 'GET',
      url: `/jobs?job_type=${uniqueType}`,
    });

    const filteredBody = JSON.parse(filteredRes.body);
    expect(filteredBody.jobs.length).toBeGreaterThanOrEqual(1);
    expect(filteredBody.jobs[0].job_type).toBe(uniqueType);
  });

  it('should get job by ID', async () => {
    // Enqueue job
    const enqueueRes = await server.inject({
      method: 'POST',
      url: '/jobs/enqueue',
      payload: { job_type: 'noop' },
    });
    const { job } = JSON.parse(enqueueRes.body);

    // Get job by ID
    const res = await server.inject({
      method: 'GET',
      url: `/jobs/${job.id}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.job.id).toBe(job.id);
  });

  it('should return 404 for non-existent job', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/jobs/00000000-0000-0000-0000-000000000000',
    });

    expect(res.statusCode).toBe(404);
  });

  it('should set force run override', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/jobs/run-now',
      payload: { minutes: 10 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.minutes).toBe(10);
    expect(body.force_run_until).toBeGreaterThan(Date.now());
  });

  it('should process a job with worker', async () => {
    // Create pot
    const potRes = await server.inject({
      method: 'POST',
      url: '/pots',
      payload: { name: 'Worker Test Pot' },
    });
    const pot = JSON.parse(potRes.body);

    // Enqueue touch_pot_usage job
    const enqueueRes = await server.inject({
      method: 'POST',
      url: '/jobs/enqueue',
      payload: {
        job_type: 'touch_pot_usage',
        pot_id: pot.id,
      },
    });
    const { job } = JSON.parse(enqueueRes.body);

    // Small delay to ensure DB write completes
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Run worker once
    const config = getConfig();
    const processed = await runWorkerOnce(config);
    expect(processed).toBe(true);

    // Verify job status is done
    const statusRes = await server.inject({
      method: 'GET',
      url: `/jobs/${job.id}`,
    });
    const statusBody = JSON.parse(statusRes.body);
    expect(statusBody.job.status).toBe('done');
    expect(statusBody.job.attempts).toBe(1);
  });

  it('should retry failing jobs', async () => {
    // Enqueue always_fail job
    const enqueueRes = await server.inject({
      method: 'POST',
      url: '/jobs/enqueue',
      payload: {
        job_type: 'always_fail',
        max_attempts: 2,
      },
    });
    const { job } = JSON.parse(enqueueRes.body);

    // Small delay to ensure DB write completes
    await new Promise((resolve) => setTimeout(resolve, 100));

    const config = getConfig();

    // First attempt
    await runWorkerOnce(config);
    await new Promise((resolve) => setTimeout(resolve, 100));

    let statusRes = await server.inject({
      method: 'GET',
      url: `/jobs/${job.id}`,
    });
    let statusBody = JSON.parse(statusRes.body);
    expect(statusBody.job.status).toBe('failed');
    expect(statusBody.job.attempts).toBe(1);
    expect(statusBody.job.last_error).toContain('always_fail');

    // Second attempt (should deadletter)
    await runWorkerOnce(config);
    await new Promise((resolve) => setTimeout(resolve, 100));

    statusRes = await server.inject({
      method: 'GET',
      url: `/jobs/${job.id}`,
    });
    statusBody = JSON.parse(statusRes.body);
    expect(statusBody.job.status).toBe('dead');
    expect(statusBody.job.attempts).toBe(2);
  });

  it('should process verify_entry_hash job', async () => {
    // Create pot and entry
    const potRes = await server.inject({
      method: 'POST',
      url: '/pots',
      payload: { name: 'Hash Test Pot' },
    });
    const pot = JSON.parse(potRes.body);

    const entryRes = await server.inject({
      method: 'POST',
      url: `/pots/${pot.id}/entries/text`,
      payload: {
        content_text: 'Test content for hash verification',
        capture_method: 'test',
      },
    });
    const entry = JSON.parse(entryRes.body);
    console.log('Entry response:', entry);
    console.log('Entry ID:', entry.id);

    // Enqueue verify_entry_hash job
    const enqueueRes = await server.inject({
      method: 'POST',
      url: '/jobs/enqueue',
      payload: {
        job_type: 'verify_entry_hash',
        pot_id: pot.id,
        entry_id: entry.id,
      },
    });
    const { job } = JSON.parse(enqueueRes.body);

    // Verify job was enqueued with correct entry_id
    expect(job.entry_id).toBe(entry.id);

    // Small delay to ensure DB write completes
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Run worker
    const config = getConfig();
    await runWorkerOnce(config);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify success
    const statusRes = await server.inject({
      method: 'GET',
      url: `/jobs/${job.id}`,
    });
    const statusBody = JSON.parse(statusRes.body);

    // If failed, show error for debugging
    if (statusBody.job.status !== 'done') {
      console.error('Job failed with error:', statusBody.job.last_error);
      console.error('Job details:', JSON.stringify(statusBody.job, null, 2));
    }

    expect(statusBody.job.status).toBe('done');
  });
});
