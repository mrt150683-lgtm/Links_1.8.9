/**
 * Agent Repository
 *
 * CRUD for:
 *   - agent_configs    (opt-in per pot)
 *   - agent_schedules  (per-pot schedule)
 *   - agent_runs       (heartbeat/tool run executions)
 *   - agent_artifacts  (AI-generated reflection/report blobs)
 *
 * Migrations: 040_agent_core.sql, 041_agent_artifacts.sql
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type {
  AgentConfig,
  AgentSchedule,
  AgentRun,
  AgentArtifact,
  AgentRunsTable,
  AgentArtifactType,
  UpdateAgentConfigInput,
  CreateAgentRunInput,
  CreateAgentScheduleInput,
  CreateAgentArtifactInput,
} from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function toAgentConfig(row: any): AgentConfig {
  return {
    id: row.id,
    pot_id: row.pot_id,
    enabled: row.enabled === 1,
    mode: row.mode,
    goal_text: row.goal_text,
    cross_pot_enabled: row.cross_pot_enabled === 1,
    delivery_frequency: row.delivery_frequency,
    delivery_time_local: row.delivery_time_local,
    timezone: row.timezone,
    max_surprises_per_day: row.max_surprises_per_day,
    allow_tool_building: row.allow_tool_building === 1,
    allow_auto_test_low_risk_tools: row.allow_auto_test_low_risk_tools === 1,
    allow_auto_run_low_risk_tools: row.allow_auto_run_low_risk_tools === 1,
    quiet_hours: row.quiet_hours_json ? JSON.parse(row.quiet_hours_json) : null,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  };
}

function toAgentSchedule(row: any): AgentSchedule {
  return {
    id: row.id,
    pot_id: row.pot_id,
    enabled: row.enabled === 1,
    cron_like: row.cron_like,
    timezone: row.timezone,
    last_run_id: row.last_run_id,
    next_run_at: row.next_run_at,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  };
}

function toAgentRun(row: any): AgentRun {
  return {
    id: row.id,
    pot_id: row.pot_id,
    run_type: row.run_type,
    status: row.status,
    schedule_id: row.schedule_id,
    snapshot_id: row.snapshot_id,
    selected_candidate_id: row.selected_candidate_id,
    budget_usage: row.budget_usage_json ? JSON.parse(row.budget_usage_json) : null,
    progress: row.progress_json ? JSON.parse(row.progress_json) : null,
    model_id: row.model_id,
    prompt_ids: row.prompt_ids_json ? JSON.parse(row.prompt_ids_json) : null,
    role_hash: row.role_hash,
    created_at: row.created_at as number,
    started_at: row.started_at,
    finished_at: row.finished_at,
  };
}

function toAgentArtifact(row: any): AgentArtifact {
  return {
    id: row.id,
    pot_id: row.pot_id,
    run_id: row.run_id,
    tool_id: row.tool_id,
    artifact_type: row.artifact_type,
    model_id: row.model_id,
    prompt_id: row.prompt_id,
    prompt_version: row.prompt_version,
    role_hash: row.role_hash,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    created_at: row.created_at as number,
  };
}

// ── Agent Config ──────────────────────────────────────────────────────────

export async function getAgentConfig(potId: string): Promise<AgentConfig | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('agent_configs')
    .selectAll()
    .where('pot_id', '=', potId)
    .executeTakeFirst();
  return row ? toAgentConfig(row) : null;
}

export async function upsertAgentConfig(
  potId: string,
  input: UpdateAgentConfigInput,
): Promise<AgentConfig> {
  const db = getDatabase();
  const now = Date.now();
  const existing = await db
    .selectFrom('agent_configs')
    .select('id')
    .where('pot_id', '=', potId)
    .executeTakeFirst();

  if (existing) {
    await db
      .updateTable('agent_configs')
      .set({
        enabled: input.enabled !== undefined ? (input.enabled ? 1 : 0) : undefined,
        mode: input.mode,
        goal_text: input.goal_text,
        cross_pot_enabled:
          input.cross_pot_enabled !== undefined
            ? input.cross_pot_enabled
              ? 1
              : 0
            : undefined,
        delivery_frequency: input.delivery_frequency,
        delivery_time_local: input.delivery_time_local,
        timezone: input.timezone,
        max_surprises_per_day: input.max_surprises_per_day,
        allow_tool_building:
          input.allow_tool_building !== undefined
            ? input.allow_tool_building
              ? 1
              : 0
            : undefined,
        allow_auto_test_low_risk_tools:
          input.allow_auto_test_low_risk_tools !== undefined
            ? input.allow_auto_test_low_risk_tools
              ? 1
              : 0
            : undefined,
        allow_auto_run_low_risk_tools:
          input.allow_auto_run_low_risk_tools !== undefined
            ? input.allow_auto_run_low_risk_tools
              ? 1
              : 0
            : undefined,
        quiet_hours_json:
          input.quiet_hours !== undefined ? JSON.stringify(input.quiet_hours) : undefined,
        updated_at: now,
      })
      .where('pot_id', '=', potId)
      .execute();
  } else {
    const id = randomUUID();
    await db
      .insertInto('agent_configs')
      .values({
        id,
        pot_id: potId,
        enabled: input.enabled ? 1 : 0,
        mode: input.mode ?? 'balanced',
        goal_text: input.goal_text ?? null,
        cross_pot_enabled: input.cross_pot_enabled ? 1 : 0,
        delivery_frequency: input.delivery_frequency ?? 'daily',
        delivery_time_local: input.delivery_time_local ?? '08:00',
        timezone: input.timezone ?? 'UTC',
        max_surprises_per_day: input.max_surprises_per_day ?? 1,
        allow_tool_building: input.allow_tool_building ? 1 : 0,
        allow_auto_test_low_risk_tools: input.allow_auto_test_low_risk_tools ? 1 : 0,
        allow_auto_run_low_risk_tools: input.allow_auto_run_low_risk_tools ? 1 : 0,
        quiet_hours_json: input.quiet_hours ? JSON.stringify(input.quiet_hours) : 'null',
        created_at: now,
        updated_at: now,
      })
      .execute();
  }

  const updated = await db
    .selectFrom('agent_configs')
    .selectAll()
    .where('pot_id', '=', potId)
    .executeTakeFirstOrThrow();
  return toAgentConfig(updated);
}

export async function listAgentConfigs(): Promise<AgentConfig[]> {
  const db = getDatabase();
  const rows = await db.selectFrom('agent_configs').selectAll().execute();
  return rows.map(toAgentConfig);
}

export async function listEnabledAgentConfigs(): Promise<AgentConfig[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('agent_configs')
    .selectAll()
    .where('enabled', '=', 1)
    .execute();
  return rows.map(toAgentConfig);
}

// ── Agent Schedule ────────────────────────────────────────────────────────

export async function getAgentSchedule(potId: string): Promise<AgentSchedule | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('agent_schedules')
    .selectAll()
    .where('pot_id', '=', potId)
    .executeTakeFirst();
  return row ? toAgentSchedule(row) : null;
}

export async function upsertAgentSchedule(input: CreateAgentScheduleInput): Promise<AgentSchedule> {
  const db = getDatabase();
  const now = Date.now();
  const existing = await db
    .selectFrom('agent_schedules')
    .select('id')
    .where('pot_id', '=', input.pot_id)
    .executeTakeFirst();

  if (existing) {
    await db
      .updateTable('agent_schedules')
      .set({
        enabled: input.enabled !== undefined ? (input.enabled ? 1 : 0) : undefined,
        cron_like: input.cron_like,
        timezone: input.timezone,
        next_run_at: input.next_run_at,
        updated_at: now,
      })
      .where('pot_id', '=', input.pot_id)
      .execute();
  } else {
    const id = randomUUID();
    await db
      .insertInto('agent_schedules')
      .values({
        id,
        pot_id: input.pot_id,
        enabled: input.enabled ? 1 : 0,
        cron_like: input.cron_like ?? null,
        timezone: input.timezone ?? 'UTC',
        last_run_id: null,
        next_run_at: input.next_run_at ?? now,
        created_at: now,
        updated_at: now,
      })
      .execute();
  }

  const updated = await db
    .selectFrom('agent_schedules')
    .selectAll()
    .where('pot_id', '=', input.pot_id)
    .executeTakeFirstOrThrow();
  return toAgentSchedule(updated);
}

export async function getDueAgentSchedules(): Promise<AgentSchedule[]> {
  const db = getDatabase();
  const now = Date.now();
  const rows = await db
    .selectFrom('agent_schedules')
    .selectAll()
    .where('enabled', '=', 1)
    .where('next_run_at', '<=', now)
    .execute();
  return rows.map(toAgentSchedule);
}

export async function advanceAgentSchedule(
  potId: string,
  lastRunId: string,
  nextRunAt: number,
): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('agent_schedules')
    .set({
      last_run_id: lastRunId,
      next_run_at: nextRunAt,
      updated_at: Date.now(),
    })
    .where('pot_id', '=', potId)
    .execute();
}

// ── Agent Runs ────────────────────────────────────────────────────────────

export async function createAgentRun(input: CreateAgentRunInput): Promise<AgentRun> {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();
  await db
    .insertInto('agent_runs')
    .values({
      id,
      pot_id: input.pot_id,
      run_type: input.run_type,
      status: 'pending',
      schedule_id: input.schedule_id ?? null,
      snapshot_id: null,
      selected_candidate_id: null,
      budget_usage_json: '{}',
      progress_json: '{}',
      model_id: input.model_id ?? null,
      prompt_ids_json: '[]',
      role_hash: null,
      created_at: now,
      started_at: null,
      finished_at: null,
    })
    .execute();

  return getAgentRun(id) as Promise<AgentRun>;
}

export async function getAgentRun(id: string): Promise<AgentRun | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('agent_runs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? toAgentRun(row) : null;
}

export async function updateAgentRunStatus(
  id: string,
  status: AgentRunsTable['status'],
  fields?: {
    started_at?: number;
    finished_at?: number;
    snapshot_id?: string;
    selected_candidate_id?: string;
    model_id?: string;
    prompt_ids?: string[];
    role_hash?: string;
    budget_usage?: Record<string, unknown>;
    progress?: Record<string, unknown>;
  },
): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('agent_runs')
    .set({
      status,
      started_at: fields?.started_at,
      finished_at: fields?.finished_at,
      snapshot_id: fields?.snapshot_id,
      selected_candidate_id: fields?.selected_candidate_id,
      model_id: fields?.model_id,
      prompt_ids_json: fields?.prompt_ids ? JSON.stringify(fields.prompt_ids) : undefined,
      role_hash: fields?.role_hash,
      budget_usage_json: fields?.budget_usage ? JSON.stringify(fields.budget_usage) : undefined,
      progress_json: fields?.progress ? JSON.stringify(fields.progress) : undefined,
    })
    .where('id', '=', id)
    .execute();
}

export async function listAgentRuns(
  potId: string,
  opts?: { status?: string; run_type?: string; limit?: number; offset?: number },
): Promise<{ runs: AgentRun[]; total: number }> {
  const db = getDatabase();
  let query = db.selectFrom('agent_runs').selectAll().where('pot_id', '=', potId);
  let countQuery = db
    .selectFrom('agent_runs')
    .select(db.fn.countAll().as('count'))
    .where('pot_id', '=', potId);

  if (opts?.status) {
    query = query.where('status', '=', opts.status as AgentRunsTable['status']);
    countQuery = countQuery.where('status', '=', opts.status as AgentRunsTable['status']);
  }
  if (opts?.run_type) {
    query = query.where('run_type', '=', opts.run_type as AgentRunsTable['run_type']);
    countQuery = countQuery.where('run_type', '=', opts.run_type as AgentRunsTable['run_type']);
  }

  const [rows, countRow] = await Promise.all([
    query
      .orderBy('created_at', 'desc')
      .limit(opts?.limit ?? 20)
      .offset(opts?.offset ?? 0)
      .execute(),
    countQuery.executeTakeFirst(),
  ]);

  return {
    runs: rows.map(toAgentRun),
    total: Number(countRow?.count ?? 0),
  };
}

export async function hasActiveAgentRun(potId: string): Promise<boolean> {
  const db = getDatabase();
  const row = await db
    .selectFrom('agent_runs')
    .select('id')
    .where('pot_id', '=', potId)
    .where('status', 'in', ['pending', 'running', 'paused'])
    .executeTakeFirst();
  return !!row;
}

export async function hasRecentToolBuild(potId: string, windowMs: number): Promise<boolean> {
  const db = getDatabase();
  const cutoff = Date.now() - windowMs;
  const row = await db
    .selectFrom('agent_runs')
    .select('id')
    .where('pot_id', '=', potId)
    .where('run_type', '=', 'tool_build')
    .where('created_at', '>=', cutoff)
    .executeTakeFirst();
  return !!row;
}

// ── Agent Artifacts ───────────────────────────────────────────────────────

export async function createAgentArtifact(input: CreateAgentArtifactInput): Promise<AgentArtifact> {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();
  await db
    .insertInto('agent_artifacts')
    .values({
      id,
      pot_id: input.pot_id,
      run_id: input.run_id ?? null,
      tool_id: input.tool_id ?? null,
      artifact_type: input.artifact_type,
      model_id: input.model_id ?? null,
      prompt_id: input.prompt_id ?? null,
      prompt_version: input.prompt_version ?? null,
      role_hash: input.role_hash ?? null,
      payload_json: input.payload ? JSON.stringify(input.payload) : '{}',
      created_at: now,
    })
    .execute();

  const row = await db
    .selectFrom('agent_artifacts')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return toAgentArtifact(row);
}

export async function getAgentArtifacts(runId: string, type?: string): Promise<AgentArtifact[]> {
  const db = getDatabase();
  let query = db.selectFrom('agent_artifacts').selectAll().where('run_id', '=', runId);
  if (type) {
    query = query.where('artifact_type', '=', type as AgentArtifactType);
  }
  const rows = await query.orderBy('created_at', 'asc').execute();
  return rows.map(toAgentArtifact);
}

export async function listAgentArtifactsByPotAndType(
  potId: string,
  type: AgentArtifactType,
  limit = 20,
): Promise<AgentArtifact[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('agent_artifacts')
    .selectAll()
    .where('pot_id', '=', potId)
    .where('artifact_type', '=', type)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map(toAgentArtifact);
}

export async function getAgentArtifactsByToolId(
  toolId: string,
  type?: string,
  limit = 5,
): Promise<AgentArtifact[]> {
  const db = getDatabase();
  let query = db.selectFrom('agent_artifacts').selectAll().where('tool_id', '=', toolId);
  if (type) {
    query = query.where('artifact_type', '=', type as AgentArtifactType);
  }
  const rows = await query.orderBy('created_at', 'desc').limit(limit).execute();
  return rows.map(toAgentArtifact);
}
