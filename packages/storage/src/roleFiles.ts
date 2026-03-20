/**
 * Role File I/O
 *
 * Reads and writes user-defined role files from the userData roles directory.
 * User role files live at: $ROLES_DIR/pot/<potId>/role.md
 *
 * ROLES_DIR is set by the launcher to join(userData, 'roles').
 * In dev mode it falls back to a local temp directory.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve the user roles root directory.
 * Priority:
 *   1. USER_ROLES_DIR env var (set by launcher to userData/roles)
 *   2. ROLES_DIR env var (dev/test mode — single directory for both)
 *   3. Dev fallback (relative to package)
 */
function getRolesRoot(): string {
  if (process.env.USER_ROLES_DIR) {
    return process.env.USER_ROLES_DIR;
  }
  if (process.env.ROLES_DIR) {
    return process.env.ROLES_DIR;
  }
  // Dev fallback: write to repo root .dev-roles/ (ignored by git)
  return join(__dirname, '../../../.dev-roles');
}

/**
 * Return the absolute path to a pot's user role file.
 */
export function getRoleFilePath(potId: string): string {
  return join(getRolesRoot(), 'pot', potId, 'role.md');
}

/**
 * Read the user-defined role file for a pot.
 * Returns null if no role file exists.
 */
export function readRoleFile(potId: string): string | null {
  const filePath = getRoleFilePath(potId);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Write a user-defined role file for a pot.
 * Creates the directory if it doesn't exist.
 */
export function writeRoleFile(potId: string, text: string): void {
  const filePath = getRoleFilePath(potId);
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, text, 'utf-8');
}
