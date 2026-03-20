import { randomUUID } from 'crypto';
import type { Db } from '../db/index.js';
import { RunsDao } from '../db/dao/runs.js';
import { StepsDao, type StepStatus } from '../db/dao/steps.js';
import { AuditDao } from '../db/dao/audit.js';
import { logger } from '../logging/logger.js';

export const STEP_NAMES = {
  INIT_RUN: 'init_run',
  GITHUB_RATE_LIMIT_SNAPSHOT: 'github_rate_limit_snapshot',
  GITHUB_SEARCH_PASS1: 'github_search_pass1',
  HYDRATE_REPO_METADATA: 'hydrate_repo_metadata',
  HYDRATE_README: 'hydrate_readme',
  LLM_REPO_ANALYSIS: 'llm_repo_analysis',
  KEYWORD_AGGREGATE: 'keyword_aggregate',
  GITHUB_SEARCH_PASS2: 'github_search_pass2',
  LLM_BRIEF_GENERATE: 'llm_brief_generate',
  EXPORT_MARKDOWN: 'export_markdown',
} as const;

export type StepName = (typeof STEP_NAMES)[keyof typeof STEP_NAMES];

export interface RunOrchestrator {
  run_id: string;
  startStep(name: string): StepHandle;
  logAudit(opts: {
    level?: 'debug' | 'info' | 'warn' | 'error';
    scope?: string;
    event: string;
    message: string;
    data?: Record<string, unknown>;
  }): void;
}

export interface StepHandle {
  step_id: string;
  name: string;
  started_at: string;
  finish(status: StepStatus, stats?: Record<string, unknown>): void;
}

export function createRunOrchestrator(
  db: Db,
  args: Record<string, unknown>,
  config: Record<string, unknown>,
  git_sha?: string | null
): RunOrchestrator {
  const run_id = randomUUID();
  const runsDao = new RunsDao(db);
  const stepsDao = new StepsDao(db);
  const auditDao = new AuditDao(db);

  runsDao.create({ run_id, args, git_sha: git_sha ?? null, config });

  logger.info({ run_id, module: 'scout.run_context' }, 'Run created');

  auditDao.write({
    event: 'run.created',
    message: `Run ${run_id} created`,
    run_id,
    data: { args },
  });

  return {
    run_id,

    startStep(name: string): StepHandle {
      const step_id = randomUUID();
      const step = stepsDao.start({ step_id, run_id, name });

      logger.info({ run_id, step: name, module: 'scout.run_context' }, `Step started: ${name}`);

      auditDao.write({
        event: 'step.started',
        message: `Step ${name} started`,
        run_id,
        scope: name,
        data: { step_id },
      });

      return {
        step_id,
        name,
        started_at: step.started_at,
        finish(status: StepStatus, stats?: Record<string, unknown>): void {
          stepsDao.finish({ step_id, status, stats, started_at: step.started_at });

          const finished_at = new Date().toISOString();
          const duration_ms =
            new Date(finished_at).getTime() - new Date(step.started_at).getTime();

          const logCtx = { run_id, step: name, module: 'scout.run_context', duration_ms };
          if (status === 'success') {
            logger.info(logCtx, `Step finished: ${name}`);
          } else if (status === 'failed') {
            logger.error(logCtx, `Step failed: ${name}`);
          } else {
            logger.info(logCtx, `Step skipped: ${name}`);
          }

          auditDao.write({
            level: status === 'failed' ? 'error' : 'info',
            event: status === 'failed' ? 'step.failed' : 'step.finished',
            message: `Step ${name} ${status}`,
            run_id,
            scope: name,
            data: { step_id, status, duration_ms, ...stats },
          });
        },
      };
    },

    logAudit(opts): void {
      auditDao.write({ ...opts, run_id });
    },
  };
}
