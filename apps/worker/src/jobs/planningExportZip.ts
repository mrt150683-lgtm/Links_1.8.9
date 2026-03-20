import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import JSZip from 'jszip';
import type { JobContext } from '@links/storage';
import { getConfig } from '@links/config';
import { getRun, listFiles, saveFile, updateRunStatus } from '@links/storage';

export async function planningExportZipHandler(ctx: JobContext): Promise<void> {
  const runId = String(ctx.payload?.runId ?? '');
  const revision = Number(ctx.payload?.revision ?? 0);
  if (!runId || !revision) throw new Error('planning_export_zip requires runId and revision in payload');

  const run = await getRun(runId);
  if (!run) throw new Error(`Planning run not found: ${runId}`);

  const config = getConfig();
  await mkdir(config.EXPORTS_DIR, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const safeProjectName = run.project_name.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const root = `${safeProjectName}_${date}`;
  const zip = new JSZip();

  const files = await listFiles(runId, revision);
  const manifest: Array<Record<string, unknown>> = [];

  for (const file of files) {
    if (!file.content_text) continue;
    const fullPath = file.path.startsWith('docs/') ? `${root}/${file.path}` : `${root}/${file.path}`;
    zip.file(fullPath, file.content_text);
    manifest.push({
      path: file.path,
      sha256: file.sha256,
      provenance: {
        model_id: file.model_id,
        prompt_id: file.prompt_id,
        prompt_version: file.prompt_version,
        temperature: file.temperature,
        max_tokens: file.max_tokens,
      },
    });
  }

  const manifestJson = JSON.stringify({ run_id: runId, revision, files: manifest }, null, 2);
  zip.file(`${root}/manifest.json`, manifestJson);

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const outputPath = join(config.EXPORTS_DIR, `${root}.zip`);
  await writeFile(outputPath, zipBuffer);

  const sha = createHash('sha256').update(zipBuffer).digest('hex');
  await saveFile(runId, revision, 'export.json', 'manifest_json', JSON.stringify({ zip_path: outputPath, sha256: sha }, null, 2));
  await updateRunStatus(runId, 'exported');
}
