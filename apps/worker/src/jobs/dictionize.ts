/**
 * Dictionize User Style Job Handler
 *
 * Analyzes completed chat threads to extract user conversational style signals
 * and stores them in a persistent StyleProfile for personalized chat experiences.
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPromptFromFile, interpolatePrompt, createChatCompletion } from '@links/ai';
import type { JobContext } from '@links/storage';
import {
  getPreference,
  setPreference,
  logAuditEvent,
  listChatMessages,
} from '@links/storage';
import type { ChatMessageRecord } from '@links/storage';
import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'job:dictionize' });

// ── Types ─────────────────────────────────────────────────────────────────────

type StyleContext = 'casual' | 'neutral' | 'serious' | 'frustrated' | 'excited';

interface PhraseEntry {
  count: number;
  last_seen: string;
  contexts: StyleContext[];
  threads_seen_count: number;
}

interface StyleProfile {
  meta: {
    version: number;
    updated_at: string;
    decay_half_life_days: number;
    processed_thread_digests: Record<string, string>;
    verbosity_votes?: Array<'concise' | 'normal' | 'detailed'>;
  };
  phrases: {
    greetings: Record<string, PhraseEntry>;
    signoffs: Record<string, PhraseEntry>;
    fillers: Record<string, PhraseEntry>;
    emphasis: Record<string, PhraseEntry>;
  };
  scores: {
    directness_score: number;
    sarcasm_level: number;
    humour_density: number;
    verbosity_preference: 'concise' | 'normal' | 'detailed';
  };
  context_markers: {
    serious_mode_markers: string[];
    casual_mode_markers: string[];
  };
  stats: {
    avg_sentence_length: number;
    avg_message_length_chars: number;
    question_rate: number;
  };
}

interface DictionizeDelta {
  new_phrases: Array<{
    category: 'greetings' | 'signoffs' | 'fillers' | 'emphasis';
    phrase: string;
    count_increment: number;
    contexts: StyleContext[];
    evidence_examples: string[];
  }>;
  score_adjustments: {
    sarcasm_level_delta: number;
    directness_score_delta: number;
    humour_density_delta: number;
    verbosity_pref_vote: 'concise' | 'normal' | 'detailed';
  };
  markers_add: {
    serious_mode_markers: string[];
    casual_mode_markers: string[];
  };
  stats_sample: {
    avg_sentence_length: number;
    avg_message_length_chars: number;
    question_rate: number;
  };
  notes?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PREFS_KEY = 'dictionize.profile';
const MAX_PHRASES_PER_CATEGORY = 50;
const MAX_MARKERS_PER_LIST = 20;
const DECAY_HALF_LIFE_DAYS = 60;
const PHRASE_THRESHOLD_COUNT = 3;
const PHRASE_THRESHOLD_THREADS = 2;

const PII_PATTERNS = [
  /[\w.+]+@[\w.]+/,
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
  /^https?:\/\//,
  /^[A-Za-z0-9_\-+=\/]{20,}$/,
];

// ── Prompt resolution ─────────────────────────────────────────────────────────

function getPromptsDir(): string {
  if (process.env.PROMPTS_DIR) return process.env.PROMPTS_DIR;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // Packaged layout: <app>/worker-dist/bundle.cjs → prompts at <app>/prompts/
  const portablePath = join(__dirname, '../../../prompts');
  if (existsSync(portablePath)) return portablePath;
  // Dev layout: apps/worker/dist/jobs/ → packages/ai/prompts/
  return join(__dirname, '../../../../packages/ai/prompts');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeThreadDigest(userMessages: ChatMessageRecord[]): string {
  const content = userMessages
    .map(m => `${m.id}:${m.content}`)
    .sort()
    .join('|');
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function isSafePhrase(p: string): boolean {
  return p.length <= 40 && !PII_PATTERNS.some(r => r.test(p));
}

function initEmptyProfile(): StyleProfile {
  return {
    meta: {
      version: 0,
      updated_at: new Date().toISOString(),
      decay_half_life_days: DECAY_HALF_LIFE_DAYS,
      processed_thread_digests: {},
      verbosity_votes: [],
    },
    phrases: {
      greetings: {},
      signoffs: {},
      fillers: {},
      emphasis: {},
    },
    scores: {
      directness_score: 0.5,
      sarcasm_level: 0.0,
      humour_density: 0.0,
      verbosity_preference: 'normal',
    },
    context_markers: {
      serious_mode_markers: [],
      casual_mode_markers: [],
    },
    stats: {
      avg_sentence_length: 0,
      avg_message_length_chars: 0,
      question_rate: 0,
    },
  };
}

function buildProfileSummary(profile: StyleProfile): string {
  const lines: string[] = [];
  const topGreetings = Object.entries(profile.phrases.greetings)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3)
    .map(([p]) => p);
  if (topGreetings.length) lines.push(`Common greetings: ${topGreetings.join(', ')}`);
  lines.push(`Verbosity preference: ${profile.scores.verbosity_preference}`);
  lines.push(`Directness: ${profile.scores.directness_score.toFixed(2)}`);
  lines.push(`Sarcasm level: ${profile.scores.sarcasm_level.toFixed(2)}`);
  lines.push(`Humour density: ${profile.scores.humour_density.toFixed(2)}`);
  if (profile.context_markers.serious_mode_markers.length) {
    lines.push(`Serious mode triggers: ${profile.context_markers.serious_mode_markers.slice(0, 3).join(', ')}`);
  }
  return lines.join('\n') || 'No prior profile.';
}

function validateDelta(raw: unknown): DictionizeDelta | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;

  if (!Array.isArray(d['new_phrases'])) return null;
  if (!d['score_adjustments'] || typeof d['score_adjustments'] !== 'object') return null;
  if (!d['markers_add'] || typeof d['markers_add'] !== 'object') return null;
  if (!d['stats_sample'] || typeof d['stats_sample'] !== 'object') return null;

  const sa = d['score_adjustments'] as Record<string, unknown>;
  if (typeof sa['sarcasm_level_delta'] !== 'number') return null;
  if (typeof sa['directness_score_delta'] !== 'number') return null;
  if (typeof sa['humour_density_delta'] !== 'number') return null;
  if (!['concise', 'normal', 'detailed'].includes(sa['verbosity_pref_vote'] as string)) return null;

  const ss = d['stats_sample'] as Record<string, unknown>;
  if (typeof ss['avg_sentence_length'] !== 'number') return null;
  if (typeof ss['avg_message_length_chars'] !== 'number') return null;
  if (typeof ss['question_rate'] !== 'number') return null;

  const ma = d['markers_add'] as Record<string, unknown>;
  if (!Array.isArray(ma['serious_mode_markers'])) return null;
  if (!Array.isArray(ma['casual_mode_markers'])) return null;

  return d as unknown as DictionizeDelta;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function applyDelta(
  profile: StyleProfile,
  delta: DictionizeDelta,
  threadId: string,
  digest: string,
): StyleProfile {
  const now = new Date();

  // 1. Decay existing phrase counts
  const updatedAt = new Date(profile.meta.updated_at);
  const daysSince = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);
  const halfLife = profile.meta.decay_half_life_days || DECAY_HALF_LIFE_DAYS;
  const decayFactor = Math.pow(0.5, daysSince / halfLife);

  const categories = ['greetings', 'signoffs', 'fillers', 'emphasis'] as const;
  for (const cat of categories) {
    for (const entry of Object.values(profile.phrases[cat])) {
      entry.count = entry.count * decayFactor;
    }
  }

  // 2. Merge new phrases
  for (const np of delta.new_phrases) {
    const cat = np.category;
    if (!categories.includes(cat)) continue;
    if (!isSafePhrase(np.phrase)) continue;

    const existing = profile.phrases[cat][np.phrase];
    if (existing) {
      existing.count += np.count_increment;
      existing.last_seen = now.toISOString();
      existing.threads_seen_count += 1;
      for (const ctx of np.contexts) {
        if (!existing.contexts.includes(ctx)) existing.contexts.push(ctx);
      }
    } else {
      profile.phrases[cat][np.phrase] = {
        count: np.count_increment,
        last_seen: now.toISOString(),
        contexts: np.contexts,
        threads_seen_count: 1,
      };
    }
  }

  // 3. Remove below-threshold phrases and cap per category
  for (const cat of categories) {
    for (const [phrase, entry] of Object.entries(profile.phrases[cat])) {
      if (entry.count < PHRASE_THRESHOLD_COUNT && entry.threads_seen_count < PHRASE_THRESHOLD_THREADS) {
        delete profile.phrases[cat][phrase];
      }
    }
    const sorted = Object.entries(profile.phrases[cat])
      .sort((a, b) => b[1].count - a[1].count);
    if (sorted.length > MAX_PHRASES_PER_CATEGORY) {
      for (const [p] of sorted.slice(MAX_PHRASES_PER_CATEGORY)) {
        delete profile.phrases[cat][p];
      }
    }
  }

  // 4. EMA score updates: newScore = 0.9 * old + 0.1 * (old + delta), clamped to [0, 1]
  const sa = delta.score_adjustments;
  profile.scores.sarcasm_level = clamp(
    0.9 * profile.scores.sarcasm_level + 0.1 * (profile.scores.sarcasm_level + sa.sarcasm_level_delta),
    0, 1,
  );
  profile.scores.directness_score = clamp(
    0.9 * profile.scores.directness_score + 0.1 * (profile.scores.directness_score + sa.directness_score_delta),
    0, 1,
  );
  profile.scores.humour_density = clamp(
    0.9 * profile.scores.humour_density + 0.1 * (profile.scores.humour_density + sa.humour_density_delta),
    0, 1,
  );

  // 5. Verbosity preference vote: update if 2 of last 3 votes match
  if (!profile.meta.verbosity_votes) profile.meta.verbosity_votes = [];
  profile.meta.verbosity_votes.push(sa.verbosity_pref_vote);
  if (profile.meta.verbosity_votes.length > 3) {
    profile.meta.verbosity_votes = profile.meta.verbosity_votes.slice(-3);
  }
  const voteCounts: Record<string, number> = {};
  for (const v of profile.meta.verbosity_votes) {
    voteCounts[v] = (voteCounts[v] || 0) + 1;
    if (voteCounts[v] >= 2) {
      profile.scores.verbosity_preference = v as 'concise' | 'normal' | 'detailed';
      break;
    }
  }

  // 6. Context markers — append unique, cap at MAX_MARKERS_PER_LIST
  for (const m of delta.markers_add.serious_mode_markers) {
    if (!profile.context_markers.serious_mode_markers.includes(m)) {
      profile.context_markers.serious_mode_markers.push(m);
    }
  }
  for (const m of delta.markers_add.casual_mode_markers) {
    if (!profile.context_markers.casual_mode_markers.includes(m)) {
      profile.context_markers.casual_mode_markers.push(m);
    }
  }
  profile.context_markers.serious_mode_markers =
    profile.context_markers.serious_mode_markers.slice(0, MAX_MARKERS_PER_LIST);
  profile.context_markers.casual_mode_markers =
    profile.context_markers.casual_mode_markers.slice(0, MAX_MARKERS_PER_LIST);

  // 7. Stats EMA update
  const ss = delta.stats_sample;
  if (profile.stats.avg_sentence_length === 0 && profile.stats.avg_message_length_chars === 0) {
    // First update — set directly
    profile.stats.avg_sentence_length = ss.avg_sentence_length;
    profile.stats.avg_message_length_chars = ss.avg_message_length_chars;
    profile.stats.question_rate = clamp(ss.question_rate, 0, 1);
  } else {
    profile.stats.avg_sentence_length =
      0.9 * profile.stats.avg_sentence_length + 0.1 * ss.avg_sentence_length;
    profile.stats.avg_message_length_chars =
      0.9 * profile.stats.avg_message_length_chars + 0.1 * ss.avg_message_length_chars;
    profile.stats.question_rate = clamp(
      0.9 * profile.stats.question_rate + 0.1 * ss.question_rate,
      0, 1,
    );
  }

  // 8. Meta update
  profile.meta.version += 1;
  profile.meta.updated_at = now.toISOString();
  profile.meta.processed_thread_digests[threadId] = digest;

  return profile;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function dictionizeUserStyleHandler(ctx: JobContext): Promise<void> {
  // 1. Validate payload
  const threadId = ctx.payload?.['thread_id'] as string | undefined;
  if (!threadId) {
    throw new Error('dictionize_user_style job requires thread_id in payload');
  }

  logger.info({ job_id: ctx.jobId, thread_id: threadId, msg: 'Starting dictionize job' });

  // 2. Load USER messages only
  const allMessages = await listChatMessages(threadId);
  const userMessages = allMessages.filter(m => m.role === 'user');

  // 3. Guard: no user messages
  if (userMessages.length === 0) {
    logger.info({ job_id: ctx.jobId, thread_id: threadId, msg: 'No user messages found, skipping' });
    return;
  }

  // 4. Compute digest
  const digest = computeThreadDigest(userMessages);

  // 5. Load profile
  const savedProfile = await getPreference<StyleProfile>(PREFS_KEY);
  const profile = savedProfile ?? initEmptyProfile();

  // 6. Idempotency check
  if (profile.meta.processed_thread_digests[threadId] === digest) {
    logger.info({ job_id: ctx.jobId, thread_id: threadId, msg: 'Thread already processed (same digest), skipping' });
    return;
  }

  // 7. Load prompt
  const promptPath = join(getPromptsDir(), 'dictionize_user_style', 'v1.md');
  const prompt = loadPromptFromFile(promptPath);

  // 8. Interpolate
  const profileSummary = buildProfileSummary(profile);
  const userMessagesText = userMessages
    .map((m, i) => `[${i + 1}] ${m.content}`)
    .join('\n\n');

  const { system, user } = interpolatePrompt(prompt, {
    profile_summary: profileSummary,
    message_count: String(userMessages.length),
    user_messages: userMessagesText,
  });

  // 9. Call AI
  logger.info({
    job_id: ctx.jobId,
    thread_id: threadId,
    message_count: userMessages.length,
    prompt_id: prompt.metadata.id,
    prompt_version: prompt.metadata.version,
    msg: 'Calling AI for style extraction',
  });

  const response = await createChatCompletion({
    model: 'x-ai/grok-4.1-fast',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: prompt.metadata.temperature ?? 0.2,
    max_tokens: prompt.metadata.max_tokens ?? 600,
    response_format: { type: 'json_object' },
  }, 30000);

  const rawContent = response.choices[0]?.message?.content;
  if (!rawContent) {
    throw new Error('AI response is empty');
  }

  // 10. Parse + validate delta
  let parsed: unknown;
  try {
    let cleaned = rawContent.trim();
    const match = cleaned.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
    if (match?.[1]) cleaned = match[1].trim();
    parsed = JSON.parse(cleaned);
  } catch {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
    }
  }

  if (!parsed) {
    logger.error({
      job_id: ctx.jobId,
      thread_id: threadId,
      preview: rawContent.substring(0, 200),
      msg: 'AI returned invalid JSON — skipping merge (digest not recorded)',
    });
    return; // don't record digest so worker can retry
  }

  const delta = validateDelta(parsed);
  if (!delta) {
    logger.error({
      job_id: ctx.jobId,
      thread_id: threadId,
      msg: 'Delta validation failed — skipping merge (digest not recorded)',
    });
    return; // don't record digest so worker can retry
  }

  // 11. Merge
  const newPhrasesCount = delta.new_phrases.filter(np => isSafePhrase(np.phrase)).length;
  const updatedProfile = applyDelta(profile, delta, threadId, digest);

  // 12. Save
  await setPreference(PREFS_KEY, updatedProfile);

  // 13. Audit
  await logAuditEvent({
    actor: 'system',
    action: 'dictionize_profile_updated',
    metadata: {
      thread_id: threadId,
      new_phrases_count: newPhrasesCount,
      version: updatedProfile.meta.version,
    },
  });

  logger.info({
    job_id: ctx.jobId,
    thread_id: threadId,
    version: updatedProfile.meta.version,
    new_phrases: newPhrasesCount,
    msg: 'Dictionize profile updated successfully',
  });
}
