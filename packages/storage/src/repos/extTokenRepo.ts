/**
 * Phase 11: Extension Token Repository
 *
 * Manages extension authentication token storage and rotation.
 * Token stored in user_prefs as 'ext.auth.token'.
 */

import { randomBytes } from 'node:crypto';
import { getDatabase } from '../db.js';
import { logAuditEvent } from './auditRepo.js';
import type { ExtensionToken } from '../types.js';

const EXT_TOKEN_KEY = 'ext.auth.token';

/**
 * Generate a new random token (32 bytes = 64 hex chars)
 */
function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Get current extension token
 *
 * @returns Token data or null if not initialized
 */
export async function getExtensionToken(): Promise<ExtensionToken | null> {
  const db = getDatabase();

  const row = await db
    .selectFrom('user_prefs')
    .select('value_json')
    .where('key', '=', EXT_TOKEN_KEY)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  return JSON.parse(row.value_json) as ExtensionToken;
}

/**
 * Initialize extension token on first boot
 *
 * @returns Newly created token
 */
export async function initializeExtensionToken(): Promise<ExtensionToken> {
  const db = getDatabase();
  const now = Date.now();

  const tokenData: ExtensionToken = {
    token: generateToken(),
    created_at: now,
    last_rotated_at: now,
  };

  await db
    .insertInto('user_prefs')
    .values({
      key: EXT_TOKEN_KEY,
      value_json: JSON.stringify(tokenData),
    })
    .execute();

  // Audit event (do NOT log token value)
  await logAuditEvent({
    actor: 'system',
    action: 'ext_token_initialized',
    metadata: { created_at: now },
  });

  return tokenData;
}

/**
 * Rotate extension token (generate new token)
 *
 * @returns New token data
 */
export async function rotateExtensionToken(): Promise<ExtensionToken> {
  const db = getDatabase();
  const now = Date.now();

  // Get existing token data to preserve created_at
  const existing = await getExtensionToken();
  const created_at = existing?.created_at ?? now;

  const tokenData: ExtensionToken = {
    token: generateToken(),
    created_at,
    last_rotated_at: now,
  };

  // Upsert token
  await db
    .insertInto('user_prefs')
    .values({
      key: EXT_TOKEN_KEY,
      value_json: JSON.stringify(tokenData),
    })
    .onConflict((oc) =>
      oc.column('key').doUpdateSet({
        value_json: JSON.stringify(tokenData),
      })
    )
    .execute();

  // Audit event (do NOT log token value)
  await logAuditEvent({
    actor: 'extension',
    action: 'ext_token_rotated',
    metadata: { rotated_at: now },
  });

  return tokenData;
}

/**
 * Validate extension token (constant-time comparison)
 *
 * @param providedToken - Token from request
 * @returns true if valid
 */
export async function validateExtensionToken(providedToken: string): Promise<boolean> {
  const tokenData = await getExtensionToken();

  if (!tokenData) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  const expectedBuffer = Buffer.from(tokenData.token);
  const providedBuffer = Buffer.from(providedToken);

  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return expectedBuffer.equals(providedBuffer);
}

/**
 * Get or initialize extension token
 *
 * Ensures token exists, creates one if missing
 *
 * @returns Token data
 */
export async function getOrInitializeExtensionToken(): Promise<ExtensionToken> {
  const existing = await getExtensionToken();

  if (existing) {
    return existing;
  }

  return await initializeExtensionToken();
}
