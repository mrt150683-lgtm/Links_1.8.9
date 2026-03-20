# Deep Research Feature — Complete Test Plan

## Prerequisites
1. Start API: `cd apps/api && pnpm dev`
2. Start Worker: `cd apps/worker && pnpm dev`
3. Start Web (dev or launcher): Open the app at http://localhost:3000
4. Have at least one Pot with some entries

---

## TEST SUITE 1: TypeScript Compilation ✅

### Test 1.1 — Web App TypeScript
```bash
cd <repo_root>
npx tsc --noEmit --project apps/web/tsconfig.json
```
**Expected:** No errors
**Status:** ✅ PASS

---

### Test 1.2 — API TypeScript
```bash
cd <repo_root>
npx tsc --noEmit --project apps/api/tsconfig.json
```
**Expected:** No errors (new `/research/runs/:runId/plan` route included)
**Status:** ✅ PASS

---

## TEST SUITE 2: API Endpoints

### Test 2.1 — List Runs (GET /research/runs)
```bash
curl -X GET "http://127.0.0.1:3000/research/runs?pot_id=<YOUR_POT_ID>&limit=20" \
  -H "Content-Type: application/json"
```
**Expected Response:**
```json
{
  "runs": [...],
  "total": <number>
}
```
**Pass Criteria:**
- ✅ Returns 200 status
- ✅ `runs` array exists
- ✅ `total` count present
- ✅ Each run has: `id`, `pot_id`, `status`, `goal_prompt`, `created_at`

---

### Test 2.2 — Create Run (POST /research/runs)
```bash
curl -X POST "http://127.0.0.1:3000/research/runs" \
  -H "Content-Type: application/json" \
  -d '{
    "pot_id": "<YOUR_POT_ID>",
    "goal_prompt": "Investigate the key themes and contradictions across all research about quantum computing and its applications.",
    "auto_approve_plan": false,
    "selected_model": "claude-3-5-sonnet-20241022",
    "config": {
      "budget": {
        "max_depth": 3,
        "max_breadth": 4
      },
      "web_augmentation_enabled": false
    }
  }'
```
**Expected Response:**
```json
{
  "run": {
    "id": "<RUN_ID>",
    "pot_id": "<POT_ID>",
    "status": "draft",
    "goal_prompt": "...",
    "created_at": <timestamp>,
    ...
  }
}
```
**Pass Criteria:**
- ✅ Returns 201 Created
- ✅ Run has `status: "draft"`
- ✅ Run has valid UUID `id`
- ✅ Job enqueued to worker (check worker logs for `deep_research_plan`)
- ⏳ Status transitions to `planning` within 2-3 seconds

**Note:** Save the `<RUN_ID>` for next tests.

---

### Test 2.3 — Get Run Details (GET /research/runs/:runId)
```bash
curl -X GET "http://127.0.0.1:3000/research/runs/<RUN_ID>" \
  -H "Content-Type: application/json"
```
**Expected Response:**
```json
{
  "run": {
    "id": "<RUN_ID>",
    "status": "planning",
    "plan_artifact_id": null,
    "progress": {},
    ...
  }
}
```
**Pass Criteria:**
- ✅ Returns 200
- ✅ Status reflects current state (`planning`, `awaiting_approval`, `queued`, `running`, `done`, `failed`)
- ✅ Response fields match `ResearchRun` interface from `types.ts`

---

### Test 2.4 — Get Plan Artifact (GET /research/runs/:runId/plan) [NEW ENDPOINT]
**Wait for status to become `awaiting_approval`** (~10–60 seconds depending on model response time)

```bash
curl -X GET "http://127.0.0.1:3000/research/runs/<RUN_ID>/plan" \
  -H "Content-Type: application/json"
```
**Expected Response (when available):**
```json
{
  "artifact": {
    "id": "<ARTIFACT_ID>",
    "run_id": "<RUN_ID>",
    "artifact_type": "research_plan",
    "payload": {
      "refined_goal": "...",
      "assumptions": [...],
      "sub_questions": [...],
      "proposed_depth": 3,
      "proposed_breadth": 4,
      "web_augmentation": false,
      "data_scope": "pot_only",
      "estimated_entries_to_read": 45,
      "estimated_tokens": 12500,
      "estimated_wall_time_ms": 120000,
      "pot_entry_count": 50,
      ...
    },
    "created_at": <timestamp>
  }
}
```
**Pass Criteria:**
- ✅ Returns 200 once plan is ready
- ✅ Returns 404 before plan generated (before `awaiting_approval` status)
- ✅ Payload contains all documented fields

---

### Test 2.5 — Approve Plan (POST /research/runs/:runId/plan/approve)
**Requires status: `awaiting_approval`**

```bash
curl -X POST "http://127.0.0.1:3000/research/runs/<RUN_ID>/plan/approve" \
  -H "Content-Type: application/json" \
  -d '{}'
```
**Expected Response:**
```json
{ "ok": true }
```
**Pass Criteria:**
- ✅ Returns 200
- ✅ Run status transitions to `queued` → `running`
- ✅ Job `deep_research_execute` enqueued in worker (check logs)

---

### Test 2.6 — Get Progress (GET /research/runs/:runId/progress)
**While status is `running`**

```bash
curl -X GET "http://127.0.0.1:3000/research/runs/<RUN_ID>/progress" \
  -H "Content-Type: application/json"
```
**Expected Response:**
```json
{
  "run_id": "<RUN_ID>",
  "status": "running",
  "progress": {
    "phase": "retrieving",
    "current_depth": 1,
    "total_depth": 3,
    "queries_completed": 5,
    "queries_total": 12,
    "entries_read": 8,
    "learnings_count": 3,
    "current_query": "What are the main applications of quantum computing?",
    ...
  },
  "budget_usage": {
    "wall_time_ms": 15000,
    "model_tokens": 3500,
    "entries_read": 8,
    "web_pages_fetched": 0,
    "total_sources": 8
  }
}
```
**Pass Criteria:**
- ✅ Returns 200
- ✅ Progress object has all fields from `ResearchProgress` interface
- ✅ Numbers increment on subsequent calls (queries_completed increases, learnings_count increases)
- ✅ Phase transitions: `retrieving` → `processing` → `synthesizing` → `delta` → `novelty` → `done`

---

### Test 2.7 — Get Report (GET /research/runs/:runId/report)
**Wait for status: `done` or `paused`**

```bash
curl -X GET "http://127.0.0.1:3000/research/runs/<RUN_ID>/report" \
  -H "Content-Type: application/json"
```
**Expected Response:**
```json
{
  "artifact": {
    "id": "<ARTIFACT_ID>",
    "run_id": "<RUN_ID>",
    "artifact_type": "research_report",
    "payload": {
      "title": "Deep Research Report: Quantum Computing Applications",
      "summary": "...",
      "sections": [
        {
          "heading": "Quantum Computing Fundamentals",
          "content": "..."
        },
        ...
      ],
      "learnings": [
        {
          "text": "...",
          "confidence": 0.87,
          "source_entry_ids": ["..."],
          ...
        }
      ],
      "open_loops": ["...", "..."],
      "budget_hit": false,
      "entries_read_count": 42,
      "sources_count": 8,
      "generated_at": <timestamp>
    }
  }
}
```
**Pass Criteria:**
- ✅ Returns 200 when run is done
- ✅ Title, summary, sections array present
- ✅ Learnings array populated
- ✅ Open loops identified

---

### Test 2.8 — Get Delta (GET /research/runs/:runId/delta)
**If `previous_run_id` exists (2nd run)**

```bash
curl -X GET "http://127.0.0.1:3000/research/runs/<RUN_ID>/delta" \
  -H "Content-Type: application/json"
```
**Expected Response:**
```json
{
  "artifact": {
    "payload": {
      "new_learnings": [...],
      "contradictions": [...],
      ...
    }
  }
}
```
**Pass Criteria:**
- ✅ Returns 200
- ✅ Shows learnings different from previous run

---

### Test 2.9 — Get Novelty (GET /research/runs/:runId/novelty)

```bash
curl -X GET "http://127.0.0.1:3000/research/runs/<RUN_ID>/novelty" \
  -H "Content-Type: application/json"
```
**Expected Response:**
```json
{
  "artifact": {
    "payload": {
      "novelty_score": 0.62,
      "alert": "Moderate novelty — some findings differ from prior runs",
      ...
    }
  }
}
```
**Pass Criteria:**
- ✅ Returns 200
- ✅ `novelty_score` between 0 and 1
- ✅ Alert message present

---

### Test 2.10 — Cancel Run (POST /research/runs/:runId/cancel)

```bash
curl -X POST "http://127.0.0.1:3000/research/runs/<NEW_RUN_ID>/cancel" \
  -H "Content-Type: application/json" \
  -d '{}'
```
**Expected Response:**
```json
{ "ok": true }
```
**Pass Criteria:**
- ✅ Returns 200
- ✅ Run status becomes `cancelled`

---

### Test 2.11 — Schedule Operations

#### Create/Update Schedule (PUT /research/schedules/:potId)
```bash
curl -X PUT "http://127.0.0.1:3000/research/schedules/<POT_ID>" \
  -H "Content-Type: application/json" \
  -d '{
    "goal_prompt": "Weekly research on quantum computing breakthroughs",
    "cron_like": "0 9 * * 1",
    "timezone": "America/New_York",
    "auto_approve_plan": true,
    "enabled": true
  }'
```
**Pass Criteria:**
- ✅ Returns 200
- ✅ Schedule created/updated

#### Get Schedule (GET /research/schedules/:potId)
```bash
curl -X GET "http://127.0.0.1:3000/research/schedules/<POT_ID>"
```
**Pass Criteria:**
- ✅ Returns 200
- ✅ Schedule fields match

#### Delete Schedule (DELETE /research/schedules/:potId)
```bash
curl -X DELETE "http://127.0.0.1:3000/research/schedules/<POT_ID>"
```
**Pass Criteria:**
- ✅ Returns 200
- ✅ Schedule deleted

---

### Test 2.12 — Notifications

#### List Notifications
```bash
curl -X GET "http://127.0.0.1:3000/research/notifications?pot_id=<POT_ID>&unread_only=true&limit=20"
```
**Pass Criteria:**
- ✅ Returns 200
- ✅ Returns array of notifications

#### Mark Read
```bash
curl -X POST "http://127.0.0.1:3000/research/notifications/<NOTIFICATION_ID>/read" \
  -H "Content-Type: application/json" \
  -d '{}'
```
**Pass Criteria:**
- ✅ Returns 200
- ✅ Notification marked read

---

## TEST SUITE 3: UI/Frontend

### Test 3.1 — Deep Research Tab Exists
1. Open app → Select a pot
2. Look for "Deep Research" tab between "Project Planning" and "Jobs"
**Pass Criteria:** ✅ Tab visible and clickable

---

### Test 3.2 — Runs List View
1. Click "Deep Research" tab
**Pass Criteria:**
- ✅ "New Research Run" button visible
- ✅ If runs exist: show as `.panel` cards with goal truncated, status badge, created date
- ✅ Status badge colors correct (gold for planning/queued, blue for running, green for done, orange for paused, red for failed)

---

### Test 3.3 — New Research Run Form
1. Click "New Research Run" button
2. Form should show:
**Pass Criteria:**
- ✅ "Research Goal" textarea (min 10, max 5000 chars with counter)
- ✅ Model dropdown populated from `/models`
- ✅ Depth slider (1–5)
- ✅ Breadth slider (1–10)
- ✅ "Auto-approve plan" toggle
- ✅ "Web augmentation" toggle
- ✅ Character counter updates as you type
- ✅ "Start Research" button disabled until goal ≥ 10 chars

3. Fill form with:
   - Goal: "Investigate quantum computing applications in cryptography and drug discovery"
   - Depth: 3
   - Breadth: 4
   - Leave other defaults

4. Click "Start Research"
**Pass Criteria:**
- ✅ Form submits
- ✅ UI transitions to "Run Detail" view
- ✅ Status shows "Planning" or "Generating research plan…"

---

### Test 3.4 — Run Detail View — Planning State
1. After creating run, should see:
**Pass Criteria:**
- ✅ Back button (← Back)
- ✅ Goal prompt displayed
- ✅ Status badge
- ✅ Created date
- ✅ Spinner icon with "Generating research plan…" message

2. Wait 10–60 seconds (or until status changes to `awaiting_approval`)

---

### Test 3.5 — Run Detail View — Plan Approval
1. Once status becomes "Awaiting Approval":
**Pass Criteria:**
- ✅ Plan viewer panel appears
- ✅ "Refined Goal" field visible
- ✅ "Sub-questions" list appears
- ✅ "Assumptions" list appears
- ✅ Stats row shows: Depth, Breadth, Entries to read, In Pot, Scope
- ✅ "Approve Plan" button present
- ✅ "Cancel" button present

2. Click "Approve Plan"
**Pass Criteria:**
- ✅ Button shows "Approving…"
- ✅ Status transitions to "Running"

---

### Test 3.6 — Run Detail View — Running State
1. Once status becomes "Running":
**Pass Criteria:**
- ✅ Spinner with message (e.g., "Analyzing pot entries…")
- ✅ 6-cell progress grid visible:
  - Current Depth / Total Depth
  - Queries Run
  - Learnings Count
  - Sources Read
  - Pages Fetched
  - Budget Used %
- ✅ Budget bar shows usage percentage with color change at 80%+
- ✅ Progress updates every 5 seconds
- ✅ "Cancel" button present and functional

---

### Test 3.7 — Run Detail View — Done State
1. Wait for execution to complete (status becomes "Done")
**Pass Criteria:**
- ✅ Report displays with:
  - Title (e.g., "Deep Research Report: Quantum Computing")
  - Summary paragraph
  - Sections with headings and content
  - Learnings badge (e.g., "23 learnings")
  - Sources read badge
  - Budget limit badge (if hit)
- ✅ Novelty badge appears:
  - Shows % score (e.g., "62%")
  - Color green if novelty_score > 0.3
  - Color red if novelty_score < 0.3
  - Has descriptive text

---

### Test 3.8 — Settings — Deep Research Section
1. Open Settings (gear icon or menu)
2. Look for "Deep Research" nav item (after "Journal")
**Pass Criteria:**
- ✅ Nav item visible
- ✅ Clicking it shows Deep Research section

3. In section:
**Pass Criteria:**
- ✅ Title: "Deep Research"
- ✅ Description text present
- ✅ "Research Model" group with:
  - Label: "Deep Research Model"
  - Dropdown populated from `/models`
  - "Use default model" as first option
  - Info message about token requirements

4. Select a different model
**Pass Criteria:**
- ✅ Dropdown updates
- ✅ "Saved" message appears briefly
- ✅ On refresh, selected model persists (saved via `PUT /prefs/ai`)

---

### Test 3.9 — Notifications Badge
1. Create a research run in one pot
2. Go to another pot, then back to the first pot
3. While NOT on "Deep Research" tab:
**Pass Criteria:**
- ✅ If run completes or generates notification, badge number appears on "Deep Research" tab
- ✅ Badge disappears when clicking the "Deep Research" tab (notifications marked read)
- ✅ Badge hides when actively viewing the tab

---

### Test 3.10 — Schedule Section (Collapsible)
1. In "Deep Research" tab runs list, scroll to bottom
2. Look for "🕐 Recurring Schedule" section
**Pass Criteria:**
- ✅ Section present
- ✅ Clicking it expands
- ✅ Form shows:
  - Schedule goal prompt textarea
  - Cadence select (None, Daily, Weekly)
  - Time input (HH:MM)
  - Day of week select (for weekly)
  - Timezone input
  - Auto-approve toggle
  - Enabled toggle
  - Save, Delete buttons

3. Set:
   - Goal: "Weekly quantum computing research"
   - Cadence: Daily
   - Time: 09:00
   - Auto-approve: ON

4. Click "Save Schedule"
**Pass Criteria:**
- ✅ "Saved" message appears
- ✅ Settings persisted (collapse/expand section, values still there)
- ✅ On app reload, schedule still present

---

## Test Suite Summary Template

```
COMPONENT              | STATUS  | NOTES
--------------------- | ------- | -----
TS Compilation (web)   | ✅ PASS |
TS Compilation (api)   | ✅ PASS |
API: List Runs         | [ ]     |
API: Create Run        | [ ]     |
API: Get Run           | [ ]     |
API: Get Plan          | [ ]     |
API: Approve Plan      | [ ]     |
API: Get Progress      | [ ]     |
API: Get Report        | [ ]     |
API: Get Delta         | [ ]     |
API: Get Novelty       | [ ]     |
API: Cancel Run        | [ ]     |
API: Schedules CRUD    | [ ]     |
API: Notifications     | [ ]     |
UI: Tab Exists         | [ ]     |
UI: Runs List          | [ ]     |
UI: New Run Form       | [ ]     |
UI: Plan Approval      | [ ]     |
UI: Running State      | [ ]     |
UI: Done/Report        | [ ]     |
UI: Settings Section   | [ ]     |
UI: Notification Badge | [ ]     |
UI: Schedule Section   | [ ]     |
```

---

## Known Issues / Limitations

1. **Rate Limiting:** Free tier Llama models on OpenRouter limited to 8 RPM
   - **Fix:** Use your own OpenRouter API key or select a different model

2. **Model Availability:** Depends on your OpenRouter account
   - **Fix:** Go to Settings → AI Provider → Refresh Models first

3. **Worker Rate Limits:** First plan generation may fail if too many concurrent requests
   - **Fix:** Wait 30–60 seconds and try again

---

## Pass/Fail Summary
- Record results in the table above
- Test everything in order (tests 1–3 depend on previous steps)
- Focus on UI flow first (Test Suite 3), then validate API responses
