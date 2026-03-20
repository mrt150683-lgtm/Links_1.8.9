import { createHash, randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type {
  PlanningAnswer,
  PlanningFile,
  PlanningFileProvenance,
  PlanningRun,
  PlanningRunStatus,
} from '../types.js';

export interface CreatePlanningRunInput {
  pot_id: string;
  project_name: string;
  project_type: string;
  model_profile?: Record<string, unknown>;
}

function toRun(row: any): PlanningRun {
  return {
    ...row,
    model_profile: row.model_profile_json ? JSON.parse(row.model_profile_json) : null,
  };
}

function toFile(row: any): PlanningFile {
  return { ...row };
}

function toAnswer(row: any): PlanningAnswer {
  return {
    ...row,
    answers: JSON.parse(row.answers_json),
  };
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function createRun(input: CreatePlanningRunInput): Promise<PlanningRun> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('planning_runs')
    .values({
      id,
      pot_id: input.pot_id,
      project_name: input.project_name,
      project_type: input.project_type,
      status: 'draft',
      revision: 1,
      approved_at: null,
      rejected_reason: null,
      model_profile_json: input.model_profile ? JSON.stringify(input.model_profile) : null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  const created = await db.selectFrom('planning_runs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  return toRun(created);
}

export async function listRunsByPot(potId: string, limit = 50): Promise<PlanningRun[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('planning_runs')
    .selectAll()
    .where('pot_id', '=', potId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map(toRun);
}

export async function getRun(runId: string): Promise<PlanningRun | null> {
  const db = getDatabase();
  const row = await db.selectFrom('planning_runs').selectAll().where('id', '=', runId).executeTakeFirst();
  return row ? toRun(row) : null;
}

export async function saveQuestions(runId: string, revision: number, questionsJson: unknown): Promise<PlanningFile> {
  const content = JSON.stringify(questionsJson, null, 2);
  const file = await saveFile(runId, revision, 'questions.json', 'questions_json', content, hashContent(content));
  await updateRunStatus(runId, 'questions_generated');
  return file;
}

export async function saveAnswers(runId: string, revision: number, answersJson: unknown): Promise<PlanningAnswer> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db.insertInto('planning_answers').values({
    id,
    run_id: runId,
    revision,
    answers_json: JSON.stringify(answersJson),
    created_at: now,
  }).execute();

  await db.updateTable('planning_runs').set({ status: 'answers_recorded', updated_at: now }).where('id', '=', runId).execute();

  const row = await db.selectFrom('planning_answers').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  return toAnswer(row);
}

export async function getLatestAnswers(runId: string, revision?: number): Promise<PlanningAnswer | null> {
  const db = getDatabase();
  let q = db.selectFrom('planning_answers').selectAll().where('run_id', '=', runId).orderBy('created_at', 'desc').limit(1);
  if (typeof revision === 'number') {
    q = q.where('revision', '=', revision);
  }
  const row = await q.executeTakeFirst();
  return row ? toAnswer(row) : null;
}

export async function saveFile(
  runId: string,
  revision: number,
  path: string,
  kind: string,
  content: string,
  sha256?: string,
  provenance: PlanningFileProvenance = {}
): Promise<PlanningFile> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db
    .insertInto('planning_files')
    .values({
      id,
      run_id: runId,
      revision,
      path,
      kind,
      content_text: content,
      asset_id: null,
      sha256: sha256 ?? hashContent(content),
      model_id: provenance.model_id ?? null,
      prompt_id: provenance.prompt_id ?? null,
      prompt_version: provenance.prompt_version ?? null,
      temperature: provenance.temperature ?? null,
      max_tokens: provenance.max_tokens ?? null,
      created_at: now,
    })
    .onConflict((oc) =>
      oc.columns(['run_id', 'revision', 'path']).doUpdateSet({
        kind,
        content_text: content,
        sha256: sha256 ?? hashContent(content),
        model_id: provenance.model_id ?? null,
        prompt_id: provenance.prompt_id ?? null,
        prompt_version: provenance.prompt_version ?? null,
        temperature: provenance.temperature ?? null,
        max_tokens: provenance.max_tokens ?? null,
      })
    )
    .execute();

  const row = await db
    .selectFrom('planning_files')
    .selectAll()
    .where('run_id', '=', runId)
    .where('revision', '=', revision)
    .where('path', '=', path)
    .executeTakeFirstOrThrow();

  return toFile(row);
}

export async function listFiles(runId: string, revision?: number): Promise<PlanningFile[]> {
  const db = getDatabase();
  let q = db.selectFrom('planning_files').selectAll().where('run_id', '=', runId);
  if (typeof revision === 'number') {
    q = q.where('revision', '=', revision);
  }
  const rows = await q.orderBy('path', 'asc').execute();
  return rows.map(toFile);
}

export async function getFile(runId: string, revision: number, path: string): Promise<PlanningFile | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('planning_files')
    .selectAll()
    .where('run_id', '=', runId)
    .where('revision', '=', revision)
    .where('path', '=', path)
    .executeTakeFirst();
  return row ? toFile(row) : null;
}

export async function updateRunStatus(runId: string, status: PlanningRunStatus): Promise<void> {
  const db = getDatabase();
  await db.updateTable('planning_runs').set({ status, updated_at: Date.now() }).where('id', '=', runId).execute();
}

export async function approveRun(runId: string): Promise<void> {
  const db = getDatabase();
  const now = Date.now();
  await db
    .updateTable('planning_runs')
    .set({ status: 'approved', approved_at: now, rejected_reason: null, updated_at: now })
    .where('id', '=', runId)
    .execute();
}

export async function rejectRun(runId: string, feedback: string): Promise<void> {
  const db = getDatabase();
  const now = Date.now();
  await db
    .updateTable('planning_runs')
    .set({ status: 'rejected', rejected_reason: feedback, approved_at: null, updated_at: now })
    .where('id', '=', runId)
    .execute();
}
