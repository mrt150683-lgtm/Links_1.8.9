/**
 * Phase 12: Job Admin Integration Tests
 *
 * Tests for requeue and dead job management.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/server.js';
import type { FastifyInstance } from 'fastify';
import { getConfig } from '@links/config';

describe('Job Admin', () => {
  let server: FastifyInstance;
  let potId: string;
  let entryId: string;

  beforeAll(async () => {
    const config = getConfig();
    server = await createServer(config);
    await server.listen({ port: 0, host: '127.0.0.1' });

    // Create test pot and entry for job creation
    const potResponse = await server.inject({
      method: 'POST',
      url: '/pots',
      payload: { name: 'Job Admin Test Pot' },
    });
    potId = JSON.parse(potResponse.body).id;

    const entryResponse = await server.inject({
      method: 'POST',
      url: `/pots/${potId}/entries/text`,
      payload: {
        text: 'Test content for job admin',
        capture_method: 'manual',
      },
    });
    entryId = JSON.parse(entryResponse.body).id;
  });

  afterAll(async () => {
    await server.close();
  });

  describe('POST /jobs/:id/requeue', () => {
    it('should requeue a failed job', async () => {
      // Create and enqueue a job
      const enqueueResponse = await server.inject({
        method: 'POST',
        url: '/jobs/enqueue',
        payload: {
          job_type: 'tag_entry',
          pot_id: potId,
          entry_id: entryId,
        },
      });
      expect(enqueueResponse.statusCode).toBe(201);
      const jobId = JSON.parse(enqueueResponse.body).job.id;

      // Manually mark job as failed (simulate failure)
      const { markJobFailed } = await import('@links/storage');
      await markJobFailed(jobId, new Error('Test failure'));

      // Verify job is failed
      const getResponse1 = await server.inject({
        method: 'GET',
        url: `/jobs/${jobId}`,
      });
      expect(getResponse1.statusCode).toBe(200);
      const job1 = JSON.parse(getResponse1.body).job;
      expect(job1.status).toBe('failed');

      // Requeue the job
      const requeueResponse = await server.inject({
        method: 'POST',
        url: `/jobs/${jobId}/requeue`,
      });
      expect(requeueResponse.statusCode).toBe(200);
      const requeuedJob = JSON.parse(requeueResponse.body).job;
      expect(requeuedJob.status).toBe('queued');
      expect(requeuedJob.attempts).toBe(0);
      expect(requeuedJob.last_error).toBeNull();
    });

    it('should requeue a dead job', async () => {
      // Create and enqueue a job
      const enqueueResponse = await server.inject({
        method: 'POST',
        url: '/jobs/enqueue',
        payload: {
          job_type: 'tag_entry',
          pot_id: potId,
          entry_id: entryId,
        },
      });
      expect(enqueueResponse.statusCode).toBe(201);
      const jobId = JSON.parse(enqueueResponse.body).job.id;

      // Manually mark job as dead
      const { markJobDead } = await import('@links/storage');
      await markJobDead(jobId, new Error('Test permanent failure'));

      // Requeue the job
      const requeueResponse = await server.inject({
        method: 'POST',
        url: `/jobs/${jobId}/requeue`,
      });
      expect(requeueResponse.statusCode).toBe(200);
      const requeuedJob = JSON.parse(requeueResponse.body).job;
      expect(requeuedJob.status).toBe('queued');
    });

    it('should reject requeue of queued job', async () => {
      // Create and enqueue a job
      const enqueueResponse = await server.inject({
        method: 'POST',
        url: '/jobs/enqueue',
        payload: {
          job_type: 'tag_entry',
          pot_id: potId,
          entry_id: entryId,
        },
      });
      expect(enqueueResponse.statusCode).toBe(201);
      const jobId = JSON.parse(enqueueResponse.body).job.id;

      // Try to requeue queued job (should fail)
      const requeueResponse = await server.inject({
        method: 'POST',
        url: `/jobs/${jobId}/requeue`,
      });
      expect(requeueResponse.statusCode).toBe(400);
      const body = JSON.parse(requeueResponse.body);
      expect(body.error).toBe('InvalidStatus');
    });

    it('should return 404 for non-existent job', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/jobs/fake-job-id/requeue',
      });
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('NotFound');
    });
  });

  describe('GET /jobs/dead', () => {
    it('should list all dead jobs', async () => {
      // Create some dead jobs
      const jobIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const enqueueResponse = await server.inject({
          method: 'POST',
          url: '/jobs/enqueue',
          payload: {
            job_type: 'tag_entry',
            pot_id: potId,
            entry_id: entryId,
          },
        });
        const jobId = JSON.parse(enqueueResponse.body).job.id;
        jobIds.push(jobId);

        // Mark as dead
        const { markJobDead } = await import('@links/storage');
        await markJobDead(jobId, new Error(`Test failure ${i}`));
      }

      // List dead jobs
      const response = await server.inject({
        method: 'GET',
        url: '/jobs/dead',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jobs).toBeDefined();
      expect(Array.isArray(body.jobs)).toBe(true);
      expect(body.jobs.length).toBeGreaterThanOrEqual(3);
      expect(body.total).toBe(body.jobs.length);

      // Verify all returned jobs are dead
      body.jobs.forEach((job: any) => {
        expect(job.status).toBe('dead');
      });
    });

    it('should return empty list when no dead jobs', async () => {
      // First requeue all dead jobs
      await server.inject({
        method: 'POST',
        url: '/jobs/requeue-dead',
      });

      // Then list dead jobs (should be empty)
      const response = await server.inject({
        method: 'GET',
        url: '/jobs/dead',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jobs).toEqual([]);
      expect(body.total).toBe(0);
    });
  });

  describe('POST /jobs/requeue-dead', () => {
    it('should requeue all dead jobs', async () => {
      // Create multiple dead jobs
      const jobIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const enqueueResponse = await server.inject({
          method: 'POST',
          url: '/jobs/enqueue',
          payload: {
            job_type: 'tag_entry',
            pot_id: potId,
            entry_id: entryId,
          },
        });
        const jobId = JSON.parse(enqueueResponse.body).job.id;
        jobIds.push(jobId);

        // Mark as dead
        const { markJobDead } = await import('@links/storage');
        await markJobDead(jobId, new Error(`Batch test failure ${i}`));
      }

      // Verify we have dead jobs
      const deadListBefore = await server.inject({
        method: 'GET',
        url: '/jobs/dead',
      });
      const deadCountBefore = JSON.parse(deadListBefore.body).total;
      expect(deadCountBefore).toBeGreaterThanOrEqual(5);

      // Requeue all dead jobs
      const requeueResponse = await server.inject({
        method: 'POST',
        url: '/jobs/requeue-dead',
      });
      expect(requeueResponse.statusCode).toBe(200);
      const body = JSON.parse(requeueResponse.body);
      expect(body.count).toBeGreaterThanOrEqual(5);

      // Verify no more dead jobs
      const deadListAfter = await server.inject({
        method: 'GET',
        url: '/jobs/dead',
      });
      const deadCountAfter = JSON.parse(deadListAfter.body).total;
      expect(deadCountAfter).toBe(0);

      // Verify jobs are now queued
      for (const jobId of jobIds) {
        const jobResponse = await server.inject({
          method: 'GET',
          url: `/jobs/${jobId}`,
        });
        const job = JSON.parse(jobResponse.body).job;
        expect(job.status).toBe('queued');
        expect(job.attempts).toBe(0);
      }
    });

    it('should return 0 when no dead jobs to requeue', async () => {
      // First requeue all
      await server.inject({
        method: 'POST',
        url: '/jobs/requeue-dead',
      });

      // Try again (should be 0)
      const response = await server.inject({
        method: 'POST',
        url: '/jobs/requeue-dead',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.count).toBe(0);
    });
  });
});
