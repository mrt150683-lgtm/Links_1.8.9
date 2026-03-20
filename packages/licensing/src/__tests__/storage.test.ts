import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readLicenseFile, writeLicenseFile } from '../storage.js';
import type { StoredLicense } from '../schemas.js';

describe('storage', () => {
  let tmpDir: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    tmpDir = mkdtempSync(join(tmpdir(), 'links-license-test-'));
    // Set env var to use temp directory
    process.env.LINKS_LICENSE_DIR = tmpDir;
  });

  afterEach(() => {
    // Clean up
    delete process.env.LINKS_LICENSE_DIR;
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should return null when license file does not exist', () => {
    const license = readLicenseFile();
    expect(license).toBeNull();
  });

  it('should write and read license file', () => {
    const testLicense: StoredLicense = {
      payload: {
        schema: 1,
        kid: 'test-key',
        product: 'links',
        license_id: '550e8400-e29b-41d4-a716-446655440000',
        issued_at: 1234567890,
        expires_at: 1234567890 + 1000 * 60 * 60 * 24 * 365,
        tier: 'pro',
        fingerprint_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        customer_ref: 'CUST-123',
      },
      signature:
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      kid: 'test-key',
    };

    // Write
    writeLicenseFile(testLicense);

    // Read back
    const read = readLicenseFile();
    expect(read).toEqual(testLicense);
  });

  it('should create directory if it does not exist', () => {
    const testLicense: StoredLicense = {
      payload: {
        schema: 1,
        kid: 'test-key',
        product: 'links',
        license_id: '550e8400-e29b-41d4-a716-446655440000',
        issued_at: 1234567890,
        expires_at: null,
        tier: 'basic',
        fingerprint_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      signature:
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      kid: 'test-key',
    };

    const nestedTmpDir = join(tmpDir, 'nested', 'dir');
    process.env.LINKS_LICENSE_DIR = nestedTmpDir;

    // This should create the directory
    writeLicenseFile(testLicense);

    // And should be able to read it back
    const read = readLicenseFile();
    expect(read).toEqual(testLicense);
  });

  it('should return null on malformed JSON', () => {
    const licenseDir = process.env.LINKS_LICENSE_DIR;
    if (!licenseDir) throw new Error('LINKS_LICENSE_DIR not set');

    const { writeFileSync } = require('fs');
    writeFileSync(join(licenseDir, 'license.lic'), 'not valid json {');

    const license = readLicenseFile();
    expect(license).toBeNull();
  });
});
