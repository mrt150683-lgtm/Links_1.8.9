/**
 * Prompt Directory Resolver
 *
 * Resolves the prompts directory for both dev and bundled (packaged EXE) environments.
 *
 * Priority:
 * 1. PROMPTS_DIR env var (set by launcher in packaged app)
 * 2. ../prompts relative to __dirname (works for portable EXE: <app>/worker-dist/bundle.cjs
 *    with prompts at <app>/prompts/)
 * 3. Dev mode fallback: 5 levels up then packages/ai/prompts (from apps/worker/dist/jobs/utils/)
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function getPromptsDir(): string {
  // 1. Explicit env var always wins
  if (process.env.PROMPTS_DIR) {
    return process.env.PROMPTS_DIR;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // 2. Packaged/portable layout: bundle is at <app>/worker-dist/bundle.cjs,
  //    prompts land at <app>/prompts/ via electron-builder extraFiles
  const portablePath = join(__dirname, '../prompts');
  if (existsSync(portablePath)) {
    return portablePath;
  }

  // 3. Dev mode: compiled to apps/worker/dist/jobs/utils/ → 5 levels up → repo root
  return join(__dirname, '../../../../../packages/ai/prompts');
}
