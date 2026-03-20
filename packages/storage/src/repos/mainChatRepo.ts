/**
 * Main Chat Repository
 *
 * CRUD for global (non-pot-scoped) chat threads and messages.
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type { MainChatThread, MainChatMessageRecord } from '../types.js';

function tryParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

function toThread(row: any): MainChatThread {
  return {
    id: row.id,
    title: row.title ?? null,
    model_id: row.model_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toMessage(row: any): MainChatMessageRecord {
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

export async function createMainChatThread(
  opts?: { title?: string; model_id?: string },
): Promise<MainChatThread> {
  const db = getDatabase();
  const now = Date.now();
  const id = randomUUID();

  await db.insertInto('main_chat_threads').values({
    id,
    title: opts?.title ?? null,
    model_id: opts?.model_id ?? null,
    created_at: now,
    updated_at: now,
  }).execute();

  return getMainChatThreadOrThrow(id);
}

async function getMainChatThreadOrThrow(threadId: string): Promise<MainChatThread> {
  const thread = await getMainChatThread(threadId);
  if (!thread) throw new Error(`Main chat thread not found: ${threadId}`);
  return thread;
}

export async function getMainChatThread(threadId: string): Promise<MainChatThread | null> {
  const db = getDatabase();
  const row = await db.selectFrom('main_chat_threads')
    .selectAll()
    .where('id', '=', threadId)
    .executeTakeFirst();
  return row ? toThread(row) : null;
}

export async function listMainChatThreads(limit = 50): Promise<MainChatThread[]> {
  const db = getDatabase();
  const rows = await db.selectFrom('main_chat_threads')
    .selectAll()
    .orderBy('updated_at', 'desc')
    .limit(limit)
    .execute();
  return rows.map(toThread);
}

export async function deleteMainChatThread(threadId: string): Promise<void> {
  const db = getDatabase();
  await db.deleteFrom('main_chat_threads').where('id', '=', threadId).execute();
}

export async function touchMainChatThread(threadId: string): Promise<void> {
  const db = getDatabase();
  await db.updateTable('main_chat_threads')
    .set({ updated_at: Date.now() })
    .where('id', '=', threadId)
    .execute();
}

export async function updateMainChatThreadTitle(threadId: string, title: string): Promise<void> {
  const db = getDatabase();
  await db.updateTable('main_chat_threads')
    .set({ title })
    .where('id', '=', threadId)
    .execute();
}

// ── Message CRUD (append-only) ──────────────────────────────────────

export async function appendMainChatMessage(msg: {
  thread_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations_json?: string | null;
  token_usage_json?: string | null;
  model_id?: string | null;
}): Promise<MainChatMessageRecord> {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();

  await db.insertInto('main_chat_messages').values({
    id,
    thread_id: msg.thread_id,
    role: msg.role,
    content: msg.content,
    citations_json: msg.citations_json ?? null,
    token_usage_json: msg.token_usage_json ?? null,
    model_id: msg.model_id ?? null,
    created_at: now,
  }).execute();

  await touchMainChatThread(msg.thread_id);

  const row = await db.selectFrom('main_chat_messages')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  return toMessage(row);
}

export async function updateMainChatMessageContent(id: string, content: string): Promise<void> {
  const db = getDatabase();
  await db.updateTable('main_chat_messages').set({ content }).where('id', '=', id).execute();
}

export async function listMainChatMessages(threadId: string): Promise<MainChatMessageRecord[]> {
  const db = getDatabase();
  const rows = await db.selectFrom('main_chat_messages')
    .selectAll()
    .where('thread_id', '=', threadId)
    .orderBy('created_at', 'asc')
    .execute();
  return rows.map(toMessage);
}

export async function getMainChatThreadMessageCount(threadId: string): Promise<number> {
  const db = getDatabase();
  const row = await db.selectFrom('main_chat_messages')
    .select(db.fn.count('id').as('count'))
    .where('thread_id', '=', threadId)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}
