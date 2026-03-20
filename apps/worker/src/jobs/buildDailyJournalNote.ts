/**
 * Journal Module: Daily Journal Note Job Handler
 *
 * Generates a structured daily note from all entries captured on a given day.
 * Evidence-first; every claim must cite a stored entry.
 */

import { loadPromptFromFile, interpolatePrompt, createChatCompletion, resolveEffectiveRole, injectRoleIntoSystemPrompt } from '@links/ai';
import type { JobContext } from '@links/storage';
import {
  getDatabase,
  getPotById,
  getAIPreferences,
  logAuditEvent,
  listArtifactsForEntry,
  getPreference,
  upsertJournalEntry,
  enqueueJob,
} from '@links/storage';
import type { JournalJobPayload, JournalConfig, DEFAULT_JOURNAL_CONFIG } from '@links/storage';
import { DailyNoteSchema } from '@links/core';
import { createLogger } from '@links/logging';
import {
  getJobPayload,
  buildInputFingerprint,
  formatEntryBlock,
  estimateTokens,
  computeDayWindow,
} from './utils/journalUtils.js';
import { join } from 'node:path';
import { getPromptsDir } from './utils/promptResolver.js';

const logger = createLogger({ name: 'job:build-daily-journal-note' });
const PROMPTS_DIR = getPromptsDir();

const PROCESSING_CONFIG_KEY = 'processing.config';
const DEFAULT_MODEL = 'x-ai/grok-4.1-fast';

export async function buildDailyJournalNoteHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, msg: 'build_daily_journal_note: starting' });

  // 1. Read payload
  const payload = await getJobPayload<JournalJobPayload>(ctx.jobId);
  if (!payload) {
    throw new Error('build_daily_journal_note: missing payload_json');
  }

  const {
    scope_type = 'global',
    scope_id = null,
    date_ymd,
    timezone = 'UTC',
  } = payload as JournalJobPayload & { scope_id?: string | null };

  if (!date_ymd) {
    throw new Error('build_daily_journal_note: payload missing date_ymd');
  }

  // 2. Check processing.config — bail if journal disabled
  const processingConfig = await getPreference<{ journal?: JournalConfig }>(PROCESSING_CONFIG_KEY);
  const journalConfig = processingConfig?.journal;

  if (journalConfig?.enabled === false) {
    logger.info({ job_id: ctx.jobId, msg: 'Journal disabled in processing.config — skipping' });
    await logAuditEvent({
      actor: 'system',
      action: 'journal_daily_skipped',
      pot_id: scope_type === 'pot' ? (scope_id ?? undefined) : undefined,
      metadata: { job_id: ctx.jobId, reason: 'disabled', date_ymd, scope_type, scope_id },
    });
    return;
  }

  const budgets = journalConfig?.budgets ?? {};
  const maxEntriesPerDay = budgets.max_entries_per_day ?? 200;
  const maxCharsPerEntry = budgets.max_chars_per_entry ?? 12000;
  const maxTotalChars = budgets.max_total_chars ?? 300000;
  const maxTokens = budgets.max_tokens_daily_job ?? 1800;

  // 3. Compute day window
  const { startMs, endMs } = computeDayWindow(date_ymd);

  // 4. Fetch entries
  const db = getDatabase();

  let entryQuery = db
    .selectFrom('entries')
    .selectAll()
    .where('captured_at', '>=', startMs)
    .where('captured_at', '<', endMs)
    .orderBy('captured_at', 'asc')
    .limit(maxEntriesPerDay);

  if (scope_type === 'pot' && scope_id) {
    entryQuery = entryQuery.where('pot_id', '=', scope_id);
  }

  const entries = await entryQuery.execute();

  if (entries.length === 0) {
    logger.info({ job_id: ctx.jobId, date_ymd, scope_type, scope_id, msg: 'No entries — skipping journal note' });
    await logAuditEvent({
      actor: 'system',
      action: 'journal_daily_skipped',
      pot_id: scope_type === 'pot' ? (scope_id ?? undefined) : undefined,
      metadata: { job_id: ctx.jobId, reason: 'no_entries', date_ymd, scope_type, scope_id },
    });
    return;
  }

  // 5. Compute fingerprint
  const fingerprint = buildInputFingerprint(
    entries.map((e) => ({ id: e.id, content_sha256: e.content_sha256 })),
  );

  // Quick idempotency check: fingerprint unchanged?
  const prefs = await getAIPreferences();
  const promptPath = join(PROMPTS_DIR, 'journal_daily', 'v1.md');
  const prompt = loadPromptFromFile(promptPath);

  const existing = await db
    .selectFrom('journal_entries')
    .select(['id', 'input_fingerprint'])
    .where('kind', '=', 'daily')
    .where('scope_type', '=', scope_type)
    .where(scope_id === null ? 'scope_id' : 'scope_id', scope_id === null ? 'is' : '=', scope_id as any)
    .where('period_start_ymd', '=', date_ymd)
    .where('prompt_id', '=', prompt.metadata.id)
    .where('prompt_version', '=', String(prompt.metadata.version))
    .executeTakeFirst();

  if (existing && existing.input_fingerprint === fingerprint) {
    logger.info({ job_id: ctx.jobId, date_ymd, msg: 'Fingerprint unchanged — idempotent skip' });
    return;
  }

  // 6. Fetch artifacts; apply char budget
  let totalChars = 0;
  const entryBlocks: string[] = [];
  const entryIds: string[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    const artifacts = await listArtifactsForEntry(entry.id);

    const domainEntry = {
      id: entry.id,
      pot_id: entry.pot_id,
      type: entry.type as any,
      content_text: entry.content_text,
      content_sha256: entry.content_sha256,
      capture_method: entry.capture_method,
      source_url: entry.source_url,
      source_title: entry.source_title,
      notes: entry.notes,
      captured_at: entry.captured_at,
      created_at: entry.created_at as number,
      updated_at: entry.updated_at,
      client_capture_id: entry.client_capture_id,
      source_app: entry.source_app,
      source_context: entry.source_context_json ? JSON.parse(entry.source_context_json) : null,
      asset_id: entry.asset_id,
      link_url: entry.link_url,
      link_title: entry.link_title,
    };

    const block = formatEntryBlock(domainEntry, artifacts, maxCharsPerEntry);
    const blockChars = block.length;

    if (totalChars + blockChars > maxTotalChars) {
      warnings.push(`Budget exceeded at entry ${entry.id}: truncating remaining entries`);
      logger.warn({ job_id: ctx.jobId, entry_id: entry.id, msg: 'Total chars budget exceeded; truncating' });
      break;
    }

    entryBlocks.push(block);
    entryIds.push(entry.id);
    totalChars += blockChars;
  }

  // 7. Build prompt
  const scopePotStr = scope_type === 'pot' && scope_id ? ` (pot_id: ${scope_id})` : '';
  const messages = interpolatePrompt(prompt, {
    date_ymd,
    scope_type,
    scope_pot_id: scopePotStr,
    entries_block: entryBlocks.join('\n\n'),
    entry_ids_list: entryIds.join(', '),
  });

  // 8. Pick model
  const model = prefs.task_models?.journaling ?? prefs.default_model ?? DEFAULT_MODEL;

  logger.info({
    job_id: ctx.jobId,
    model,
    date_ymd,
    scope_type,
    scope_id,
    entries_count: entryIds.length,
    prompt_id: prompt.metadata.id,
    prompt_version: prompt.metadata.version,
    msg: 'Calling AI for daily journal note',
  });

  // 9. Call AI
  // Resolve pot role (only applies to pot-scoped journals; global journal uses default role)
  const potForRole = scope_type === 'pot' && scope_id ? await getPotById(scope_id) : null;
  const role = await resolveEffectiveRole(potForRole ?? { id: scope_id ?? '', role_ref: null });
  logger.info({ job_id: ctx.jobId, scope_type, scope_id, role_hash: role.hash });

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

  // 10. Parse JSON (strip any accidental markdown wrapper)
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
  const validation = DailyNoteSchema.safeParse(parsed);
  if (!validation.success) {
    logger.error({ job_id: ctx.jobId, errors: validation.error.format(), msg: 'Schema validation failed' });
    throw new Error(`DailyNoteSchema validation failed: ${validation.error.message}`);
  }

  const dailyNote = validation.data;

  // 12. Store journal entry
  const { entry: journalEntry, skipped } = await upsertJournalEntry({
    kind: 'daily',
    scope_type,
    scope_id: scope_id ?? undefined,
    period_start_ymd: date_ymd,
    period_end_ymd: date_ymd,
    timezone,
    model_id: model,
    prompt_id: prompt.metadata.id,
    prompt_version: String(prompt.metadata.version),
    temperature: prompt.metadata.temperature ?? 0.2,
    max_tokens: maxTokens,
    input_fingerprint: fingerprint,
    content: dailyNote,
    citations: dailyNote.what_happened.flatMap((b) => b.citations),
  });

  if (skipped) {
    logger.info({ job_id: ctx.jobId, journal_id: journalEntry.id, msg: 'Upsert skipped (fingerprint unchanged)' });
    return;
  }

  // 13. Audit event
  await logAuditEvent({
    actor: 'system',
    action: 'journal_daily_built',
    pot_id: scope_type === 'pot' ? (scope_id ?? undefined) : undefined,
    metadata: {
      job_id: ctx.jobId,
      journal_id: journalEntry.id,
      date_ymd,
      scope_type,
      scope_id,
      model_id: model,
      prompt_id: prompt.metadata.id,
      prompt_version: prompt.metadata.version,
      entries_count: entryIds.length,
      warnings,
    },
  });

  logger.info({
    job_id: ctx.jobId,
    journal_id: journalEntry.id,
    date_ymd,
    scope_type,
    scope_id,
    msg: 'Daily journal note built',
  });

  // Slice 4: trigger journal-ready nudge notification
  await enqueueJob({
    job_type: 'generate_nudges',
    pot_id: scope_type === 'pot' ? (scope_id ?? undefined) : undefined,
    priority: 10,
    payload: {
      trigger: 'daily_journal',
      journal_id: journalEntry.id,
      date_ymd,
      scope_type,
      scope_id: scope_id ?? null,
    },
  }).catch(() => { /* non-fatal */ });
}
