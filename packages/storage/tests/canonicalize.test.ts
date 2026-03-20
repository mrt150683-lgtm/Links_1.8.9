import { describe, it, expect } from 'vitest';
import { canonicalizeText, hashText } from '../src/canonicalize.js';

describe('canonicalizeText', () => {
  it('should normalize CRLF to LF', () => {
    const input = 'line1\r\nline2\r\nline3';
    const expected = 'line1\nline2\nline3';
    expect(canonicalizeText(input)).toBe(expected);
  });

  it('should trim trailing whitespace from each line', () => {
    const input = 'line1   \nline2\t\t\nline3  ';
    const expected = 'line1\nline2\nline3';
    expect(canonicalizeText(input)).toBe(expected);
  });

  it('should collapse 3+ consecutive blank lines to 2', () => {
    const input = 'line1\n\n\n\n\nline2';
    const expected = 'line1\n\nline2';
    expect(canonicalizeText(input)).toBe(expected);
  });

  it('should trim overall leading and trailing whitespace', () => {
    const input = '\n\n  hello world  \n\n';
    const expected = 'hello world';
    expect(canonicalizeText(input)).toBe(expected);
  });

  it('should handle all transformations together', () => {
    const input = '\r\n\r\nline1   \r\n\r\n\r\n\r\nline2\t\r\n\r\n';
    const expected = 'line1\n\nline2';
    expect(canonicalizeText(input)).toBe(expected);
  });

  it('should preserve single blank lines', () => {
    const input = 'line1\n\nline2\n\nline3';
    const expected = 'line1\n\nline2\n\nline3';
    expect(canonicalizeText(input)).toBe(expected);
  });

  it('should preserve double blank lines', () => {
    const input = 'line1\n\n\nline2';
    const expected = 'line1\n\nline2';
    expect(canonicalizeText(input)).toBe(expected);
  });
});

describe('hashText', () => {
  it('should produce consistent hash for identical text', () => {
    const text = 'Hello, world!';
    const hash1 = hashText(text);
    const hash2 = hashText(text);
    expect(hash1).toBe(hash2);
  });

  it('should produce same hash for text with different line endings', () => {
    const unix = 'line1\nline2\nline3';
    const windows = 'line1\r\nline2\r\nline3';
    const mixed = 'line1\r\nline2\nline3';

    const hash1 = hashText(unix);
    const hash2 = hashText(windows);
    const hash3 = hashText(mixed);

    expect(hash1).toBe(hash2);
    expect(hash1).toBe(hash3);
  });

  it('should produce same hash for text with different trailing whitespace', () => {
    const text1 = 'line1   \nline2\t\nline3  ';
    const text2 = 'line1\nline2\nline3';

    expect(hashText(text1)).toBe(hashText(text2));
  });

  it('should produce same hash for text with different blank line counts', () => {
    const text1 = 'line1\n\n\n\n\nline2';
    const text2 = 'line1\n\n\nline2';
    const text3 = 'line1\n\nline2';

    const hash1 = hashText(text1);
    const hash2 = hashText(text2);
    const hash3 = hashText(text3);

    expect(hash1).toBe(hash2);
    expect(hash1).toBe(hash3);
  });

  it('should produce different hash for different content', () => {
    const text1 = 'Hello, world!';
    const text2 = 'Goodbye, world!';

    expect(hashText(text1)).not.toBe(hashText(text2));
  });

  it('should return lowercase hex string of 64 characters', () => {
    const hash = hashText('test');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should produce known hash for empty string', () => {
    // SHA-256 of empty string
    const expected = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(hashText('')).toBe(expected);
  });

  it('should handle unicode text correctly', () => {
    const text = '你好，世界！🌍';
    const hash1 = hashText(text);
    const hash2 = hashText(text);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });
});
