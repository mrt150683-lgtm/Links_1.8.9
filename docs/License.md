\# LICENSE.md — Offline Licensing (Windows, Electron/Node)



\## 0) What we’re building

A \*\*simple, offline, hard-to-forge\*\* license system for Links.



Key rule: \*\*do not encrypt licenses with a secret inside the app\*\* (that gets extracted).

Instead we \*\*sign licenses\*\* with a vendor \*\*private key\*\* (kept only in your generator),

and the app ships only the \*\*public verify key\*\*.



This prevents \*\*license forging\*\* (editing expiry/tier), even though \*\*binary patching\*\*

is always possible for offline apps.



---



\## 1) Goals / Non-goals



\### Goals

\- Windows-only, \*\*offline\*\* verification.

\- License bound to a \*\*machine fingerprint\*\* (VM OK).

\- License stored locally (registry), simple install/update UX.

\- Future-ready for tiers (Basic/Pro/Ultra) via payload fields.

\- No sensitive device identifiers leaked (store \*\*hashes\*\*, not raw IDs).

\- No secrets in logs.



\### Non-goals

\- “Uncrackable.” Offline apps can always be patched.

\- Online activation / revocation (optional future).



---



\## 2) Threat model (practical)

We defend against:

\- Users editing registry/license file to extend expiry or switch tiers.

\- Copying a license blob to another machine.



We accept:

\- Skilled attackers patching JS/CJS bundles or skipping checks (we’ll raise cost).



---



\## 3) Architecture placement (Links-specific)

Links has:

\- Launcher (Electron main process) spawns API + Worker processes.

\- API (apps/api bundle) and Worker (apps/worker bundle) can potentially be run standalone.



\*\*Enforcement points (minimum):\*\*

1\) \*\*Launcher main process\*\*: verify license before spawning API/Worker or loading UI.

2\) \*\*API process\*\*: verify license on boot; exit if invalid.

3\) \*\*Worker process\*\*: verify license on boot; exit if invalid.



This prevents “just start the API bundle and bypass the UI gate”.



---



\## 4) Dependencies (recommended)

\### App (verify + fingerprint)

\- `@noble/ed25519` (verify)

\- `@noble/hashes` (sha256)

\- `json-stable-stringify` (canonical JSON)

\- `node-machine-id` (Windows machine ID)



\### Generator tool (sign)

\- `@noble/ed25519` (sign)

\- `json-stable-stringify`



\### Registry storage

Prefer \*\*file storage\*\* in `%APPDATA%` unless you strongly need registry.

If registry is required, use \*\*`reg.exe` via child\_process\*\* (no native deps),

or a tiny registry lib (avoid heavy native bindings if possible).



---



\## 5) Key management (Ed25519)

\### Keypair

\- Generate one Ed25519 keypair for Links licensing.

\- \*\*Private key\*\* stays ONLY in your generator environment.

\- \*\*Public key\*\* is embedded in the app code (safe to ship).



\### Key ID (`kid`)

Include a short `kid` (e.g. `"links-ed25519-2026-01"`) so you can rotate keys later.

App can ship multiple public keys in an allowlist keyed by `kid`.



\### Storage

\- Private key stored encrypted at rest (at minimum: password-encrypted file).

\- Never commit keys to git.



---



\## 6) Machine fingerprint (Windows + VM friendly)

\### Source

Use `node-machine-id`:

\- `machineIdSync(true)` (prefer stable ID; hashed anyway)



\### Fingerprint computation

We never ship raw IDs. We hash:



\- `raw = machineId + "|" + productSalt`

\- `fingerprint = sha256(raw)` as \*\*hex\*\*



Where `productSalt` is a constant string like `"links:v1"`.



This:

\- binds license to that VM/machine,

\- avoids leaking raw MachineGuid,

\- avoids cross-product reuse.



---



\## 7) File formats



\### 7.1 License Request (`.licreq`)

A request is \*not security-critical\* (no secrets). It’s a “please sign this fingerprint”.

Keep it simple.



\*\*Request JSON payload:\*\*

```json

{

&nbsp; "schema": 1,

&nbsp; "product": "links",

&nbsp; "request\_id": "uuid",

&nbsp; "created\_at": 1730000000000,

&nbsp; "fingerprint\_sha256": "hex",

&nbsp; "app\_version": "0.8.2"

}



