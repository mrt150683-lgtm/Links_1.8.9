import { describe, it, expect } from 'vitest';
import { computeFingerprintSync } from '../fingerprint.js';

describe('fingerprint', () => {
  it('should return a stable 64-character hex string', () => {
    const fp = computeFingerprintSync();
    expect(fp).toMatch(/^[a-f0-9]{64}$/);
    expect(fp.length).toBe(64);
  });

  it('should return the same fingerprint on repeated calls', () => {
    const fp1 = computeFingerprintSync();
    const fp2 = computeFingerprintSync();
    expect(fp1).toBe(fp2);
  });
});
