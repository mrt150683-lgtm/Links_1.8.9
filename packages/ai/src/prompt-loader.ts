/**
 * Phase 7: Prompt Loader
 *
 * Loads prompts from markdown files with frontmatter metadata
 * and registers them in the prompt registry
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerPrompt, type PromptTemplate } from './prompts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Parse frontmatter from markdown file
 * Format:
 * ---
 * key: value
 * ---
 * content
 */
function parseFrontmatter(content: string): {
  metadata: Record<string, unknown>;
  body: string;
} {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    throw new Error('Invalid prompt file: missing frontmatter');
  }

  const frontmatter = match[1];
  const body = match[2];

  if (!frontmatter || !body) {
    throw new Error('Invalid prompt file: malformed frontmatter');
  }

  const metadata: Record<string, unknown> = {};

  // Parse YAML-style key: value pairs
  for (const line of frontmatter.split('\n')) {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length > 0) {
      const value = valueParts.join(':').trim();

      // Parse numbers
      if (/^\d+(\.\d+)?$/.test(value)) {
        metadata[key.trim()] = parseFloat(value);
      } else {
        metadata[key.trim()] = value;
      }
    }
  }

  return { metadata, body: body.trim() };
}

/**
 * Extract system and user sections from markdown body
 */
function extractSections(body: string): { system: string; user: string } {
  const systemMatch = body.match(/# System\n\n([\s\S]*?)(?=\n# User|$)/);
  const userMatch = body.match(/# User\n\n([\s\S]*?)$/);

  if (!systemMatch || !systemMatch[1] || !userMatch || !userMatch[1]) {
    throw new Error('Invalid prompt file: missing System or User section');
  }

  return {
    system: systemMatch[1].trim(),
    user: userMatch[1].trim(),
  };
}

/**
 * Load prompt from markdown file
 */
export function loadPromptFromFile(filePath: string): PromptTemplate {
  const content = readFileSync(filePath, 'utf-8');
  const { metadata, body } = parseFrontmatter(content);
  const { system, user } = extractSections(body);

  // Validate required metadata
  const required = ['id', 'version', 'description', 'temperature'];
  for (const field of required) {
    if (!(field in metadata)) {
      throw new Error(`Invalid prompt file: missing required field '${field}'`);
    }
  }

  // Build prompt template
  const template: PromptTemplate = {
    metadata: {
      id: String(metadata.id),
      version: Number(metadata.version),
      description: String(metadata.description),
      created_at: String(metadata.created_at || new Date().toISOString().split('T')[0]),
      temperature: Number(metadata.temperature),
      max_tokens: metadata.max_tokens ? Number(metadata.max_tokens) : undefined,
      response_format: (metadata.response_format as 'text' | 'json_object') || 'text',
    },
    system,
    user,
  };

  return template;
}

/**
 * Load and register Phase 7 prompts
 */
export function loadPhase7Prompts(): void {
  const promptsDir = join(__dirname, '..', 'prompts');

  // Load tag_entry v1
  const tagPrompt = loadPromptFromFile(join(promptsDir, 'tag_entry', 'v1.md'));
  registerPrompt(tagPrompt);

  // Load extract_entities v1
  const entityPrompt = loadPromptFromFile(join(promptsDir, 'extract_entities', 'v1.md'));
  registerPrompt(entityPrompt);

  // Load summarize_entry v1
  const summaryPrompt = loadPromptFromFile(join(promptsDir, 'summarize_entry', 'v1.md'));
  registerPrompt(summaryPrompt);
}
