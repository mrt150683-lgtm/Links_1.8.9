/**
 * Tests: Role Registry (018_pot_role)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalizeRole,
  hashRole,
  lintRole,
  resolveEffectiveRole,
} from '../src/roleRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Temp directory for test role files
const TEST_ROLES_DIR = join(__dirname, '../../.test-roles-tmp');

function setupTestRolesDir() {
  // Create a minimal builtin role structure for tests
  const defaultDir = join(TEST_ROLES_DIR, 'default');
  const forensicDir = join(TEST_ROLES_DIR, 'forensic_analyst');
  mkdirSync(defaultDir, { recursive: true });
  mkdirSync(forensicDir, { recursive: true });

  writeFileSync(
    join(defaultDir, 'v1.md'),
    '# Role\n\nYou are a research assistant.\n\n## Goals\n\nHelp.\n\n## Do\n\nBe accurate.\n\n## Don\'t\n\nInvent facts.'
  );
  writeFileSync(
    join(forensicDir, 'v1.md'),
    '# Role\n\nYou are a forensic analyst.\n\n## Goals\n\nAnalyse evidence.\n\n## Do\n\nBe precise.\n\n## Don\'t\n\nSpeculate.'
  );
}

function teardownTestRolesDir() {
  try {
    rmSync(TEST_ROLES_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

beforeAll(() => {
  setupTestRolesDir();
  process.env.ROLES_DIR = TEST_ROLES_DIR;
});

afterAll(() => {
  delete process.env.ROLES_DIR;
  teardownTestRolesDir();
});

describe('canonicalizeRole', () => {
  it('normalises CRLF to LF', () => {
    const result = canonicalizeRole('line1\r\nline2\r\nline3');
    expect(result).toBe('line1\nline2\nline3');
  });

  it('trims trailing whitespace per line', () => {
    const result = canonicalizeRole('line1   \nline2\t\nline3');
    expect(result).toBe('line1\nline2\nline3');
  });

  it('trims leading and trailing blank lines', () => {
    const result = canonicalizeRole('\n\nhello\n\n');
    expect(result).toBe('hello');
  });
});

describe('hashRole', () => {
  it('produces the same hash for CRLF and LF variants', () => {
    const lf = hashRole('## Goals\nHelp.\n## Do\nBe good.\n## Don\'t\nLie.');
    const crlf = hashRole('## Goals\r\nHelp.\r\n## Do\r\nBe good.\r\n## Don\'t\r\nLie.');
    expect(lf).toBe(crlf);
  });

  it('produces different hashes for different texts', () => {
    const a = hashRole('role text A');
    const b = hashRole('role text B');
    expect(a).not.toBe(b);
  });

  it('returns a 64-character hex string (SHA-256)', () => {
    const hash = hashRole('any role text');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('lintRole', () => {
  it('returns no warnings for a well-formed role', () => {
    const role = '# Role\n\nYou are a researcher.\n\n## Goals\n\nBe helpful.\n\n## Do\n\nCite sources.\n\n## Don\'t\n\nInvent facts.';
    expect(lintRole(role)).toHaveLength(0);
  });

  it('warns when role exceeds 12000 characters', () => {
    const longRole = 'a'.repeat(12001);
    const warnings = lintRole(longRole);
    expect(warnings.some((w) => w.includes('12000'))).toBe(true);
  });

  it('warns when recommended sections are missing', () => {
    const role = '# Role\n\nYou are an assistant.';
    const warnings = lintRole(role);
    expect(warnings.some((w) => w.includes('## Goals'))).toBe(true);
    expect(warnings.some((w) => w.includes('## Do'))).toBe(true);
    expect(warnings.some((w) => w.includes("## Don't"))).toBe(true);
  });
});

describe('resolveEffectiveRole', () => {
  it('returns default role when role_ref is null', async () => {
    const result = await resolveEffectiveRole({ id: 'pot-1', role_ref: null });
    expect(result.source).toBe('default');
    expect(result.ref).toBe('builtin:default');
    expect(result.text).toBeTruthy();
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns default role when role_ref is undefined', async () => {
    const result = await resolveEffectiveRole({ id: 'pot-1' });
    expect(result.source).toBe('default');
  });

  it('loads builtin:forensic_analyst correctly', async () => {
    const result = await resolveEffectiveRole({ id: 'pot-1', role_ref: 'builtin:forensic_analyst' });
    expect(result.source).toBe('builtin');
    expect(result.ref).toBe('builtin:forensic_analyst');
    expect(result.text).toContain('forensic');
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('falls back to default when builtin id is unknown', async () => {
    const result = await resolveEffectiveRole({ id: 'pot-1', role_ref: 'builtin:nonexistent_role' });
    expect(result.source).toBe('default');
  });

  it('falls back to default when user role file is missing', async () => {
    const result = await resolveEffectiveRole({ id: 'no-such-pot', role_ref: 'user:' });
    expect(result.source).toBe('default');
  });

  it('loads user role from file when it exists', async () => {
    const potId = 'test-pot-with-user-role';
    const userRoleDir = join(TEST_ROLES_DIR, 'pot', potId);
    mkdirSync(userRoleDir, { recursive: true });
    writeFileSync(
      join(userRoleDir, 'role.md'),
      '# Role\n\nCustom user role.\n\n## Goals\n\nTest.\n\n## Do\n\nPass.\n\n## Don\'t\n\nFail.'
    );

    const result = await resolveEffectiveRole({ id: potId, role_ref: 'user:' });
    expect(result.source).toBe('user');
    expect(result.text).toContain('Custom user role');
    expect(result.ref).toBe('user:');
  });
});
