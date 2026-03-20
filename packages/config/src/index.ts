import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

// Load .env file from project root
// Navigate up from packages/config/dist to project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..', '..', '..');
loadEnv({ path: join(projectRoot, '.env') });

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_PATH: z.string().default('./data/links.db'),

  // Phase 4: Encryption and asset storage
  ENCRYPTION_KEY: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]{64}$/i, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
    .default(() => {
      // Auto-generate secure key for development if not provided
      const key = randomBytes(32).toString('hex');
      if (process.env.NODE_ENV !== 'test') {
        console.warn(
          '[config] ENCRYPTION_KEY not set, generated random key (will not persist across restarts)'
        );
        console.warn('[config] For production, set ENCRYPTION_KEY in .env');
      }
      return key;
    }),

  ASSET_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(50 * 1024 * 1024), // 50MB default

  ASSETS_DIR: z.string().default('./data/assets'),

  // Phase 9: Bundle export/import
  EXPORTS_DIR: z.string().default('./data/exports'),
  PASSPHRASE_MIN_LENGTH: z.coerce.number().int().positive().default(8),

  // Phase 6: OpenRouter AI integration
  OPENROUTER_API_KEY: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = ConfigSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid configuration:', result.error.format());
    throw new Error('Configuration validation failed');
  }

  cachedConfig = result.data;
  return cachedConfig;
}

export function resetConfig(): void {
  cachedConfig = null;
}
