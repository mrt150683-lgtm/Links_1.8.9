#!/usr/bin/env node
/**
 * Generate Ed25519 keypair - Standalone version
 * Uses ONLY Node.js built-in modules (no external dependencies)
 *
 * Usage:
 *   npx ts-node src/keygen-standalone.ts
 *   or (compiled):
 *   node dist/keygen-standalone.js
 */

import { generateKeyPairSync } from 'crypto';

function main() {
  console.log('\n=== Links Keypair Generator ===\n');

  try {
    // Generate Ed25519 keypair
    const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    });

    const privkeyBuffer = privateKey as Buffer;
    const pubkeyBuffer = publicKey as Buffer;

    // Convert to strings
    const privkeyBase64 = privkeyBuffer.toString('base64');
    const pubkeyHex = pubkeyBuffer.toString('hex');

    console.log('PRIVATE KEY (base64) - Keep SECRET:');
    console.log(privkeyBase64);
    console.log('\nPUBLIC KEY (hex) - Paste into packages/licensing/src/keys.ts:');
    console.log(pubkeyHex);
    console.log('\n✓ Keys generated successfully\n');

  } catch (error) {
    console.error('Error generating keypair:', error);
    process.exit(1);
  }
}

main();
