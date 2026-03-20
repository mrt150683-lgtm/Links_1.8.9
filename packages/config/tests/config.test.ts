import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig, resetConfig } from '../src/index.js';

describe('config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
  });

  it('should load default config', () => {
    // Vitest sets NODE_ENV=test, so we delete it to test the default
    delete process.env.NODE_ENV;
    const config = getConfig();

    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3000);
    expect(config.HOST).toBe('127.0.0.1');
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('should parse PORT as number', () => {
    process.env.PORT = '8080';
    const config = getConfig();

    expect(config.PORT).toBe(8080);
  });

  it('should use environment variables when present', () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '4000';
    process.env.HOST = '0.0.0.0';
    process.env.LOG_LEVEL = 'warn';

    const config = getConfig();

    expect(config.NODE_ENV).toBe('production');
    expect(config.PORT).toBe(4000);
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.LOG_LEVEL).toBe('warn');
  });

  it('should cache config after first load', () => {
    const config1 = getConfig();
    process.env.PORT = '9999';
    const config2 = getConfig();

    expect(config1.PORT).toBe(config2.PORT);
  });

  it('should throw on invalid LOG_LEVEL', () => {
    process.env.LOG_LEVEL = 'invalid';

    expect(() => getConfig()).toThrow('Configuration validation failed');
  });
});
