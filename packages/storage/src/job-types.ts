/**
 * Job type registry and handlers
 * Phase 5: Deterministic jobs (no AI yet)
 */

import { getDatabase } from './db.js';
import { canonicalizeText, hashCanonical } from './canonicalize.js';

export interface JobContext {
  jobId: string;
  potId: string | null;
  entryId: string | null;
  attempt: number;
  payload: Record<string, unknown> | null;
  // flow correlation (031_flow_correlation)
  flowId: string | null;
}

export type JobHandler = (ctx: JobContext) => Promise<void>;

/**
 * Job type registry
 */
const JOB_HANDLERS = new Map<string, JobHandler>();

/**
 * Register a job type handler
 */
export function registerJobType(jobType: string, handler: JobHandler): void {
  if (JOB_HANDLERS.has(jobType)) {
    throw new Error(`Job type already registered: ${jobType}`);
  }
  JOB_HANDLERS.set(jobType, handler);
}

/**
 * Get handler for a job type
 */
export function getJobHandler(jobType: string): JobHandler | undefined {
  return JOB_HANDLERS.get(jobType);
}

/**
 * List all registered job types
 */
export function getRegisteredJobTypes(): string[] {
  return Array.from(JOB_HANDLERS.keys());
}

// ============================================================================
// Phase 5 Job Handlers (Deterministic, no AI)
// ============================================================================

/**
 * touch_pot_usage: Update pot last_used_at to now
 * Scope: Pot
 */
async function touchPotUsageHandler(ctx: JobContext): Promise<void> {
  if (!ctx.potId) {
    throw new Error('touch_pot_usage requires pot_id');
  }

  const db = getDatabase();
  const now = Date.now();

  const result = await db
    .updateTable('pots')
    .set({ last_used_at: now, updated_at: now })
    .where('id', '=', ctx.potId)
    .executeTakeFirst();

  if (result.numUpdatedRows === 0n) {
    throw new Error(`Pot not found: ${ctx.potId}`);
  }
}

/**
 * verify_entry_hash: Re-compute canonical hash and verify integrity
 * Scope: Entry
 */
async function verifyEntryHashHandler(ctx: JobContext): Promise<void> {
  if (!ctx.entryId) {
    throw new Error('verify_entry_hash requires entry_id');
  }

  const db = getDatabase();

  // Fetch entry
  const entry = await db
    .selectFrom('entries')
    .select(['id', 'content_text', 'content_sha256'])
    .where('id', '=', ctx.entryId)
    .executeTakeFirst();

  if (!entry) {
    throw new Error(`Entry not found: ${ctx.entryId}`);
  }

  // Skip if no content (asset-backed entries)
  if (!entry.content_text || entry.content_text === '') {
    return;
  }

  // Re-compute hash
  const canonical = canonicalizeText(entry.content_text);
  const computedHash = hashCanonical(canonical);

  // Verify match
  if (computedHash !== entry.content_sha256) {
    throw new Error(
      `Hash mismatch for entry ${ctx.entryId}: expected ${entry.content_sha256}, got ${computedHash}`,
    );
  }
}

/**
 * always_fail: Test job that always throws (for retry/deadletter testing)
 * Scope: None
 */
async function alwaysFailHandler(ctx: JobContext): Promise<void> {
  throw new Error(`Test job always_fail (attempt ${ctx.attempt})`);
}

/**
 * noop: No-op job for testing (always succeeds immediately)
 * Scope: None
 */
async function noopHandler(_ctx: JobContext): Promise<void> {
  // Intentionally empty
}

// Register all Phase 5 job types
registerJobType('touch_pot_usage', touchPotUsageHandler);
registerJobType('verify_entry_hash', verifyEntryHashHandler);
registerJobType('always_fail', alwaysFailHandler);
registerJobType('noop', noopHandler);
