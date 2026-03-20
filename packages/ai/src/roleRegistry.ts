/**
 * Agent Role Registry
 *
 * Resolves the effective AI role for a pot. Supports three sources:
 *   - 'user:'   → user-defined role file at $ROLES_DIR/pot/<potId>/role.md
 *   - 'builtin:' → bundled builtin role in packages/ai/roles/<id>/v1.md
 *   - null/undefined → default builtin role (default/v1.md)
 *
 * Roles are injected into every AI job's system prompt via promptAssembly.ts.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Types
// ============================================================================

export interface ResolvedRole {
  /** Normalised role text ready for injection */
  text: string;
  /** Where the role was loaded from */
  source: 'user' | 'builtin' | 'default';
  /** The role_ref stored in the pot (e.g. 'builtin:forensic_analyst') */
  ref: string;
  /** SHA-256 hex of the canonicalised role text */
  hash: string;
}

// ============================================================================
// Directory resolution (mirrors getPromptsDir pattern)
// ============================================================================

/**
 * Returns the directory that contains builtin role subdirectories.
 * Priority:
 *   1. ROLES_DIR env var (set by launcher in packaged app)
 *   2. ../roles relative to __dirname (packaged/portable layout)
 *   3. Dev fallback: packages/ai/roles
 */
export function getRolesDir(): string {
  if (process.env.ROLES_DIR) {
    return process.env.ROLES_DIR;
  }

  // Packaged/portable layout: bundle at <app>/worker-dist/bundle.cjs,
  // roles land at <app>/roles/ via electron-builder extraFiles
  const portablePath = join(__dirname, '../roles');
  if (existsSync(portablePath)) {
    return portablePath;
  }

  // Dev mode: compiled to packages/ai/dist/ → one level up → packages/ai/roles
  return join(__dirname, '../roles');
}

/**
 * Returns the directory for user-defined role files.
 * Priority:
 *   1. USER_ROLES_DIR env var (set by launcher to userData/roles)
 *   2. ROLES_DIR env var (dev/test mode — single directory for both)
 *   3. Dev fallback: same as getRolesDir()
 */
export function getUserRolesDir(): string {
  if (process.env.USER_ROLES_DIR) {
    return process.env.USER_ROLES_DIR;
  }
  // In dev/test mode, ROLES_DIR doubles as user roles dir
  return getRolesDir();
}

// ============================================================================
// Text processing
// ============================================================================

/**
 * Normalise a role text string: CRLF → LF, trailing whitespace trimmed per line,
 * leading/trailing blank lines removed.
 */
export function canonicalizeRole(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/**
 * Compute a SHA-256 hex digest of the canonicalised role text.
 * Used as the idempotency key stored in derived_artifacts.role_hash.
 */
export function hashRole(text: string): string {
  return createHash('sha256').update(canonicalizeRole(text), 'utf8').digest('hex');
}

// ============================================================================
// Linting
// ============================================================================

const RECOMMENDED_SECTIONS = ['## Goals', '## Do', "## Don't"];
const MAX_ROLE_CHARS = 12000;

/**
 * Lint a role text and return an array of warning strings.
 * Empty array means no warnings. Warnings are non-blocking.
 */
export function lintRole(text: string): string[] {
  const warnings: string[] = [];

  if (text.length > MAX_ROLE_CHARS) {
    warnings.push(
      `Role text is ${text.length} characters, which exceeds the recommended limit of ${MAX_ROLE_CHARS}. Very long roles may consume excessive tokens.`
    );
  }

  for (const section of RECOMMENDED_SECTIONS) {
    if (!text.includes(section)) {
      warnings.push(`Role is missing recommended section "${section}".`);
    }
  }

  return warnings;
}

// ============================================================================
// Role resolution
// ============================================================================

/**
 * Load role text from a file path. Returns null if the file does not exist.
 */
function loadRoleFile(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Load and return the default role. Never throws — if the file is missing
 * in a misconfigured environment, returns a minimal inline default.
 */
function loadDefaultRole(): ResolvedRole {
  const rolesDir = getRolesDir();
  const filePath = join(rolesDir, 'default', 'v1.md');
  const raw = loadRoleFile(filePath);

  const text = raw
    ? canonicalizeRole(raw)
    : 'You are a meticulous research assistant. Extract only facts directly supported by the provided content.';

  return {
    text,
    source: 'default',
    ref: 'builtin:default',
    hash: hashRole(text),
  };
}

/**
 * Resolve the effective role for a pot.
 *
 * @param pot - Pot object with at least `id` and optional `role_ref`
 * @returns Resolved role with text, source, ref, and hash
 */
export async function resolveEffectiveRole(pot: {
  id: string;
  role_ref?: string | null;
}): Promise<ResolvedRole> {
  const roleRef = pot.role_ref ?? null;

  // No role set → default
  if (!roleRef) {
    return loadDefaultRole();
  }

  // User-defined role
  if (roleRef === 'user:') {
    const userDir = getUserRolesDir();
    const filePath = join(userDir, 'pot', pot.id, 'role.md');
    const raw = loadRoleFile(filePath);

    if (!raw) {
      // File missing — fall back to default
      return loadDefaultRole();
    }

    const text = canonicalizeRole(raw);
    return {
      text,
      source: 'user',
      ref: 'user:',
      hash: hashRole(text),
    };
  }

  // Builtin role
  if (roleRef.startsWith('builtin:')) {
    const roleId = roleRef.slice('builtin:'.length);
    const rolesDir = getRolesDir();
    const filePath = join(rolesDir, roleId, 'v1.md');
    const raw = loadRoleFile(filePath);

    if (!raw) {
      // Unknown builtin → fall back to default
      return loadDefaultRole();
    }

    const text = canonicalizeRole(raw);
    return {
      text,
      source: 'builtin',
      ref: roleRef,
      hash: hashRole(text),
    };
  }

  // Unrecognised role_ref format → default
  return loadDefaultRole();
}
