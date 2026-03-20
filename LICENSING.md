# Links Licensing System

Complete offline licensing system for Links desktop app using Ed25519 signatures and machine fingerprints.

## Overview

**3 Enforcement Points:**
1. **Launcher** (Electron) - Validates before spawning API/Worker
2. **API** (server.ts) - Validates on startup
3. **Worker** (index.ts) - Validates on startup

**Dev Mode Bypass:** Set `NODE_ENV !== 'production'` to skip licensing (development only)

---

## License Request Flow

### Step 1: User Launches App Without License

```
App starts → No license.lic file found → License validation fails
```

### Step 2: License Request Auto-Generated

The Launcher automatically creates a license request:

```
Location: %APPDATA%\Links\license-request.licreq

Content:
{
  "schema": 1,
  "product": "links",
  "request_id": "UUID",
  "created_at": 1730000000000,
  "fingerprint_sha256": "sha256(machineId + '|links:v1')",
  "app_version": "0.8.2"
}
```

### Step 3: User Sends Request to Vendor

Error dialog shows path to request file:
```
%APPDATA%\Links\license-request.licreq
```

User sends this file to vendor.

### Step 4: Vendor Signs with License Generator

**Setup (one-time):**
```bash
cd tools/license-generator
pnpm install
pnpm build:exe
```

**Generate keypair (once):**
```bash
links-keygen.exe
# Output:
# PRIVATE KEY: <save securely, never share>
# PUBLIC KEY: <paste into packages/licensing/src/keys.ts>
```

**Sign license request:**
```bash
links-signer.exe \
  --privkey <private-key-hex> \
  --req license-request.licreq \
  --tier pro \
  --expires 2027-01-01 \
  --customer-ref CUST-123
# Output: Signed license JSON
```

### Step 5: User Places License File

User receives signed `license.lic` and places it in:
```
%APPDATA%\Links\license.lic
```

### Step 6: App Launches Successfully

Next app launch:
- Launcher validates license ✓
- Checks signature with public key ✓
- Verifies fingerprint matches machine ✓
- Checks expiry (if set) ✓
- Proceeds to spawn API + Worker ✓

---

## Package Structure

### `packages/licensing/` - License Validation Library

**Core modules:**

- **`schemas.ts`** – Zod validation schemas
  - `LicensePayload` – Signed data (tier, expiry, fingerprint)
  - `StoredLicense` – Payload + signature
  - `LicenseRequest` – Request format for vendor
  - `LicenseValidationResult` – Validation response

- **`fingerprint.ts`** – Machine identification
  - `computeFingerprintSync()` → sha256(machineId + "links:v1")
  - Non-reversible, machine-specific, product-specific
  - Prevents license copying to other machines

- **`verify.ts`** – License verification
  - Ed25519 signature validation
  - Expiry check (null = never expires)
  - Product check ("links" only)
  - Fingerprint matching current machine

- **`storage.ts`** – File I/O
  - Reads/writes from `%APPDATA%\Links\license.lic`
  - Creates directory if needed
  - Returns null on missing/invalid files

- **`request.ts`** – Request generation
  - `generateLicenseRequest(appVersion)`
  - Includes app version, fingerprint, timestamp
  - Safe to send to vendor (no secrets)

- **`keys.ts`** – Public key storage
  - Embedded in app code (safe to ship)
  - Placeholder initially: `PLACEHOLDER_PUBLIC_KEY_RUN_tools_license_generator`
  - Replace with real public key after keypair generation
  - Supports key rotation via `kid` (key ID)

- **`index.ts`** – Main export
  - `validateLicense()` – Async validation function
  - Returns `LicenseValidationResult`

**Tests (14 passing):**
- `__tests__/fingerprint.test.ts` – Stability, format (64-char hex)
- `__tests__/verify.test.ts` – Signature, expiry, fingerprint, product checks
- `__tests__/storage.test.ts` – Write/read, directory creation, error handling

**Build:**
```bash
pnpm --filter @links/licensing build
pnpm --filter @links/licensing test
```

### `tools/license-generator/` - Keypair & Signing Tools

**TypeScript scripts (run via npm):**

- **`generate-keypair.ts`**
  - Generates random Ed25519 keypair
  - Output: Private key (keep secret!) + Public key (ship with app)

- **`sign-license.ts`**
  - Signs license requests with private key
  - Options: `--privkey`, `--req`, `--tier`, `--expires`, `--customer-ref`, `--kid`

**Setup:**
```bash
cd tools/license-generator
pnpm install
```

**Usage:**
```bash
# Generate keypair (one-time setup)
pnpm run generate-keypair

# Sign license request (per-license)
pnpm run sign-license -- \
  --privkey <hex> \
  --req <path> \
  --tier basic|pro|ultra \
  --expires YYYY-MM-DD \
  --customer-ref "optional-ref"
```

**Or directly with Node.js:**
```bash
node --loader ts-node/esm src/generate-keypair.ts
node --loader ts-node/esm src/sign-license.ts --help
```

---

## Integration Points

### Launcher (`apps/launcher/src/main/index.ts`)

```typescript
import { validateLicense, generateLicenseRequest } from '@links/licensing';

app.whenReady().then(async () => {
  // Validate license BEFORE spawning API/Worker
  const licResult = await validateLicense();
  if (!licResult.valid) {
    // Generate request file for user
    const req = await generateLicenseRequest(app.getVersion());
    writeFileSync(join(userData, 'license-request.licreq'),
                  JSON.stringify(req, null, 2));
    // Show error dialog with path
    dialog.showErrorBox('License Required', ...);
    app.quit();
    return;
  }
  // Proceed normally
  spawnApi(userData, apiEntry);
});
```

**Env var:** `LINKS_LICENSE_DIR` set to app's userData directory for subprocess access

### API (`apps/api/src/server.ts`)

```typescript
import { validateLicense } from '@links/licensing';

export async function createServer(config: Config) {
  initDatabase();
  runMigrations();
  await validateEncryptionKeySafety();

  // Validate license (enforcement point 2)
  const licResult = await validateLicense();
  if (!licResult.valid) {
    throw new Error(`License validation failed: ${licResult.reason}`);
  }

  const fastify = Fastify(...);
  // Proceed normally
}
```

**Env var:** `LINKS_LICENSE_DIR` passed by launcher

### Worker (`apps/worker/src/index.ts`)

```typescript
import { validateLicense } from '@links/licensing';

async function main() {
  const config = getConfig();
  initDatabase();
  runMigrations();

  // Validate license (enforcement point 3)
  const licResult = await validateLicense();
  if (!licResult.valid) {
    logger.error({ reason: licResult.reason, msg: 'License validation failed' });
    process.exit(1);
  }

  // Register job handlers and start processing
}
```

**Env var:** `LINKS_LICENSE_DIR` passed by launcher

---

## Validation Results

`LicenseValidationResult` structure:

```typescript
interface LicenseValidationResult {
  valid: boolean;
  reason?:
    | 'dev_mode'           // NODE_ENV !== 'production'
    | 'no_license'         // License file not found
    | 'bad_signature'      // Signature verification failed
    | 'expired'            // License has expired
    | 'wrong_machine'      // Fingerprint mismatch
    | 'invalid_product'    // Product is not 'links'
    | 'parse_error';       // JSON parse or schema validation failed
  tier?: 'basic' | 'pro' | 'ultra';
  expiresAt?: number | null;
}
```

---

## Key Management

### Generation (Vendor)

```bash
links-keygen.exe
# Output: PRIVATE_KEY (hex) + PUBLIC_KEY (hex)
```

**Private key:** Store securely (encrypted, air-gapped machine, HSM, etc.)
- Never commit to git
- Never ship with app
- Keep access strictly limited

**Public key:** Safe to ship
- Embed in `packages/licensing/src/keys.ts`
- Included in all app builds
- Used by all instances to verify signatures

### Rotation

Support for future key rotation via `kid` (key ID) in payloads:
- Generate new keypair
- Add new public key to `PUBLIC_KEYS` with new `kid`
- Old licenses still validate with old public key
- New licenses use new `kid` and public key
- Gradual migration possible

---

## File Locations

**User-facing:**
```
%APPDATA%\Links\
  ├── license.lic              ← Signed license (place here)
  ├── license-request.licreq   ← Auto-generated request (send to vendor)
  ├── links.db                 ← Database
  ├── assets/                  ← Encrypted asset blobs
  ├── exports/                 ← Export bundles
  └── .env                     ← User config (API keys, etc.)
```

**Source code:**
```
packages/licensing/
  ├── src/
  │   ├── index.ts             ← Main export (validateLicense)
  │   ├── schemas.ts           ← Zod schemas
  │   ├── keys.ts              ← PUBLIC_KEYS constant
  │   ├── fingerprint.ts       ← Machine identification
  │   ├── verify.ts            ← Signature verification
  │   ├── storage.ts           ← File I/O
  │   ├── request.ts           ← Request generation
  │   └── __tests__/           ← 14 passing tests
  ├── package.json
  └── tsconfig.json

tools/license-generator/
  ├── src/
  │   ├── generate-keypair.ts  ← Keypair generation
  │   └── sign-license.ts      ← License signing
  ├── build-exe.mjs            ← EXE build script
  ├── tsconfig.json
  ├── package.json
  ├── links-keygen.exe         ← Generated (vendor tool)
  └── links-signer.exe         ← Generated (vendor tool)
```

---

## Security Properties

### What We Protect Against

✅ **Users editing license file** – Ed25519 signature prevents tampering
✅ **Copying license to another machine** – Fingerprint binding
✅ **Extending expiry dates** – Signature verification
✅ **Changing tier** – Signature verification
✅ **Cross-product reuse** – Product salt in fingerprint

### What We Accept

⚠️ **Binary patching** – Offline apps can always be modified
⚠️ **Skilled attackers** – We raise the cost, not eliminate the possibility
⚠️ **Online revocation** – Out of scope (can add in future)

### Non-Goals

❌ "Uncrackable" – Offline licensing inherently has limits
❌ DRM or obfuscation – Not our threat model

---

## Development & Testing

### Dev Mode (Bypass Licensing)

```bash
NODE_ENV=development pnpm dev
# License check skipped, app runs normally
```

### Production Mode (License Required)

```bash
NODE_ENV=production pnpm dev
# License validation enforced, will fail without valid license.lic
```

### Testing License Tools

**Via TypeScript (requires Node.js):**
```bash
cd tools/license-generator
pnpm generate-keypair       # Run ts-node version
pnpm sign-license -- --help # Show options
```

**Via EXE (after build):**
```bash
cd tools/license-generator
pnpm build:exe
./links-keygen.exe
./links-signer.exe --help
```

### Running Licensing Tests

```bash
pnpm --filter @links/licensing test
# 14 tests: fingerprint (2), verify (8), storage (4)
```

---

## Deployment Checklist

- [ ] Generate keypair with `links-keygen.exe`
- [ ] Save private key securely (never commit, never share)
- [ ] Paste public key into `packages/licensing/src/keys.ts`
- [ ] Replace `PLACEHOLDER_PUBLIC_KEY_RUN_tools_license_generator`
- [ ] Rebuild app: `pnpm build` or `pnpm launcher:exe`
- [ ] Test with `NODE_ENV=production pnpm dev` (should require license)
- [ ] Test with `NODE_ENV=development pnpm dev` (should work without license)
- [ ] Create license for test user and verify validation
- [ ] Document vendor workflow (links-keygen.exe + links-signer.exe)

---

## Architecture Decisions

### Ed25519 Over RSA
- **Smaller keys** (32-byte private, 32-byte public)
- **Better performance** (signing & verification)
- **Modern standard** (@noble/ed25519 is battle-tested)
- **No padding oracle attacks** (unlike RSA PKCS#1 v1.5)

### Machine Fingerprint Over Hardware IDs
- **Hashed**, not raw device identifiers
- **Product-salted** to prevent cross-product reuse
- **VM-friendly** (works on virtual machines)
- **No PII leaked** (hash is one-way)

### File-Based Over Registry
- **Simpler** than Windows Registry API
- **Portable** (same code for future macOS version)
- **Debuggable** (human-readable JSON)
- **No native dependencies** required

### Stateless Verification Over Online Activation
- **Offline works** (no internet required)
- **No central server** to maintain
- **Private keys never online** (generator stays air-gapped)
- **No license revocation** (trade-off: intentional for MVP)

---

## Future Enhancements

### Phase 2
- Online revocation API (check license server on startup if online)
- License upgrade/renewal endpoint
- Admin dashboard for license management

### Phase 3
- Hardware security module (HSM) support for private key
- Multi-vendor signature schemes
- Offline key rotation ceremony

### Phase 4
- Casework mode (chain-of-custody licensing)
- Forensic audit trail for licensed pots
- Evidence integrity verification
