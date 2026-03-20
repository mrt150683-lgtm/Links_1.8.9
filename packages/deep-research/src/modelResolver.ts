/**
 * Model Resolver for Deep Research Agent
 *
 * Resolves which AI model to use for a given task, following this priority chain:
 *   run.model_overrides[taskKey] → run.selected_model → AI prefs (deep_research) → fallback default
 */

import { getAIPreferences } from '@links/storage';

export type ResearchTaskKey = 'plan' | 'execute' | 'delta' | 'novelty';

const FALLBACK_MODEL = 'x-ai/grok-4.1-fast';

/**
 * Resolve the model to use for a given research task.
 */
export async function resolveResearchModel(
  runConfig: {
    selected_model?: string | null;
    model_overrides?: Record<string, string> | null;
  },
  taskKey: ResearchTaskKey
): Promise<string> {
  // 1. Per-task override on the run
  const taskOverride = runConfig.model_overrides?.[taskKey];
  if (taskOverride) return taskOverride;

  // 2. Run-level model override
  if (runConfig.selected_model) return runConfig.selected_model;

  // 3. AI preferences (deep_research task model)
  const prefs = await getAIPreferences();
  const prefModel = prefs.task_models?.deep_research ?? prefs.default_model;
  if (prefModel) return prefModel;

  // 4. Fallback
  return FALLBACK_MODEL;
}
