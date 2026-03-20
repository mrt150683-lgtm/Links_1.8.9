# Links Feature Test Plan
**Version:** 1.8.4 | **Branch:** dev | **Last updated:** 2026-03-17

---

## How to Use This Document in a Fresh Chat

Paste this at the start of any new session:

> "I'm working through the Links feature test plan at `docs/feature-test-plan.md`. The app is at v1.8.4 on the `dev` branch. Please read that file and then help me test [feature name]."

The doc is self-contained: it describes every feature, its processing flow, how to trigger it, and what a passing result looks like. Tick off items as each feature is confirmed working.

---

## Current System State

| Item | Value |
|---|---|
| Version | 1.8.4 |
| Branch | dev |
| Latest commit | `cbf21e1` — Merge branch 'cronjobs_heartbeat_implement' into dev |
| Database | SQLite (migrations 001–046 applied) |
| Latest migration | `046_heartbeat.sql` (heartbeat_snapshots, heartbeat_documents) |
| API | Fastify, `apps/api` |
| Worker | Daemon + once-mode, `apps/worker` |
| Frontend | Electron launcher (`apps/launcher`) |

### What Phase 0 (Flow Spec) Added
The system now has end-to-end correlation infrastructure. Every processing flow gets a shared `flow_id` that threads through:
- `processing_jobs.flow_id` — all jobs in a chain share one ID
- `audit_events.job_id` — every audit row knows which job wrote it
- `flow_runs` table — checkpoint record: status (`started`/`completed`/`failed`/`partial`), timestamps, last stage/event, error summary
- `main_chat_notifications.flow_id` — the terminal notification links back to its flow
- `FlowEvent` registry in `@links/logging` — stable machine-readable event names (e.g. `TAG_ENTRY_STARTED`, `FLOW_COMPLETED`)
- `logFlowEvent(logger, fields)` — structured log helper with `event`, `status`, `flow_id`, `duration_ms`

> **Note:** Phase 0 is infrastructure only. The individual flows (doc upload, image upload, calendar, etc.) will be wired to actually use `flow_id` in subsequent sessions (Flows 1–7 in the implementation roadmap). The tables and repo functions exist and compile; no flow has been connected yet.

---

## How Flow Analysis Works

### Reading a flow

Every user-visible action generates a `flow_id` (UUID). To trace a complete flow:

```sql
-- 1. Find the flow run
SELECT * FROM flow_runs WHERE id = '<flow_id>';

-- 2. All jobs in the flow
SELECT id, job_type, status, flow_id FROM processing_jobs WHERE flow_id = '<flow_id>';

-- 3. Audit events per job
SELECT * FROM audit_events WHERE job_id = '<job_id>';

-- 4. Terminal notification
SELECT * FROM main_chat_notifications WHERE flow_id = '<flow_id>';
```

### Reading log output

Flow events appear in structured JSON logs:
```json
{
  "level": "info",
  "event": "TAG_ENTRY_COMPLETED",
  "status": "COMPLETED",
  "flow_id": "abc123",
  "job_id": "job-uuid",
  "entry_id": "entry-uuid",
  "duration_ms": 1240
}
```

### Stable event names (FlowEvent registry)

| Event | Meaning |
|---|---|
| `DOC_UPLOAD_STARTED` | Asset route received doc upload |
| `TEXT_EXTRACT_STARTED/COMPLETED` | extractText job |
| `IMAGE_UPLOAD_STARTED` | Asset route received image upload |
| `TAG_ENTRY_STARTED/COMPLETED` | tagEntry job |
| `ENTITY_EXTRACT_STARTED/COMPLETED` | extractEntities job |
| `SUMMARIZE_STARTED/COMPLETED` | summarizeEntry job |
| `LINK_CANDIDATES_STARTED/COMPLETED` | generateLinkCandidates job |
| `LINK_CLASSIFY_COMPLETED` | classifyLinkCandidate job |
| `CALENDAR_NOTIFICATION_EMITTED` | calendarEmitDailyNotification job |
| `JOB_STARTED/COMPLETED/FAILED` | Worker lifecycle (every job) |
| `FLOW_COMPLETED/FAILED` | Terminal event for whole flow |

---

## Processing Architecture Quick Reference

```
User action (API route)
  ↓  generates flow_id, creates flow_run, enqueues first job with flow_id
Worker daemon claims job (passes flowId into JobContext)
  ↓  job handler runs 10-step pattern:
     validate → load entry → get prefs → resolve role → load prompt
     → build messages → call AI → parse/validate → store artifact → chain job
  ↓  next job enqueued with same flow_id
  ...chain continues until terminal job
Terminal job
  ↓  completeFlowRun(flowId)
  ↓  createMainChatNotification({ flow_id })
  ↓  logFlowEvent FLOW_COMPLETED
```

### Job chaining map

```
Text entry captured
  └─ [idle_processing_scan detects] ──→ tag_entry
                                           └─→ extract_entities
                                           └─→ summarize_entry
                                                  └─→ generate_link_candidates
                                                         └─→ classify_link_candidate (×N)

Doc/audio uploaded
  └─ extract_text ──→ tag_entry ──→ (same as above)

Image uploaded
  └─ tag_entry (vision) ──→ summarize_entry (vision) ──→ ...

Video URL submitted
  └─ transcribe_video ──→ tag_entry ──→ (text chain)

Entry processed
  └─ extract_dates ──→ calendar_sync
  └─ dyk_generate_for_entry ──→ [dyk_inbox_tick emits notification]

Post-journal
  └─ build_daily_journal_note ──→ generate_nudges

Intelligence
  └─ intel_generate_questions ──→ intel_answer_question (×N)

Deep research
  └─ deep_research_plan ──→ deep_research_execute
       └─ deep_research_delta ──→ deep_research_novelty ──→ deep_research_links
```

---

## Feature Test Checklist

**Status key:** `[ ]` not tested · `[x]` passed · `[!]` failed/issue found · `[-]` skipped/N/A

---

### 1. Pot Management

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 1.1 | Create pot | `POST /pots` `{"name":"Test"}` | 201, pot object returned | [ ] |
| 1.2 | List pots | `GET /pots` | 200, array | [ ] |
| 1.3 | Get pot | `GET /pots/:id` | 200, pot with role/goal fields | [ ] |
| 1.4 | Update pot | `PATCH /pots/:id` `{"name":"Renamed"}` | 200, updated name | [ ] |
| 1.5 | Pot settings | `PUT /pots/:id/settings` `{"goal_text":"...", "search_targets":["web"]}` | 200, settings saved | [ ] |
| 1.6 | Pot role | `PUT /pots/:id/role` with role JSON | 200, role_hash set | [ ] |
| 1.7 | Delete pot | `DELETE /pots/:id` | 204 | [ ] |
| 1.8 | Onboarding flow | `GET /pots/:id/onboarding` → update steps → complete | Steps progress correctly | [ ] |

---

### 2. Text Entry Capture

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 2.1 | Create text entry | `POST /pots/:id/entries/text` with content | 201, entry_id returned | [ ] |
| 2.2 | Idempotency | Same content twice via `POST /capture/text` with same `client_capture_id` | Second request returns existing entry, `deduped: true` | [ ] |
| 2.3 | Hash dedup | Same text content different client_id, within 24h window | `deduped: true, dedupe_reason: hash_window` | [ ] |
| 2.4 | List entries | `GET /pots/:id/entries` | Array of entries | [ ] |
| 2.5 | Get entry | `GET /entries/:id` | Entry object | [ ] |
| 2.6 | Nudge enqueued | After text capture | `generate_nudges` job appears in `GET /jobs` | [ ] |

---

### 3. Document Upload

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 3.1 | Upload PDF | `POST /pots/:id/docs` multipart with .pdf | 201, asset_id + entry_id | [ ] |
| 3.2 | SHA-256 dedup | Upload same file twice | Second returns existing asset, no duplicate entry | [ ] |
| 3.3 | extract_text job | After doc upload | `extract_text` job enqueued; after completion, `extracted_text` artifact exists | [ ] |
| 3.4 | Text → tag chain | After extract_text completes | `tag_entry` job queued automatically | [ ] |
| 3.5 | Full pipeline | Wait for all jobs | `tags`, `entities`, `summary` artifacts all present on `GET /entries/:id/artifacts` | [ ] |
| 3.6 | Asset download | `GET /assets/:id/download` | Decrypted file returned with correct MIME | [ ] |

---

### 4. Image Upload

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 4.1 | Upload image | `POST /pots/:id/images` multipart | 201, asset + entry created | [ ] |
| 4.2 | tag_entry (vision) | After upload | `tag_entry` queued; AI uses vision model for image | [ ] |
| 4.3 | summarize_entry (vision) | After tag | `summarize_entry` queued; summary uses image base64 | [ ] |
| 4.4 | Artifacts present | After full pipeline | `tags` + `summary` artifacts on entry | [ ] |

---

### 5. Audio Upload

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 5.1 | Upload audio | `POST /pots/:id/audio` multipart | 201, audio entry + asset | [ ] |
| 5.2 | Transcription job | After upload | `extract_text` queued; uses OpenRouter audio input | [ ] |
| 5.3 | Transcript stored | After job | `extracted_text` artifact with full transcript | [ ] |
| 5.4 | Chain continues | After transcript | `tag_entry` → `entities` → `summary` artifacts generated | [ ] |

---

### 6. Video Capture

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 6.1 | Submit video URL | `POST /pots/:id/videos` `{"url":"https://youtube.com/..."}` | 201, link entry + `transcribe_video` job queued | [ ] |
| 6.2 | Transcription | After job runs | Doc entry created with transcript content | [ ] |
| 6.3 | YouTube MHTML | `POST /pots/:id/links` with MHTML capture | `parse_youtube_html` job → tag chain | [ ] |

---

### 7. AI Tagging & Entity Extraction

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 7.1 | Tag entry | Manually `POST /entries/:id/process` `{"job_type":"tag_entry"}` | `tags` artifact created, schema valid | [ ] |
| 7.2 | Tags structure | `GET /entries/:id/artifacts/tags/latest` | `{"tags":[{"label":"...","confidence":0.x}]}` | [ ] |
| 7.3 | Entity extraction | After tag_entry chains | `entities` artifact created | [ ] |
| 7.4 | Entity structure | `GET /entries/:id/artifacts/entities/latest` | `{"entities":[{"name":"...","type":"PERSON",...}]}` | [ ] |
| 7.5 | Role injection | Pot has role set → trigger tag | Tags artifact has `role_hash` field matching pot's role_hash | [ ] |

---

### 8. Summarization

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 8.1 | Summary generated | After entity chain | `summary` artifact created | [ ] |
| 8.2 | Summary structure | `GET /entries/:id/artifacts/summary/latest` | Has `summary`, `claims` with evidence excerpts | [ ] |
| 8.3 | Evidence validation | Check claim excerpts | Each excerpt verbatim in entry content | [ ] |

---

### 9. Link Discovery

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 9.1 | Generate candidates | `POST /entries/:id/links/trigger` or auto after summarize | `generate_link_candidates` job runs | [ ] |
| 9.2 | Candidates created | After job | `GET /pots/:id/link-candidates` returns candidates with scores | [ ] |
| 9.3 | Classify candidates | After candidates | `classify_link_candidate` jobs run for each | [ ] |
| 9.4 | Links stored | After classification | `GET /entries/:id/links` returns links with confidence ≥ 0.5 | [ ] |
| 9.5 | Evidence valid | Check link evidence | Each evidence excerpt verbatim in respective entry | [ ] |

---

### 10. Pot Chat (Sentry)

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 10.1 | Send message | `POST /pots/:id/chat/send` `{"message":"..."}` | AI response based on pot contents | [ ] |
| 10.2 | Thread persisted | After send | `GET /pots/:id/chat/threads` lists thread | [ ] |
| 10.3 | Strict mode | Send with `knowledge_mode:"strict"` | Response only cites found evidence | [ ] |
| 10.4 | Open mode | Send with `knowledge_mode:"open"` | Response uses general knowledge too | [ ] |
| 10.5 | Goal injected | Pot has `goal_text` set | System prompt includes goal before research context | [ ] |

---

### 11. Main Chat (Global Assistant)

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 11.1 | Send message | `POST /main-chat/send` `{"message":"..."}` | Cross-pot AI response | [ ] |
| 11.2 | Context pack | `GET /main-chat/context-pack` | Returns active pots + recent entries | [ ] |
| 11.3 | Thread list | `GET /main-chat/threads` | Lists threads | [ ] |

---

### 12. DYK — Did You Know Insights

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 12.1 | Generate DYK | `dyk_generate_for_entry` runs after summarize | DYK item created in `dyk_items` | [ ] |
| 12.2 | List DYK | `GET /pots/:id/dyk` | Returns items with novelty/confidence scores | [ ] |
| 12.3 | Deduplication | Same insight twice | Signature match → no duplicate stored | [ ] |
| 12.4 | DYK notification | `dyk_inbox_tick` runs | Notification emitted, `GET /pots/:id/dyk/inbox` returns it | [ ] |
| 12.5 | Feedback | `POST /dyk/:id/feedback` `{"action":"interested"}` | Status updated, feedback event recorded | [ ] |

---

### 13. Calendar

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 13.1 | Manual event | `POST /calendar/events` with start_at | Event created, appears in range query | [ ] |
| 13.2 | Range query | `GET /calendar/range?from=&to=` | Events + entry_date counts | [ ] |
| 13.3 | Date extraction | Entry with dates → `extract_dates` job | `date_mentions` artifact + `calendar_entry_dates` rows | [ ] |
| 13.4 | Calendar sync | After extract_dates chains | `calendar_sync` job links entry dates | [ ] |
| 13.5 | Daily notification | `calendar_scheduler` runs → `calendar_emit_daily_notification` | One notification per day, idempotent | [ ] |
| 13.6 | Notifications list | `GET /calendar/notifications` | Today's notification listed | [ ] |
| 13.7 | Mark read | `POST /calendar/notifications/:id/read` | `read_at` set | [ ] |

---

### 14. Journal

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 14.1 | Daily note | `GET /journal/daily?date=YYYY-MM-DD` (triggers build if missing) | Journal entry object with sections | [ ] |
| 14.2 | Pot-scoped daily | `GET /pots/:id/journal/daily?date=YYYY-MM-DD` | Pot-filtered journal | [ ] |
| 14.3 | Weekly rollup | `GET /journal/weekly?start=YYYY-MM-DD` | Summary cites daily child journal IDs | [ ] |
| 14.4 | Monthly rollup | `GET /journal/monthly?month=YYYY-MM` | Summarises weekly notes | [ ] |
| 14.5 | Journal nudge | After daily note → `generate_nudges` | MainChat notification of type `insight` | [ ] |

---

### 15. Intelligence Generation

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 15.1 | Start run | `POST /pots/:id/intelligence/generate` `{"mode":"full"}` | Run created, `intel_generate_questions` queued | [x] |
| 15.2 | Questions generated | After job | `GET /pots/:id/intelligence/questions` → list of N questions | [x] |
| 15.3 | Answers generated | `intel_answer_question` jobs run | Each question has answer with confidence + evidence | [x] |
| 15.4 | Evidence valid | Check answer evidence | Excerpts verbatim in entry content | [x] |
| 15.5 | Custom prompt | Pass `custom_prompt` to generate | Questions reflect focus area | [x] |
| 15.6 | Dedup | Run same pot twice | Known questions deduplicated via signature | [x] |

---

### 16. Deep Research Agent

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 16.1 | Create run | `POST /research/runs` `{"goal_prompt":"...","auto_approve_plan":true}` | Run in 'draft' → 'queued' | [ ] |
| 16.2 | Plan generated | `deep_research_plan` job | Plan artifact, run → 'awaiting_approval' | [ ] |
| 16.3 | Manual approve | `POST /research/runs/:id/plan/approve` | Run → 'queued', `deep_research_execute` enqueued | [ ] |
| 16.4 | Execution | `deep_research_execute` runs | Run → 'running', checkpoint saved periodically | [ ] |
| 16.5 | Report generated | After execute → delta → novelty chain | `GET /research/runs/:id/report` returns report artifact | [ ] |
| 16.6 | Cancel run | `POST /research/runs/:id/cancel` | Run → 'cancelled', jobs stop | [ ] |
| 16.7 | Resume paused | Budget exceeded → paused; `POST .../resume` | Resumes from checkpoint | [ ] |
| 16.8 | Schedule | `PUT /research/schedules/:potId` with config | `deep_research_scheduler` triggers run automatically | [ ] |

---

### 17. Project Planning

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 17.1 | Create run | `POST /planning/runs` | Run in 'draft' | [ ] |
| 17.2 | Generate questions | `POST .../questions/generate` | Questions artifact created | [ ] |
| 17.3 | Save answers | `PUT .../questions/answers` | Answers stored, run → 'answers_recorded' | [ ] |
| 17.4 | Generate plan | `POST .../plan/generate` | Plan artifact created, run → 'plan_generated' | [ ] |
| 17.5 | Approve plan | `POST .../plan/approve` | Run → 'approved' | [ ] |
| 17.6 | Generate phases | `POST .../phases/generate` | Phase artifacts created | [ ] |
| 17.7 | Generate docs | `POST .../docs/generate` | Doc artifacts created | [ ] |
| 17.8 | Export ZIP | `POST .../export` | ZIP file downloadable | [ ] |

---

### 18. Browser Integration

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 18.1 | Add shelf item | `POST /browser/shelf` | Item saved | [ ] |
| 18.2 | List shelf | `GET /browser/shelf` | Items returned | [ ] |
| 18.3 | Create group | `POST /browser/groups` | Group with color/name | [ ] |
| 18.4 | Session management | `POST /browser/sessions` | Session saved with tab snapshot | [ ] |
| 18.5 | History | `POST /browser/history` with URL | Visit recorded | [ ] |

---

### 19. Nudges & Main Chat Notifications

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 19.1 | New entry nudge | Capture 3+ entries, let `generate_nudges` run | `triage` notification in main chat | [ ] |
| 19.2 | Greeting nudge | `generate_nudges` with trigger=greeting | Time-appropriate greeting notification | [ ] |
| 19.3 | Journal nudge | After daily journal builds | `insight` notification | [ ] |
| 19.4 | Notification list | `GET /main-chat/notifications` | Unread notifications listed | [ ] |
| 19.5 | Mark state | `PATCH /main-chat/notifications/:id` | State updated (opened/dismissed/snoozed) | [ ] |

---

### 20. Style Personalization (Dictionize)

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 20.1 | Job enqueued | After chat with enough messages | `dictionize_user_style` queued (20min delay) | [ ] |
| 20.2 | Profile built | After dictionize job | `user_prefs.style_profile` KV entry exists | [ ] |
| 20.3 | Style hints injected | Next chat send | System prompt contains `## Style Hints` block | [ ] |
| 20.4 | Decay applied | Run dictionize again after 60d | Stale phrases removed if count < 3 | [ ] |

---

### 21. Search

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 21.1 | Full-text search | `GET /pots/:id/search?q=keyword` | Matching entries + artifacts returned | [ ] |
| 21.2 | Type filter | Add `type=image` | Only image entries returned | [ ] |
| 21.3 | Confidence filter | Add `min_confidence=0.7` | Only high-confidence matches | [ ] |

---

### 22. Job Queue & Worker

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 22.1 | List jobs | `GET /jobs` | All jobs with status | [ ] |
| 22.2 | Job details | `GET /jobs/:id` | Job + logs | [ ] |
| 22.3 | Cancel job | `POST /jobs/:id/cancel` | Job → 'canceled' | [ ] |
| 22.4 | Requeue dead | `POST /jobs/requeue-all-dead` | Dead jobs reset to queued | [ ] |
| 22.5 | flow_id propagates | Enqueue job with flow_id, then check DB | `processing_jobs.flow_id` set | [ ] |
| 22.6 | job_id in audit | After job completes | `audit_events` rows have `job_id` column set | [ ] |

---

### 23. Flow Runs (Phase 0 Infrastructure)

> **Note:** These test the raw infrastructure added in v1.7.17. Individual flows (doc upload, image, etc.) are not yet wired to use flow_id — that happens in subsequent implementation sessions. Test infrastructure correctness here.

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 23.1 | flow_runs table exists | `SELECT * FROM flow_runs LIMIT 1` in SQLite | Table exists (may be empty) | [ ] |
| 23.2 | flow_id column on jobs | `SELECT flow_id FROM processing_jobs LIMIT 1` | Column exists, nullable | [ ] |
| 23.3 | job_id column on audits | `SELECT job_id FROM audit_events LIMIT 1` | Column exists, nullable | [ ] |
| 23.4 | flow_id on notifications | `SELECT flow_id FROM main_chat_notifications LIMIT 1` | Column exists, nullable | [ ] |
| 23.5 | createFlowRun works | Direct API call (when wired) or unit test | Row inserted in flow_runs | [ ] |
| 23.6 | logFlowEvent emits JSON | Check worker log output for any flow event | JSON line with `event`, `status`, `flow_id` fields | [ ] |

---

### 24. Preferences & Configuration

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 24.1 | AI prefs | `GET /prefs/ai` | Returns model config | [ ] |
| 24.2 | Set AI model | `PUT /prefs/ai` `{"default_model":"..."}` | Model persisted | [ ] |
| 24.3 | OpenRouter key | `PUT /prefs/openrouter-key` `{"key":"sk-..."}` | Key stored securely | [ ] |
| 24.4 | Idle config | `GET/PUT /prefs/idle` | Idle processing preferences | [ ] |
| 24.5 | Processing config | `PATCH /prefs/processing/journal` | Journal enabled/disabled | [ ] |
| 24.6 | Extension token | `GET /prefs/extension-token` | Token returned | [ ] |

---

### 25. Export / Import

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 25.1 | Export pot | `POST /pots/:id/bundles/export` with passphrase | Encrypted bundle file created | [ ] |
| 25.2 | Import pot | `POST /bundles/import` with bundle + passphrase | Pot recreated with all entries/artifacts | [ ] |
| 25.3 | Import dry run | Add `dry_run:true` | Validation only, no data written | [ ] |
| 25.4 | Tamper detection | Corrupt bundle, then import | Import rejected with tamper error | [ ] |

---

### 26. Models

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 26.1 | List models | `GET /models` | Cached model list with pricing | [ ] |
| 26.2 | Vision models | `GET /models/vision` | Only vision-capable subset | [ ] |
| 26.3 | Refresh models | `POST /models/refresh` | `refresh_models` job queued, cache updated | [ ] |

---

### 27. Health & Diagnostics

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 27.1 | Health check | `GET /health` | `{"status":"ok","database":{"status":"ok","migration_version":46}}` | [ ] |
| 27.2 | AI connectivity | `POST /ai/test` | Successful completion returned | [ ] |

---

### 28. Automation & Heartbeat *(v1.8.x)*

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 28.1 | Enable automation | `PUT /pots/:id/automation/settings` `{"enabled":true}` | Settings saved | [ ] |
| 28.2 | Run heartbeat | `POST /pots/:id/heartbeat/run` | `heartbeat_generate` job enqueued | [ ] |
| 28.3 | Heartbeat output | After worker runs | `GET /pots/:id/heartbeat/latest` → snapshot with headline + open_loops + insights | [ ] |
| 28.4 | Create task | `POST /pots/:id/automation/tasks` `{"title":"...","cron_like":"daily at 09:00"}` | Task created with `next_run_at` set | [ ] |
| 28.5 | Scheduler tick | Worker runs `automation_scheduler` | Due tasks enqueued as jobs | [ ] |
| 28.6 | Task completion | `POST /pots/:id/automation/tasks/:taskId/complete` | Task marked complete | [ ] |

---

### 29. RSS Feed *(v1.8.x)*

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 29.1 | Enable RSS | `PUT /prefs/rss` `{"enabled":true}` | Settings saved | [ ] |
| 29.2 | Discover feeds | `POST /rss/discover` `{"query":"AI research"}` | Feed suggestions returned | [ ] |
| 29.3 | Add feed | `POST /rss/feeds` with discovered URL | Feed created | [ ] |
| 29.4 | Collect articles | Worker runs `rss_collector` | Articles ingested into feed | [ ] |
| 29.5 | Article feedback | `POST /rss/articles/:id/feedback` `{"action":"save"}` | Feedback recorded | [ ] |

---

### 30. Agent (Self-Evolving) *(v1.8.x)*

| # | Feature | How to trigger | Expected result | Status |
|---|---|---|---|---|
| 30.1 | Agent heartbeat | Worker runs `agent_heartbeat` | Candidate generated + scored | [ ] |
| 30.2 | Surprise delivery | Candidate in delivery window | `GET /pots/:id/agent/candidates/latest` → delivered candidate | [ ] |
| 30.3 | Feedback | `POST /pots/:id/agent/candidates/:id/feedback` `{"action":"like"}` | Feedback recorded, type preferences updated | [ ] |
| 30.4 | Tool approval | `POST /pots/:id/agent/tools/:id/approve` | Tool marked approved | [ ] |
| 30.5 | Run history | `GET /pots/:id/agent/runs` | Agent run list with scores | [ ] |

---

## Known Pre-Existing Issues (Do Not Treat as New Failures)

| Issue | Location | Notes |
|---|---|---|
| TS error: `HealthResponseSchema` test | `packages/core/tests/schemas.test.ts` | Test fixture missing required `database` field. Pre-dates this feature. |
| TS errors: `calendarScheduler`, `calendarSync`, `extractDates` | `apps/worker/src/jobs/` | Missing `calendar_timezone` field in AiPreferences + date key mismatches. Pre-existing. |
| TS error: `@links/deep-research` module | `apps/worker/src/jobs/deepResearch*.ts` | Package not built. Pre-existing. |
| TS error: `generateNudges.ts` | `apps/worker/src/jobs/` | NudgePayload overlap. Pre-existing. |

---

## Implementation Roadmap (What's Next)

The following flows need wiring in dedicated sessions. Each session should update the tick-off in this doc.

| Flow | Entry point | Terminal job | Notification title | Status |
|---|---|---|---|---|
| **X-flow**: Worker job lifecycle | `worker.ts:processJob()` | — | — | [ ] wired |
| **Flow 7**: App start on boot | `worker/src/index.ts` | — | — | [ ] wired |
| **Flow 1**: Doc upload chain | `assets.ts` + extractText → tag → entities → summarize | `summarizeEntry` | "Document processed" | [ ] wired |
| **Flow 2**: Image upload chain | `assets.ts` image branch + tag → summarize | `summarizeEntry` | "Image processed" | [ ] wired |
| **Flow 6**: Calendar alarm | `calendarEmitDailyNotification.ts` | self | "Calendar reminder" | [ ] wired |
| **Flow 5**: Link discovery | `idleProcessingScan` → generateLinkCandidates → classify | `classifyLinkCandidate` | "New links found" | [ ] wired |
| **Flow 4**: Generate intel | `intelligence.ts` route → intelGenerateQuestions → intelAnswerQuestion | `intelAnswerQuestion` | "Intelligence ready" | [ ] wired |

---

## Testing Environment Setup

```bash
# Start API (Terminal 1)
cd apps/api && pnpm dev

# Start Worker (Terminal 2)
cd apps/worker && pnpm dev

# Run a single job for testing
cd apps/worker && pnpm dev:once

# Check TypeScript (no new errors)
npx tsc --noEmit -p packages/storage/tsconfig.json
npx tsc --noEmit -p apps/worker/tsconfig.json | grep -v "calendarS\|deepResearch\|extractDates\|generateNudges"

# DB inspection (find SQLite file path from app data dir)
sqlite3 <path-to-links.db> "SELECT * FROM flow_runs;"
sqlite3 <path-to-links.db> "SELECT id, job_type, flow_id, status FROM processing_jobs ORDER BY created_at DESC LIMIT 20;"
```

---

## Per-Feature Test Template

When opening a fresh chat for a specific feature, use this template:

```
I'm testing feature [X] from the Links test plan (docs/feature-test-plan.md).
App is at v1.7.17, branch dev.

Feature: [feature name]
Test items: [copy rows from the relevant section]

Please help me:
1. Set up the test condition
2. Trigger the feature
3. Verify the expected result
4. Mark the item as passed or note the failure
```
