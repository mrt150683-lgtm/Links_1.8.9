/**
 * Unit tests for ID remapping
 */

import { describe, it, expect } from 'vitest';
import { IdRemapper } from '@links/storage';

describe('IdRemapper', () => {
  describe('construction', () => {
    it('creates remapper with old and new pot IDs', () => {
      const oldPotId = '123e4567-e89b-12d3-a456-426614174000';
      const newPotId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

      const remapper = new IdRemapper(oldPotId, newPotId);

      expect(remapper.getOldPotId()).toBe(oldPotId);
      expect(remapper.getNewPotId()).toBe(newPotId);
    });

    it('generates new pot ID if not provided', () => {
      const oldPotId = '123e4567-e89b-12d3-a456-426614174000';
      const remapper = new IdRemapper(oldPotId);

      expect(remapper.getNewPotId()).toBeTruthy();
      expect(remapper.getNewPotId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('generates different pot IDs for different remappers', () => {
      const oldPotId = '123e4567-e89b-12d3-a456-426614174000';
      const remapper1 = new IdRemapper(oldPotId);
      const remapper2 = new IdRemapper(oldPotId);

      expect(remapper1.getNewPotId()).not.toBe(remapper2.getNewPotId());
    });
  });

  describe('entry mapping', () => {
    let remapper: IdRemapper;

    beforeEach(() => {
      remapper = new IdRemapper('old-pot');
    });

    it('registers and remaps entry IDs', () => {
      const oldId = 'old-entry-1';
      const newId = 'new-entry-1';

      remapper.registerEntry(oldId, newId);
      expect(remapper.remapEntry(oldId)).toBe(newId);
    });

    it('throws on unmapped entry ID', () => {
      expect(() => remapper.remapEntry('unmapped-entry')).toThrow(
        /Entry ID not mapped/
      );
    });

    it('generates new entry IDs', () => {
      const oldId = 'old-entry-1';
      const newId = remapper.generateEntry(oldId);

      expect(newId).toBeTruthy();
      expect(remapper.remapEntry(oldId)).toBe(newId);
    });

    it('generates entry ID without registering', () => {
      const newId = remapper.generateEntry();
      expect(newId).toBeTruthy();

      expect(() => remapper.remapEntry(newId)).toThrow();
    });
  });

  describe('asset mapping', () => {
    let remapper: IdRemapper;

    beforeEach(() => {
      remapper = new IdRemapper('old-pot');
    });

    it('registers and remaps asset IDs', () => {
      const oldId = 'old-asset-1';
      const newId = 'new-asset-1';

      remapper.registerAsset(oldId, newId);
      expect(remapper.remapAssetNonNull(oldId)).toBe(newId);
    });

    it('returns null for unmapped asset (nullable)', () => {
      const result = remapper.remapAsset('unmapped-asset');
      expect(result).toBeNull();
    });

    it('throws on unmapped asset when using nonNull', () => {
      expect(() => remapper.remapAssetNonNull('unmapped-asset')).toThrow();
    });

    it('generates new asset IDs', () => {
      const oldId = 'old-asset-1';
      const newId = remapper.generateAsset(oldId);

      expect(remapper.remapAssetNonNull(oldId)).toBe(newId);
    });
  });

  describe('artifact mapping', () => {
    let remapper: IdRemapper;

    beforeEach(() => {
      remapper = new IdRemapper('old-pot');
    });

    it('registers and remaps artifact IDs', () => {
      const oldId = 'old-artifact-1';
      const newId = 'new-artifact-1';

      remapper.registerArtifact(oldId, newId);
      expect(remapper.remapArtifact(oldId)).toBe(newId);
    });

    it('generates new artifact IDs', () => {
      const oldId = 'old-artifact-1';
      const newId = remapper.generateArtifact(oldId);

      expect(remapper.remapArtifact(oldId)).toBe(newId);
    });
  });

  describe('link mapping', () => {
    let remapper: IdRemapper;

    beforeEach(() => {
      remapper = new IdRemapper('old-pot');
    });

    it('registers and remaps link IDs', () => {
      const oldId = 'old-link-1';
      const newId = 'new-link-1';

      remapper.registerLink(oldId, newId);
      expect(remapper.remapLink(oldId)).toBe(newId);
    });

    it('generates new link IDs', () => {
      const oldId = 'old-link-1';
      const newId = remapper.generateLink(oldId);

      expect(remapper.remapLink(oldId)).toBe(newId);
    });
  });

  describe('bulk operations', () => {
    let remapper: IdRemapper;

    beforeEach(() => {
      remapper = new IdRemapper('old-pot-id', 'new-pot-id');
      remapper.registerEntry('old-entry-1', 'new-entry-1');
      remapper.registerAsset('old-asset-1', 'new-asset-1');
      remapper.registerArtifact('old-artifact-1', 'new-artifact-1');
    });

    it('remaps entry record', () => {
      const entry = {
        pot_id: 'old-pot-id',
        asset_id: 'old-asset-1',
      };

      remapper.remapEntryRecord(entry);

      expect(entry.pot_id).toBe('new-pot-id');
      expect(entry.asset_id).toBe('new-asset-1');
    });

    it('remaps entry record with null asset', () => {
      const entry = {
        pot_id: 'old-pot-id',
        asset_id: null,
      };

      remapper.remapEntryRecord(entry);

      expect(entry.pot_id).toBe('new-pot-id');
      expect(entry.asset_id).toBeNull();
    });

    it('remaps artifact record', () => {
      const artifact = {
        pot_id: 'old-pot-id',
        entry_id: 'old-entry-1',
      };

      remapper.remapArtifactRecord(artifact);

      expect(artifact.pot_id).toBe('new-pot-id');
      expect(artifact.entry_id).toBe('new-entry-1');
    });

    it('remaps link record', () => {
      remapper.registerEntry('old-entry-2', 'new-entry-2');

      const link = {
        pot_id: 'old-pot-id',
        src_entry_id: 'old-entry-1',
        dst_entry_id: 'old-entry-2',
      };

      remapper.remapLinkRecord(link);

      expect(link.pot_id).toBe('new-pot-id');
      expect(link.src_entry_id).toBe('new-entry-1');
      expect(link.dst_entry_id).toBe('new-entry-2');
    });

    it('remaps audit record', () => {
      const audit = {
        pot_id: 'old-pot-id',
        entry_id: 'old-entry-1',
      };

      remapper.remapAuditRecord(audit);

      expect(audit.pot_id).toBe('new-pot-id');
      expect(audit.entry_id).toBe('new-entry-1');
    });

    it('handles null entry_id in audit record', () => {
      const audit = {
        pot_id: 'old-pot-id',
        entry_id: null,
      };

      remapper.remapAuditRecord(audit);

      expect(audit.pot_id).toBe('new-pot-id');
      expect(audit.entry_id).toBeNull();
    });
  });

  describe('statistics', () => {
    it('tracks mapping counts', () => {
      const remapper = new IdRemapper('old-pot');

      remapper.registerEntry('e1', 'ne1');
      remapper.registerEntry('e2', 'ne2');
      remapper.registerAsset('a1', 'na1');
      remapper.registerArtifact('ar1', 'nar1');
      remapper.registerLink('l1', 'nl1');

      const stats = remapper.getStats();

      expect(stats.entries).toBe(2);
      expect(stats.assets).toBe(1);
      expect(stats.artifacts).toBe(1);
      expect(stats.links).toBe(1);
    });

    it('starts with empty stats', () => {
      const remapper = new IdRemapper('old-pot');
      const stats = remapper.getStats();

      expect(stats.entries).toBe(0);
      expect(stats.assets).toBe(0);
      expect(stats.artifacts).toBe(0);
      expect(stats.links).toBe(0);
    });
  });
});
