/**
 * Phase 10: MCP Logging Utilities
 *
 * Structured logging for MCP server with request correlation.
 * Integrates with @links/logging for consistent format.
 */

import { createLogger as createCoreLogger, type Logger } from '@links/logging';

/**
 * Create logger instance for MCP server
 */
export function createLogger(name: string): Logger {
  return createCoreLogger({ name: `mcp:${name}` });
}

/**
 * Log MCP tool call with sanitized arguments
 *
 * @param logger - Logger instance
 * @param toolName - Tool name
 * @param args - Tool arguments (will be sanitized)
 */
export function logToolCall(
  logger: Logger,
  toolName: string,
  args: Record<string, unknown>
): void {
  // Sanitize sensitive fields
  const sanitized = { ...args };
  if ('passphrase' in sanitized) {
    sanitized.passphrase = '[REDACTED]';
  }
  if ('passphrase_hint' in sanitized) {
    sanitized.passphrase_hint = '[REDACTED]';
  }

  logger.info(
    {
      tool: toolName,
      args: sanitized,
    },
    'MCP tool called'
  );
}

/**
 * Log MCP tool result
 *
 * @param logger - Logger instance
 * @param toolName - Tool name
 * @param success - Whether call succeeded
 * @param duration - Duration in milliseconds
 */
export function logToolResult(
  logger: Logger,
  toolName: string,
  success: boolean,
  duration: number
): void {
  logger.info(
    {
      tool: toolName,
      success,
      duration_ms: duration,
    },
    'MCP tool completed'
  );
}

/**
 * Log MCP tool error
 *
 * @param logger - Logger instance
 * @param toolName - Tool name
 * @param error - Error object
 */
export function logToolError(
  logger: Logger,
  toolName: string,
  error: unknown
): void {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(
    {
      tool: toolName,
      error: message,
    },
    'MCP tool error'
  );
}
