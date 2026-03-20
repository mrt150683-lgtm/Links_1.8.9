/**
 * Journal Schemas Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { DailyNoteSchema, RollupNoteSchema } from '../src/journal-schemas.js';

const validDailyNote = {
  schema_version: 1 as const,
  date_ymd: '2026-02-17',
  scope: { type: 'global' as const },
  headline: 'A productive day of research',
  what_happened: [
    {
      bullet: 'Reviewed AI safety literature',
      citations: [{ entry_id: 'entry-uuid-1', evidence: { excerpt: 'AI safety is important' } }],
    },
  ],
  open_loops: [
    {
      text: 'Need to read the alignment paper',
      type: 'todo' as const,
      priority: 'med' as const,
      citations: [{ entry_id: 'entry-uuid-1' }],
    },
  ],
  key_tags: [{ tag: 'AI safety', count: 3 }],
  key_entities: [{ entity: 'OpenAI', type: 'org', count: 2 }],
  notable_sources: [{ title: 'AI Safety Paper', url: 'https://example.com', entry_id: 'entry-uuid-1', citations: [{ entry_id: 'entry-uuid-1' }] }],
  related_links_graph: [{ src_entry_id: 'entry-uuid-1', dst_entry_id: 'entry-uuid-2', link_type: 'references', confidence: 0.8 }],
  stats: {
    entries_total: 5,
    entries_by_type: { text: 3, link: 2 },
    artifacts_by_type: { tags: 5 },
  },
  missing_or_unhandled: [],
  next_suggested_actions: [{ suggestion: 'Read alignment paper', citations: [{ entry_id: 'entry-uuid-1' }] }],
};

const validRollupNote = {
  schema_version: 1 as const,
  kind: 'weekly' as const,
  period_start_ymd: '2026-02-10',
  period_end_ymd: '2026-02-16',
  scope: { type: 'global' as const },
  headline: 'A week of deep research',
  highlights: [{ bullet: 'Made progress on AI safety', citations: [{ journal_id: 'journal-uuid-1' }] }],
  themes: [{ theme: 'AI safety', evidence_days: ['2026-02-10', '2026-02-11'], citations: [{ journal_id: 'journal-uuid-1' }] }],
  open_loops_rollup: [{ text: 'Read alignment paper', count: 3, citations: [{ journal_id: 'journal-uuid-1' }] }],
  suggested_topics: [{ topic: 'Constitutional AI', why: 'Recurring theme across multiple days', citations: [{ journal_id: 'journal-uuid-1' }] }],
  missing_or_unhandled: [],
  inputs: {
    expected_children: 7,
    found_children: 5,
    child_kind: 'daily' as const,
    child_journal_ids: ['journal-uuid-1', 'journal-uuid-2'],
  },
};

describe('DailyNoteSchema', () => {
  it('passes a valid daily note', () => {
    const result = DailyNoteSchema.safeParse(validDailyNote);
    expect(result.success).toBe(true);
  });

  it('rejects invalid schema_version', () => {
    const result = DailyNoteSchema.safeParse({ ...validDailyNote, schema_version: 2 });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const { headline, ...withoutHeadline } = validDailyNote;
    const result = DailyNoteSchema.safeParse(withoutHeadline);
    expect(result.success).toBe(false);
  });

  it('rejects invalid open_loop type enum', () => {
    const note = {
      ...validDailyNote,
      open_loops: [{ text: 'test', type: 'invalid_type', priority: 'low', citations: [{ entry_id: 'x' }] }],
    };
    const result = DailyNoteSchema.safeParse(note);
    expect(result.success).toBe(false);
  });

  it('rejects invalid priority enum', () => {
    const note = {
      ...validDailyNote,
      open_loops: [{ text: 'test', type: 'todo', priority: 'critical', citations: [{ entry_id: 'x' }] }],
    };
    const result = DailyNoteSchema.safeParse(note);
    expect(result.success).toBe(false);
  });

  it('rejects invalid date_ymd format', () => {
    const result = DailyNoteSchema.safeParse({ ...validDailyNote, date_ymd: '20260217' });
    expect(result.success).toBe(false);
  });

  it('allows empty arrays for optional list fields', () => {
    const note = {
      ...validDailyNote,
      what_happened: [],
      open_loops: [],
      key_tags: [],
      key_entities: [],
      notable_sources: [],
      related_links_graph: [],
      missing_or_unhandled: [],
      next_suggested_actions: [],
    };
    const result = DailyNoteSchema.safeParse(note);
    expect(result.success).toBe(true);
  });

  it('includes pot_id in scope when type=pot', () => {
    const note = {
      ...validDailyNote,
      scope: { type: 'pot' as const, pot_id: 'pot-abc' },
    };
    const result = DailyNoteSchema.safeParse(note);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scope.pot_id).toBe('pot-abc');
    }
  });
});

describe('RollupNoteSchema', () => {
  it('passes a valid weekly rollup', () => {
    const result = RollupNoteSchema.safeParse(validRollupNote);
    expect(result.success).toBe(true);
  });

  it('passes valid monthly, quarterly, yearly kinds', () => {
    for (const kind of ['monthly', 'quarterly', 'yearly'] as const) {
      const note = { ...validRollupNote, kind, inputs: { ...validRollupNote.inputs, child_kind: kind === 'weekly' ? 'daily' : kind === 'monthly' ? 'weekly' : kind === 'quarterly' ? 'monthly' : 'quarterly' } };
      const result = RollupNoteSchema.safeParse(note);
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid schema_version', () => {
    const result = RollupNoteSchema.safeParse({ ...validRollupNote, schema_version: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid kind', () => {
    const result = RollupNoteSchema.safeParse({ ...validRollupNote, kind: 'daily' });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const { headline, ...withoutHeadline } = validRollupNote;
    const result = RollupNoteSchema.safeParse(withoutHeadline);
    expect(result.success).toBe(false);
  });

  it('rejects invalid period_start_ymd format', () => {
    const result = RollupNoteSchema.safeParse({ ...validRollupNote, period_start_ymd: '2026/02/10' });
    expect(result.success).toBe(false);
  });
});
