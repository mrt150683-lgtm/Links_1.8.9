/**
 * heartbeat_render Job Handler
 *
 * Renders a markdown document from a heartbeat snapshot.
 * 1. Load heartbeat_snapshot by id (from payload)
 * 2. Build markdown from snapshot sections
 * 3. Compute SHA256 of content
 * 4. Create/update heartbeat_document
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getHeartbeatSnapshot,
  createHeartbeatDocument,
  logAuditEvent,
} from '@links/storage';
import { createHash } from 'node:crypto';

const logger = createLogger({ name: 'job:heartbeat-render' });

function renderMarkdown(snapshot: {
  snapshot: Record<string, unknown>;
  summary: Record<string, unknown>;
  open_loops: unknown[];
  pot_id: string;
  period_key: string;
}): string {
  const s = snapshot.snapshot as any;
  const sections: string[] = [];

  const headline = s.headline ?? (snapshot.summary as any).headline ?? 'Project Status';
  const periodKey = snapshot.period_key;
  const [datePart, hourPart] = periodKey.split('-');
  const formattedDate = datePart
    ? `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)} ${hourPart ?? '00'}:00`
    : periodKey;

  sections.push(`# ${headline}`);
  sections.push(`\n*Generated: ${formattedDate}*\n`);

  if (s.summary) {
    sections.push(`## Summary\n\n${s.summary}`);
  }

  if (s.what_changed) {
    sections.push(`## What Changed\n\n${s.what_changed}`);
  }

  if (Array.isArray(s.open_loops) && s.open_loops.length > 0) {
    sections.push('## Open Loops\n');
    for (const loop of s.open_loops as any[]) {
      const priority = loop.priority ? ` *(${loop.priority})*` : '';
      sections.push(`### ${loop.title}${priority}\n\n${loop.description ?? ''}\n`);
    }
  }

  if (Array.isArray(s.risks) && s.risks.length > 0) {
    sections.push('## Risks\n');
    for (const risk of s.risks as any[]) {
      const severity = risk.severity ? ` **[${risk.severity.toUpperCase()}]**` : '';
      sections.push(`- ${risk.title}${severity}: ${risk.description ?? ''}`);
    }
    sections.push('');
  }

  if (Array.isArray(s.recommended_actions) && s.recommended_actions.length > 0) {
    sections.push('## Recommended Actions\n');
    for (const action of s.recommended_actions as any[]) {
      const urgency = action.urgency ? ` *(${action.urgency})*` : '';
      sections.push(`- **${action.action}**${urgency}: ${action.rationale ?? ''}`);
    }
    sections.push('');
  }

  // Extra sections from AI
  if (Array.isArray(s.heartbeat_markdown_sections)) {
    for (const section of s.heartbeat_markdown_sections as any[]) {
      if (section.heading && section.content) {
        sections.push(`## ${section.heading}\n\n${section.content}`);
      }
    }
  }

  if (s.confidence !== undefined) {
    sections.push(`---\n*Confidence: ${(Number(s.confidence) * 100).toFixed(0)}%*\n`);
  }

  return sections.join('\n\n');
}

export async function heartbeatRenderHandler(ctx: JobContext): Promise<void> {
  const payload = ctx.payload as { pot_id: string; snapshot_id: string };
  const { pot_id: potId, snapshot_id: snapshotId } = payload;

  logger.info({ job_id: ctx.jobId, pot_id: potId, snapshot_id: snapshotId, msg: 'Heartbeat render start' });

  // 1. Load snapshot
  const snapshot = await getHeartbeatSnapshot(snapshotId);
  if (!snapshot) {
    logger.error({ snapshot_id: snapshotId, msg: 'Heartbeat snapshot not found' });
    return;
  }

  // 2. Build markdown
  const markdown = renderMarkdown(snapshot);

  // 3. Compute SHA256
  const sha256 = createHash('sha256').update(markdown, 'utf8').digest('hex');

  // 4. Create heartbeat_document
  const doc = await createHeartbeatDocument({
    pot_id: potId,
    heartbeat_snapshot_id: snapshotId,
    format: 'markdown',
    content_text: markdown,
    content_sha256: sha256,
    storage_mode: 'db',
  });

  await logAuditEvent({
    actor: 'system',
    action: 'heartbeat_rendered',
    pot_id: potId,
    metadata: { snapshot_id: snapshotId, document_id: doc.id, sha256 },
  });

  logger.info({ pot_id: potId, document_id: doc.id, msg: 'Heartbeat render complete' });
}
