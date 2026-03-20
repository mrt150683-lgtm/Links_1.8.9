import type { Db } from '../../db/index.js';
import { 
  createRunOrchestrator as createCoreOrchestrator, 
  type RunOrchestrator
} from '../../scout/run_context.js';
import { ForgeRunsDao } from '../db/dao/forge_runs.js';
import { logger } from '../../logging/logger.js';
import { AuditDao } from '../../db/dao/audit.js';

export const FORGE_STEP_NAMES = {
  SEED_INGESTION: 'seed_ingestion',
  KEYWORD_STORM: 'keyword_storm',
  FORGE_SEARCH: 'forge_search',
  SYNERGY_ANALYSIS: 'synergy_analysis',
  PACK_GENERATION: 'pack_generation',
} as const;

export interface ForgeRunOrchestrator extends RunOrchestrator {
  forge_run_id: string; // same as run_id
  logForgeAudit(opts: {
    level?: 'debug' | 'info' | 'warn' | 'error';
    scope?: string;
    event: string;
    message: string;
    data?: Record<string, unknown>;
  }): void;
}

export function createForgeRunOrchestrator(
  db: Db,
  mode: 'repo' | 'idea',
  seed: { text?: string; repo_full_name?: string },
  args: Record<string, unknown>,
  config: Record<string, unknown>,
  git_sha?: string | null
): ForgeRunOrchestrator {
  const coreOrchestrator = createCoreOrchestrator(db, args, config, git_sha);
  const run_id = coreOrchestrator.run_id;
  const forgeRunsDao = new ForgeRunsDao(db);
  const auditDao = new AuditDao(db);

  const now = new Date().toISOString();
  forgeRunsDao.create({
    run_id,
    mode,
    seed_text: seed.text,
    seed_repo_full_name: seed.repo_full_name,
    created_at: now,
  });

  logger.info({ run_id, mode, module: 'forge.run_context' }, 'Forge run created');

  auditDao.write({
    event: 'forge.run.created',
    message: `Forge run ${run_id} created in ${mode} mode`,
    run_id,
    data: { mode, seed, args },
  });

  return {
    ...coreOrchestrator,
    forge_run_id: run_id,

    logForgeAudit(opts): void {
      auditDao.write({ 
        ...opts, 
        run_id,
        event: `forge.${opts.event}`
      });
    },
  };
}
