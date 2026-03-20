/**
 * Journal Module: Rollup Journal Note Job Handler
 *
 * Handles all 4 rollup kinds: weekly, monthly, quarterly, yearly.
 * Cites child journal_ids; never raw entry_ids.
 */

import { loadPromptFromFile, interpolatePrompt, createChatCompletion, resolveEffectiveRole, injectRoleIntoSystemPrompt } from '@links/ai';
import type { JobContext } from '@links/storage';
import {
  getPotById,
  getAIPreferences,
  logAuditEvent,
  getPreference,
  enqueueJob,
  upsertJournalEntry,
  listChildJournalEntries,
} from '@links/storage';
import type { JournalJobPayload, JournalConfig, JournalEntry } from '@links/storage';
import { RollupNoteSchema } from '@links/core';
import { createLogger } from '@links/logging';
import {
  getJobPayload,
  buildRollupFingerprint,
} from './utils/journalUtils.js';
import { join } from 'node:path';
import { getPromptsDir } from './utils/promptResolver.js';

const logger = createLogger({ name: 'job:build-rollup-journal-note' });
const PROMPTS_DIR = getPromptsDir();

const PROCESSING_CONFIG_KEY = 'processing.config';
const DEFAULT_MODEL = 'x-ai/grok-4.1-fast';

type RollupKind = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
type ChildKind = 'daily' | 'weekly' | 'monthly' | 'quarterly';

const CHILD_KIND_MAP: Record<RollupKind, ChildKind> = {
  weekly: 'daily',
  monthly: 'weekly',
  quarterly: 'monthly',
  yearly: 'quarterly',
};

const CHILD_JOB_TYPE_MAP: Record<ChildKind, string> = {
  daily: 'build_daily_journal_note',
  weekly: 'build_weekly_journal_summary',
  monthly: 'build_monthly_journal_summary',
  quarterly: 'build_quarterly_journal_summary',
};

/** Format a child journal entry as a block for the rollup prompt */
function formatChildBlock(child: JournalEntry): string {
  const content = JSON.stringify(child.content, null, 2).slice(0, 4000);
  return `<journal id="${child.id}" kind="${child.kind}" period="${child.period_start_ymd}" to="${child.period_end_ymd}">\n${content}\n</journal>`;
}

export async function buildRollupJournalNoteHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, msg: 'build_rollup_journal_note: starting' });

  // 1. Read payload
  const payload = await getJobPayload<JournalJobPayload>(ctx.jobId);
  if (!payload) {
    throw new Error('build_rollup_journal_note: missing payload_json');
  }

  const {
    kind,
    scope_type = 'global',
    scope_id = null,
    period_start_ymd,
    period_end_ymd,
    timezone = 'UTC',
  } = payload as JournalJobPayload & { scope_id?: string | null };

  if (!kind || !period_start_ymd || !period_end_ymd) {
    throw new Error('build_rollup_journal_note: payload missing kind, period_start_ymd, or period_end_ymd');
  }

  if (!['weekly', 'monthly', 'quarterly', 'yearly'].includes(kind)) {
    throw new Error(`build_rollup_journal_note: invalid kind: ${kind}`);
  }

  const rollupKind = kind as RollupKind;
  const childKind = CHILD_KIND_MAP[rollupKind];

  // 2. Check processing.config
  const processingConfig = await getPreference<{ journal?: JournalConfig }>(PROCESSING_CONFIG_KEY);
  const journalConfig = processingConfig?.journal;

  if (journalConfig?.enabled === false) {
    logger.info({ job_id: ctx.jobId, msg: 'Journal disabled — skipping' });
    return;
  }

  // Check rollup-specific enabled flag
  const rollupConfig = journalConfig?.rollups?.[rollupKind];
  if (rollupConfig?.enabled === false) {
    logger.info({ job_id: ctx.jobId, kind, msg: `${kind} rollup disabled — skipping` });
    return;
  }

  const budgets = journalConfig?.budgets ?? {};
  const maxTokens = budgets.max_tokens_rollup_job ?? 2200;
  const maxJobsBackfill = budgets.max_jobs_per_startup_backfill ?? 7;
  const enqueuePrerequisites = journalConfig?.behavior?.enqueue_prerequisites ?? true;
  const allowFallbackToDaily = journalConfig?.behavior?.allow_rollup_fallback_to_daily ?? true;

  // 3. Load children
  let children = await listChildJournalEntries({
    child_kind: childKind,
    scope_type,
    scope_id: scope_id ?? null,
    period_start_ymd,
    period_end_ymd,
  });

  // Monthly fallback: if no weekly children and fallback enabled, try daily
  let usingFallback = false;
  if (rollupKind === 'monthly' && children.length === 0 && allowFallbackToDaily) {
    logger.info({ job_id: ctx.jobId, msg: 'Monthly rollup: no weekly children found; falling back to daily notes' });
    children = await listChildJournalEntries({
      child_kind: 'daily',
      scope_type,
      scope_id: scope_id ?? null,
      period_start_ymd,
      period_end_ymd,
    });
    usingFallback = children.length > 0;
  }

  // 4. Handle missing prerequisites
  if (children.length === 0) {
    if (enqueuePrerequisites) {
      logger.info({ job_id: ctx.jobId, kind, msg: 'No children found; enqueuing prerequisites' });

      // Enqueue missing child jobs (bounded)
      let enqueuedCount = 0;

      // For simplicity: enqueue one child job for the period with priority -10
      const childJobType = CHILD_JOB_TYPE_MAP[usingFallback ? 'daily' : childKind];
      if (enqueuedCount < maxJobsBackfill) {
        await enqueueJob({
          job_type: childJobType,
          pot_id: scope_type === 'pot' ? (scope_id ?? undefined) : undefined,
          priority: -10,
          payload: {
            kind: usingFallback ? 'daily' : childKind,
            scope_type,
            scope_id,
            period_start_ymd,
            period_end_ymd,
            timezone,
          } as JournalJobPayload,
        });
        enqueuedCount++;
      }

      // Re-enqueue this rollup job to run after 30 minutes
      await enqueueJob({
        job_type: `build_${rollupKind}_journal_summary`,
        pot_id: scope_type === 'pot' ? (scope_id ?? undefined) : undefined,
        priority: -5,
        run_after: Date.now() + 30 * 60 * 1000,
        payload: payload,
      });

      await logAuditEvent({
        actor: 'system',
        action: 'journal_rollup_prerequisites_enqueued',
        pot_id: scope_type === 'pot' ? (scope_id ?? undefined) : undefined,
        metadata: {
          job_id: ctx.jobId,
          kind: rollupKind,
          child_kind: childKind,
          scope_type,
          scope_id,
          period_start_ymd,
          period_end_ymd,
          enqueued_count: enqueuedCount,
        },
      });
    } else {
      logger.info({ job_id: ctx.jobId, kind, msg: 'No children found; recording as missing' });
      await logAuditEvent({
        actor: 'system',
        action: 'journal_rollup_skipped',
        pot_id: scope_type === 'pot' ? (scope_id ?? undefined) : undefined,
        metadata: {
          job_id: ctx.jobId,
          kind: rollupKind,
          child_kind: childKind,
          scope_type,
          scope_id,
          period_start_ymd,
          period_end_ymd,
          reason: 'no_children_found',
        },
      });
    }
    return;
  }

  // 5. Build fingerprint from children
  const fingerprint = buildRollupFingerprint(children.map((c) => ({ id: c.id, created_at: c.created_at })));

  // 6. Idempotency check
  const prefs = await getAIPreferences();
  const promptPath = join(PROMPTS_DIR, 'journal_rollup', 'v1.md');
  const prompt = loadPromptFromFile(promptPath);

  // 7. Format children for prompt
  const childrenBlock = children.map(formatChildBlock).join('\n\n');
  const journalIdsList = children.map((c) => c.id).join(', ');
  const scopePotStr = scope_type === 'pot' && scope_id ? ` (pot_id: ${scope_id})` : '';

  const messages = interpolatePrompt(prompt, {
    kind: rollupKind,
    period_start_ymd,
    period_end_ymd,
    scope_type,
    scope_pot_id: scopePotStr,
    expected_children: String(children.length),
    children_block: childrenBlock,
    journal_ids_list: journalIdsList,
  });

  // 8. Pick model
  const model = prefs.task_models?.journaling ?? prefs.default_model ?? DEFAULT_MODEL;

  logger.info({
    job_id: ctx.jobId,
    model,
    kind: rollupKind,
    child_kind: childKind,
    children_count: children.length,
    scope_type,
    scope_id,
    prompt_id: prompt.metadata.id,
    msg: 'Calling AI for rollup journal note',
  });

  // 9. Call AI
  // Resolve pot role (only applies to pot-scoped rollups; global rollups use default role)
  const potForRole = scope_type === 'pot' && scope_id ? await getPotById(scope_id) : null;
  const role = await resolveEffectiveRole(potForRole ?? { id: scope_id ?? '', role_ref: null });
  logger.info({ job_id: ctx.jobId, scope_type, scope_id, kind: rollupKind, role_hash: role.hash });

  const response = await createChatCompletion({
    model,
    messages: [
      { role: 'system', content: injectRoleIntoSystemPrompt(messages.system, role.text) },
      { role: 'user', content: messages.user },
    ],
    temperature: prompt.metadata.temperature ?? 0.2,
    max_tokens: maxTokens,
  });

  const aiOutput = response.choices[0]?.message?.content;
  if (!aiOutput) {
    throw new Error('AI response is empty');
  }

  // 10. Parse JSON
  let cleanedOutput = aiOutput.trim();
  const codeBlockMatch = cleanedOutput.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (codeBlockMatch?.[1]) {
    cleanedOutput = codeBlockMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanedOutput);
  } catch {
    throw new Error(`AI returned invalid JSON: ${cleanedOutput.slice(0, 200)}`);
  }

  // 11. Validate schema
  const validation = RollupNoteSchema.safeParse(parsed);
  if (!validation.success) {
    logger.error({ job_id: ctx.jobId, errors: validation.error.format(), msg: 'RollupNoteSchema validation failed' });
    throw new Error(`RollupNoteSchema validation failed: ${validation.error.message}`);
  }

  const rollupNote = validation.data;

  // 12. Store journal entry
  const { entry: journalEntry, skipped } = await upsertJournalEntry({
    kind: rollupKind,
    scope_type,
    scope_id: scope_id ?? undefined,
    period_start_ymd,
    period_end_ymd,
    timezone,
    model_id: model,
    prompt_id: prompt.metadata.id,
    prompt_version: String(prompt.metadata.version),
    temperature: prompt.metadata.temperature ?? 0.2,
    max_tokens: maxTokens,
    input_fingerprint: fingerprint,
    content: rollupNote,
    citations: children.map((c) => ({ journal_id: c.id })),
  });

  if (skipped) {
    logger.info({ job_id: ctx.jobId, journal_id: journalEntry.id, msg: 'Upsert skipped (fingerprint unchanged)' });
    return;
  }

  // 13. Audit event
  await logAuditEvent({
    actor: 'system',
    action: `journal_${rollupKind}_built`,
    pot_id: scope_type === 'pot' ? (scope_id ?? undefined) : undefined,
    metadata: {
      job_id: ctx.jobId,
      journal_id: journalEntry.id,
      kind: rollupKind,
      child_kind: usingFallback ? 'daily' : childKind,
      scope_type,
      scope_id,
      period_start_ymd,
      period_end_ymd,
      model_id: model,
      children_count: children.length,
      using_fallback: usingFallback,
    },
  });

  logger.info({
    job_id: ctx.jobId,
    journal_id: journalEntry.id,
    kind: rollupKind,
    scope_type,
    scope_id,
    msg: 'Rollup journal note built',
  });
}
