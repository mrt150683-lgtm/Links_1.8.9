/**
 * Chat Repository
 *
 * CRUD for chat threads and messages (pot chat feature).
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type { ChatThread, ChatMessageRecord } from '../types.js';

function tryParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

function toThread(row: any): ChatThread {
  return {
    id: row.id,
    pot_id: row.pot_id,
    title: row.title ?? null,
    model_id: row.model_id ?? null,
    personality_prompt_hash: row.personality_prompt_hash ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toMessage(row: any): ChatMessageRecord {
  return {
    id: row.id,
    thread_id: row.thread_id,
    role: row.role,
    content: row.content,
    citations: tryParse(row.citations_json, null),
    token_usage: tryParse(row.token_usage_json, null),
    model_id: row.model_id ?? null,
    created_at: row.created_at,
  };
}

// ── Thread CRUD ─────────────────────────────────────────────────────

export async function createChatThread(
  potId: string,
  opts?: { title?: string; model_id?: string; personality_prompt_hash?: string },
): Promise<ChatThread> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db.insertInto('chat_threads').values({
    id,
    pot_id: potId,
    title: opts?.title ?? null,
    model_id: opts?.model_id ?? null,
    personality_prompt_hash: opts?.personality_prompt_hash ?? null,
    created_at: now,
    updated_at: now,
  }).execute();

  return getChatThreadOrThrow(id);
}

async function getChatThreadOrThrow(threadId: string): Promise<ChatThread> {
  const thread = await getChatThread(threadId);
  if (!thread) throw new Error(`Chat thread not found: ${threadId}`);
  return thread;
}

export async function getChatThread(threadId: string): Promise<ChatThread | null> {
  const db = getDatabase();
  const row = await db.selectFrom('chat_threads')
    .selectAll()
    .where('id', '=', threadId)
    .executeTakeFirst();
  return row ? toThread(row) : null;
}

export async function listChatThreads(potId: string): Promise<ChatThread[]> {
  const db = getDatabase();
  const rows = await db.selectFrom('chat_threads')
    .selectAll()
    .where('pot_id', '=', potId)
    .orderBy('updated_at', 'desc')
    .execute();
  return rows.map(toThread);
}

export async function deleteChatThread(threadId: string): Promise<void> {
  const db = getDatabase();
  await db.deleteFrom('chat_threads').where('id', '=', threadId).execute();
}

export async function updateChatThreadTitle(threadId: string, title: string): Promise<void> {
  const db = getDatabase();
  await db.updateTable('chat_threads')
    .set({ title, updated_at: Date.now() })
    .where('id', '=', threadId)
    .execute();
}

export async function touchChatThread(threadId: string): Promise<void> {
  const db = getDatabase();
  await db.updateTable('chat_threads')
    .set({ updated_at: Date.now() })
    .where('id', '=', threadId)
    .execute();
}

// ── Message CRUD (append-only) ──────────────────────────────────────

export async function appendChatMessage(msg: {
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations_json?: string | null;
  token_usage_json?: string | null;
  model_id?: string | null;
}): Promise<ChatMessageRecord> {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();

  await db.insertInto('chat_messages').values({
    id,
    thread_id: msg.thread_id,
    role: msg.role,
    content: msg.content,
    citations_json: msg.citations_json ?? null,
    token_usage_json: msg.token_usage_json ?? null,
    model_id: msg.model_id ?? null,
    created_at: now,
  }).execute();

  // Touch parent thread
  await touchChatThread(msg.thread_id);

  const row = await db.selectFrom('chat_messages')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return toMessage(row);
}

export async function updateChatMessageContent(id: string, content: string): Promise<void> {
  const db = getDatabase();
  await db.updateTable('chat_messages').set({ content }).where('id', '=', id).execute();
}

export async function listChatMessages(threadId: string): Promise<ChatMessageRecord[]> {
  const db = getDatabase();
  const rows = await db.selectFrom('chat_messages')
    .selectAll()
    .where('thread_id', '=', threadId)
    .orderBy('created_at', 'asc')
    .execute();
  return rows.map(toMessage);
}

// ── Convenience ─────────────────────────────────────────────────────

export async function getChatThreadWithMessages(threadId: string): Promise<{ thread: ChatThread; messages: ChatMessageRecord[] } | null> {
  const thread = await getChatThread(threadId);
  if (!thread) return null;
  const messages = await listChatMessages(threadId);
  return { thread, messages };
}

export async function getChatThreadMessageCount(threadId: string): Promise<number> {
  const db = getDatabase();
  const row = await db.selectFrom('chat_messages')
    .select(db.fn.count('id').as('count'))
    .where('thread_id', '=', threadId)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}
