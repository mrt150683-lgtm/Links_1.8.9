import { config as loadDotenv } from 'dotenv';
import { ConfigSchema, type Config } from './schema.js';

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;

  // Load .env file if present (silent if missing)
  loadDotenv({ override: false });

  const result = ConfigSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Config validation failed:\n${issues}`);
  }

  _config = result.data;
  return _config;
}

/** Reset for testing purposes only */
export function _resetConfig(): void {
  _config = null;
}
