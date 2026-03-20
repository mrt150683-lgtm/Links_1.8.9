/**
 * Phase 11: Extension Capture Routes
 *
 * Endpoints for Chrome extension text and page capture.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import type { MultipartFile } from '@fastify/multipart';
import {
  createTextEntryIdempotent,
  createLinkEntry,
  getBySha256,
  insertAsset,
  writeEncryptedAsset,
  createImageEntry,
  enqueueJob,
  type CaptureResult,
} from '@links/storage';
import { extAuthMiddleware } from '../../middleware/extAuth.js';
import { rateLimitExtMiddleware } from '../../middleware/rateLimitExt.js';
import { createLogger } from '@links/logging';
import {
  ExtCaptureSelectionRequestSchema,
  ExtCapturePageRequestSchema,
  type ExtCaptureSelectionRequest,
  type ExtCapturePageRequest,
} from '@links/core';

const logger = createLogger({ name: 'ext:capture' });

export default async function extCaptureRoutes(fastify: FastifyInstance) {
  /**
   * POST /ext/capture/selection
   *
   * Capture selected text from web page
   * Idempotent via client_capture_id
   */
  fastify.post(
    '/capture/selection',
    {
      preHandler: [rateLimitExtMiddleware, extAuthMiddleware],
    },
    async (request: FastifyRequest) => {
      const requestId = request.id;

      // Validate request body
      const validationResult = ExtCaptureSelectionRequestSchema.safeParse(request.body);
      if (!validationResult.success) {
        const error: any = new Error('Invalid request data');
        error.statusCode = 400;
        error.validationErrors = validationResult.error.errors;
        throw error;
      }
      const body = validationResult.data;

      logger.info(
        {
          requestId,
          pot_id: body.pot_id,
          text_length: body.text.length,
          has_client_capture_id: !!body.client_capture_id,
        },
        'Extension selection capture requested'
      );

      // Create text entry with idempotency
      const result: CaptureResult = await createTextEntryIdempotent({
        pot_id: body.pot_id,
        content_text: body.text,
        capture_method: body.capture_method,
        captured_at: body.captured_at,
        source_url: body.source_url,
        source_title: body.source_title,
        notes: body.notes,
        client_capture_id: body.client_capture_id,
        source_app: body.source_app ?? 'chrome_extension',
        source_context: body.source_context,
      });

      logger.info(
        {
          requestId,
          entry_id: result.entry.id,
          created: result.created,
          deduped: result.deduped,
          dedupe_reason: result.dedupe_reason,
        },
        'Extension selection capture completed'
      );

      // Enqueue processing jobs for newly created text entries
      if (result.created) {
        await enqueueJob({
          job_type: 'tag_entry',
          pot_id: result.entry.pot_id,
          entry_id: result.entry.id,
          priority: 50,
        });
        await enqueueJob({
          job_type: 'extract_entities',
          pot_id: result.entry.pot_id,
          entry_id: result.entry.id,
          priority: 50,
        });
        await enqueueJob({
          job_type: 'summarize_entry',
          pot_id: result.entry.pot_id,
          entry_id: result.entry.id,
          priority: 40,
        });
        logger.info(
          { requestId, entry_id: result.entry.id },
          'Enqueued tag_entry, extract_entities, summarize_entry jobs for extension selection'
        );
      }

      return {
        created: result.created,
        entry: result.entry,
        deduped: result.deduped,
        dedupe_reason: result.dedupe_reason,
      };
    }
  );

  /**
   * POST /ext/capture/page
   *
   * Capture current page as link entry with optional excerpt
   * Idempotent via client_capture_id
   */
  fastify.post(
    '/capture/page',
    {
      preHandler: [rateLimitExtMiddleware, extAuthMiddleware],
    },
    async (request: FastifyRequest) => {
      const requestId = request.id;

      // Validate request body
      const validationResult = ExtCapturePageRequestSchema.safeParse(request.body);
      if (!validationResult.success) {
        const error: any = new Error('Invalid request data');
        error.statusCode = 400;
        error.validationErrors = validationResult.error.errors;
        throw error;
      }
      const body = validationResult.data;

      logger.info(
        {
          requestId,
          pot_id: body.pot_id,
          link_url_domain: new URL(body.link_url).hostname,
          has_excerpt: !!body.content_text,
          has_client_capture_id: !!body.client_capture_id,
        },
        'Extension page capture requested'
      );

      // Check idempotency first if client_capture_id provided
      if (body.client_capture_id) {
        const { getDatabase } = await import('@links/storage');
        const db = getDatabase();

        const existing = await db
          .selectFrom('entries')
          .selectAll()
          .where('client_capture_id', '=', body.client_capture_id)
          .executeTakeFirst();

        if (existing) {
          logger.info(
            {
              requestId,
              entry_id: existing.id,
              client_capture_id: body.client_capture_id,
            },
            'Extension page capture deduplicated (client_capture_id)'
          );

          // Map row to Entry type
          const entry = {
            id: existing.id,
            pot_id: existing.pot_id,
            type: existing.type as 'text' | 'image' | 'doc' | 'link',
            content_text: existing.content_text || null,
            content_sha256: existing.content_sha256 || null,
            capture_method: existing.capture_method,
            source_url: existing.source_url,
            source_title: existing.source_title,
            notes: existing.notes,
            captured_at: existing.captured_at,
            created_at: existing.created_at,
            updated_at: existing.updated_at,
            client_capture_id: existing.client_capture_id,
            source_app: existing.source_app,
            source_context: existing.source_context_json
              ? JSON.parse(existing.source_context_json)
              : null,
            asset_id: existing.asset_id,
            link_url: existing.link_url,
            link_title: existing.link_title,
          };

          return {
            created: false,
            entry,
            deduped: true,
            dedupe_reason: 'client_capture_id' as const,
          };
        }
      }

      // Create link entry
      const entry = await createLinkEntry({
        pot_id: body.pot_id,
        link_url: body.link_url,
        link_title: body.link_title,
        content_text: body.content_text,
        capture_method: body.capture_method,
        captured_at: body.captured_at,
        client_capture_id: body.client_capture_id,
        source_app: body.source_app ?? 'chrome_extension',
        source_context: body.source_context,
      });

      logger.info(
        {
          requestId,
          entry_id: entry.id,
          link_url_domain: new URL(body.link_url).hostname,
        },
        'Extension page capture completed'
      );

      return {
        created: true,
        entry,
        deduped: false,
      };
    }
  );

  /**
   * POST /ext/capture/image
   *
   * Upload image from extension (screenshot, copied image, etc.)
   * Multipart upload with asset deduplication
   */
  fastify.post(
    '/capture/image',
    {
      preHandler: [rateLimitExtMiddleware, extAuthMiddleware],
    },
    async (request: FastifyRequest) => {
      const requestId = request.id;

      // Get multipart data
      const data = await request.file({
        limits: {
          fileSize: 25 * 1024 * 1024, // 25MB limit for extension uploads
        },
      });

      if (!data) {
        return {
          ok: false,
          error: 'No file provided',
        };
      }

      // Extract metadata from fields
      const potId = (data.fields as any).pot_id?.value;
      const captureMethod = (data.fields as any).capture_method?.value || 'extension_image';
      const sourceUrl = (data.fields as any).source_url?.value;
      const sourceTitle = (data.fields as any).source_title?.value;
      const notes = (data.fields as any).notes?.value;
      const clientCaptureId = (data.fields as any).client_capture_id?.value;

      if (!potId) {
        return {
          ok: false,
          error: 'pot_id is required',
        };
      }

      logger.info(
        {
          requestId,
          pot_id: potId,
          filename: data.filename,
          mimetype: data.mimetype,
          has_client_capture_id: !!clientCaptureId,
        },
        'Extension image capture requested'
      );

      // Read file to buffer
      const buffer = await data.toBuffer();

      // Compute SHA-256
      const sha256 = createHash('sha256').update(buffer).digest('hex');

      logger.info(
        {
          requestId,
          sha256,
          size_bytes: buffer.length,
        },
        'Image hash computed'
      );

      // Check for existing asset (dedupe)
      let asset = await getBySha256(sha256);
      let assetCreated = false;

      if (!asset) {
        // Encrypt and write asset blob
        const storagePath = await writeEncryptedAsset(sha256, buffer);

        // Create new asset DB row
        asset = await insertAsset({
          sha256,
          size_bytes: buffer.length,
          mime_type: data.mimetype,
          original_filename: data.filename,
          storage_path: storagePath,
        });
        assetCreated = true;

        logger.info(
          {
            requestId,
            asset_id: asset.id,
            sha256,
          },
          'New asset created'
        );
      } else {
        logger.info(
          {
            requestId,
            asset_id: asset.id,
            sha256,
          },
          'Asset deduplicated (existing asset reused)'
        );
      }

      // Check idempotency for entry creation
      if (clientCaptureId) {
        const { getDatabase } = await import('@links/storage');
        const db = getDatabase();

        const existing = await db
          .selectFrom('entries')
          .selectAll()
          .where('client_capture_id', '=', clientCaptureId)
          .executeTakeFirst();

        if (existing) {
          logger.info(
            {
              requestId,
              entry_id: existing.id,
              client_capture_id: clientCaptureId,
            },
            'Extension image capture deduplicated (client_capture_id)'
          );

          // Map row to Entry type
          const entry = {
            id: existing.id,
            pot_id: existing.pot_id,
            type: existing.type as 'text' | 'image' | 'doc' | 'link',
            content_text: existing.content_text || null,
            content_sha256: existing.content_sha256 || null,
            capture_method: existing.capture_method,
            source_url: existing.source_url,
            source_title: existing.source_title,
            notes: existing.notes,
            captured_at: existing.captured_at,
            created_at: existing.created_at,
            updated_at: existing.updated_at,
            client_capture_id: existing.client_capture_id,
            source_app: existing.source_app,
            source_context: existing.source_context_json
              ? JSON.parse(existing.source_context_json)
              : null,
            asset_id: existing.asset_id,
            link_url: existing.link_url,
            link_title: existing.link_title,
          };

          return {
            created: false,
            entry,
            deduped: true,
            dedupe_reason: 'client_capture_id' as const,
            asset_deduped: !assetCreated,
          };
        }
      }

      // Create image entry
      const entry = await createImageEntry({
        pot_id: potId,
        asset_id: asset.id,
        capture_method: captureMethod,
        source_url: sourceUrl,
        source_title: sourceTitle,
        notes: notes,
        client_capture_id: clientCaptureId,
      });

      logger.info(
        {
          requestId,
          entry_id: entry.id,
          asset_id: asset.id,
        },
        'Extension image capture completed'
      );

      // Enqueue tagging job for the new image entry
      await enqueueJob({
        job_type: 'tag_entry',
        pot_id: potId,
        entry_id: entry.id,
        priority: 50,
      });
      logger.info(
        { requestId, entry_id: entry.id },
        'Enqueued tag_entry job for extension image capture'
      );

      return {
        created: true,
        entry,
        deduped: false,
        asset_deduped: !assetCreated,
      };
    }
  );
}
