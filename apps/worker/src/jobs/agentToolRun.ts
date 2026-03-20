/**
 * agent_tool_run Job Handler
 *
 * Executes an approved tool in a sandboxed environment.
 * Respects autonomy mode: bold_auto only in mode=bold.
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getAgentConfig,
  getAgentTool,
  createAgentToolRun,
  updateAgentToolStatus,
  updateAgentToolRunStatus,
  createAgentArtifact,
  logAuditEvent,
  listEntries,
  getEntryById,
  listArtifactsForPot,
  listLinksForPot,
} from '@links/storage';
import vm from 'node:vm';

const logger = createLogger({ name: 'job:agent-tool-run' });

async function buildRealCtx(potId: string, inputPayload: Record<string, unknown>, outputs: unknown[]) {
  return {
    entries: {
      search: async (q: string) => {
        const results = await listEntries({ pot_id: potId, limit: 50 }).catch(() => []);
        const lq = q.toLowerCase();
        return results
          .filter((e) =>
            e.content_text?.toLowerCase().includes(lq) ||
            e.source_title?.toLowerCase().includes(lq),
          )
          .slice(0, 20)
          .map((e) => ({
            id: e.id,
            type: e.type,
            title: e.source_title ?? null,
            snippet: e.content_text?.slice(0, 300) ?? null,
          }));
      },
      read: async (id: string) => {
        const entry = await getEntryById(id).catch(() => null);
        if (!entry) return null;
        return {
          id: entry.id,
          type: entry.type,
          content: entry.content_text ?? null,
          title: entry.source_title ?? null,
        };
      },
    },
    artifacts: {
      search: async (type: string) => {
        const arts = await listArtifactsForPot(potId).catch(() => []);
        return arts
          .filter((a) => a.artifact_type === type)
          .slice(0, 20)
          .map((a) => ({ id: a.id, type: a.artifact_type, payload: a.payload }));
      },
      createDerived: async (type: string, payload: unknown) => {
        const art = await createAgentArtifact({
          pot_id: potId,
          artifact_type: 'agent_tool_output',
          payload: { derived_type: type, data: payload },
        });
        return { id: art.id };
      },
    },
    notify: {
      emitCandidate: (c: unknown) => { outputs.push(c); },
    },
    links: {
      search: async (q: string) => {
        const lnks = await listLinksForPot(potId).catch(() => []);
        const lq = q.toLowerCase();
        return lnks
          .filter((l) => l.rationale?.toLowerCase().includes(lq))
          .slice(0, 20)
          .map((l) => ({ id: l.id, src_entry_id: l.src_entry_id, dst_entry_id: l.dst_entry_id, link_type: l.link_type, rationale: l.rationale }));
      },
    },
    entities: {
      search: async (q: string) => {
        const arts = await listArtifactsForPot(potId).catch(() => []);
        const entityArts = arts.filter((a) => a.artifact_type === 'entities');
        const lq = q.toLowerCase();
        const found: Array<{ id: string; name: string; type: string }> = [];
        for (const art of entityArts) {
          const payload = art.payload as any;
          if (Array.isArray(payload?.entities)) {
            for (const ent of payload.entities) {
              if (ent.name?.toLowerCase().includes(lq)) {
                found.push({ id: ent.id ?? art.id, name: ent.name, type: ent.entity_type ?? ent.type ?? 'unknown' });
              }
            }
          }
        }
        return found.slice(0, 20);
      },
    },
    input: inputPayload,
  };
}

async function runToolInSandbox(
  code: string,
  policy: any,
  potId: string,
  inputPayload: Record<string, unknown>,
): Promise<{ output: unknown; logs: string[]; wallTimeMs: number; error?: string }> {
  const logs: string[] = [];
  const outputs: unknown[] = [];
  const startTime = Date.now();

  const realCtx = await buildRealCtx(potId, inputPayload, outputs);

  const sandboxGlobal = {
    ctx: realCtx,
    result: null as unknown,
    console: {
      log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
      warn: (...args: unknown[]) => logs.push('[WARN] ' + args.map(String).join(' ')),
      error: (...args: unknown[]) => logs.push('[ERROR] ' + args.map(String).join(' ')),
    },
  };

  const maxWallTime = Math.min(policy?.max_wall_time_ms ?? 10000, 30000);

  try {
    const script = new vm.Script(`(async () => { ${code} })().then(r => { result = r; })`);
    const context = vm.createContext(sandboxGlobal);
    const scriptResult = script.runInContext(context, { timeout: maxWallTime });
    if (scriptResult && typeof (scriptResult as any).then === 'function') {
      await Promise.race([
        scriptResult,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Wall time exceeded')), maxWallTime)),
      ]);
    }
  } catch (err) {
    return { output: null, logs, wallTimeMs: Date.now() - startTime, error: err instanceof Error ? err.message : String(err) };
  }

  return {
    output: outputs.length > 0 ? outputs : sandboxGlobal.result,
    logs,
    wallTimeMs: Date.now() - startTime,
  };
}

export async function agentToolRunHandler(ctx: JobContext): Promise<void> {
  const payload = ctx.payload as {
    pot_id: string;
    tool_id: string;
    trigger_type?: 'manual' | 'heartbeat' | 'bold_auto' | 'user_retry';
    input_payload?: Record<string, unknown>;
    agent_run_id?: string;
  };
  const { pot_id: potId, tool_id: toolId } = payload;
  const triggerType = payload.trigger_type ?? 'manual';

  logger.info({ job_id: ctx.jobId, tool_id: toolId, trigger_type: triggerType, msg: 'Agent tool run start' });

  const [config, tool] = await Promise.all([
    getAgentConfig(potId),
    getAgentTool(toolId),
  ]);

  if (!config?.enabled) {
    logger.info({ tool_id: toolId, msg: 'Agent disabled — skip tool run' });
    return;
  }

  // Autonomy mode enforcement
  if (triggerType === 'bold_auto' && config.mode !== 'bold') {
    logger.info({ tool_id: toolId, mode: config.mode, msg: 'Bold auto run not allowed in non-bold mode' });
    return;
  }

  if (!tool) {
    logger.error({ tool_id: toolId, msg: 'Tool not found' });
    return;
  }

  if (tool.status !== 'active') {
    logger.warn({ tool_id: toolId, status: tool.status, msg: 'Tool is not active — cannot run' });
    return;
  }

  // Create tool run record
  const toolRun = await createAgentToolRun({
    pot_id: potId,
    tool_id: toolId,
    tool_version: tool.version,
    agent_run_id: payload.agent_run_id,
    trigger_type: triggerType,
    input_payload: payload.input_payload ?? {},
  });

  await updateAgentToolRunStatus(toolRun.id, 'running');

  try {
    const manifest = tool.manifest as any;
    const mainCode = manifest?.main_code ?? '';
    const policy = tool.sandbox_policy as any;

    const sandboxResult = await runToolInSandbox(mainCode, policy, potId, payload.input_payload ?? {});

    // Store logs artifact
    const logsArtifact = await createAgentArtifact({
      pot_id: potId,
      tool_id: toolId,
      artifact_type: 'agent_tool_logs',
      payload: { logs: sandboxResult.logs, wall_time_ms: sandboxResult.wallTimeMs, error: sandboxResult.error },
    });

    // Store output artifact
    const outputArtifact = await createAgentArtifact({
      pot_id: potId,
      tool_id: toolId,
      artifact_type: 'agent_tool_output',
      payload: { output: sandboxResult.output, error: sandboxResult.error },
    });

    const succeeded = !sandboxResult.error;

    await updateAgentToolRunStatus(toolRun.id, succeeded ? 'done' : 'failed', {
      finished_at: Date.now(),
      output_artifact_id: outputArtifact.id,
      logs_artifact_id: logsArtifact.id,
      budget_usage: { wall_time_ms: sandboxResult.wallTimeMs },
    });

    // Update tool stats
    await updateAgentToolStatus(toolId, 'active', {
      last_run_at: Date.now(),
      last_success_at: succeeded ? Date.now() : undefined,
    });

    await logAuditEvent({
      actor: 'system',
      action: 'agent_tool_run_finished',
      pot_id: potId,
      metadata: { tool_id: toolId, tool_run_id: toolRun.id, succeeded, wall_time_ms: sandboxResult.wallTimeMs },
    });

    logger.info({ tool_id: toolId, tool_run_id: toolRun.id, succeeded, msg: 'Agent tool run finished' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ tool_id: toolId, err: msg, msg: 'Agent tool run error' });
    await updateAgentToolRunStatus(toolRun.id, 'failed', { finished_at: Date.now() });
  }
}
