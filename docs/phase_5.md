````md

\# Phase\_5.md — Processing Engine Skeleton (Jobs + Worker + Idle-Time Scheduler)



\## Purpose

Phase 5 introduces the machinery that makes this system “alive”:

\- a \*\*job queue abstraction\*\* (local-first, no Redis required yet)

\- a \*\*jobs table\*\* + status lifecycle

\- a \*\*worker service\*\* that executes jobs reliably

\- \*\*idle-time processing\*\* controls (throttle, pause, resume)

\- \*\*deep logging\*\* and audit trail for every job

\- testability: you can confirm the engine works \*\*before\*\* any AI touches it



No OpenRouter calls yet. No tagging yet. This phase is about \*\*reliability\*\*, not intelligence.



---



\## Definition of Done

Phase 5 is complete only when:



\### ✅ Job system exists end-to-end

\- API can enqueue a job into DB.

\- Worker can claim jobs, run them, and mark status transitions:

&nbsp; - `queued -> running -> done`

&nbsp; - `queued -> running -> failed` (retries)

&nbsp; - `queued -> running -> dead` (after max attempts)



\### ✅ Idle-time controls exist

\- Worker supports “idle mode”:

&nbsp; - processes jobs only when allowed by policy

&nbsp; - can be forced to run immediately for QA



\### ✅ Observability is real

\- Every job run logs:

&nbsp; - job\_id, pot\_id, entry\_id

&nbsp; - job\_type

&nbsp; - attempt number

&nbsp; - timings

&nbsp; - error stack (sanitized)

\- Audit events written for enqueue/start/finish/fail/deadletter.



\### ✅ Tests \& QA

\- Integration tests cover:

&nbsp; - enqueue -> worker runs -> status done

&nbsp; - retries and deadletter behavior

&nbsp; - idempotency of job enqueue (optional but recommended)

\- Smoke script can run worker once and verify completion.



\### ✅ Docs updated

\- `docs/pipeline.md` updated to include lifecycle + job types

\- `docs/qa.md` updated with Phase 5 runbook

\- `CHANGELOG.md` updated



---



\## Design: Queue Approach (Local-first)

\### Why not Redis yet?

You want local-first and minimal moving parts early. DB-backed queue is good enough for MVP and keeps deployment simple.



\### Queue Model

Use \*\*SQLite DB table\*\* as the queue:

\- jobs inserted by API

\- worker claims jobs by updating status atomically

\- worker processes and writes back results



Later you can swap to BullMQ/Redis without rewriting business logic if you keep a clean interface.



---



\## Data Model Additions (Phase 5)



\### 1) `processing\_jobs` table

Table: `processing\_jobs`

\- `id` (TEXT uuid)

\- `pot\_id` (TEXT FK -> pots.id, nullable for global jobs)

\- `entry\_id` (TEXT FK -> entries.id, nullable for pot-wide jobs)

\- `job\_type` (TEXT, required)

\- `status` (TEXT, required)  

&nbsp; Enum: `queued | running | done | failed | dead | canceled`

\- `priority` (INTEGER, default 0)

\- `attempts` (INTEGER, default 0)

\- `max\_attempts` (INTEGER, default 3)

\- `run\_after` (INTEGER epoch ms, default now)  // scheduling/backoff

\- `locked\_by` (TEXT, nullable)                 // worker id

\- `locked\_at` (INTEGER epoch ms, nullable)

\- `last\_error` (TEXT, nullable)

\- `created\_at` (INTEGER epoch ms)

\- `updated\_at` (INTEGER epoch ms)



Indexes:

\- `idx\_jobs\_status\_run\_after\_priority`

&nbsp; - (status, run\_after, priority)

\- `idx\_jobs\_entry\_id`

\- `idx\_jobs\_pot\_id`

\- `idx\_jobs\_locked\_at`



\### 2) Optional: `job\_logs` table (recommended)

If you want deep traceability without dumping huge text into `processing\_jobs.last\_error`.



Table: `job\_logs`

\- `id` (TEXT uuid)

\- `job\_id` (TEXT FK -> processing\_jobs.id)

\- `timestamp` (INTEGER)

\- `level` (TEXT: info/warn/error)

\- `message` (TEXT)

\- `data\_json` (TEXT) // structured details



Index:

\- `idx\_job\_logs\_job\_id\_timestamp`



If you prefer file logs only, skip this table, but you lose “time travel” debugging.



---



\## Job Lifecycle Rules



\### Status transitions

\- `queued` -> `running` (claimed by worker)

\- `running` -> `done` (success)

\- `running` -> `failed` (recoverable error; increments attempts and sets run\_after with backoff)

\- `failed` -> `queued` (re-queue for retry)

\- `failed` -> `dead` (attempts >= max\_attempts)

\- any -> `canceled` (manual cancel)



\### Locking \& safety

\- A worker must claim a job using an atomic update:

&nbsp; - set `status=running`, `locked\_by`, `locked\_at`, increment attempts

\- If a worker dies mid-job:

&nbsp; - lock timeout allows another worker to reclaim (e.g., if `locked\_at` older than 10 minutes)



---



\## Worker Design



\### Worker identity

Generate a stable worker id per process run:

\- host + pid + random suffix



\### Worker loop modes

1\) \*\*Run once\*\* (QA mode)

\- claim one job, process it, exit



2\) \*\*Daemon\*\* (normal)

\- loop:

&nbsp; - check idle policy

&nbsp; - claim next eligible job

&nbsp; - process

&nbsp; - sleep when none available



\### Idle-time policy (Phase 5 baseline)

Idle “allowed” conditions (configurable):

\- `IDLE\_MODE\_ENABLED=true/false`

\- `IDLE\_ONLY=true/false`

\- `CPU\_MAX\_PERCENT` (optional; rough estimate)

\- `RUN\_WINDOW\_START` / `RUN\_WINDOW\_END` (optional time window)

\- Manual override:

&nbsp; - API endpoint to “run jobs now for 5 minutes” (or worker CLI flag)



\*\*Phase 5 baseline\*\*:

\- Provide config flags and a simple time-window.

\- CPU/user-idle signals can come later from UI/OS integration.



---



\## Job Types (Phase 5)

No AI yet. Use safe, deterministic jobs to prove the pipeline:



\### 1) `touch\_pot\_usage`

\- updates pot last\_used\_at or usage stats

\- trivial but proves job execution



\### 2) `verify\_asset\_integrity` (optional)

\- reads an encrypted blob and verifies decrypt works

\- good for testing blob handling



\### 3) `reindex\_text\_hashes` (optional)

\- re-canonicalizes and verifies hashes for text entries

\- proves pot-wide jobs and DB scanning



Minimum required: \*\*touch\_pot\_usage\*\* plus one entry-scoped job.



---



\## API Changes (Phase 5)



\### A) Enqueue job manually (QA endpoint)

\#### `POST /jobs/enqueue`

Body:

```json

{

&nbsp; "job\_type": "touch\_pot\_usage",

&nbsp; "pot\_id": "uuid",

&nbsp; "entry\_id": "uuid",

&nbsp; "priority": 0,

&nbsp; "run\_after": 1234567890

}

````



Response:



```json

{ "job": { ... } }

```



\### B) List jobs



\#### `GET /jobs`



Filters:



\* `status`, `pot\_id`, `entry\_id`, `job\_type`, pagination



\### C) Force run window (optional but very useful)



\#### `POST /jobs/run-now`



Body:



```json

{ "minutes": 5 }

```



Sets a preference/flag in DB that tells worker “run regardless of idle for a short window”.



If you don’t want API control, implement only a worker CLI flag:



\* `pnpm worker --run-now --minutes 5`



---



\## Storage Layer Changes (Phase 5)



Add `jobsRepo`:



\* `enqueueJob()`

\* `getJob()`

\* `listJobs()`

\* `claimNextJob(workerId, now, lockTimeoutMs)`

\* `markDone(jobId)`

\* `markFailed(jobId, error, nextRunAfter)`

\* `markDead(jobId, error)`

\* `cancelJob(jobId)`



Important: `claimNextJob` must be atomic and safe from races.



---



\## Audit Events (Phase 5)



Write these events:



\* `job\_enqueued`

\* `job\_claimed`

\* `job\_started`

\* `job\_succeeded`

\* `job\_failed`

\* `job\_deadlettered`

\* `job\_canceled`



Metadata includes:



\* job\_id, job\_type, pot\_id, entry\_id, attempt, duration\_ms, error\_class



---



\## Tests (Phase 5)



\### Unit tests



\* backoff calculation (e.g. exponential with jitter)

\* job status transition rules

\* claim eligibility (run\_after, status, priority)



\### Integration tests (required)



1\. Enqueue job via API, run worker in “run once” mode, verify status `done`.

2\. Enqueue failing job (use a test-only job type), verify:



&nbsp;  \* first run -> failed with attempts=1

&nbsp;  \* second run retries -> attempts increments

&nbsp;  \* after max\_attempts -> status `dead`

3\. Lock timeout reclaim:



&nbsp;  \* create a job stuck in running with old locked\_at

&nbsp;  \* worker can reclaim



---



\## Smoke Script (Phase 5)



`scripts/smoke-phase5.(sh|ps1)`:



1\. create pot + entry

2\. enqueue a job for that pot/entry

3\. start worker in run-once mode

4\. query job list and assert `done`

5\. print job lifecycle summary



Exit non-zero if job not done.



---



\## QA Steps (Manual)



1\. Start API:



\* `pnpm dev`



2\. Enqueue job:



\* `curl -X POST http://localhost:<port>/jobs/enqueue -H "content-type: application/json" -d '{...}'`



3\. Run worker once:



\* `pnpm worker -- --once`



4\. Verify:



\* `curl http://localhost:<port>/jobs?status=done`



---



\## Git Commit Plan (Phase 5)



1\. `feat(storage): add processing\_jobs (and job\_logs) migrations`

2\. `feat(storage): add jobsRepo claim/mark methods`

3\. `feat(worker): add worker service with run-once and daemon modes`

4\. `feat(api): add jobs enqueue/list endpoints`

5\. `test(pipeline): add phase 5 integration tests and smoke script`

6\. `docs: update pipeline, qa, changelog for phase 5`



---



\## Phase 5 Exit Criteria Checklist



\* \[ ] jobs table exists with indexes

\* \[ ] worker can claim and complete jobs

\* \[ ] retries and deadletter work

\* \[ ] idle/run-now controls exist (CLI or API)

\* \[ ] audit trail written for job lifecycle

\* \[ ] integration tests + smoke script pass

\* \[ ] docs + changelog updated



---



```

```



