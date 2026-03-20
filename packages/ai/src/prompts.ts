/**
 * Phase 6: Prompt Registry
 *
 * Versioned prompt templates with metadata for reproducibility
 */

import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'prompts' });

/**
 * Prompt metadata
 */
export interface PromptMetadata {
  id: string;
  version: number;
  description: string;
  created_at: string; // ISO date
  temperature: number;
  max_tokens?: number;
  response_format?: 'text' | 'json_object';
}

/**
 * Prompt template
 */
export interface PromptTemplate {
  metadata: PromptMetadata;
  system: string;
  user: string | ((variables: Record<string, unknown>) => string);
}

/**
 * Registered prompts
 */
const PROMPTS = new Map<string, PromptTemplate[]>();

/**
 * Register a prompt template
 */
export function registerPrompt(prompt: PromptTemplate): void {
  const existing = PROMPTS.get(prompt.metadata.id) || [];
  existing.push(prompt);
  existing.sort((a, b) => b.metadata.version - a.metadata.version); // Descending order
  PROMPTS.set(prompt.metadata.id, existing);

  logger.debug({
    id: prompt.metadata.id,
    version: prompt.metadata.version,
  }, 'Registered prompt');
}

/**
 * Get prompt by ID and version (latest if version not specified)
 */
export function getPrompt(id: string, version?: number): PromptTemplate {
  const versions = PROMPTS.get(id);

  if (!versions || versions.length === 0) {
    throw new Error(`Prompt not found: ${id}`);
  }

  if (version !== undefined) {
    const found = versions.find(p => p.metadata.version === version);
    if (!found) {
      throw new Error(`Prompt version not found: ${id}@${version}`);
    }
    return found;
  }

  // Return latest version
  const latest = versions[0];
  if (!latest) {
    throw new Error(`No versions available for prompt: ${id}`);
  }
  return latest;
}

/**
 * Get all versions of a prompt
 */
export function getPromptVersions(id: string): PromptTemplate[] {
  return PROMPTS.get(id) || [];
}

/**
 * List all prompt IDs
 */
export function listPromptIds(): string[] {
  return Array.from(PROMPTS.keys());
}

/**
 * Interpolate prompt template with variables
 */
export function interpolatePrompt(
  prompt: PromptTemplate,
  variables: Record<string, unknown>
): { system: string; user: string } {
  let userMessage: string;

  if (typeof prompt.user === 'function') {
    userMessage = prompt.user(variables);
  } else {
    userMessage = prompt.user;
    // Simple template interpolation: {{varName}}
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      userMessage = userMessage.replaceAll(placeholder, String(value));
    }
  }

  return {
    system: prompt.system,
    user: userMessage,
  };
}

/**
 * Phase 6: Diagnostic prompt (test connectivity)
 */
registerPrompt({
  metadata: {
    id: 'diagnostic',
    version: 1,
    description: 'Test prompt for verifying OpenRouter connectivity',
    created_at: '2026-02-13',
    temperature: 0.0,
    max_tokens: 50,
    response_format: 'text',
  },
  system: 'You are a diagnostic assistant. Respond briefly and accurately.',
  user: 'Reply with exactly: "OpenRouter connection successful"',
});

/**
 * Phase 7+: Future prompts will be registered here
 * Examples:
 * - tagging_v1: Extract tags from text
 * - linking_v1: Find related entries
 * - summarization_v1: Generate summary
 * - entity_extraction_v1: Extract entities
 */
