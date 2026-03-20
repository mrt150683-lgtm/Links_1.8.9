/**
 * task_execute Job Handler
 *
 * Executes a scheduled_task of type custom_prompt_task or other generic types.
 * 1. Load scheduled_task from payload
 * 2. Create task_run record (status=running)
 * 3. Dispatch to sub-handler based on task_type
 * 4. Update task_run with result
 * 5. Update scheduled_task: last_run_at, last_result_status, recompute next_run_at
 */

import { createLogger } from '@links/logging';
import type { JobContext } from '@links/storage';
import {
  getScheduledTask,
  updateScheduledTask,
  createTaskRun,
  updateTaskRun,
  getAutomationSettings,
  getAIPreferences,
  logAuditEvent,
  enqueueJob,
  computeTaskNextRunAt,
  getSystemTimezone,
} from '@links/storage';
import { createChatCompletion } from '@links/ai';

const logger = createLogger({ name: 'job:task-execute' });
const DEFAULT_TASK_MODEL = 'x-ai/grok-4.1-fast';

export async function taskExecuteHandler(ctx: JobContext): Promise<void> {
  const payload = ctx.payload as {
    scheduled_task_id: string;
    pot_id: string;
    task_type?: string;
    task_payload?: Record<string, unknown>;
  };

  const { scheduled_task_id: taskId, pot_id: potId } = payload;

  logger.info({ job_id: ctx.jobId, task_id: taskId, pot_id: potId, msg: 'Task execute start' });

  // Load task
  const task = await getScheduledTask(taskId);
  if (!task) {
    logger.error({ task_id: taskId, msg: 'Scheduled task not found' });
    return;
  }

  // Load settings
  const settings = await getAutomationSettings(potId);
  if (!settings || !settings.enabled) {
    logger.info({ task_id: taskId, msg: 'Automation disabled — skipping' });
    return;
  }

  // Create run record
  const taskRun = await createTaskRun({
    task_id: taskId,
    pot_id: potId,
    status: 'running',
  });

  await updateTaskRun(taskRun.id, { started_at: Date.now() });

  const tz = settings.timezone ?? getSystemTimezone() ?? 'UTC';

  try {
    let resultStatus = 'done';
    let resultSummary = '';
    let result: unknown = null;

    switch (task.task_type) {
      case 'heartbeat':
        // Delegate to heartbeat_generate
        await enqueueJob({
          job_type: 'heartbeat_generate',
          pot_id: potId,
          payload: { pot_id: potId, scheduled_task_id: taskId },
          priority: task.priority,
        });
        resultSummary = 'Delegated to heartbeat_generate';
        break;

      case 'deep_research_run':
        await enqueueJob({
          job_type: 'deep_research_plan',
          pot_id: potId,
          payload: { pot_id: potId, ...(task.payload ?? {}) },
          priority: task.priority,
        });
        resultSummary = 'Delegated to deep_research_plan';
        break;

      case 'journal_daily':
        await enqueueJob({
          job_type: 'build_daily_journal_note',
          pot_id: potId,
          payload: { pot_id: potId },
          priority: task.priority,
        });
        resultSummary = 'Delegated to build_daily_journal_note';
        break;

      case 'custom_prompt_task': {
        // Inline AI call with custom prompt from task payload
        const taskPayload = task.payload as any;
        const customPrompt = taskPayload?.prompt as string | undefined;
        if (!customPrompt) {
          resultStatus = 'failed';
          resultSummary = 'No prompt provided in task payload';
          break;
        }

        const prefs = await getAIPreferences();
        const modelId = settings.default_model
          ?? prefs.automation_models?.task_execution
          ?? prefs.default_model
          ?? DEFAULT_TASK_MODEL;

        const response = await createChatCompletion({
          model: modelId,
          messages: [
            { role: 'system', content: 'You are a helpful assistant. Respond to the task below.' },
            { role: 'user', content: customPrompt },
          ],
          temperature: 0.3,
          max_tokens: 2000,
        });

        const content = response.choices[0]?.message?.content ?? '';
        result = { response: content };
        resultSummary = `AI task completed with ${content.length} chars response`;

        await updateTaskRun(taskRun.id, { model_id: modelId });
        break;
      }

      default:
        resultSummary = `Unknown task type: ${task.task_type}`;
    }

    // Update task run
    await updateTaskRun(taskRun.id, {
      status: resultStatus as any,
      finished_at: Date.now(),
      result,
    });

    // Update scheduled task
    const nextRunAt = task.schedule_kind !== 'once' && task.schedule_kind !== 'manual'
      ? computeTaskNextRunAt(task.cron_like, tz, Date.now())
      : null;

    await updateScheduledTask(taskId, {
      last_run_at: Date.now(),
      last_result_status: resultStatus,
      last_result_summary: resultSummary,
      locked_by: null,
      locked_at: null,
      ...(task.schedule_kind === 'once' ? { status: 'completed', next_run_at: null } : {}),
      ...(nextRunAt !== null ? { next_run_at: nextRunAt } : {}),
    });

    await logAuditEvent({
      actor: 'system',
      action: 'automation_task_executed',
      pot_id: potId,
      metadata: { task_id: taskId, task_type: task.task_type, run_id: taskRun.id, status: resultStatus },
    });

    logger.info({ task_id: taskId, run_id: taskRun.id, status: resultStatus, msg: 'Task execute complete' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ task_id: taskId, err: msg, msg: 'Task execute failed' });

    await updateTaskRun(taskRun.id, {
      status: 'failed',
      finished_at: Date.now(),
      error_text: msg,
    });

    await updateScheduledTask(taskId, {
      last_run_at: Date.now(),
      last_result_status: 'failed',
      last_result_summary: msg.slice(0, 500),
      locked_by: null,
      locked_at: null,
    });

    await logAuditEvent({
      actor: 'system',
      action: 'automation_task_failed',
      pot_id: potId,
      metadata: { task_id: taskId, error: msg },
    });
  }
}
