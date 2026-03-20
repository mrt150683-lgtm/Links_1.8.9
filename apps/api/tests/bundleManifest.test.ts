/**
 * Unit tests for bundle manifest hashing
 */

import { describe, it, expect } from 'vitest';
import {
  hashData,
  createManifestEntry,
  buildManifest,
  verifyManifestHashes,
} from '@links/storage';

describe('bundleManifest', () => {
  describe('hashData', () => {
    it('hashes strings correctly', () => {
      const hash1 = hashData('hello');
      const hash2 = hashData('hello');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('hashes buffers correctly', () => {
      const buf = Buffer.from('hello');
      const hash1 = hashData(buf);
      const hash2 = hashData('hello');
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different inputs', () => {
      const hash1 = hashData('hello');
      const hash2 = hashData('world');
      expect(hash1).not.toBe(hash2);
    });

    it('is consistent for same input', () => {
      const data = 'test data with special chars: 🎉 \n\t';
      const hash1 = hashData(data);
      const hash2 = hashData(data);
      expect(hash1).toBe(hash2);
    });
  });

  describe('createManifestEntry', () => {
    it('creates entry with correct path and size', () => {
      const data = 'test content';
      const entry = createManifestEntry('data/test.json', data);

      expect(entry.path).toBe('data/test.json');
      expect(entry.size_bytes).toBe(data.length);
      expect(entry.sha256).toHaveLength(64);
    });

    it('handles large files', () => {
      const largData = Buffer.alloc(1024 * 1024); // 1MB
      largData.fill('x');
      const entry = createManifestEntry('data/large.bin', largData);

      expect(entry.size_bytes).toBe(largData.length);
      expect(entry.sha256).toHaveLength(64);
    });

    it('handles binary data', () => {
      const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      const entry = createManifestEntry('data/binary.bin', binary);

      expect(entry.size_bytes).toBe(6);
      expect(entry.sha256).toHaveLength(64);
    });
  });

  describe('buildManifest', () => {
    it('builds valid manifest', () => {
      const entries = [
        createManifestEntry('data/entries.json', JSON.stringify([])),
        createManifestEntry('data/assets.json', JSON.stringify([])),
      ];

      const manifest = buildManifest({
        pot_id: '123e4567-e89b-12d3-a456-426614174000',
        pot_name: 'Test Pot',
        export_mode: 'private',
        counts: {
          entries: 0,
          assets: 0,
          artifacts: 0,
          links: 0,
          audit_events: 0,
        },
        entries,
      });

      expect(manifest.version).toBe(1);
      expect(manifest.pot_id).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(manifest.pot_name).toBe('Test Pot');
      expect(manifest.export_mode).toBe('private');
      expect(manifest.files).toHaveLength(2);
      expect(manifest.schema_versions.pot).toBe(1);
      expect(manifest.created_at).toBeGreaterThan(0);
    });

    it('builds public mode manifest', () => {
      const manifest = buildManifest({
        pot_id: '123e4567-e89b-12d3-a456-426614174000',
        pot_name: 'Test Pot',
        export_mode: 'public',
        counts: {
          entries: 5,
          assets: 2,
          artifacts: 3,
          links: 4,
          audit_events: 0,
        },
        entries: [],
      });

      expect(manifest.export_mode).toBe('public');
      expect(manifest.counts.audit_events).toBe(0);
    });
  });

  describe('verifyManifestHashes', () => {
    it('verifies correct manifest', () => {
      const entry1Data = 'entry1';
      const entry2Data = 'entry2';
      const entries = [
        createManifestEntry('file1.json', entry1Data),
        createManifestEntry('file2.json', entry2Data),
      ];

      const manifest = buildManifest({
        pot_id: '123e4567-e89b-12d3-a456-426614174000',
        pot_name: 'Test',
        export_mode: 'private',
        counts: { entries: 0, assets: 0, artifacts: 0, links: 0, audit_events: 0 },
        entries,
      });

      const fileData = new Map([
        ['file1.json', entry1Data],
        ['file2.json', entry2Data],
      ]);

      const result = verifyManifestHashes(manifest, fileData);
      expect(result).toEqual({ ok: true });
    });

    it('detects missing files', () => {
      const entries = [
        createManifestEntry('file1.json', 'data1'),
        createManifestEntry('file2.json', 'data2'),
      ];

      const manifest = buildManifest({
        pot_id: '123e4567-e89b-12d3-a456-426614174000',
        pot_name: 'Test',
        export_mode: 'private',
        counts: { entries: 0, assets: 0, artifacts: 0, links: 0, audit_events: 0 },
        entries,
      });

      const fileData = new Map([['file1.json', 'data1']]);

      const result = verifyManifestHashes(manifest, fileData);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.mismatches).toContainEqual(
          expect.stringContaining('file2.json')
        );
      }
    });

    it('detects hash mismatches (tampering)', () => {
      const entries = [createManifestEntry('file1.json', 'original')];

      const manifest = buildManifest({
        pot_id: '123e4567-e89b-12d3-a456-426614174000',
        pot_name: 'Test',
        export_mode: 'private',
        counts: { entries: 0, assets: 0, artifacts: 0, links: 0, audit_events: 0 },
        entries,
      });

      const fileData = new Map([['file1.json', 'tampered']]);

      const result = verifyManifestHashes(manifest, fileData);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.mismatches).toHaveLength(1);
        expect(result.mismatches[0]).toContain('file1.json');
      }
    });

    it('detects multiple tampering issues', () => {
      const entries = [
        createManifestEntry('file1.json', 'data1'),
        createManifestEntry('file2.json', 'data2'),
        createManifestEntry('file3.json', 'data3'),
      ];

      const manifest = buildManifest({
        pot_id: '123e4567-e89b-12d3-a456-426614174000',
        pot_name: 'Test',
        export_mode: 'private',
        counts: { entries: 0, assets: 0, artifacts: 0, links: 0, audit_events: 0 },
        entries,
      });

      const fileData = new Map([
        ['file1.json', 'tampered1'],
        ['file2.json', 'data2'], // correct
        // file3.json missing
      ]);

      const result = verifyManifestHashes(manifest, fileData);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.mismatches.length).toBeGreaterThanOrEqual(2);
      }
    });
  });
});
