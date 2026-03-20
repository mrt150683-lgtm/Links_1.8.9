\# intel\_gen\_plan.md — Generated Intelligence (Questions → Answers → Curated Promotion)



\## Goal



Add a new, modular “Generated Intelligence” pipeline that:

1\) reviews pot content (within model context limits),

2\) generates \*good questions\* about multi-document combinations,

3\) answers each question using only the referenced documents (evidence-first),

4\) stores outputs in dedicated tables (NOT in processed entries by default),

5\) lets the user selectively promote outputs into processed artifacts.



This is \*\*not\*\* link discovery. Link discovery creates \*edges\* between entries.

Intel Gen creates \*new candidate knowledge artifacts\* derived from multiple entries.





\## UX / Product Shape



\### New Button (Pot-level)

\*\*🔮 Generate Intelligence\*\*

\- Runs a pipeline across the pot.

\- Produces a list of Question entries and Answer entries under a new tab.



\### New Tab (Pot-level)

\*\*Generated Intelligence\*\*

\- Left column: generated questions (status: queued/running/done/failed).

\- Right panel: answer + evidence excerpts + involved documents.

\- Action: \*\*Promote\*\* → creates a new derived artifact or a new “note/processed entry” (user-approved).



\### Explicit Boundary

By default:

\- Intel Gen output is \*quarantined\* in Generated Intelligence.

\- Nothing auto-writes into entries/processed artifacts without a user “Promote” action.





\## Constraints / Principles (match Links DNA)



\- Evidence-first prompting.

\- Provenance always (model, prompt version, input entry IDs, timestamps).

\- Deterministic dedupe (don’t re-ask the same question for the same pot snapshot).

\- Modular: minimal interference with existing pipeline and DB tables.

\- Safe failure modes: if context too small, warn + degrade gracefully.





\## High-Level Flow



\### Stage 0 — Pot Snapshot + Context Budget

1\. Build a \*\*pot snapshot\*\* representation:

&nbsp;  - Prefer summaries + metadata first.

&nbsp;  - Optionally include full text if it fits (see context sizing).

2\. Estimate tokens and compare to selected model `context\_length`.

3\. Decide mode:

&nbsp;  - \*\*Mode A (Full-pot in context):\*\* Use full text (rare, small pots).

&nbsp;  - \*\*Mode B (Digest mode):\*\* Use summaries/tags/entities + short excerpts (default, scalable).



If too large for chosen model:

\- UI banner: “Pot exceeds selected model context window. Use a larger-context model for full-pot analysis.”

\- Continue in Digest mode unless user explicitly requires full mode (then fail fast).



\### Stage 1 — Question Generation

4\. Send pot snapshot to model with prompt `intel\_question\_gen/v1`.

5\. Model returns JSON list of questions:

&nbsp;  - question text

&nbsp;  - involved entry IDs (2..N)

&nbsp;  - rationale (why this combo is worth asking)

&nbsp;  - optional category (timeline, contradiction check, synthesis, entity profile, claim validation)

6\. Store questions in `intelligence\_questions`.

7\. For each new question, enqueue `intel\_answer\_question`.



\### Stage 2 — Answer Each Question (Fresh Context)

8\. For each question:

&nbsp;  - Load full text for referenced entries (or best available representation).

&nbsp;  - Ask model with prompt `intel\_answer/v1`:

&nbsp;    - Answer must cite evidence excerpts from provided entries.

&nbsp;    - If insufficient evidence, must say so and set low confidence.

9\. Validate excerpts exist in source texts (substring / offset verification).

10\. Store answer in `intelligence\_answers` with evidence + provenance.



\### Stage 3 — User Promotion (Manual)

11\. User selects an item → \*\*Promote\*\*:

&nbsp;  - Creates a new derived artifact or processed entry:

&nbsp;    - artifact type: `generated\_intelligence`

&nbsp;    - source: intelligence\_answer\_id

&nbsp;  - Links back to original question + referenced entries.





\## Data Model (New Tables)



\### 1) intelligence\_runs

One run per button press.

\- id (uuid)

\- pot\_id

\- mode (`full` | `digest`)

\- model\_id (OpenRouter id)

\- prompt\_version

\- pot\_snapshot\_hash

\- estimated\_input\_tokens

\- context\_length

\- status (queued/running/done/failed)

\- created\_at, finished\_at



\### 2) intelligence\_questions

\- id (uuid)

\- run\_id

\- pot\_id

\- question\_signature (sha256; see dedupe)

\- question\_text

\- entry\_ids\_json (sorted array of entry ids)

\- category (optional)

\- rationale (optional)

\- status (queued/running/done/failed)

\- created\_at



\### 3) intelligence\_answers

\- id (uuid)

\- question\_id

\- pot\_id

\- answer\_text (or answer\_json)

\- confidence (0..1)

\- evidence\_json

&nbsp; - list of { entry\_id, excerpt, start\_offset?, end\_offset? }

\- model\_id

\- prompt\_version

\- token\_usage\_json (optional)

\- excerpt\_validation (pass/fail + details)

\- created\_at



\### 4) intelligence\_known\_questions  (dedupe + “already asked”)

Tracks “askedness” across runs.

\- pot\_id

\- pot\_snapshot\_hash (or null if you want global pot scope)

\- question\_signature

\- first\_seen\_at

\- last\_seen\_at

\- times\_seen

\- last\_question\_id

\- UNIQUE(pot\_id, pot\_snapshot\_hash, question\_signature)



\*\*Why pot\_snapshot\_hash matters:\*\*

If the pot changes materially, you \*want\* some questions to be re-asked.

Snapshot-scoped dedupe gives you that without duplicates on the same data.





\## Dedupe Strategy (Question Signature)



`question\_signature = sha256( normalize(question\_text) + "|" + join(sorted(entry\_ids)) + "|" + prompt\_version )`



Normalize:

\- lowercase

\- trim

\- collapse whitespace

\- remove trailing punctuation

\- optional: strip quotes



When generating questions:

\- Drop anything whose signature exists in `intelligence\_known\_questions` for the same pot\_snapshot\_hash.





\## Pot Snapshot Hash



`pot\_snapshot\_hash = sha256( join(sorted(entry\_id + ":" + entry\_content\_hash\_or\_summary\_hash)) )`



Use the existing entry hash if available.

If not, hash `(title + summary + updated\_at)`.





\## Context Sizing / Model Selection



\### Inputs

\- model `context\_length` from cached OpenRouter model registry (Phase 6).

\- estimated tokens for pot snapshot.



\### Estimation (good enough)

`estimated\_tokens ≈ ceil(total\_chars / 4) + overhead`



\### Budgeting

\- Reserve 20–30% for output and system/tool messages.

\- Fail/warn thresholds:

&nbsp; - if estimated\_input\_tokens > 0.75 \* context\_length → warn + switch to Digest mode

&nbsp; - if estimated\_input\_tokens > 0.90 \* context\_length → hard fail (even digest too big) and require a bigger context model



\### User Notification

Return in the API response:

\- selected model context\_length

\- estimated tokens

\- chosen mode

\- message if downgraded





\## Prompts (New Prompt IDs)



\### intel\_question\_gen/v1

Input: pot snapshot (full or digest)

Output (strict JSON):

```json

{

&nbsp; "questions": \[

&nbsp;   {

&nbsp;     "question": "…",

&nbsp;     "entry\_ids": \["…","…"],

&nbsp;     "category": "synthesis | contradiction\_check | timeline | claim\_validation | entity\_profile | other",

&nbsp;     "rationale": "…"

&nbsp;   }

&nbsp; ]

}

Rules:



Must reference actual entry\_ids provided.



Questions must require combining 2+ entries (avoid single-doc questions).



Prefer high leverage: contradictions, missing links, timeline gaps, claim support strength.



intel\_answer/v1

Input: question + full text for referenced entries

Output (strict JSON):



json

Copy code

{

&nbsp; "answer": "…",

&nbsp; "confidence": 0.0,

&nbsp; "evidence": \[

&nbsp;   { "entry\_id": "…", "excerpt": "…"}

&nbsp; ],

&nbsp; "limits": "If insufficient evidence, say so."

}

Rules:



No outside knowledge unless explicitly enabled (default: OFF).



If answer cannot be grounded in excerpts: answer “Insufficient evidence in provided documents” and confidence <= 0.3.



Evidence excerpts must be verbatim substrings found in the source text.



Pipeline / Job Types

Add job types to the registry (minimal surface area):



intel\_generate\_questions (pot-level)



intel\_answer\_question (question-level)



Job lifecycle: queued → running → done/failed/deadletter (existing pattern).



Idempotency:



intel\_generate\_questions is idempotent by run\_id + snapshot hash.



intel\_answer\_question idempotent by question\_signature (upsert answer if missing, otherwise skip).



API Endpoints (Minimal)

Trigger run

POST /api/pots/:potId/intelligence/generate

Body:



json

Copy code

{

&nbsp; "mode": "auto | full | digest",

&nbsp; "model\_id": "optional override",

&nbsp; "max\_questions": 50

}

Response:



run\_id



mode chosen



context\_length + estimates



counts queued



Read results

GET /api/pots/:potId/intelligence/runs



GET /api/pots/:potId/intelligence/questions?run\_id=...



GET /api/pots/:potId/intelligence/questions/:questionId



GET /api/pots/:potId/intelligence/answers?question\_id=...



Promote

POST /api/pots/:potId/intelligence/answers/:answerId/promote

Body:



json

Copy code

{

&nbsp; "target": "processed\_entries | artifact",

&nbsp; "note\_title": "optional"

}

Promotion creates a new derived artifact / processed entry with provenance linking back to answerId.



Worker Implementation Notes (Modular)

New module folder (suggestion):



packages/intelligence/ (repos, schemas, prompts, services)



Minimal integration points:



add migrations



add job handlers to worker registry



add API routes



add prompts to prompt registry



No changes required to:



existing entry processing



existing link discovery



existing artifacts system (except optional “promote” artifact creation)



Safety / Abuse / Security

Treat Generated Intelligence as derived and potentially wrong:



do not overwrite user data



always store evidence



always store confidence + model metadata



Respect pot encryption/export rules (same as other derived artifacts).



Logging:



store token usage + model + prompt version



never log raw pot content at INFO level (Phase security/logging rules)



QA Plan (Must-Haves)

Unit tests:



signature normalization + hashing stable



token estimation sane



dedupe works across runs



Integration tests (mock AI):



run generates questions and stores them



answer job stores evidence and validates excerpts



rerun with same pot snapshot does NOT duplicate questions



rerun with changed pot snapshot can generate new questions



Smoke script:



create pot with 3–5 entries



generate summaries



click Generate Intelligence



confirm questions + answers appear



Rollout Plan

Phase 1: Digest-only (safe default)



Phase 2: Auto mode with context sizing + optional full-pot analysis



Phase 3: UI polish + promote flow + export inclusion

