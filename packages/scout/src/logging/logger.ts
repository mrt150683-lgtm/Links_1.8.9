import { redactSecrets } from '../config/redact.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_VALUES: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export interface LogContext {
  run_id?: string | null;
  step?: string;
  module?: string;
  request_id?: string;
  repo_full_name?: string;
  pass?: number;
  duration_ms?: number;
  [key: string]: unknown;
}

let _level: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  _level = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_VALUES[level] >= LEVEL_VALUES[_level];
}

function emit(level: LogLevel, ctx: LogContext, message: string): void {
  if (!shouldLog(level)) return;

  const entry = redactSecrets({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...ctx,
  });

  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'fatal') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  trace: (ctx: LogContext, message: string) => emit('trace', ctx, message),
  debug: (ctx: LogContext, message: string) => emit('debug', ctx, message),
  info: (ctx: LogContext, message: string) => emit('info', ctx, message),
  warn: (ctx: LogContext, message: string) => emit('warn', ctx, message),
  error: (ctx: LogContext, message: string) => emit('error', ctx, message),
  fatal: (ctx: LogContext, message: string) => emit('fatal', ctx, message),
};
