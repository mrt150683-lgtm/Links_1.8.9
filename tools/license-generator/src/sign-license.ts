#!/usr/bin/env node
/**
 * Sign a license request with a private key
 *
 * Usage:
 *   npx ts-node sign-license.ts \\
 *     --privkey <hex-privkey> \\
 *     --req <path/to/request.licreq> \\
 *     --tier pro \\
 *     --expires 2027-01-01 \\
 *     --customer-ref CUST-123
 *
 * Output:
 *   Prints signed license JSON to stdout
 *   Redirect to file: > license.lic
import { readFileSync } from 'fs';
import { createPrivateKey, sign, randomUUID } from 'crypto';
/**
 * Deterministically stringifies an object by sorting its keys alphabetically.
 * Ensures the cryptographic payload string is identical across all environments.
 */
function stableStringify(obj: any): string {
  const allKeys: string[] = [];
  JSON.stringify(obj, (key, value) => {
    if (value !== undefined) allKeys.push(key);
    return value;
  });
  allKeys.sort();
  return JSON.stringify(obj, allKeys);
}

interface LicenseRequest {
  schema: number;
  product: string;
  request_id: string;
  created_at: number;
  fingerprint_sha256: string;
  app_version: string;
}

interface LicensePayload {
  schema: number;
  kid: string;
  product: string;
  license_id: string;
  issued_at: number;
  expires_at: number | null;
  tier: string;
  fingerprint_sha256: string;
  customer_ref?: string;
}

interface SignedLicense {
  payload: LicensePayload;
  signature: string;
  kid: string;
}

function parseArgs(): {
  privkey: string;
  reqPath: string;
  tier: string;
  expires: string | null;
  customerRef?: string;
  kid: string;
} {
  const args = process.argv.slice(2);

  let privkey = '';
  let reqPath = '';
  let tier = '';
  let expires: string | null = null;
  let customerRef: string | undefined;
  let kid = 'links-ed25519-2026-01'; // Default kid

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === '--privkey') {
      privkey = next || '';
      i++;
    } else if (arg === '--req') {
      reqPath = next || '';
      i++;
    } else if (arg === '--tier') {
      tier = next || '';
      i++;
    } else if (arg === '--expires') {
      expires = next || null;
      i++;
    } else if (arg === '--customer-ref') {
      customerRef = next;
      i++;
    } else if (arg === '--kid') {
      kid = next || 'links-ed25519-2026-01';
      i++;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Sign a license request

Usage:
  npx ts-node sign-license.ts \\
    --privkey <hex> \\
    --req <path> \\
    --tier <basic|pro|ultra> \\
    --expires <YYYY-MM-DD> \\
    [--customer-ref <ref>] \\
    [--kid <kid>]

Options:
  --privkey       Ed25519 private key as hex string (required)
  --req           Path to license request JSON file (required)
  --tier          License tier: basic, pro, or ultra (required)
  --expires       Expiration date as YYYY-MM-DD, or null for never (required)
  --customer-ref  Optional customer reference
  --kid           Key ID (default: links-ed25519-2026-01)
  --help          Show this help message
`);
      process.exit(0);
    }
  }

  if (!privkey || !reqPath || !tier) {
    console.error('Error: --privkey, --req, and --tier are required');
    process.exit(1);
  }

  return { privkey, reqPath, tier, expires, customerRef, kid };
}

function parseExpires(expiresStr: string | null): number | null {
  if (!expiresStr || expiresStr === 'null') return null;

  try {
    const date = new Date(expiresStr);
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date');
    }
    return date.getTime();
  } catch {
    console.error(`Invalid expires date: ${expiresStr}`);
    process.exit(1);
  }
}

function signLicense(): void {
  const { privkey, reqPath, tier, expires, customerRef, kid } = parseArgs();

  // Read request file
  let request: LicenseRequest;
  try {
    const content = readFileSync(reqPath, 'utf-8');
    request = JSON.parse(content);
  } catch (err) {
    console.error(`Error reading request file: ${err}`);
    process.exit(1);
  }

  // Validate tier
  if (!['basic', 'pro', 'ultra'].includes(tier)) {
    console.error(`Invalid tier: ${tier}`);
    process.exit(1);
  }

  // Parse expiry
  const expiresAt = parseExpires(expires);

  // Create payload
  const payload: LicensePayload = {
    schema: 1,
    kid,
    product: 'links',
    license_id: randomUUID(),
    issued_at: Date.now(),
    expires_at: expiresAt,
    tier,
    fingerprint_sha256: request.fingerprint_sha256,
  };

  if (customerRef) {
    payload.customer_ref = customerRef;
  }

  // Sign payload
  const canonicalPayload = stableStringify(payload) || '';

  let signature: string;
  try {
    // Import the base64 DER private key as an Ed25519 KeyObject
    const keyObj = createPrivateKey({
      key: Buffer.from(privkey, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });

    // Ed25519 sign (no digest algorithm — pass null)
    const sigBuf = sign(null, Buffer.from(canonicalPayload, 'utf-8'), keyObj);
    signature = sigBuf.toString('hex');
  } catch (err) {
    console.error(`Error signing payload: ${err}`);
    process.exit(1);
  }

  // Create signed license
  const signed: SignedLicense = {
    payload,
    signature,
    kid,
  };

  // Output JSON to stdout
  console.log(JSON.stringify(signed, null, 2));
}

signLicense();
