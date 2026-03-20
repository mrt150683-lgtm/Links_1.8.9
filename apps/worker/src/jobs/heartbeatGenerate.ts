/**
 * heartbeat_generate Job Handler
 *
 * Generates a structured heartbeat snapshot for a pot:
 * 1. Load pot_automation_settings — abort if heartbeat_enabled=false
 * 2. Build compact pot digest (entries, tags, entities, tasks)
 * 3. Compute input_fingerprint (SHA256 of digest) — skip if matches last
 * 4. Resolve model from automation_models.heartbeat preference
 * 5. Load prompt automation_heartbeat_generate/v1
 * 6. Call AI (strict JSON output matching HeartbeatOutputSchema)
 * 7. Validate output
 * 8. Apply task_operations with permission checks
 * 9. Create heartbeat_snapshot record
 * 10. Enqueue heartbeat_render
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getAutomationSettings,
  getAIPreferences,
  getPotById,
  listEntries,
  listArtifactsForPot,
  getLatestHeartbeatSnapshot,
  getLastHeartbeatFingerprint,
  createHeartbeatSnapshot,
  createScheduledTask,
  updateScheduledTask,
  countTaskCreationsToday,
  logAuditEvent,
  enqueueJob,
  getSystemTimezone,
} from '@links/storage';
import { createChatCompletion, loadPromptFromFile } from '@links/ai';
import { HeartbeatOutputSchema } from '@links/core';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

const logger = createLogger({ name: 'job:heartbeat-generate' });

const DEFAULT_HEARTBEAT_MODEL = 'x-ai/grok-4.1-fast';

function getPromptsDir(): string {
  if (process.env.PROMPTS_DIR) return process.env.PROMPTS_DIR;
  try {
    return path.join(path.dirname(process.execPath), 'resources', 'prompts');
  } catch {
    return path.join(process.cwd(), '../../apps/launcher/resources/prompts');
  }
}

function computePeriodKey(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const year = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';

  return `${year}${month}${day}-${hour}`;
}

function computeFingerprint(digest: unknown): string {
  const content = JSON.stringify(digest);
  return createHash('sha256').update(content).digest('hex').slice(0, 32);
}

export async function heartbeatGenerateHandler(ctx: JobContext): Promise<void> {
  const payload = ctx.payload as {
    pot_id: string;
    scheduled_task_id?: string;
    manual?: boolean;
  };
  const { pot_id: potId, manual } = payload;

  logger.info({ job_id: ctx.jobId, pot_id: potId, msg: 'Heartbeat generate start' });

  // 1. Load automation settings
  const settings = await getAutomationSettings(potId);
  if (!settings || !settings.enabled || !settings.heartbeat_enabled) {
    logger.info({ pot_id: potId, msg: 'Heartbeat not enabled — aborting' });
    return;
  }

  const tz = settings.timezone ?? getSystemTimezone() ?? 'UTC';
  const now = new Date();
  const periodKey = computePeriodKey(now, tz);

  // 2. Build pot digest
  const pot = await getPotById(potId);
  if (!pot) {
    logger.error({ pot_id: potId, msg: 'Pot not found' });
    return;
  }

  const [entries, allArtifacts] = await Promise.all([
    listEntries({ pot_id: potId, limit: 20 }).catch(() => []),
    listArtifactsForPot(potId).catch(() => []),
  ]);

  // Extract tags + entities summary
  const tagCounts: Record<string, number> = {};
  const entityCounts: Record<string, number> = {};

  for (const art of allArtifacts) {
    const p = art.payload as any;
    if (art.artifact_type === 'tags' && Array.isArray(p?.tags)) {
      for (const tag of p.tags) {
        const name = typeof tag === 'string' ? tag : tag?.name ?? String(tag);
        tagCounts[name] = (tagCounts[name] ?? 0) + 1;
      }
    }
    if (art.artifact_type === 'entities' && Array.isArray(p?.entities)) {
      for (const ent of p.entities) {
        const name = ent?.name ?? String(ent);
        entityCounts[name] = (entityCounts[name] ?? 0) + 1;
      }
    }
  }

  const topTags = Object.entries(tagCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([tag, count]) => ({ tag, count }));

  const topEntities = Object.entries(entityCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  const entryTypeDist: Record<string, number> = {};
  for (const e of entries) {
    const t = (e as any).type ?? 'unknown';
    entryTypeDist[t] = (entryTypeDist[t] ?? 0) + 1;
  }

  const digest = {
    pot: { id: pot.id, name: pot.name, goal_text: (pot as any).goal_text ?? null },
    entry_count: entries.length,
    entry_type_distribution: entryTypeDist,
    recent_entries: entries.slice(0, 15).map((e: any) => ({
      id: e.id,
      type: e.type,
      source_title: e.source_title ?? null,
      content_snippet: (e.content_text ?? '').slice(0, 400),
      captured_at: e.captured_at,
    })),
    top_tags: topTags,
    top_entities: topEntities,
    period_key: periodKey,
  };

  // 3. Compute input fingerprint — skip if no change
  const fingerprint = computeFingerprint(digest);
  if (!manual) {
    const lastFingerprint = await getLastHeartbeatFingerprint(potId).catch(() => null);
    if (lastFingerprint === fingerprint) {
      logger.info({ pot_id: potId, msg: 'Heartbeat skipped — no change since last run (SKIPPED_NO_CHANGE)' });
      await logAuditEvent({
        actor: 'system',
        action: 'heartbeat_skipped_no_change',
        pot_id: potId,
        metadata: { fingerprint },
      });
      return;
    }
  }

  // 4. Resolve model
  const prefs = await getAIPreferences();
  const modelId = settings.default_model
    ?? prefs.automation_models?.heartbeat
    ?? prefs.default_model
    ?? DEFAULT_HEARTBEAT_MODEL;

  // 5. Load prompt
  const promptsDir = getPromptsDir();
  let systemMsg = 'You are a project intelligence analyst. Output strictly valid JSON only. No markdown fences.';
  let userMsg = '';

  try {
    const promptTemplate = loadPromptFromFile(
      path.join(promptsDir, 'automation_heartbeat_generate', 'v1.md'),
    );
    systemMsg = promptTemplate.system || systemMsg;
    const userTpl = typeof promptTemplate.user === 'function' ? promptTemplate.user({}) : promptTemplate.user;
    userMsg = userTpl.replace('{{POT_DIGEST}}', JSON.stringify(digest, null, 2));
  } catch {
    userMsg = buildDefaultHeartbeatPrompt(digest);
  }

  // 6. Call AI
  let aiOutput: typeof HeartbeatOutputSchema._type;
  try {
    const response = await createChatCompletion({
      model: modelId,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.2,
      max_tokens: 3000,
    });

    const raw = response.choices[0]?.message?.content ?? '';
    const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

    // 7. Validate output
    const parsed = HeartbeatOutputSchema.safeParse(JSON.parse(cleaned));
    if (!parsed.success) {
      logger.error({ pot_id: potId, errors: parsed.error.errors, msg: 'Heartbeat AI output failed schema validation' });
      await logAuditEvent({
        actor: 'system',
        action: 'heartbeat_validation_failed',
        pot_id: potId,
        metadata: { model_id: modelId, errors: parsed.error.errors.map((e: { message: string }) => e.message) },
      });
      return;
    }
    aiOutput = parsed.data;
  } catch (err) {
    logger.error({ pot_id: potId, err: String(err), msg: 'Heartbeat AI call failed' });
    return;
  }

  // 8. Apply task_operations with permission checks
  const taskOps = aiOutput.task_operations;
  if (taskOps) {
    // Creates
    if (taskOps.create?.length && settings.agent_can_create_tasks) {
      const todayCount = await countTaskCreationsToday(potId);
      const remaining = settings.max_tasks_created_per_day - todayCount;
      const toCreate = taskOps.create.slice(0, Math.max(0, remaining));

      for (const op of toCreate) {
        try {
          await createScheduledTask({
            pot_id: potId,
            task_type: op.task_type ?? 'custom_prompt_task',
            title: op.title,
            description: op.description ?? '',
            schedule_kind: op.schedule_kind ?? 'manual',
            cron_like: op.cron_like ?? null,
            priority: op.priority ?? 10,
            created_by: 'agent',
            created_from: 'automation',
          });
          await logAuditEvent({
            actor: 'system',
            action: 'automation_task_created',
            pot_id: potId,
            metadata: { title: op.title, task_type: op.task_type },
          });
        } catch (e) {
          logger.warn({ pot_id: potId, title: op.title, err: String(e), msg: 'Failed to create agent task' });
        }
      }

      if (taskOps.create.length > toCreate.length) {
        logger.info({ pot_id: potId, requested: taskOps.create.length, allowed: toCreate.length, msg: 'Task create cap applied' });
        await logAuditEvent({
          actor: 'system',
          action: 'heartbeat_task_create_cap',
          pot_id: potId,
          metadata: { requested: taskOps.create.length, allowed: toCreate.length },
        });
      }
    } else if (taskOps.create?.length && !settings.agent_can_create_tasks) {
      logger.info({ pot_id: potId, msg: 'Agent task creation not permitted — skipping creates' });
      await logAuditEvent({
        actor: 'system',
        action: 'heartbeat_task_create_denied',
        pot_id: potId,
        metadata: { requested: taskOps.create.length },
      });
    }

    // Pauses
    if (taskOps.pause?.length && settings.agent_can_update_tasks) {
      for (const taskId of taskOps.pause) {
        await updateScheduledTask(taskId, { status: 'paused' }).catch(() => null);
        await logAuditEvent({ actor: 'system', action: 'automation_task_paused', pot_id: potId, metadata: { task_id: taskId } });
      }
    }

    // Completes
    if (taskOps.complete?.length && settings.agent_can_complete_tasks) {
      for (const taskId of taskOps.complete) {
        await updateScheduledTask(taskId, { status: 'completed' }).catch(() => null);
        await logAuditEvent({ actor: 'system', action: 'automation_task_completed', pot_id: potId, metadata: { task_id: taskId } });
      }
    }
  }

  // 9. Create heartbeat_snapshot
  const summary = {
    headline: aiOutput.headline,
    summary: aiOutput.summary,
    what_changed: aiOutput.what_changed,
    confidence: aiOutput.confidence,
    reasoning_basis: aiOutput.reasoning_basis,
  };

  const snapshot = await createHeartbeatSnapshot({
    pot_id: potId,
    period_key: periodKey,
    snapshot: aiOutput as unknown as Record<string, unknown>,
    summary,
    open_loops: aiOutput.open_loops,
    proposed_tasks: (aiOutput.task_operations?.create ?? []) as unknown[],
    model_id: modelId,
    prompt_id: 'automation_heartbeat_generate',
    prompt_version: 'v1',
    input_fingerprint: fingerprint,
  });

  logger.info({ pot_id: potId, snapshot_id: snapshot.id, msg: 'Heartbeat snapshot created' });

  // 10. Enqueue heartbeat_render
  await enqueueJob({
    job_type: 'heartbeat_render',
    pot_id: potId,
    payload: { pot_id: potId, snapshot_id: snapshot.id },
    priority: 8,
  });

  await logAuditEvent({
    actor: 'system',
    action: 'heartbeat_generated',
    pot_id: potId,
    metadata: {
      snapshot_id: snapshot.id,
      model_id: modelId,
      open_loops_count: aiOutput.open_loops.length,
      fingerprint,
    },
  });

  logger.info({ pot_id: potId, snapshot_id: snapshot.id, model_id: modelId, msg: 'Heartbeat generate complete' });
}

function buildDefaultHeartbeatPrompt(digest: unknown): string {
  return `Analyze this research pot and produce a structured project status report.

You MUST output ONLY valid JSON matching this exact schema (no markdown fences):
{
  "headline": "one-sentence status headline (max 200 chars)",
  "summary": "2-4 sentence project summary (max 1000 chars)",
  "what_changed": "what changed since last check (max 500 chars)",
  "open_loops": [
    { "title": "...", "description": "...", "priority": "high|medium|low", "source_refs": [] }
  ],
  "risks": [
    { "title": "...", "description": "...", "severity": "critical|high|medium|low" }
  ],
  "recommended_actions": [
    { "action": "...", "rationale": "...", "urgency": "immediate|soon|eventually" }
  ],
  "task_operations": {
    "create": [],
    "update": [],
    "complete": [],
    "pause": []
  },
  "heartbeat_markdown_sections": [
    { "heading": "...", "content": "..." }
  ],
  "confidence": 0.8,
  "reasoning_basis": "brief note on what evidence you used (max 500 chars)"
}

Use ONLY information from the pot digest below. Do not invent facts.
Keep open_loops <= 10 items, risks <= 5 items, recommended_actions <= 5 items.

POT DIGEST:
${JSON.stringify(digest, null, 2)}`;
}
