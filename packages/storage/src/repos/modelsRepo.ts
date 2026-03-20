/**
 * Phase 6: AI Models Repository
 *
 * Manages cached model metadata from OpenRouter API
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type { AiModel } from '../types.js';

/**
 * Get all models from cache
 */
export async function getAllModels(): Promise<AiModel[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('ai_models')
    .selectAll()
    .orderBy('name', 'asc')
    .execute();

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    context_length: row.context_length,
    pricing_prompt: row.pricing_prompt,
    pricing_completion: row.pricing_completion,
    supports_vision: row.supports_vision === 1,
    supports_tools: row.supports_tools === 1,
    architecture: row.architecture,
    modalities: row.modalities,
    top_provider: row.top_provider,
    fetched_at: row.fetched_at,
    created_at: row.created_at,
  }));
}

/**
 * Get model by name
 */
export async function getModelByName(name: string): Promise<AiModel | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('ai_models')
    .selectAll()
    .where('name', '=', name)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    context_length: row.context_length,
    pricing_prompt: row.pricing_prompt,
    pricing_completion: row.pricing_completion,
    supports_vision: row.supports_vision === 1,
    supports_tools: row.supports_tools === 1,
    architecture: row.architecture,
    modalities: row.modalities,
    top_provider: row.top_provider,
    fetched_at: row.fetched_at,
    created_at: row.created_at,
  };
}

/**
 * Get models with vision support
 */
export async function getVisionModels(): Promise<AiModel[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('ai_models')
    .selectAll()
    .where('supports_vision', '=', 1)
    .orderBy('name', 'asc')
    .execute();

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    context_length: row.context_length,
    pricing_prompt: row.pricing_prompt,
    pricing_completion: row.pricing_completion,
    supports_vision: row.supports_vision === 1,
    supports_tools: row.supports_tools === 1,
    architecture: row.architecture,
    modalities: row.modalities,
    top_provider: row.top_provider,
    fetched_at: row.fetched_at,
    created_at: row.created_at,
  }));
}

/**
 * Get timestamp of most recent model fetch
 */
export async function getLastFetchTime(): Promise<number | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('ai_models')
    .select('fetched_at')
    .orderBy('fetched_at', 'desc')
    .limit(1)
    .executeTakeFirst();

  return row?.fetched_at ?? null;
}

/**
 * Replace all models (used during refresh)
 * Deletes old cache and inserts new models atomically
 */
export async function replaceAllModels(
  models: Array<{
    name: string;
    context_length: number;
    pricing_prompt?: number;
    pricing_completion?: number;
    supports_vision?: boolean;
    supports_tools?: boolean;
    architecture?: string;
    modalities?: string;
    top_provider?: string;
  }>
): Promise<number> {
  const db = getDatabase();
  const now = Date.now();

  // Use transaction for atomic replacement
  await db.transaction().execute(async (trx) => {
    // Delete old cache
    await trx.deleteFrom('ai_models').execute();

    // Insert new models
    if (models.length > 0) {
      await trx
        .insertInto('ai_models')
        .values(
          models.map(m => ({
            id: randomUUID(),
            name: m.name,
            context_length: m.context_length,
            pricing_prompt: m.pricing_prompt ?? null,
            pricing_completion: m.pricing_completion ?? null,
            supports_vision: m.supports_vision ? 1 : 0,
            supports_tools: m.supports_tools ? 1 : 0,
            architecture: m.architecture ?? null,
            modalities: m.modalities ?? null,
            top_provider: m.top_provider ?? null,
            fetched_at: now,
            created_at: now,
          }))
        )
        .execute();
    }
  });

  return models.length;
}

/**
 * Delete all models (used for cache invalidation)
 */
export async function clearModelsCache(): Promise<number> {
  const db = getDatabase();
  const result = await db.deleteFrom('ai_models').executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}
