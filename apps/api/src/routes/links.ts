/**
 * Phase 8: Links API Routes
 *
 * Endpoints for querying discovered links and triggering link discovery
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  getEntryById,
  getPotById,
  listLinksForEntry,
  listLinksForPot,
  countLinksForEntry,
  countLinksForPot,
  enqueueJob,
  logAuditEvent,
} from '@links/storage';
import { createLogger } from '@links/logging';
import { z } from 'zod';

const logger = createLogger({ name: 'api:links' });

/**
 * Query parameters schema for list links endpoints
 */
const ListLinksQuerySchema = z.object({
  min_confidence: z.coerce.number().min(0).max(1).optional().default(0.6),
  type: z.string().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional().default(100),
});

/**
 * Manual link discovery trigger schema
 */
const TriggerLinkDiscoverySchema = z.object({
  max_candidates: z.number().int().positive().max(100).optional().default(30),
  force: z.boolean().optional().default(false),
});

/**
 * Links routes plugin
 */
export const linksRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /entries/:entryId/links
   * List links for an entry
   */
  fastify.get<{
    Params: { entryId: string };
    Querystring: z.infer<typeof ListLinksQuerySchema>;
  }>('/entries/:entryId/links', async (request, reply) => {
    const { entryId } = request.params;

    // Validate query params
    const queryValidation = ListLinksQuerySchema.safeParse(request.query);
    if (!queryValidation.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: queryValidation.error.message,
        statusCode: 400,
        request_id: request.id,
      });
    }

    const { min_confidence, type, limit } = queryValidation.data;

    // Check entry exists
    const entry = await getEntryById(entryId);
    if (!entry) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: `Entry not found: ${entryId}`,
        statusCode: 404,
        request_id: request.id,
      });
    }

    // Fetch links
    const links = await listLinksForEntry(entryId, min_confidence, type);

    // Format response with "other_entry_id" for convenience
    const formattedLinks = links.slice(0, limit).map((link) => ({
      link_id: link.id,
      link_type: link.link_type,
      confidence: link.confidence,
      rationale: link.rationale,
      other_entry_id: link.src_entry_id === entryId ? link.dst_entry_id : link.src_entry_id,
      evidence: link.evidence,
      created_at: link.created_at,
    }));

    logger.info({
      request_id: request.id,
      entry_id: entryId,
      links_count: formattedLinks.length,
      min_confidence,
      type,
    }, 'Listed links for entry');

    return reply.status(200).send({
      entry_id: entryId,
      links: formattedLinks,
    });
  });

  /**
   * GET /pots/:potId/links
   * List links for a pot
   */
  fastify.get<{
    Params: { potId: string };
    Querystring: z.infer<typeof ListLinksQuerySchema>;
  }>('/pots/:potId/links', async (request, reply) => {
    const { potId } = request.params;

    // Validate query params
    const queryValidation = ListLinksQuerySchema.safeParse(request.query);
    if (!queryValidation.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: queryValidation.error.message,
        statusCode: 400,
        request_id: request.id,
      });
    }

    const { min_confidence, type, limit } = queryValidation.data;

    // Check pot exists
    const pot = await getPotById(potId);
    if (!pot) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: `Pot not found: ${potId}`,
        statusCode: 404,
        request_id: request.id,
      });
    }

    // Fetch links and count
    const links = await listLinksForPot(potId, min_confidence, type, limit);
    const totalCount = await countLinksForPot(potId, min_confidence);

    logger.info({
      request_id: request.id,
      pot_id: potId,
      links_count: links.length,
      total_count: totalCount,
      min_confidence,
      type,
    }, 'Listed links for pot');

    return reply.status(200).send({
      pot_id: potId,
      links: links.map((link) => ({
        id: link.id,
        src_entry_id: link.src_entry_id,
        dst_entry_id: link.dst_entry_id,
        link_type: link.link_type,
        confidence: link.confidence,
        rationale: link.rationale,
        evidence: link.evidence,
        model_id: link.model_id,
        prompt_id: link.prompt_id,
        prompt_version: link.prompt_version,
        temperature: link.temperature,
        created_at: link.created_at,
      })),
      total_count: totalCount,
    });
  });

  /**
   * POST /entries/:entryId/link-discovery
   * Manually trigger link discovery for an entry
   */
  fastify.post<{
    Params: { entryId: string };
    Body: z.infer<typeof TriggerLinkDiscoverySchema>;
  }>('/entries/:entryId/link-discovery', async (request, reply) => {
    const { entryId } = request.params;

    // Validate body
    const bodyValidation = TriggerLinkDiscoverySchema.safeParse(request.body);
    if (!bodyValidation.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: bodyValidation.error.message,
        statusCode: 400,
        request_id: request.id,
      });
    }

    const { max_candidates, force } = bodyValidation.data;

    // Check entry exists
    const entry = await getEntryById(entryId);
    if (!entry) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: `Entry not found: ${entryId}`,
        statusCode: 404,
        request_id: request.id,
      });
    }

    // Note: We allow any entry type here. The job handler will skip entries
    // without text content (images, audio without transcripts, etc.)
    // This lets the UI send "discover links for all entries" without filtering client-side.

    // Enqueue candidate generation job
    const candidateJob = await enqueueJob({
      pot_id: entry.pot_id,
      entry_id: entryId,
      job_type: 'generate_link_candidates',
      priority: 5, // Medium priority (user-triggered)
      // Note: max_candidates not currently supported via payload,
      // job will use default CANDIDATE_LIMITS.MAX_CANDIDATES_PER_ENTRY
    });

    logger.info({
      request_id: request.id,
      entry_id: entryId,
      job_id: candidateJob.id,
      max_candidates,
    }, 'Enqueued link discovery job');

    // Log audit event
    await logAuditEvent({
      actor: 'user',
      action: 'link_discovery_triggered',
      pot_id: entry.pot_id,
      entry_id: entryId,
      metadata: {
        request_id: request.id,
        job_id: candidateJob.id,
        max_candidates,
        force,
      },
    });

    return reply.status(202).send({
      entry_id: entryId,
      candidates_generated: 0, // Will be updated after job runs
      jobs_enqueued: 1,
      message: 'Link discovery job enqueued',
      job_id: candidateJob.id,
    });
  });

  /**
   * GET /entries/:entryId/links/count
   * Count links for an entry
   */
  fastify.get<{
    Params: { entryId: string };
    Querystring: { min_confidence?: number };
  }>('/entries/:entryId/links/count', async (request, reply) => {
    const { entryId } = request.params;
    const minConfidence = request.query.min_confidence ? Number(request.query.min_confidence) : 0.6;

    // Check entry exists
    const entry = await getEntryById(entryId);
    if (!entry) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: `Entry not found: ${entryId}`,
        statusCode: 404,
        request_id: request.id,
      });
    }

    const count = await countLinksForEntry(entryId, minConfidence);

    return reply.status(200).send({
      entry_id: entryId,
      count,
      min_confidence: minConfidence,
    });
  });
};
