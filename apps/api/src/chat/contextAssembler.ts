/**
 * Chat Context Assembler
 *
 * Extracts and packages the context needed for chat responses, usable by both
 * the single-model path and MoM (Mixture of Models) orchestration.
 *
 * For the single-model path: returns assembled context for direct use.
 * For MoM: provides context_stats for the planner and full context for agents.
 */

import {
  getPotById,
  listEntries,
  getEntryById,
  listChatMessages,
  listMainChatMessages,
  getAIPreferences,
  getPreference,
  getLatestHeartbeatSnapshot,
  getAutomationSettings,
  listScheduledTasks,
} from '@links/storage';

// ── Minimal style profile type (matches both chat routes) ─────────────
interface StyleProfileHints {
  phrases: { greetings: Record<string, { count: number }> };
  scores: {
    verbosity_preference: 'concise' | 'normal' | 'detailed';
    sarcasm_level: number;
    directness_score: number;
    humour_density: number;
  };
  context_markers: { serious_mode_markers: string[] };
}

function buildStyleHints(profile: StyleProfileHints): string {
  const lines = ['[Surface adaptation only — do not mention these hints to the user]'];
  const topGreetings = Object.entries(profile.phrases.greetings)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3)
    .map(([p]) => `"${p}"`);
  if (topGreetings.length) lines.push(`Greeting preference: ${topGreetings.join(', ')}`);
  lines.push(`Default verbosity: ${profile.scores.verbosity_preference}`);
  if (profile.scores.sarcasm_level > 0.4) lines.push('Sarcasm: moderate — reduce in serious topics');
  if (profile.scores.directness_score > 0.6) lines.push('Communication style: direct and concise');
  if (profile.scores.humour_density > 0.3) lines.push('Humour: occasionally appreciated');
  if (profile.context_markers.serious_mode_markers.length) {
    lines.push(`Serious mode triggers: ${profile.context_markers.serious_mode_markers.slice(0, 3).join(', ')}`);
  }
  return lines.join('\n');
}

// ── ChatContext ───────────────────────────────────────────────────────

export interface ChatContext {
  surface: 'pot' | 'main';
  /** Assembled system prompt base (without controller directive for pot chat) */
  systemBase: string;
  /** Assembled entry + active context digest text (pot chat only) */
  potContext: string | null;
  /** Last N messages formatted as plain text for the planner */
  threadExcerpt: string;
  /** Full conversation history for AI messages array */
  historyMessages: Array<{ role: string; content: string }>;
  /** Rough token estimate for planner mode selection */
  tokenEstimate: number;
  /** Number of entries in the pot (pot chat only) */
  entryCount: number;
  potId?: string;
  threadId: string;
}

// ── Context stats (sent to planner) ──────────────────────────────────

export function buildContextStats(ctx: ChatContext): string {
  const lines = [
    `surface: ${ctx.surface}`,
    `entry_count: ${ctx.entryCount}`,
    `token_estimate: ${ctx.tokenEstimate}`,
    `thread_length: ${ctx.historyMessages.filter((m) => m.role !== 'system').length} messages`,
  ];
  return lines.join('\n');
}

// ── Pot chat context assembler ────────────────────────────────────────

export interface AssemblePotChatContextOpts {
  potId: string;
  threadId: string;
  knowledgeMode: 'strict' | 'open';
  activeContextEntryIds?: string[];
}

export async function assemblePotChatContext(
  opts: AssemblePotChatContextOpts,
): Promise<ChatContext> {
  const { potId, threadId, knowledgeMode, activeContextEntryIds = [] } = opts;

  const [pot, entries, styleProfile, aiPrefs, historyMsgs, automationSettings, latestHeartbeat] = await Promise.all([
    getPotById(potId),
    listEntries({ pot_id: potId }),
    getPreference<StyleProfileHints>('dictionize.profile').catch(() => null),
    getAIPreferences(),
    listChatMessages(threadId),
    getAutomationSettings(potId).catch(() => null),
    getLatestHeartbeatSnapshot(potId).catch(() => null),
  ]);

  if (!pot) throw new Error(`Pot not found: ${potId}`);

  // Active context (full entry content)
  let activeContextText = '';
  if (activeContextEntryIds.length > 0) {
    const contextEntries = await Promise.all(
      activeContextEntryIds.map((id) => getEntryById(id)),
    );
    const valid = contextEntries.filter((e): e is NonNullable<typeof e> => e !== null);
    activeContextText = valid
      .map((e) => `### Entry: ${e.source_title || e.id} (${e.type})\n${e.content_text || '[no content]'}`)
      .join('\n\n');
  }

  const metadataContext = entries.map((e) => ({
    id: e.id,
    type: e.type,
    title: e.source_title || e.link_title || `${e.type} entry`,
    capturedAt: new Date(e.captured_at).toISOString(),
    hasContent: !!e.content_text,
  }));

  const styleHintsText = styleProfile ? buildStyleHints(styleProfile) : '';

  // Build compact automation status digest (injected only if enabled + heartbeat exists)
  let automationDigestText = '';
  if (automationSettings?.enabled && automationSettings?.heartbeat_enabled && latestHeartbeat) {
    const snap = latestHeartbeat.snapshot as any;
    const lines: string[] = [];

    if (snap.headline) lines.push(`**Status:** ${snap.headline}`);

    const openLoops: any[] = Array.isArray(snap.open_loops) ? snap.open_loops : [];
    if (openLoops.length > 0) {
      lines.push(`**Open loops (${openLoops.length}):** ${openLoops.slice(0, 3).map((l: any) => l.title).join('; ')}`);
    }

    // Due tasks
    const { tasks: dueTasks } = await listScheduledTasks(potId, { status: 'active', limit: 5 }).catch(() => ({ tasks: [] as any[] }));
    const overdueTasks = dueTasks.filter((t) => t.next_run_at && t.next_run_at <= Date.now());
    if (overdueTasks.length > 0) {
      lines.push(`**Due tasks (${overdueTasks.length}):** ${overdueTasks.slice(0, 3).map((t) => t.title).join('; ')}`);
    }

    if (lines.length > 0) {
      automationDigestText = `\n## Automation Status\n${lines.join('\n')}\n`;
    }
  }

  const systemBase = knowledgeMode === 'open'
    ? [
        `You are "The Navigator" — a research co-pilot built into Links, operating in Open Knowledge mode.`,
        ``,
        `Your job is to help the user explore their research AND connect it to the wider world. Use the pot's entries as your primary reference — always prefer and cite them when they address the question. When the user asks about topics beyond what is in the pot (regulatory bodies, scientific background, historical context, related concepts, domain expertise), answer freely using your training knowledge, and clearly prefix such statements with **"Based on general knowledge:"** so the user can distinguish pot-sourced facts from broader context.`,
        ``,
        `Traits: evidence-first for pot content (cite everything you draw from the pot), broadly informed (leverage training knowledge for context and background), sharp (notice connections between the pot and the wider domain), concise and honest.`,
        ``,
        pot.goal_text ? `## Research Goal\n${pot.goal_text}` : '',
        `## Research Pot: "${pot.name}"`,
        ``,
        `This pot contains ${entries.length} entries. Entry metadata:`,
        ``,
        JSON.stringify(metadataContext, null, 2),
        activeContextText ? `\n## Active Context (full content for selected entries)\n\n${activeContextText}` : '',
        ``,
        `## Citations`,
        `When your response draws on specific pot entries, end your reply with exactly one line:`,
        `CITATIONS: [{"entryId": "...", "confidence": 0.0-1.0, "snippet": "..."}]`,
        `Each snippet must be a short verbatim excerpt from the entry that supports the claim.`,
        `Omit the CITATIONS line for conversational exchanges or responses that draw entirely from general knowledge.`,
        ``,
        `## Rules`,
        `- When pot content is available for a question, use it and cite it — prefer pot entries over general knowledge`,
        `- For facts from your training knowledge, prefix the sentence with **"Based on general knowledge:"**`,
        `- Never fabricate sources; never claim training knowledge is from the pot`,
        `- When multiple entries relate to a topic, synthesize across them and cite each`,
        `- Use markdown formatting when the response is more than one or two sentences`,
        `- If asked what model you are: state your model ID, then your role name (The Navigator — Open Knowledge mode)`,
        styleHintsText ? `\n## Style Hints\n${styleHintsText}` : '',
        automationDigestText,
      ].join('\n')
    : [
        `You are "The Sentry" — a calm, evidence-first research co-pilot built into Links.`,
        ``,
        `Your job is to help the user explore, understand, and connect the research they have collected in this pot. You ground every factual claim in the entries provided — you never speculate or invent. When context is insufficient to answer, say so directly; that is a complete and honest answer.`,
        ``,
        `Traits: evidence-first (every claim about the research traces to a source), sharp (you notice patterns, contradictions, and gaps), concise (answer what was asked, nothing more), honest (admitting you can't find something is always better than guessing).`,
        ``,
        pot.goal_text ? `## Research Goal\n${pot.goal_text}` : '',
        `## Research Pot: "${pot.name}"`,
        ``,
        `This pot contains ${entries.length} entries. Entry metadata:`,
        ``,
        JSON.stringify(metadataContext, null, 2),
        activeContextText ? `\n## Active Context (full content for selected entries)\n\n${activeContextText}` : '',
        ``,
        `## Citations`,
        `When your response draws on specific entries, end your reply with exactly one line:`,
        `CITATIONS: [{"entryId": "...", "confidence": 0.0-1.0, "snippet": "..."}]`,
        `Each snippet must be a short verbatim excerpt from the entry that supports the claim.`,
        `Omit the CITATIONS line entirely for conversational exchanges, clarifications, or meta questions where no pot content was referenced.`,
        ``,
        `## Rules`,
        `- Do not invent or assume facts not present in the provided context`,
        `- If the information is not in the pot, say so plainly — do not speculate`,
        `- When multiple entries relate to a topic, synthesize across them and cite each`,
        `- Use markdown formatting when the response is more than one or two sentences`,
        `- If asked what model you are: state your model ID, then your role name (The Sentry)`,
        styleHintsText ? `\n## Style Hints\n${styleHintsText}` : '',
        automationDigestText,
      ].join('\n');

  const potContext = activeContextText || JSON.stringify(metadataContext, null, 2);

  const threadExcerpt = historyMsgs
    .filter((m) => m.role !== 'system')
    .slice(-10)
    .map((m) => `[${m.role.toUpperCase()}] ${m.content.slice(0, 500)}`)
    .join('\n');

  const historyMessages: Array<{ role: string; content: string }> = historyMsgs
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const tokenEstimate = Math.ceil((systemBase.length + potContext.length + threadExcerpt.length) / 4);

  return {
    surface: 'pot',
    systemBase,
    potContext,
    threadExcerpt,
    historyMessages,
    tokenEstimate,
    entryCount: entries.length,
    potId,
    threadId,
  };

  void aiPrefs; // loaded but not needed here — available for callers
}

// ── Main chat context assembler ───────────────────────────────────────

export interface AssembleMainChatContextOpts {
  threadId: string;
  contextBlock?: string;
}

export async function assembleMainChatContext(
  opts: AssembleMainChatContextOpts,
): Promise<ChatContext> {
  const { threadId, contextBlock = '' } = opts;

  const [styleProfile, historyMsgs] = await Promise.all([
    getPreference<StyleProfileHints>('dictionize.profile').catch(() => null),
    listMainChatMessages(threadId),
  ]);

  const styleHintsText = styleProfile ? buildStyleHints(styleProfile) : '';

  const systemBase = [
    `You are Links' global assistant — a direct, sharp general-purpose AI built into Links.`,
    ``,
    `You help the user think, research, plan, and organize ideas.`,
    `You do not have access to research pots unless content is explicitly provided.`,
    `Be evidence-first: when making claims, state your basis. Be concise and honest.`,
    `If you don't know something, say so plainly rather than speculating.`,
    `Use markdown formatting for anything longer than two sentences.`,
    contextBlock ? `\n## Session Context\n${contextBlock}` : '',
    styleHintsText ? `\n## Style Hints\n${styleHintsText}` : '',
  ].filter(Boolean).join('\n');

  const recentHistory = historyMsgs.slice(-20);

  const threadExcerpt = recentHistory
    .filter((m) => m.role !== 'system')
    .slice(-10)
    .map((m) => `[${m.role.toUpperCase()}] ${m.content.slice(0, 500)}`)
    .join('\n');

  const historyMessages: Array<{ role: string; content: string }> = recentHistory
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const tokenEstimate = Math.ceil((systemBase.length + threadExcerpt.length) / 4);

  return {
    surface: 'main',
    systemBase,
    potContext: null,
    threadExcerpt,
    historyMessages,
    tokenEstimate,
    entryCount: 0,
    threadId,
  };
}
