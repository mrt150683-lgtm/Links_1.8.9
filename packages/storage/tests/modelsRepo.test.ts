/**
 * Phase 6: Models Repository Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase, closeDatabase, runMigrations } from '../src/db.js';
import {
  getAllModels,
  getModelByName,
  getVisionModels,
  getLastFetchTime,
  replaceAllModels,
  clearModelsCache,
} from '../src/repos/modelsRepo.js';
import { unlinkSync } from 'node:fs';

const TEST_DB_PATH = './test-models-repo.db';

describe('Models Repository', () => {
  beforeEach(async () => {
    await initDatabase({ path: TEST_DB_PATH });
    await runMigrations();
  });

  afterEach(async () => {
    await closeDatabase();
    try {
      unlinkSync(TEST_DB_PATH);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  describe('replaceAllModels', () => {
    it('should insert models into empty cache', async () => {
      const models = [
        {
          name: 'anthropic/claude-3-5-sonnet',
          context_length: 200000,
          pricing_prompt: 0.000003,
          pricing_completion: 0.000015,
          supports_vision: true,
          supports_tools: true,
          architecture: 'transformer',
          modalities: 'text,image',
          top_provider: 'anthropic',
        },
        {
          name: 'openai/gpt-4-turbo',
          context_length: 128000,
          pricing_prompt: 0.00001,
          pricing_completion: 0.00003,
          supports_vision: true,
          supports_tools: true,
        },
      ];

      const count = await replaceAllModels(models);
      expect(count).toBe(2);

      const all = await getAllModels();
      expect(all).toHaveLength(2);
    });

    it('should replace existing models atomically', async () => {
      // Insert initial models
      await replaceAllModels([
        {
          name: 'model-1',
          context_length: 100000,
        },
      ]);

      const before = await getAllModels();
      expect(before).toHaveLength(1);

      // Replace with new models
      await replaceAllModels([
        {
          name: 'model-2',
          context_length: 200000,
        },
        {
          name: 'model-3',
          context_length: 150000,
        },
      ]);

      const after = await getAllModels();
      expect(after).toHaveLength(2);
      expect(after.find(m => m.name === 'model-1')).toBeUndefined();
      expect(after.find(m => m.name === 'model-2')).toBeDefined();
      expect(after.find(m => m.name === 'model-3')).toBeDefined();
    });
  });

  describe('getAllModels', () => {
    beforeEach(async () => {
      await replaceAllModels([
        {
          name: 'model-a',
          context_length: 100000,
          supports_vision: false,
          supports_tools: true,
        },
        {
          name: 'model-b',
          context_length: 200000,
          supports_vision: true,
          supports_tools: false,
        },
      ]);
    });

    it('should return all models sorted by name', async () => {
      const models = await getAllModels();
      expect(models).toHaveLength(2);
      expect(models[0].name).toBe('model-a');
      expect(models[1].name).toBe('model-b');
    });

    it('should return empty array when cache is empty', async () => {
      await clearModelsCache();
      const models = await getAllModels();
      expect(models).toEqual([]);
    });
  });

  describe('getModelByName', () => {
    beforeEach(async () => {
      await replaceAllModels([
        {
          name: 'test-model',
          context_length: 100000,
          pricing_prompt: 0.001,
          pricing_completion: 0.002,
          supports_vision: true,
          supports_tools: true,
        },
      ]);
    });

    it('should return model by name', async () => {
      const model = await getModelByName('test-model');
      expect(model).toBeDefined();
      expect(model?.name).toBe('test-model');
      expect(model?.context_length).toBe(100000);
      expect(model?.supports_vision).toBe(true);
      expect(model?.supports_tools).toBe(true);
    });

    it('should return null for non-existent model', async () => {
      const model = await getModelByName('non-existent');
      expect(model).toBeNull();
    });
  });

  describe('getVisionModels', () => {
    beforeEach(async () => {
      await replaceAllModels([
        {
          name: 'vision-model',
          context_length: 100000,
          supports_vision: true,
          supports_tools: false,
        },
        {
          name: 'text-model',
          context_length: 100000,
          supports_vision: false,
          supports_tools: true,
        },
      ]);
    });

    it('should return only models with vision support', async () => {
      const models = await getVisionModels();
      expect(models).toHaveLength(1);
      expect(models[0].name).toBe('vision-model');
      expect(models[0].supports_vision).toBe(true);
    });

    it('should return empty array when no vision models', async () => {
      await clearModelsCache();
      await replaceAllModels([
        {
          name: 'text-only',
          context_length: 100000,
          supports_vision: false,
        },
      ]);

      const models = await getVisionModels();
      expect(models).toEqual([]);
    });
  });

  describe('getLastFetchTime', () => {
    it('should return null when cache is empty', async () => {
      const time = await getLastFetchTime();
      expect(time).toBeNull();
    });

    it('should return most recent fetch time', async () => {
      const before = Date.now();
      await replaceAllModels([
        {
          name: 'test',
          context_length: 100000,
        },
      ]);
      const after = Date.now();

      const time = await getLastFetchTime();
      expect(time).toBeGreaterThanOrEqual(before);
      expect(time).toBeLessThanOrEqual(after);
    });
  });

  describe('clearModelsCache', () => {
    beforeEach(async () => {
      await replaceAllModels([
        {
          name: 'test-1',
          context_length: 100000,
        },
        {
          name: 'test-2',
          context_length: 200000,
        },
      ]);
    });

    it('should delete all models', async () => {
      const before = await getAllModels();
      expect(before).toHaveLength(2);

      const deleted = await clearModelsCache();
      expect(deleted).toBe(2);

      const after = await getAllModels();
      expect(after).toEqual([]);
    });

    it('should return 0 when cache already empty', async () => {
      await clearModelsCache();
      const deleted = await clearModelsCache();
      expect(deleted).toBe(0);
    });
  });
});
