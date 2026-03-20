/**
 * Phase 10: MCP Server
 *
 * Main entry point for Links MCP server.
 * Exposes research capture backend as tool surface for LLM agents.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { initDatabase } from '@links/storage';
import { getConfig } from '@links/config';
import { createLogger } from './util/logging.js';
import { mapErrorToResponse, sanitizeErrorForLogging } from './util/errors.js';
import { validateToken, stripAuthField, isTokenAuthEnabled } from './auth/token.js';
import * as potsTools from './tools/pots.js';
import * as captureTools from './tools/capture.js';
import * as entriesTools from './tools/entries.js';
import * as artifactsTools from './tools/artifacts.js';
import * as processingTools from './tools/processing.js';
import * as bundlesTools from './tools/bundles.js';
import * as automationTools from './tools/automation.js';

const logger = createLogger('server');

/**
 * Tool catalog (will be populated in Commit 2-4)
 */
const TOOLS: Tool[] = [
  // Phase 2: Pots
  potsTools.LIST_POTS_TOOL,
  potsTools.CREATE_POT_TOOL,
  potsTools.GET_POT_TOOL,
  potsTools.DELETE_POT_TOOL,

  // Phase 3: Capture
  captureTools.CAPTURE_TEXT_TOOL,
  captureTools.CAPTURE_LINK_TOOL,

  // Phase 3: Entries
  entriesTools.LIST_ENTRIES_TOOL,
  entriesTools.GET_ENTRY_TOOL,

  // Phase 7: Artifacts
  artifactsTools.LIST_ARTIFACTS_FOR_ENTRY_TOOL,
  artifactsTools.GET_LATEST_ARTIFACT_TOOL,

  // Phase 5: Processing
  processingTools.ENQUEUE_PROCESSING_TOOL,
  processingTools.RUN_PROCESSING_NOW_TOOL,

  // Phase 9: Export/Import
  bundlesTools.EXPORT_POT_TOOL,
  bundlesTools.IMPORT_POT_TOOL,

  // Automation & Heartbeat (044-046)
  automationTools.GET_HEARTBEAT_LATEST_TOOL,
  automationTools.RUN_HEARTBEAT_TOOL,
  automationTools.LIST_TASKS_TOOL,
  automationTools.CREATE_TASK_TOOL,
  automationTools.UPDATE_TASK_TOOL,
  automationTools.COMPLETE_TASK_TOOL,
];

/**
 * Handle tool calls
 *
 * @param name - Tool name
 * @param args - Tool arguments
 * @returns Tool result
 */
async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const startTime = Date.now();

  try {
    // Validate token if auth enabled
    const authError = validateToken(args);
    if (authError) {
      return authError;
    }

    // Strip __auth field
    const cleanArgs = stripAuthField(args);

    // Route to tool handlers (will be implemented in Commit 2-4)
    switch (name) {
      // Phase 2: Pots
      case 'list_pots':
        return await potsTools.listPots(cleanArgs);
      case 'create_pot':
        return await potsTools.createPot(cleanArgs);
      case 'get_pot':
        return await potsTools.getPot(cleanArgs);
      case 'delete_pot':
        return await potsTools.deletePot(cleanArgs);

      // Phase 3: Capture
      case 'capture_text':
        return await captureTools.captureText(cleanArgs);
      case 'capture_link':
        return await captureTools.captureLink(cleanArgs);

      // Phase 3: Entries
      case 'list_entries':
        return await entriesTools.listEntries(cleanArgs);
      case 'get_entry':
        return await entriesTools.getEntry(cleanArgs);

      // Phase 7: Artifacts
      case 'list_artifacts_for_entry':
        return await artifactsTools.listArtifactsForEntry(cleanArgs);
      case 'get_latest_artifact':
        return await artifactsTools.getLatestArtifact(cleanArgs);

      // Phase 5: Processing
      case 'enqueue_processing':
        return await processingTools.enqueueProcessing(cleanArgs);
      case 'run_processing_now':
        return await processingTools.runProcessingNow(cleanArgs);

      // Phase 9: Export/Import
      case 'export_pot':
        return await bundlesTools.exportPotTool(cleanArgs);
      case 'import_pot':
        return await bundlesTools.importPotTool(cleanArgs);

      // Automation & Heartbeat (044-046)
      case 'get_heartbeat_latest':
        return await automationTools.getHeartbeatLatest(cleanArgs);
      case 'run_heartbeat':
        return await automationTools.runHeartbeat(cleanArgs);
      case 'list_tasks':
        return await automationTools.listTasks(cleanArgs);
      case 'create_task':
        return await automationTools.createTask(cleanArgs);
      case 'update_task':
        return await automationTools.updateTask(cleanArgs);
      case 'complete_task':
        return await automationTools.completeTask(cleanArgs);

      default:
        return mapErrorToResponse(`Unknown tool: ${name}`);
    }
  } catch (error) {
    logger.error(
      {
        tool: name,
        error: sanitizeErrorForLogging(error),
      },
      'Tool call failed'
    );
    return mapErrorToResponse(error);
  } finally {
    const duration = Date.now() - startTime;
    logger.info(
      {
        tool: name,
        duration_ms: duration,
      },
      'Tool call completed'
    );
  }
}

/**
 * Start MCP server
 */
async function main() {
  try {
    logger.info('Starting Links MCP server');

    // Load config
    const config = getConfig();

    // Initialize database
    logger.info('Initializing database');
    initDatabase({ filename: config.DATABASE_PATH });
    logger.info('Database initialized');

    // Log auth status
    if (isTokenAuthEnabled()) {
      logger.info('Token authentication enabled (MCP_TOKEN set)');
    } else {
      logger.info('Token authentication disabled (local-only mode)');
    }

    // Create MCP server
    const server = new Server(
      {
        name: 'links-mcp',
        version: '0.10.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Register tool list handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: TOOLS,
      };
    });

    // Register tool call handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const result = await handleToolCall(name, args || {});

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    });

    // Create stdio transport (local-only)
    const transport = new StdioServerTransport();

    // Connect server to transport
    await server.connect(transport);

    logger.info('MCP server started successfully');

    // Handle shutdown
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, shutting down');
      await server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, shutting down');
      await server.close();
      process.exit(0);
    });
  } catch (error) {
    logger.error(
      {
        error: sanitizeErrorForLogging(error),
      },
      'Failed to start MCP server'
    );
    process.exit(1);
  }
}

// Start server
main();
