/**
 * Automation schemas unit tests
 * Tests HeartbeatOutputSchema, ScheduledTaskCreateSchema, AutomationPrefsSchema, etc.
 */

import { describe, it, expect } from 'vitest';
import {
  HeartbeatOutputSchema,
  HeartbeatOpenLoopSchema,
  HeartbeatRiskSchema,
  HeartbeatRecommendedActionSchema,
  HeartbeatTaskOpSchema,
  HeartbeatTaskOperationsSchema,
  ScheduledTaskCreateSchema,
  ScheduledTaskUpdateSchema,
  AutomationPrefsSchema,
  UpsertAutomationSettingsSchema,
  PotAutomationSettingsSchema,
  QuietHoursSchema,
  TokenBudgetSchema,
} from '../src/automation-schemas.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function validHeartbeatOutput() {
  return {
    headline: 'Research progressing on quantum computing applications',
    summary: 'The pot has 12 entries covering quantum computing papers. Recent additions focus on error correction.',
    what_changed: 'Two new papers added on topological qubits.',
    open_loops: [
      { title: 'Missing comparison data', description: 'No benchmark data for surface codes vs. color codes.', priority: 'high' },
    ],
    risks: [
      { title: 'Outdated sources', description: 'Three papers are from 2019, field has moved.', severity: 'medium' },
    ],
    recommended_actions: [
      { action: 'Search for 2024 surface code benchmarks', rationale: 'Missing comparison data identified.', urgency: 'soon' },
    ],
    task_operations: { create: [], update: [], complete: [], pause: [] },
    heartbeat_markdown_sections: [
      { heading: 'Key Changes', content: '- Two new topological qubit papers added' },
    ],
    confidence: 0.72,
    reasoning_basis: 'Based on 12 entries with strong tag coverage. Gap in benchmark data lowers confidence slightly.',
  };
}

// ── HeartbeatOutputSchema ─────────────────────────────────────────────────

describe('HeartbeatOutputSchema', () => {
  it('validates a complete, well-formed heartbeat output', () => {
    const result = HeartbeatOutputSchema.safeParse(validHeartbeatOutput());
    expect(result.success).toBe(true);
  });

  it('rejects when headline is missing', () => {
    const data = { ...validHeartbeatOutput(), headline: undefined };
    const result = HeartbeatOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects when summary is missing', () => {
    const data = { ...validHeartbeatOutput(), summary: undefined };
    const result = HeartbeatOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects when confidence is out of range', () => {
    const data = { ...validHeartbeatOutput(), confidence: 1.5 };
    const result = HeartbeatOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects negative confidence', () => {
    const data = { ...validHeartbeatOutput(), confidence: -0.1 };
    const result = HeartbeatOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects headline exceeding 200 chars', () => {
    const data = { ...validHeartbeatOutput(), headline: 'x'.repeat(201) };
    const result = HeartbeatOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects summary exceeding 1000 chars', () => {
    const data = { ...validHeartbeatOutput(), summary: 'x'.repeat(1001) };
    const result = HeartbeatOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects when open_loops exceeds 10 items', () => {
    const loops = Array.from({ length: 11 }, (_, i) => ({
      title: `Loop ${i}`, description: 'desc', priority: 'low' as const,
    }));
    const data = { ...validHeartbeatOutput(), open_loops: loops };
    const result = HeartbeatOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects when risks exceeds 5 items', () => {
    const risks = Array.from({ length: 6 }, (_, i) => ({
      title: `Risk ${i}`, description: 'desc', severity: 'low' as const,
    }));
    const data = { ...validHeartbeatOutput(), risks };
    const result = HeartbeatOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects when recommended_actions exceeds 5 items', () => {
    const actions = Array.from({ length: 6 }, (_, i) => ({
      action: `Action ${i}`, rationale: 'reason', urgency: 'soon' as const,
    }));
    const data = { ...validHeartbeatOutput(), recommended_actions: actions };
    const result = HeartbeatOutputSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('defaults task_operations when omitted', () => {
    const { task_operations: _, ...rest } = validHeartbeatOutput();
    const result = HeartbeatOutputSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.task_operations).toEqual({ create: [], update: [], complete: [], pause: [] });
    }
  });

  it('defaults heartbeat_markdown_sections when omitted', () => {
    const { heartbeat_markdown_sections: _, ...rest } = validHeartbeatOutput();
    const result = HeartbeatOutputSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.heartbeat_markdown_sections).toEqual([]);
    }
  });

  it('accepts zero open_loops, risks, actions (sparse pot)', () => {
    const data = {
      ...validHeartbeatOutput(),
      open_loops: [],
      risks: [],
      recommended_actions: [],
    };
    const result = HeartbeatOutputSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('accepts confidence at boundary values 0 and 1', () => {
    expect(HeartbeatOutputSchema.safeParse({ ...validHeartbeatOutput(), confidence: 0 }).success).toBe(true);
    expect(HeartbeatOutputSchema.safeParse({ ...validHeartbeatOutput(), confidence: 1 }).success).toBe(true);
  });
});

// ── Sub-schemas ──────────────────────────────────────────────────────────

describe('HeartbeatOpenLoopSchema', () => {
  it('validates with required fields', () => {
    const result = HeartbeatOpenLoopSchema.safeParse({ title: 'Missing data', description: 'Need benchmarks' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe('medium'); // default
      expect(result.data.source_refs).toEqual([]); // default
    }
  });

  it('rejects invalid priority', () => {
    const result = HeartbeatOpenLoopSchema.safeParse({ title: 'X', description: 'Y', priority: 'urgent' });
    expect(result.success).toBe(false);
  });
});

describe('HeartbeatRiskSchema', () => {
  it('validates with defaults', () => {
    const result = HeartbeatRiskSchema.safeParse({ title: 'Risk', description: 'Desc' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.severity).toBe('medium');
  });

  it('accepts critical severity', () => {
    const result = HeartbeatRiskSchema.safeParse({ title: 'R', description: 'D', severity: 'critical' });
    expect(result.success).toBe(true);
  });
});

describe('HeartbeatRecommendedActionSchema', () => {
  it('validates with defaults', () => {
    const result = HeartbeatRecommendedActionSchema.safeParse({ action: 'Search X', rationale: 'Because Y' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.urgency).toBe('soon');
  });

  it('accepts immediate urgency', () => {
    const result = HeartbeatRecommendedActionSchema.safeParse({ action: 'A', rationale: 'R', urgency: 'immediate' });
    expect(result.success).toBe(true);
  });
});

describe('HeartbeatTaskOpSchema', () => {
  it('validates with only title', () => {
    const result = HeartbeatTaskOpSchema.safeParse({ title: 'New task' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.task_type).toBe('custom_prompt_task');
      expect(result.data.schedule_kind).toBe('manual');
      expect(result.data.priority).toBe(10);
    }
  });

  it('validates with cron schedule', () => {
    const result = HeartbeatTaskOpSchema.safeParse({
      title: 'Weekly check',
      schedule_kind: 'cron',
      cron_like: 'weekly on MON at 09:00',
    });
    expect(result.success).toBe(true);
  });
});

describe('HeartbeatTaskOperationsSchema', () => {
  it('defaults all arrays when empty object provided', () => {
    const result = HeartbeatTaskOperationsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.create).toEqual([]);
      expect(result.data.update).toEqual([]);
      expect(result.data.complete).toEqual([]);
      expect(result.data.pause).toEqual([]);
    }
  });
});

// ── ScheduledTaskCreateSchema ─────────────────────────────────────────────

describe('ScheduledTaskCreateSchema', () => {
  it('validates minimal input with defaults', () => {
    const result = ScheduledTaskCreateSchema.safeParse({
      pot_id: 'pot-123',
      title: 'My Task',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.task_type).toBe('custom_prompt_task');
      expect(result.data.schedule_kind).toBe('manual');
      expect(result.data.status).toBe('active');
      expect(result.data.created_by).toBe('user');
      expect(result.data.priority).toBe(10);
    }
  });

  it('rejects empty title', () => {
    const result = ScheduledTaskCreateSchema.safeParse({ pot_id: 'p', title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects title over 200 chars', () => {
    const result = ScheduledTaskCreateSchema.safeParse({ pot_id: 'p', title: 'x'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('rejects priority out of range', () => {
    expect(ScheduledTaskCreateSchema.safeParse({ pot_id: 'p', title: 'T', priority: 0 }).success).toBe(false);
    expect(ScheduledTaskCreateSchema.safeParse({ pot_id: 'p', title: 'T', priority: 101 }).success).toBe(false);
  });

  it('accepts created_by agent', () => {
    const result = ScheduledTaskCreateSchema.safeParse({ pot_id: 'p', title: 'T', created_by: 'agent' });
    expect(result.success).toBe(true);
  });

  it('accepts cron schedule with cron_like', () => {
    const result = ScheduledTaskCreateSchema.safeParse({
      pot_id: 'p', title: 'T', schedule_kind: 'cron', cron_like: 'daily at 09:00',
    });
    expect(result.success).toBe(true);
  });
});

// ── ScheduledTaskUpdateSchema ─────────────────────────────────────────────

describe('ScheduledTaskUpdateSchema', () => {
  it('validates empty object (no changes)', () => {
    const result = ScheduledTaskUpdateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('validates partial update with status', () => {
    const result = ScheduledTaskUpdateSchema.safeParse({ status: 'paused' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = ScheduledTaskUpdateSchema.safeParse({ status: 'running' });
    expect(result.success).toBe(false);
  });

  it('accepts null next_run_at', () => {
    const result = ScheduledTaskUpdateSchema.safeParse({ next_run_at: null });
    expect(result.success).toBe(true);
  });
});

// ── AutomationPrefsSchema ─────────────────────────────────────────────────

describe('AutomationPrefsSchema', () => {
  it('validates empty object', () => {
    const result = AutomationPrefsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('validates full prefs', () => {
    const result = AutomationPrefsSchema.safeParse({
      enabled: true,
      default_model: 'x-ai/grok-4.1-fast',
      timezone: 'America/New_York',
      quiet_hours: { from: '22:00', to: '06:00' },
      max_heartbeat_runs_per_day: 5,
      max_tasks_created_per_day: 10,
    });
    expect(result.success).toBe(true);
  });
});

// ── UpsertAutomationSettingsSchema ────────────────────────────────────────

describe('UpsertAutomationSettingsSchema', () => {
  it('validates partial upsert', () => {
    const result = UpsertAutomationSettingsSchema.safeParse({
      enabled: true,
      heartbeat_enabled: true,
    });
    expect(result.success).toBe(true);
  });

  it('validates null default_model', () => {
    const result = UpsertAutomationSettingsSchema.safeParse({ default_model: null });
    expect(result.success).toBe(true);
  });
});

// ── QuietHoursSchema ──────────────────────────────────────────────────────

describe('QuietHoursSchema', () => {
  it('validates valid HH:MM format', () => {
    const result = QuietHoursSchema.safeParse({ from: '22:00', to: '06:00' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid format', () => {
    expect(QuietHoursSchema.safeParse({ from: '2pm', to: '6am' }).success).toBe(false);
  });
});

// ── TokenBudgetSchema ─────────────────────────────────────────────────────

describe('TokenBudgetSchema', () => {
  it('validates with all fields', () => {
    const result = TokenBudgetSchema.safeParse({
      max_input_tokens: 5000,
      max_output_tokens: 3000,
      max_cost_usd_per_run: 0.10,
    });
    expect(result.success).toBe(true);
  });

  it('validates with empty object (all optional)', () => {
    const result = TokenBudgetSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects non-positive tokens', () => {
    expect(TokenBudgetSchema.safeParse({ max_input_tokens: 0 }).success).toBe(false);
    expect(TokenBudgetSchema.safeParse({ max_input_tokens: -1 }).success).toBe(false);
  });
});
