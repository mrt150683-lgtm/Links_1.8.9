/**
 * Intel-Gen: Generate Questions Job Handler
 *
 * Stage 1 of the Generated Intelligence pipeline.
 *
 * Given an intelligence run (identified by pot_id — handler claims the most
 * recent queued run), builds a pot snapshot in digest or full mode, sends it
 * to the intel_question_gen prompt, dedupes questions against
 * intelligence_known_questions, stores new questions, and enqueues
 * intel_answer_question jobs for each.
 */

import { createHash } from 'node:crypto';
import { loadPromptFromFile, interpolatePrompt, createChatCompletion, resolveEffectiveRole, injectRoleIntoSystemPrompt } from '@links/ai';
import type { PromptTemplate } from '@links/ai';
import type { JobContext } from '@links/storage';
import {
  listEntries,
  listArtifactsForEntry,
  getPotById,
  getAIPreferences,
  getDatabase,
  logAuditEvent,
  enqueueJob,
  insertIntelligenceQuestion,
  updateIntelligenceRunStatus,
  isKnownQuestion,
  upsertKnownQuestion,
} from '@links/storage';
import { IntelQuestionGenResponseSchema } from '@links/core';
import { createLogger } from '@links/logging';
import { join } from 'node:path';
import { getPromptsDir } from './utils/promptResolver.js';

const logger = createLogger({ name: 'job:intel-generate-questions' });
const PROMPTS_DIR = getPromptsDir();

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a question signature for dedupe.
 * sha256( normalised_question + "|" + sorted_entry_ids.join(",") + "|" + prompt_version )
 */
function buildQuestionSignature(
  questionText: string,
  entryIds: string[],
  promptVersion: string
): string {
  const normalised = questionText
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[?.!,;:]+$/, '');
  const sortedIds = [...entryIds].sort().join(',');
  const raw = `${normalised}|${sortedIds}|${promptVersion}`;
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Build a pot snapshot hash.
 * sha256( sorted "entry_id:content_sha256" pairs )
 */
function buildPotSnapshotHash(
  entries: Array<{ id: string; content_sha256: string | null }>
): string {
  const sorted = [...entries]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => `${e.id}:${e.content_sha256 ?? 'null'}`)
    .join('\n');
  return createHash('sha256').update(sorted).digest('hex');
}

/**
 * Estimate token count from character count.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build a digest-mode representation of a single entry.
 */
function buildEntryDigest(
  entry: {
    id: string;
    source_title: string | null;
    source_url: string | null;
    content_text: string | null;
    captured_at: number;
  },
  artifacts: Array<{ artifact_type: string; payload: unknown }>,
  omitExcerpt = false
): string {
  const lines: string[] = [`[Entry ${entry.id}]`];

  if (entry.source_title) lines.push(`Title: ${entry.source_title}`);
  if (entry.source_url) lines.push(`URL: ${entry.source_url}`);
  lines.push(`Captured: ${new Date(entry.captured_at).toISOString().split('T')[0]}`);

  for (const art of artifacts) {
    if (art.artifact_type === 'summary') {
      const p = art.payload as { summary?: string; bullets?: string[] } | null;
      if (p?.summary) lines.push(`Summary: ${p.summary}`);
      if (p?.bullets?.length) lines.push(`Key points:\n${p.bullets.map((b) => `  - ${b}`).join('\n')}`);
    }
    if (art.artifact_type === 'tags') {
      const p = art.payload as { tags?: Array<{ label: string }> } | null;
      if (p?.tags?.length) lines.push(`Tags: ${p.tags.map((t) => t.label).join(', ')}`);
    }
    if (art.artifact_type === 'entities') {
      const p = art.payload as { entities?: Array<{ label: string; type: string }> } | null;
      if (p?.entities?.length) {
        lines.push(`Entities: ${p.entities.map((e) => `${e.label} (${e.type})`).join(', ')}`);
      }
    }
  }

  // Include short excerpt of content text if no summary (omit when full text follows)
  const hasSummary = artifacts.some((a) => a.artifact_type === 'summary');
  if (!omitExcerpt && !hasSummary && entry.content_text) {
    const excerpt = entry.content_text.slice(0, 400);
    lines.push(`Excerpt: ${excerpt}${entry.content_text.length > 400 ? '…' : ''}`);
  }

  return lines.join('\n');
}

// ============================================================================
// Handler
// ============================================================================

export async function intelGenerateQuestionsHandler(ctx: JobContext): Promise<void> {
  logger.info({ job_id: ctx.jobId, pot_id: ctx.potId }, 'Starting intel question generation');

  if (!ctx.potId) {
    throw new Error('intel_generate_questions job requires pot_id');
  }
  const potId = ctx.potId;

  // 1. Claim the most recent queued run for this pot
  const db = getDatabase();
  const runRow = await db
    .selectFrom('intelligence_runs')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('status', '=', 'queued')
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst();

  if (!runRow) {
    logger.warn({ job_id: ctx.jobId, pot_id: potId }, 'No queued intel run found for pot; skipping');
    return;
  }

  const runId = runRow.id;
  const mode = runRow.mode as 'full' | 'digest';
  const customPrompt = (runRow.custom_prompt as string | null)?.trim() || null;
  const maxQuestions = Math.min(Math.max(Number(runRow.max_questions) || 2, 1), 20);

  // Mark run as running
  await updateIntelligenceRunStatus(runId, 'running');

  try {
    // 2. Load all valid entries (text with content, images, or audio)
    const allEntries = await listEntries({ pot_id: potId, limit: 500 });
    const validEntries = allEntries.filter(
      (e) => e.type !== 'link' && (e.content_text && e.content_text.length > 20 || e.type === 'image' || e.type === 'audio')
    );

    if (validEntries.length < 2) {
      logger.warn({ run_id: runId, pot_id: potId, count: validEntries.length }, 'Not enough entries for intel gen');
      await updateIntelligenceRunStatus(runId, 'done');
      return;
    }

    // 3. Build pot snapshot hash
    const potSnapshotHash = buildPotSnapshotHash(validEntries);

    // 4. Load AI preferences for model selection
    const prefs = await getAIPreferences();
    const model = prefs.task_models?.summarization ?? prefs.task_models?.linking ?? prefs.default_model ?? 'x-ai/grok-4.1-fast';
    const temperature = prefs.temperature ?? 0.3;
    const maxTokens = prefs.max_tokens ?? 3000;

    // 4a. Resolve effective role for this pot
    const pot = await getPotById(potId);
    const role = await resolveEffectiveRole(pot ?? { id: potId, role_ref: null });
    logger.info({ job_id: ctx.jobId, run_id: runId, role_ref: pot?.role_ref ?? null, role_hash: role.hash }, 'Resolved pot role');

    // 5. Load the prompt
    const prompt: PromptTemplate = loadPromptFromFile(
      join(PROMPTS_DIR, 'intel_question_gen', 'v1.md')
    );
    const promptVersion = String(prompt.metadata.version);

    // 6. Build pot snapshot text
    let potSnapshot: string;

    if (mode === 'full') {
      // Full mode: include all content text (omit excerpt from digest since full text follows)
      const parts: string[] = [];
      for (const entry of validEntries) {
        const artifacts = await listArtifactsForEntry(entry.id);
        const digest = buildEntryDigest(entry, artifacts, true);
        parts.push(digest);
        if (entry.content_text) {
          parts.push(`Full text:\n${entry.content_text}`);
        }
        parts.push('---');
      }
      potSnapshot = parts.join('\n');
    } else {
      // Digest mode (default): summaries + tags + entities + short excerpt
      const parts: string[] = [];
      for (const entry of validEntries) {
        const artifacts = await listArtifactsForEntry(entry.id);
        parts.push(buildEntryDigest(entry, artifacts));
        parts.push('---');
      }
      potSnapshot = parts.join('\n');
    }

    // 7. Estimate token count and check context
    const estimatedTokens = estimateTokens(potSnapshot);
    const contextLength = Number(runRow.context_length) || 32000;

    if (estimatedTokens > contextLength * 0.9) {
      logger.warn(
        { run_id: runId, estimated_tokens: estimatedTokens, context_length: contextLength },
        'Pot snapshot too large even in digest mode'
      );
      await updateIntelligenceRunStatus(
        runId,
        'failed',
        `Pot snapshot exceeds context window (estimated ${estimatedTokens} tokens, context ${contextLength})`
      );
      return;
    }

    // 8. Interpolate prompt and call AI
    const entryIdsList = validEntries.map((e) => e.id).join('\n');
    const messages = interpolatePrompt(prompt, {
      pot_snapshot: potSnapshot,
      entry_ids_list: entryIdsList,
      max_questions: maxQuestions,
    });

    // Inject pot role into base system prompt
    const baseSystemWithRole = injectRoleIntoSystemPrompt(messages.system, role.text);

    // Append the user's custom research focus to the system prompt if provided.
    // The schema reminder is repeated after the focus to prevent the model from
    // adopting a different output structure when the custom prompt is long or
    // describes a complex analytical framework.
    const systemContent = customPrompt
      ? `${baseSystemWithRole}\n\n## RESEARCH FOCUS\n\nThe user has specified the following research perspective and focus. Prioritize questions and leads that align with this focus:\n\n${customPrompt}\n\n---\n\nOUTPUT REMINDER: You MUST respond with valid JSON using ONLY this exact structure: {"questions": [...]}. Do NOT use any other root keys or structures regardless of the research focus above.`
      : baseSystemWithRole;

    if (customPrompt) {
      logger.info({ run_id: runId, focus_length: customPrompt.length }, 'Applying custom research focus');
    }

    const response = await createChatCompletion({
      model,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: messages.user },
      ],
      temperature: prompt.metadata.temperature ?? temperature,
      max_tokens: prompt.metadata.max_tokens ?? maxTokens,
      response_format: { type: 'json_object' },
    });

    // 9. Parse and validate response
    const raw = response.choices[0]?.message?.content ?? '{}';
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`intel_question_gen returned invalid JSON: ${raw.slice(0, 200)}`);
    }

    // Fallback extraction: if the model returned a different root structure
    // (e.g. {"pot_map": {...}}, {"items": [...]}, {"results": [...]}),
    // try to find a top-level array that looks like questions and normalise it.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (!Array.isArray(obj.questions)) {
        // Walk top-level values looking for an array of objects with a 'question' field
        for (const val of Object.values(obj)) {
          if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object' && val[0] !== null && 'question' in val[0]) {
            logger.warn({ run_id: runId, original_keys: Object.keys(obj) }, 'AI returned unexpected root structure; extracting questions array');
            parsed = { questions: val };
            break;
          }
          // Also handle one level of nesting (e.g. {"pot_map": {"questions": [...]}})
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            const nested = val as Record<string, unknown>;
            if (Array.isArray(nested.questions)) {
              logger.warn({ run_id: runId, original_keys: Object.keys(obj) }, 'AI returned nested questions structure; extracting');
              parsed = { questions: nested.questions };
              break;
            }
            for (const nestedVal of Object.values(nested)) {
              if (Array.isArray(nestedVal) && nestedVal.length > 0 && typeof nestedVal[0] === 'object' && nestedVal[0] !== null && 'question' in nestedVal[0]) {
                logger.warn({ run_id: runId, original_keys: Object.keys(obj) }, 'AI returned deeply nested questions; extracting');
                parsed = { questions: nestedVal };
                break;
              }
            }
          }
        }
      }
    }

    const validation = IntelQuestionGenResponseSchema.safeParse(parsed);
    if (!validation.success) {
      throw new Error(`intel_question_gen schema validation failed: ${validation.error.message}`);
    }

    const { questions: rawQuestions } = validation.data;
    // Enforce the user's requested limit — models reliably ignore prompt count instructions
    const questions = rawQuestions.slice(0, maxQuestions);
    if (rawQuestions.length > maxQuestions) {
      logger.info({ run_id: runId, raw_count: rawQuestions.length, capped_at: maxQuestions }, 'Capped questions to requested limit');
    } else {
      logger.info({ run_id: runId, raw_count: rawQuestions.length }, 'Got questions from AI');
    }

    // 10. Validate entry_ids are all from this pot
    const validEntryIdSet = new Set(validEntries.map((e) => e.id));
    const validQuestions = questions.filter((q) => {
      const allValid = q.entry_ids.every((id) => validEntryIdSet.has(id));
      if (!allValid) {
        logger.warn({ question: q.question, entry_ids: q.entry_ids }, 'Question references unknown entry IDs; skipping');
      }
      return allValid;
    });

    // 11. Dedupe and store
    let stored = 0;
    const enqueuedJobs: string[] = [];

    for (const q of validQuestions) {
      const sig = buildQuestionSignature(q.question, q.entry_ids, promptVersion);

      const known = await isKnownQuestion(potId, potSnapshotHash, sig);
      if (known) {
        logger.debug({ signature: sig }, 'Skipping already-known question');
        continue;
      }

      const question = await insertIntelligenceQuestion({
        run_id: runId,
        pot_id: potId,
        question_signature: sig,
        question_text: q.question,
        entry_ids: q.entry_ids,
        category: q.category,
        rationale: q.rationale,
      });

      await upsertKnownQuestion(potId, potSnapshotHash, sig, question.id);

      // Enqueue an answer job for this question.
      // The handler uses atomic-claim to pick up a queued question (no entry_id needed
      // — entry_id has a FK to entries and cannot store a question_id).
      const job = await enqueueJob({
        job_type: 'intel_answer_question',
        pot_id: potId,
        priority: 10,
      });
      enqueuedJobs.push(job.id);
      stored++;
    }

    logger.info({ run_id: runId, stored, skipped: validQuestions.length - stored }, 'Question generation done');

    // 12. Finish run
    await updateIntelligenceRunStatus(runId, 'done');

    await logAuditEvent({
      actor: 'system',
      action: 'intel_questions_generated',
      pot_id: potId,
      metadata: {
        run_id: runId,
        questions_stored: stored,
        questions_deduped: validQuestions.length - stored,
        jobs_enqueued: enqueuedJobs.length,
        model,
        prompt_version: promptVersion,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ run_id: runId, err }, 'Intel question generation failed');
    await updateIntelligenceRunStatus(runId, 'failed', msg);
    throw err;
  }
}
