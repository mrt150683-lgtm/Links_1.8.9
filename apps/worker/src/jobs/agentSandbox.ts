/**
 * Shared Agent Sandbox Module
 *
 * Provides buildRealCtx() and runToolInSandbox() for executing agent tools
 * in a sandboxed Node.js vm context with real DB access.
 *
 * Used by: agentToolRun.ts, agentToolTest.ts, agentHeartbeat.ts
 */

import {
  createAgentArtifact,
  listEntries,
  getEntryById,
  listArtifactsForPot,
  listLinksForPot,
} from '@links/storage';
import vm from 'node:vm';

export async function buildRealCtx(
  potId: string,
  inputPayload: Record<string, unknown>,
  outputs: unknown[],
) {
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

// ── Preloaded (static) context ────────────────────────────────────────────

export interface PreloadedPotData {
  potId: string;
  entries: Array<{
    id: string;
    type: string;
    source_title: string | null;
    content_text: string | null;
  }>;
  artifacts: Array<{
    id: string;
    artifact_type: string;
    payload: unknown;
  }>;
  links: Array<{
    id: string;
    src_entry_id: string;
    dst_entry_id: string;
    link_type: string;
    rationale: string | null;
  }>;
}

/**
 * Build a sandboxed ctx from preloaded in-memory data (no DB calls for reads).
 * Writes (createDerived) still hit the DB since they mutate state.
 */
export function buildStaticCtx(
  preloaded: PreloadedPotData,
  inputPayload: Record<string, unknown>,
  outputs: unknown[],
) {
  const { potId, entries, artifacts, links } = preloaded;
  return {
    entries: {
      search: (q: string) => {
        const lq = q.toLowerCase();
        return entries
          .filter(
            (e) =>
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
      read: (id: string) => {
        const e = entries.find((entry) => entry.id === id);
        if (!e) return null;
        return {
          id: e.id,
          type: e.type,
          content: e.content_text ?? null,
          title: e.source_title ?? null,
        };
      },
    },
    artifacts: {
      search: (type: string) =>
        artifacts
          .filter((a) => a.artifact_type === type)
          .slice(0, 20)
          .map((a) => ({ id: a.id, type: a.artifact_type, payload: a.payload })),
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
      search: (q: string) => {
        const lq = q.toLowerCase();
        return links
          .filter((l) => l.rationale?.toLowerCase().includes(lq))
          .slice(0, 20)
          .map((l) => ({
            id: l.id,
            src_entry_id: l.src_entry_id,
            dst_entry_id: l.dst_entry_id,
            link_type: l.link_type,
            rationale: l.rationale,
          }));
      },
    },
    entities: {
      search: (q: string) => {
        const lq = q.toLowerCase();
        const found: Array<{ id: string; name: string; type: string }> = [];
        for (const art of artifacts) {
          if (art.artifact_type !== 'entities') continue;
          const payload = art.payload as any;
          if (Array.isArray(payload?.entities)) {
            for (const ent of payload.entities) {
              if (ent.name?.toLowerCase().includes(lq)) {
                found.push({
                  id: ent.id ?? art.id,
                  name: ent.name,
                  type: ent.entity_type ?? ent.type ?? 'unknown',
                });
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

/**
 * Run a tool in the sandbox using preloaded pot data (no DB reads during execution).
 * Use this in the heartbeat to share data loaded at heartbeat start across all tool runs.
 */
export async function runToolWithPreloadedData(
  code: string,
  policy: any,
  preloaded: PreloadedPotData,
  inputPayload: Record<string, unknown> = {},
): Promise<{ output: unknown; logs: string[]; wallTimeMs: number; error?: string }> {
  const logs: string[] = [];
  const outputs: unknown[] = [];
  const startTime = Date.now();

  const staticCtx = buildStaticCtx(preloaded, inputPayload, outputs);

  const sandboxGlobal = {
    ctx: staticCtx,
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

export async function runToolInSandbox(
  code: string,
  policy: any,
  potId: string,
  inputPayload: Record<string, unknown> = {},
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
