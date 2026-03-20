/**
 * Unit tests for bundle encryption (Argon2id + XChaCha20-Poly1305)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  initSodium,
  generateKdfParams,
  deriveKeyFromPassphrase,
  encryptBundleBlob,
  decryptBundleBlob,
  encryptWithPassphrase,
  decryptWithPassphrase,
} from '@links/storage';

describe('bundleEncryption', () => {
  beforeAll(async () => {
    await initSodium();
  });

  describe('KDF (Argon2id)', () => {
    it('generates KDF parameters with random salt', () => {
      const params1 = generateKdfParams();
      const params2 = generateKdfParams();

      // Both should be valid
      expect(params1.salt).toHaveLength(88); // Base64 of 64 bytes
      expect(params2.salt).toHaveLength(88);
      expect(params1.ops_limit).toBeGreaterThan(0);
      expect(params1.mem_limit).toBeGreaterThan(0);

      // Salts should be different
      expect(params1.salt).not.toBe(params2.salt);
    });

    it('derives key from passphrase consistently', () => {
      const passphrase = 'test-passphrase-123';
      const params = generateKdfParams();

      const key1 = deriveKeyFromPassphrase(passphrase, params);
      const key2 = deriveKeyFromPassphrase(passphrase, params);

      expect(key1).toEqual(key2);
      expect(key1.length).toBe(32);
    });

    it('produces different keys for different passphrases', () => {
      const params = generateKdfParams();

      const key1 = deriveKeyFromPassphrase('passphrase-1', params);
      const key2 = deriveKeyFromPassphrase('passphrase-2', params);

      expect(key1).not.toEqual(key2);
    });

    it('produces different keys for different salts', () => {
      const passphrase = 'same-passphrase';
      const params1 = generateKdfParams();
      const params2 = generateKdfParams();

      const key1 = deriveKeyFromPassphrase(passphrase, params1);
      const key2 = deriveKeyFromPassphrase(passphrase, params2);

      expect(key1).not.toEqual(key2);
    });
  });

  describe('Encryption/Decryption', () => {
    it('encrypts and decrypts plaintext correctly', () => {
      const plaintext = Buffer.from('Hello, World!');
      const key = Buffer.alloc(32);
      key.fill('k'); // 32 bytes of 'k'

      const encrypted = encryptBundleBlob(plaintext, key);
      const decrypted = decryptBundleBlob(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });

    it('produces different ciphertexts for same plaintext (random nonce)', () => {
      const plaintext = Buffer.from('Same message');
      const key = Buffer.alloc(32);
      key.fill('k');

      const encrypted1 = encryptBundleBlob(plaintext, key);
      const encrypted2 = encryptBundleBlob(plaintext, key);

      expect(encrypted1).not.toEqual(encrypted2);
      // Both should decrypt to same plaintext
      expect(decryptBundleBlob(encrypted1, key)).toEqual(plaintext);
      expect(decryptBundleBlob(encrypted2, key)).toEqual(plaintext);
    });

    it('handles large plaintext', () => {
      const plaintext = Buffer.alloc(10 * 1024 * 1024); // 10MB
      plaintext.fill('x');
      const key = Buffer.alloc(32);
      key.fill('k');

      const encrypted = encryptBundleBlob(plaintext, key);
      const decrypted = decryptBundleBlob(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });

    it('detects tampering (modified ciphertext)', () => {
      const plaintext = Buffer.from('Secret message');
      const key = Buffer.alloc(32);
      key.fill('k');

      const encrypted = encryptBundleBlob(plaintext, key);

      // Flip a bit in the ciphertext (skip nonce bytes)
      const tampered = Buffer.from(encrypted);
      tampered[32] ^= 0x01; // Flip one bit after nonce

      expect(() => decryptBundleBlob(tampered, key)).toThrow(
        /authentication tag verification failed/i
      );
    });

    it('detects tampering (modified nonce)', () => {
      const plaintext = Buffer.from('Secret message');
      const key = Buffer.alloc(32);
      key.fill('k');

      const encrypted = encryptBundleBlob(plaintext, key);

      // Flip a bit in the nonce
      const tampered = Buffer.from(encrypted);
      tampered[0] ^= 0x01;

      expect(() => decryptBundleBlob(tampered, key)).toThrow(
        /authentication tag verification failed/i
      );
    });

    it('rejects wrong key', () => {
      const plaintext = Buffer.from('Secret');
      const key1 = Buffer.alloc(32);
      key1.fill('a');
      const key2 = Buffer.alloc(32);
      key2.fill('b');

      const encrypted = encryptBundleBlob(plaintext, key1);

      expect(() => decryptBundleBlob(encrypted, key2)).toThrow(
        /authentication tag verification failed/i
      );
    });

    it('validates key length', () => {
      const plaintext = Buffer.from('Data');
      const badKey = Buffer.alloc(16); // Wrong size

      expect(() => encryptBundleBlob(plaintext, badKey)).toThrow(/32 bytes/);
    });

    it('handles empty plaintext', () => {
      const plaintext = Buffer.alloc(0);
      const key = Buffer.alloc(32);
      key.fill('k');

      const encrypted = encryptBundleBlob(plaintext, key);
      const decrypted = decryptBundleBlob(encrypted, key);

      expect(decrypted.length).toBe(0);
    });
  });

  describe('End-to-end (passphrase)', () => {
    it('encrypts and decrypts with passphrase', () => {
      const plaintext = Buffer.from('Sensitive data');
      const passphrase = 'my-secure-passphrase-123';

      const { blob, params } = encryptWithPassphrase(plaintext, passphrase);
      const decrypted = decryptWithPassphrase(blob, passphrase, params);

      expect(decrypted).toEqual(plaintext);
    });

    it('rejects wrong passphrase', () => {
      const plaintext = Buffer.from('Secret');
      const passphrase1 = 'correct-passphrase';
      const passphrase2 = 'wrong-passphrase';

      const { blob, params } = encryptWithPassphrase(plaintext, passphrase1);

      expect(() => decryptWithPassphrase(blob, passphrase2, params)).toThrow(
        /authentication tag verification failed/i
      );
    });

    it('accepts pre-computed KDF parameters', () => {
      const plaintext = Buffer.from('Data');
      const passphrase = 'passphrase';
      const params = generateKdfParams();

      const { blob } = encryptWithPassphrase(plaintext, passphrase, params);
      const decrypted = decryptWithPassphrase(blob, passphrase, params);

      expect(decrypted).toEqual(plaintext);
    });

    it('handles special characters in passphrase', () => {
      const plaintext = Buffer.from('Test');
      const passphrase = '🔐 Special chars: @#$%^&*() ñ 中文';

      const { blob, params } = encryptWithPassphrase(plaintext, passphrase);
      const decrypted = decryptWithPassphrase(blob, passphrase, params);

      expect(decrypted).toEqual(plaintext);
    });

    it('produces different results with different passphrases', () => {
      const plaintext = Buffer.from('Same data');

      const { blob: blob1, params: params1 } = encryptWithPassphrase(
        plaintext,
        'pass1'
      );
      const { blob: blob2, params: params2 } = encryptWithPassphrase(
        plaintext,
        'pass2'
      );

      // Blobs should be different (different salts + different derived keys)
      expect(blob1).not.toEqual(blob2);
      expect(params1.salt).not.toBe(params2.salt);
    });
  });

  describe('Error handling', () => {
    it('rejects blob too short for nonce', () => {
      const shortBlob = Buffer.alloc(10);
      const key = Buffer.alloc(32);

      expect(() => decryptBundleBlob(shortBlob, key)).toThrow(/too short/i);
    });

    it('rejects empty blob', () => {
      const emptyBlob = Buffer.alloc(0);
      const key = Buffer.alloc(32);

      expect(() => decryptBundleBlob(emptyBlob, key)).toThrow(/too short|no payload/i);
    });
  });
});
