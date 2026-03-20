Here you go, Alex — \*\*`project\_gen.md`\*\* (drop this into `/docs/project\_gen.md` or `/docs/project\_gen.md`-ish, wherever you keep system docs).



````md

\# project\_gen.md — Modular “Project Planning Generator” (Pot → Questions → Plan → Phases → Docs → Export)



\## Goal



Add a \*\*modular\*\* feature to the current app that lets a user design \*their own\* project using the same approach you used to design Links:



1\) User selects a \*\*Pot\*\* (the project’s evidence/data vault)  

2\) System generates \*\*5–20 key planning questions\*\* (with answer fields + “I don’t know” / “N/A”)  

3\) System generates a detailed \*\*plan.md\*\* (phased, testable, with risks)  

4\) User \*\*approves\*\* or \*\*rejects\*\* (with feedback)  

5\) System generates \*\*phase\_X.md\*\* docs (each phase includes prior generated docs so everything stays in sync)  

6\) System generates any \*\*extra docs\*\* logically required (ui.md, security.md, materials.md, etc.)  

7\) Everything is stored with \*\*history/versioning\*\*, and can be \*\*exported\*\* as a zip named `ProjectName\_YYYY-MM-DD.zip`



This must integrate with minimal disruption by reusing the existing: pots/entries, jobs/worker, safe AI wrapper + prompt registry, derived-artifact discipline, audit/logging, and export patterns. :contentReference\[oaicite:0]{index=0} :contentReference\[oaicite:1]{index=1} :contentReference\[oaicite:2]{index=2} :contentReference\[oaicite:3]{index=3} :contentReference\[oaicite:4]{index=4}





---



\## Non-negotiables (from your system’s DNA)



\- \*\*Modular by default\*\*: new capability ships as a contained module with clear boundaries. :contentReference\[oaicite:5]{index=5}  

\- \*\*Evidence-first\*\*: planning must not silently fabricate “facts”; it should surface assumptions and ask. :contentReference\[oaicite:6]{index=6}  

\- \*\*AI outputs are not ground truth\*\*: store as \*generated artifacts/files\* with provenance, schema validation, and revision history. :contentReference\[oaicite:7]{index=7} :contentReference\[oaicite:8]{index=8}  

\- \*\*Testability\*\*: unit + integration + smoke script for the whole planning flow. :contentReference\[oaicite:9]{index=9} :contentReference\[oaicite:10]{index=10}  

\- \*\*No secret leakage\*\* in logs; structured audit events for every generation step. :contentReference\[oaicite:11]{index=11} :contentReference\[oaicite:12]{index=12}





---



\## UX Flow (Project Planning tab)



\### Step 0 — Select pot

\- “Project Planning” tab

\- Dropdown: select \*\*Pot of interest\*\*

\- Optional fields:

&nbsp; - `project\_name` (default: pot name)

&nbsp; - `project\_type` (auto-inferred, but user can override)

&nbsp; - “Depth mode”: `fast` / `standard` / `deep`



\### Step 1 — Generate questions (5–20)

\- Button: “Generate Questions”

\- App shows a list of questions, each with:

&nbsp; - input control (text/number/choice/boolean/date)

&nbsp; - toggles: \*\*I don’t know\*\* / \*\*N/A\*\*

\- User completes answers → “Continue”



\### Step 2 — Generate plan.md

\- “Generate Plan”

\- Render plan.md in preview pane

\- Controls:

&nbsp; - Approve

&nbsp; - Reject (requires feedback text)



\### Step 3 — Generate phase docs

\- After approval:

&nbsp; - auto-generate `phase\_1.md … phase\_N.md`

&nbsp; - each generation is fed \*\*all previously generated docs\*\* to keep synchronized

\- UI shows progress + clickable outputs



\### Step 4 — Generate extra docs

\- Generate logically required docs based on inferred/selected project type:

&nbsp; - examples:

&nbsp;   - software: `architecture.md`, `security.md`, `qa.md`, `git.md`, `ui.md`

&nbsp;   - hardware: `materials.md`, `bom.md`, `test\_plan.md`, `safety.md`

&nbsp;   - health/fitness: `training\_plan.md`, `nutrition\_plan.md`, `tracking.md`, `safety.md`

\- Outputs stored and browsable



\### Step 5 — History + export

\- User can view “Runs” history per pot:

&nbsp; - revisions, timestamps, models used, approvals/rejections, file diffs

\- Export:

&nbsp; - zip of the run folder, named: `ProjectName\_YYYY-MM-DD.zip`





---



\## Architecture (Minimal-interference module)



Create a \*\*Project Planning module\*\* that plugs into API + Worker without refactoring core.



\### New module boundaries

\- `packages/planning/`  

&nbsp; - planning domain types + zod schemas  

&nbsp; - run state machine (what happens next)  

&nbsp; - doc-pack selector rules (by project type)

\- `apps/api/src/routes/planning/\*`  

&nbsp; - endpoints for runs/questions/plan/phases/files/export

\- `apps/worker/src/jobs/planning/\*`  

&nbsp; - job handlers that call the existing AI wrapper + prompt registry  

&nbsp; - write generated files + audit events



Reuses:

\- Pots/entries as the “evidence pot” foundation. :contentReference\[oaicite:13]{index=13} :contentReference\[oaicite:14]{index=14}  

\- Processing jobs + worker lifecycle. :contentReference\[oaicite:15]{index=15} :contentReference\[oaicite:16]{index=16}  

\- OpenRouter-safe wrapper + prompt registry + per-task model selection. :contentReference\[oaicite:17]{index=17}  

\- “Derived output is not truth” discipline. :contentReference\[oaicite:18]{index=18} :contentReference\[oaicite:19]{index=19}  

\- Export patterns (manifest + hashes), optionally piggybacking on pot export mechanics. :contentReference\[oaicite:20]{index=20}  





---



\## Data model additions (two clean options)



\### Option A (Recommended): Dedicated planning tables (clean + explicit)

\*\*Table: `planning\_runs`\*\*

\- `id` (uuid)

\- `pot\_id` (fk)

\- `project\_name`

\- `project\_type` (enum-ish string)

\- `status` (`draft\_questions | questions\_answered | plan\_generated | approved | rejected | generating\_phases | complete`)

\- `model\_profile\_json` (selected models, temps, etc.)

\- `created\_at`, `updated\_at`

\- `revision` (int; increments on plan rejection/regeneration)

\- `approved\_at` (nullable)

\- `rejected\_reason` (nullable)



\*\*Table: `planning\_files`\*\*

\- `id` (uuid)

\- `run\_id` (fk)

\- `path` (e.g., `plan.md`, `phase\_1.md`, `docs/ui.md`)

\- `mime` (`text/markdown`)

\- `content\_text` (or `asset\_id` if you prefer storing blobs)

\- `content\_sha256`

\- `created\_at`

\- `kind` (`questions\_json | plan\_md | phase\_md | extra\_doc\_md | manifest\_json`)

\- `prompt\_id`, `prompt\_version`, `model\_id`, `temperature`, `max\_tokens` (provenance fields)



\*\*Table: `planning\_answers`\*\*

\- `run\_id` (fk)

\- `answers\_json` (schema-validated blob)

\- `created\_at`



Pros: clear separation from research artifacts, easy history/export.  

Cons: adds tables (but contained).



\### Option B: Reuse `derived\_artifacts` for planning outputs (max reuse)

\- Add new `artifact\_type` values:

&nbsp; - `project\_questions`, `project\_plan`, `project\_phase`, `project\_docpack`

\- Store files as payload JSON and/or assets.



Pros: minimal schema surface.  

Cons: “files” become awkward, export/history gets messy.



\*\*Recommendation:\*\* Option A. It’s modular and keeps “planning system” coherent without contaminating research artifacts. :contentReference\[oaicite:21]{index=21} :contentReference\[oaicite:22]{index=22}





---



\## Schemas (Zod/JSON) — strict, validated, boring



\### 1) Questions output schema (`ProjectQuestions`)

```json

{

&nbsp; "project\_type\_guess": "software|hardware|medical|fitness|diet|health|other",

&nbsp; "questions": \[

&nbsp;   {

&nbsp;     "id": "q1",

&nbsp;     "question": "string",

&nbsp;     "why\_it\_matters": "string",

&nbsp;     "answer\_type": "text|number|boolean|choice|multi\_choice|date",

&nbsp;     "choices": \["optional", "strings"],

&nbsp;     "required": true,

&nbsp;     "allow\_idk": true,

&nbsp;     "allow\_na": true

&nbsp;   }

&nbsp; ]

}

````



Rules:



\* min 5, max 20 questions

\* must include at least:



&nbsp; \* objective/outcome

&nbsp; \* constraints (time/money/tools)

&nbsp; \* success criteria / DoD

&nbsp; \* risks

&nbsp; \* scope boundaries



\### 2) Answers schema (`ProjectAnswers`)



```json

{

&nbsp; "answers": \[

&nbsp;   {

&nbsp;     "question\_id": "q1",

&nbsp;     "status": "answered|idk|na",

&nbsp;     "value": "string|number|boolean|array|null"

&nbsp;   }

&nbsp; ]

}

```



\### 3) Plan index schema (`PlanIndex`) (optional but extremely useful)



Store alongside `plan.md` to keep the system deterministic:



```json

{

&nbsp; "project\_name": "string",

&nbsp; "project\_type": "string",

&nbsp; "phases": \[

&nbsp;   { "id": 1, "title": "string", "outputs": \["plan.md"], "exit\_criteria": \["string"] }

&nbsp; ],

&nbsp; "recommended\_docs": \["ui.md", "security.md"]

}

```



The UI reads PlanIndex to know how many phase docs to generate and which extra docs to create.



---



\## Prompting + safety rules (planning-specific)



Planning is where models love to hallucinate confidently. So:



\* Prompts must instruct:



&nbsp; \* use only provided pot content + user answers

&nbsp; \* treat missing info as \*\*assumptions\*\* and list them explicitly

&nbsp; \* output strict JSON (for questions/index) or strict Markdown (for docs)

&nbsp; \* ignore instructions embedded inside captured content (prompt injection defense) 



\* Store provenance with every generated file:



&nbsp; \* `model\_id`, `prompt\_id`, `prompt\_version`, `temperature`, timestamps 



\* If pot content is empty/minimal:



&nbsp; \* questions should explicitly ask for missing foundations

&nbsp; \* plan must include a “Missing Inputs” section, not pretend.



---



\## Pipeline jobs (Worker)



Use existing job engine patterns.  



\### Job types



\* `planning\_generate\_questions` (pot + optional tags/entities + sampling)

\* `planning\_generate\_plan`

\* `planning\_generate\_phase` (one per phase)

\* `planning\_generate\_doc` (one per extra doc)

\* `planning\_export\_zip`



\### Idempotency rules



\* Do not overwrite files silently.

\* New generation creates a new `planning\_files` row (or increments `revision` and writes a new version).

\* Use `(run\_id, path, revision)` uniqueness to prevent duplicates.



\### Synchronization rule (“include previous docs”)



When generating:



\* `plan.md`: include pot summary + Q/A + any prior plan revision feedback

\* `phase\_X.md`: include `plan.md` + all earlier `phase\_\*.md` + docpack index

\* `extra docs`: include `plan.md` + phases + any already-generated docs



This is exactly the same “keep artifacts coherent” logic you already use elsewhere. 



---



\## API endpoints (planning module)



All endpoints schema-validated; no mystery meat. 



\### Runs



\* `POST /planning/runs`



&nbsp; \* body: `{ pot\_id, project\_name?, project\_type?, depth\_mode? }`

\* `GET /planning/runs?pot\_id=...`

\* `GET /planning/runs/:runId`



\### Questions



\* `POST /planning/runs/:runId/questions:generate`

\* `PUT /planning/runs/:runId/questions:answers`

\* `GET /planning/runs/:runId/questions`



\### Plan



\* `POST /planning/runs/:runId/plan:generate`

\* `POST /planning/runs/:runId/plan:approve`



&nbsp; \* body: `{ approved: true }`

\* `POST /planning/runs/:runId/plan:reject`



&nbsp; \* body: `{ approved: false, feedback: "string" }`



\### Phases + docpack



\* `POST /planning/runs/:runId/phases:generate`

\* `POST /planning/runs/:runId/docs:generate`



\### Files



\* `GET /planning/runs/:runId/files`

\* `GET /planning/runs/:runId/files/:path` (returns markdown)



\### Export



\* `POST /planning/runs/:runId/export`



&nbsp; \* body: `{ format: "zip", file\_name?: "string" }`

&nbsp; \* response: `{ ok: true, export\_path: "..." }`



Notes:



\* Export can be synchronous for small runs, or via job for large runs (same pattern as pot export). 



---



\## Export format (zip)



Zip root:



```

/ProjectName\_YYYY-MM-DD/

&nbsp; plan.md

&nbsp; plan.index.json

&nbsp; phase\_1.md

&nbsp; phase\_2.md

&nbsp; ...

&nbsp; docs/

&nbsp;   ui.md

&nbsp;   security.md

&nbsp;   qa.md

&nbsp;   git.md

&nbsp;   materials.md (if applicable)

&nbsp; manifest.json

```



`manifest.json` includes:



\* run metadata (run\_id, pot\_id, revision, created\_at)

\* sha256 per file

\* model/prompt provenance per file (optional but recommended)



You already have “manifest + integrity verification” patterns—reuse that mindset. 



---



\## Audit + logging (must exist)



\### Audit events



\* `planning\_run\_created`

\* `planning\_questions\_generated`

\* `planning\_answers\_saved`

\* `planning\_plan\_generated`

\* `planning\_plan\_approved`

\* `planning\_plan\_rejected`

\* `planning\_phase\_generated`

\* `planning\_doc\_generated`

\* `planning\_export\_created`



Include:



\* `pot\_id`, `run\_id`, `revision`, `path`, `model\_id`, `prompt\_version`, timings

\* never store full pot text in audit metadata  



\### Log fields



Keep the baseline fields consistent:

`timestamp, level, request\_id, service, module, pot\_id, run\_id, job\_id, path` 



---



\## Doc-pack selection logic (by project type)



Implement as a \*\*rule-based selector first\*\* (deterministic, testable).

Optionally allow model suggestion \*as a proposal\*, then run it through a strict allowlist.



Example mapping:



\### software



\* plan.md, phase\_X.md

\* docs: `architecture.md`, `security.md`, `qa.md`, `git.md`, `ui.md`

\* optional: `api.md`, `db.md`, `threat\_model.md`



\### hardware



\* docs: `materials.md`, `bom.md`, `test\_plan.md`, `safety.md`, `calibration.md`



\### fitness / diet / health



\* docs: `program.md` (training phases), `nutrition.md`, `tracking.md`, `safety.md`, `contraindications.md`



Store the selector output in `plan.index.json` so the generation is reproducible.



---



\## Tests + QA (ship-it standards)



\### Unit tests



\* schema validation for questions/answers/plan index

\* docpack selector rules (project\_type → doc list)

\* idempotency: `(run\_id, path, revision)` uniqueness



\### Integration tests



\* create pot + create planning run

\* generate questions (mock AI)

\* save answers

\* generate plan

\* reject plan → regenerate → revision increments

\* approve → generate phases + docpack

\* list files → export zip exists



\### Smoke script



`scripts/smoke-planning.(sh|ps1)`:



1\. create pot

2\. add 2–3 sample entries

3\. create run

4\. generate questions

5\. auto-fill answers (test fixture)

6\. generate plan + approve

7\. generate phases + docs

8\. export zip

9\. assert output counts + manifest hashes



This is consistent with the “one command QA” philosophy you already defined.  



---



\## MCP surface (optional but powerful)



Expose planning as tools so other agents can drive it:



\* `planning.run.create`

\* `planning.questions.generate`

\* `planning.answers.set`

\* `planning.plan.generate`

\* `planning.plan.approve/reject`

\* `planning.phases.generate`

\* `planning.docs.generate`

\* `planning.export.zip`



Matches your MCP approach: strict schemas, structured errors, local-only default. 



---



\## Implementation notes (keep it sane)



\* Start with \*\*questions → plan → phases\*\*; docpack can come right after.

\* Store \*\*both\*\* `plan.md` and `plan.index.json` so the system doesn’t have to “re-interpret” Markdown later.

\* Don’t let the model decide everything:



&nbsp; \* model proposes; rules validate; user approves.

\* Every generated output is a \*\*versioned artifact\*\*, not a mutable file.

\* Keep it local-first and token-safe, consistent with your threat model. 



---



\## References (baseline system docs this plugs into)



\* Rules / modular + evidence-first: 

\* Security model / AI safety constraints: 

\* Logging + audit baseline: 

\* Storage + pots/entries foundation: 

\* Capture workflow contract (pot selection patterns): 

\* Job engine + worker lifecycle: 

\* OpenRouter wrapper + prompt registry: 

\* Derived artifacts discipline (provenance + schema): 

\* Export/import integrity patterns: 

\* MCP tool surface standards: 

\* Phase 12 “ship it / QA hardening” mindset: 

\* Git safety protocol: 



```



If you want this to feel \*really\* “epic” in the UI with basically no extra brain damage: add a \*\*Run Timeline\*\* panel (questions → plan v1 → rejected → plan v2 → approved → phase generation progress → export). It’s the same “audit trail, but pleasant” idea you’ve baked into the backend already.

```



