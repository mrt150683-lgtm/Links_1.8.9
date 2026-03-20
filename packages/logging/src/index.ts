import pino, { type Logger } from 'pino';

export type { Logger };

export interface CreateLoggerOptions {
  level?: string;
  name?: string;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  return pino({
    level: options.level ?? 'info',
    name: options.name,
    // Force JSON output in all environments (no transport)
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
  });
}

// Export the request ID plugin
export { default as requestIdPlugin } from './fastify-request-id.js';

// ============================================================================
// Flow Event Registry (Phase 0 — Flow Spec)
// ============================================================================

/**
 * Stable, machine-readable event names for every processing flow stage.
 * These replace freeform `msg` strings and are queryable in log aggregators.
 */
export const FlowEvent = {
  DOC_UPLOAD_STARTED: 'DOC_UPLOAD_STARTED',
  TEXT_EXTRACT_STARTED: 'TEXT_EXTRACT_STARTED',
  TEXT_EXTRACT_COMPLETED: 'TEXT_EXTRACT_COMPLETED',
  IMAGE_UPLOAD_STARTED: 'IMAGE_UPLOAD_STARTED',
  TAG_ENTRY_STARTED: 'TAG_ENTRY_STARTED',
  TAG_ENTRY_COMPLETED: 'TAG_ENTRY_COMPLETED',
  ENTITY_EXTRACT_STARTED: 'ENTITY_EXTRACT_STARTED',
  ENTITY_EXTRACT_COMPLETED: 'ENTITY_EXTRACT_COMPLETED',
  SUMMARIZE_STARTED: 'SUMMARIZE_STARTED',
  SUMMARIZE_COMPLETED: 'SUMMARIZE_COMPLETED',
  LINK_CANDIDATES_STARTED: 'LINK_CANDIDATES_STARTED',
  LINK_CANDIDATES_COMPLETED: 'LINK_CANDIDATES_COMPLETED',
  LINK_CLASSIFY_COMPLETED: 'LINK_CLASSIFY_COMPLETED',
  CALENDAR_NOTIFICATION_EMITTED: 'CALENDAR_NOTIFICATION_EMITTED',
  JOB_STARTED: 'JOB_STARTED',
  JOB_COMPLETED: 'JOB_COMPLETED',
  JOB_FAILED: 'JOB_FAILED',
  FLOW_COMPLETED: 'FLOW_COMPLETED',
  FLOW_FAILED: 'FLOW_FAILED',
} as const;

export type FlowEventName = (typeof FlowEvent)[keyof typeof FlowEvent];

export interface FlowLogFields {
  event: FlowEventName;
  flow_id?: string | null;
  job_id?: string;
  pot_id?: string | null;
  entry_id?: string | null;
  stage?: string;
  status: 'STARTED' | 'PROGRESS' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  duration_ms?: number;
  error?: string;
  metrics?: Record<string, unknown>;
}

/**
 * Emit a structured flow event log line.
 * Additive — existing freeform logger.info() calls are unaffected.
 */
export function logFlowEvent(logger: Logger, fields: FlowLogFields): void {
  logger.info(fields);
}
