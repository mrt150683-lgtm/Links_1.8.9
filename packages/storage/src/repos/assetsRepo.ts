/**
 * Assets repository: CRUD operations for encrypted binary assets
 */

import { randomUUID, createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { getDatabase } from '../db.js';
import { logAuditEvent } from './auditRepo.js';
import type { Asset, CreateAssetInput } from '../types.js';
import { readDecryptedAsset, deleteAssetFile } from '../assetStore.js';

/**
 * Get asset by SHA-256 hash (for deduplication)
 */
export async function getBySha256(sha256: string): Promise<Asset | null> {
  const db = getDatabase();

  const row = await db
    .selectFrom('assets')
    .selectAll()
    .where('sha256', '=', sha256)
    .executeTakeFirst();

  return row ?? null;
}

/**
 * Get asset by ID
 */
export async function getAssetById(id: string): Promise<Asset | null> {
  const db = getDatabase();

  const row = await db
    .selectFrom('assets')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ?? null;
}

/**
 * Insert new asset (after encryption and storage)
 *
 * @param input - Asset metadata
 * @returns Created asset
 */
export async function insertAsset(input: CreateAssetInput): Promise<Asset> {
  const db = getDatabase();
  const now = Date.now();

  const asset: Asset = {
    id: randomUUID(),
    sha256: input.sha256,
    size_bytes: input.size_bytes,
    mime_type: input.mime_type,
    original_filename: input.original_filename ?? null,
    storage_path: input.storage_path,
    encryption_version: 1,
    created_at: now,
  };

  await db.insertInto('assets').values(asset).execute();

  // Log audit event
  await logAuditEvent({
    actor: 'user',
    action: 'upload_asset',
    metadata: {
      asset_id: asset.id,
      sha256: asset.sha256,
      size_bytes: asset.size_bytes,
      mime_type: asset.mime_type,
    },
  });

  return asset;
}

/**
 * List assets linked to entries in a specific pot
 *
 * @param potId - Pot ID to filter by
 * @returns Array of assets used in the pot
 */
export async function listAssetsByPot(potId: string): Promise<Asset[]> {
  const db = getDatabase();

  const assets = await db
    .selectFrom('assets')
    .innerJoin('entries', 'entries.asset_id', 'assets.id')
    .select([
      'assets.id',
      'assets.sha256',
      'assets.size_bytes',
      'assets.mime_type',
      'assets.original_filename',
      'assets.storage_path',
      'assets.encryption_version',
      'assets.created_at',
    ])
    .where('entries.pot_id', '=', potId)
    .distinct() // Same asset may be used in multiple entries
    .orderBy('assets.created_at', 'desc')
    .execute();

  return assets;
}

/**
 * Delete asset by ID
 *
 * Cascades to entries via FK constraint
 *
 * @param id - Asset ID
 * @returns True if asset was deleted, false if not found
 */
export async function deleteAsset(id: string): Promise<boolean> {
  const db = getDatabase();

  // Get asset metadata before deletion (for audit log)
  const asset = await getAssetById(id);
  if (!asset) {
    return false;
  }

  const result = await db.deleteFrom('assets').where('id', '=', id).executeTakeFirst();

  if (result.numDeletedRows > 0) {
    // Log audit event
    await logAuditEvent({
      actor: 'user',
      action: 'delete_asset',
      metadata: {
        asset_id: id,
        sha256: asset.sha256,
        storage_path: asset.storage_path,
      },
    });

    return true;
  }

  return false;
}

/**
 * Log dedupe event when existing asset is reused
 */
export async function logDedupeEvent(assetId: string, sha256: string): Promise<void> {
  await logAuditEvent({
    actor: 'user',
    action: 'dedupe_asset',
    metadata: {
      asset_id: assetId,
      sha256,
    },
  });
}

/**
 * Phase 12: Verify asset integrity
 * Returns assets that are missing or have hash mismatches
 */
export async function verifyAssets(): Promise<{
  total: number;
  verified: number;
  missing: string[];
  corrupted: string[];
}> {
  const db = getDatabase();

  // Get all assets
  const assets = await db.selectFrom('assets').selectAll().execute();

  const missing: string[] = [];
  const corrupted: string[] = [];
  let verified = 0;

  for (const asset of assets) {
    // Check if blob file exists
    if (!existsSync(asset.storage_path)) {
      missing.push(asset.id);
      continue;
    }

    try {
      // Read and decrypt blob
      const plainBytes = await readDecryptedAsset(asset.storage_path);

      // Compute SHA-256 of decrypted content
      const computedHash = createHash('sha256').update(plainBytes).digest('hex');

      // Verify hash matches
      if (computedHash !== asset.sha256) {
        corrupted.push(asset.id);
      } else {
        verified++;
      }
    } catch (error) {
      // Decryption failure = corrupted
      corrupted.push(asset.id);
    }
  }

  await logAuditEvent({
    actor: 'system',
    action: 'assets_verified',
    metadata: {
      total: assets.length,
      verified,
      missing: missing.length,
      corrupted: corrupted.length,
    },
  });

  return {
    total: assets.length,
    verified,
    missing,
    corrupted,
  };
}

/**
 * Phase 12: Find and optionally delete orphaned assets
 * Orphans: assets not referenced by any entry
 */
export async function cleanupOrphanedAssets(dry_run: boolean = true): Promise<{
  dry_run: boolean;
  orphans_found: number;
  orphans_deleted: number;
  orphan_ids: string[];
}> {
  const db = getDatabase();

  // Find assets not referenced by any entry
  const orphans = await db
    .selectFrom('assets')
    .selectAll()
    .leftJoin('entries', 'entries.asset_id', 'assets.id')
    .where('entries.id', 'is', null)
    .select(['assets.id', 'assets.storage_path'])
    .execute();

  const orphan_ids = orphans.map((a) => a.id);
  let orphans_deleted = 0;

  if (!dry_run && orphans.length > 0) {
    // Delete orphaned assets from DB and filesystem
    for (const orphan of orphans) {
      // Delete blob file
      try {
        await deleteAssetFile(orphan.storage_path);
      } catch (error) {
        // Continue even if blob deletion fails (might already be missing)
      }

      // Delete DB row
      await db.deleteFrom('assets').where('id', '=', orphan.id).execute();
      orphans_deleted++;
    }

    await logAuditEvent({
      actor: 'user',
      action: 'orphaned_assets_deleted',
      metadata: {
        count: orphans_deleted,
        asset_ids: orphan_ids,
      },
    });
  } else if (orphans.length > 0) {
    await logAuditEvent({
      actor: 'user',
      action: 'orphaned_assets_found',
      metadata: {
        dry_run: true,
        count: orphans.length,
        asset_ids: orphan_ids,
      },
    });
  }

  return {
    dry_run,
    orphans_found: orphans.length,
    orphans_deleted,
    orphan_ids,
  };
}
