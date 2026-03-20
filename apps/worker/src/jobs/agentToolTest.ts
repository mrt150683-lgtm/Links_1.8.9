/**
 * agent_tool_test Job Handler
 *
 * Stage 5 of tool pipeline: sandbox test execution + AI evaluation.
 * On pass: status = awaiting_approval, creates tool_offer candidate.
 * On fail: status = rejected.
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getAgentRun,
  getAgentConfig,
  getAgentTool,
  updateAgentToolStatus,
  createAgentArtifact,
  insertAgentCandidates,
  markCandidateSelected,
  computeCandidateSignature,
  logAuditEvent,
  getAIPreferences,
} from '@links/storage';
import { createChatCompletion, loadPromptFromFile } from '@links/ai';
import { AgentToolTestEvaluationSchema } from '@links/core';
import { runToolInSandbox } from './agentSandbox.js';
import { staticCheck } from './agentStaticCheck.js';
import path from 'node:path';
import process from 'node:process';

const logger = createLogger({ name: 'job:agent-tool-test' });
const DEFAULT_MODEL = 'google/gemini-2.0-flash-001';

function getPromptsDir(): string {
  if (process.env.PROMPTS_DIR) return process.env.PROMPTS_DIR;
  try {
    return path.join(path.dirname(process.execPath), 'resources', 'prompts');
  } catch {
    return path.join(process.cwd(), '../../apps/launcher/resources/prompts');
  }
}

export async function agentToolTestHandler(ctx: JobContext): Promise<void> {
  const payload = ctx.payload as { run_id: string; pot_id: string; tool_id: string; build_artifact_id?: string };
  const { run_id: runId, pot_id: potId, tool_id: toolId } = payload;

  logger.info({ job_id: ctx.jobId, run_id: runId, tool_id: toolId, msg: 'Agent tool test start' });

  const [config, tool] = await Promise.all([
    getAgentConfig(potId),
    getAgentTool(toolId),
  ]);

  if (!config?.enabled || !config.allow_tool_building) {
    logger.info({ tool_id: toolId, msg: 'Tool building not allowed — skip test' });
    return;
  }

  if (!tool) {
    logger.error({ tool_id: toolId, msg: 'Tool not found' });
    return;
  }

  try {
    const prefs = await getAIPreferences();
    const modelId = prefs.agent_models?.test_evaluation ?? prefs.default_model ?? DEFAULT_MODEL;

    const manifest = tool.manifest as any;
    const mainCode = manifest?.main_code ?? '';
    const policy = tool.sandbox_policy as any;

    // Python tools cannot run in Node.js vm sandbox — reject immediately
    if (tool.language === 'python') {
      logger.warn({ tool_id: toolId, msg: 'Python tool cannot be tested in Node.js sandbox — rejecting' });
      await updateAgentToolStatus(toolId, 'rejected', {
        test_summary: {
          passed: false,
          quality_score: 0,
          approval_recommended: false,
          safety_class: 'medium',
          issues: ['Python runtime not available — only JavaScript tools can be sandboxed in this environment'],
          recommendations: ['Rewrite tool in JavaScript to enable automated testing'],
        },
      });
      await logAuditEvent({
        actor: 'system',
        action: 'agent_tool_test_failed',
        pot_id: potId,
        metadata: { tool_id: toolId, reason: 'python_not_supported' },
      });
      return;
    }

    // Static check before sandbox — catch unsafe code without executing it
    const staticResult = staticCheck(mainCode);
    if (!staticResult.passed) {
      const summary = staticResult.violations.map((v) => v.detail).join('; ');
      logger.warn({ tool_id: toolId, violations: staticResult.violations.length, msg: 'Static check failed in test — tool rejected' });
      await updateAgentToolStatus(toolId, 'rejected', {
        test_summary: {
          passed: false,
          quality_score: 0,
          approval_recommended: false,
          safety_class: 'high',
          issues: [`Static check violations: ${summary}`],
          recommendations: ['Remove banned patterns (eval, exec, fs, network access, etc.)'],
        },
      });
      await logAuditEvent({
        actor: 'system',
        action: 'agent_tool_test_failed',
        pot_id: potId,
        metadata: { tool_id: toolId, violations: staticResult.violations },
      });
      return;
    }

    // Run in sandbox with real DB access
    const sandboxResult = await runToolInSandbox(mainCode, policy, potId);
    const passed = !sandboxResult.error;

    // Store logs artifact
    const logsArtifact = await createAgentArtifact({
      pot_id: potId,
      run_id: runId,
      tool_id: toolId,
      artifact_type: 'agent_tool_logs',
      payload: { logs: sandboxResult.logs, wall_time_ms: sandboxResult.wallTimeMs, error: sandboxResult.error },
    });

    // AI evaluation
    const promptsDir = getPromptsDir();
    let evalPrompt: string;
    try {
      const pt = loadPromptFromFile(path.join(promptsDir, 'agent_tool_test_evaluate', 'v1.md'));
      evalPrompt = typeof pt.user === 'function' ? pt.user({}) : pt.user;
    } catch {
      evalPrompt = getDefaultEvalPrompt();
    }

    const evalResponse = await createChatCompletion({
      model: modelId,
      messages: [
        { role: 'system', content: 'Evaluate this tool test run. Output JSON only. No markdown fences.' },
        { role: 'user', content: evalPrompt.replace('{{TEST_RESULT}}', JSON.stringify({
          sandbox_passed: passed,
          error: sandboxResult.error,
          logs: sandboxResult.logs.slice(0, 20),
          wall_time_ms: sandboxResult.wallTimeMs,
          output: sandboxResult.output,
          tool_name: tool.name,
          tool_description: tool.description,
        })) },
      ],
      temperature: 0.2,
      max_tokens: 1000,
    });

    const evalRaw = evalResponse.choices[0]?.message?.content ?? '{}';
    let evaluation: any = { passed, quality_score: passed ? 0.7 : 0, approval_recommended: passed, safety_class: 'low', issues: [], recommendations: [] };
    try {
      const cleaned = evalRaw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
      const parsed = AgentToolTestEvaluationSchema.safeParse(JSON.parse(cleaned));
      if (parsed.success) evaluation = parsed.data;
    } catch { /* use default */ }

    // Store test report
    const testReportArtifact = await createAgentArtifact({
      pot_id: potId,
      run_id: runId,
      tool_id: toolId,
      artifact_type: 'agent_tool_test_report',
      model_id: modelId,
      prompt_id: 'agent_tool_test_evaluate',
      prompt_version: 'v1',
      payload: { evaluation, sandbox_result: { passed, error: sandboxResult.error, wall_time_ms: sandboxResult.wallTimeMs, output: sandboxResult.output } },
    });

    if (evaluation.passed && evaluation.approval_recommended) {
      // Tool passed — mark as awaiting_approval
      await updateAgentToolStatus(toolId, 'awaiting_approval', {
        test_summary: evaluation,
      });

      // Create tool_offer candidate
      const sig = computeCandidateSignature(
        `Tool ready: ${tool.name}`,
        tool.description ?? tool.name,
        'tool_offer',
      );

      const candidates = await insertAgentCandidates(runId, potId, [{
        candidate_type: 'tool_offer',
        title: `New tool ready: ${tool.name}`,
        body: `${tool.description ?? tool.name} It passed automated testing and is awaiting your approval to activate.`,
        confidence: evaluation.quality_score,
        novelty: 0.9,
        relevance: 0.8,
        evidence_score: 0.8,
        final_score: evaluation.quality_score * 0.9,
        signature: sig,
        launch_payload: { tool_id: toolId, test_report_id: testReportArtifact.id },
        source_refs: [],
      }]);

      if (candidates[0]) {
        await markCandidateSelected(candidates[0].id);
      }

      await logAuditEvent({
        actor: 'system',
        action: 'agent_tool_test_passed',
        pot_id: potId,
        metadata: { tool_id: toolId, quality_score: evaluation.quality_score },
      });

      logger.info({ tool_id: toolId, msg: 'Agent tool test passed — awaiting approval' });
    } else {
      await updateAgentToolStatus(toolId, 'rejected', { test_summary: evaluation });

      await logAuditEvent({
        actor: 'system',
        action: 'agent_tool_test_failed',
        pot_id: potId,
        metadata: { tool_id: toolId, issues: evaluation.issues, error: sandboxResult.error },
      });

      logger.warn({ tool_id: toolId, msg: 'Agent tool test failed — tool rejected' });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ tool_id: toolId, err: msg, msg: 'Agent tool test job error' });
    await updateAgentToolStatus(toolId, 'rejected');
  }
}

function getDefaultEvalPrompt(): string {
  return `Evaluate this tool test result:

TEST RESULT:
{{TEST_RESULT}}

Output JSON (no markdown fences):
{
  "passed": true,
  "quality_score": 0.8,
  "determinism_score": 0.9,
  "utility_score": 0.7,
  "issues": [],
  "recommendations": [],
  "safety_class": "low",
  "approval_recommended": true
}`;
}
