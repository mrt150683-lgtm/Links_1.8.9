/**
 * Phase 9: Bundle Export/Import API Routes
 *
 * POST /pots/:potId/export - Export pot to encrypted bundle
 * POST /pots/import - Import bundle to new pot
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getConfig } from '@links/config';
import {
  exportPot,
  importPot,
  ExportPotOptions,
  ImportPotOptions,
} from '@links/storage';
import { createLogger } from '@links/logging';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const logger = createLogger({ name: 'bundles' });

// Schemas
const ExportPayloadSchema = z.object({
  mode: z.enum(['private', 'public']).default('private'),
  bundle_name: z.string().optional(),
  passphrase: z.string().min(8),
  passphrase_hint: z.string().optional(),
});

const ImportPayloadSchema = z.object({
  bundle_path: z.string(),
  passphrase: z.string(),
  import_as_name: z.string().optional(),
});

export async function bundleRoutes(fastify: FastifyInstance) {
  const config = getConfig();

  // Ensure exports directory exists
  try {
    await mkdir(config.EXPORTS_DIR, { recursive: true });
  } catch (error) {
    logger.error({ error }, 'Failed to create exports directory');
  }

  /**
   * POST /pots/:potId/export
   *
   * Export pot to encrypted bundle
   */
  fastify.post<{ Params: { potId: string } }>(
    '/pots/:potId/export',
    async (request: FastifyRequest<{ Params: { potId: string } }>, reply) => {
      const requestId = request.id;

      try {
        // Parse and validate request body (without logging passphrase)
        const body = request.body as any;
        const validation = ExportPayloadSchema.safeParse(body);
        if (!validation.success) {
          return reply.status(400).send({
            ok: false,
            error: 'Invalid request body',
            details: validation.error.format(),
          });
        }

        const options: ExportPotOptions = validation.data;
        const { potId } = request.params;

        logger.info(
          { requestId, potId, mode: options.mode },
          'Export requested'
        );

        // Export pot
        const result = await exportPot(
          potId,
          options,
          config.EXPORTS_DIR,
          config.ASSETS_DIR
        );

        logger.info(
          { requestId, potId, bundlePath: result.bundle_path },
          'Export completed'
        );

        return reply.status(200).send({
          ok: true,
          bundle_path: result.bundle_path,
          bundle_sha256: result.bundle_sha256,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(
          { requestId, error: message },
          'Export failed'
        );

        return reply.status(400).send({
          ok: false,
          error: message,
        });
      }
    }
  );

  /**
   * POST /pots/import
   *
   * Import bundle to new pot
   */
  fastify.post(
    '/pots/import',
    async (request: FastifyRequest, reply) => {
      const requestId = request.id;

      try {
        // Parse and validate request body (without logging passphrase)
        const body = request.body as any;
        const validation = ImportPayloadSchema.safeParse(body);
        if (!validation.success) {
          return reply.status(400).send({
            ok: false,
            error: 'Invalid request body',
            details: validation.error.format(),
          });
        }

        const options: ImportPotOptions = validation.data;

        logger.info(
          { requestId, bundlePath: options.bundle_path },
          'Import requested'
        );

        // Import pot
        const result = await importPot(
          options.bundle_path,
          options.passphrase,
          options,
          config.ASSETS_DIR
        );

        logger.info(
          {
            requestId,
            potId: result.pot_id,
            stats: result.stats,
          },
          'Import completed'
        );

        return reply.status(201).send({
          ok: true,
          pot_id: result.pot_id,
          stats: result.stats,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(
          { requestId, error: message },
          'Import failed'
        );

        return reply.status(400).send({
          ok: false,
          error: message,
        });
      }
    }
  );
}
