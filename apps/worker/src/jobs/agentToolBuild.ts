/**
 * agent_tool_build Job Handler
 *
 * Orchestrates 5-stage tool building pipeline:
 * 1. Detect tool opportunity
 * 2. Generate tool spec
 * 3. Generate tool code
 * 4. Run static checker
 * 5. Create tool row, enqueue test job
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getAgentRun,
  getAgentConfig,
  updateAgentRunStatus,
  createAgentTool,
  createAgentArtifact,
  logAuditEvent,
  getAIPreferences,
  getPotById,
  listEntries,
  enqueueJob,
} from '@links/storage';
import { createChatCompletion, loadPromptFromFile } from '@links/ai';
import {
  AgentToolOpportunitySchema,
  AgentToolSpecSchema,
  AgentToolCodeBundleSchema,
} from '@links/core';
import { staticCheck } from './agentStaticCheck.js';
import path from 'node:path';
import process from 'node:process';

const logger = createLogger({ name: 'job:agent-tool-build' });
const DEFAULT_MODEL = 'google/gemini-2.0-flash-001';

interface Step {
  ts: number;
  phase: string;
  detail: string;
  ok: boolean;
}

function getPromptsDir(): string {
  if (process.env.PROMPTS_DIR) return process.env.PROMPTS_DIR;
  try {
    return path.join(path.dirname(process.execPath), 'resources', 'prompts');
  } catch {
    return path.join(process.cwd(), '../../apps/launcher/resources/prompts');
  }
}

function loadPrompt(promptsDir: string, name: string): { system: string; user: string } | null {
  try {
    const pt = loadPromptFromFile(path.join(promptsDir, name, 'v1.md'));
    const user = typeof pt.user === 'function' ? pt.user({}) : pt.user;
    return { system: pt.system, user };
  } catch {
    return null;
  }
}

export async function agentToolBuildHandler(ctx: JobContext): Promise<void> {
  const payload = ctx.payload as { run_id: string; pot_id: string };
  const { run_id: runId, pot_id: potId } = payload;
  const steps: Step[] = [];

  const addStep = (phase: string, detail: string, ok = true) => {
    steps.push({ ts: Date.now(), phase, detail, ok });
    logger.info({ run_id: runId, phase, detail, ok, msg: 'agent_tool_build step' });
  };

  logger.info({ job_id: ctx.jobId, run_id: runId, pot_id: potId, msg: 'Agent tool build start' });

  const run = await getAgentRun(runId);
  if (!run) {
    logger.error({ run_id: runId, msg: 'Agent run not found' });
    return;
  }

  const config = await getAgentConfig(potId);
  if (!config?.enabled || !config.allow_tool_building) {
    logger.info({ run_id: runId, msg: 'Tool building not allowed — skip' });
    await updateAgentRunStatus(runId, 'cancelled', { finished_at: Date.now() });
    return;
  }

  await updateAgentRunStatus(runId, 'running', { started_at: Date.now() });

  try {
    const prefs = await getAIPreferences();
    const modelId = prefs.agent_models?.tool_spec ?? prefs.default_model ?? DEFAULT_MODEL;
    const codegenModel = prefs.agent_models?.codegen ?? modelId;

    const pot = await getPotById(potId);
    const entriesList = await listEntries({ pot_id: potId, limit: 50 }).catch(() => []);
    const promptsDir = getPromptsDir();

    // Build pot digest for opportunity detection
    const potDigest = {
      pot: { id: potId, name: pot?.name ?? 'Unknown' },
      entry_count: entriesList.length,
      recent_entries: entriesList.slice(0, 20).map((e: any) => ({
        id: e.id,
        type: e.type,
        title: e.source_title,
        content: (e.content_text ?? '').slice(0, 200),
      })),
    };

    // Build pot context for spec + codegen
    const potContext = {
      pot_name: pot?.name ?? 'Unknown',
      entry_count: entriesList.length,
      goal: config.goal_text ?? pot?.name ?? 'Research pot',
    };

    // Stage 1: Detect opportunity
    await updateAgentRunStatus(runId, 'running', {
      progress: { phase: 'tool_opportunity_extract', steps },
    });

    const oppPrompt = loadPrompt(promptsDir, 'agent_tool_opportunity_extract');
    const oppSystem = oppPrompt?.system
      ?? `Analyze this research pot for repeated workflow patterns that could be automated with a safe, sandboxed tool. Pot: ${pot?.name}`;
    const oppUserTemplate = oppPrompt?.user ?? getDefaultOpportunityPrompt();
    const oppUserMsg = oppUserTemplate.replace('{{POT_DIGEST}}', JSON.stringify(potDigest, null, 2));

    const oppResponse = await createChatCompletion({
      model: modelId,
      messages: [
        { role: 'system', content: oppSystem },
        { role: 'user', content: oppUserMsg },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const oppRaw = oppResponse.choices[0]?.message?.content ?? '{}';
    let opportunity: any = {};
    try {
      const cleaned = oppRaw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
      const parsed = AgentToolOpportunitySchema.safeParse(JSON.parse(cleaned));
      if (parsed.success) opportunity = parsed.data;
    } catch { /* ignore */ }

    if (!opportunity.detected) {
      addStep('opportunity_detect', 'No automatable workflow detected in this pot', true);
      await updateAgentRunStatus(runId, 'done', {
        finished_at: Date.now(),
        progress: { phase: 'done', outcome: 'no_opportunity', steps },
      });
      logger.info({ run_id: runId, msg: 'No tool opportunity detected' });
      return;
    }

    addStep('opportunity_detect', `Detected: ${opportunity.workflow_name} (score: ${opportunity.utility_score ?? '?'})`, true);

    // Stage 2: Spec generation
    await updateAgentRunStatus(runId, 'running', {
      progress: { phase: 'tool_spec_generate', steps },
    });

    const specPrompt = loadPrompt(promptsDir, 'agent_tool_spec_generate');
    const specSystem = specPrompt?.system ?? 'Generate a tool specification for sandboxed execution. Output JSON only.';
    const specUserTemplate = specPrompt?.user ?? getDefaultSpecPrompt();
    const specUserMsg = specUserTemplate
      .replace('{{WORKFLOW_OPPORTUNITY}}', JSON.stringify(opportunity, null, 2))
      .replace('{{POT_CONTEXT}}', JSON.stringify(potContext, null, 2));

    const specResponse = await createChatCompletion({
      model: modelId,
      messages: [
        { role: 'system', content: specSystem },
        { role: 'user', content: specUserMsg },
      ],
      temperature: 0.2,
      max_tokens: 2000,
    });

    const specRaw = specResponse.choices[0]?.message?.content ?? '{}';
    let spec: any = null;
    try {
      const cleaned = specRaw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
      const parsed = AgentToolSpecSchema.safeParse(JSON.parse(cleaned));
      if (parsed.success) spec = parsed.data;
    } catch { /* ignore */ }

    if (!spec) {
      addStep('spec_generate', 'Tool spec generation failed — invalid JSON or schema mismatch', false);
      logger.error({ run_id: runId, raw: specRaw.slice(0, 300), msg: 'Tool spec generation failed' });
      await updateAgentRunStatus(runId, 'failed', {
        finished_at: Date.now(),
        progress: { phase: 'tool_spec_generate', outcome: 'spec_parse_failed', steps },
      });
      return;
    }

    addStep('spec_generate', `Spec OK: tool_key=${spec.tool_key}, lang=${spec.language}`, true);

    // Stage 3: Code generation
    await updateAgentRunStatus(runId, 'running', {
      progress: { phase: 'tool_code_generate', steps },
    });

    const codePromptFile = spec.language === 'python'
      ? 'agent_tool_code_generate_python'
      : 'agent_tool_code_generate_js';

    const codePromptData = loadPrompt(promptsDir, codePromptFile);
    const codeSystem = codePromptData?.system ?? 'Generate sandboxed tool code. Output JSON bundle only.';
    const codeUserTemplate = codePromptData?.user ?? getDefaultCodePrompt(spec.language);
    const codeUserMsg = codeUserTemplate
      .replace('{{TOOL_SPEC}}', JSON.stringify(spec, null, 2))
      .replace('{{POT_CONTEXT}}', JSON.stringify(potContext, null, 2));

    const codeResponse = await createChatCompletion({
      model: codegenModel,
      messages: [
        { role: 'system', content: codeSystem },
        { role: 'user', content: codeUserMsg },
      ],
      temperature: 0.1,
      max_tokens: 4000,
    });

    const codeRaw = codeResponse.choices[0]?.message?.content ?? '{}';
    let codeBundle: any = null;
    try {
      const cleaned = codeRaw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
      const parsed = AgentToolCodeBundleSchema.safeParse(JSON.parse(cleaned));
      if (parsed.success) codeBundle = parsed.data;
    } catch { /* ignore */ }

    if (!codeBundle?.main_code) {
      addStep('code_generate', 'Code generation failed — invalid JSON bundle or empty main_code', false);
      logger.error({ run_id: runId, raw: codeRaw.slice(0, 300), msg: 'Tool code generation failed' });
      await updateAgentRunStatus(runId, 'failed', {
        finished_at: Date.now(),
        progress: { phase: 'tool_code_generate', outcome: 'code_parse_failed', steps },
      });
      return;
    }

    addStep('code_generate', `Code OK: ${codeBundle.main_code.length} chars of ${spec.language}`, true);

    // Stage 4: Static check
    await updateAgentRunStatus(runId, 'running', {
      progress: { phase: 'tool_static_check', steps },
    });

    const staticResult = staticCheck(codeBundle.main_code);

    const buildReport = {
      opportunity,
      spec,
      static_check: staticResult,
      bundle_size: codeBundle.main_code.length,
    };

    const buildArtifact = await createAgentArtifact({
      pot_id: potId,
      run_id: runId,
      artifact_type: 'agent_tool_build_report',
      model_id: codegenModel,
      prompt_id: codePromptFile,
      prompt_version: 'v1',
      payload: buildReport,
    });

    if (!staticResult.passed) {
      const summary = staticResult.violations.map((v) => v.detail).join('; ');
      addStep('static_check', `FAILED: ${summary}`, false);
      logger.warn({ run_id: runId, violations: staticResult.violations.length, msg: 'Static check failed — tool rejected' });
      await updateAgentRunStatus(runId, 'done', {
        finished_at: Date.now(),
        progress: { phase: 'tool_static_check', outcome: 'static_check_failed', steps },
      });
      await logAuditEvent({
        actor: 'system',
        action: 'agent_tool_static_check_failed',
        pot_id: potId,
        metadata: { run_id: runId, violations: staticResult.violations },
      });
      return;
    }

    addStep('static_check', `Passed — 0 violations`, true);

    // Stage 5: Create tool row
    const tool = await createAgentTool({
      pot_id: potId,
      tool_key: spec.tool_key,
      name: spec.name,
      description: spec.description,
      language: spec.language,
      manifest: { main_code: codeBundle.main_code, helpers: codeBundle.helpers ?? [] },
      input_schema: spec.input_schema,
      output_schema: spec.output_schema,
      capabilities_required: spec.capabilities_required,
      sandbox_policy: spec.sandbox_policy,
      network_policy: spec.sandbox_policy?.network_policy ?? 'none',
      approval_required: true,
      created_by_run_id: runId,
      created_by_model_id: codegenModel,
      prompt_ids: [codePromptFile],
      source_refs: spec.source_refs ?? [],
    });

    const { updateAgentToolStatus, createToolVersion } = await import('@links/storage');
    // Snapshot current version before overwriting (version preservation)
    try {
      await createToolVersion(tool.id, buildArtifact.id);
      addStep('version_snapshot', `Preserved version ${tool.version} before testing`, true);
    } catch (verErr) {
      // Non-fatal — first version may not have existing state worth preserving
      addStep('version_snapshot', `Skipped: ${verErr instanceof Error ? verErr.message : String(verErr)}`, true);
    }
    await updateAgentToolStatus(tool.id, 'testing');

    addStep('tool_created', `Tool ${spec.tool_key} created (id: ${tool.id}) — status: testing`, true);

    // Enqueue test job
    await enqueueJob({
      job_type: 'agent_tool_test',
      payload: { run_id: runId, pot_id: potId, tool_id: tool.id, build_artifact_id: buildArtifact.id },
      priority: 20,
    });

    addStep('test_enqueued', `agent_tool_test job enqueued for tool ${tool.id}`, true);

    await updateAgentRunStatus(runId, 'done', {
      finished_at: Date.now(),
      progress: {
        phase: 'tool_build_done',
        tool_id: tool.id,
        build_artifact_id: buildArtifact.id,
        steps,
      },
    });

    await logAuditEvent({
      actor: 'system',
      action: 'agent_tool_built',
      pot_id: potId,
      metadata: { run_id: runId, tool_id: tool.id, tool_key: spec.tool_key },
    });

    logger.info({ run_id: runId, pot_id: potId, tool_id: tool.id, msg: 'Agent tool build complete' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ ts: Date.now(), phase: 'error', detail: msg, ok: false });
    logger.error({ run_id: runId, err: msg, msg: 'Agent tool build failed' });
    await updateAgentRunStatus(runId, 'failed', {
      finished_at: Date.now(),
      progress: { phase: 'error', error: msg, steps },
    });
  }
}

// ── Default prompts ────────────────────────────────────────────────────────

function getDefaultOpportunityPrompt(): string {
  return `Analyze these pot entries for repeated workflow patterns that a small sandboxed tool could automate.

POT DIGEST:
{{POT_DIGEST}}

Output JSON:
{
  "detected": true/false,
  "workflow_name": "...",
  "workflow_description": "...",
  "evidence_snippets": ["..."],
  "expected_language": "javascript",
  "safety_class": "low",
  "utility_score": 0.8
}`;
}

function getDefaultSpecPrompt(): string {
  return `Generate a tool specification for this detected opportunity:

WORKFLOW OPPORTUNITY:
{{WORKFLOW_OPPORTUNITY}}

POT CONTEXT:
{{POT_CONTEXT}}

The tool must:
- Use only these capabilities: entries.search, entries.read, artifacts.createDerived, notify.emitCandidate
- Have no file system or network access
- Run in under 10 seconds
- Be deterministic

Output JSON matching AgentToolSpec schema.`;
}

function getDefaultCodePrompt(language: string): string {
  return `Generate ${language} code for this tool spec:

TOOL SPEC:
{{TOOL_SPEC}}

POT CONTEXT:
{{POT_CONTEXT}}

Rules:
- No imports of fs, os, subprocess, net, http, https, child_process
- No eval, exec, spawn, open()
- No process.env, process.exit
- Max 50KB code
- Use ctx.entries.search(), ctx.entries.read(), ctx.notify.emitCandidate() for all operations

Output JSON:
{
  "main_code": "...",
  "helpers": [],
  "readme": "..."
}`;
}
