/**
 * Agent Tools Repository
 *
 * CRUD for:
 *   - agent_tools         (user-approved executable tools)
 *   - agent_tool_versions (version lineage)
 *   - agent_tool_runs     (tool execution records)
 *
 * Migration: 043_agent_tools.sql
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type {
  AgentTool,
  AgentToolVersion,
  AgentToolRun,
  AgentToolStatus,
  AgentToolsTable,
  AgentToolRunsTable,
  CreateAgentToolInput,
  CreateAgentToolRunInput,
} from '../types.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function toAgentTool(row: any): AgentTool {
  return {
    id: row.id,
    pot_id: row.pot_id,
    tool_key: row.tool_key,
    name: row.name,
    description: row.description,
    language: row.language,
    status: row.status,
    version: row.version,
    parent_tool_id: row.parent_tool_id,
    bundle_hash: row.bundle_hash,
    encrypted_bundle_path: row.encrypted_bundle_path,
    manifest: row.manifest_json ? JSON.parse(row.manifest_json) : null,
    input_schema: row.input_schema_json ? JSON.parse(row.input_schema_json) : null,
    output_schema: row.output_schema_json ? JSON.parse(row.output_schema_json) : null,
    capabilities_required: row.capabilities_required_json
      ? JSON.parse(row.capabilities_required_json)
      : [],
    sandbox_policy: row.sandbox_policy_json ? JSON.parse(row.sandbox_policy_json) : null,
    network_policy: row.network_policy,
    cross_pot_allowed: row.cross_pot_allowed === 1,
    approval_required: row.approval_required === 1,
    created_by_run_id: row.created_by_run_id,
    created_by_model_id: row.created_by_model_id,
    prompt_ids: row.prompt_ids_json ? JSON.parse(row.prompt_ids_json) : null,
    role_hash: row.role_hash,
    source_refs: row.source_refs_json ? JSON.parse(row.source_refs_json) : [],
    test_summary: row.test_summary_json ? JSON.parse(row.test_summary_json) : null,
    last_run_at: row.last_run_at,
    last_success_at: row.last_success_at,
    usage_count: row.usage_count,
    average_rating: row.average_rating,
    created_at: row.created_at as number,
    updated_at: row.updated_at as number,
  };
}

function toAgentToolVersion(row: any): AgentToolVersion {
  return {
    id: row.id,
    tool_id: row.tool_id,
    version: row.version,
    bundle_hash: row.bundle_hash,
    encrypted_bundle_path: row.encrypted_bundle_path,
    manifest: row.manifest_json ? JSON.parse(row.manifest_json) : null,
    build_report_artifact_id: row.build_report_artifact_id,
    created_at: row.created_at as number,
  };
}

function toAgentToolRun(row: any): AgentToolRun {
  return {
    id: row.id,
    pot_id: row.pot_id,
    tool_id: row.tool_id,
    tool_version: row.tool_version,
    agent_run_id: row.agent_run_id,
    snapshot_id: row.snapshot_id,
    trigger_type: row.trigger_type,
    status: row.status,
    input_payload: row.input_payload_json ? JSON.parse(row.input_payload_json) : null,
    output_artifact_id: row.output_artifact_id,
    logs_artifact_id: row.logs_artifact_id,
    budget_usage: row.budget_usage_json ? JSON.parse(row.budget_usage_json) : null,
    started_at: row.started_at,
    finished_at: row.finished_at,
  };
}

// ── Agent Tools ───────────────────────────────────────────────────────────

export async function createAgentTool(input: CreateAgentToolInput): Promise<AgentTool> {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();
  const toolKey = input.tool_key ?? `tool_${id.slice(0, 8)}`;

  await db
    .insertInto('agent_tools')
    .values({
      id,
      pot_id: input.pot_id,
      tool_key: toolKey,
      name: input.name,
      description: input.description ?? null,
      language: input.language,
      status: 'draft',
      version: 1,
      parent_tool_id: input.parent_tool_id ?? null,
      bundle_hash: input.bundle_hash ?? null,
      encrypted_bundle_path: input.encrypted_bundle_path ?? null,
      manifest_json: input.manifest ? JSON.stringify(input.manifest) : '{}',
      input_schema_json: input.input_schema ? JSON.stringify(input.input_schema) : '{}',
      output_schema_json: input.output_schema ? JSON.stringify(input.output_schema) : '{}',
      capabilities_required_json: input.capabilities_required
        ? JSON.stringify(input.capabilities_required)
        : '[]',
      sandbox_policy_json: input.sandbox_policy ? JSON.stringify(input.sandbox_policy) : '{}',
      network_policy: input.network_policy ?? 'none',
      cross_pot_allowed: input.cross_pot_allowed ? 1 : 0,
      approval_required: 1,
      created_by_run_id: input.created_by_run_id ?? null,
      created_by_model_id: input.created_by_model_id ?? null,
      prompt_ids_json: input.prompt_ids ? JSON.stringify(input.prompt_ids) : '[]',
      role_hash: input.role_hash ?? null,
      source_refs_json: input.source_refs ? JSON.stringify(input.source_refs) : '[]',
      test_summary_json: 'null',
      last_run_at: null,
      last_success_at: null,
      usage_count: 0,
      average_rating: 0.0,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return getAgentTool(id) as Promise<AgentTool>;
}

export async function getAgentTool(id: string): Promise<AgentTool | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('agent_tools')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? toAgentTool(row) : null;
}

export async function updateAgentToolStatus(
  id: string,
  status: AgentToolStatus,
  fields?: {
    bundle_hash?: string;
    encrypted_bundle_path?: string;
    test_summary?: Record<string, unknown>;
    last_run_at?: number;
    last_success_at?: number;
  },
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();
  await db
    .updateTable('agent_tools')
    .set({
      status,
      bundle_hash: fields?.bundle_hash,
      encrypted_bundle_path: fields?.encrypted_bundle_path,
      test_summary_json: fields?.test_summary ? JSON.stringify(fields.test_summary) : undefined,
      last_run_at: fields?.last_run_at,
      last_success_at: fields?.last_success_at,
      updated_at: now,
    })
    .where('id', '=', id)
    .execute();
}

export async function incrementAgentToolUsage(id: string, success: boolean): Promise<void> {
  const db = getDatabase();
  const now = Date.now();
  const tool = await db
    .selectFrom('agent_tools')
    .select(['usage_count', 'average_rating'])
    .where('id', '=', id)
    .executeTakeFirst();

  if (!tool) return;

  await db
    .updateTable('agent_tools')
    .set({
      usage_count: (tool.usage_count as number) + 1,
      last_run_at: now,
      last_success_at: success ? now : undefined,
      updated_at: now,
    })
    .where('id', '=', id)
    .execute();
}

export async function listAgentTools(
  potId: string,
  opts?: { status?: string; limit?: number; offset?: number },
): Promise<{ tools: AgentTool[]; total: number }> {
  const db = getDatabase();
  let query = db.selectFrom('agent_tools').selectAll().where('pot_id', '=', potId);
  let countQuery = db
    .selectFrom('agent_tools')
    .select(db.fn.countAll().as('count'))
    .where('pot_id', '=', potId);

  if (opts?.status) {
    query = query.where('status', '=', opts.status as AgentToolsTable['status']);
    countQuery = countQuery.where('status', '=', opts.status as AgentToolsTable['status']);
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
    tools: rows.map(toAgentTool),
    total: Number(countRow?.count ?? 0),
  };
}

// ── Agent Tool Versions ───────────────────────────────────────────────────

export async function createToolVersion(
  toolId: string,
  buildReportArtifactId?: string,
): Promise<AgentToolVersion> {
  const db = getDatabase();
  const tool = await db
    .selectFrom('agent_tools')
    .select(['version', 'bundle_hash', 'encrypted_bundle_path', 'manifest_json'])
    .where('id', '=', toolId)
    .executeTakeFirstOrThrow();

  const id = randomUUID();
  const now = Date.now();
  await db
    .insertInto('agent_tool_versions')
    .values({
      id,
      tool_id: toolId,
      version: tool.version as number,
      bundle_hash: tool.bundle_hash as string | null,
      encrypted_bundle_path: tool.encrypted_bundle_path as string | null,
      manifest_json: (tool.manifest_json as string | null) ?? '{}',
      build_report_artifact_id: buildReportArtifactId ?? null,
      created_at: now,
    })
    .execute();

  const row = await db
    .selectFrom('agent_tool_versions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return toAgentToolVersion(row);
}

export async function listToolVersions(toolId: string): Promise<AgentToolVersion[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('agent_tool_versions')
    .selectAll()
    .where('tool_id', '=', toolId)
    .orderBy('version', 'desc')
    .execute();
  return rows.map(toAgentToolVersion);
}

export async function rollbackAgentTool(
  toolId: string,
  versionId: string,
): Promise<AgentToolVersion> {
  const db = getDatabase();
  const now = Date.now();

  // Load the target version
  const versionRow = await db
    .selectFrom('agent_tool_versions')
    .selectAll()
    .where('id', '=', versionId)
    .where('tool_id', '=', toolId)
    .executeTakeFirst();
  if (!versionRow) throw new Error(`Version ${versionId} not found for tool ${toolId}`);

  const version = toAgentToolVersion(versionRow);

  // Snapshot current state before overwriting
  await createToolVersion(toolId);

  // Overwrite tool with version data
  await db
    .updateTable('agent_tools')
    .set({
      bundle_hash: version.bundle_hash ?? null,
      encrypted_bundle_path: version.encrypted_bundle_path ?? null,
      manifest_json: version.manifest ? JSON.stringify(version.manifest) : '{}',
      version: version.version,
      updated_at: now,
    })
    .where('id', '=', toolId)
    .execute();

  return version;
}

export async function listCrossPotTools(
  potIds: string[],
): Promise<AgentTool[]> {
  if (potIds.length === 0) return [];
  const db = getDatabase();
  const rows = await db
    .selectFrom('agent_tools')
    .selectAll()
    .where('cross_pot_allowed', '=', 1)
    .where('pot_id', 'in', potIds)
    .where('status', '=', 'active')
    .orderBy('created_at', 'desc')
    .execute();
  return rows.map(toAgentTool);
}

// ── Agent Tool Runs ───────────────────────────────────────────────────────

export async function createAgentToolRun(input: CreateAgentToolRunInput): Promise<AgentToolRun> {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();

  const tool = await db
    .selectFrom('agent_tools')
    .select('version')
    .where('id', '=', input.tool_id)
    .executeTakeFirst();

  await db
    .insertInto('agent_tool_runs')
    .values({
      id,
      pot_id: input.pot_id,
      tool_id: input.tool_id,
      tool_version: (tool?.version as number | null) ?? 1,
      agent_run_id: input.agent_run_id ?? null,
      snapshot_id: input.snapshot_id ?? null,
      trigger_type: (input.trigger_type ?? 'manual') as AgentToolRunsTable['trigger_type'],
      status: 'pending',
      input_payload_json: input.input_payload ? JSON.stringify(input.input_payload) : '{}',
      output_artifact_id: null,
      logs_artifact_id: null,
      budget_usage_json: '{}',
      started_at: now,
      finished_at: null,
    })
    .execute();

  const row = await db
    .selectFrom('agent_tool_runs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  return toAgentToolRun(row);
}

export async function getAgentToolRun(id: string): Promise<AgentToolRun | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('agent_tool_runs')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return row ? toAgentToolRun(row) : null;
}

export async function updateAgentToolRunStatus(
  id: string,
  status: AgentToolRunsTable['status'],
  fields?: {
    output_artifact_id?: string;
    logs_artifact_id?: string;
    budget_usage?: Record<string, unknown>;
    finished_at?: number;
  },
): Promise<void> {
  const db = getDatabase();
  await db
    .updateTable('agent_tool_runs')
    .set({
      status,
      output_artifact_id: fields?.output_artifact_id,
      logs_artifact_id: fields?.logs_artifact_id,
      budget_usage_json: fields?.budget_usage ? JSON.stringify(fields.budget_usage) : undefined,
      finished_at: fields?.finished_at ?? Date.now(),
    })
    .where('id', '=', id)
    .execute();
}

export async function listAgentToolRuns(
  toolId: string,
  opts?: { limit?: number; offset?: number },
): Promise<AgentToolRun[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('agent_tool_runs')
    .selectAll()
    .where('tool_id', '=', toolId)
    .orderBy('started_at', 'desc')
    .limit(opts?.limit ?? 20)
    .offset(opts?.offset ?? 0)
    .execute();
  return rows.map(toAgentToolRun);
}
