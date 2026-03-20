import { createChatCompletion, formatUntrustedContext, interpolatePrompt, loadPromptFromFile } from '@links/ai';
import type { PromptTemplate } from '@links/ai';
import type { JobContext } from '@links/storage';
import {
  getAIPreferences,
  getRun,
  listEntries,
  getLatestAnswers,
  listFiles,
  saveFile,
  saveQuestions,
  updateRunStatus,
} from '@links/storage';
import { PlanIndexSchema, ProjectQuestionsSchema } from '@links/core';
import { buildDefaultPlanIndex } from './planningUtils.js';
import { join } from 'node:path';
import { getPromptsDir } from './utils/promptResolver.js';
const PROMPTS_DIR = getPromptsDir();

async function buildPotContext(potId: string): Promise<string> {
  const entries = await listEntries({ pot_id: potId, limit: 200 });
  const blocks = entries
    .filter((e) => e.content_text)
    .map((e) => `Entry ${e.id}\nTitle: ${e.source_title ?? 'N/A'}\n${e.content_text?.slice(0, 1200) ?? ''}`);
  return formatUntrustedContext(blocks.join('\n\n---\n\n').slice(0, 120000));
}

function docsContext(files: Awaited<ReturnType<typeof listFiles>>): string {
  return formatUntrustedContext(
    files
      .filter((f) => !!f.content_text)
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((f) => `# ${f.path}\n\n${f.content_text}`)
      .join('\n\n')
      .slice(0, 160000)
  );
}

async function getPromptConfig(promptPath: string, prefs: Awaited<ReturnType<typeof getAIPreferences>>) {
  const prompt: PromptTemplate = loadPromptFromFile(promptPath);
  const model = prefs.task_models?.linking ?? prefs.default_model ?? 'x-ai/grok-4.1-fast';
  return { prompt, model, temperature: prompt.metadata.temperature ?? prefs.temperature ?? 0.2, maxTokens: prompt.metadata.max_tokens ?? prefs.max_tokens ?? 3000 };
}

export async function planningGenerateQuestionsHandler(ctx: JobContext): Promise<void> {
  const runId = String(ctx.payload?.runId ?? '');
  const revision = Number(ctx.payload?.revision ?? 0);
  if (!runId || !revision) throw new Error('planning_generate_questions requires payload.runId and payload.revision');

  const run = await getRun(runId);
  if (!run) throw new Error(`Planning run not found: ${runId}`);

  const prefs = await getAIPreferences();
  const potContext = await buildPotContext(run.pot_id);
  const cfg = await getPromptConfig(join(PROMPTS_DIR, 'planning_questions', 'v1.md'), prefs);
  const messages = interpolatePrompt(cfg.prompt, {
    project_name: run.project_name,
    project_type: run.project_type,
    pot_context: potContext,
  });

  const response = await createChatCompletion({
    model: cfg.model,
    messages: [{ role: 'system', content: messages.system }, { role: 'user', content: messages.user }],
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0]?.message?.content ?? '{}';
  const parsed = ProjectQuestionsSchema.parse(JSON.parse(raw));
  await saveQuestions(runId, revision, parsed);
  await updateRunStatus(runId, 'questions_generated');
}

export async function planningGeneratePlanHandler(ctx: JobContext): Promise<void> {
  const runId = String(ctx.payload?.runId ?? '');
  const revision = Number(ctx.payload?.revision ?? 0);
  if (!runId || !revision) throw new Error('planning_generate_plan requires payload.runId and payload.revision');

  const run = await getRun(runId);
  if (!run) throw new Error(`Planning run not found: ${runId}`);

  const answers = await getLatestAnswers(runId, revision);
  const existingFiles = await listFiles(runId, revision);
  const feedback = run.rejected_reason ?? '';
  const prefs = await getAIPreferences();

  const cfg = await getPromptConfig(join(PROMPTS_DIR, 'planning_plan', 'v1.md'), prefs);
  const messages = interpolatePrompt(cfg.prompt, {
    project_name: run.project_name,
    project_type: run.project_type,
    pot_context: await buildPotContext(run.pot_id),
    qa_json: JSON.stringify(answers?.answers ?? {}, null, 2),
    rejection_feedback: feedback,
  });

  const response = await createChatCompletion({
    model: cfg.model,
    messages: [{ role: 'system', content: messages.system }, { role: 'user', content: messages.user }],
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    response_format: { type: 'json_object' },
  });

  const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}') as { plan_markdown?: string; plan_index?: unknown };
  const planMarkdown = parsed.plan_markdown ?? '# Plan\n\nPlan generation returned empty content.';
  const planIndex = PlanIndexSchema.safeParse(parsed.plan_index).success
    ? PlanIndexSchema.parse(parsed.plan_index)
    : buildDefaultPlanIndex(run.project_name, run.project_type);

  await saveFile(runId, revision, 'plan.md', 'plan_md', planMarkdown, undefined, {
    model_id: cfg.model,
    prompt_id: cfg.prompt.metadata.id,
    prompt_version: String(cfg.prompt.metadata.version),
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
  });

  await saveFile(runId, revision, 'plan.index.json', 'plan_index_json', JSON.stringify(planIndex, null, 2), undefined, {
    model_id: cfg.model,
    prompt_id: cfg.prompt.metadata.id,
    prompt_version: String(cfg.prompt.metadata.version),
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
  });

  const docIndexContent = JSON.stringify({ existing_files: existingFiles.map((f) => f.path) }, null, 2);
  await saveFile(runId, revision, 'docs.index.json', 'manifest_json', docIndexContent);

  await updateRunStatus(runId, 'plan_generated');
}

export async function planningGeneratePhaseHandler(ctx: JobContext): Promise<void> {
  const runId = String(ctx.payload?.runId ?? '');
  const revision = Number(ctx.payload?.revision ?? 0);
  const phaseNumber = Number(ctx.payload?.phaseNumber ?? 0);
  if (!runId || !revision || !phaseNumber) throw new Error('planning_generate_phase requires runId/revision/phaseNumber payload');

  const run = await getRun(runId);
  if (!run) throw new Error(`Planning run not found: ${runId}`);

  const files = await listFiles(runId, revision);
  const priorContext = docsContext(files.filter((f) => f.path === 'plan.md' || f.path === 'plan.index.json' || /^phase_\d+\.md$/.test(f.path) || f.path.startsWith('docs/')));

  const prefs = await getAIPreferences();
  const cfg = await getPromptConfig(join(PROMPTS_DIR, 'planning_phase', 'v1.md'), prefs);
  const messages = interpolatePrompt(cfg.prompt, {
    project_name: run.project_name,
    phase_number: phaseNumber,
    docs_context: priorContext,
  });

  const response = await createChatCompletion({
    model: cfg.model,
    messages: [{ role: 'system', content: messages.system }, { role: 'user', content: messages.user }],
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
  });

  const content = response.choices[0]?.message?.content ?? `# Phase ${phaseNumber}\n\nNo content generated.`;
  await saveFile(runId, revision, `phase_${phaseNumber}.md`, 'phase_md', content, undefined, {
    model_id: cfg.model,
    prompt_id: cfg.prompt.metadata.id,
    prompt_version: String(cfg.prompt.metadata.version),
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
  });
}

export async function planningGenerateDocHandler(ctx: JobContext): Promise<void> {
  const runId = String(ctx.payload?.runId ?? '');
  const revision = Number(ctx.payload?.revision ?? 0);
  const docPath = String(ctx.payload?.docPath ?? '');
  if (!runId || !revision || !docPath) throw new Error('planning_generate_doc requires runId/revision/docPath payload');

  const run = await getRun(runId);
  if (!run) throw new Error(`Planning run not found: ${runId}`);

  const files = await listFiles(runId, revision);
  const priorContext = docsContext(files.filter((f) => f.path === 'plan.md' || f.path === 'plan.index.json' || /^phase_\d+\.md$/.test(f.path) || f.path.startsWith('docs/')));

  const prefs = await getAIPreferences();
  const cfg = await getPromptConfig(join(PROMPTS_DIR, 'planning_doc', 'v1.md'), prefs);
  const messages = interpolatePrompt(cfg.prompt, {
    project_name: run.project_name,
    doc_path: docPath,
    docs_context: priorContext,
  });

  const response = await createChatCompletion({
    model: cfg.model,
    messages: [{ role: 'system', content: messages.system }, { role: 'user', content: messages.user }],
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
  });

  const content = response.choices[0]?.message?.content ?? `# ${docPath}\n\nNo content generated.`;
  const normalized = docPath.startsWith('docs/') ? docPath : `docs/${docPath}`;
  await saveFile(runId, revision, normalized, 'doc_md', content, undefined, {
    model_id: cfg.model,
    prompt_id: cfg.prompt.metadata.id,
    prompt_version: String(cfg.prompt.metadata.version),
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
  });
}
