/**
 * Prompts directory resolver for deep-research package.
 * Delegates to the same env var / relative path logic as the worker.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function getPromptsDir(): string {
  if (process.env.PROMPTS_DIR) {
    return process.env.PROMPTS_DIR;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Packaged layout: prompts at <app>/prompts/
  const portablePath = join(__dirname, '../../../prompts');
  if (existsSync(portablePath)) {
    return portablePath;
  }

  // Dev mode: packages/deep-research/dist/ → 3 dirs up → packages/ → ai/prompts
  return join(__dirname, '../../../ai/prompts');
}
