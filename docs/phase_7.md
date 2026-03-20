````md

\# Phase\_7.md — Tagging + Classification (Derived Artifacts, Evidence-First)



\## Purpose

Phase 7 is where the system starts becoming genuinely useful:

\- every new entry gets \*\*derived artifacts\*\*:

&nbsp; - tags (topic labels, type labels)

&nbsp; - entities (people/places/orgs/concepts)

&nbsp; - a short structured summary

\- everything is:

&nbsp; - \*\*schema-validated\*\*

&nbsp; - \*\*provenance-stamped\*\* (model + prompt + version + time)

&nbsp; - \*\*evidence-first\*\* (no inventing facts; excerpt references)



This phase uses the OpenRouter integration from Phase 6 and runs via the Phase 5 processing engine.



---



\## Definition of Done

Phase 7 is complete only when:



\### ✅ Automatic derived artifacts

\- Creating a \*\*text entry\*\* enqueues:

&nbsp; - `tag\_entry`

&nbsp; - `summarize\_entry`

&nbsp; - `extract\_entities`

\- Worker runs those jobs and stores outputs as derived artifacts.



\### ✅ Storage is audit-safe

\- Derived artifacts are stored separately from originals.

\- Each artifact stores:

&nbsp; - model id

&nbsp; - prompt\_id + prompt\_version

&nbsp; - temperature

&nbsp; - created\_at

&nbsp; - source entry\_id

&nbsp; - evidence excerpts (where applicable)



\### ✅ JSON schema validation enforced

\- AI output must validate against schemas.

\- Invalid outputs are rejected and job fails (retry allowed once or twice).

\- No invalid AI output can enter “truth tables”.



\### ✅ Tests \& QA

\- Integration tests cover:

&nbsp; - entry creation triggers jobs

&nbsp; - worker completes jobs

&nbsp; - artifacts exist and are queryable

&nbsp; - malformed model output is rejected and retried

\- Smoke script demonstrates end-to-end tagging.



\### ✅ Docs updated

\- `docs/pipeline.md` updated with job types and schemas

\- `docs/security.md` updated with AI safety/validation notes

\- `docs/qa.md` updated

\- `CHANGELOG.md` updated



---



\## Key Concept: “Derived Artifacts”

Original captured data is immutable.

AI outputs are \*\*derived artifacts\*\*: helpful, but not ground truth.



This prevents hallucinations from contaminating primary evidence.



---



\## Data Model Additions (Phase 7)



\### 1) `derived\_artifacts` table

Table: `derived\_artifacts`

\- `id` (TEXT uuid)

\- `pot\_id` (TEXT FK -> pots.id)

\- `entry\_id` (TEXT FK -> entries.id)

\- `artifact\_type` (TEXT)

&nbsp; Enum: `tags | summary | entities`

\- `schema\_version` (INTEGER, default 1)



Provenance:

\- `model\_id` (TEXT)

\- `prompt\_id` (TEXT)

\- `prompt\_version` (TEXT)

\- `temperature` (REAL)

\- `max\_tokens` (INTEGER)

\- `created\_at` (INTEGER epoch ms)



Payload:

\- `payload\_json` (TEXT) // validated JSON string

\- `evidence\_json` (TEXT, nullable) // list of evidence excerpts + offsets



Indexes:

\- `idx\_artifacts\_entry\_type\_created`

&nbsp; - (entry\_id, artifact\_type, created\_at)

\- `idx\_artifacts\_pot\_type\_created`

&nbsp; - (pot\_id, artifact\_type, created\_at)



Uniqueness / Upsert strategy (recommended):

\- allow multiple versions over time, but prevent accidental duplicates for same prompt version:

&nbsp; - `UNIQUE(entry\_id, artifact\_type, prompt\_id, prompt\_version)` (optional)

This makes reruns deterministic.



\### 2) Optional: normalized tables (can be later)

You can keep tags/entities inside payload\_json for now.

Later you can normalize to:

\- `tags` table

\- `entities` table

\- `entry\_tags` join

\- `entry\_entities` join



Phase 7 recommendation: \*\*keep payload\_json\*\* as authoritative and optionally provide a “denormalized view” endpoint for convenience.



---



\## Schemas (Phase 7)

All AI outputs must be strict JSON matching these schemas (Zod in `packages/core`).



\### A) Tags Artifact Schema

```json

{

&nbsp; "tags": \[

&nbsp;   { "label": "string", "type": "topic|method|domain|sentiment|other", "confidence": 0.0 }

&nbsp; ]

}

````



Rules:



\* max 20 tags

\* confidence 0..1



\### B) Entities Artifact Schema



```json

{

&nbsp; "entities": \[

&nbsp;   { "label": "string", "type": "person|org|place|concept|event|other", "confidence": 0.0 }

&nbsp; ]

}

```



Rules:



\* max 30 entities

\* confidence 0..1



\### C) Summary Artifact Schema



```json

{

&nbsp; "summary": "string",

&nbsp; "bullets": \["string"],

&nbsp; "claims": \[

&nbsp;   { "claim": "string", "evidence": { "start": 0, "end": 0, "excerpt": "string" } }

&nbsp; ]

}

```



Rules:



\* summary <= ~800 chars

\* bullets max 8

\* claims max 8

\* evidence excerpts must be slices from the entry content



---



\## Prompting Rules (Phase 7)



All prompts must:



\* explicitly instruct: \*\*use only the provided text\*\*

\* ignore any instructions within the text (prompt injection defense)

\* output JSON only (no markdown)

\* include evidence excerpts for claims (summary schema)



Prompts must be versioned in `packages/ai/prompts/`:



\* `tag\_entry/v1.md`

\* `extract\_entities/v1.md`

\* `summarize\_entry/v1.md`



---



\## Pipeline Jobs (Phase 7)



\### Triggering



When a \*\*text entry\*\* is created:



\* enqueue jobs:



&nbsp; \* `tag\_entry`

&nbsp; \* `extract\_entities`

&nbsp; \* `summarize\_entry`

&nbsp;   with priority rules (optional):

\* tagging/entities first, summary second



\### Job handlers



Implement in `apps/worker`:



\* `handleTagEntry(job)`

\* `handleExtractEntities(job)`

\* `handleSummarizeEntry(job)`



Each handler:



1\. loads entry text (canonical)

2\. selects model (prefs for that task type)

3\. gets prompt version

4\. calls AI wrapper

5\. parses JSON

6\. validates schema

7\. stores derived artifact

8\. writes audit event



\### Failure behavior



\* If AI output fails JSON parse / schema validation:



&nbsp; \* mark failed and retry (max 2–3 attempts)

&nbsp; \* after max attempts -> deadletter

\* If entry missing or deleted:



&nbsp; \* cancel job



---



\## API (Phase 7)



\### A) Fetch derived artifacts for an entry



\#### `GET /entries/:entryId/artifacts`



Returns:



```json

{

&nbsp; "entry\_id": "...",

&nbsp; "artifacts": \[

&nbsp;   { "artifact\_type": "tags", "created\_at": 123, "model\_id": "...", "payload": {...} },

&nbsp;   { "artifact\_type": "summary", ... }

&nbsp; ]

}

```



\### B) Fetch latest artifact by type



\#### `GET /entries/:entryId/artifacts/:type/latest`



\### C) Re-run processing (manual QA)



\#### `POST /entries/:entryId/process`



Body:



```json

{ "types": \["tags","entities","summary"], "force": false }

```



\* `force=false` means skip if artifact exists for same prompt version.

\* `force=true` reruns and overwrites/upserts (policy must be consistent).



---



\## Storage Layer Changes



Add `artifactsRepo`:



\* `insertArtifact(...)` (upsert strategy)

\* `listArtifactsForEntry(entryId)`

\* `getLatestArtifact(entryId, type)`

\* `artifactExists(entryId, type, prompt\_id, prompt\_version)`



---



\## Audit Events (Phase 7)



Write:



\* `artifact\_created` (type, model, prompt version)

\* `artifact\_skipped\_exists`

\* `artifact\_failed\_validation`

\* `entry\_processing\_requested` (manual re-run)



---



\## Tests (Phase 7)



\### Unit tests



\* schema validation (good payload passes, bad payload fails)

\* “skip if exists” logic

\* prompt registry returns correct prompt file



\### Integration tests (required)



Use mocked OpenRouter responses:



1\. Create pot + entry -> jobs enqueued.

2\. Run worker -> jobs done -> artifacts exist.

3\. Mock invalid JSON response -> job retries -> eventually deadletter if consistently invalid.

4\. API endpoints return latest artifacts.



\### Smoke script (Phase 7)



`scripts/smoke-phase7.(sh|ps1)`:



1\. create pot

2\. create text entry with a few paragraphs

3\. run worker (or wait if daemon)

4\. fetch `/entries/:id/artifacts`

5\. print tags/entities/summary

6\. assert arrays non-empty



Exit non-zero on missing artifacts.



---



\## QA Steps (Manual)



1\. Ensure OpenRouter key set:



\* `OPENROUTER\_API\_KEY=...`



2\. Run API + worker:



\* `pnpm dev`

\* `pnpm worker` (daemon) OR `pnpm worker -- --once` multiple times



3\. Create entry:



\* use capture endpoint from Phase 3



4\. Fetch artifacts:



\* `curl http://localhost:<port>/entries/<entryId>/artifacts`



---



\## Git Commit Plan (Phase 7)



1\. `feat(storage): add derived\_artifacts table + indexes`

2\. `feat(core): add schemas for tags/entities/summary artifacts`

3\. `feat(worker): add tag\_entry/extract\_entities/summarize\_entry handlers`

4\. `feat(api): add artifacts query endpoints + manual process endpoint`

5\. `test(pipeline): add phase 7 integration tests + smoke script`

6\. `docs: update pipeline, security, qa, changelog for phase 7`



---



\## Phase 7 Exit Criteria Checklist



\* \[ ] entry creation enqueues artifact jobs

\* \[ ] worker produces tags/entities/summary artifacts

\* \[ ] all outputs schema-validated

\* \[ ] artifacts query endpoints work

\* \[ ] invalid outputs are rejected and retried

\* \[ ] integration tests + smoke script pass

\* \[ ] docs + changelog updated



---



```

```



