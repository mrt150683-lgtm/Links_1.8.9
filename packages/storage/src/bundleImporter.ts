/**
 * Phase 9: Bundle Importer Service
 *
 * Imports encrypted pot bundles: verifies integrity, decrypts, remaps IDs, inserts data.
 * All operations in single transaction; rolls back on any error.
 */

import { readFile } from 'node:fs/promises';
import { getDatabase } from './db.js';
import { decryptWithPassphrase } from './bundleEncryption.js';
import { readBundleFile } from './bundleFormat.js';
import { verifyManifestHashes } from './bundleManifest.js';
import { IdRemapper } from './idRemapper.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ImportPotOptions, ImportResult } from './types.js';
import type { Manifest } from './bundleTypes.js';

/**
 * Import an encrypted pot bundle
 *
 * Workflow:
 * 1. Read and parse bundle file
 * 2. Decrypt with passphrase
 * 3. Verify manifest hashes
 * 4. Parse decrypted JSON
 * 5. Create ID remapper
 * 6. Insert all records in transaction
 * 7. Write asset blobs to store
 * 8. Return new pot ID + stats
 *
 * @param bundlePath - Path to .lynxpot bundle file
 * @param passphrase - Decryption passphrase
 * @param options - Import options (import_as_name, etc.)
 * @param assetStoreDir - Asset store directory for blob storage
 * @returns { pot_id, stats }
 * @throws Error on: wrong passphrase, tampered bundle, DB insert failure
 */
export async function importPot(
  bundlePath: string,
  passphrase: string,
  options: ImportPotOptions,
  assetStoreDir: string
): Promise<ImportResult> {
  const db = getDatabase();

  // 1. Read and parse bundle file
  const bundleBytes = await readFile(bundlePath);
  const { header, payload } = readBundleFile(bundleBytes);

  // 2. Decrypt payload
  let decryptedBuffer: Buffer;
  try {
    decryptedBuffer = await decryptWithPassphrase(payload, passphrase, header.kdf_params);
  } catch (error) {
    throw new Error(`Bundle decryption failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Parse decrypted JSON
  let bundleData: any;
  try {
    bundleData = JSON.parse(decryptedBuffer.toString('utf-8'));
  } catch (error) {
    throw new Error('Bundle contains invalid JSON');
  }

  const manifest: Manifest = bundleData.manifest;
  const payloadJson = bundleData.payload_json;
  const assetBlobs = bundleData.asset_blobs || {};

  // 3. Verify manifest integrity
  const fileDataMap = new Map<string, Buffer>();
  fileDataMap.set('payload.json', Buffer.from(JSON.stringify(payloadJson), 'utf-8'));
  for (const [assetId, base64] of Object.entries(assetBlobs)) {
    fileDataMap.set(`assets/${assetId}.blob`, Buffer.from(base64 as string));
  }

  const verifyResult = verifyManifestHashes(manifest, fileDataMap);
  if (!verifyResult.ok) {
    throw new Error(
      `Bundle integrity check failed: ${verifyResult.mismatches.join('; ')}`
    );
  }

  // 4. Create ID remapper
  const remapper = new IdRemapper(manifest.pot_id);

  // Build set of all entry IDs present in this bundle (to detect orphaned artifacts/links)
  const bundledEntryIds = new Set<string>(payloadJson.entries.map((e: any) => e.id));

  try {
    // 5. Insert all records in transaction
    return await db.transaction().execute(async (trx) => {
      // Insert pot
      const newPot = {
        id: remapper.getNewPotId(),
        name: options.import_as_name || manifest.pot_name,
        description: payloadJson.pot.description,
        security_level: payloadJson.pot.security_level,
        created_at: payloadJson.pot.created_at,
        updated_at: Date.now(),
        last_used_at: null,
      };

      await trx.insertInto('pots').values(newPot).execute();

      // Insert assets first (needed for entries with asset_id)
      for (const asset of payloadJson.assets) {
        // If the same sha256 blob already exists, reuse that record's ID
        // rather than inserting a duplicate (assets.sha256 is UNIQUE).
        const existing = await trx
          .selectFrom('assets')
          .select('id')
          .where('sha256', '=', asset.sha256)
          .executeTakeFirst();

        if (existing) {
          remapper.registerAsset(asset.id, existing.id);
        } else {
          const newAssetId = remapper.generateAsset(asset.id);
          await trx.insertInto('assets').values({
            id: newAssetId,
            sha256: asset.sha256,
            size_bytes: asset.size_bytes,
            mime_type: asset.mime_type,
            original_filename: asset.original_filename,
            storage_path: asset.storage_path,
            encryption_version: asset.encryption_version,
            created_at: asset.created_at,
          }).execute();

          // Write asset blob to store (only for new assets)
          const base64Data = assetBlobs[asset.id];
          if (base64Data) {
            const blobPath = join(assetStoreDir, `${asset.sha256}.blob`);
            const blobData = Buffer.from(base64Data as string, 'base64');
            await writeFile(blobPath, blobData);
          }
        }
      }

      // Insert entries
      for (const entry of payloadJson.entries) {
        const newEntryId = remapper.generateEntry(entry.id);
        remapper.remapEntryRecord(entry);
        entry.id = newEntryId;

        await trx.insertInto('entries').values({
          id: newEntryId,
          pot_id: remapper.getNewPotId(),
          type: entry.type,
          content_text: entry.content_text ?? '',
          content_sha256: entry.content_sha256 ?? '',
          capture_method: entry.capture_method,
          source_url: entry.source_url ?? null,
          source_title: entry.source_title ?? null,
          notes: entry.notes ?? null,
          captured_at: entry.captured_at,
          created_at: entry.created_at,
          updated_at: entry.updated_at,
          client_capture_id: entry.client_capture_id ?? null,
          source_app: entry.source_app ?? null,
          source_context_json: entry.source_context_json ?? null,
          asset_id: entry.asset_id ? remapper.remapAsset(entry.asset_id) : null,
        }).execute();
      }

      // Insert artifacts (skip orphaned ones whose entry was not included in bundle)
      for (const artifact of payloadJson.artifacts) {
        if (!bundledEntryIds.has(artifact.entry_id)) {
          continue; // Entry was deleted after export; skip artifact
        }
        const newArtifactId = remapper.generateArtifact(artifact.id);
        remapper.remapArtifactRecord(artifact);
        artifact.id = newArtifactId;

        await trx.insertInto('derived_artifacts').values({
          id: newArtifactId,
          pot_id: remapper.getNewPotId(),
          entry_id: artifact.entry_id, // already remapped by remapArtifactRecord above
          artifact_type: artifact.artifact_type,
          schema_version: artifact.schema_version,
          model_id: artifact.model_id,
          prompt_id: artifact.prompt_id,
          prompt_version: artifact.prompt_version,
          temperature: artifact.temperature,
          max_tokens: artifact.max_tokens,
          created_at: artifact.created_at,
          payload_json: artifact.payload_json,
          evidence_json: artifact.evidence_json,
        }).execute();
      }

      // Insert links (skip orphaned ones whose src or dst entry is missing from bundle)
      for (const link of payloadJson.links) {
        if (!bundledEntryIds.has(link.src_entry_id) || !bundledEntryIds.has(link.dst_entry_id)) {
          continue; // One or both entries were deleted; skip link
        }
        const newLinkId = remapper.generateLink(link.id);
        remapper.remapLinkRecord(link);
        link.id = newLinkId;

        await trx.insertInto('links').values({
          id: newLinkId,
          pot_id: remapper.getNewPotId(),
          src_entry_id: link.src_entry_id, // already remapped by remapLinkRecord above
          dst_entry_id: link.dst_entry_id, // already remapped by remapLinkRecord above
          link_type: link.link_type,
          confidence: link.confidence,
          rationale: link.rationale,
          evidence_json: link.evidence_json,
          model_id: link.model_id,
          prompt_id: link.prompt_id,
          prompt_version: link.prompt_version,
          temperature: link.temperature,
          created_at: link.created_at,
        }).execute();
      }

      // Audit events are optional - skip if empty
      // (In public mode, they're excluded entirely)

      return {
        pot_id: remapper.getNewPotId(),
        stats: {
          entries: payloadJson.entries.length,
          assets: payloadJson.assets.length,
          artifacts: payloadJson.artifacts.length,
          links: payloadJson.links.length,
        },
      };
    });
  } catch (error) {
    // Transaction automatically rolls back on error
    throw new Error(
      `Bundle import failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
