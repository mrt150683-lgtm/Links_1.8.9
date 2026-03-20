import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runDoctor } from '../../cli/commands/doctor.js';
import { _resetConfig } from '../../config/load.js';

describe('doctor command', () => {
  beforeEach(() => {
    _resetConfig();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    _resetConfig();
  });

  it('returns ok=true with empty env (Phase 1: no fatal checks beyond config)', () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    vi.stubEnv('OPENROUTER_API_KEY', '');
    vi.stubEnv('CS_DB_PATH', '');
    vi.stubEnv('CS_LOG_LEVEL', 'info');

    const result = runDoctor();

    expect(result.ok).toBe(true);
    const names = result.checks.map((c) => c.name);
    expect(names).toContain('config');
    expect(names).toContain('db');
    expect(names).toContain('github_auth');
    expect(names).toContain('openrouter_auth');
  });

  it('config check is ok=true when config validates', () => {
    vi.stubEnv('CS_LOG_LEVEL', 'info');

    const result = runDoctor();
    const configCheck = result.checks.find((c) => c.name === 'config');
    expect(configCheck?.ok).toBe(true);
  });

  it('db check reports not initialized when CS_DB_PATH is not set', () => {
    vi.stubEnv('CS_LOG_LEVEL', 'info');

    const result = runDoctor();
    const dbCheck = result.checks.find((c) => c.name === 'db');
    expect(dbCheck?.ok).toBe(false);
    expect(dbCheck?.message).toMatch(/not initialized/i);
    expect(dbCheck?.fatal).toBe(false);
  });

  it('github_auth check is non-fatal when GITHUB_TOKEN missing', () => {
    vi.stubEnv('CS_LOG_LEVEL', 'info');

    const result = runDoctor();
    const check = result.checks.find((c) => c.name === 'github_auth');
    expect(check?.ok).toBe(false);
    expect(check?.fatal).toBe(false);
  });

  it('openrouter_auth check is non-fatal when OPENROUTER_API_KEY missing', () => {
    vi.stubEnv('CS_LOG_LEVEL', 'info');

    const result = runDoctor();
    const check = result.checks.find((c) => c.name === 'openrouter_auth');
    expect(check?.ok).toBe(false);
    expect(check?.fatal).toBe(false);
  });

  it('github_auth check is ok=true when GITHUB_TOKEN is set', () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test');
    vi.stubEnv('CS_LOG_LEVEL', 'info');

    const result = runDoctor();
    const check = result.checks.find((c) => c.name === 'github_auth');
    expect(check?.ok).toBe(true);
  });
});
