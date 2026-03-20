/**
 * Unit tests for public mode transformation
 */

import { describe, it, expect } from 'vitest';
import {
  transformEntryToPublic,
  transformPotToPublic,
  transformAuditToPublic,
  validateEntryPublicTransform,
} from '@links/storage';
import type { ExportedEntry, ExportedPot } from '@links/core';

describe('publicModeTransform', () => {
  describe('transformPotToPublic', () => {
    it('preserves pot fields', () => {
      const pot: ExportedPot = {
        id: 'pot-1',
        name: 'Research Pot',
        description: 'My research',
        security_level: 'standard',
        created_at: 1000,
        updated_at: 2000,
        last_used_at: 3000,
      };

      const publicPot = transformPotToPublic(pot);

      expect(publicPot).toEqual(pot);
    });

    it('is deterministic (same input = same output)', () => {
      const pot: ExportedPot = {
        id: 'pot-1',
        name: 'Test',
        description: null,
        security_level: 'standard',
        created_at: 1000,
        updated_at: 2000,
        last_used_at: null,
      };

      const public1 = transformPotToPublic(pot);
      const public2 = transformPotToPublic(pot);

      expect(JSON.stringify(public1)).toBe(JSON.stringify(public2));
    });
  });

  describe('transformEntryToPublic', () => {
    let entry: ExportedEntry;

    beforeEach(() => {
      entry = {
        id: 'entry-1',
        pot_id: 'pot-1',
        type: 'text',
        content_text: 'Some content',
        content_sha256: 'abc123',
        capture_method: 'manual',
        source_url: 'https://example.com/article',
        source_title: 'Example Article',
        notes: 'Important notes',
        captured_at: 1000,
        created_at: 1000,
        updated_at: 2000,
        client_capture_id: 'client-123',
        source_app: 'Chrome Extension',
        source_context_json: '{"foo":"bar"}',
        asset_id: null,
      };
    });

    it('removes sensitive fields', () => {
      const publicEntry = transformEntryToPublic(entry);

      expect(publicEntry.source_url).toBeNull();
      expect(publicEntry.source_title).toBeNull();
      expect(publicEntry.notes).toBeNull();
      expect(publicEntry.source_app).toBeNull();
      expect(publicEntry.source_context_json).toBeNull();
      expect(publicEntry.client_capture_id).toBeNull();
    });

    it('preserves essential fields', () => {
      const publicEntry = transformEntryToPublic(entry);

      expect(publicEntry.id).toBe('entry-1');
      expect(publicEntry.pot_id).toBe('pot-1');
      expect(publicEntry.type).toBe('text');
      expect(publicEntry.content_text).toBe('Some content');
      expect(publicEntry.content_sha256).toBe('abc123');
      expect(publicEntry.capture_method).toBe('manual');
      expect(publicEntry.captured_at).toBe(1000);
      expect(publicEntry.created_at).toBe(1000);
      expect(publicEntry.updated_at).toBe(2000);
    });

    it('preserves asset_id (needed for linking)', () => {
      entry.asset_id = 'asset-123';
      const publicEntry = transformEntryToPublic(entry);

      expect(publicEntry.asset_id).toBe('asset-123');
    });

    it('handles entries with null source_url', () => {
      entry.source_url = null;
      const publicEntry = transformEntryToPublic(entry);

      expect(publicEntry.source_url).toBeNull();
    });

    it('is deterministic', () => {
      const public1 = transformEntryToPublic(entry);
      const public2 = transformEntryToPublic(entry);

      expect(JSON.stringify(public1)).toBe(JSON.stringify(public2));
    });

    it('does not mutate original entry', () => {
      const originalUrl = entry.source_url;
      transformEntryToPublic(entry);

      expect(entry.source_url).toBe(originalUrl);
    });
  });

  describe('transformAuditToPublic', () => {
    it('returns null (excludes audit events)', () => {
      const audit = {
        id: 'audit-1',
        timestamp: 1000,
        actor: 'user' as const,
        action: 'create_entry',
        pot_id: 'pot-1',
        entry_id: 'entry-1',
        metadata_json: '{}',
      };

      const result = transformAuditToPublic(audit);

      expect(result).toBeNull();
    });
  });

  describe('validateEntryPublicTransform', () => {
    let original: ExportedEntry;
    let publicEntry: ExportedEntry;

    beforeEach(() => {
      original = {
        id: 'entry-1',
        pot_id: 'pot-1',
        type: 'text',
        content_text: 'content',
        content_sha256: 'hash',
        capture_method: 'manual',
        source_url: 'https://example.com',
        source_title: 'Title',
        notes: 'Notes',
        captured_at: 1000,
        created_at: 1000,
        updated_at: 2000,
        client_capture_id: 'client-id',
        source_app: 'app',
        source_context_json: '{}',
        asset_id: null,
      };

      publicEntry = transformEntryToPublic(original);
    });

    it('accepts properly transformed entry', () => {
      expect(() => {
        validateEntryPublicTransform(original, publicEntry);
      }).not.toThrow();
    });

    it('rejects entry with source_url still present', () => {
      publicEntry.source_url = 'https://example.com';

      expect(() => {
        validateEntryPublicTransform(original, publicEntry);
      }).toThrow(/source_url/);
    });

    it('rejects entry with notes still present', () => {
      publicEntry.notes = 'Secret notes';

      expect(() => {
        validateEntryPublicTransform(original, publicEntry);
      }).toThrow(/notes/);
    });

    it('rejects entry with changed ID', () => {
      publicEntry.id = 'different-id';

      expect(() => {
        validateEntryPublicTransform(original, publicEntry);
      }).toThrow(/entry ID/);
    });

    it('rejects entry with changed pot_id', () => {
      publicEntry.pot_id = 'different-pot';

      expect(() => {
        validateEntryPublicTransform(original, publicEntry);
      }).toThrow(/pot ID/);
    });
  });

  describe('complete workflow', () => {
    it('transforms entry with all sensitive fields', () => {
      const entry: ExportedEntry = {
        id: 'entry-1',
        pot_id: 'pot-1',
        type: 'text',
        content_text: 'Content',
        content_sha256: 'hash',
        capture_method: 'manual',
        source_url: 'https://secret.example.com/private',
        source_title: 'Private Article',
        notes: 'Confidential notes',
        captured_at: 1000,
        created_at: 1000,
        updated_at: 2000,
        client_capture_id: 'unique-client-id',
        source_app: 'Secret App',
        source_context_json: '{"sensitive":"data"}',
        asset_id: 'asset-123',
      };

      const publicEntry = transformEntryToPublic(entry);
      validateEntryPublicTransform(entry, publicEntry);

      // Verify all sensitive fields are null
      expect(publicEntry.source_url).toBeNull();
      expect(publicEntry.source_title).toBeNull();
      expect(publicEntry.notes).toBeNull();
      expect(publicEntry.client_capture_id).toBeNull();
      expect(publicEntry.source_app).toBeNull();
      expect(publicEntry.source_context_json).toBeNull();

      // Content is preserved
      expect(publicEntry.content_text).toBe('Content');
      expect(publicEntry.asset_id).toBe('asset-123');
    });
  });
});
