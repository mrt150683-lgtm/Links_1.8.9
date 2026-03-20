import type { FastifyPluginAsync } from 'fastify';
import {
  CreateTextEntryRequestSchema,
  ListEntriesQuerySchema,
  type CreateTextEntryRequest,
  type ListEntriesQuery,
} from '@links/core';
import {
  createTextEntry,
  getEntryById,
  getEntryWithAsset, // Phase 4
  listEntries,
  deleteEntry,
  countEntriesByPot,
  getPotById,
  enqueueJob,
  createLinkEntry,
  hasQueuedJobForPot,
} from '@links/storage';
import { z } from 'zod';

const entriesRoute: FastifyPluginAsync = async (fastify) => {
  // Create text entry
  fastify.post<{ Params: { potId: string } }>(
    '/pots/:potId/entries/text',
    async (request, reply) => {
      const potId = request.params.potId;

      // Verify pot exists
      const pot = await getPotById(potId);
      if (!pot) {
        reply.status(404).send({
          error: 'NotFoundError',
          message: 'Pot not found',
          statusCode: 404,
        });
        return;
      }

      const result = CreateTextEntryRequestSchema.safeParse(request.body);
      if (!result.success) {
        reply.status(400).send({
          error: 'ValidationError',
          message: 'Invalid request body',
          statusCode: 400,
          request_id: request.id,
        });
        return;
      }

      const body = result.data as CreateTextEntryRequest;

      const entry = await createTextEntry({
        pot_id: potId,
        content_text: body.text,
        capture_method: body.capture_method,
        source_url: body.source_url,
        source_title: body.source_title,
        notes: body.notes,
        captured_at: body.captured_at,
      });

      // Slice 4: fire-and-forget nudge trigger (triage nudge after entry accumulation).
      // Guard: only enqueue if no generate_nudges job is already pending for this pot,
      // preventing queue spam when many entries are captured in quick succession.
      hasQueuedJobForPot('generate_nudges', potId).then((alreadyQueued) => {
        if (!alreadyQueued) {
          return enqueueJob({
            job_type: 'generate_nudges',
            pot_id: potId,
            priority: 10,
            payload: { trigger: 'new_entry', entry_id: entry.id, pot_id: potId },
          });
        }
      }).catch(() => { /* non-fatal */ });

      reply.status(201).send(entry);
    }
  );

  // Submit video URL for transcription
  const SubmitVideoSchema = z.object({
    video_url: z.string().url(),
    notes: z.string().optional(),
  });

  fastify.post<{ Params: { potId: string } }>(
    '/pots/:potId/videos',
    async (request, reply) => {
      const potId = request.params.potId;

      // Verify pot exists
      const pot = await getPotById(potId);
      if (!pot) {
        reply.status(404).send({
          error: 'NotFoundError',
          message: 'Pot not found',
          statusCode: 404,
        });
        return;
      }

      // Validate request body
      const validation = SubmitVideoSchema.safeParse(request.body);
      if (!validation.success) {
        reply.status(400).send({
          error: 'ValidationError',
          message: 'Invalid request body',
          details: validation.error.format(),
          statusCode: 400,
        });
        return;
      }

      const { video_url, notes } = validation.data;

      // Validate video URL format (YouTube, Rumble, etc.)
      const url = new URL(video_url);
      const validDomains = [
        'youtube.com',
        'www.youtube.com',
        'youtu.be',
        'rumble.com',
        'www.rumble.com',
      ];

      const isValidDomain = validDomains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));

      if (!isValidDomain) {
        reply.status(400).send({
          error: 'ValidationError',
          message: 'Unsupported video platform. Supported: YouTube, Rumble',
          statusCode: 400,
        });
        return;
      }

      // Create link entry for the video
      // Note: notes are not supported in CreateLinkEntryInput, using content_text for user notes
      const entry = await createLinkEntry({
        pot_id: potId,
        link_url: video_url,
        capture_method: 'api',
        content_text: notes,
      });

      // Enqueue transcription job with high priority
      const job = await enqueueJob({
        job_type: 'transcribe_video',
        pot_id: potId,
        entry_id: entry.id,
        priority: 75, // High priority for user-initiated requests
      });

      reply.status(201).send({
        entry_id: entry.id,
        job_id: job.id,
        status: 'queued',
      });
    }
  );

  // List entries for a pot
  fastify.get<{ Params: { potId: string } }>(
    '/pots/:potId/entries',
    async (request, reply) => {
      const potId = request.params.potId;

      // Verify pot exists
      const pot = await getPotById(potId);
      if (!pot) {
        reply.status(404).send({
          error: 'NotFoundError',
          message: 'Pot not found',
          statusCode: 404,
        });
        return;
      }

      const query = ListEntriesQuerySchema.parse(request.query) as ListEntriesQuery;

      const entries = await listEntries({
        pot_id: potId,
        limit: query.limit,
        offset: query.offset,
        capture_method: query.capture_method,
        source_url: query.source_url,
      });

      const total = await countEntriesByPot(potId);

      return {
        entries,
        total,
        pot_id: potId,
      };
    }
  );

  // Get entry by ID (Phase 4: includes embedded asset metadata)
  fastify.get<{ Params: { entryId: string } }>('/entries/:entryId', async (request, reply) => {
    const entry = await getEntryWithAsset(request.params.entryId);

    if (!entry) {
      reply.status(404).send({
        error: 'NotFoundError',
        message: 'Entry not found',
        statusCode: 404,
      });
      return;
    }

    return entry;
  });

  // Delete entry
  fastify.delete<{ Params: { entryId: string } }>(
    '/entries/:entryId',
    async (request, reply) => {
      const deleted = await deleteEntry(request.params.entryId);

      if (!deleted) {
        reply.status(404).send({
          error: 'NotFoundError',
          message: 'Entry not found',
          statusCode: 404,
        });
        return;
      }

      return { ok: true };
    }
  );
};

export default entriesRoute;
