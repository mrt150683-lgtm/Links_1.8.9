/**
 * Phase 10: MCP Tools - Export/Import
 *
 * Tools for exporting pots to encrypted bundles and importing them.
 * Only available if Phase 9 has been implemented.
 */

import { z } from 'zod';
import { join } from 'node:path';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getConfig } from '@links/config';
import { successResponse } from '../schemas/errors.js';
import { mapErrorToResponse } from '../util/errors.js';

// Lazy import to avoid libsodium loading on server startup
// Import directly from bundle modules to bypass storage/index.ts which eagerly loads libsodium
async function getExportImportFunctions() {
  const { exportPot } = await import('@links/storage/src/bundleExporter.js');
  const { importPot } = await import('@links/storage/src/bundleImporter.js');
  return { exportPot, importPot };
}

/**
 * Tool: export_pot
 *
 * Export a pot to encrypted bundle file
 */
export const EXPORT_POT_TOOL: Tool = {
  name: 'export_pot',
  description:
    'Export a research pot to an encrypted .lynxpot bundle file for backup or sharing',
  inputSchema: {
    type: 'object',
    properties: {
      pot_id: {
        type: 'string',
        description: 'UUID of the pot to export',
      },
      passphrase: {
        type: 'string',
        description: 'Strong passphrase to encrypt the bundle (min 8 chars)',
        minLength: 8,
      },
      mode: {
        type: 'string',
        description:
          'Export mode: "private" (full data) or "public" (strips sensitive fields)',
        enum: ['private', 'public'],
        default: 'private',
      },
      bundle_name: {
        type: 'string',
        description: 'Optional custom bundle filename (without .lynxpot extension)',
      },
      passphrase_hint: {
        type: 'string',
        description: 'Optional hint to remember the passphrase',
        maxLength: 200,
      },
    },
    required: ['pot_id', 'passphrase'],
    additionalProperties: false,
  },
};

const ExportPotArgsSchema = z
  .object({
    pot_id: z.string().uuid(),
    passphrase: z.string().min(8),
    mode: z.enum(['private', 'public']).default('private'),
    bundle_name: z.string().optional(),
    passphrase_hint: z.string().max(200).optional(),
  })
  .strict();

export async function exportPotTool(args: unknown): Promise<unknown> {
  try {
    const params = ExportPotArgsSchema.parse(args);
    const config = getConfig();
    const { exportPot } = await getExportImportFunctions();

    const result = await exportPot(
      params.pot_id,
      {
        mode: params.mode,
        bundle_name: params.bundle_name,
        passphrase: params.passphrase,
        passphrase_hint: params.passphrase_hint,
      },
      config.EXPORTS_DIR,
      config.ASSETS_DIR
    );

    // Don't return passphrase in response
    return successResponse({
      bundle_path: result.bundle_path,
      bundle_sha256: result.bundle_sha256,
    });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}

/**
 * Tool: import_pot
 *
 * Import a pot from encrypted bundle file
 */
export const IMPORT_POT_TOOL: Tool = {
  name: 'import_pot',
  description:
    'Import a research pot from an encrypted .lynxpot bundle file (with ID remapping)',
  inputSchema: {
    type: 'object',
    properties: {
      bundle_path: {
        type: 'string',
        description: 'Path to the .lynxpot bundle file to import',
      },
      passphrase: {
        type: 'string',
        description: 'Passphrase to decrypt the bundle',
      },
      import_as_name: {
        type: 'string',
        description: 'Optional custom name for the imported pot',
      },
    },
    required: ['bundle_path', 'passphrase'],
    additionalProperties: false,
  },
};

const ImportPotArgsSchema = z
  .object({
    bundle_path: z.string(),
    passphrase: z.string(),
    import_as_name: z.string().optional(),
  })
  .strict();

export async function importPotTool(args: unknown): Promise<unknown> {
  try {
    const params = ImportPotArgsSchema.parse(args);
    const config = getConfig();
    const { importPot } = await getExportImportFunctions();

    // Resolve bundle path (support both absolute and relative to EXPORTS_DIR)
    let bundlePath = params.bundle_path;
    if (!bundlePath.includes('\\') && !bundlePath.includes('/')) {
      // Just a filename, resolve to EXPORTS_DIR
      bundlePath = join(config.EXPORTS_DIR, bundlePath);
    }

    const result = await importPot(
      bundlePath,
      params.passphrase,
      {
        bundle_path: bundlePath,
        passphrase: params.passphrase,
        import_as_name: params.import_as_name,
      },
      config.ASSETS_DIR
    );

    return successResponse({
      pot_id: result.pot_id,
      stats: result.stats,
    });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
