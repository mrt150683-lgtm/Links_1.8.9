/**
 * Chat Controller — intent classifier that runs before the main chat call.
 *
 * Classifies the user's message into a mode/verbosity/token-budget decision
 * so the main chat call uses appropriate parameters. Falls back to
 * DEFAULT_DECISION on any failure — zero regression risk.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatCompletion } from '@links/ai';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'chat-controller' });

// ── Types ────────────────────────────────────────────────────────────────────

export interface ControllerDecision {
  mode: 'greeting' | 'fact' | 'normal' | 'explain' | 'debug' | 'plan' | 'brainstorm';
  verbosity: 'short' | 'medium' | 'long';
  max_tokens: number;
  temperature: number;
  format: 'answer_only' | 'answer_then_details' | 'bullets_then_next' | 'step_by_step';
  needs_more_context: boolean;
  reason?: string;
}

export const DEFAULT_DECISION: ControllerDecision = {
  mode: 'normal',
  verbosity: 'medium',
  max_tokens: 800,
  temperature: 0.4,
  format: 'answer_then_details',
  needs_more_context: false,
};

// ── Prompt loading ────────────────────────────────────────────────────────────

const VALID_MODES = new Set(['greeting', 'fact', 'normal', 'explain', 'debug', 'plan', 'brainstorm']);
const VALID_VERBOSITIES = new Set(['short', 'medium', 'long']);
const VALID_FORMATS = new Set(['answer_only', 'answer_then_details', 'bullets_then_next', 'step_by_step']);

function getPromptsDir(): string {
  if (process.env.PROMPTS_DIR) return process.env.PROMPTS_DIR;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // Packaged layout: api-dist/bundle.cjs → ../prompts/
  const portablePath = join(__dirname, '../prompts');
  if (existsSync(portablePath)) return portablePath;
  // Dev layout: apps/api/dist/routes/chatController.js → packages/ai/prompts
  return join(__dirname, '../../../../packages/ai/prompts');
}

interface ParsedPrompt {
  system: string;
  user: string;
}

/** Fallback inline prompt used when the file cannot be read. */
const FALLBACK_PROMPT: ParsedPrompt = {
  system: `You are a message routing classifier for an AI research assistant. Your ONLY job is to output a JSON routing decision. Do NOT answer the user's question.

Output ONLY valid JSON — no markdown, no explanation:
{"mode":"greeting|fact|normal|explain|debug|plan|brainstorm","verbosity":"short|medium|long","max_tokens":600,"temperature":0.4,"format":"answer_only|answer_then_details|bullets_then_next|step_by_step","needs_more_context":false,"reason":"<one short phrase>"}

Mode: greeting=hi/hello with no question, fact=single factual question, normal=standard request, explain=concept explanation, debug=diagnose/troubleshoot, plan=plan/steps/strategy, brainstorm=ideas/suggestions.
Token budgets: greeting=80, fact=180, normal=600, explain=1000, debug=700, plan=1000, brainstorm=800.`,
  user: `Classify this message.\n\nUser said: "{{user_text}}"\n\nContext: {{history_length}} prior messages, {{active_context_tokens}} context tokens, {{pot_entry_count}} entries.`,
};

let cachedPrompt: ParsedPrompt | null = null;

function loadControllerPrompt(): ParsedPrompt {
  if (cachedPrompt) return cachedPrompt;

  try {
    const promptPath = join(getPromptsDir(), 'pot_chat_controller', 'v1.md');
    const raw = readFileSync(promptPath, 'utf8');

    // Strip YAML front-matter (--- ... ---)
    const withoutFrontmatter = raw.replace(/^---[\s\S]*?---\n?/, '');

    // Split on # System and # User section headers
    const systemMatch = withoutFrontmatter.match(/# System\n([\s\S]*?)(?=\n# User\n|$)/);
    const userMatch = withoutFrontmatter.match(/# User\n([\s\S]*)$/);

    if (!systemMatch || !userMatch) {
      logger.warn({ promptPath }, 'Controller prompt file malformed — using fallback');
      cachedPrompt = FALLBACK_PROMPT;
      return cachedPrompt;
    }

    cachedPrompt = {
      system: systemMatch[1]!.trim(),
      user: userMatch[1]!.trim(),
    };

    logger.info({ promptPath }, 'Controller prompt loaded and cached');
    return cachedPrompt;
  } catch (err) {
    logger.warn({ err }, 'Failed to load controller prompt file — using fallback');
    cachedPrompt = FALLBACK_PROMPT;
    return cachedPrompt;
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateDecision(raw: unknown): ControllerDecision {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Decision is not an object');
  }

  const d = raw as Record<string, unknown>;

  if (!VALID_MODES.has(d.mode as string)) {
    throw new Error(`Invalid mode: ${String(d.mode)}`);
  }
  if (!VALID_VERBOSITIES.has(d.verbosity as string)) {
    throw new Error(`Invalid verbosity: ${String(d.verbosity)}`);
  }
  if (!VALID_FORMATS.has(d.format as string)) {
    throw new Error(`Invalid format: ${String(d.format)}`);
  }
  if (typeof d.max_tokens !== 'number') {
    throw new Error('max_tokens must be a number');
  }
  if (typeof d.temperature !== 'number') {
    throw new Error('temperature must be a number');
  }
  if (typeof d.needs_more_context !== 'boolean') {
    throw new Error('needs_more_context must be a boolean');
  }

  return {
    mode: d.mode as ControllerDecision['mode'],
    verbosity: d.verbosity as ControllerDecision['verbosity'],
    // Clamp to safe range
    max_tokens: Math.min(2000, Math.max(60, Math.round(d.max_tokens as number))),
    temperature: Math.min(0.9, Math.max(0.0, d.temperature as number)),
    format: d.format as ControllerDecision['format'],
    needs_more_context: d.needs_more_context as boolean,
    reason: typeof d.reason === 'string' ? d.reason : undefined,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runChatController(opts: {
  userText: string;
  historyLength: number;
  activeContextTokens: number;
  potEntryCount: number;
  modelId: string;
}): Promise<ControllerDecision> {
  const prompt = loadControllerPrompt();

  // Truncate user text to 500 chars to keep controller call cheap
  const userTextTruncated = opts.userText.slice(0, 500);

  const systemContent = prompt.system;
  const userContent = prompt.user
    .replace('{{user_text}}', userTextTruncated)
    .replace('{{history_length}}', String(opts.historyLength))
    .replace('{{active_context_tokens}}', String(opts.activeContextTokens))
    .replace('{{pot_entry_count}}', String(opts.potEntryCount));

  const response = await createChatCompletion(
    {
      model: opts.modelId,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
      ],
      temperature: 0.1,
      max_tokens: 200,
    },
    10000, // 10 second timeout
  );

  const rawContent = response.choices?.[0]?.message?.content ?? '';

  // Strip potential markdown code fences before parsing
  const jsonStr = rawContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  const parsed = JSON.parse(jsonStr);
  const decision = validateDecision(parsed);

  logger.info(
    {
      mode: decision.mode,
      verbosity: decision.verbosity,
      max_tokens: decision.max_tokens,
      reason: decision.reason,
    },
    'Controller decision',
  );

  return decision;
}
