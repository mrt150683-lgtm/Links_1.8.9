```md

\# additional.md — Future Enhancements (Post-Phase 12 Additions)



This document captures important capabilities that are \*\*not required to ship the backend MVP\*\*, but are strategically valuable for privacy-first research, sensitive investigations, and enterprise-ish users.



---



\## 1) Retention \& Redaction Controls



\### 1.1 Goals

\- Allow users to \*\*limit data lifetime\*\* per pot (TTL retention).

\- Allow users to \*\*remove\*\* (“forget”) specific entries and associated derived artifacts/links.

\- Provide a \*\*secure wipe policy\*\* option for sensitive data (best-effort on modern filesystems).



\### 1.2 Features

\#### A) Per-pot retention policy (TTL)

\- Configure per pot:

&nbsp; - `retention.ttl\_days` (null = indefinite)

&nbsp; - `retention.delete\_mode`:

&nbsp;   - `soft\_delete` (recoverable, hidden)

&nbsp;   - `hard\_delete` (permanent removal from DB, assets deleted)

&nbsp; - `retention.scope`:

&nbsp;   - `entries\_only`

&nbsp;   - `entries\_and\_artifacts`

&nbsp;   - `everything\_including\_assets`

\- Worker job: `apply\_retention\_policy`

&nbsp; - runs daily or on-demand

&nbsp; - deletes/archives records older than TTL based on captured\_at

&nbsp; - updates audit events



\*\*DB additions (suggested)\*\*

\- `pots.retention\_json` (TEXT) storing policy

\- `entries.deleted\_at` (INTEGER nullable) for soft delete

\- `assets.deleted\_at` (INTEGER nullable) for soft delete (optional)

\- `audit\_events` record for any retention action



\#### B) “Forget this entry” (targeted deletion)

\- API/MCP:

&nbsp; - `POST /entries/:entryId/forget`

&nbsp; - tool: `entries.forget`

\- Behavior options (user selects):

&nbsp; - delete entry only

&nbsp; - delete entry + derived artifacts

&nbsp; - delete entry + derived artifacts + links touching it

&nbsp; - delete entry + all assets referenced (if no other refs)

\- Must be \*\*transactional\*\* and auditable.



\*\*Important note\*\*

\- If exports exist, you can’t force deletion from other people’s copies. But you can:

&nbsp; - mark “revocation notice” metadata and include it in future exports (optional).



\#### C) Redaction (safe sharing)

Redaction is different from deletion. It preserves structure but removes sensitive content for disclosure.



\- Redaction profiles per pot:

&nbsp; - strip URLs

&nbsp; - strip notes

&nbsp; - mask emails/phones

&nbsp; - remove “source\_context”

&nbsp; - redact regex patterns

\- Output types:

&nbsp; - “public export bundle” (ties into Phase 9 public mode)

&nbsp; - “disclosure report” (PDF/JSON later)



\*\*Implementation approach\*\*

\- Redaction is applied at export time first (simplest).

\- Later: store redacted views as separate artifacts if needed.



\#### D) Secure wipe policy (best effort)

Reality check: true secure deletion is limited by SSD wear leveling and journaling filesystems. You can still do best-effort hygiene.



Options:

\- \*\*DB level\*\*

&nbsp; - use SQLite secure\_delete pragma (if acceptable)

&nbsp; - vacuum after hard deletes (careful with size/time)

\- \*\*Asset blobs\*\*

&nbsp; - overwrite blob file before delete (best effort)

&nbsp; - or store blobs encrypted with a per-pot key and “wipe” by deleting the key (cryptographic erasure — recommended long-term)



\*\*Recommendation\*\*

\- Long-term: implement \*\*per-pot envelope encryption\*\* and treat deletion as key destruction + metadata cleanup.



---



\## 2) Conflict Strategy for Imports / Merges (Beyond Phase 9)



\### 2.1 Why it matters

Phase 9 imports a pot as a new pot (safe and clean). But users will eventually want:

\- merge imported pot into an existing pot

\- dedupe duplicates across pots

\- preserve provenance while combining research streams



\### 2.2 Merge modes (proposed)

\#### A) “Append Import” (current Phase 9)

\- import as new pot, no merging

\- safest



\#### B) “Merge into existing pot”

User selects a destination pot. System merges:

\- entries

\- assets

\- artifacts

\- links



Key problems:

\- duplicates

\- conflicting metadata

\- link graph collisions

\- artifact version conflicts



\### 2.3 Identity strategy (critical)

To merge intelligently, you need stable identifiers:

\- for text entries: `content\_sha256` + normalized source\_url + captured\_at proximity

\- for assets: sha256 bytes (already)

\- for artifacts: keyed by (entry identity, prompt\_id, prompt\_version)

\- for links: normalized pair + type



\### 2.4 Merge rules (pragmatic defaults)

\- Assets: dedupe by sha256 always.

\- Entries:

&nbsp; - if same `content\_sha256` and same source\_url (or both missing) within N time window → treat as duplicate.

&nbsp; - duplicates can be:

&nbsp;   - skipped

&nbsp;   - merged (combine metadata)

&nbsp;   - preserved as separate but linked with `duplicate` link type

\- Artifacts:

&nbsp; - if duplicate entry resolved → prefer newest artifact per prompt version

&nbsp; - keep both if different prompt versions

\- Links:

&nbsp; - normalize and upsert; if conflicts, keep highest confidence and retain the other as history (optional).



\### 2.5 Implementation plan (future phase)

\- Add a `merge\_plans` table:

&nbsp; - preview what will be merged/deduped before applying

\- Provide dry-run output:

&nbsp; - counts, collisions, duplicates, risky cases

\- Implement merge as a job:

&nbsp; - `merge\_pots` with resumability + audit trail



---



\## 3) Offline Model Option (Local OSS Models as Fallback)



\### 3.1 Goals

\- Allow end users to run \*\*no-cloud\*\* processing.

\- Preserve the same pipeline contracts (schemas, artifacts, links).

\- Make model selection seamless: OpenRouter when available, local model when desired.



\### 3.2 Architecture approach

Introduce an AI provider interface:

\- `AiProvider`:

&nbsp; - `listModels()`

&nbsp; - `runTask(taskType, prompt, input, config)`



Providers:

\- `OpenRouterProvider` (Phase 6)

\- `LocalProvider` (future)



\### 3.3 Local model options (future)

\- \*\*Ollama\*\* backend (common, easy)

\- \*\*llama.cpp\*\* server (more control)

\- \*\*vLLM\*\* (heavy, for GPUs)

\- Optional: local embedding model for search/link candidates



\### 3.4 Model registry behavior

\- Maintain separate registries:

&nbsp; - `model\_registry\_openrouter`

&nbsp; - `model\_registry\_local`

\- UI later allows selecting:

&nbsp; - provider: `openrouter | local`

&nbsp; - model id within provider



\### 3.5 Constraints and expectations

\- Offline models may be weaker, slower, and require GPU/CPU tuning.

\- Keep artifact schemas identical so downstream tooling doesn’t care.



\### 3.6 Security benefit

\- No sensitive content leaves device.

\- Useful for:

&nbsp; - legal cases

&nbsp; - sensitive investigative work

&nbsp; - corporate research



---



\## 4) Legal / Ethics Guardrails (Casework-Grade Mode)



\### 4.1 Goals

\- Make the system safe to use for:

&nbsp; - law enforcement case files

&nbsp; - legal discovery

&nbsp; - investigations

&nbsp; - high-risk research

\- Provide strong chain-of-custody and disclosure controls.



\### 4.2 Chain of custody features (future)

\#### A) Evidence-grade logging

\- Stronger audit logging with:

&nbsp; - immutable append-only ledger mode (optional)

&nbsp; - hash chaining of audit events (tamper-evident log)

\- Record:

&nbsp; - who/what created an entry

&nbsp; - when it was processed

&nbsp; - which models were used

&nbsp; - exact prompt versions



\#### B) Evidence packaging

\- “Case export” mode:

&nbsp; - includes original entries + hashes

&nbsp; - includes asset hashes

&nbsp; - includes processing provenance

&nbsp; - optionally excludes derived artifacts if they’re considered “analysis” not “evidence”



\#### C) Disclosure filters

\- Export filters with strict rules:

&nbsp; - remove internal notes

&nbsp; - remove sensitive sources

&nbsp; - redact PII

&nbsp; - include only approved entries (whitelist)



\### 4.3 Ethical safety rules (future)

\- Avoid presenting derived artifacts as facts:

&nbsp; - UI should label them as “AI-derived”

\- Require evidence excerpts for claims.

\- For “contradiction/support” links:

&nbsp; - keep confidence thresholds

&nbsp; - store evidence references

&nbsp; - provide a “review required” queue



\### 4.4 Policy configuration per pot

Add pot flags:

\- `casework\_mode: true/false`

\- `strict\_provenance: true/false`

\- `audit\_immutability: off|hash\_chained|append\_only`



---



\## Suggested “Future Phases” Labels (Optional)

If you want these tracked like the main plan:

\- Phase 13: Retention + Forget + Redaction

\- Phase 14: Merge / Conflict Resolution

\- Phase 15: Offline Local Models Provider

\- Phase 16: Casework Mode (Chain-of-Custody + Disclosure)



---

```



