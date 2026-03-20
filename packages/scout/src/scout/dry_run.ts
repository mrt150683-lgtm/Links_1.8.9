import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import type { Db } from '../db/index.js';
import { createRunOrchestrator, STEP_NAMES } from './run_context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'github');

export interface DryRunOptions {
  query: string;
}

export interface DryRunResult {
  run_id: string;
  steps: string[];
  repos_found: number;
}

export function runDry(db: Db, opts: DryRunOptions): DryRunResult {
  const orchestrator = createRunOrchestrator(
    db,
    { query: opts.query, dry: true },
    {},
    null
  );

  const steps_completed: string[] = [];

  // Step: init_run
  const initStep = orchestrator.startStep(STEP_NAMES.INIT_RUN);
  orchestrator.logAudit({
    event: 'run.dry_mode',
    message: 'Running in dry mode (fixture data, no network)',
    data: { query: opts.query },
  });
  initStep.finish('success', { mode: 'dry' });
  steps_completed.push(STEP_NAMES.INIT_RUN);

  // Step: github_search (dry)
  const searchStep = orchestrator.startStep(STEP_NAMES.GITHUB_SEARCH_PASS1);
  const fixtureFile = path.join(FIXTURES_DIR, 'search_repos_page1.json');
  let repos_found = 0;

  if (fs.existsSync(fixtureFile)) {
    const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf-8')) as {
      items: unknown[];
      total_count: number;
    };
    repos_found = fixture.items.length;
    orchestrator.logAudit({
      event: 'github.search.dry',
      message: `Dry search returned ${repos_found} fixture repos`,
      data: { query: opts.query, count: repos_found, source: 'fixture' },
    });
  } else {
    orchestrator.logAudit({
      event: 'github.search.dry',
      message: 'No fixture found, simulating empty results',
      data: { query: opts.query, count: 0 },
    });
  }

  searchStep.finish('success', { repos_found });
  steps_completed.push(STEP_NAMES.GITHUB_SEARCH_PASS1);

  // Step: hydrate_readme (dry)
  const hydrateStep = orchestrator.startStep(STEP_NAMES.HYDRATE_README);
  orchestrator.logAudit({
    event: 'hydrate.dry',
    message: 'Skipping real README hydration in dry mode',
    data: { repos: repos_found },
  });
  hydrateStep.finish('success', { skipped: true, mode: 'dry' });
  steps_completed.push(STEP_NAMES.HYDRATE_README);

  return {
    run_id: orchestrator.run_id,
    steps: steps_completed,
    repos_found,
  };
}
