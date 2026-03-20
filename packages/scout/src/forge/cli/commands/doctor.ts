import { loadConfig } from '../../../config/load.js';
import { openDb } from '../../../db/index.js';
import { getLatestMigration } from '../../../db/migrate.js';
import fs from 'fs';
import path from 'path';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  message: string;
  fatal: boolean;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

export function runDoctor(): DoctorResult {
  const checks: DoctorCheck[] = [];
  let config;

  // 1) Config validation
  try {
    config = loadConfig();
    checks.push({ name: 'config', ok: true, message: 'Config loaded and validated', fatal: true });
  } catch (err) {
    checks.push({
      name: 'config',
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      fatal: true,
    });
    return { ok: false, checks };
  }

  // 2) DB check
  let dbPath: string | undefined;
  if (config.CS_DB_PATH) {
    const parsed = path.parse(config.CS_DB_PATH);
    dbPath = path.join(parsed.dir, `${parsed.name}${config.FORGE_DB_SUFFIX}${parsed.ext}`);
  }
  
  if (!dbPath) {
    checks.push({
      name: 'db',
      ok: false,
      message: 'DB not initialized yet (CS_DB_PATH not set)',
      fatal: false,
    });
  } else if (!fs.existsSync(dbPath)) {
    checks.push({
      name: 'db',
      ok: false,
      message: `Forge DB not found at ${dbPath} (run forge:db:migrate first)`,
      fatal: false,
    });
  } else {
    try {
      const db = openDb({ path: dbPath, readonly: true });
      const latestMigration = getLatestMigration(db);
      db.close();
      if (latestMigration) {
        checks.push({
          name: 'db',
          ok: true,
          message: `Forge DB schema ok (latest migration: ${latestMigration})`,
          fatal: false,
        });
      } else {
        checks.push({
          name: 'db',
          ok: false,
          message: 'Forge DB exists but no migrations applied (run forge:db:migrate)',
          fatal: false,
        });
      }
    } catch (err) {
      checks.push({
        name: 'db',
        ok: false,
        message: `Forge DB error: ${err instanceof Error ? err.message : String(err)}`,
        fatal: false,
      });
    }
  }

  // 3) GitHub auth
  if (!config.GITHUB_TOKEN) {
    checks.push({
      name: 'github_auth',
      ok: false,
      message: 'GITHUB_TOKEN not set (required for real runs)',
      fatal: false,
    });
  } else {
    checks.push({ name: 'github_auth', ok: true, message: 'GITHUB_TOKEN is set', fatal: false });
  }

  // 4) OpenRouter auth
  if (!config.OPENROUTER_API_KEY) {
    checks.push({
      name: 'openrouter_auth',
      ok: false,
      message: 'OPENROUTER_API_KEY not set (required for real runs)',
      fatal: false,
    });
  } else {
    checks.push({
      name: 'openrouter_auth',
      ok: true,
      message: 'OPENROUTER_API_KEY is set',
      fatal: false,
    });
  }

  const fatalFailed = checks.some((c) => c.fatal && !c.ok);
  return { ok: !fatalFailed, checks };
}

export function formatDoctorResult(result: DoctorResult, verbose: boolean): string {
  if (!verbose) {
    return JSON.stringify(result, null, 2);
  }
  const lines: string[] = [`Forge Doctor: ${result.ok ? 'OK' : 'FAILED'}`];
  for (const check of result.checks) {
    const status = check.ok ? '✓' : check.fatal ? '✗' : '⚠';
    lines.push(`  ${status} ${check.name}: ${check.message}`);
  }
  return lines.join('\n');
}
