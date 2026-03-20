# journal_plan.md — Daily Notes, Open Loops, Weekly/Monthly/Quarterly/Yearly Summaries (Evidence‑First)

## Purpose

Add a **Journal** layer that turns daily captured work into an **auditable narrative**:

- **Daily Notes**: “what I worked on today” (per‑pot and global)
- **Open Loops**: unresolved questions / TODOs detected from today’s captures (with citations)
- **Weekly Summary**: rolls up 7 daily notes into a brief summary + suggested topics to explore (with citations)
- **Monthly Summary**: rolls up weekly summaries (or daily notes) into a brief monthly summary + suggested topics (with citations)
- **Quarterly Summary**: rolls up 3 monthly summaries into a quarterly summary + suggested topics (with citations)
- **Yearly Summary**: rolls up 4 quarterly summaries into a yearly summary + suggested topics (with citations)

This must preserve Links’ core invariants:
- **Originals are immutable**
- **Derived artifacts are helpful, not truth**
- **Every claim must cite stored evidence**
- **No hard-coded artifact list** (must discover and include new feature artifacts automatically)

This plan is intentionally **open-ended**: if the builder discovers artifact types / features already implemented but missing here, the system must record them under `missing_or_unhandled` and the plan should be amended accordingly.

---

## Non‑negotiable principles

1) **Evidence-first journal**  
Journal content must be assembled only from stored records:
- entries (text/image/doc/link/transcript/etc.)
- derived artifacts (tags/entities/summaries/links/Q&A/etc.)
- job/audit metadata

2) **Generic over specific**  
The journal generator must:
- query the DB for **which entry types and artifact types exist**
- summarize what it finds
- include a “Missing/Unhandled” section when it detects artifact types that aren’t yet supported by the summarizer

3) **Per‑pot + global truths**  
Generate **all journal kinds** as:
- **per‑pot** (“Project X”)
- **global** (“overall across all pots”)

4) **Structured JSON, schema validated**  
Every journal output is stored only after strict schema validation.

5) **Idempotent + reproducible**  
Re-running journal jobs for the same period must not create duplicates:
- upsert by (scope, period_start, kind, prompt_version)
- preserve prior versions only when explicitly requested (e.g., “regenerate”)

6) **Dependency chain is explicit**  
Weekly references daily notes; monthly references weekly (or daily as fallback); quarterly references monthly; yearly references quarterly.  
If prerequisites are missing, jobs must either:
- enqueue prerequisites, or
- record “prerequisites_missing” in `missing_or_unhandled` and exit cleanly (configurable)

---

## Period computation rules (timezone-aware)

All period boundaries are computed using a configured IANA timezone (per scope, with sensible default).

- **Daily**: local-day window `[00:00, 24:00)` for `date_ymd`.
- **Weekly**: default is **the previous 7 complete days** ending on `week_end_ymd` (inclusive).  
  (Config option: ISO weeks Mon–Sun; but default stays “rolling 7 complete days” to avoid calendar debates.)
- **Monthly**: calendar month in local time (e.g., 2026‑02‑01 to 2026‑02‑28/29).
- **Quarterly**: calendar quarters (Q1 Jan–Mar, Q2 Apr–Jun, Q3 Jul–Sep, Q4 Oct–Dec).
- **Yearly**: calendar year (Jan 1–Dec 31).

DST note: always compute boundaries using timezone-aware date math, then convert to timestamps.

---

## Data model

### A) New tables (recommended)

#### `journal_entries`
Stores daily notes and all rollups (weekly/monthly/quarterly/yearly).

Fields (SQLite-ish):
- `id` TEXT (uuid)
- `kind` TEXT ENUM: `daily | weekly | monthly | quarterly | yearly`
- `scope_type` TEXT ENUM: `pot | global`
- `scope_id` TEXT nullable (pot_id when scope_type=pot)

Period:
- `period_start_ymd` TEXT `YYYY-MM-DD`
- `period_end_ymd` TEXT `YYYY-MM-DD` (inclusive; equals start for daily)

Meta:
- `timezone` TEXT (IANA, e.g., `Europe/London`)
- `created_at` INTEGER epoch ms

Provenance:
- `model_id` TEXT
- `prompt_id` TEXT
- `prompt_version` TEXT
- `temperature` REAL
- `max_tokens` INTEGER
- `input_fingerprint` TEXT (hash of input set: journal ids and/or entries/artifacts ids + versions)

Payload:
- `content_json` TEXT (validated JSON string)
- `citations_json` TEXT (validated JSON string; also embedded per item inside content_json)

Indexes:
- `(kind, scope_type, scope_id, period_start_ymd)`
- `(scope_type, scope_id, created_at)`

Uniqueness (idempotency):
- `UNIQUE(kind, scope_type, scope_id, period_start_ymd, prompt_id, prompt_version)`

#### Optional: `journal_config`
- scheduling preferences, timezone per scope
- inclusion/exclusion rules
- prompt overrides
- “dependency strictness” (hard require prerequisites vs allow fallback)

---

## Journal output schemas

### 1) Daily Note schema (v1)

**Top-level keys** are stable; everything else can evolve with `schema_version`.

```json
{
  "schema_version": 1,
  "date_ymd": "YYYY-MM-DD",
  "scope": { "type": "pot|global", "pot_id": "optional" },
  "headline": "1-sentence description of the day",
  "what_happened": [
    {
      "bullet": "Short factual bullet of work performed",
      "citations": [
        { "entry_id": "uuid", "artifact_type": "optional", "evidence": { "start": 0, "end": 120, "excerpt": "optional" } }
      ]
    }
  ],
  "open_loops": [
    {
      "text": "Unresolved question or TODO as written/clearly implied by evidence",
      "type": "todo|question|decision|bug|research",
      "priority": "low|med|high",
      "citations": [ { "entry_id": "uuid", "evidence": { "excerpt": "..." } } ]
    }
  ],
  "key_tags": [ { "tag": "string", "count": 3 } ],
  "key_entities": [ { "entity": "string", "type": "optional", "count": 2 } ],
  "notable_sources": [
    { "title": "optional", "url": "optional", "entry_id": "uuid", "citations": [ { "entry_id": "uuid" } ] }
  ],
  "related_links_graph": [
    { "link_id": "optional", "src_entry_id": "uuid", "dst_entry_id": "uuid", "link_type": "string", "confidence": 0.7 }
  ],
  "stats": {
    "entries_total": 0,
    "entries_by_type": { "text": 0, "image": 0, "doc": 0, "link": 0, "transcript": 0, "other": 0 },
    "artifacts_by_type": { "tags": 0, "summary": 0, "entities": 0, "qa": 0, "other": 0 }
  },
  "missing_or_unhandled": [
    {
      "detected_artifact_type": "string",
      "note": "Why it wasn't summarized (e.g., no handler yet, schema unknown)"
    }
  ],
  "next_suggested_actions": [
    {
      "suggestion": "Low-risk next step derived from open loops / recurring work",
      "citations": [ { "entry_id": "uuid" } ]
    }
  ]
}
```

Notes:
- “citations” are always **entry-centric** first; artifacts are optional references.
- Evidence spans are best-effort (required when available, optional otherwise).

---

### 2) Rollup Summary schema (weekly/monthly/quarterly/yearly) (v1)

To avoid 4 near-identical schemas, use a single rollup schema with a `kind` discriminator.

```json
{
  "schema_version": 1,
  "kind": "weekly|monthly|quarterly|yearly",
  "period_start_ymd": "YYYY-MM-DD",
  "period_end_ymd": "YYYY-MM-DD",
  "scope": { "type": "pot|global", "pot_id": "optional" },
  "headline": "Brief period summary",
  "highlights": [
    { "bullet": "Major progress outcome", "citations": [ { "journal_id": "uuid" } ] }
  ],
  "themes": [
    { "theme": "string", "evidence_days": ["YYYY-MM-DD"], "citations": [ { "journal_id": "uuid" } ] }
  ],
  "open_loops_rollup": [
    { "text": "Recurring/important open loop", "count": 3, "citations": [ { "journal_id": "uuid" } ] }
  ],
  "suggested_topics": [
    {
      "topic": "Topic worth exploring next period",
      "why": "Short rationale grounded in period patterns",
      "citations": [ { "journal_id": "uuid" } ]
    }
  ],
  "missing_or_unhandled": [
    { "detected_artifact_type": "string", "note": "Still not summarized this period" }
  ],
  "inputs": {
    "expected_children": 0,
    "found_children": 0,
    "child_kind": "daily|weekly|monthly|quarterly",
    "child_journal_ids": ["uuid"]
  }
}
```

Citations strategy:
- Weekly cites **daily journal IDs**.
- Monthly cites **weekly journal IDs** (fallback: daily).
- Quarterly cites **monthly journal IDs**.
- Yearly cites **quarterly journal IDs**.

This creates a clean evidence chain: year → quarter → month → week → day → entries.

---

## Journal generation jobs

### Job types

Add to `docs/pipeline.md`:

- `build_daily_journal_note`
- `build_weekly_journal_summary`
- `build_monthly_journal_summary`
- `build_quarterly_journal_summary`
- `build_yearly_journal_summary`

---

### A) Daily job — `build_daily_journal_note`

Inputs:
- `scope` (pot_id or global)
- `date_ymd`, `timezone`
- all **entries** captured within that day’s local-time window
- all **derived_artifacts** linked to those entries (latest per artifact_type + prompt_version rules)
- optionally: links created that day (graph edges)

Algorithm (high-level):
1) Compute day window `[start_ts, end_ts)` from `date_ymd + timezone`.
2) Fetch entries and minimal metadata (type, title, url, captured_at, sha/hash refs).
3) Fetch related derived artifacts. **Discover** artifact types via query:
   - `SELECT DISTINCT artifact_type FROM derived_artifacts WHERE entry_id IN (...)`
4) Build a compact “journal context bundle”:
   - top tags/entities + recent summaries
   - URLs and titles
   - Q&A artifacts (if present)
   - “unknown artifacts” list
5) Open Loops detection:
   - **Heuristic pass**: find candidate segments (TODO, “need to”, “fix”, question marks, “??”, “later”, etc.)
   - **Model pass**: produce structured open_loops items, restricted to candidates + citations only
6) Compose daily note JSON (schema validated).
7) Store as `journal_entries(kind=daily, scope=..., period_start_ymd=date_ymd)` with provenance + input_fingerprint.

Idempotency:
- upsert by unique key; if the input_fingerprint is unchanged, do nothing.

Failure handling:
- invalid JSON/schema => fail job, log, retry with backoff
- partial data (some artifacts missing) => still produce note; record missing artifacts in `missing_or_unhandled`

---

### B) Weekly job — `build_weekly_journal_summary`

Inputs:
- `scope` (pot_id or global)
- `period_start_ymd`, `period_end_ymd` (computed)
- `timezone`
- the daily journal entries in that date range

Algorithm:
1) Determine the 7-day window (rolling or ISO week per config).
2) Load daily notes’ `content_json`.
3) Summarize:
   - highlights, themes, recurring open loops
   - suggested topics to explore next week
4) Include persistent “missing/unhandled” artifact types seen across the week.
5) Store as `journal_entries(kind=weekly, ...)` with citations to daily journal IDs.

Idempotency:
- upsert by `(weekly, scope, period_start_ymd, prompt_id, prompt_version)`

---

### C) Monthly job — `build_monthly_journal_summary`

Inputs:
- `scope`
- calendar month boundaries in timezone
- weekly summaries (preferred) OR daily notes (fallback)

Algorithm:
1) Compute month start/end.
2) Try load weekly summaries fully contained in month.
3) If missing, either:
   - enqueue missing weekly jobs, or
   - fallback to daily notes for that month (configurable)
4) Summarize; cite child journal IDs.
5) Store as `kind=monthly`.

---

### D) Quarterly job — `build_quarterly_journal_summary`

Inputs:
- `scope`
- quarter boundaries
- 3 monthly summaries

Algorithm:
1) Compute quarter start/end.
2) Load monthly summaries; if missing, enqueue or record missing.
3) Summarize; cite monthly journal IDs.
4) Store as `kind=quarterly`.

---

### E) Yearly job — `build_yearly_journal_summary`

Inputs:
- `scope`
- year boundaries
- 4 quarterly summaries

Algorithm:
1) Compute year start/end.
2) Load quarterly summaries; if missing, enqueue or record missing.
3) Summarize; cite quarterly journal IDs.
4) Store as `kind=yearly`.

---

## Prompts (evidence-first)

### Prompt: daily journal note (`prompt_id: journal_daily_v1`)
Hard constraints:
- Use only provided material.
- Do not invent tasks, conclusions, or sources.
- Every bullet must include at least 1 citation.
- Open loops must be either:
  - explicitly written in evidence, or
  - a direct, minimal restatement of an explicit question/todo

### Prompt: rollup summary (`prompt_id: journal_rollup_v1`)
Hard constraints:
- Use only the provided child journal notes.
- Citations must reference `journal_id` children.
- Suggested topics must be framed as “worth exploring” not asserted facts.

All prompts must:
- be versioned
- output strict JSON only
- be schema validated before storage

---

## API surface (minimal)

### Read endpoints
- `GET /journal/daily?date=YYYY-MM-DD&scope=global`
- `GET /pots/:potId/journal/daily?date=YYYY-MM-DD`

- `GET /journal/weekly?end=YYYY-MM-DD&scope=global`
- `GET /pots/:potId/journal/weekly?end=YYYY-MM-DD`

- `GET /journal/monthly?month=YYYY-MM&scope=global`
- `GET /pots/:potId/journal/monthly?month=YYYY-MM`

- `GET /journal/quarterly?year=YYYY&q=1-4&scope=global`
- `GET /pots/:potId/journal/quarterly?year=YYYY&q=1-4`

- `GET /journal/yearly?year=YYYY&scope=global`
- `GET /pots/:potId/journal/yearly?year=YYYY`

### Optional utility endpoints
- `POST /journal/rebuild` (kind + date range + scope)

All endpoints must:
- validate inputs
- return structured JSON
- include provenance + citations in response

---

## Scheduling

Default schedule (configurable; computed in scope timezone):
- Daily notes: generate for **yesterday** shortly after local midnight (e.g., 00:15).
- Weekly summary: run once per week (e.g., Monday 00:30) summarizing the previous 7 complete days.
- Monthly summary: run on the 1st of the month (e.g., 00:45) summarizing the **previous calendar month**.
- Quarterly summary: run on the 1st day of the quarter (e.g., 01:00) summarizing the **previous quarter**.
- Yearly summary: run on Jan 1 (e.g., 01:15) summarizing the **previous year**.

Offline/backfill:
- On startup, backfill missing daily notes for recent days (bounded).
- If a rollup is missing, enqueue prerequisites first (bounded) or record missing.

Late-arriving entries:
- If entries arrive after a daily note is created, the system may either:
  - regenerate on demand, or
  - run a “daily delta” job that appends a supplemental note (optional; not required for MVP)

---

## Tests, QA, and Definition of Done

### ✅ Data model & migrations
- journal tables created
- uniqueness constraints enforce idempotency
- indexes support queries

### ✅ Job execution
- daily per‑pot + global notes generate correctly
- weekly/monthly/quarterly/yearly rollups generate when prerequisites exist
- rollups cite child journal IDs, not raw entries by default

### ✅ Schema validation
- invalid model output never reaches DB

### ✅ Evidence requirements
- daily note bullets always include citations
- open loops always include citations
- rollups always cite child journals

### ✅ Extensibility / missing-feature tolerance
- journal generation enumerates unknown artifact types and records them under `missing_or_unhandled`
- system remains functional even when new artifact types appear

### ✅ Integration tests
- create entries across multiple pots + global
- generate daily (pot + global)
- generate weekly (pot + global)
- generate monthly (pot + global)
- generate quarterly (pot + global)
- generate yearly (pot + global)
- verify idempotent upserts (rerun job, no duplicates)

### ✅ Smoke scripts
- `scripts/smoke-journal-daily.ts`
- `scripts/smoke-journal-rollup.ts` (kind=weekly/monthly/quarterly/yearly)

### ✅ Docs updated
- `docs/pipeline.md` job types added
- `docs/architecture.md` add Journal module description
- `docs/security.md` include journal provenance + data leakage notes
- `docs/qa.md` add curl steps

---

## Security & privacy notes

- Journal entries are derived content: treat them as potentially sensitive (they summarize sensitive sources).
- Do not embed raw secrets or tokens in journal output.
- Ensure logs redact prompt content if it contains sensitive excerpts (or keep excerpts minimal).
- Export/import: include journal entries in exports (optional flag), preserving provenance.

---

## Future enhancements (explicitly optional)
Not required for initial Journal MVP:
- manual pinning of a daily note
- “next session primer” panel from latest daily note
- trend charts (counts, tags, entities) over time
- semantic search over journal entries (FTS)
- user edits to journal notes (store as separate “user_note” overlay, never overwriting generated record)


---

## Module boundary (minimal interference)

Yes: **Journal is a separate module** that plugs into existing architecture with the smallest possible surface area.

### Placement
- Worker: `modules/journal/*` (or `packages/journal/*` if you’re splitting packages later)
- API: `routes/journal/*` (read-only endpoints + optional rebuild endpoints)
- DB: one new table `journal_entries` (+ optional `journal_config`), via standard migrations
- Prompts: prompt registry entries `journal_daily_v1`, `journal_rollup_v1`

### Allowed integration points (the only places Journal touches “core”)
1) **Pipeline job registry**: add job types for daily/weekly/monthly/quarterly/yearly.
2) **DB migrations**: create journal tables + indexes + uniqueness constraints.
3) **Scheduler/idle loop**: a lightweight “missing journal detector” that enqueues jobs (and does nothing if disabled).
4) **API routes**: read endpoints for journal retrieval (+ optional rebuild).
5) **Settings**: read config from `user_prefs` (key/value store) before enqueueing or running any job.

### Hard rule
Journal jobs **must never block** capture/ingest or core processing. If Journal fails, the rest of the system continues.

---

## Settings / Token Guardrails (new “Processing Config” section)

Goal: allow you to toggle features to avoid unwanted token burn.

### Storage (consistent with Phase 3)
Use `user_prefs` (single-row key/value store) with a single JSON blob:

Key: `processing.config`

Value example:
```json
{
  "journal": {
    "enabled": true,
    "scopes": { "global": true, "pots": true },
    "daily": { "enabled": true, "open_loops": true, "time_local": "00:15" },
    "rollups": {
      "weekly":   { "enabled": true, "time_local": "00:30", "mode": "rolling7" },
      "monthly":  { "enabled": true, "time_local": "00:45" },
      "quarterly":{ "enabled": true, "time_local": "01:00" },
      "yearly":   { "enabled": true, "time_local": "01:15" }
    },
    "budgets": {
      "max_entries_per_day": 200,
      "max_chars_per_entry": 12000,
      "max_total_chars": 300000,
      "max_tokens_daily_job": 1800,
      "max_tokens_rollup_job": 2200,
      "max_jobs_per_startup_backfill": 7
    },
    "models": {
      "daily_model": "default",
      "rollup_model": "default"
    },
    "behavior": {
      "enqueue_prerequisites": true,
      "allow_rollup_fallback_to_daily": true
    }
  }
}
```

Notes:
- Keep this `processing.config` blob extensible; you can add future feature toggles here without redesigning settings storage.
- Defaults should be conservative: Journal can default **off** unless you explicitly enable it.

### UI placement (as you requested)
Settings screen order:
1) AI Provider
2) Idle Processing
3) **Processing Config** (new)
   - Journal (enable/disable)
   - Scope toggles (global / per-pot)
   - Daily Note + Open Loops toggles
   - Rollup toggles (weekly/monthly/quarterly/yearly)
   - Budget sliders/inputs (token and size caps)

### Runtime behavior when disabled
- Scheduler does not enqueue journal jobs.
- Job runner re-checks `processing.config.journal.enabled` at start:
  - if disabled: mark job as skipped (`done` with `skipped_reason`) and do not call models.
- Read endpoints still return existing journal entries (no deletion unless separately requested).

---

## Additional “skip-safe” job semantics (recommended)

To keep interference minimal and prevent surprise token use:
- Each journal job writes a short audit record:
  - `status: done|failed|skipped`
  - `skipped_reason` (disabled, budget exceeded, prerequisites missing, etc.)
- Budget enforcement happens **before** any model call:
  - if too many entries / chars: either truncate inputs deterministically or skip with a clear reason.

