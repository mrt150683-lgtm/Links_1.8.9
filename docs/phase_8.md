````md

\# Phase\_8.md — Connection Finding (Link Discovery + Evidence-Backed Graph)



\## Purpose

Phase 8 turns “a pile of captured stuff” into \*\*a research accelerator\*\* by discovering relationships between entries:

\- generate candidate pairs cheaply (no AI)

\- use AI only to \*\*classify\*\* and \*\*justify\*\* relationships

\- store links as \*\*evidence-backed\*\* graph edges with provenance

\- keep it scalable and safe: no hallucinated claims, no silent overwrites



This phase enables:

\- “these two notes are about the same person”

\- “this entry supports/contradicts that claim”

\- “same event, different sources”

\- “shared entities / shared mechanism”



---



\## Definition of Done

Phase 8 is complete only when:



\### ✅ Candidate generation exists (non-AI)

\- The system generates candidate pairs based on:

&nbsp; - shared pot

&nbsp; - overlapping tags/entities

&nbsp; - similar keywords (cheap similarity)

&nbsp; - time proximity (optional)

\- Candidate generation is deterministic and testable.



\### ✅ AI relationship classification exists (evidence-first)

\- For candidate pairs, AI produces:

&nbsp; - link type

&nbsp; - confidence

&nbsp; - short rationale

&nbsp; - evidence excerpts from both entries

\- Output is strict JSON and schema validated.



\### ✅ Graph storage exists

\- Links stored in DB with uniqueness constraints to prevent duplicates.

\- Links can be queried by:

&nbsp; - entry id

&nbsp; - pot id

&nbsp; - link type

&nbsp; - confidence threshold



\### ✅ Performance and safety constraints

\- Link discovery is throttled (idle-time friendly).

\- AI is never used to “invent” links from nowhere—only to classify candidates.

\- All links store provenance and evidence excerpts.



\### ✅ Tests \& QA

\- Integration tests cover:

&nbsp; - candidate generation

&nbsp; - link classification on mocked AI

&nbsp; - link insertion + uniqueness handling

&nbsp; - graph query endpoints

\- Smoke script builds a tiny pot and confirms links appear.



\### ✅ Docs updated

\- `docs/pipeline.md` updated with link discovery jobs

\- `docs/security.md` updated with AI safety notes for linking

\- `docs/qa.md` updated

\- `CHANGELOG.md` updated



---



\## Key Concept: Two-Stage Linking

1\) \*\*Candidates (cheap, deterministic):\*\* “these might be related”

2\) \*\*Classifier (AI, constrained):\*\* “what type of relation, with evidence?”



This prevents the model from free-associating nonsense into your database.



---



\## Data Model Additions (Phase 8)



\### 1) `links` table (graph edges)

Table: `links`

\- `id` (TEXT uuid)

\- `pot\_id` (TEXT FK -> pots.id)

\- `src\_entry\_id` (TEXT FK -> entries.id)

\- `dst\_entry\_id` (TEXT FK -> entries.id)



Relationship fields:

\- `link\_type` (TEXT)

&nbsp; Enum (initial set):

&nbsp; - `same\_topic`

&nbsp; - `same\_entity`

&nbsp; - `supports`

&nbsp; - `contradicts`

&nbsp; - `references`

&nbsp; - `sequence`

&nbsp; - `duplicate`

&nbsp; - `other`

\- `confidence` (REAL 0..1)

\- `rationale` (TEXT, short)



Evidence:

\- `evidence\_json` (TEXT) // list of excerpts with offsets and which side



Provenance:

\- `model\_id` (TEXT)

\- `prompt\_id` (TEXT)         // e.g. link\_pair

\- `prompt\_version` (TEXT)

\- `temperature` (REAL)

\- `created\_at` (INTEGER epoch ms)



Uniqueness constraints (important):

\- prevent duplicates regardless of direction for undirected types:

&nbsp; - For undirected link types (`same\_topic`, `same\_entity`, `duplicate`):

&nbsp;   - store normalized order: `min(entry\_id), max(entry\_id)`

&nbsp;   - enforce `UNIQUE(pot\_id, link\_type, src\_entry\_id, dst\_entry\_id)` after normalization

\- For directed types (`supports`, `contradicts`, `references`, `sequence`):

&nbsp; - direction matters; keep as-is and enforce unique on the tuple



Indexes:

\- `idx\_links\_pot\_type\_conf`

&nbsp; - (pot\_id, link\_type, confidence)

\- `idx\_links\_src`

&nbsp; - (src\_entry\_id)

\- `idx\_links\_dst`

&nbsp; - (dst\_entry\_id)



\### 2) Optional: `link\_candidates` (recommended for audit/debug)

Storing candidates lets you re-run classification and tune heuristics.



Table: `link\_candidates`

\- `id` (TEXT uuid)

\- `pot\_id` (TEXT FK)

\- `src\_entry\_id` (TEXT)

\- `dst\_entry\_id` (TEXT)

\- `reason` (TEXT) // e.g. "shared\_entities", "shared\_tags", "keyword\_sim"

\- `score` (REAL)  // heuristic confidence

\- `created\_at` (INTEGER)

\- `status` (TEXT) // `new | processed | skipped`



Uniqueness:

\- normalized src/dst per pot:

&nbsp; - `UNIQUE(pot\_id, src\_entry\_id, dst\_entry\_id)`



Indexes:

\- `idx\_candidates\_status\_score`

&nbsp; - (status, score desc)



Phase 8 recommendation: include this table because it makes debugging “why did it link?” possible.



---



\## Candidate Generation (Phase 8)

\### Inputs available

\- entry text

\- derived artifacts from Phase 7:

&nbsp; - tags

&nbsp; - entities

&nbsp; - summaries



\### Heuristics (cheap and effective)

Generate candidates within the same pot using one or more:

1\) \*\*Shared entities overlap\*\*

&nbsp;  - if intersection size >= 1–2 (weighted by confidence)

2\) \*\*Shared tags overlap\*\*

3\) \*\*Keyword similarity\*\*

&nbsp;  - simple TF-IDF-ish or token overlap (Jaccard)

4\) \*\*Source URL match\*\*

&nbsp;  - same domain or same URL (useful for duplicates)

5\) \*\*Time proximity\*\*

&nbsp;  - captured within N hours/days (optional)



\### Limiting strategy (must exist)

\- Only generate up to K candidates per new entry (e.g., 20–50).

\- Prefer highest-scoring candidates.

\- Enforce a minimum heuristic score threshold.



\### Deterministic scoring (example)

`score = 0.6\*entity\_overlap + 0.3\*tag\_overlap + 0.1\*keyword\_overlap`

(Exact weights can change; keep versioned in code.)



---



\## Linking Jobs (Phase 8)



\### 1) `generate\_link\_candidates` (deterministic)

Triggered when Phase 7 artifacts exist OR when a new entry arrives.



Steps:

\- load entry’s entities/tags

\- fetch other recent entries in pot (cap to N to control cost)

\- compute candidate scores

\- insert into `link\_candidates` (dedupe by normalized pair)



\### 2) `classify\_link\_candidate` (AI constrained)

Triggered for top candidates:

\- takes one candidate pair

\- loads both entry texts (or summaries for speed, but texts preferred for evidence)

\- calls AI with strict JSON schema

\- validates output

\- writes to `links` table if confidence >= threshold

\- marks candidate processed/skipped



\### 3) `link\_discovery\_batch` (optional)

Pot-wide batch job:

\- generates candidates for a range, then processes top X



---



\## AI Schema (Phase 8)

Prompt output must match:



```json

{

&nbsp; "link\_type": "same\_topic|same\_entity|supports|contradicts|references|sequence|duplicate|other",

&nbsp; "confidence": 0.0,

&nbsp; "rationale": "string",

&nbsp; "evidence": \[

&nbsp;   {

&nbsp;     "side": "src|dst",

&nbsp;     "start": 0,

&nbsp;     "end": 0,

&nbsp;     "excerpt": "string"

&nbsp;   }

&nbsp; ]

}

````



Rules:



\* confidence 0..1

\* max 6 evidence snippets total

\* excerpts must be slices from provided text only

\* if model cannot justify, it must output:



&nbsp; \* `link\_type="other"`, low confidence, and rationale “insufficient evidence”



---



\## Prompting Rules (Phase 8)



Create prompt:



\* `packages/ai/prompts/link\_pair/v1.md`



Prompt must:



\* warn about prompt injection

\* instruct: only use the two provided texts

\* require evidence excerpts

\* output JSON only



Temperature:



\* default 0.2



---



\## API (Phase 8)



\### A) Query links for an entry



\#### `GET /entries/:entryId/links`



Query:



\* `min\_confidence` (default 0.6)

\* `type` optional

&nbsp; Returns:



```json

{

&nbsp; "entry\_id": "...",

&nbsp; "links": \[

&nbsp;   { "link\_type": "same\_entity", "confidence": 0.82, "other\_entry\_id": "...", "evidence": \[...] }

&nbsp; ]

}

```



\### B) Query pot graph summary



\#### `GET /pots/:potId/links`



Query:



\* `min\_confidence`

\* `type`

\* pagination

&nbsp; Returns link list.



\### C) Manual re-run



\#### `POST /entries/:entryId/link-discovery`



Body:



```json

{ "max\_candidates": 30, "force": false }

```



---



\## Storage Layer Changes



Add repos:



\* `linkCandidatesRepo`:



&nbsp; \* insertCandidate()

&nbsp; \* listNewCandidates()

&nbsp; \* markProcessed()

\* `linksRepo`:



&nbsp; \* insertLinkNormalized()

&nbsp; \* listLinksForEntry()

&nbsp; \* listLinksForPot()



Important:



\* Normalization rules implemented centrally to avoid duplicates.



---



\## Audit Events (Phase 8)



Write:



\* `link\_candidate\_generated`

\* `link\_candidate\_skipped\_low\_score`

\* `link\_classification\_started`

\* `link\_created`

\* `link\_skipped\_low\_confidence`

\* `link\_validation\_failed`



---



\## Tests (Phase 8)



\### Unit tests



\* candidate scoring determinism

\* normalization of src/dst for undirected types

\* schema validation for link output



\### Integration tests (required)



1\. Create pot + 3 entries with overlapping entities/tags (mock artifacts if needed).

2\. Generate candidates:



&nbsp;  \* verify `link\_candidates` inserted with expected count and sorted scoring.

3\. Mock AI classification response:



&nbsp;  \* candidate -> link inserted

4\. Uniqueness:



&nbsp;  \* re-run classification should not duplicate links

5\. API endpoints return links correctly.



\### Smoke script



`scripts/smoke-phase8.(sh|ps1)`:



1\. create pot

2\. create 3 entries with obvious shared subject

3\. ensure Phase 7 artifacts exist (can be mocked or run worker)

4\. run worker for Phase 8 jobs

5\. call `/entries/:id/links` and assert at least 1 link



---



\## QA Steps (Manual)



1\. Run API + worker

2\. Create entries with overlapping entities

3\. Trigger link discovery:



\* `curl -X POST http://localhost:<port>/entries/<entryId>/link-discovery -H "content-type: application/json" -d '{"max\_candidates":30}'`



4\. Fetch links:



\* `curl http://localhost:<port>/entries/<entryId>/links?min\_confidence=0.5`



---



\## Git Commit Plan (Phase 8)



1\. `feat(storage): add links + link\_candidates migrations`

2\. `feat(core): add link schema and prompt link\_pair/v1`

3\. `feat(worker): add generate\_link\_candidates job handler`

4\. `feat(worker): add classify\_link\_candidate handler using ai wrapper`

5\. `feat(api): add link query endpoints + manual discovery trigger`

6\. `test(linking): add phase 8 integration tests + smoke script`

7\. `docs: update pipeline, security, qa, changelog for phase 8`



---



\## Phase 8 Exit Criteria Checklist



\* \[ ] deterministic candidate generation works and is throttled

\* \[ ] AI classification constrained + schema validated

\* \[ ] links stored with evidence + provenance

\* \[ ] duplicates prevented via normalization/uniqueness

\* \[ ] link query endpoints work

\* \[ ] integration tests + smoke script pass

\* \[ ] docs + changelog updated



---



```

```



