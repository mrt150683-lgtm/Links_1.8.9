/**
 * Unit tests for encryption module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encryptBlob,
  decryptBlob,
  parseBlobHeader,
  getEncryptionOverhead,
  clearEncryptionKeyCache,
} from '../src/encryption.js';

describe('encryption', () => {
  beforeEach(() => {
    // Ensure test uses a known key
    process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes
    clearEncryptionKeyCache();
  });

  afterEach(() => {
    clearEncryptionKeyCache();
  });

  describe('encryptBlob / decryptBlob', () => {
    it('should encrypt and decrypt roundtrip successfully', () => {
      const plaintext = Buffer.from('Hello, secure world!');
      const encrypted = encryptBlob(plaintext);
      const decrypted = decryptBlob(encrypted);

      expect(decrypted.toString()).toBe('Hello, secure world!');
    });

    it('should produce different ciphertexts for same plaintext (random nonce)', () => {
      const plaintext = Buffer.from('test data');
      const encrypted1 = encryptBlob(plaintext);
      const encrypted2 = encryptBlob(plaintext);

      // Different nonces mean different ciphertexts
      expect(encrypted1.equals(encrypted2)).toBe(false);

      // But both decrypt to same plaintext
      expect(decryptBlob(encrypted1).equals(plaintext)).toBe(true);
      expect(decryptBlob(encrypted2).equals(plaintext)).toBe(true);
    });

    it('should handle empty buffer', () => {
      const plaintext = Buffer.alloc(0);
      const encrypted = encryptBlob(plaintext);
      const decrypted = decryptBlob(encrypted);

      expect(decrypted.length).toBe(0);
    });

    it('should handle large buffer', () => {
      const plaintext = Buffer.alloc(1024 * 1024, 'x'); // 1MB
      const encrypted = encryptBlob(plaintext);
      const decrypted = decryptBlob(encrypted);

      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it('should add correct overhead size', () => {
      const plaintext = Buffer.from('test');
      const encrypted = encryptBlob(plaintext);
      const expectedSize = plaintext.length + getEncryptionOverhead();

      expect(encrypted.length).toBe(expectedSize);
    });
  });

  describe('tamper detection', () => {
    it('should detect tampered ciphertext', () => {
      const plaintext = Buffer.from('sensitive data');
      const encrypted = encryptBlob(plaintext);

      // Corrupt a byte in the ciphertext section (after version+nonce, before tag)
      const tampered = Buffer.from(encrypted);
      tampered[20] ^= 0xff; // Flip bits in middle

      expect(() => decryptBlob(tampered)).toThrow('tampered or corrupted');
    });

    it('should detect tampered auth tag', () => {
      const plaintext = Buffer.from('sensitive data');
      const encrypted = encryptBlob(plaintext);

      // Corrupt a byte in the auth tag (last 16 bytes)
      const tampered = Buffer.from(encrypted);
      tampered[tampered.length - 1] ^= 0xff;

      expect(() => decryptBlob(tampered)).toThrow('tampered or corrupted');
    });

    it('should detect truncated blob', () => {
      const plaintext = Buffer.from('test');
      const encrypted = encryptBlob(plaintext);

      // Truncate blob
      const truncated = encrypted.subarray(0, 20);

      expect(() => decryptBlob(truncated)).toThrow('Blob too small');
    });
  });

  describe('parseBlobHeader', () => {
    it('should parse version and nonce without decrypting', () => {
      const plaintext = Buffer.from('test data');
      const encrypted = encryptBlob(plaintext);

      const header = parseBlobHeader(encrypted);

      expect(header.version).toBe(1);
      expect(header.nonce).toBeInstanceOf(Buffer);
      expect(header.nonce.length).toBe(12);
    });

    it('should reject malformed blob', () => {
      const tooSmall = Buffer.alloc(10);
      expect(() => parseBlobHeader(tooSmall)).toThrow('Blob too small');
    });
  });

  describe('version mismatch', () => {
    it('should reject unsupported version', () => {
      const plaintext = Buffer.from('test');
      const encrypted = encryptBlob(plaintext);

      // Change version byte to 2
      const wrongVersion = Buffer.from(encrypted);
      wrongVersion[0] = 2;

      expect(() => decryptBlob(wrongVersion)).toThrow('Unsupported encryption version: 2');
    });
  });

  describe('getEncryptionOverhead', () => {
    it('should return correct overhead size', () => {
      const overhead = getEncryptionOverhead();
      expect(overhead).toBe(29); // 1 (version) + 12 (nonce) + 16 (tag)
    });
  });
});
