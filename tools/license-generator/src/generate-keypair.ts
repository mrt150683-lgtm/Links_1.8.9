#!/usr/bin/env node
/**
 * Generate a new Ed25519 keypair for Links licensing
 *
 * Usage:
 *   pnpm run generate-keypair
 *
 * Output:
 *   - Prints private key (DER base64) — keep secret, never commit
 *   - Prints public key (hex) — paste into packages/licensing/src/keys.ts
 */

import { generateKeyPairSync } from 'crypto';

function generateKeypair() {
  console.log('\n=== Links License Keypair Generator ===\n');

  // Generate Ed25519 keypair using Node.js crypto
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  // Convert to base64 for private key (used in signing)
  const privkeyBase64 = (privateKey as Buffer).toString('base64');

  // Convert public key DER to hex
  const pubkeyHex = (publicKey as Buffer).toString('hex');

  console.log('PRIVATE KEY (base64) — Keep SECRET, never commit:');
  console.log(privkeyBase64);
  console.log('');

  console.log('PUBLIC KEY (hex) — Paste into packages/licensing/src/keys.ts:');
  console.log(pubkeyHex);
  console.log('');

  console.log('Next steps:');
  console.log('1. Save the PRIVATE KEY securely (encrypted storage, secure enclave, etc.)');
  console.log('2. Paste the PUBLIC KEY into packages/licensing/src/keys.ts');
  console.log('3. Use the private key with sign-license.ts to sign license requests');
  console.log('');
}

generateKeypair();
