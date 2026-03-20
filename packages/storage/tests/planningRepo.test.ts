import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'node:fs';
import { initDatabase, closeDatabase } from '../src/db.js';
import { runMigrations } from '../src/migrations.js';
import { createPot } from '../src/repos/potsRepo.js';
import { createRun, saveFile, listFiles } from '../src/repos/planningRepo.js';

const TEST_DB_PATH = './test-planning-repo.db';

describe('planning repo', () => {
  beforeEach(async () => {
    initDatabase({ filename: TEST_DB_PATH });
    runMigrations();
  });

  afterEach(async () => {
    closeDatabase();
    try {
      unlinkSync(TEST_DB_PATH);
      unlinkSync(TEST_DB_PATH + '-wal');
      unlinkSync(TEST_DB_PATH + '-shm');
    } catch {
      // ignore
    }
  });

  it('upserts planning file idempotently by run/revision/path', async () => {
    const pot = await createPot({ name: 'planning-pot' });
    const run = await createRun({ pot_id: pot.id, project_name: 'Proj', project_type: 'software' });

    await saveFile(run.id, 1, 'plan.md', 'plan_md', '# v1');
    await saveFile(run.id, 1, 'plan.md', 'plan_md', '# v2');

    const files = await listFiles(run.id, 1);
    expect(files.filter((f) => f.path === 'plan.md')).toHaveLength(1);
    expect(files.find((f) => f.path === 'plan.md')?.content_text).toBe('# v2');
  });
});
