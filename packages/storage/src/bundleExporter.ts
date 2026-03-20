/**
 * Phase 9: Bundle Exporter Service
 *
 * Orchestrates pot export: fetches data, creates manifest, encrypts, writes bundle.
 * Supports private (full) and public (stripped) modes.
 *
 * Bundle format:
 * [header_length: 4 bytes] [header_json] [encrypted_payload]
 * The encrypted payload contains all pot data (JSON) + asset blobs as Base64
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDatabase } from './db.js';
import {
  createManifestEntry,
  buildManifest,
  hashData,
} from './bundleManifest.js';
import {
  encryptWithPassphrase,
  generateKdfParams,
  KdfParams,
} from './bundleEncryption.js';
import {
  writeBundleFile,
  createBundleHeader,
} from './bundleFormat.js';
import {
  createTempDir,
  cleanupTempDir,
  ensureTempSubdir,
  withTempDir,
} from './bundleTemp.js';
import {
  transformExportedDataToPublic,
} from './publicModeTransform.js';
import type { ExportPotOptions, ExportResult } from './types.js';
import type { Manifest } from './bundleTypes.js';
// Using any for exported types to avoid circular dependency
// These are validated by core schemas on API boundaries
type ExportedData = any;
type ExportedPot = any;
type ExportedEntry = any;
type ExportedAsset = any;
type ExportedArtifact = any;
type ExportedLink = any;
type ExportedAuditEvent = any;

/**
 * Internal structure for bundle contents during export
 */
interface BundleContents {
  manifest: Manifest;
  pot: ExportedPot;
  entries: ExportedEntry[];
  assets: ExportedAsset[];
  artifacts: ExportedArtifact[];
  links: ExportedLink[];
  audit_events: ExportedAuditEvent[];
}

/**
 * Fetch all data for a pot from database
 *
 * @param potId - Pot ID to export
 * @returns Exported data
 * @throws Error if pot not found
 */
async function fetchPotData(potId: string): Promise<BundleContents> {
  const db = getDatabase();

  // Fetch pot
  const pot = await db.selectFrom('pots').selectAll().where('id', '=', potId).executeTakeFirst();
  if (!pot) {
    throw new Error(`Pot not found: ${potId}`);
  }

  // Fetch entries
  const entries = await db.selectFrom('entries').selectAll().where('pot_id', '=', potId).execute();

  // Fetch assets referenced by entries
  const assetIds = new Set(entries.map(e => e.asset_id).filter(Boolean));
  const assets = assetIds.size > 0
    ? await db.selectFrom('assets').selectAll().where('id', 'in', Array.from(assetIds)).execute()
    : [];

  // Fetch artifacts
  const artifacts = await db
    .selectFrom('derived_artifacts')
    .selectAll()
    .where('pot_id', '=', potId)
    .execute();

  // Fetch links
  const links = await db.selectFrom('links').selectAll().where('pot_id', '=', potId).execute();

  // Fetch audit events
  const audit_events = await db
    .selectFrom('audit_events')
    .selectAll()
    .where('pot_id', '=', potId)
    .execute();

  // Build manifest
  const manifest = buildManifest({
    pot_id: pot.id,
    pot_name: pot.name,
    export_mode: 'private',
    counts: {
      entries: entries.length,
      assets: assets.length,
      artifacts: artifacts.length,
      links: links.length,
      audit_events: audit_events.length,
    },
    entries: [], // Will be populated after file creation
  });

  return {
    manifest,
    pot: pot as ExportedPot,
    entries: entries as ExportedEntry[],
    assets: assets as ExportedAsset[],
    artifacts: artifacts as ExportedArtifact[],
    links: links as ExportedLink[],
    audit_events: audit_events as ExportedAuditEvent[],
  };
}

/**
 * Create JSON payload from pot data
 *
 * @param data - Pot data to export
 * @returns JSON buffer and file map for manifest
 */
async function createPayloadJson(
  data: BundleContents
): Promise<{ payloadJson: string; fileMap: Map<string, Buffer> }> {
  const fileMap = new Map<string, Buffer>();

  // Create individual JSON objects
  const files: Record<string, any> = {
    'manifest.json': data.manifest,
    'pot.json': data.pot,
    'data/entries.json': data.entries,
    'data/assets.json': data.assets,
    'data/artifacts.json': data.artifacts,
    'data/links.json': data.links,
    'data/audit_events.json': data.audit_events,
  };

  // Create manifest file entries (before manifest is finalized)
  for (const [path, obj] of Object.entries(files)) {
    if (path !== 'manifest.json') {
      const content = JSON.stringify(obj);
      const buf = Buffer.from(content, 'utf-8');
      fileMap.set(path, buf);
    }
  }

  const payloadJson = JSON.stringify({
    version: 1,
    pot: data.pot,
    entries: data.entries,
    assets: data.assets,
    artifacts: data.artifacts,
    links: data.links,
    audit_events: data.audit_events,
  });

  return { payloadJson, fileMap };
}

/**
 * Read asset blob files and encode as Base64
 *
 * @param assetStoreDir - Asset store directory path
 * @param assets - Asset records to include
 * @returns Map of asset ID to Base64-encoded blob content
 */
async function encodeAssetBlobs(
  assetStoreDir: string,
  assets: ExportedAsset[]
): Promise<Map<string, string>> {
  const { readFile } = await import('node:fs/promises');
  const assetBlobMap = new Map<string, string>();

  for (const asset of assets) {
    const blobPath = join(assetStoreDir, `${asset.sha256}.blob`);
    try {
      const blobData = await readFile(blobPath);
      const base64 = blobData.toString('base64');
      assetBlobMap.set(asset.id, base64);
    } catch (error) {
      // Warn but don't fail if asset blob missing
      console.warn(`Asset blob not found or unreadable: ${blobPath}`);
    }
  }

  return assetBlobMap;
}

/**
 * Create and encrypt a pot export bundle
 *
 * Workflow:
 * 1. Fetch pot data from database
 * 2. Apply public mode transform if needed
 * 3. Create JSON payload with all data
 * 4. Encode asset blobs as Base64
 * 5. Create manifest with hashes
 * 6. Encrypt payload with KDF + AEAD
 * 7. Write bundle file (header + encrypted payload)
 *
 * @param potId - Pot ID to export
 * @param options - Export options (mode, passphrase, etc.)
 * @param outputDir - Directory to write bundle to
 * @param assetStoreDir - Asset store directory path
 * @returns { bundlePath, bundleSha256 }
 */
export async function exportPot(
  potId: string,
  options: ExportPotOptions,
  outputDir: string,
  assetStoreDir: string
): Promise<ExportResult> {
  return withTempDir(async (tmpDir) => {
    // 1. Fetch pot data from database
    const bundleData = await fetchPotData(potId);

    // 2. Apply public mode transform if needed
    let exportData = bundleData;
    if (options.mode === 'public') {
      const transformed = transformExportedDataToPublic({
        pot: bundleData.pot,
        entries: bundleData.entries,
        assets: bundleData.assets,
        artifacts: bundleData.artifacts,
        links: bundleData.links,
        audit_events: bundleData.audit_events,
      });

      exportData = {
        ...bundleData,
        ...transformed,
      };
    }

    // 3. Create JSON payload
    const { payloadJson } = await createPayloadJson(exportData);
    const payloadBuffer = Buffer.from(payloadJson, 'utf-8');

    // 4. Encode asset blobs
    const assetBlobs = await encodeAssetBlobs(assetStoreDir, exportData.assets);

    // 5. Create manifest
    const manifestFiles = [
      createManifestEntry('payload.json', payloadBuffer),
    ];

    // Add asset blob hashes to manifest
    for (const [assetId, base64Data] of assetBlobs.entries()) {
      const blobBuf = Buffer.from(base64Data);
      manifestFiles.push(createManifestEntry(`assets/${assetId}.blob`, blobBuf));
    }

    const manifest = buildManifest({
      pot_id: exportData.pot.id,
      pot_name: exportData.pot.name,
      export_mode: options.mode,
      counts: {
        entries: exportData.entries.length,
        assets: exportData.assets.length,
        artifacts: exportData.artifacts.length,
        links: exportData.links.length,
        audit_events: exportData.audit_events.length,
      },
      entries: manifestFiles,
    });

    // 6. Create combined payload (manifest + data + assets)
    const combinedPayload = {
      manifest,
      payload_json: JSON.parse(payloadJson),
      asset_blobs: Object.fromEntries(assetBlobs),
    };

    const combinedBuffer = Buffer.from(JSON.stringify(combinedPayload), 'utf-8');

    // 7. Encrypt with passphrase
    const { blob: encryptedPayload, params: kdfParams } = await encryptWithPassphrase(
      combinedBuffer,
      options.passphrase
    );

    // 8. Create bundle header
    const header = createBundleHeader({
      cipher: 'xchacha20-poly1305',
      kdf_params: {
        salt: kdfParams.salt,
        ops_limit: kdfParams.ops_limit,
        mem_limit: kdfParams.mem_limit,
      },
      nonce: '', // XChaCha20-Poly1305 nonce is prepended by encryptBlob
      encrypted_payload_length: encryptedPayload.length,
      export_mode: options.mode,
    });

    // 9. Create final bundle file
    const bundleBytes = writeBundleFile(header, encryptedPayload);
    const bundleSha256 = hashData(bundleBytes);

    // 10. Write bundle to output directory
    const bundleName =
      options.bundle_name ||
      `pot_${exportData.pot.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.lynxpot`;

    const bundlePath = join(outputDir, bundleName);
    await writeFile(bundlePath, bundleBytes);

    return {
      bundle_path: bundlePath,
      bundle_sha256: bundleSha256,
    };
  });
}
