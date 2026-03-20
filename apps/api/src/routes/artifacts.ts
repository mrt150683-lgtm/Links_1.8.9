/**
 * Phase 7: Artifacts Routes
 *
 * Query endpoints for derived artifacts (tags, entities, summaries)
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { listArtifactsForEntry, getLatestArtifact, enqueueJob, getDatabase, logAuditEvent, listArtifactsByPot, listLinksForPot, listAgentCandidates, listEntries } from '@links/storage';
import type { ArtifactResponse, ListArtifactsResponse, ProcessEntryRequest, ProcessEntryResponse } from '@links/core';

/**
 * Artifacts routes plugin
 */
export const artifactsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /entries/:entryId/artifacts
   * List all artifacts for an entry
   */
  fastify.get<{
    Params: { entryId: string };
  }>('/entries/:entryId/artifacts', async (request, reply) => {
    const { entryId } = request.params;

    const artifacts = await listArtifactsForEntry(entryId);

    // Transform to response format with typed payloads
    const response: ListArtifactsResponse = {
      entry_id: entryId,
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        pot_id: artifact.pot_id,
        entry_id: artifact.entry_id,
        artifact_type: artifact.artifact_type,
        schema_version: artifact.schema_version,
        model_id: artifact.model_id,
        prompt_id: artifact.prompt_id,
        prompt_version: artifact.prompt_version,
        temperature: artifact.temperature,
        max_tokens: artifact.max_tokens,
        created_at: artifact.created_at,
        payload: artifact.payload,
        evidence: artifact.evidence,
      })) as ArtifactResponse[],
    };

    return reply.status(200).send(response);
  });

  /**
   * GET /entries/:entryId/artifacts/:type/latest
   * Get the most recent artifact of a specific type for an entry
   */
  fastify.get<{
    Params: { entryId: string; type: 'tags' | 'entities' | 'summary' | 'extracted_text' };
  }>('/entries/:entryId/artifacts/:type/latest', async (request, reply) => {
    const { entryId, type } = request.params;

    // Validate artifact type
    if (!['tags', 'entities', 'summary', 'extracted_text'].includes(type)) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'Invalid artifact type. Must be one of: tags, entities, summary, extracted_text',
      });
    }

    const artifact = await getLatestArtifact(entryId, type);

    if (!artifact) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: `No ${type} artifact found for entry ${entryId}`,
        statusCode: 404,
        request_id: request.id,
      });
    }

    // Transform to response format
    const response: ArtifactResponse = {
      id: artifact.id,
      pot_id: artifact.pot_id,
      entry_id: artifact.entry_id,
      artifact_type: artifact.artifact_type,
      schema_version: artifact.schema_version,
      model_id: artifact.model_id,
      prompt_id: artifact.prompt_id,
      prompt_version: artifact.prompt_version,
      temperature: artifact.temperature,
      max_tokens: artifact.max_tokens,
      created_at: artifact.created_at,
      payload: artifact.payload,
      evidence: artifact.evidence,
    } as ArtifactResponse;

    return reply.status(200).send(response);
  });

  /**
   * POST /entries/:entryId/process
   * Manually trigger artifact generation for an entry
   *
   * Body: { types: ["tags"|"entities"|"summary"], force: boolean }
   * - force=false: skip if artifact exists for current prompt version
   * - force=true: rerun and upsert (deterministic reprocessing)
   */
  fastify.post<{
    Params: { entryId: string };
    Body: ProcessEntryRequest;
  }>('/entries/:entryId/process', async (request, reply) => {
    const { entryId } = request.params;

    // Validate request body
    const ProcessRequestSchema = z.object({
      types: z.array(z.enum(['tags', 'entities', 'summary'])).min(1).max(3),
      force: z.boolean().optional().default(false),
    });

    const validation = ProcessRequestSchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'Invalid request body',
        details: validation.error.format(),
      });
    }

    const { types, force } = validation.data;

    // Verify entry exists
    const db = getDatabase();
    const entry = await db
      .selectFrom('entries')
      .select(['id', 'pot_id', 'type'])
      .where('id', '=', entryId)
      .executeTakeFirst();

    if (!entry) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: `Entry not found: ${entryId}`,
        statusCode: 404,
        request_id: request.id,
      });
    }

    if (entry.type !== 'text') {
      return reply.status(400).send({
        error: 'ValidationError',
        message: `Cannot process entry of type '${entry.type}'. Only text entries can be processed.`,
      });
    }

    // Enqueue jobs for each requested type
    const jobs: Array<{ id: string; job_type: string; status: string }> = [];

    for (const type of types) {
      let jobType: string;
      switch (type) {
        case 'tags':
          jobType = 'tag_entry';
          break;
        case 'entities':
          jobType = 'extract_entities';
          break;
        case 'summary':
          jobType = 'summarize_entry';
          break;
      }

      const job = await enqueueJob({
        job_type: jobType,
        pot_id: entry.pot_id,
        entry_id: entryId,
        priority: 100, // Manual processing gets high priority
      });

      jobs.push({
        id: job.id,
        job_type: jobType,
        status: job.status,
      });
    }

    // Write audit event
    await logAuditEvent({
      actor: 'user',
      action: 'entry_processing_requested',
      pot_id: entry.pot_id,
      entry_id: entryId,
      metadata: {
        types,
        force,
        jobs: jobs.map(j => j.id),
      },
    });

    const response: ProcessEntryResponse = {
      entry_id: entryId,
      jobs,
    };

    return reply.status(201).send(response);
  });

  /**
   * GET /pots/:potId/intelligence-summary
   * Aggregated intelligence summary for a pot: top tags, top entities, processing status,
   * recent links, and latest agent candidate.
   */
  fastify.get<{
    Params: { potId: string };
  }>('/pots/:potId/intelligence-summary', async (request, reply) => {
    const { potId } = request.params;

    // 1. Fetch all entries for pot; exclude 'link' type from eligible count
    const allEntries = await listEntries({ pot_id: potId, limit: 2000 });
    const eligibleEntries = allEntries.filter((e) => e.type !== 'link');

    // 2. Single DB query for tags, entities, summary artifacts
    const artifacts = await listArtifactsByPot(potId, ['tags', 'entities', 'summary']);

    // 3. Aggregate across all artifacts
    const processedEntryIds = new Set<string>();
    const tagsMap = new Map<string, { count: number; totalConf: number }>();
    const entitiesMap = new Map<string, { type: string; count: number }>();
    const entityTypeCounts: Record<string, number> = { person: 0, org: 0, place: 0, concept: 0 };
    const entriesStatus: Record<string, { tags: boolean; entities: boolean; summary: boolean }> = {};

    for (const art of artifacts) {
      const entryId = art.entry_id;
      if (!entriesStatus[entryId]) {
        entriesStatus[entryId] = { tags: false, entities: false, summary: false };
      }

      if (art.artifact_type === 'tags') {
        entriesStatus[entryId].tags = true;
        processedEntryIds.add(entryId);
        const tags: any[] = (art.payload as any)?.tags ?? [];
        for (const tag of tags) {
          const key = (tag.label ?? '').toLowerCase();
          if (!key) continue;
          const existing = tagsMap.get(key) ?? { count: 0, totalConf: 0 };
          tagsMap.set(key, {
            count: existing.count + 1,
            totalConf: existing.totalConf + (tag.confidence ?? 0),
          });
        }
      } else if (art.artifact_type === 'entities') {
        entriesStatus[entryId].entities = true;
        const entities: any[] = (art.payload as any)?.entities ?? [];
        for (const entity of entities) {
          const key = entity.label ?? '';
          if (!key) continue;
          const rawType = (entity.type ?? 'concept').toLowerCase();
          const normalizedType =
            rawType === 'person' ? 'person'
            : rawType === 'org' || rawType === 'organization' ? 'org'
            : rawType === 'place' || rawType === 'location' ? 'place'
            : 'concept';
          const existing = entitiesMap.get(key);
          if (existing) {
            existing.count++;
          } else {
            entitiesMap.set(key, { type: normalizedType, count: 1 });
          }
          if (normalizedType in entityTypeCounts) {
            entityTypeCounts[normalizedType] = (entityTypeCounts[normalizedType] ?? 0) + 1;
          }
        }
      } else if (art.artifact_type === 'summary') {
        entriesStatus[entryId].summary = true;
        processedEntryIds.add(entryId);
      }
    }

    const topTags = Array.from(tagsMap.entries())
      .map(([label, v]) => ({
        label,
        count: v.count,
        avg_confidence: v.count > 0 ? v.totalConf / v.count : 0,
      }))
      .sort((a, b) => b.count - a.count || b.avg_confidence - a.avg_confidence)
      .slice(0, 20);

    const topEntities = Array.from(entitiesMap.entries())
      .map(([label, v]) => ({ label, type: v.type, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // 4. Recent links (top 5 by confidence)
    const recentLinks = await listLinksForPot(potId, 0.0, undefined, 5);

    // 5. Latest delivered agent candidate
    const candidatesResult = await listAgentCandidates(potId, { status: 'delivered', limit: 1 });
    const latestCandidate = candidatesResult.candidates[0] ?? null;

    return reply.status(200).send({
      processed_count: processedEntryIds.size,
      total_eligible: eligibleEntries.length,
      top_tags: topTags,
      top_entities: topEntities,
      entity_type_counts: entityTypeCounts,
      entries_status: entriesStatus,
      recent_links: recentLinks.map((l) => ({
        src_entry_id: l.src_entry_id,
        dst_entry_id: l.dst_entry_id,
        link_type: l.link_type,
        confidence: l.confidence,
        rationale: l.rationale,
      })),
      latest_candidate: latestCandidate
        ? {
            title: latestCandidate.title,
            body: latestCandidate.body,
            candidate_type: latestCandidate.candidate_type,
            confidence: latestCandidate.confidence,
          }
        : null,
    });
  });
};
