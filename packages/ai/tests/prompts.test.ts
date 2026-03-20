/**
 * Phase 6: Prompt Registry Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerPrompt,
  getPrompt,
  getPromptVersions,
  listPromptIds,
  interpolatePrompt,
  type PromptTemplate,
} from '../src/prompts.js';

// Mock logger
import { vi } from 'vitest';
vi.mock('@links/logging', () => ({
  createLogger: () => ({
    debug: vi.fn(),
  }),
}));

describe('Prompt Registry', () => {
  const testPromptV1: PromptTemplate = {
    metadata: {
      id: 'test-prompt',
      version: 1,
      description: 'Test prompt v1',
      created_at: '2026-01-01',
      temperature: 0.2,
    },
    system: 'You are a test assistant.',
    user: 'Process this: {{input}}',
  };

  const testPromptV2: PromptTemplate = {
    metadata: {
      id: 'test-prompt',
      version: 2,
      description: 'Test prompt v2',
      created_at: '2026-02-01',
      temperature: 0.3,
    },
    system: 'You are an improved test assistant.',
    user: 'Analyze: {{input}}',
  };

  beforeEach(() => {
    // Note: In a real scenario, we'd clear the registry
    // For now, tests assume prompts are registered
  });

  describe('registerPrompt', () => {
    it('should register a prompt', () => {
      registerPrompt(testPromptV1);
      const retrieved = getPrompt('test-prompt', 1);
      expect(retrieved.metadata.id).toBe('test-prompt');
      expect(retrieved.metadata.version).toBe(1);
    });

    it('should register multiple versions', () => {
      registerPrompt(testPromptV1);
      registerPrompt(testPromptV2);

      const versions = getPromptVersions('test-prompt');
      expect(versions.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getPrompt', () => {
    beforeEach(() => {
      registerPrompt(testPromptV1);
      registerPrompt(testPromptV2);
    });

    it('should get latest version by default', () => {
      const prompt = getPrompt('test-prompt');
      expect(prompt.metadata.version).toBe(2);
    });

    it('should get specific version', () => {
      const prompt = getPrompt('test-prompt', 1);
      expect(prompt.metadata.version).toBe(1);
      expect(prompt.system).toBe('You are a test assistant.');
    });

    it('should throw on non-existent prompt', () => {
      expect(() => getPrompt('non-existent')).toThrow('Prompt not found: non-existent');
    });

    it('should throw on non-existent version', () => {
      expect(() => getPrompt('test-prompt', 99)).toThrow('Prompt version not found: test-prompt@99');
    });
  });

  describe('getPromptVersions', () => {
    beforeEach(() => {
      registerPrompt(testPromptV1);
      registerPrompt(testPromptV2);
    });

    it('should return all versions in descending order', () => {
      const versions = getPromptVersions('test-prompt');
      expect(versions.length).toBeGreaterThanOrEqual(2);
      expect(versions[0].metadata.version).toBeGreaterThan(versions[1].metadata.version);
    });

    it('should return empty array for non-existent prompt', () => {
      const versions = getPromptVersions('non-existent');
      expect(versions).toEqual([]);
    });
  });

  describe('listPromptIds', () => {
    it('should list all registered prompt IDs', () => {
      const ids = listPromptIds();
      expect(ids).toContain('diagnostic'); // Registered in prompts.ts
    });
  });

  describe('interpolatePrompt', () => {
    beforeEach(() => {
      registerPrompt(testPromptV1);
    });

    it('should interpolate variables in string template', () => {
      const prompt = getPrompt('test-prompt', 1);
      const result = interpolatePrompt(prompt, { input: 'Hello world' });

      expect(result.system).toBe('You are a test assistant.');
      expect(result.user).toBe('Process this: Hello world');
    });

    it('should handle multiple variables', () => {
      const multiVarPrompt: PromptTemplate = {
        metadata: {
          id: 'multi-var',
          version: 1,
          description: 'Multi-var test',
          created_at: '2026-02-13',
          temperature: 0.2,
        },
        system: 'System prompt',
        user: 'Name: {{name}}, Age: {{age}}',
      };

      registerPrompt(multiVarPrompt);
      const result = interpolatePrompt(multiVarPrompt, { name: 'Alice', age: 30 });

      expect(result.user).toBe('Name: Alice, Age: 30');
    });

    it('should handle function-based user template', () => {
      const funcPrompt: PromptTemplate = {
        metadata: {
          id: 'func-prompt',
          version: 1,
          description: 'Function test',
          created_at: '2026-02-13',
          temperature: 0.2,
        },
        system: 'System prompt',
        user: (vars) => `Computed: ${vars.value}`,
      };

      registerPrompt(funcPrompt);
      const result = interpolatePrompt(funcPrompt, { value: 42 });

      expect(result.user).toBe('Computed: 42');
    });
  });

  describe('diagnostic prompt', () => {
    it('should have diagnostic prompt registered', () => {
      const prompt = getPrompt('diagnostic');
      expect(prompt.metadata.id).toBe('diagnostic');
      expect(prompt.metadata.version).toBe(1);
      expect(prompt.metadata.temperature).toBe(0.0);
    });
  });
});
