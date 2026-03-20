/**
 * Main Chat Notifications Repository
 *
 * CRUD for the global MainChat notification inbox.
 */

import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';
import type {
  MainChatNotification,
  MainChatNotificationState,
  MainChatNotificationType,
  CreateMainChatNotificationInput,
} from '../types.js';

function tryParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

function toNotification(row: any): MainChatNotification {
  return {
    id: row.id,
    type: row.type as MainChatNotificationType,
    title: row.title,
    preview: row.preview ?? null,
    payload: tryParse(row.payload_json, null),
    state: row.state as MainChatNotificationState,
    snoozed_until: row.snoozed_until ?? null,
    read_at: row.read_at ?? null,
    created_at: row.created_at,
    flow_id: row.flow_id ?? null,
  };
}

export async function createMainChatNotification(
  input: CreateMainChatNotificationInput,
): Promise<MainChatNotification> {
  const db = getDatabase();
  const id = randomUUID();
  const now = Date.now();

  await db.insertInto('main_chat_notifications').values({
    id,
    type: input.type,
    title: input.title,
    preview: input.preview ?? null,
    payload_json: input.payload != null ? JSON.stringify(input.payload) : null,
    state: 'unread',
    snoozed_until: null,
    read_at: null,
    created_at: now,
    flow_id: input.flow_id ?? null,
  }).execute();

  const row = await db.selectFrom('main_chat_notifications')
    .selectAll().where('id', '=', id).executeTakeFirst();
  return toNotification(row);
}

export async function listMainChatNotifications(opts?: {
  states?: MainChatNotificationState[];
  limit?: number;
}): Promise<MainChatNotification[]> {
  const db = getDatabase();
  const states = opts?.states ?? ['unread', 'opened'];
  const limit = opts?.limit ?? 100;

  const rows = await db.selectFrom('main_chat_notifications')
    .selectAll()
    .where('state', 'in', states)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute();

  // Filter out snoozed notifications whose snooze has not yet expired
  const now = Date.now();
  return rows
    .filter((r) => {
      if (r.state === 'snoozed' && r.snoozed_until != null && r.snoozed_until > now) return false;
      return true;
    })
    .map(toNotification);
}

export async function getMainChatNotification(id: string): Promise<MainChatNotification | null> {
  const db = getDatabase();
  const row = await db.selectFrom('main_chat_notifications')
    .selectAll().where('id', '=', id).executeTakeFirst();
  return row ? toNotification(row) : null;
}

export async function countUnreadMainChatNotifications(): Promise<number> {
  const db = getDatabase();
  const now = Date.now();
  const rows = await db.selectFrom('main_chat_notifications')
    .select(db.fn.count('id').as('count'))
    .where('state', '=', 'unread')
    .executeTakeFirst();
  // Also count snoozed whose snooze has expired
  const snoozedRows = await db.selectFrom('main_chat_notifications')
    .select(db.fn.count('id').as('count'))
    .where('state', '=', 'snoozed')
    .where('snoozed_until', '<=', now)
    .executeTakeFirst();
  return Number(rows?.count ?? 0) + Number(snoozedRows?.count ?? 0);
}

export async function updateMainChatNotificationState(
  id: string,
  state: MainChatNotificationState,
  snoozed_until?: number,
): Promise<void> {
  const db = getDatabase();
  const now = Date.now();
  await db.updateTable('main_chat_notifications')
    .set({
      state,
      snoozed_until: state === 'snoozed' ? (snoozed_until ?? null) : null,
      read_at: (state === 'opened' || state === 'dismissed') ? now : undefined,
    })
    .where('id', '=', id)
    .execute();
}

export async function deleteMainChatNotification(id: string): Promise<void> {
  const db = getDatabase();
  await db.deleteFrom('main_chat_notifications').where('id', '=', id).execute();
}

export async function expireSnoozedMainChatNotifications(): Promise<number> {
  const db = getDatabase();
  const now = Date.now();
  const result = await db.updateTable('main_chat_notifications')
    .set({ state: 'unread' })
    .where('state', '=', 'snoozed')
    .where('snoozed_until', '<=', now)
    .executeTakeFirst();
  return Number(result?.numUpdatedRows ?? 0);
}
