/**
 * automationRepo
 *
 * CRUD for pot_automation_settings.
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';

// ── Local PotAutomationSettings type (mirrors @links/core automation-schemas) ─
interface PotAutomationSettings {
  id: string;
  pot_id: string;
  enabled: boolean;
  heartbeat_enabled: boolean;
  agent_task_management_enabled: boolean;
  agent_can_create_tasks: boolean;
  agent_can_update_tasks: boolean;
  agent_can_complete_tasks: boolean;
  agent_can_render_heartbeat_md: boolean;
  default_model: string | null;
  timezone: string;
  quiet_hours: { from: string; to: string } | null;
  run_windows: Array<{ from: string; to: string; days?: number[] }> | null;
  token_budget: { max_input_tokens?: number; max_output_tokens?: number; max_cost_usd_per_run?: number } | null;
  max_tasks_created_per_day: number;
  max_heartbeat_runs_per_day: number;
  proactive_conversations_enabled: boolean;
  proactive_conversation_model: string | null;
  created_at: number;
  updated_at: number;
}

export type { PotAutomationSettings };

function rowToSettings(row: any): PotAutomationSettings {
  return {
    id: row.id,
    pot_id: row.pot_id,
    enabled: row.enabled === 1,
    heartbeat_enabled: row.heartbeat_enabled === 1,
    agent_task_management_enabled: row.agent_task_management_enabled === 1,
    agent_can_create_tasks: row.agent_can_create_tasks === 1,
    agent_can_update_tasks: row.agent_can_update_tasks === 1,
    agent_can_complete_tasks: row.agent_can_complete_tasks === 1,
    agent_can_render_heartbeat_md: row.agent_can_render_heartbeat_md === 1,
    default_model: row.default_model ?? null,
    timezone: row.timezone,
    quiet_hours: row.quiet_hours_json && row.quiet_hours_json !== 'null'
      ? JSON.parse(row.quiet_hours_json)
      : null,
    run_windows: row.run_windows_json && row.run_windows_json !== 'null'
      ? JSON.parse(row.run_windows_json)
      : null,
    token_budget: row.token_budget_json && row.token_budget_json !== 'null'
      ? JSON.parse(row.token_budget_json)
      : null,
    max_tasks_created_per_day: row.max_tasks_created_per_day,
    max_heartbeat_runs_per_day: row.max_heartbeat_runs_per_day,
    proactive_conversations_enabled: row.proactive_conversations_enabled === 1,
    proactive_conversation_model: row.proactive_conversation_model ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getAutomationSettings(potId: string): Promise<PotAutomationSettings | null> {
  const db = getDatabase();
  const row = await db
    .selectFrom('pot_automation_settings')
    .selectAll()
    .where('pot_id', '=', potId)
    .executeTakeFirst();
  return row ? rowToSettings(row) : null;
}

export async function upsertAutomationSettings(
  potId: string,
  patch: Partial<Omit<PotAutomationSettings, 'id' | 'pot_id' | 'created_at' | 'updated_at'>>,
): Promise<PotAutomationSettings> {
  const db = getDatabase();
  const now = Date.now();

  const existing = await getAutomationSettings(potId);

  if (!existing) {
    const id = randomUUID();
    await db
      .insertInto('pot_automation_settings')
      .values({
        id,
        pot_id: potId,
        enabled: patch.enabled ? 1 : 0,
        heartbeat_enabled: patch.heartbeat_enabled ? 1 : 0,
        agent_task_management_enabled: patch.agent_task_management_enabled ? 1 : 0,
        agent_can_create_tasks: patch.agent_can_create_tasks ? 1 : 0,
        agent_can_update_tasks: patch.agent_can_update_tasks ? 1 : 0,
        agent_can_complete_tasks: patch.agent_can_complete_tasks ? 1 : 0,
        agent_can_render_heartbeat_md: patch.agent_can_render_heartbeat_md !== false ? 1 : 0,
        default_model: patch.default_model ?? null,
        timezone: patch.timezone ?? 'UTC',
        quiet_hours_json: patch.quiet_hours !== undefined ? JSON.stringify(patch.quiet_hours) : 'null',
        run_windows_json: patch.run_windows !== undefined ? JSON.stringify(patch.run_windows) : 'null',
        token_budget_json: patch.token_budget !== undefined ? JSON.stringify(patch.token_budget) : 'null',
        max_tasks_created_per_day: patch.max_tasks_created_per_day ?? 5,
        max_heartbeat_runs_per_day: patch.max_heartbeat_runs_per_day ?? 4,
        proactive_conversations_enabled: patch.proactive_conversations_enabled ? 1 : 0,
        proactive_conversation_model: patch.proactive_conversation_model ?? null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    return (await getAutomationSettings(potId))!;
  }

  const updates: Record<string, unknown> = { updated_at: now };

  if (patch.enabled !== undefined) updates.enabled = patch.enabled ? 1 : 0;
  if (patch.heartbeat_enabled !== undefined) updates.heartbeat_enabled = patch.heartbeat_enabled ? 1 : 0;
  if (patch.agent_task_management_enabled !== undefined)
    updates.agent_task_management_enabled = patch.agent_task_management_enabled ? 1 : 0;
  if (patch.agent_can_create_tasks !== undefined)
    updates.agent_can_create_tasks = patch.agent_can_create_tasks ? 1 : 0;
  if (patch.agent_can_update_tasks !== undefined)
    updates.agent_can_update_tasks = patch.agent_can_update_tasks ? 1 : 0;
  if (patch.agent_can_complete_tasks !== undefined)
    updates.agent_can_complete_tasks = patch.agent_can_complete_tasks ? 1 : 0;
  if (patch.agent_can_render_heartbeat_md !== undefined)
    updates.agent_can_render_heartbeat_md = patch.agent_can_render_heartbeat_md ? 1 : 0;
  if (patch.default_model !== undefined) updates.default_model = patch.default_model;
  if (patch.timezone !== undefined) updates.timezone = patch.timezone;
  if (patch.quiet_hours !== undefined) updates.quiet_hours_json = JSON.stringify(patch.quiet_hours);
  if (patch.run_windows !== undefined) updates.run_windows_json = JSON.stringify(patch.run_windows);
  if (patch.token_budget !== undefined) updates.token_budget_json = JSON.stringify(patch.token_budget);
  if (patch.max_tasks_created_per_day !== undefined)
    updates.max_tasks_created_per_day = patch.max_tasks_created_per_day;
  if (patch.max_heartbeat_runs_per_day !== undefined)
    updates.max_heartbeat_runs_per_day = patch.max_heartbeat_runs_per_day;
  if (patch.proactive_conversations_enabled !== undefined)
    updates.proactive_conversations_enabled = patch.proactive_conversations_enabled ? 1 : 0;
  if (patch.proactive_conversation_model !== undefined)
    updates.proactive_conversation_model = patch.proactive_conversation_model;

  await db
    .updateTable('pot_automation_settings')
    .set(updates)
    .where('pot_id', '=', potId)
    .execute();

  return (await getAutomationSettings(potId))!;
}

export async function listEnabledAutomationPots(): Promise<PotAutomationSettings[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('pot_automation_settings')
    .selectAll()
    .where('enabled', '=', 1)
    .execute();
  return rows.map(rowToSettings);
}

export async function listEnabledHeartbeatPots(): Promise<PotAutomationSettings[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('pot_automation_settings')
    .selectAll()
    .where('enabled', '=', 1)
    .where('heartbeat_enabled', '=', 1)
    .execute();
  return rows.map(rowToSettings);
}

export async function listEnabledProactivePots(): Promise<PotAutomationSettings[]> {
  const db = getDatabase();
  const rows = await db
    .selectFrom('pot_automation_settings')
    .selectAll()
    .where('enabled', '=', 1)
    .where('proactive_conversations_enabled', '=', 1)
    .execute();
  return rows.map(rowToSettings);
}
