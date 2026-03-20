/**
 * BrowserRepo — Phase A+
 *
 * CRUD for browser persistence tables:
 *   shelf_tabs, tab_groups, browser_sessions, browser_history
 */
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db.js';

// ── Types ─────────────────────────────────────────────────────────────────

export interface ShelfTabRecord {
  id: string;
  url: string;
  title: string | null;
  faviconUrl: string | null;
  groupId: string | null;
  note: string | null;
  shelvedAt: number;
  lastActiveAt: number | null;
}

export interface TabGroupRecord {
  id: string;
  name: string;
  color: string;
  potId: string | null;
  createdAt: number;
}

export interface BrowserSessionRecord {
  id: string;
  name: string;
  tabSnapshot: unknown[];
  shelfSnapshot: unknown[];
  groupsSnapshot: unknown[];
  createdAt: number;
}

export interface BrowserHistoryRecord {
  id: string;
  url: string;
  title: string | null;
  visitTime: number;
  tabId: string | null;
}

// ── Row mappers ───────────────────────────────────────────────────────────

function toShelfTab(row: any): ShelfTabRecord {
  return {
    id: row.id,
    url: row.url,
    title: row.title ?? null,
    faviconUrl: row.favicon_url ?? null,
    groupId: row.group_id ?? null,
    note: row.note ?? null,
    shelvedAt: row.shelved_at,
    lastActiveAt: row.last_active_at ?? null,
  };
}

function toTabGroup(row: any): TabGroupRecord {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    potId: row.pot_id ?? null,
    createdAt: row.created_at,
  };
}

function toSession(row: any): BrowserSessionRecord {
  return {
    id: row.id,
    name: row.name,
    tabSnapshot: tryParse(row.tab_snapshot, []),
    shelfSnapshot: tryParse(row.shelf_snapshot, []),
    groupsSnapshot: tryParse(row.groups_snapshot, []),
    createdAt: row.created_at,
  };
}

function toHistory(row: any): BrowserHistoryRecord {
  return {
    id: row.id,
    url: row.url,
    title: row.title ?? null,
    visitTime: row.visit_time,
    tabId: row.tab_id ?? null,
  };
}

function tryParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

// ── Shelf ─────────────────────────────────────────────────────────────────

export async function addToShelf(item: {
  id?: string;
  url: string;
  title?: string;
  faviconUrl?: string;
  groupId?: string;
  note?: string;
  shelvedAt?: number;
  lastActiveAt?: number;
}): Promise<ShelfTabRecord> {
  const db = getDatabase();
  const id = item.id ?? randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insertInto('shelf_tabs').values({
    id,
    url: item.url,
    title: item.title ?? null,
    favicon_url: item.faviconUrl ?? null,
    group_id: item.groupId ?? null,
    note: item.note ?? null,
    shelved_at: item.shelvedAt ? Math.floor(item.shelvedAt / 1000) : now,
    last_active_at: item.lastActiveAt ? Math.floor(item.lastActiveAt / 1000) : null,
  }).execute();

  return getShelfItem(id) as Promise<ShelfTabRecord>;
}

export async function getShelfItem(id: string): Promise<ShelfTabRecord | null> {
  const db = getDatabase();
  const row = await db.selectFrom('shelf_tabs').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? toShelfTab(row) : null;
}

export async function getShelf(): Promise<ShelfTabRecord[]> {
  const db = getDatabase();
  const rows = await db.selectFrom('shelf_tabs').selectAll().orderBy('shelved_at', 'desc').execute();
  return rows.map(toShelfTab);
}

export async function removeFromShelf(id: string): Promise<void> {
  const db = getDatabase();
  await db.deleteFrom('shelf_tabs').where('id', '=', id).execute();
}

export async function clearShelf(): Promise<void> {
  const db = getDatabase();
  await db.deleteFrom('shelf_tabs').execute();
}

// ── Tab Groups ────────────────────────────────────────────────────────────

export async function createTabGroup(group: {
  id?: string;
  name: string;
  color?: string;
  potId?: string;
}): Promise<TabGroupRecord> {
  const db = getDatabase();
  const id = group.id ?? randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insertInto('tab_groups').values({
    id,
    name: group.name,
    color: group.color ?? '#4a9eff',
    pot_id: group.potId ?? null,
    created_at: now,
  }).execute();

  return getTabGroup(id) as Promise<TabGroupRecord>;
}

export async function getTabGroup(id: string): Promise<TabGroupRecord | null> {
  const db = getDatabase();
  const row = await db.selectFrom('tab_groups').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? toTabGroup(row) : null;
}

export async function listTabGroups(): Promise<TabGroupRecord[]> {
  const db = getDatabase();
  const rows = await db.selectFrom('tab_groups').selectAll().orderBy('created_at', 'asc').execute();
  return rows.map(toTabGroup);
}

export async function updateTabGroup(
  id: string,
  patch: { name?: string; color?: string; potId?: string | null },
): Promise<void> {
  const db = getDatabase();
  const updates: Record<string, unknown> = {};
  if (patch.name !== undefined) updates['name'] = patch.name;
  if (patch.color !== undefined) updates['color'] = patch.color;
  if (patch.potId !== undefined) updates['pot_id'] = patch.potId;
  if (Object.keys(updates).length === 0) return;
  await db.updateTable('tab_groups').set(updates).where('id', '=', id).execute();
}

export async function deleteTabGroup(id: string): Promise<void> {
  const db = getDatabase();
  // Clear group_id on shelf tabs belonging to this group
  await db.updateTable('shelf_tabs').set({ group_id: null }).where('group_id', '=', id).execute();
  await db.deleteFrom('tab_groups').where('id', '=', id).execute();
}

// ── Sessions ──────────────────────────────────────────────────────────────

export async function saveSession(session: {
  id?: string;
  name: string;
  tabSnapshot: unknown[];
  shelfSnapshot: unknown[];
  groupsSnapshot: unknown[];
}): Promise<BrowserSessionRecord> {
  const db = getDatabase();
  const id = session.id ?? randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db.insertInto('browser_sessions').values({
    id,
    name: session.name,
    tab_snapshot: JSON.stringify(session.tabSnapshot),
    shelf_snapshot: JSON.stringify(session.shelfSnapshot),
    groups_snapshot: JSON.stringify(session.groupsSnapshot),
    created_at: now,
  }).execute();

  return getSession(id) as Promise<BrowserSessionRecord>;
}

export async function getSession(id: string): Promise<BrowserSessionRecord | null> {
  const db = getDatabase();
  const row = await db.selectFrom('browser_sessions').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? toSession(row) : null;
}

export async function listSessions(): Promise<BrowserSessionRecord[]> {
  const db = getDatabase();
  const rows = await db.selectFrom('browser_sessions').selectAll().orderBy('created_at', 'desc').execute();
  return rows.map(toSession);
}

export async function deleteSession(id: string): Promise<void> {
  const db = getDatabase();
  await db.deleteFrom('browser_sessions').where('id', '=', id).execute();
}

// ── History ───────────────────────────────────────────────────────────────

export async function recordHistoryVisit(entry: {
  id?: string;
  url: string;
  title?: string;
  tabId?: string;
  visitTime?: number;
}): Promise<BrowserHistoryRecord> {
  const db = getDatabase();
  const id = entry.id ?? randomUUID();
  const visitTime = entry.visitTime
    ? Math.floor(entry.visitTime / 1000)
    : Math.floor(Date.now() / 1000);

  await db.insertInto('browser_history').values({
    id,
    url: entry.url,
    title: entry.title ?? null,
    visit_time: visitTime,
    tab_id: entry.tabId ?? null,
    session_id: null,
  }).execute();

  const row = await db.selectFrom('browser_history').selectAll().where('id', '=', id).executeTakeFirst();
  return toHistory(row);
}

export async function searchHistory(
  q?: string,
  limit: number = 100,
): Promise<BrowserHistoryRecord[]> {
  const db = getDatabase();
  let query = db.selectFrom('browser_history').selectAll();
  if (q) {
    const pattern = `%${q}%`;
    query = query.where((eb) =>
      eb.or([eb('url', 'like', pattern), eb('title', 'like', pattern)]),
    );
  }
  const rows = await query.orderBy('visit_time', 'desc').limit(limit).execute();
  return rows.map(toHistory);
}

export async function getHistoryEntry(id: string): Promise<BrowserHistoryRecord | null> {
  const db = getDatabase();
  const row = await db.selectFrom('browser_history').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? toHistory(row) : null;
}

export async function clearHistory(): Promise<void> {
  const db = getDatabase();
  await db.deleteFrom('browser_history').execute();
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const db = getDatabase();
  await db.deleteFrom('browser_history').where('id', '=', id).execute();
}

export async function getHistoryStats(): Promise<{
  totalEntries: number;
  todayCount: number;
}> {
  const db = getDatabase();
  const totalRow = await db
    .selectFrom('browser_history')
    .select(db.fn.count('id').as('count'))
    .executeTakeFirst();
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const todayRow = await db
    .selectFrom('browser_history')
    .select(db.fn.count('id').as('count'))
    .where('visit_time', '>=', todayStart)
    .executeTakeFirst();
  return {
    totalEntries: Number(totalRow?.count ?? 0),
    todayCount: Number(todayRow?.count ?? 0),
  };
}
