import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import os from 'os';
import type { StoredLicense } from './schemas.js';

/**
 * Determine the license directory
 * Respects LINKS_LICENSE_DIR env var (set by launcher),
 * falls back to standard locations
 */
function getLicenseDir(): string {
  if (process.env.LINKS_LICENSE_DIR) {
    return process.env.LINKS_LICENSE_DIR;
  }

  // On Windows, use APPDATA\Links
  if (process.env.APPDATA) {
    return join(process.env.APPDATA, 'Links');
  }

  // Fallback to home directory
  return join(os.homedir(), '.links');
}

function getLicensePath(): string {
  const dir = getLicenseDir();
  return join(dir, 'license.lic');
}

/**
 * Read license from disk
 * Returns the parsed license object, or null if not found/unreadable
 */
export function readLicenseFile(): StoredLicense | null {
  try {
    const path = getLicensePath();
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as StoredLicense;
  } catch {
    return null;
  }
}

/**
 * Write license to disk
 * Creates directory if needed
 */
export function writeLicenseFile(license: StoredLicense): void {
  const dir = getLicenseDir();
  mkdirSync(dir, { recursive: true });
  const path = getLicensePath();
  writeFileSync(path, JSON.stringify(license, null, 2));
}
