import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let _promptsDirOverride: string | null = null;

/** Override the prompts directory (for bundled/Electron builds). */
export function setPromptsDir(dir: string): void {
  _promptsDirOverride = dir;
}

function resolvePromptsDir(): string {
  return _promptsDirOverride ?? path.resolve(__dirname, '../../prompts');
}

export interface PromptModelDefaults {
  temperature: number;
  max_tokens: number;
}

export interface PromptMeta {
  id: string;
  version: string;
  model_defaults: PromptModelDefaults;
  schema_id: string;
}

export interface LoadedPrompt {
  meta: PromptMeta;
  /** Raw template string with {{variable}} placeholders. */
  template: string;
}

/**
 * Parse a minimal YAML-like frontmatter block between --- delimiters.
 * Handles: top-level string fields and one level of nested key: value (for model_defaults).
 */
function parseFrontmatter(content: string): { meta: Record<string, unknown>; body: string } {
  // Normalize line endings (Windows CRLF → LF) so the regex works cross-platform
  const normalized = content.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(normalized);
  if (!match) {
    throw new Error('Prompt file missing frontmatter (--- delimiters)');
  }

  const frontmatter = match[1];
  const body = match[2];
  const lines = frontmatter.split('\n');
  const meta: Record<string, unknown> = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip indented lines and list items — handled in nested block
    if (line.startsWith('  ')) {
      i++;
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();

    if (val === '') {
      // Nested object block: collect indented lines
      const nested: Record<string, unknown> = {};
      i++;
      while (i < lines.length && lines[i].startsWith('  ') && !lines[i].trimStart().startsWith('- ')) {
        const subLine = lines[i].trimStart();
        const subColonIdx = subLine.indexOf(':');
        if (subColonIdx !== -1) {
          const subKey = subLine.slice(0, subColonIdx).trim();
          const subVal = subLine.slice(subColonIdx + 1).trim();
          const numVal = parseFloat(subVal);
          nested[subKey] = isNaN(numVal) ? subVal : numVal;
        }
        i++;
      }
      meta[key] = nested;
    } else {
      meta[key] = val;
      i++;
    }
  }

  return { meta, body };
}

/**
 * Load a versioned prompt by id + version from the prompts/ directory.
 * Filename convention: `{id}_{version}.md` (e.g. `repo_analysis_v1.md`)
 */
export function loadPrompt(id: string, version: string): LoadedPrompt {
  const filename = `${id}_${version}.md`;
  const filePath = path.join(resolvePromptsDir(), filename);

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    throw new Error(`Prompt file not found: ${filePath}`);
  }

  const { meta, body } = parseFrontmatter(raw);

  if (typeof meta.id !== 'string' || meta.id !== id) {
    throw new Error(`Prompt id mismatch: expected "${id}", got "${String(meta.id)}"`);
  }
  if (typeof meta.version !== 'string' || meta.version !== version) {
    throw new Error(`Prompt version mismatch: expected "${version}", got "${String(meta.version)}"`);
  }

  const modelDefaults = (meta.model_defaults ?? {}) as Record<string, unknown>;

  const promptMeta: PromptMeta = {
    id: meta.id,
    version: meta.version,
    model_defaults: {
      temperature: typeof modelDefaults.temperature === 'number' ? modelDefaults.temperature : 0.2,
      max_tokens: typeof modelDefaults.max_tokens === 'number' ? modelDefaults.max_tokens : 1500,
    },
    schema_id: typeof meta.schema_id === 'string' ? meta.schema_id : '',
  };

  return { meta: promptMeta, template: body.trimStart() };
}

/**
 * Fill {{variable}} placeholders in a template string.
 * Unknown variables are left as-is.
 */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? (vars[key] ?? '') : `{{${key}}}`;
  });
}
