/**
 * agent_heartbeat Job Handler — Agentic Loop
 *
 * Bounded agentic loop: Gather → Enrich → Reflect → Decide → Act → loop.
 *
 * Budget system respects mode (quiet/balanced/bold) and config flags:
 *   - quiet:    1 iteration, 0 tool runs, 2 AI calls (~60s)
 *   - balanced: 2 iterations, 3 tool runs, 5 AI calls (~120s)
 *   - bold:     3 iterations, 5 tool runs, 8 AI calls (~180s)
 *
 * Tool execution only happens when config.allow_auto_run_low_risk_tools is true
 * and budget.allowToolExec is true (balanced/bold mode).
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getAgentRun,
  getAgentConfig,
  updateAgentRunStatus,
  insertAgentCandidates,
  markCandidateSelected,
  markCandidateDelivered,
  createAgentArtifact,
  hasDeliveredTodayForPot,
  getFeedbackHistory,
  getFeedbackTypePreferences,
  computeCandidateSignature,
  logAuditEvent,
  getAIPreferences,
  getPotById,
  listEntries,
  listDykItems,
  listAgentCandidates,
  listAgentTools,
  getAgentArtifactsByToolId,
  hasRecentToolBuild,
  createAgentRun,
  createAgentToolRun,
  updateAgentToolRunStatus,
  updateAgentToolStatus,
  enqueueJob,
  listArtifactsForPot,
  listLinksForPot,
  listAgentSnapshotsByPot,
  listCrossPotTools,
} from '@links/storage';
import { createChatCompletion, loadPromptFromFile } from '@links/ai';
import {
  AgentReflectionAiOutputSchema,
  AgentToolOpportunitySchema,
  AgentDecisionSchema,
} from '@links/core';
import type { CreateAgentCandidateInput } from '@links/storage';
import { runToolWithPreloadedData } from './agentSandbox.js';
import type { PreloadedPotData } from './agentSandbox.js';
import path from 'node:path';
import process from 'node:process';

const logger = createLogger({ name: 'job:agent-heartbeat' });

const CONFIDENCE_NOVELTY_THRESHOLD = 0.3;
const DEFAULT_MODEL = 'google/gemini-2.0-flash-001';
const TOOL_BUILD_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

// ── Types ─────────────────────────────────────────────────────────────────

interface Step {
  ts: number;
  phase: string;
  detail: string;
  ok: boolean;
}

interface BudgetCounters {
  startTime: number;
  toolRuns: number;
  aiCalls: number;
  iterations: number;
}

interface BudgetLimits {
  maxIterations: number;
  maxToolRuns: number;
  maxAiCalls: number;
  maxWallTimeMs: number;
  allowToolExec: boolean;
  allowToolBuild: boolean;
}

interface ToolOutput {
  tool_id: string;
  tool_name: string;
  tool_key: string;
  output: string;
  fresh: boolean;
  wall_time_ms?: number;
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getPromptsDir(): string {
  if (process.env.PROMPTS_DIR) return process.env.PROMPTS_DIR;
  try {
    return path.join(path.dirname(process.execPath), 'resources', 'prompts');
  } catch {
    return path.join(process.cwd(), '../../apps/launcher/resources/prompts');
  }
}

function getBudgetForMode(mode: string, config: any): BudgetLimits {
  const autoRunAllowed = config.allow_auto_run_low_risk_tools === true;
  const toolBuildAllowed = config.allow_tool_building === true;

  switch (mode) {
    case 'quiet':
      return {
        maxIterations: 1,
        maxToolRuns: 0,
        maxAiCalls: 2,
        maxWallTimeMs: 60_000,
        allowToolExec: false,
        allowToolBuild: false,
      };
    case 'bold':
      return {
        maxIterations: 3,
        maxToolRuns: autoRunAllowed ? 5 : 0,
        maxAiCalls: 8,
        maxWallTimeMs: 180_000,
        allowToolExec: autoRunAllowed,
        allowToolBuild: toolBuildAllowed,
      };
    case 'balanced':
    default:
      return {
        maxIterations: 2,
        maxToolRuns: autoRunAllowed ? 3 : 0,
        maxAiCalls: 5,
        maxWallTimeMs: 120_000,
        allowToolExec: autoRunAllowed,
        allowToolBuild: false,
      };
  }
}

function hasBudget(counters: BudgetCounters, budget: BudgetLimits): boolean {
  if (counters.iterations >= budget.maxIterations) return false;
  if (counters.aiCalls >= budget.maxAiCalls) return false;
  if (Date.now() - counters.startTime >= budget.maxWallTimeMs) return false;
  return true;
}

function hasToolBudget(counters: BudgetCounters, budget: BudgetLimits): boolean {
  if (!budget.allowToolExec) return false;
  if (counters.toolRuns >= budget.maxToolRuns) return false;
  if (Date.now() - counters.startTime >= budget.maxWallTimeMs - 5000) return false; // 5s safety margin
  return true;
}

// ── Main handler ──────────────────────────────────────────────────────────

export async function agentHeartbeatHandler(ctx: JobContext): Promise<void> {
  const payload = ctx.payload as {
    run_id: string;
    pot_id: string;
    is_bridge?: boolean;
    bridge_pot_ids?: string[];
  };
  const { run_id: runId, pot_id: potId } = payload;
  const steps: Step[] = [];

  const addStep = (phase: string, detail: string, ok = true) => {
    steps.push({ ts: Date.now(), phase, detail, ok });
    logger.info({ run_id: runId, phase, detail, ok, msg: 'agent_heartbeat step' });
  };

  logger.info({ job_id: ctx.jobId, run_id: runId, pot_id: potId, msg: 'Agent heartbeat start' });

  // ── SETUP ───────────────────────────────────────────────────────────────

  const run = await getAgentRun(runId);
  if (!run) {
    logger.error({ run_id: runId, msg: 'Agent run not found' });
    return;
  }

  const config = await getAgentConfig(potId);
  if (!config || !config.enabled) {
    logger.info({ run_id: runId, pot_id: potId, msg: 'Agent kill switch — config disabled' });
    await updateAgentRunStatus(runId, 'cancelled', { finished_at: Date.now() });
    await logAuditEvent({
      actor: 'system',
      action: 'agent_kill_switch_triggered',
      pot_id: potId,
      metadata: { run_id: runId },
    });
    return;
  }

  await updateAgentRunStatus(runId, 'running', { started_at: Date.now() });

  const budget = getBudgetForMode(config.mode, config);
  const counters: BudgetCounters = {
    startTime: Date.now(),
    toolRuns: 0,
    aiCalls: 0,
    iterations: 0,
  };

  try {
    // ── Load base data ────────────────────────────────────────────────────

    const pot = await getPotById(potId);
    if (!pot) throw new Error(`Pot not found: ${potId}`);

    const [entriesList, dykItems, feedbackHistory, typePrefs, priorCandidatesResult, activeToolsResult, allArtifacts] =
      await Promise.all([
        listEntries({ pot_id: potId, limit: 30 }).catch(() => []),
        listDykItems(potId, { limit: 20 }).catch(() => []),
        getFeedbackHistory(potId).catch(() => []),
        getFeedbackTypePreferences(potId).catch(() => ({ preferred_types: [], avoid_types: [], type_counts: {} })),
        listAgentCandidates(potId, { status: 'delivered', limit: 10 }).catch(() => ({ candidates: [], total: 0 })),
        listAgentTools(potId, { status: 'active' }).catch(() => ({ tools: [], total: 0 })),
        listArtifactsForPot(potId).catch(() => []),
      ]);

    // Extract tags summary from derived artifacts
    const tagArtifacts = allArtifacts.filter((a) => a.artifact_type === 'tags');
    const tagCounts: Record<string, number> = {};
    for (const art of tagArtifacts) {
      const payload = art.payload as any;
      if (Array.isArray(payload?.tags)) {
        for (const tag of payload.tags) {
          const tagName = typeof tag === 'string' ? tag : tag?.name ?? String(tag);
          tagCounts[tagName] = (tagCounts[tagName] ?? 0) + 1;
        }
      }
    }
    const topTags = Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));

    // Extract entities summary from derived artifacts
    const entityArtifacts = allArtifacts.filter((a) => a.artifact_type === 'entities');
    const entityCounts: Record<string, number> = {};
    for (const art of entityArtifacts) {
      const payload = art.payload as any;
      if (Array.isArray(payload?.entities)) {
        for (const ent of payload.entities) {
          const name = ent?.name ?? String(ent);
          entityCounts[name] = (entityCounts[name] ?? 0) + 1;
        }
      }
    }
    const topEntities = Object.entries(entityCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([name, count]) => ({ name, count }));

    // Build preloaded snapshot for tool sandbox (avoid per-tool DB re-reads)
    const preloadedLinks = await listLinksForPot(potId).catch(() => []);
    const preloadedData: PreloadedPotData = {
      potId,
      entries: entriesList.map((e: any) => ({
        id: e.id,
        type: e.type,
        source_title: e.source_title ?? null,
        content_text: e.content_text ?? null,
      })),
      artifacts: allArtifacts.map((a: any) => ({
        id: a.id,
        artifact_type: a.artifact_type,
        payload: a.payload,
      })),
      links: preloadedLinks.map((l: any) => ({
        id: l.id,
        src_entry_id: l.src_entry_id,
        dst_entry_id: l.dst_entry_id,
        link_type: l.link_type,
        rationale: l.rationale ?? null,
      })),
    };

    // ── Bridge mode: load cross-pot data ────────────────────────────────
    let bridgeDigestExtra: Record<string, unknown> | null = null;
    let crossPotToolsList: any[] = [];

    if (payload.is_bridge && payload.bridge_pot_ids && payload.bridge_pot_ids.length > 1) {
      const otherPotIds = payload.bridge_pot_ids.filter((id) => id !== potId);
      addStep('bridge_setup', `Bridge mode: loading ${otherPotIds.length} additional pots`);

      const bridgeEntries: any[] = [];
      const bridgeTags: Record<string, number> = {};
      const bridgeEntities: Record<string, number> = {};

      for (const bPotId of otherPotIds) {
        try {
          const [bEntries, bArtifacts] = await Promise.all([
            listEntries({ pot_id: bPotId, limit: 20 }).catch(() => []),
            listArtifactsForPot(bPotId).catch(() => []),
          ]);

          for (const e of bEntries) {
            bridgeEntries.push({ ...(e as any), source_pot_id: bPotId });
          }

          for (const art of bArtifacts.filter((a) => a.artifact_type === 'tags')) {
            const p = art.payload as any;
            if (Array.isArray(p?.tags)) {
              for (const tag of p.tags) {
                const name = typeof tag === 'string' ? tag : tag?.name ?? String(tag);
                bridgeTags[name] = (bridgeTags[name] ?? 0) + 1;
              }
            }
          }

          for (const art of bArtifacts.filter((a) => a.artifact_type === 'entities')) {
            const p = art.payload as any;
            if (Array.isArray(p?.entities)) {
              for (const ent of p.entities) {
                const name = ent?.name ?? String(ent);
                bridgeEntities[name] = (bridgeEntities[name] ?? 0) + 1;
              }
            }
          }
        } catch (err) {
          addStep('bridge_load', `Failed to load pot ${bPotId}: ${err instanceof Error ? err.message : String(err)}`, false);
        }
      }

      // Load cross-pot tools
      crossPotToolsList = await listCrossPotTools(payload.bridge_pot_ids).catch(() => []);

      bridgeDigestExtra = {
        bridge_pot_ids: payload.bridge_pot_ids,
        bridge_entries: bridgeEntries.slice(0, 30).map((e: any) => ({
          id: e.id,
          type: e.type,
          source_title: e.source_title,
          content_snippet: (e.content_text ?? '').slice(0, 300),
          source_pot_id: e.source_pot_id,
        })),
        bridge_top_tags: Object.entries(bridgeTags)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 15)
          .map(([tag, count]) => ({ tag, count })),
        bridge_top_entities: Object.entries(bridgeEntities)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 15)
          .map(([name, count]) => ({ name, count })),
        cross_pot_tools: crossPotToolsList.map((t: any) => ({
          id: t.id,
          name: t.name,
          tool_key: t.tool_key,
          pot_id: t.pot_id,
        })),
      };

      addStep('bridge_loaded', `${bridgeEntries.length} bridge entries, ${crossPotToolsList.length} cross-pot tools`);
    }

    // Load latest snapshot manifest for richer digest
    let latestSnapshotManifest: Record<string, unknown> | null = null;
    try {
      const recentSnapshots = await listAgentSnapshotsByPot(potId, 1);
      if (recentSnapshots[0]?.manifest) {
        latestSnapshotManifest = recentSnapshots[0].manifest as Record<string, unknown>;
      }
    } catch { /* non-fatal */ }

    // Resolve models
    const prefs = await getAIPreferences();
    const reflectionModelId = prefs.agent_models?.reflection ?? prefs.default_model ?? DEFAULT_MODEL;
    const decideModelId = prefs.agent_models?.tool_spec ?? prefs.default_model ?? DEFAULT_MODEL;
    const opportunityModelId = prefs.agent_models?.tool_spec ?? prefs.default_model ?? DEFAULT_MODEL;
    const promptsDir = getPromptsDir();

    // ── PHASE 1: GATHER ───────────────────────────────────────────────────

    const allToolOutputs: ToolOutput[] = [];
    const activeTools = activeToolsResult.tools.slice(0, 10);

    if (budget.allowToolExec && activeTools.length > 0) {
      await updateAgentRunStatus(runId, 'running', {
        progress: { phase: 'tool_gather' },
      });

      for (const tool of activeTools) {
        if (!hasToolBudget(counters, budget)) break;

        // Only run tools with safety_class 'low'
        const testSummary = tool.test_summary as any;
        const safetyClass = testSummary?.safety_class ?? 'medium';
        if (safetyClass !== 'low') continue;

        try {
          const manifest = tool.manifest as any;
          const mainCode = manifest?.main_code ?? '';
          if (!mainCode) continue;

          const policy = tool.sandbox_policy as any;

          // Create tool run record
          const toolRun = await createAgentToolRun({
            pot_id: potId,
            tool_id: tool.id,
            tool_version: tool.version,
            agent_run_id: runId,
            trigger_type: 'heartbeat',
            input_payload: {},
          });
          await updateAgentToolRunStatus(toolRun.id, 'running');

          const sandboxResult = await runToolWithPreloadedData(mainCode, policy, preloadedData);
          counters.toolRuns++;

          const succeeded = !sandboxResult.error;

          // Store artifacts
          const [logsArtifact, outputArtifact] = await Promise.all([
            createAgentArtifact({
              pot_id: potId,
              run_id: runId,
              tool_id: tool.id,
              artifact_type: 'agent_tool_logs',
              payload: { logs: sandboxResult.logs, wall_time_ms: sandboxResult.wallTimeMs, error: sandboxResult.error },
            }),
            createAgentArtifact({
              pot_id: potId,
              run_id: runId,
              tool_id: tool.id,
              artifact_type: 'agent_tool_output',
              payload: { output: sandboxResult.output, error: sandboxResult.error },
            }),
          ]);

          await updateAgentToolRunStatus(toolRun.id, succeeded ? 'done' : 'failed', {
            finished_at: Date.now(),
            output_artifact_id: outputArtifact.id,
            logs_artifact_id: logsArtifact.id,
            budget_usage: { wall_time_ms: sandboxResult.wallTimeMs },
          });

          // Update tool stats
          await updateAgentToolStatus(tool.id, 'active', {
            last_run_at: Date.now(),
            last_success_at: succeeded ? Date.now() : undefined,
          });

          allToolOutputs.push({
            tool_id: tool.id,
            tool_name: tool.name,
            tool_key: tool.tool_key,
            output: JSON.stringify(sandboxResult.output).slice(0, 2000),
            fresh: true,
            wall_time_ms: sandboxResult.wallTimeMs,
            error: sandboxResult.error,
          });

          addStep(
            'tool_gather',
            `${tool.name}: ${succeeded ? 'OK' : 'FAIL'} (${sandboxResult.wallTimeMs}ms)`,
            succeeded,
          );
        } catch (err) {
          addStep('tool_gather', `${tool.name}: error — ${err instanceof Error ? err.message : String(err)}`, false);
        }
      }
    }

    // Load stale tool outputs for tools we didn't run
    const freshToolIds = new Set(allToolOutputs.map((t) => t.tool_id));
    for (const tool of activeTools) {
      if (freshToolIds.has(tool.id)) continue;
      const toolArtifacts = await getAgentArtifactsByToolId(tool.id, 'agent_tool_output', 1).catch(() => []);
      const latest = toolArtifacts[0];
      if (latest) {
        allToolOutputs.push({
          tool_id: tool.id,
          tool_name: tool.name,
          tool_key: tool.tool_key,
          output: JSON.stringify(latest.payload).slice(0, 2000),
          fresh: false,
        });
      }
    }

    addStep('digest_built', `${entriesList.length} entries, ${topTags.length} tags, ${topEntities.length} entities, ${activeTools.length} active tools, ${allToolOutputs.filter((t) => t.fresh).length} fresh tool runs`);

    // ── AGENTIC LOOP ──────────────────────────────────────────────────────

    let allCandidateInputs: CreateAgentCandidateInput[] = [];
    const feedbackCounts = aggregateFeedbackCounts(feedbackHistory);

    while (hasBudget(counters, budget)) {
      counters.iterations++;

      // ── PHASE 2: ENRICH ───────────────────────────────────────────────
      const potDigest = buildPotDigest(
        pot,
        config,
        entriesList,
        dykItems,
        feedbackHistory,
        priorCandidatesResult.candidates,
        topTags,
        topEntities,
        allToolOutputs,
        typePrefs,
        { latestSnapshotManifest: latestSnapshotManifest, bridgeDigest: bridgeDigestExtra },
      );

      // ── PHASE 3: REFLECT ──────────────────────────────────────────────
      await updateAgentRunStatus(runId, 'running', {
        progress: { phase: 'reflection_generate', iteration: counters.iterations },
        model_id: reflectionModelId,
      });

      let promptUserTemplate: string;
      let promptSystemStr: string;
      try {
        const promptTemplate = loadPromptFromFile(
          path.join(promptsDir, 'agent_reflection_generate', 'v1.md'),
        );
        promptUserTemplate = typeof promptTemplate.user === 'function'
          ? promptTemplate.user({})
          : promptTemplate.user;
        promptSystemStr = promptTemplate.system;
      } catch {
        promptUserTemplate = getDefaultReflectionPrompt();
        promptSystemStr = buildSystemMessage(pot, config, typePrefs);
      }

      const systemMsg = promptSystemStr || buildSystemMessage(pot, config, typePrefs);
      const userMsg = promptUserTemplate
        .replace('{{POT_GOAL}}', config.goal_text ?? pot.name ?? 'Research pot')
        .replace('{{POT_DIGEST}}', JSON.stringify(potDigest, null, 2));

      const aiResponse = await createChatCompletion({
        model: reflectionModelId,
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.3,
        max_tokens: 3000,
      });
      counters.aiCalls++;

      const rawContent = aiResponse.choices[0]?.message?.content ?? '';

      let aiOutput: { candidates: any[]; digest_summary?: string };
      try {
        const cleaned = rawContent.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
        const parsed = JSON.parse(cleaned);
        const validated = AgentReflectionAiOutputSchema.safeParse(parsed);
        if (validated.success) {
          aiOutput = validated.data;
        } else {
          aiOutput = { candidates: parsed.candidates ?? parsed ?? [] };
        }
      } catch (err) {
        logger.warn({ run_id: runId, err, msg: 'Failed to parse AI reflection output' });
        aiOutput = { candidates: [] };
      }

      // Score + dedup this iteration's candidates
      for (const c of aiOutput.candidates) {
        if (!c.title || !c.body || !c.candidate_type) continue;
        const sig = computeCandidateSignature(c.title, c.body, c.candidate_type);
        const fatigueScore = computeFatigueScore(c.title, feedbackCounts);
        const finalScore = computeFinalScore(c, fatigueScore, typePrefs);

        allCandidateInputs.push({
          candidate_type: c.candidate_type,
          title: c.title,
          body: c.body,
          confidence: c.confidence ?? 0.5,
          novelty: c.novelty ?? 0.5,
          relevance: c.relevance ?? 0.5,
          evidence_score: c.evidence_score ?? 0.5,
          cost_score: 0.5,
          fatigue_score: fatigueScore,
          final_score: finalScore,
          status: 'pending',
          signature: sig,
          source_refs: c.source_refs ?? [],
          launch_payload: c.launch_payload ?? null,
          next_eligible_at: 0,
        });
      }

      addStep(
        'reflection',
        `Iteration ${counters.iterations}: ${aiOutput.candidates.length} candidates via ${reflectionModelId}`,
      );

      // Store reflection artifact
      await createAgentArtifact({
        pot_id: potId,
        run_id: runId,
        artifact_type: 'agent_reflection',
        model_id: reflectionModelId,
        prompt_id: 'agent_reflection_generate',
        prompt_version: 'v1',
        payload: {
          candidates_count: aiOutput.candidates.length,
          iteration: counters.iterations,
          digest_summary: aiOutput.digest_summary ?? null,
        },
      });

      // ── PHASE 4: DECIDE ─────────────────────────────────────────────
      // Only run decide if budget allows more iterations
      if (!hasBudget(counters, budget)) break;

      await updateAgentRunStatus(runId, 'running', {
        progress: { phase: 'decide', iteration: counters.iterations },
      });

      const decision = await decideNextAction(
        allCandidateInputs,
        allToolOutputs,
        activeTools,
        decideModelId,
        counters,
        budget,
        config,
        promptsDir,
      );
      counters.aiCalls++;

      addStep('decide', `${decision.action}${decision.tool_id ? ': ' + (activeTools.find((t) => t.id === decision.tool_id)?.name ?? decision.tool_id) : ''} — ${decision.rationale}`);

      if (decision.action === 'done') {
        break;
      }

      if (decision.action === 'run_tool' && decision.tool_id) {
        // ── PHASE 5: ACT — run specific tool inline ───────────────────
        if (!hasToolBudget(counters, budget)) break;

        const targetTool = activeTools.find((t) => t.id === decision.tool_id);
        if (targetTool) {
          try {
            const manifest = targetTool.manifest as any;
            const mainCode = manifest?.main_code ?? '';
            const policy = targetTool.sandbox_policy as any;
            const toolInput = (decision.tool_input ?? {}) as Record<string, unknown>;

            const toolRun = await createAgentToolRun({
              pot_id: potId,
              tool_id: targetTool.id,
              tool_version: targetTool.version,
              agent_run_id: runId,
              trigger_type: 'heartbeat',
              input_payload: toolInput,
            });
            await updateAgentToolRunStatus(toolRun.id, 'running');

            const sandboxResult = await runToolWithPreloadedData(mainCode, policy, preloadedData, toolInput);
            counters.toolRuns++;

            const succeeded = !sandboxResult.error;

            const [logsArt, outputArt] = await Promise.all([
              createAgentArtifact({
                pot_id: potId,
                run_id: runId,
                tool_id: targetTool.id,
                artifact_type: 'agent_tool_logs',
                payload: { logs: sandboxResult.logs, wall_time_ms: sandboxResult.wallTimeMs, error: sandboxResult.error },
              }),
              createAgentArtifact({
                pot_id: potId,
                run_id: runId,
                tool_id: targetTool.id,
                artifact_type: 'agent_tool_output',
                payload: { output: sandboxResult.output, error: sandboxResult.error },
              }),
            ]);

            await updateAgentToolRunStatus(toolRun.id, succeeded ? 'done' : 'failed', {
              finished_at: Date.now(),
              output_artifact_id: outputArt.id,
              logs_artifact_id: logsArt.id,
              budget_usage: { wall_time_ms: sandboxResult.wallTimeMs },
            });

            await updateAgentToolStatus(targetTool.id, 'active', {
              last_run_at: Date.now(),
              last_success_at: succeeded ? Date.now() : undefined,
            });

            // Replace or add tool output
            const existingIdx = allToolOutputs.findIndex((t) => t.tool_id === targetTool.id);
            const newOutput: ToolOutput = {
              tool_id: targetTool.id,
              tool_name: targetTool.name,
              tool_key: targetTool.tool_key,
              output: JSON.stringify(sandboxResult.output).slice(0, 2000),
              fresh: true,
              wall_time_ms: sandboxResult.wallTimeMs,
              error: sandboxResult.error,
            };
            if (existingIdx >= 0) {
              allToolOutputs[existingIdx] = newOutput;
            } else {
              allToolOutputs.push(newOutput);
            }

            addStep(
              'tool_gather',
              `${targetTool.name}: ${succeeded ? 'OK' : 'FAIL'} (${sandboxResult.wallTimeMs}ms)`,
              succeeded,
            );
          } catch (err) {
            addStep('tool_gather', `${targetTool.name}: error — ${err instanceof Error ? err.message : String(err)}`, false);
          }
        }
        // Continue loop → back to ENRICH with richer data
        continue;
      }

      if (decision.action === 'build_tool') {
        // Enqueue tool build async (don't block)
        if (budget.allowToolBuild) {
          try {
            const toolBuildRun = await createAgentRun({
              pot_id: potId,
              run_type: 'tool_build',
              model_id: opportunityModelId,
            });
            await enqueueJob({
              job_type: 'agent_tool_build',
              pot_id: potId,
              payload: { run_id: toolBuildRun.id, pot_id: potId },
              priority: 3,
            });
            addStep('tool_build_triggered', `Enqueued agent_tool_build — ${decision.rationale}`);
          } catch (err) {
            addStep('tool_build_triggered', `Failed: ${err instanceof Error ? err.message : String(err)}`, false);
          }
        }
        break;
      }

      if (decision.action === 'reflect_again') {
        // Continue loop → back to ENRICH
        continue;
      }

      // Unknown action → break
      break;
    }

    // ── PHASE 6: SYNTHESIZE ─────────────────────────────────────────────

    // Dedup by signature
    const seenSigs = new Set<string>();
    const dedupedCandidates: CreateAgentCandidateInput[] = [];
    // Sort by final_score desc before dedup so we keep the best
    allCandidateInputs.sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0));
    for (const c of allCandidateInputs) {
      if (c.signature && seenSigs.has(c.signature)) continue;
      if (c.signature) seenSigs.add(c.signature);
      dedupedCandidates.push(c);
    }

    const insertedCandidates = await insertAgentCandidates(runId, potId, dedupedCandidates);
    addStep('synthesis', `Inserted ${insertedCandidates.length} candidates (deduped from ${allCandidateInputs.length})`);

    // Store reflection artifact for the full run
    const reflectionArtifact = await createAgentArtifact({
      pot_id: potId,
      run_id: runId,
      artifact_type: 'agent_reflection',
      model_id: reflectionModelId,
      prompt_id: 'agent_reflection_generate',
      prompt_version: 'v1',
      payload: {
        candidates_count: insertedCandidates.length,
        iterations: counters.iterations,
        tools_executed: counters.toolRuns,
        ai_calls: counters.aiCalls,
      },
    });

    // ── Opportunity detection (only if tool building enabled + non-quiet) ─
    let opportunityResult: { detected: boolean; workflow_name?: string; utility_score?: number } = { detected: false };
    if (config.allow_tool_building && config.mode !== 'quiet' && hasBudget(counters, budget)) {
      await updateAgentRunStatus(runId, 'running', {
        progress: { phase: 'opportunity_detect', candidates_generated: insertedCandidates.length },
      });

      let oppPromptStr: string;
      try {
        const oppTemplate = loadPromptFromFile(
          path.join(promptsDir, 'agent_tool_opportunity_extract', 'v1.md'),
        );
        oppPromptStr = typeof oppTemplate.user === 'function'
          ? oppTemplate.user({})
          : oppTemplate.user;
      } catch {
        oppPromptStr = getDefaultOpportunityPrompt();
      }

      try {
        const potDigest = buildPotDigest(
          pot, config, entriesList, dykItems, feedbackHistory,
          priorCandidatesResult.candidates, topTags, topEntities, allToolOutputs, typePrefs,
          { latestSnapshotManifest: latestSnapshotManifest, bridgeDigest: bridgeDigestExtra },
        );
        const oppResponse = await createChatCompletion({
          model: opportunityModelId,
          messages: [
            { role: 'system', content: 'Analyze this research pot digest for automation opportunities. Output JSON only. No markdown fences.' },
            { role: 'user', content: oppPromptStr.replace('{{POT_DIGEST}}', JSON.stringify(potDigest, null, 2)) },
          ],
          temperature: 0.2,
          max_tokens: 1000,
        });
        counters.aiCalls++;

        const oppRaw = oppResponse.choices[0]?.message?.content ?? '{}';
        try {
          const cleaned = oppRaw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
          const parsed = AgentToolOpportunitySchema.safeParse(JSON.parse(cleaned));
          if (parsed.success) opportunityResult = parsed.data;
        } catch { /* use default */ }

        await createAgentArtifact({
          pot_id: potId,
          run_id: runId,
          artifact_type: 'agent_reflection',
          model_id: opportunityModelId,
          prompt_id: 'agent_tool_opportunity_extract',
          prompt_version: 'v1',
          payload: { opportunity: opportunityResult },
        });

        addStep(
          'opportunity_detect',
          opportunityResult.detected
            ? `Detected: ${opportunityResult.workflow_name} (score: ${opportunityResult.utility_score ?? '?'})`
            : 'No automatable workflow detected',
        );
      } catch (err) {
        addStep('opportunity_detect', `Error: ${err instanceof Error ? err.message : String(err)}`, false);
      }

      // Auto-trigger tool build if opportunity detected and cooldown elapsed
      if (opportunityResult.detected && (opportunityResult.utility_score ?? 0) >= 0.5) {
        const recentBuild = await hasRecentToolBuild(potId, TOOL_BUILD_COOLDOWN_MS).catch(() => true);
        if (!recentBuild) {
          try {
            const toolBuildRun = await createAgentRun({
              pot_id: potId,
              run_type: 'tool_build',
              model_id: opportunityModelId,
            });
            await enqueueJob({
              job_type: 'agent_tool_build',
              pot_id: potId,
              payload: { run_id: toolBuildRun.id, pot_id: potId },
              priority: 3,
            });
            addStep('tool_build_triggered', `Enqueued agent_tool_build for: ${opportunityResult.workflow_name}`);
            await logAuditEvent({
              actor: 'system',
              action: 'agent_tool_build_triggered',
              pot_id: potId,
              metadata: {
                heartbeat_run_id: runId,
                tool_build_run_id: toolBuildRun.id,
                workflow_name: opportunityResult.workflow_name,
                utility_score: opportunityResult.utility_score,
              },
            });
          } catch (err) {
            logger.warn({ run_id: runId, err, msg: 'Failed to enqueue agent_tool_build — skipping' });
          }
        } else {
          addStep('tool_build_cooldown', 'Cooldown active — skipping auto-trigger (< 3 days since last build)');
        }
      }
    }

    // ── PHASE 7: DELIVER ────────────────────────────────────────────────

    const winner = insertedCandidates.find(
      (c) => (c.confidence * c.novelty) > CONFIDENCE_NOVELTY_THRESHOLD,
    ) ?? insertedCandidates[0];

    if (winner) {
      addStep('winner_selected', `"${winner.title.slice(0, 80)}" — score: ${winner.final_score?.toFixed(3) ?? '?'}`);
      await markCandidateSelected(winner.id);
      await updateAgentRunStatus(runId, 'running', {
        selected_candidate_id: winner.id,
      });

      const isManual = run.run_type === 'manual';
      const tz = config.timezone ?? 'UTC';
      const inDeliveryWindow = isManual || isInDeliveryWindow(config.delivery_time_local, tz);
      const alreadyDeliveredToday = !isManual && await hasDeliveredTodayForPot(potId);

      if (inDeliveryWindow && !alreadyDeliveredToday) {
        await markCandidateDelivered(winner.id);
        addStep('candidate_delivered', `Delivered: "${winner.title.slice(0, 80)}" (${isManual ? 'manual' : 'scheduled'})`);

        await logAuditEvent({
          actor: 'system',
          action: 'agent_candidate_delivered',
          pot_id: potId,
          metadata: {
            run_id: runId,
            candidate_id: winner.id,
            candidate_type: winner.candidate_type,
            final_score: winner.final_score,
            manual: isManual,
          },
        });
      }
    }

    // ── DONE ────────────────────────────────────────────────────────────

    const wallTimeMs = Date.now() - counters.startTime;
    await updateAgentRunStatus(runId, 'done', {
      finished_at: Date.now(),
      progress: {
        phase: 'done',
        candidates_generated: insertedCandidates.length,
        iterations: counters.iterations,
        tools_executed: counters.toolRuns,
        ai_calls: counters.aiCalls,
        wall_time_ms: wallTimeMs,
        opportunity_detected: opportunityResult.detected,
        opportunity_workflow: opportunityResult.workflow_name ?? null,
        reflection_artifact_id: reflectionArtifact.id,
        steps,
      },
    });

    await logAuditEvent({
      actor: 'system',
      action: 'agent_heartbeat_done',
      pot_id: potId,
      metadata: {
        run_id: runId,
        candidates: insertedCandidates.length,
        iterations: counters.iterations,
        tools_executed: counters.toolRuns,
        ai_calls: counters.aiCalls,
        wall_time_ms: wallTimeMs,
        opportunity_detected: opportunityResult.detected,
      },
    });

    logger.info({
      run_id: runId,
      pot_id: potId,
      candidates: insertedCandidates.length,
      iterations: counters.iterations,
      tools_executed: counters.toolRuns,
      ai_calls: counters.aiCalls,
      wall_time_ms: wallTimeMs,
      msg: 'Agent heartbeat complete',
    });

    // ── SNAPSHOT TRIGGER ───────────────────────────────────────────────
    // If no snapshot in last 24h, enqueue snapshot executor
    try {
      const SNAPSHOT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h
      const recentSnapshots = await listAgentSnapshotsByPot(potId, 1);
      const lastSnapshot = recentSnapshots[0];
      const needsSnapshot = !lastSnapshot || (Date.now() - lastSnapshot.created_at) > SNAPSHOT_COOLDOWN_MS;
      if (needsSnapshot) {
        await enqueueJob({
          job_type: 'agent_snapshot_executor',
          payload: { pot_id: potId, run_id: runId },
          priority: 3,
        });
        logger.info({ pot_id: potId, msg: 'Enqueued agent_snapshot_executor (>24h since last)' });
      }
    } catch (snapErr) {
      logger.warn({ pot_id: potId, err: snapErr instanceof Error ? snapErr.message : String(snapErr), msg: 'Snapshot trigger check failed — non-fatal' });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ run_id: runId, pot_id: potId, err: msg, msg: 'Agent heartbeat failed' });
    await updateAgentRunStatus(runId, 'failed', {
      finished_at: Date.now(),
      progress: {
        phase: 'failed',
        iterations: counters.iterations,
        tools_executed: counters.toolRuns,
        ai_calls: counters.aiCalls,
        wall_time_ms: Date.now() - counters.startTime,
        error: msg,
        steps,
      },
    });
    await logAuditEvent({
      actor: 'system',
      action: 'agent_heartbeat_failed',
      pot_id: potId,
      metadata: { run_id: runId, error: msg },
    });
  }
}

// ── Decide next action ────────────────────────────────────────────────────

async function decideNextAction(
  candidates: CreateAgentCandidateInput[],
  toolOutputs: ToolOutput[],
  activeTools: any[],
  modelId: string,
  counters: BudgetCounters,
  budget: BudgetLimits,
  config: any,
  promptsDir: string,
): Promise<{ action: string; tool_id?: string; tool_input?: Record<string, unknown>; rationale: string }> {
  const defaultDone = { action: 'done', rationale: 'Budget exhausted or no better action available' };

  try {
    let promptUserTemplate: string;
    try {
      const promptTemplate = loadPromptFromFile(
        path.join(promptsDir, 'agent_heartbeat_decide', 'v1.md'),
      );
      promptUserTemplate = typeof promptTemplate.user === 'function'
        ? promptTemplate.user({})
        : promptTemplate.user;
    } catch {
      promptUserTemplate = getDefaultDecidePrompt();
    }

    const topScore = candidates.length > 0
      ? Math.max(...candidates.map((c) => c.final_score ?? 0)).toFixed(3)
      : '0.000';

    const toolOutputsSummary = toolOutputs.length > 0
      ? toolOutputs.map((t) => `- ${t.tool_name} (${t.tool_key}): ${t.fresh ? 'FRESH' : 'stale'} — ${t.output.slice(0, 300)}`).join('\n')
      : 'None';

    const availableToolsList = activeTools.length > 0
      ? activeTools.map((t) => `- ${t.id}: ${t.name} (${t.tool_key}) — ${t.description ?? 'no description'}`).join('\n')
      : 'None';

    const userMsg = promptUserTemplate
      .replace('{{MODE}}', config.mode ?? 'balanced')
      .replace('{{ITERATION}}', String(counters.iterations))
      .replace('{{MAX_ITERATIONS}}', String(budget.maxIterations))
      .replace('{{BUDGET_TOOL_RUNS}}', String(budget.maxToolRuns - counters.toolRuns))
      .replace('{{BUDGET_AI_CALLS}}', String(budget.maxAiCalls - counters.aiCalls))
      .replace('{{BUDGET_WALL_TIME_MS}}', String(budget.maxWallTimeMs - (Date.now() - counters.startTime)))
      .replace('{{CANDIDATES_COUNT}}', String(candidates.length))
      .replace('{{TOP_SCORE}}', topScore)
      .replace('{{TOOL_OUTPUTS_SUMMARY}}', toolOutputsSummary)
      .replace('{{AVAILABLE_TOOLS}}', availableToolsList)
      .replace('{{ALLOW_TOOL_BUILDING}}', String(budget.allowToolBuild))
      .replace('{{ALLOW_AUTO_RUN}}', String(budget.allowToolExec));

    const response = await createChatCompletion({
      model: modelId,
      messages: [
        { role: 'system', content: 'You are the decision engine for a research agent. Output strictly valid JSON. No markdown fences.' },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.2,
      max_tokens: 500,
    });

    const raw = response.choices[0]?.message?.content ?? '';
    const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const parsed = AgentDecisionSchema.safeParse(JSON.parse(cleaned));
    if (parsed.success) return parsed.data;
  } catch (err) {
    logger.warn({ err, msg: 'Decide phase parse failure — defaulting to done' });
  }

  return defaultDone;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function buildPotDigest(
  pot: any,
  config: any,
  entries: any[],
  dykItems: any[],
  feedback: any[],
  priorCandidates: any[],
  topTags: Array<{ tag: string; count: number }>,
  topEntities: Array<{ name: string; count: number }>,
  toolOutputs: ToolOutput[],
  typePrefs: { preferred_types: string[]; avoid_types: string[] },
  extras?: {
    latestSnapshotManifest?: Record<string, unknown> | null;
    bridgeDigest?: Record<string, unknown> | null;
  },
): Record<string, unknown> {
  // entry_type_distribution
  const entryTypeDist: Record<string, number> = {};
  for (const e of entries) {
    const t = (e as any).type ?? 'unknown';
    entryTypeDist[t] = (entryTypeDist[t] ?? 0) + 1;
  }

  const digest: Record<string, unknown> = {
    pot: {
      id: pot.id,
      name: pot.name,
      goal_text: config.goal_text ?? pot.goal_text,
    },
    recent_entries: entries.slice(0, 30).map((e: any) => ({
      id: e.id,
      type: e.type,
      source_title: e.source_title,
      content_snippet: (e.content_text ?? '').slice(0, 500),
      captured_at: e.captured_at,
    })),
    recent_dyk: dykItems.slice(0, 20).map((d: any) => ({
      title: d.title,
      body: d.body?.slice(0, 200),
      status: d.status,
      confidence: d.confidence,
    })),
    feedback_summary: aggregateFeedbackCounts(feedback),
    user_type_preferences: {
      preferred: typePrefs.preferred_types,
      avoid: typePrefs.avoid_types,
    },
    entry_count: entries.length,
    entry_type_distribution: entryTypeDist,
    top_tags: topTags,
    top_entities: topEntities,
    prior_candidates: priorCandidates.slice(0, 10).map((c: any) => ({
      title: c.title,
      candidate_type: c.candidate_type,
      final_score: c.final_score,
      delivered_at: c.delivered_at,
    })),
    active_tool_outputs: toolOutputs.map((t) => ({
      tool_name: t.tool_name,
      tool_key: t.tool_key,
      output: t.output,
      fresh: t.fresh,
    })),
  };

  // Latest snapshot summary
  if (extras?.latestSnapshotManifest) {
    digest.latest_snapshot_summary = extras.latestSnapshotManifest;
  }

  // Bridge data
  if (extras?.bridgeDigest) {
    digest.bridge = extras.bridgeDigest;
  }

  return digest;
}

function buildSystemMessage(
  pot: any,
  config: any,
  typePrefs?: { preferred_types: string[]; avoid_types: string[] },
): string {
  const parts = [
    `You are the Links Adaptive Research Agent for the pot "${pot.name}".`,
    config.goal_text ? `Pot goal: ${config.goal_text}` : '',
    `Autonomy mode: ${config.mode}. You surface one meaningful daily surprise to the user.`,
  ];
  if (typePrefs?.preferred_types.length) {
    parts.push(`User enjoys these candidate types: ${typePrefs.preferred_types.join(', ')}. Favor these.`);
  }
  if (typePrefs?.avoid_types.length) {
    parts.push(`User dislikes these candidate types: ${typePrefs.avoid_types.join(', ')}. Avoid these unless strongly evidenced.`);
  }
  parts.push('Output strictly valid JSON only. No markdown fences.');
  return parts.filter(Boolean).join('\n');
}

function aggregateFeedbackCounts(feedback: any[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ev of feedback) {
    counts[ev.action] = (counts[ev.action] ?? 0) + 1;
  }
  return counts;
}

function computeFatigueScore(title: string, feedbackCounts: Record<string, number>): number {
  const mehCount = feedbackCounts['meh'] ?? 0;
  const uselessCount = feedbackCounts['useless'] ?? 0;
  const total = mehCount + uselessCount;
  return Math.min(1, total * 0.05);
}

function computeFinalScore(
  candidate: any,
  fatigueScore: number,
  typePrefs: { preferred_types: string[]; avoid_types: string[] },
): number {
  const confidence = candidate.confidence ?? 0.5;
  const novelty = candidate.novelty ?? 0.5;
  const relevance = candidate.relevance ?? 0.5;
  const evidence = candidate.evidence_score ?? 0.5;
  const raw = confidence * 0.3 + novelty * 0.3 + relevance * 0.2 + evidence * 0.2;

  // Adjust score based on user's observed type preferences
  let typeAdjustment = 0;
  if (typePrefs.preferred_types.includes(candidate.candidate_type)) typeAdjustment = 0.1;
  else if (typePrefs.avoid_types.includes(candidate.candidate_type)) typeAdjustment = -0.2;

  return Math.max(0, Math.min(1, raw - fatigueScore * 0.3 + typeAdjustment));
}

function isInDeliveryWindow(deliveryTimeLocal: string, tz: string): boolean {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const currentHour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const currentMin = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);

  const [hStr, mStr] = (deliveryTimeLocal ?? '09:00').split(':');
  const targetHour = Number(hStr ?? 9);
  const targetMinute = Number(mStr ?? 0);

  const currentTotalMin = currentHour * 60 + currentMin;
  const targetTotalMin = targetHour * 60 + targetMinute;

  return Math.abs(currentTotalMin - targetTotalMin) <= 30;
}

function getDefaultReflectionPrompt(): string {
  return `You are analyzing a research pot to surface one meaningful surprise for the user.

Given the pot digest below, generate 5-8 candidate insights, leads, contradictions, or next actions.

For each candidate, provide:
- candidate_type: one of insight|lead|contradiction|foreign_language_finding|next_action|chat_seed|search_prompt
- title: short compelling title (max 120 chars) — be specific, not generic
- body: 2-4 sentences explaining the finding and why it matters, referencing specific entries
- confidence: 0.0-1.0 (how sure are you this is real/accurate)
- novelty: 0.0-1.0 (how surprising is this to the user)
- relevance: 0.0-1.0 (how relevant to the pot's goal)
- evidence_score: 0.0-1.0 (how much evidence supports this)
- source_refs: array of entry IDs or titles that support this

Do NOT generate candidates that appear in prior_candidates.

POT GOAL: {{POT_GOAL}}

POT DIGEST:
{{POT_DIGEST}}

Output ONLY valid JSON (no markdown fences):
{
  "candidates": [...],
  "digest_summary": "1-sentence summary of what you found"
}`;
}

function getDefaultOpportunityPrompt(): string {
  return `Analyze this research pot digest for a workflow that could be automated into a reusable agent tool.

A good opportunity: repeatable lookup or transformation, < 50 lines of JS, uses only ctx.entries/artifacts/links/entities/notify.

POT DIGEST:
{{POT_DIGEST}}

Output ONLY valid JSON (no markdown fences):
{
  "detected": false,
  "workflow_name": null,
  "workflow_description": null,
  "evidence_snippets": [],
  "expected_language": "javascript",
  "safety_class": "low",
  "utility_score": 0.0
}`;
}

function getDefaultDecidePrompt(): string {
  return `Decide the next action for this agent heartbeat run.

Mode: {{MODE}}
Iteration: {{ITERATION}} of {{MAX_ITERATIONS}}
Budget remaining: {{BUDGET_TOOL_RUNS}} tool runs, {{BUDGET_AI_CALLS}} AI calls, {{BUDGET_WALL_TIME_MS}}ms wall time

Candidates generated so far: {{CANDIDATES_COUNT}}
Top candidate score: {{TOP_SCORE}}

Tool Outputs This Run:
{{TOOL_OUTPUTS_SUMMARY}}

Available Tools:
{{AVAILABLE_TOOLS}}

allow_tool_building: {{ALLOW_TOOL_BUILDING}}
allow_auto_run_low_risk_tools: {{ALLOW_AUTO_RUN}}

Output ONLY valid JSON:
{
  "action": "run_tool" | "build_tool" | "reflect_again" | "done",
  "tool_id": "optional — required if action is run_tool",
  "tool_input": {},
  "rationale": "1-2 sentence explanation"
}`;
}
