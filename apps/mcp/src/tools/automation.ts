/**
 * MCP Tools — Automation & Heartbeat
 *
 * Six tools for querying and managing automation state:
 *   get_heartbeat_latest  — get latest heartbeat snapshot + document for a pot
 *   run_heartbeat         — trigger an immediate heartbeat generation
 *   list_tasks            — list scheduled tasks for a pot
 *   create_task           — create a new scheduled task
 *   update_task           — update a task's fields
 *   complete_task         — mark a task as completed
 */

import { z } from 'zod';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  getLatestHeartbeatSnapshot,
  getLatestHeartbeatDocument,
  listScheduledTasks,
  createScheduledTask,
  updateScheduledTask,
  getAutomationSettings,
  enqueueJob,
  getSystemTimezone,
  computeTaskNextRunAt,
} from '@links/storage';
import { successResponse } from '../schemas/errors.js';
import { mapErrorToResponse } from '../util/errors.js';

// ── get_heartbeat_latest ─────────────────────────────────────────────

export const GET_HEARTBEAT_LATEST_TOOL: Tool = {
  name: 'get_heartbeat_latest',
  description: 'Get the latest heartbeat snapshot and rendered document for a research pot. Returns the headline, summary, open loops, risks, and recommended actions.',
  inputSchema: {
    type: 'object',
    properties: {
      pot_id: {
        type: 'string',
        description: 'UUID of the pot to get heartbeat for',
      },
    },
    required: ['pot_id'],
    additionalProperties: false,
  },
};

const GetHeartbeatLatestArgsSchema = z.object({ pot_id: z.string().uuid() }).strict();

export async function getHeartbeatLatest(args: unknown): Promise<unknown> {
  try {
    const { pot_id } = GetHeartbeatLatestArgsSchema.parse(args);
    const [snapshot, document] = await Promise.all([
      getLatestHeartbeatSnapshot(pot_id),
      getLatestHeartbeatDocument(pot_id),
    ]);
    if (!snapshot) {
      return successResponse({ snapshot: null, document: null, message: 'No heartbeat generated yet for this pot' });
    }
    return successResponse({ snapshot, document });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}

// ── run_heartbeat ────────────────────────────────────────────────────

export const RUN_HEARTBEAT_TOOL: Tool = {
  name: 'run_heartbeat',
  description: 'Trigger an immediate heartbeat generation for a pot. Requires heartbeat to be enabled in the pot\'s automation settings.',
  inputSchema: {
    type: 'object',
    properties: {
      pot_id: {
        type: 'string',
        description: 'UUID of the pot to run heartbeat for',
      },
    },
    required: ['pot_id'],
    additionalProperties: false,
  },
};

const RunHeartbeatArgsSchema = z.object({ pot_id: z.string().uuid() }).strict();

export async function runHeartbeat(args: unknown): Promise<unknown> {
  try {
    const { pot_id } = RunHeartbeatArgsSchema.parse(args);
    const settings = await getAutomationSettings(pot_id);
    if (!settings?.enabled || !settings.heartbeat_enabled) {
      return { error: 'HeartbeatNotEnabled', message: 'Heartbeat is not enabled for this pot. Enable it in the pot\'s automation settings.' };
    }
    await enqueueJob({
      job_type: 'heartbeat_generate',
      pot_id,
      payload: { pot_id, manual: true },
      priority: 8,
    });
    return successResponse({ ok: true, message: 'Heartbeat generation enqueued' });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}

// ── list_tasks ───────────────────────────────────────────────────────

export const LIST_TASKS_TOOL: Tool = {
  name: 'list_tasks',
  description: 'List scheduled tasks for a research pot, with optional status filtering.',
  inputSchema: {
    type: 'object',
    properties: {
      pot_id: {
        type: 'string',
        description: 'UUID of the pot',
      },
      status: {
        type: 'string',
        description: 'Filter by status: active, paused, completed, canceled (default: all)',
        enum: ['active', 'paused', 'completed', 'canceled'],
      },
      limit: {
        type: 'number',
        description: 'Maximum tasks to return (default 50, max 200)',
        minimum: 1,
        maximum: 200,
      },
    },
    required: ['pot_id'],
    additionalProperties: false,
  },
};

const ListTasksArgsSchema = z.object({
  pot_id: z.string().uuid(),
  status: z.enum(['active', 'paused', 'completed', 'canceled']).optional(),
  limit: z.number().int().min(1).max(200).default(50),
}).strict();

export async function listTasks(args: unknown): Promise<unknown> {
  try {
    const { pot_id, status, limit } = ListTasksArgsSchema.parse(args);
    const result = await listScheduledTasks(pot_id, { status: status as any, limit });
    return successResponse(result);
  } catch (error) {
    return mapErrorToResponse(error);
  }
}

// ── create_task ──────────────────────────────────────────────────────

export const CREATE_TASK_TOOL: Tool = {
  name: 'create_task',
  description: 'Create a new scheduled task for a research pot. Tasks can be one-time, recurring, or manual.',
  inputSchema: {
    type: 'object',
    properties: {
      pot_id: {
        type: 'string',
        description: 'UUID of the pot',
      },
      title: {
        type: 'string',
        description: 'Task title (max 200 chars)',
        maxLength: 200,
      },
      description: {
        type: 'string',
        description: 'Task description (max 2000 chars)',
        maxLength: 2000,
      },
      task_type: {
        type: 'string',
        description: 'Task type: heartbeat, deep_research_run, journal_daily, custom_prompt_task (default: custom_prompt_task)',
        enum: ['heartbeat', 'deep_research_run', 'journal_daily', 'custom_prompt_task'],
      },
      schedule_kind: {
        type: 'string',
        description: 'Schedule kind: cron (recurring), once (single run), manual (on demand)',
        enum: ['cron', 'once', 'manual'],
      },
      cron_like: {
        type: 'string',
        description: 'Cron-like expression for recurring tasks: "daily at HH:MM", "weekly on MON at HH:MM", "@interval Xh"',
      },
    },
    required: ['pot_id', 'title', 'schedule_kind'],
    additionalProperties: false,
  },
};

const CreateTaskArgsSchema = z.object({
  pot_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  task_type: z.enum(['heartbeat', 'deep_research_run', 'journal_daily', 'custom_prompt_task']).default('custom_prompt_task'),
  schedule_kind: z.enum(['cron', 'once', 'manual']),
  cron_like: z.string().optional(),
}).strict();

export async function createTask(args: unknown): Promise<unknown> {
  try {
    const params = CreateTaskArgsSchema.parse(args);
    const tz = getSystemTimezone() ?? 'UTC';
    const nextRunAt = params.schedule_kind === 'cron' && params.cron_like
      ? computeTaskNextRunAt(params.cron_like, tz, Date.now())
      : null;

    const task = await createScheduledTask({
      pot_id: params.pot_id,
      task_type: params.task_type,
      title: params.title,
      description: params.description ?? '',
      schedule_kind: params.schedule_kind,
      cron_like: params.cron_like ?? null,
      priority: 10,
      created_by: 'user',
      created_from: 'chat',
      next_run_at: nextRunAt,
    });
    return successResponse({ task });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}

// ── update_task ──────────────────────────────────────────────────────

export const UPDATE_TASK_TOOL: Tool = {
  name: 'update_task',
  description: 'Update a scheduled task\'s title, description, or schedule.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'UUID of the task to update',
      },
      title: {
        type: 'string',
        description: 'New task title',
        maxLength: 200,
      },
      description: {
        type: 'string',
        description: 'New task description',
        maxLength: 2000,
      },
      status: {
        type: 'string',
        description: 'New status: active, paused',
        enum: ['active', 'paused'],
      },
    },
    required: ['task_id'],
    additionalProperties: false,
  },
};

const UpdateTaskArgsSchema = z.object({
  task_id: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['active', 'paused']).optional(),
}).strict();

export async function updateTask(args: unknown): Promise<unknown> {
  try {
    const { task_id, ...patch } = UpdateTaskArgsSchema.parse(args);
    const updated = await updateScheduledTask(task_id, patch);
    return successResponse({ task: updated });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}

// ── complete_task ────────────────────────────────────────────────────

export const COMPLETE_TASK_TOOL: Tool = {
  name: 'complete_task',
  description: 'Mark a scheduled task as completed. Completed tasks will no longer be executed by the scheduler.',
  inputSchema: {
    type: 'object',
    properties: {
      task_id: {
        type: 'string',
        description: 'UUID of the task to complete',
      },
    },
    required: ['task_id'],
    additionalProperties: false,
  },
};

const CompleteTaskArgsSchema = z.object({ task_id: z.string().uuid() }).strict();

export async function completeTask(args: unknown): Promise<unknown> {
  try {
    const { task_id } = CompleteTaskArgsSchema.parse(args);
    const updated = await updateScheduledTask(task_id, { status: 'completed', next_run_at: null });
    return successResponse({ task: updated });
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
