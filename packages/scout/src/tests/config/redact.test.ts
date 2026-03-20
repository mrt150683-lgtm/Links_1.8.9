import { describe, it, expect } from 'vitest';
import { redactSecrets, redactValue } from '../../config/redact.js';

describe('redactSecrets', () => {
  it('redacts token values by key name', () => {
    const input = { GITHUB_TOKEN: 'abc123', foo: 'bar' };
    const result = redactSecrets(input) as Record<string, unknown>;
    expect(result['GITHUB_TOKEN']).toBe('***REDACTED***');
    expect(result['foo']).toBe('bar');
  });

  it('redacts key variants: KEY, SECRET, PASSWORD, AUTHORIZATION', () => {
    const input = {
      API_KEY: 'my-key',
      MY_SECRET: 'shh',
      PASSWORD: 'hunter2',
      Authorization: 'Bearer token',
    };
    const result = redactSecrets(input) as Record<string, unknown>;
    expect(result['API_KEY']).toBe('***REDACTED***');
    expect(result['MY_SECRET']).toBe('***REDACTED***');
    expect(result['PASSWORD']).toBe('***REDACTED***');
    expect(result['Authorization']).toBe('***REDACTED***');
  });

  it('does not redact unrelated keys', () => {
    const input = { username: 'alice', repo: 'my-repo', count: 5 };
    const result = redactSecrets(input) as Record<string, unknown>;
    expect(result['username']).toBe('alice');
    expect(result['repo']).toBe('my-repo');
    expect(result['count']).toBe(5);
  });

  it('handles nested objects recursively', () => {
    const input = { outer: { GITHUB_TOKEN: 'xyz', name: 'test' } };
    const result = redactSecrets(input) as { outer: Record<string, unknown> };
    expect(result.outer['GITHUB_TOKEN']).toBe('***REDACTED***');
    expect(result.outer['name']).toBe('test');
  });

  it('handles arrays', () => {
    const input = [{ GITHUB_TOKEN: 'abc' }, { name: 'test' }];
    const result = redactSecrets(input) as Array<Record<string, unknown>>;
    expect(result[0]?.['GITHUB_TOKEN']).toBe('***REDACTED***');
    expect(result[1]?.['name']).toBe('test');
  });

  it('passes through null and primitives', () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets('hello')).toBe('hello');
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(true)).toBe(true);
  });

  it('does not redact empty string values', () => {
    const input = { GITHUB_TOKEN: '' };
    const result = redactSecrets(input) as Record<string, unknown>;
    expect(result['GITHUB_TOKEN']).toBe('');
  });
});

describe('redactValue', () => {
  it('redacts when key matches pattern', () => {
    expect(redactValue('GITHUB_TOKEN', 'abc')).toBe('***REDACTED***');
    expect(redactValue('API_KEY', 'xyz')).toBe('***REDACTED***');
  });

  it('passes through when key does not match', () => {
    expect(redactValue('username', 'alice')).toBe('alice');
  });
});
