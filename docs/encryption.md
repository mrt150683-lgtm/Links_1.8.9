# Encryption

This document describes the encryption scheme used by Links for asset storage at rest.

---

## 1) Primitive

- **Algorithm:** AES-256-GCM (Galois/Counter Mode)
- **Key size:** 256 bits (32 bytes)
- **Nonce size:** 96 bits (12 bytes), randomly generated per asset
- **Auth tag size:** 128 bits (16 bytes)

AES-256-GCM is an AEAD (Authenticated Encryption with Associated Data) cipher that provides both confidentiality and integrity in a single operation.

---

## 2) Blob format

Each encrypted asset is stored as a binary blob with the following layout:

```
[version: 1 byte][nonce: 12 bytes][ciphertext: variable][tag: 16 bytes]
```

| Field      | Size (bytes) | Description                                      |
|------------|--------------|--------------------------------------------------|
| version    | 1            | Encryption format version (currently `0x01`)     |
| nonce      | 12           | Random nonce unique to this asset                |
| ciphertext | variable     | Encrypted file content                           |
| tag        | 16           | GCM authentication tag for tamper detection       |

**Total overhead:** 29 bytes per asset (1 + 12 + 16).

---

## 3) Key management

### Current implementation (Phase 4)

- The encryption key is provided via the `ENCRYPTION_KEY` environment variable.
- Format: 64 hexadecimal characters (representing 32 bytes).
- The key is validated at startup; the server refuses to start if the key is missing or malformed.

### Key generation

Generate a suitable key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Or on Linux/macOS:

```bash
openssl rand -hex 32
```

### Key storage best practices

- Never commit the encryption key to source control.
- Store in environment variables, OS keychain, or a secrets manager.
- Restrict file permissions on any `.env` file containing the key.
- Rotate keys if compromise is suspected (see Future section).

---

## 4) Nonce generation

- Each asset receives a fresh 12-byte nonce generated via `crypto.randomBytes(12)`.
- The nonce is stored as part of the blob (bytes 1-12), not separately.
- With random 96-bit nonces and AES-256-GCM, the collision probability remains negligible for up to ~2^32 encryptions under the same key.

---

## 5) Tamper detection

- AES-256-GCM produces an authentication tag (16 bytes) appended to the ciphertext.
- On decryption, the GCM auth tag is verified before any plaintext is returned.
- If any byte of the blob (version, nonce, ciphertext, or tag) has been modified, decryption fails with an authentication error.
- This provides tamper detection without requiring a separate HMAC or manifest hash.

---

## 6) Threat model

### What encryption at rest protects against

- **Disk theft:** An attacker with physical access to the storage directory cannot read asset contents without the encryption key.
- **Unauthorized file access:** Another process or user on the same machine cannot read assets without the key.
- **Backup exposure:** Copies of the data directory (backups, cloud sync) remain encrypted.

### What encryption at rest does NOT protect against

- **Key compromise:** If the `ENCRYPTION_KEY` is leaked, all assets encrypted with that key are exposed.
- **Memory attacks:** An attacker with access to the running process memory can read decrypted content.
- **Authorized API access:** Anyone who can reach the API on `127.0.0.1` can request decrypted assets through the API endpoints.

---

## 7) Future enhancements

- **Key rotation:** Support re-encrypting assets under a new key. The `encryption_version` column in the assets table enables tracking which key version encrypted each asset.
- **Argon2id key derivation:** Derive the encryption key from a user passphrase using Argon2id, removing the need to store or manage a raw key.
- **Per-pot envelope encryption:** Each pot gets its own data encryption key (DEK), wrapped by a master key encryption key (KEK). This enables per-pot access control and selective key rotation.
- **XChaCha20-Poly1305:** Alternative AEAD cipher with a 192-bit nonce, further reducing nonce collision risk for high-volume workloads.

---
