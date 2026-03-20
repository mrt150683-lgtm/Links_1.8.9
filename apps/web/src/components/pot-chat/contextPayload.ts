import type { PotEntry, ActiveContextItem } from './potChatTypes';

export function buildMetadataOnlyPayload(entries: PotEntry[]): object[] {
  return entries.map((e) => ({
    id: e.id,
    potId: e.potId,
    title: e.title,
    type: e.type,
    capturedAt: e.capturedAt,
    sizeBytes: e.sizeBytes,
    url: e.url,
    tags: e.artifacts.tags.map((t) => t.label),
    entities: e.artifacts.entities.map((en) => en.label),
    shortSummary: e.artifacts.shortSummary,
    summaryBullets: e.artifacts.summaryBullets,
  }));
}

export function buildActiveContextPayload(items: ActiveContextItem[]): object[] {
  return items.map((item) => ({
    id: item.entry.id,
    title: item.entry.title,
    type: item.entry.type,
    content: item.entry.content,
    thumbnailUrl: item.entry.thumbnailUrl,
    fullImageUrl: item.entry.fullImageUrl,
    addedAt: item.addedAt,
  }));
}

export function estimateActiveContextTokens(items: ActiveContextItem[]): number {
  return items.reduce((acc, a) => acc + Math.ceil(a.entry.sizeBytes / 4), 0);
}
