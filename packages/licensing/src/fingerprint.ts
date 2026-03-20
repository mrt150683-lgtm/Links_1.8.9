import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

// node-machine-id is CJS-only. Named ESM imports (import { machineIdSync })
// fail in Node.js v22 because CJS named-export analysis changed.
// Default import always works: Node.js maps module.exports → default.
// esbuild also handles this correctly when bundling for Electron.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import machineIdPkg from 'node-machine-id';
const machineIdSync = (machineIdPkg as any).machineIdSync as (original?: boolean) => string;

const PRODUCT_SALT = 'links:v1';

/**
 * Compute the machine fingerprint
 * Returns sha256(machineId + "|" + "links:v1") as hex
 *
 * This:
 * - Binds the license to this machine
 * - Avoids leaking the raw Windows MachineGuid
 * - Ensures cross-product licenses aren't reused
 */
export async function computeFingerprint(): Promise<string> {
  const machineId = machineIdSync(true); // true = prefer stable ID
  const raw = machineId + '|' + PRODUCT_SALT;
  const hash = sha256(raw);
  return bytesToHex(hash);
}

/**
 * Synchronous version (for testing/situations where async isn't needed)
 */
export function computeFingerprintSync(): string {
  const machineId = machineIdSync(true);
  const raw = machineId + '|' + PRODUCT_SALT;
  const hash = sha256(raw);
  return bytesToHex(hash);
}
