import { SECRET_KEY_PATTERNS } from './schema.js';

const REDACTED = '***REDACTED***';

/**
 * Recursively redact sensitive values from an object by key name.
 * Works on plain objects and arrays.
 */
export function redactSecrets(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERNS.test(k)) {
        result[k] = typeof v === 'string' && v.length > 0 ? REDACTED : v;
      } else {
        result[k] = redactSecrets(v);
      }
    }
    return result;
  }

  return value;
}

/**
 * Redact a string value if the key name is sensitive.
 */
export function redactValue(key: string, value: string): string {
  if (SECRET_KEY_PATTERNS.test(key) && value.length > 0) {
    return REDACTED;
  }
  return value;
}
