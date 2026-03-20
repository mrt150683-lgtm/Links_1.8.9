/**
 * Journal Module: API Routes
 *
 * Read endpoints for daily/weekly/monthly/quarterly/yearly journal notes.
 * POST /journal/rebuild to manually enqueue a job.
 */

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  getJournalEntry,
  enqueueJob,
} from '@links/storage';
import type { JournalJobPayload } from '@links/storage';

// ---------------------------------------------------------------------------
// Date helpers (inlined to avoid cross-package import from worker)
// ---------------------------------------------------------------------------

function computeWeekRange(endDateYmd: string): { period_start_ymd: string; period_end_ymd: string } {
  const [y, m, d] = endDateYmd.split('-').map(Number);
  const endDate = new Date(Date.UTC(y!, m! - 1, d!));
  const startDate = new Date(endDate);
  startDate.setUTCDate(startDate.getUTCDate() - 6);
  const fmt = (dt: Date) => {
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };
  return { period_start_ymd: fmt(startDate), period_end_ymd: endDateYmd };
}

function computeMonthRange(yearMonth: string): { period_start_ymd: string; period_end_ymd: string } {
  const [year, month] = yearMonth.split('-').map(Number);
  const startDate = new Date(Date.UTC(year!, month! - 1, 1));
  const endDate = new Date(Date.UTC(year!, month!, 0));
  const fmt = (dt: Date) => {
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };
  return { period_start_ymd: fmt(startDate), period_end_ymd: fmt(endDate) };
}

function computeQuarterRange(year: number, quarter: number): { period_start_ymd: string; period_end_ymd: string } {
  const startMonth = (quarter - 1) * 3;
  const startDate = new Date(Date.UTC(year, startMonth, 1));
  const endDate = new Date(Date.UTC(year, startMonth + 3, 0));
  const fmt = (dt: Date) => {
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  };
  return { period_start_ymd: fmt(startDate), period_end_ymd: fmt(endDate) };
}

function computeYearRange(year: number): { period_start_ymd: string; period_end_ymd: string } {
  return { period_start_ymd: `${year}-01-01`, period_end_ymd: `${year}-12-31` };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse YYYY-MM-DD date from query param */
function parseDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

/** Parse YYYY-MM month from query param */
function parseYearMonth(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!/^\d{4}-\d{2}$/.test(value)) return null;
  return value;
}

/** Parse YYYY year from query param */
function parseYear(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const n = parseInt(value, 10);
  return isNaN(n) ? null : n;
}

/** Parse quarter (1-4) from query param */
function parseQuarter(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1 || n > 4) return null;
  return n;
}

// ---------------------------------------------------------------------------
// Rebuild schema
// ---------------------------------------------------------------------------

const RebuildBodySchema = z.object({
  kind: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']),
  scope_type: z.enum(['pot', 'global']),
  scope_id: z.string().optional(),
  period_start_ymd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end_ymd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_ymd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  timezone: z.string().default('UTC'),
});

// ---------------------------------------------------------------------------
// Route map: job type from kind
// ---------------------------------------------------------------------------

const KIND_TO_JOB: Record<string, string> = {
  daily: 'build_daily_journal_note',
  weekly: 'build_weekly_journal_summary',
  monthly: 'build_monthly_journal_summary',
  quarterly: 'build_quarterly_journal_summary',
  yearly: 'build_yearly_journal_summary',
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const journalRoutes: FastifyPluginAsync = async (fastify) => {

  // -------------------------------------------------------------------------
  // GET /journal/daily
  // -------------------------------------------------------------------------
  fastify.get('/journal/daily', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const date = parseDate(query['date']);
    if (!date) {
      return reply.status(400).send({ error: 'ValidationError', message: 'date must be YYYY-MM-DD' });
    }

    const scope = (query['scope'] as string) ?? 'global';
    const pot_id = query['pot_id'] as string | undefined;

    if (scope === 'pot' && !pot_id) {
      return reply.status(400).send({ error: 'ValidationError', message: 'pot_id required when scope=pot' });
    }

    const entry = await getJournalEntry({
      kind: 'daily',
      scope_type: scope === 'pot' ? 'pot' : 'global',
      scope_id: scope === 'pot' ? (pot_id ?? null) : null,
      period_start_ymd: date,
    });

    if (!entry) {
      return reply.status(404).send({ error: 'NotFound', message: 'No daily journal note found for this date and scope' });
    }

    return reply.status(200).send(entry);
  });

  // -------------------------------------------------------------------------
  // GET /journal/weekly
  // -------------------------------------------------------------------------
  fastify.get('/journal/weekly', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const end = parseDate(query['end']);
    if (!end) {
      return reply.status(400).send({ error: 'ValidationError', message: 'end must be YYYY-MM-DD (end date of the week)' });
    }

    const scope = (query['scope'] as string) ?? 'global';
    const pot_id = query['pot_id'] as string | undefined;

    if (scope === 'pot' && !pot_id) {
      return reply.status(400).send({ error: 'ValidationError', message: 'pot_id required when scope=pot' });
    }

    const { period_start_ymd } = computeWeekRange(end);

    const entry = await getJournalEntry({
      kind: 'weekly',
      scope_type: scope === 'pot' ? 'pot' : 'global',
      scope_id: scope === 'pot' ? (pot_id ?? null) : null,
      period_start_ymd,
    });

    if (!entry) {
      return reply.status(404).send({ error: 'NotFound', message: 'No weekly journal note found for this period and scope' });
    }

    return reply.status(200).send(entry);
  });

  // -------------------------------------------------------------------------
  // GET /journal/monthly
  // -------------------------------------------------------------------------
  fastify.get('/journal/monthly', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const month = parseYearMonth(query['month']);
    if (!month) {
      return reply.status(400).send({ error: 'ValidationError', message: 'month must be YYYY-MM' });
    }

    const scope = (query['scope'] as string) ?? 'global';
    const pot_id = query['pot_id'] as string | undefined;

    if (scope === 'pot' && !pot_id) {
      return reply.status(400).send({ error: 'ValidationError', message: 'pot_id required when scope=pot' });
    }

    const { period_start_ymd } = computeMonthRange(month);

    const entry = await getJournalEntry({
      kind: 'monthly',
      scope_type: scope === 'pot' ? 'pot' : 'global',
      scope_id: scope === 'pot' ? (pot_id ?? null) : null,
      period_start_ymd,
    });

    if (!entry) {
      return reply.status(404).send({ error: 'NotFound', message: 'No monthly journal note found for this period and scope' });
    }

    return reply.status(200).send(entry);
  });

  // -------------------------------------------------------------------------
  // GET /journal/quarterly
  // -------------------------------------------------------------------------
  fastify.get('/journal/quarterly', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const year = parseYear(query['year']);
    const q = parseQuarter(query['q']);

    if (!year || !q) {
      return reply.status(400).send({ error: 'ValidationError', message: 'year (YYYY) and q (1-4) required' });
    }

    const scope = (query['scope'] as string) ?? 'global';
    const pot_id = query['pot_id'] as string | undefined;

    if (scope === 'pot' && !pot_id) {
      return reply.status(400).send({ error: 'ValidationError', message: 'pot_id required when scope=pot' });
    }

    const { period_start_ymd } = computeQuarterRange(year, q);

    const entry = await getJournalEntry({
      kind: 'quarterly',
      scope_type: scope === 'pot' ? 'pot' : 'global',
      scope_id: scope === 'pot' ? (pot_id ?? null) : null,
      period_start_ymd,
    });

    if (!entry) {
      return reply.status(404).send({ error: 'NotFound', message: 'No quarterly journal note found for this period and scope' });
    }

    return reply.status(200).send(entry);
  });

  // -------------------------------------------------------------------------
  // GET /journal/yearly
  // -------------------------------------------------------------------------
  fastify.get('/journal/yearly', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const year = parseYear(query['year']);

    if (!year) {
      return reply.status(400).send({ error: 'ValidationError', message: 'year (YYYY) required' });
    }

    const scope = (query['scope'] as string) ?? 'global';
    const pot_id = query['pot_id'] as string | undefined;

    if (scope === 'pot' && !pot_id) {
      return reply.status(400).send({ error: 'ValidationError', message: 'pot_id required when scope=pot' });
    }

    const { period_start_ymd } = computeYearRange(year);

    const entry = await getJournalEntry({
      kind: 'yearly',
      scope_type: scope === 'pot' ? 'pot' : 'global',
      scope_id: scope === 'pot' ? (pot_id ?? null) : null,
      period_start_ymd,
    });

    if (!entry) {
      return reply.status(404).send({ error: 'NotFound', message: 'No yearly journal note found for this period and scope' });
    }

    return reply.status(200).send(entry);
  });

  // -------------------------------------------------------------------------
  // GET /pots/:potId/journal/daily
  // -------------------------------------------------------------------------
  fastify.get('/pots/:potId/journal/daily', async (request, reply) => {
    const { potId } = request.params as { potId: string };
    const query = request.query as Record<string, unknown>;
    const date = parseDate(query['date']);

    if (!date) {
      return reply.status(400).send({ error: 'ValidationError', message: 'date must be YYYY-MM-DD' });
    }

    const entry = await getJournalEntry({
      kind: 'daily',
      scope_type: 'pot',
      scope_id: potId,
      period_start_ymd: date,
    });

    if (!entry) {
      return reply.status(404).send({ error: 'NotFound', message: 'No daily journal note found' });
    }

    return reply.status(200).send(entry);
  });

  // -------------------------------------------------------------------------
  // GET /pots/:potId/journal/weekly
  // -------------------------------------------------------------------------
  fastify.get('/pots/:potId/journal/weekly', async (request, reply) => {
    const { potId } = request.params as { potId: string };
    const query = request.query as Record<string, unknown>;
    const end = parseDate(query['end']);

    if (!end) {
      return reply.status(400).send({ error: 'ValidationError', message: 'end must be YYYY-MM-DD' });
    }

    const { period_start_ymd } = computeWeekRange(end);

    const entry = await getJournalEntry({
      kind: 'weekly',
      scope_type: 'pot',
      scope_id: potId,
      period_start_ymd,
    });

    if (!entry) {
      return reply.status(404).send({ error: 'NotFound', message: 'No weekly journal note found' });
    }

    return reply.status(200).send(entry);
  });

  // -------------------------------------------------------------------------
  // GET /pots/:potId/journal/monthly
  // -------------------------------------------------------------------------
  fastify.get('/pots/:potId/journal/monthly', async (request, reply) => {
    const { potId } = request.params as { potId: string };
    const query = request.query as Record<string, unknown>;
    const month = parseYearMonth(query['month']);

    if (!month) {
      return reply.status(400).send({ error: 'ValidationError', message: 'month must be YYYY-MM' });
    }

    const { period_start_ymd } = computeMonthRange(month);

    const entry = await getJournalEntry({
      kind: 'monthly',
      scope_type: 'pot',
      scope_id: potId,
      period_start_ymd,
    });

    if (!entry) {
      return reply.status(404).send({ error: 'NotFound', message: 'No monthly journal note found' });
    }

    return reply.status(200).send(entry);
  });

  // -------------------------------------------------------------------------
  // GET /pots/:potId/journal/quarterly
  // -------------------------------------------------------------------------
  fastify.get('/pots/:potId/journal/quarterly', async (request, reply) => {
    const { potId } = request.params as { potId: string };
    const query = request.query as Record<string, unknown>;
    const year = parseYear(query['year']);
    const q = parseQuarter(query['q']);

    if (!year || !q) {
      return reply.status(400).send({ error: 'ValidationError', message: 'year (YYYY) and q (1-4) required' });
    }

    const { period_start_ymd } = computeQuarterRange(year, q);

    const entry = await getJournalEntry({
      kind: 'quarterly',
      scope_type: 'pot',
      scope_id: potId,
      period_start_ymd,
    });

    if (!entry) {
      return reply.status(404).send({ error: 'NotFound', message: 'No quarterly journal note found' });
    }

    return reply.status(200).send(entry);
  });

  // -------------------------------------------------------------------------
  // GET /pots/:potId/journal/yearly
  // -------------------------------------------------------------------------
  fastify.get('/pots/:potId/journal/yearly', async (request, reply) => {
    const { potId } = request.params as { potId: string };
    const query = request.query as Record<string, unknown>;
    const year = parseYear(query['year']);

    if (!year) {
      return reply.status(400).send({ error: 'ValidationError', message: 'year (YYYY) required' });
    }

    const { period_start_ymd } = computeYearRange(year);

    const entry = await getJournalEntry({
      kind: 'yearly',
      scope_type: 'pot',
      scope_id: potId,
      period_start_ymd,
    });

    if (!entry) {
      return reply.status(404).send({ error: 'NotFound', message: 'No yearly journal note found' });
    }

    return reply.status(200).send(entry);
  });

  // -------------------------------------------------------------------------
  // POST /journal/rebuild
  // -------------------------------------------------------------------------
  fastify.post('/journal/rebuild', async (request, reply) => {
    const validation = RebuildBodySchema.safeParse(request.body);
    if (!validation.success) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: 'Invalid rebuild request',
        details: validation.error.format(),
      });
    }

    const body = validation.data;
    const jobType = KIND_TO_JOB[body.kind];
    if (!jobType) {
      return reply.status(400).send({ error: 'ValidationError', message: `Unknown kind: ${body.kind}` });
    }

    const payload: JournalJobPayload = {
      kind: body.kind,
      scope_type: body.scope_type,
      scope_id: body.scope_id,
      date_ymd: body.date_ymd ?? body.period_start_ymd,
      period_start_ymd: body.period_start_ymd,
      period_end_ymd: body.period_end_ymd,
      timezone: body.timezone,
    };

    const job = await enqueueJob({
      job_type: jobType,
      pot_id: body.scope_type === 'pot' ? body.scope_id : undefined,
      priority: 0,
      payload,
    });

    return reply.status(202).send({ job_id: job.id, job_type: jobType });
  });
};
