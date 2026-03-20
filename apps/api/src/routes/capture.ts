import type { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import {
  listPotsForCapture,
  getPotById,
  createTextEntryIdempotent,
  createImageEntry,
  isAutosaveEnabled,
  enqueueJob,
  insertAsset,
  getBySha256,
  writeEncryptedAsset,
} from '@links/storage';
import {
  CaptureTextRequestSchema,
  type CapturePot,
  type CaptureTextResponse,
} from '@links/core';

function mimeTypeFromUrl(url: string): string {
  const ext = url?.split('?')[0].split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    bmp: 'image/bmp', ico: 'image/x-icon',
  };
  return map[ext ?? ''] ?? 'image/jpeg';
}

/**
 * Phase 3: Capture endpoints for popup/clipboard workflows
 */
const captureRoute: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /capture/pots - Get pot picker list (sorted by recent usage)
   */
  fastify.get<{
    Querystring: { limit?: string };
  }>('/capture/pots', async (request, reply) => {
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 20;

    if (isNaN(limit) || limit < 1 || limit > 100) {
      reply.status(400).send({
        error: 'ValidationError',
        message: 'limit must be between 1 and 100',
        statusCode: 400,
        request_id: request.id,
      });
      return;
    }

    const pots = await listPotsForCapture(limit);

    const response: CapturePot[] = pots.map((pot) => ({
      id: pot.id,
      name: pot.name,
      last_used_at: pot.last_used_at,
      created_at: pot.created_at,
    }));

    return reply.code(200).send(response);
  });

  /**
   * POST /capture/text - Capture text with idempotency
   */
  fastify.post<{
    Body: unknown;
  }>('/capture/text', async (request, reply) => {
    // Validate request body
    const parseResult = CaptureTextRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400).send({
        error: 'ValidationError',
        message: `Invalid request: ${parseResult.error.message}`,
        statusCode: 400,
        request_id: request.id,
      });
      return;
    }

    const input = parseResult.data;

    // Verify pot exists
    const pot = await getPotById(input.pot_id);
    if (!pot) {
      reply.status(404).send({
        error: 'NotFoundError',
        message: `Pot not found: ${input.pot_id}`,
        statusCode: 404,
        request_id: request.id,
      });
      return;
    }

    // Validate captured_at (must be within ±7 days of server time)
    if (input.captured_at !== undefined) {
      const now = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const timeDiff = Math.abs(now - input.captured_at);

      if (timeDiff > sevenDays) {
        reply.status(400).send({
          error: 'ValidationError',
          message: 'captured_at must be within 7 days of server time',
          statusCode: 400,
          request_id: request.id,
        });
        return;
      }
    }

    // Validate text is non-empty after trim
    if (input.text.trim().length === 0) {
      reply.status(400).send({
        error: 'ValidationError',
        message: 'text must be non-empty after trimming whitespace',
        statusCode: 400,
        request_id: request.id,
      });
      return;
    }

    // Create entry with idempotency
    const result = await createTextEntryIdempotent({
      pot_id: input.pot_id,
      content_text: input.text,
      capture_method: input.capture_method,
      captured_at: input.captured_at,
      source_url: input.source_url,
      source_title: input.source_title,
      notes: input.notes,
      client_capture_id: input.client_capture_id,
      source_app: input.source_app,
      source_context: input.source_context,
    });

    // Phase 7: Enqueue artifact generation jobs for newly created text entries
    if (result.created && result.entry.type === 'text') {
      // Enqueue tag extraction job
      await enqueueJob({
        job_type: 'tag_entry',
        pot_id: result.entry.pot_id,
        entry_id: result.entry.id,
        priority: 50,
      });

      // Enqueue entity extraction job
      await enqueueJob({
        job_type: 'extract_entities',
        pot_id: result.entry.pot_id,
        entry_id: result.entry.id,
        priority: 50,
      });

      // Enqueue summarization job
      await enqueueJob({
        job_type: 'summarize_entry',
        pot_id: result.entry.pot_id,
        entry_id: result.entry.id,
        priority: 40, // Slightly lower priority (summaries are more expensive)
      });
    }

    const response: CaptureTextResponse = {
      created: result.created,
      entry: result.entry,
      deduped: result.deduped,
      dedupe_reason: result.dedupe_reason,
    };

    // Return 201 if created, 200 if deduped
    const statusCode = result.created ? 201 : 200;
    return reply.code(statusCode).send(response);
  });

  /**
   * POST /capture/text/auto - Autosave variant (checks autosave preference)
   */
  fastify.post<{
    Body: unknown;
  }>('/capture/text/auto', async (request, reply) => {
    // Validate request body
    const parseResult = CaptureTextRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400).send({
        error: 'ValidationError',
        message: `Invalid request: ${parseResult.error.message}`,
        statusCode: 400,
        request_id: request.id,
      });
      return;
    }

    const input = parseResult.data;

    // Verify pot exists
    const pot = await getPotById(input.pot_id);
    if (!pot) {
      reply.status(404).send({
        error: 'NotFoundError',
        message: `Pot not found: ${input.pot_id}`,
        statusCode: 404,
        request_id: request.id,
      });
      return;
    }

    // Check if autosave is enabled for this pot
    const autosaveEnabled = await isAutosaveEnabled(input.pot_id);
    if (!autosaveEnabled) {
      reply.status(409).send({
        error: 'AutosaveDisabled',
        message: `Autosave is disabled for pot: ${input.pot_id}`,
        statusCode: 409,
        request_id: request.id,
      });
      return;
    }

    // Validate captured_at (must be within ±7 days of server time)
    if (input.captured_at !== undefined) {
      const now = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const timeDiff = Math.abs(now - input.captured_at);

      if (timeDiff > sevenDays) {
        reply.status(400).send({
          error: 'ValidationError',
          message: 'captured_at must be within 7 days of server time',
          statusCode: 400,
          request_id: request.id,
        });
        return;
      }
    }

    // Validate text is non-empty after trim
    if (input.text.trim().length === 0) {
      reply.status(400).send({
        error: 'ValidationError',
        message: 'text must be non-empty after trimming whitespace',
        statusCode: 400,
        request_id: request.id,
      });
      return;
    }

    // Create entry with idempotency
    const result = await createTextEntryIdempotent({
      pot_id: input.pot_id,
      content_text: input.text,
      capture_method: input.capture_method,
      captured_at: input.captured_at,
      source_url: input.source_url,
      source_title: input.source_title,
      notes: input.notes,
      client_capture_id: input.client_capture_id,
      source_app: input.source_app,
      source_context: input.source_context,
    });

    // Phase 7: Enqueue artifact generation jobs for newly created text entries
    if (result.created && result.entry.type === 'text') {
      // Enqueue tag extraction job
      await enqueueJob({
        job_type: 'tag_entry',
        pot_id: result.entry.pot_id,
        entry_id: result.entry.id,
        priority: 50,
      });

      // Enqueue entity extraction job
      await enqueueJob({
        job_type: 'extract_entities',
        pot_id: result.entry.pot_id,
        entry_id: result.entry.id,
        priority: 50,
      });

      // Enqueue summarization job
      await enqueueJob({
        job_type: 'summarize_entry',
        pot_id: result.entry.pot_id,
        entry_id: result.entry.id,
        priority: 40, // Slightly lower priority (summaries are more expensive)
      });
    }

    const response: CaptureTextResponse = {
      created: result.created,
      entry: result.entry,
      deduped: result.deduped,
      dedupe_reason: result.dedupe_reason,
    };

    // Return 201 if created, 200 if deduped
    const statusCode = result.created ? 201 : 200;
    return reply.code(statusCode).send(response);
  });

  /**
   * POST /capture/image - Capture image from browser (base64-encoded data)
   */
  fastify.post<{
    Body: unknown;
  }>('/capture/image', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const potId = body.pot_id as string;
    const imageData = body.image_data as string;
    const imageSourceUrl = body.image_source_url as string;
    const sourceUrl = body.source_url as string;
    const notes = body.notes as string | undefined;
    const captureMethod = body.capture_method as string || 'browser_image';

    // Validate required fields
    if (!potId || !imageData) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'pot_id and image_data are required',
        statusCode: 400,
        request_id: request.id,
      });
    }

    // Verify pot exists
    const pot = await getPotById(potId);
    if (!pot) {
      return reply.status(404).send({
        error: 'NotFoundError',
        message: `Pot not found: ${potId}`,
        statusCode: 404,
        request_id: request.id,
      });
    }

    try {
      // Decode base64 image
      const imageBuffer = Buffer.from(imageData, 'base64');
      const sha256 = crypto.createHash('sha256').update(imageBuffer).digest('hex');

      // Check for dedupe
      const existingAsset = await getBySha256(sha256);
      if (existingAsset) {
        // Asset already exists, create image entry referencing it
        const entry = await createImageEntry({
          pot_id: potId,
          asset_id: existingAsset.id,
          source_url: sourceUrl || null,
          notes: notes || null,
          capture_method: captureMethod,
        });

        // Enqueue processing jobs for newly created image entries
        await enqueueJob({
          job_type: 'tag_entry',
          pot_id: entry.pot_id,
          entry_id: entry.id,
          priority: 50,
        });

        return reply.code(200).send({
          created: false,
          entry,
          deduped: true,
          dedupe_reason: 'asset_exists',
        });
      }

      // New asset: write encrypted blob first to get storage_path
      const mimeType = mimeTypeFromUrl(imageSourceUrl);
      const storagePath = await writeEncryptedAsset(sha256, imageBuffer);

      const asset = await insertAsset({
        sha256,
        size_bytes: imageBuffer.length,
        mime_type: mimeType,
        original_filename: imageSourceUrl
          ? new URL(imageSourceUrl).pathname.split('/').pop()?.split('?')[0] || 'image'
          : 'image',
        storage_path: storagePath,
      });

      // Create image entry
      const entry = await createImageEntry({
        pot_id: potId,
        asset_id: asset.id,
        source_url: sourceUrl || null,
        notes: notes || null,
        capture_method: captureMethod,
      });

      // Enqueue processing jobs for newly created image entries
      await enqueueJob({
        job_type: 'tag_entry',
        pot_id: entry.pot_id,
        entry_id: entry.id,
        priority: 50,
      });

      return reply.code(201).send({
        created: true,
        entry,
        deduped: false,
      });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      return reply.status(500).send({
        error: 'InternalServerError',
        message: `Failed to capture image: ${err}`,
        statusCode: 500,
        request_id: request.id,
      });
    }
  });
};

export default captureRoute;
