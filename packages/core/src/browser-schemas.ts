/**
 * Browser schemas (Phase A+)
 *
 * Zod schemas for all browser data types: tabs, shelf, groups, sessions, history.
 */
import { z } from 'zod';

export const TabTypeSchema = z.enum(['links_app', 'web']);

export const TabStateSchema = z.object({
  id: z.string(),
  type: TabTypeSchema,
  url: z.string(),
  title: z.string(),
  faviconUrl: z.string().optional(),
  isLoading: z.boolean(),
  isActive: z.boolean(),
  groupId: z.string().optional(),
});

export const ShelfTabSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string().optional(),
  faviconUrl: z.string().optional(),
  groupId: z.string().optional(),
  note: z.string().optional(),
  shelvedAt: z.number(),
  lastActiveAt: z.number().optional(),
});

export const TabGroupSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  color: z.string().default('#4a9eff'),
  potId: z.string().optional(),
  createdAt: z.number(),
});

export const BrowserSessionSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  tabSnapshot: z.array(TabStateSchema),
  shelfSnapshot: z.array(ShelfTabSchema),
  groupsSnapshot: z.array(TabGroupSchema),
  createdAt: z.number(),
});

export const BrowserHistoryEntrySchema = z.object({
  id: z.string(),
  url: z.string().url(),
  title: z.string().optional(),
  visitTime: z.number(),
  tabId: z.string().optional(),
});

export const PrivacyModeSchema = z.enum(['zero', 'review', 'full']);

// ── API payload schemas ────────────────────────────────────────────────────

export const AddToShelfBodySchema = z.object({
  id: z.string().optional(),
  url: z.string(),
  title: z.string().optional(),
  faviconUrl: z.string().optional(),
  groupId: z.string().optional(),
  note: z.string().optional(),
  shelvedAt: z.number().optional(),
  lastActiveAt: z.number().optional(),
});

export const CreateTabGroupBodySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  color: z.string().default('#4a9eff'),
  potId: z.string().optional(),
  createdAt: z.number().optional(),
});

export const UpdateTabGroupBodySchema = z.object({
  name: z.string().min(1).optional(),
  color: z.string().optional(),
  potId: z.string().nullable().optional(),
});

export const SaveSessionBodySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  tabSnapshot: z.array(z.unknown()).default([]),
  shelfSnapshot: z.array(z.unknown()).default([]),
  groupsSnapshot: z.array(z.unknown()).default([]),
  createdAt: z.number().optional(),
});

export const RecordHistoryBodySchema = z.object({
  id: z.string().optional(),
  url: z.string(),
  title: z.string().optional(),
  tabId: z.string().optional(),
  visitTime: z.number().optional(),
});

export const PromoteHistoryBodySchema = z.object({
  pot_id: z.string(),
  notes: z.string().optional(),
});

// ── Inferred types ────────────────────────────────────────────────────────

export type TabType = z.infer<typeof TabTypeSchema>;
export type TabState = z.infer<typeof TabStateSchema>;
export type ShelfTab = z.infer<typeof ShelfTabSchema>;
export type TabGroup = z.infer<typeof TabGroupSchema>;
export type BrowserSession = z.infer<typeof BrowserSessionSchema>;
export type BrowserHistoryEntry = z.infer<typeof BrowserHistoryEntrySchema>;
export type PrivacyMode = z.infer<typeof PrivacyModeSchema>;
