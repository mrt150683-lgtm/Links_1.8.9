import { createHash } from 'node:crypto';

/**
 * Canonicalize text for stable hashing
 *
 * Steps:
 * 1. CRLF → LF
 * 2. Trim trailing whitespace from each line
 * 3. Collapse 3+ consecutive blank lines to 2
 * 4. Trim overall leading/trailing whitespace
 *
 * This ensures same content with different formatting hashes identically.
 */
export function canonicalizeText(text: string): string {
  // Step 1: Normalize line endings (CRLF → LF)
  let canonical = text.replace(/\r\n/g, '\n');

  // Step 2: Trim trailing whitespace from each line
  canonical = canonical
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n');

  // Step 3: Collapse 3+ consecutive blank lines to 2
  canonical = canonical.replace(/\n{3,}/g, '\n\n');

  // Step 4: Trim overall leading/trailing whitespace
  canonical = canonical.trim();

  return canonical;
}

/**
 * Compute SHA-256 hash of canonicalized text
 *
 * Returns lowercase hex string (64 characters)
 */
export function hashText(text: string): string {
  const canonical = canonicalizeText(text);
  const hash = createHash('sha256');
  hash.update(canonical, 'utf8');
  return hash.digest('hex');
}

/**
 * Compute hash directly from already-canonicalized text
 * (useful when canonical form is already known)
 */
export function hashCanonical(canonicalText: string): string {
  const hash = createHash('sha256');
  hash.update(canonicalText, 'utf8');
  return hash.digest('hex');
}
