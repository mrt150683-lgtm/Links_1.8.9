import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import { hashText } from '../canonicalize.js';
import { logAuditEvent, logAuditEventInTransaction } from './auditRepo.js';
import type {
  Entry,
  CreateTextEntryInput,
  CreateTextEntryIdempotentInput,
  CreateAssetEntryInput,
  CreateLinkEntryInput,
  CaptureResult,
  ListEntriesFilters,
  EntriesTable,
  EntryWithAsset,
} from '../types.js';

/**
 * Map database row to Entry domain object
 */
function mapRowToEntry(row: any): Entry {
  return {
    id: row.id,
    pot_id: row.pot_id,
    type: row.type,
    // Phase 4: Convert empty string back to null for asset-backed entries (SQLite workaround)
    content_text: row.content_text === '' ? null : (row.content_text ?? null),
    content_sha256: row.content_sha256 === '' ? null : (row.content_sha256 ?? null),
    capture_method: row.capture_method,
    source_url: row.source_url,
    source_title: row.source_title,
    notes: row.notes,
    captured_at: row.captured_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    client_capture_id: row.client_capture_id,
    source_app: row.source_app,
    source_context: row.source_context_json ? JSON.parse(row.source_context_json) : null,
    asset_id: row.asset_id ?? null, // Phase 4
    // Phase 11: link-specific fields
    link_url: row.link_url ?? null,
    link_title: row.link_title ?? null,
  };
}

/**
 * Create a new text entry
 */
export async function createTextEntry(input: CreateTextEntryInput): Promise<Entry> {
  const db = getDatabase();
  const now = Date.now();

  // Compute canonical hash
  const content_sha256 = hashText(input.content_text);

  const entry: Entry = {
    id: randomUUID(),
    pot_id: input.pot_id,
    type: 'text',
    content_text: input.content_text,
    content_sha256,
    capture_method: input.capture_method,
    source_url: input.source_url ?? null,
    source_title: input.source_title ?? null,
    notes: input.notes ?? null,
    captured_at: input.captured_at ?? now,
    created_at: now,
    updated_at: now,
    // Phase 3 fields
    client_capture_id: null,
    source_app: null,
    source_context: null,
    // Phase 4 fields
    asset_id: null,
    // Phase 11 fields
    link_url: null,
    link_title: null,
  };

  // Map to database row format (exclude source_context, add source_context_json)
  const { source_context, ...entryWithoutContext } = entry;
  const dbEntry = {
    ...entryWithoutContext,
    source_context_json: source_context ? JSON.stringify(source_context) : null,
  };

  await db.insertInto('entries').values(dbEntry as any).execute();

  // Log audit event
  await logAuditEvent({
    actor: 'user',
    action: 'create_entry',
    pot_id: entry.pot_id,
    entry_id: entry.id,
    metadata: {
      type: entry.type,
      capture_method: entry.capture_method,
      content_length: entry.content_text?.length ?? 0,
    },
  });

  return entry;
}

/**
 * Get an entry by ID
 */
export async function getEntryById(id: string): Promise<Entry | null> {
  const db = getDatabase();

  const row = await db.selectFrom('entries').selectAll().where('id', '=', id).executeTakeFirst();

  return row ? mapRowToEntry(row) : null;
}

/**
 * List entries with filters
 */
export async function listEntries(filters: ListEntriesFilters): Promise<Entry[]> {
  const db = getDatabase();

  let query = db
    .selectFrom('entries')
    .selectAll()
    .where('pot_id', '=', filters.pot_id)
    .orderBy('captured_at', 'desc');

  if (filters.capture_method) {
    query = query.where('capture_method', '=', filters.capture_method);
  }

  if (filters.source_url) {
    query = query.where('source_url', '=', filters.source_url);
  }

  const limit = filters.limit ?? 100;
  const offset = filters.offset ?? 0;

  query = query.limit(limit).offset(offset);

  const rows = await query.execute();

  return rows.map(mapRowToEntry);
}

/**
 * Delete an entry
 */
export async function deleteEntry(id: string): Promise<boolean> {
  const db = getDatabase();

  // Check if entry exists
  const existing = await getEntryById(id);
  if (!existing) {
    return false;
  }

  // Log audit event before deletion
  await logAuditEvent({
    actor: 'user',
    action: 'delete_entry',
    pot_id: existing.pot_id,
    entry_id: id,
    metadata: {
      type: existing.type,
      capture_method: existing.capture_method,
    },
  });

  const result = await db.deleteFrom('entries').where('id', '=', id).executeTakeFirst();

  return result.numDeletedRows > 0;
}

/**
 * Count entries in a pot
 */
export async function countEntriesByPot(potId: string): Promise<number> {
  const db = getDatabase();

  const result = await db
    .selectFrom('entries')
    .select((eb) => eb.fn.count<number>('id').as('count'))
    .where('pot_id', '=', potId)
    .executeTakeFirst();

  return result?.count ?? 0;
}

/**
 * Find entries by content hash (detect duplicates)
 */
export async function findEntriesByHash(
  potId: string,
  contentSha256: string
): Promise<Entry[]> {
  const db = getDatabase();

  const rows = await db
    .selectFrom('entries')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('content_sha256', '=', contentSha256)
    .orderBy('created_at', 'desc')
    .execute();

  return rows.map(mapRowToEntry);
}

/**
 * Phase 3: Create text entry with idempotency checks
 */
export async function createTextEntryIdempotent(
  input: CreateTextEntryIdempotentInput
): Promise<CaptureResult> {
  const db = getDatabase();

  // Validate client_capture_id length if provided
  if (input.client_capture_id && input.client_capture_id.length > 128) {
    throw new Error('client_capture_id must be at most 128 characters');
  }

  // Compute canonical hash
  const content_sha256 = hashText(input.content_text);

  // Use transaction for atomicity
  return db.transaction().execute(async (trx) => {
    const now = Date.now();

    // Check for duplicate by client_capture_id (primary idempotency)
    if (input.client_capture_id) {
      const existing = await trx
        .selectFrom('entries')
        .selectAll()
        .where('pot_id', '=', input.pot_id)
        .where('client_capture_id', '=', input.client_capture_id)
        .executeTakeFirst();

      if (existing) {
        // Duplicate found - return existing entry
        await logAuditEventInTransaction(trx, {
          actor: 'user',
          action: 'capture_text_deduped',
          pot_id: input.pot_id,
          entry_id: existing.id,
          metadata: {
            dedupe_reason: 'client_capture_id',
            client_capture_id: input.client_capture_id,
          },
        });

        return {
          created: false,
          entry: mapRowToEntry(existing),
          deduped: true,
          dedupe_reason: 'client_capture_id',
        };
      }
    }

    // Check for duplicate by hash window (60-second fallback)
    if (!input.client_capture_id) {
      const hashWindowStart = now - 60_000; // 60 seconds ago

      const existing = await trx
        .selectFrom('entries')
        .selectAll()
        .where('pot_id', '=', input.pot_id)
        .where('content_sha256', '=', content_sha256)
        .where('created_at', '>=', hashWindowStart)
        .orderBy('created_at', 'desc')
        .executeTakeFirst();

      if (existing) {
        // Duplicate found - return existing entry
        await logAuditEventInTransaction(trx, {
          actor: 'user',
          action: 'capture_text_deduped',
          pot_id: input.pot_id,
          entry_id: existing.id,
          metadata: {
            dedupe_reason: 'hash_window',
            content_sha256,
          },
        });

        return {
          created: false,
          entry: mapRowToEntry(existing),
          deduped: true,
          dedupe_reason: 'hash_window',
        };
      }
    }

    // No duplicate - create new entry
    const entry: Entry = {
      id: randomUUID(),
      pot_id: input.pot_id,
      type: 'text',
      content_text: input.content_text,
      content_sha256,
      capture_method: input.capture_method,
      source_url: input.source_url ?? null,
      source_title: input.source_title ?? null,
      notes: input.notes ?? null,
      captured_at: input.captured_at ?? now,
      created_at: now,
      updated_at: now,
      client_capture_id: input.client_capture_id ?? null,
      source_app: input.source_app ?? null,
      source_context: input.source_context ?? null,
      asset_id: null, // Phase 4
      link_url: null, // Phase 11
      link_title: null, // Phase 11
    };

    // Convert source_context to JSON for database (exclude source_context, add source_context_json)
    const { source_context, ...entryWithoutContext } = entry;
    const dbEntry = {
      ...entryWithoutContext,
      source_context_json: source_context ? JSON.stringify(source_context) : null,
    };

    await trx.insertInto('entries').values(dbEntry as any).execute();

    // Update pot's last_used_at timestamp
    await trx
      .updateTable('pots')
      .set({ last_used_at: now })
      .where('id', '=', input.pot_id)
      .execute();

    // Log audit events
    await logAuditEventInTransaction(trx, {
      actor: 'user',
      action: 'capture_text_created',
      pot_id: entry.pot_id,
      entry_id: entry.id,
      metadata: {
        type: entry.type,
        capture_method: entry.capture_method,
        content_length: entry.content_text?.length ?? 0,
        has_client_capture_id: !!entry.client_capture_id,
      },
    });

    await logAuditEventInTransaction(trx, {
      actor: 'system',
      action: 'pot_last_used_updated',
      pot_id: input.pot_id,
      metadata: { timestamp: now },
    });

    return {
      created: true,
      entry,
      deduped: false,
    };
  });
}

/**
 * Phase 4: Create image entry (asset-backed)
 *
 * @throws Error if asset_id doesn't exist
 */
export async function createImageEntry(input: CreateAssetEntryInput): Promise<Entry> {
  const db = getDatabase();

  // Verify asset exists
  const assetExists = await db
    .selectFrom('assets')
    .select('id')
    .where('id', '=', input.asset_id)
    .executeTakeFirst();

  if (!assetExists) {
    throw new Error(`Asset not found: ${input.asset_id}`);
  }

  return db.transaction().execute(async (trx) => {
    const now = Date.now();

    const entry: Entry = {
      id: randomUUID(),
      pot_id: input.pot_id,
      type: 'image',
      content_text: null, // No text content for image entries
      content_sha256: null,
      capture_method: input.capture_method,
      source_url: input.source_url ?? null,
      source_title: input.source_title ?? null,
      notes: input.notes ?? null,
      captured_at: input.captured_at ?? now,
      created_at: now,
      updated_at: now,
      client_capture_id: input.client_capture_id ?? null, // Phase 11
      source_app: null,
      source_context: null,
      asset_id: input.asset_id,
      link_url: null, // Phase 11
      link_title: null, // Phase 11
    };

    // Map to database row format
    // SQLite limitation: content_text and content_sha256 are NOT NULL at DB level
    // Workaround: use empty string for asset-backed entries
    const dbEntry = {
      id: entry.id,
      pot_id: entry.pot_id,
      type: entry.type,
      content_text: '', // Workaround for NOT NULL constraint
      content_sha256: '', // Workaround for NOT NULL constraint
      capture_method: entry.capture_method,
      source_url: entry.source_url,
      source_title: entry.source_title,
      notes: entry.notes,
      captured_at: entry.captured_at,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      client_capture_id: entry.client_capture_id,
      source_app: entry.source_app,
      source_context_json: null,
      asset_id: entry.asset_id,
    };

    await trx.insertInto('entries').values(dbEntry).execute();

    // Update pot's last_used_at timestamp
    await trx
      .updateTable('pots')
      .set({ last_used_at: now })
      .where('id', '=', input.pot_id)
      .execute();

    // Log audit events
    await logAuditEventInTransaction(trx, {
      actor: 'user',
      action: 'create_image_entry',
      pot_id: entry.pot_id,
      entry_id: entry.id,
      metadata: {
        type: entry.type,
        capture_method: entry.capture_method,
        asset_id: entry.asset_id,
      },
    });

    return entry;
  });
}

/**
 * Phase 4: Create doc entry (asset-backed)
 *
 * @throws Error if asset_id doesn't exist
 */
export async function createDocEntry(input: CreateAssetEntryInput): Promise<Entry> {
  const db = getDatabase();

  // Verify asset exists
  const assetExists = await db
    .selectFrom('assets')
    .select('id')
    .where('id', '=', input.asset_id)
    .executeTakeFirst();

  if (!assetExists) {
    throw new Error(`Asset not found: ${input.asset_id}`);
  }

  return db.transaction().execute(async (trx) => {
    const now = Date.now();

    const entry: Entry = {
      id: randomUUID(),
      pot_id: input.pot_id,
      type: 'doc',
      content_text: null, // No text content for doc entries
      content_sha256: null,
      capture_method: input.capture_method,
      source_url: input.source_url ?? null,
      source_title: input.source_title ?? null,
      notes: input.notes ?? null,
      captured_at: input.captured_at ?? now,
      created_at: now,
      updated_at: now,
      client_capture_id: input.client_capture_id ?? null, // Phase 11
      source_app: null,
      source_context: null,
      asset_id: input.asset_id,
      link_url: null, // Phase 11
      link_title: null, // Phase 11
    };

    // Map to database row format
    // SQLite limitation: content_text and content_sha256 are NOT NULL at DB level
    // Workaround: use empty string for asset-backed entries
    const dbEntry = {
      id: entry.id,
      pot_id: entry.pot_id,
      type: entry.type,
      content_text: '', // Workaround for NOT NULL constraint
      content_sha256: '', // Workaround for NOT NULL constraint
      capture_method: entry.capture_method,
      source_url: entry.source_url,
      source_title: entry.source_title,
      notes: entry.notes,
      captured_at: entry.captured_at,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      client_capture_id: entry.client_capture_id,
      source_app: entry.source_app,
      source_context_json: null,
      asset_id: entry.asset_id,
    };

    await trx.insertInto('entries').values(dbEntry).execute();

    // Update pot's last_used_at timestamp
    await trx
      .updateTable('pots')
      .set({ last_used_at: now })
      .where('id', '=', input.pot_id)
      .execute();

    // Log audit events
    await logAuditEventInTransaction(trx, {
      actor: 'user',
      action: 'create_doc_entry',
      pot_id: entry.pot_id,
      entry_id: entry.id,
      metadata: {
        type: entry.type,
        capture_method: entry.capture_method,
        asset_id: entry.asset_id,
      },
    });

    return entry;
  });
}

/**
 * Audio processing: Create audio entry (asset-backed)
 *
 * @throws Error if asset_id doesn't exist
 */
export async function createAudioEntry(input: CreateAssetEntryInput): Promise<Entry> {
  const db = getDatabase();

  // Verify asset exists
  const assetExists = await db
    .selectFrom('assets')
    .select('id')
    .where('id', '=', input.asset_id)
    .executeTakeFirst();

  if (!assetExists) {
    throw new Error(`Asset not found: ${input.asset_id}`);
  }

  return db.transaction().execute(async (trx) => {
    const now = Date.now();

    const entry: Entry = {
      id: randomUUID(),
      pot_id: input.pot_id,
      type: 'audio',
      content_text: null, // No text content until transcription completes
      content_sha256: null,
      capture_method: input.capture_method,
      source_url: input.source_url ?? null,
      source_title: input.source_title ?? null,
      notes: input.notes ?? null,
      captured_at: input.captured_at ?? now,
      created_at: now,
      updated_at: now,
      client_capture_id: input.client_capture_id ?? null,
      source_app: null,
      source_context: null,
      asset_id: input.asset_id,
      link_url: null,
      link_title: null,
    };

    const dbEntry = {
      id: entry.id,
      pot_id: entry.pot_id,
      type: entry.type,
      content_text: '', // Workaround for NOT NULL constraint
      content_sha256: '', // Workaround for NOT NULL constraint
      capture_method: entry.capture_method,
      source_url: entry.source_url,
      source_title: entry.source_title,
      notes: entry.notes,
      captured_at: entry.captured_at,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      client_capture_id: entry.client_capture_id,
      source_app: entry.source_app,
      source_context_json: null,
      asset_id: entry.asset_id,
    };

    await trx.insertInto('entries').values(dbEntry).execute();

    await trx
      .updateTable('pots')
      .set({ last_used_at: now })
      .where('id', '=', input.pot_id)
      .execute();

    await logAuditEventInTransaction(trx, {
      actor: 'user',
      action: 'create_audio_entry',
      pot_id: entry.pot_id,
      entry_id: entry.id,
      metadata: {
        type: entry.type,
        capture_method: entry.capture_method,
        asset_id: entry.asset_id,
      },
    });

    return entry;
  });
}

/**
 * Phase 4: Get entry with asset metadata joined
 *
 * If entry has asset_id, includes full asset object
 */
export async function getEntryWithAsset(id: string): Promise<EntryWithAsset | null> {
  const db = getDatabase();

  const result = await db
    .selectFrom('entries')
    .leftJoin('assets', 'assets.id', 'entries.asset_id')
    .select([
      // Entry fields
      'entries.id',
      'entries.pot_id',
      'entries.type',
      'entries.content_text',
      'entries.content_sha256',
      'entries.capture_method',
      'entries.source_url',
      'entries.source_title',
      'entries.notes',
      'entries.captured_at',
      'entries.created_at',
      'entries.updated_at',
      'entries.client_capture_id',
      'entries.source_app',
      'entries.source_context_json',
      'entries.asset_id',
      // Phase 11: link fields
      'entries.link_url',
      'entries.link_title',
      // Asset fields (prefixed to avoid collisions)
      'assets.id as asset_id_full',
      'assets.sha256',
      'assets.size_bytes',
      'assets.mime_type',
      'assets.original_filename',
      'assets.storage_path',
      'assets.encryption_version',
      'assets.created_at as asset_created_at',
    ])
    .where('entries.id', '=', id)
    .executeTakeFirst();

  if (!result) {
    return null;
  }

  const entry = mapRowToEntry(result);

  // If entry has asset, embed it
  if (result.asset_id && result.asset_id_full) {
    return {
      ...entry,
      asset: {
        id: result.asset_id_full,
        sha256: result.sha256!,
        size_bytes: result.size_bytes!,
        mime_type: result.mime_type!,
        original_filename: result.original_filename ?? null,
        storage_path: result.storage_path!,
        encryption_version: result.encryption_version!,
        created_at: result.asset_created_at!,
      },
    };
  }

  return entry;
}

/**
 * Create a new link entry (Phase 11)
 *
 * @param input - Link entry data
 * @returns Created entry
 */
export async function createLinkEntry(input: CreateLinkEntryInput): Promise<Entry> {
  const db = getDatabase();
  const now = Date.now();

  // For link entries, hash the link_url instead of content_text
  const content_sha256 = hashText(input.link_url);

  const entry: Entry = {
    id: randomUUID(),
    pot_id: input.pot_id,
    type: 'link',
    content_text: input.content_text ?? null, // optional excerpt
    content_sha256,
    capture_method: input.capture_method,
    source_url: null, // source fields not used for link type
    source_title: null,
    notes: null,
    captured_at: input.captured_at ?? now,
    created_at: now,
    updated_at: now,
    // Phase 3 fields
    client_capture_id: input.client_capture_id ?? null,
    source_app: input.source_app ?? null,
    source_context: input.source_context ?? null,
    // Phase 4 fields
    asset_id: null,
    // Phase 11 link fields
    link_url: input.link_url,
    link_title: input.link_title ?? null,
  };

  // Map to database row format
  const { source_context, ...entryWithoutContext } = entry;
  const dbEntry = {
    ...entryWithoutContext,
    source_context_json: source_context ? JSON.stringify(source_context) : null,
  };

  await db.insertInto('entries').values(dbEntry as any).execute();

  // Log audit event
  await logAuditEvent({
    actor: 'extension',
    action: 'create_entry',
    pot_id: entry.pot_id,
    entry_id: entry.id,
    metadata: {
      type: entry.type,
      capture_method: entry.capture_method,
      link_url_domain: new URL(input.link_url).hostname, // only log domain for privacy
    },
  });

  return entry;
}
