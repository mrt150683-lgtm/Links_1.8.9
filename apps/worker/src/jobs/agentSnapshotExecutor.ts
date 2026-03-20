/**
 * agent_snapshot_executor Job Handler
 *
 * Captures a logical manifest of pot state and optionally generates
 * an AI diff report vs. previous snapshot.
 *
 * Steps:
 * 1. Load pot entries count by type, top-20 tags, entity count, link count
 * 2. Build manifest
 * 3. Load previous snapshot via listAgentSnapshotsByPot(potId, 1)
 * 4. If previous: compute diff
 * 5. If diff non-trivial: AI call with agent_snapshot_report/v1.md
 * 6. Store snapshot via createAgentSnapshot with manifest_json
 * 7. Store report as agent_artifact type snapshot_report
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  createAgentSnapshot,
  updateAgentSnapshotStatus,
  listAgentSnapshotsByPot,
  createAgentArtifact,
  logAuditEvent,
  getAIPreferences,
  listEntries,
  listArtifactsForPot,
  listLinksForPot,
} from '@links/storage';
import { createChatCompletion, loadPromptFromFile } from '@links/ai';

const logger = createLogger({ name: 'job:agent-snapshot-executor' });
const DEFAULT_MODEL = 'google/gemini-2.0-flash-001';

function getPromptsDir(): string {
  if (process.env.PROMPTS_DIR) return process.env.PROMPTS_DIR;
  try {
    return path.join(path.dirname(process.execPath), 'resources', 'prompts');
  } catch {
    return path.join(process.cwd(), '../../apps/launcher/resources/prompts');
  }
}

export async function agentSnapshotExecutorHandler(ctx: JobContext): Promise<void> {
  const payload = ctx.payload as { pot_id: string; run_id?: string };
  const { pot_id: potId, run_id: runId } = payload;

  logger.info({ job_id: ctx.jobId, pot_id: potId, msg: 'Agent snapshot executor start' });

  try {
    // 1. Load pot data
    const [entriesList, allArtifacts, links] = await Promise.all([
      listEntries({ pot_id: potId, limit: 1000 }).catch(() => []),
      listArtifactsForPot(potId).catch(() => []),
      listLinksForPot(potId).catch(() => []),
    ]);

    // Count entries by type
    const entryTypeCounts: Record<string, number> = {};
    for (const e of entriesList) {
      const t = (e as any).type ?? 'unknown';
      entryTypeCounts[t] = (entryTypeCounts[t] ?? 0) + 1;
    }

    // Extract tag distribution from derived artifacts
    const tagCounts: Record<string, number> = {};
    const tagArtifacts = allArtifacts.filter((a) => a.artifact_type === 'tags');
    for (const art of tagArtifacts) {
      const p = art.payload as any;
      if (Array.isArray(p?.tags)) {
        for (const tag of p.tags) {
          const name = typeof tag === 'string' ? tag : tag?.name ?? String(tag);
          tagCounts[name] = (tagCounts[name] ?? 0) + 1;
        }
      }
    }
    const topTags = Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));

    // Count entities
    const entityNames = new Set<string>();
    const entityArtifacts = allArtifacts.filter((a) => a.artifact_type === 'entities');
    for (const art of entityArtifacts) {
      const p = art.payload as any;
      if (Array.isArray(p?.entities)) {
        for (const ent of p.entities) {
          entityNames.add(ent?.name ?? String(ent));
        }
      }
    }

    // 2. Build manifest
    const manifestData = {
      entry_count: entriesList.length,
      entry_types: entryTypeCounts,
      tag_distribution: topTags,
      entity_count: entityNames.size,
      link_count: links.length,
      artifact_count: allArtifacts.length,
      captured_at: Date.now(),
    };

    // Content hash for change detection
    const contentHash = createHash('sha256')
      .update(JSON.stringify(manifestData))
      .digest('hex')
      .slice(0, 16);

    // 3. Load previous snapshot
    const previousSnapshots = await listAgentSnapshotsByPot(potId, 1);
    const prevSnapshot = previousSnapshots[0];

    // 4. Compute diff
    let diff: Record<string, unknown> | null = null;
    let diffNonTrivial = false;

    if (prevSnapshot?.manifest) {
      const prev = prevSnapshot.manifest as any;
      const deltaEntries = manifestData.entry_count - (prev.entry_count ?? 0);
      const deltaLinks = manifestData.link_count - (prev.link_count ?? 0);
      const deltaEntities = manifestData.entity_count - (prev.entity_count ?? 0);

      // New/lost tags
      const prevTagNames = new Set<string>((prev.tag_distribution ?? []).map((t: any) => String(t.tag)));
      const currTagNames = new Set(topTags.map((t) => t.tag));
      const newTags = topTags.filter((t) => !prevTagNames.has(t.tag)).map((t) => t.tag);
      const lostTags = [...prevTagNames].filter((t) => !currTagNames.has(t));

      diff = {
        delta_entries: deltaEntries,
        delta_links: deltaLinks,
        delta_entities: deltaEntities,
        new_tags: newTags,
        lost_tags: lostTags,
        prev_content_hash: prev.content_hash ?? null,
        curr_content_hash: contentHash,
        days_since_last: prevSnapshot.created_at
          ? Math.round((Date.now() - prevSnapshot.created_at) / 86_400_000)
          : null,
      };

      diffNonTrivial =
        Math.abs(deltaEntries) >= 1 ||
        Math.abs(deltaLinks) >= 1 ||
        newTags.length > 0 ||
        lostTags.length > 0;
    } else {
      // First snapshot — always non-trivial if there's any content
      diffNonTrivial = manifestData.entry_count > 0;
    }

    // 6. Store snapshot
    const snapshot = await createAgentSnapshot({
      pot_id: potId,
      run_id: runId ?? undefined,
      scope: { type: 'full_pot' },
      storage_mode: 'logical_slice',
    });

    await updateAgentSnapshotStatus(snapshot.id, 'ready', {
      manifest: { ...manifestData, content_hash: contentHash, diff },
    });

    logger.info({
      pot_id: potId,
      snapshot_id: snapshot.id,
      diff_non_trivial: diffNonTrivial,
      msg: 'Snapshot manifest stored',
    });

    // 5. If diff non-trivial: AI report
    if (diffNonTrivial) {
      try {
        const prefs = await getAIPreferences();
        const modelId = prefs.agent_models?.reflection ?? prefs.default_model ?? DEFAULT_MODEL;
        const promptsDir = getPromptsDir();

        let promptUserTemplate: string;
        let promptSystemStr: string;
        try {
          const promptTemplate = loadPromptFromFile(
            path.join(promptsDir, 'agent_snapshot_report', 'v1.md'),
          );
          promptUserTemplate = typeof promptTemplate.user === 'function'
            ? promptTemplate.user({})
            : promptTemplate.user;
          promptSystemStr = promptTemplate.system;
        } catch {
          promptUserTemplate = 'SNAPSHOT DATA:\n{{SNAPSHOT_DATA}}\n\nGenerate the snapshot report.';
          promptSystemStr = 'You are a research progress analyst. Generate a concise snapshot report as JSON.';
        }

        const snapshotData = {
          manifest: manifestData,
          diff,
          pot_id: potId,
          snapshot_id: snapshot.id,
        };

        const userMsg = promptUserTemplate.replace(
          '{{SNAPSHOT_DATA}}',
          JSON.stringify(snapshotData, null, 2),
        );

        const aiResponse = await createChatCompletion({
          model: modelId,
          messages: [
            { role: 'system', content: promptSystemStr },
            { role: 'user', content: userMsg },
          ],
          temperature: 0.2,
          max_tokens: 2000,
        });

        const rawContent = aiResponse.choices[0]?.message?.content ?? '{}';
        let report: Record<string, unknown> = {};
        try {
          const cleaned = rawContent
            .replace(/^```(?:json)?\n?/m, '')
            .replace(/\n?```$/m, '')
            .trim();
          report = JSON.parse(cleaned);
        } catch {
          report = { raw_response: rawContent.slice(0, 2000) };
        }

        // 7. Store report artifact
        await createAgentArtifact({
          pot_id: potId,
          run_id: runId ?? undefined,
          artifact_type: 'snapshot_report' as any,
          model_id: modelId,
          prompt_id: 'agent_snapshot_report',
          prompt_version: 'v1',
          payload: {
            snapshot_id: snapshot.id,
            report,
            diff,
          },
        });

        logger.info({
          pot_id: potId,
          snapshot_id: snapshot.id,
          msg: 'Snapshot report generated',
        });
      } catch (err) {
        logger.warn({
          pot_id: potId,
          err: err instanceof Error ? err.message : String(err),
          msg: 'Snapshot report generation failed — snapshot still saved',
        });
      }
    }

    await logAuditEvent({
      actor: 'system',
      action: 'agent_snapshot_created',
      pot_id: potId,
      metadata: {
        snapshot_id: snapshot.id,
        entry_count: manifestData.entry_count,
        entity_count: manifestData.entity_count,
        link_count: manifestData.link_count,
        diff_non_trivial: diffNonTrivial,
      },
    });

    logger.info({ pot_id: potId, snapshot_id: snapshot.id, msg: 'Agent snapshot executor done' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ pot_id: potId, err: msg, msg: 'Agent snapshot executor failed' });
    throw err;
  }
}
