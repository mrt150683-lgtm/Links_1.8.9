---
name: links
description: "Interact with the Links research intelligence platform — saving notes/URLs, querying captured entries, reading AI-extracted tags/entities/summaries, chatting about research, deep research, RSS, nutrition, calendar. IMPORTANT: Do NOT use web_fetch or any HTTP tool. You MUST use the tmux skill to run shell commands via the wrapper: ~/openclaw/links.sh list-pots"
homepage: http://192.168.56.1:3000
metadata: { "openclaw": { "emoji": "🔗", "requires": { "bins": ["curl", "bash"] } } }
---

# Links — OpenClaw Skills Reference

## !! MANDATORY EXECUTION RULE !!

**`web_fetch` and all direct HTTP tools WILL FAIL.** The Links API is at a private host IP (`192.168.56.1:3000`) that is only reachable from this VM's shell — not from the cloud AI model.

**You MUST use the `tmux` skill to run shell commands** via the `links.sh` wrapper:

```bash
~/openclaw/links.sh <command> [args...]
```

**Never use `web_fetch`. Never construct JSON manually. Never ask the user for a public URL. Always use tmux + links.sh.**

---

## Quick Start

```bash
# Step 1: List pots (always do this first to get pot IDs)
~/openclaw/links.sh list-pots

# Step 2: Use pot_id from above response for further commands
~/openclaw/links.sh intelligence POT_ID

# Step 3: Chat with your research pot
~/openclaw/links.sh chat POT_ID "What are the main themes?"

# Step 4: Capture new content
~/openclaw/links.sh save-note POT_ID "your note text here"

# Step 5: Save a URL
~/openclaw/links.sh save-url POT_ID "https://example.com" "Article Title"
```

---

## About Links

Links is a local-first research intelligence platform: it captures content (text, links, images, docs), organises it into "pots" (vaults), and runs AI pipelines to extract tags, entities, summaries, cross-entry connections, Q&A, journal entries, agent insights, and more.

All data stays on the local Windows machine. The API is served by the Links Electron app at `http://192.168.56.1:3000` — reachable from this VM only via local shell commands.

---

## All Commands

Use via tmux skill. No JSON required — just pass string arguments.

```bash
# POTS
~/openclaw/links.sh list-pots
~/openclaw/links.sh create-pot "My Pot"
~/openclaw/links.sh create-pot "My Pot" "Optional description"
~/openclaw/links.sh get-pot POT_ID
~/openclaw/links.sh update-pot POT_ID "New Name"
~/openclaw/links.sh delete-pot POT_ID "Exact Pot Name"

# CAPTURE
~/openclaw/links.sh save-note POT_ID "text to save"
~/openclaw/links.sh save-url POT_ID "https://example.com"
~/openclaw/links.sh save-url POT_ID "https://example.com" "Article Title"
~/openclaw/links.sh save-note-url POT_ID "key excerpt" "https://example.com" "Article Title"

# ENTRIES
~/openclaw/links.sh list-entries POT_ID
~/openclaw/links.sh list-entries POT_ID 50
~/openclaw/links.sh get-entry ENTRY_ID
~/openclaw/links.sh delete-entry ENTRY_ID

# AI INTELLIGENCE
~/openclaw/links.sh process ENTRY_ID
~/openclaw/links.sh get-tags ENTRY_ID
~/openclaw/links.sh get-entities ENTRY_ID
~/openclaw/links.sh get-summary ENTRY_ID
~/openclaw/links.sh list-artifacts ENTRY_ID
~/openclaw/links.sh intelligence POT_ID

# CHAT
~/openclaw/links.sh chat POT_ID "What are the main themes?"
~/openclaw/links.sh chat-reply POT_ID THREAD_ID "Tell me more"
~/openclaw/links.sh list-threads POT_ID
~/openclaw/links.sh global-chat "What did I research this week?"

# CONNECTIONS
~/openclaw/links.sh get-links POT_ID
~/openclaw/links.sh discover-links ENTRY_ID

# AGENT
~/openclaw/links.sh agent-insights POT_ID
~/openclaw/links.sh agent-all POT_ID
~/openclaw/links.sh agent-run POT_ID
~/openclaw/links.sh agent-enable POT_ID
~/openclaw/links.sh agent-config POT_ID

# DEEP RESEARCH
~/openclaw/links.sh research POT_ID "query topic here"
~/openclaw/links.sh research-status RUN_ID
~/openclaw/links.sh research-approve RUN_ID
~/openclaw/links.sh research-report RUN_ID
~/openclaw/links.sh list-research POT_ID

# JOURNAL
~/openclaw/links.sh journal
~/openclaw/links.sh journal 2024-03-14
~/openclaw/links.sh journal-pot POT_ID
~/openclaw/links.sh journal-weekly

# RSS
~/openclaw/links.sh rss-feeds
~/openclaw/links.sh rss-articles
~/openclaw/links.sh rss-add "https://example.com/feed.xml"
~/openclaw/links.sh rss-add "https://example.com/feed.xml" "Feed Name"
~/openclaw/links.sh rss-collect

# CALENDAR
~/openclaw/links.sh calendar-today 2024-03-14
~/openclaw/links.sh calendar-range 2024-03-01 2024-03-31
~/openclaw/links.sh calendar-add "Meeting" 2024-03-15
~/openclaw/links.sh calendar-add "Meeting" 2024-03-15 14:00
~/openclaw/links.sh calendar-search "meeting"

# HEALTH
~/openclaw/links.sh health
```

---

## Quick Decision Guide

All commands via tmux skill: `~/openclaw/links.sh <command> [args]`

| Goal | Command |
|------|---------|
| List all pots | `links.sh list-pots` |
| Create a pot | `links.sh create-pot "name"` |
| Save a text note | `links.sh save-note POT_ID "text"` |
| Save a URL | `links.sh save-url POT_ID "https://..." "Title"` |
| List entries | `links.sh list-entries POT_ID` |
| Read a specific entry | `links.sh get-entry ENTRY_ID` |
| Get AI tags | `links.sh get-tags ENTRY_ID` |
| Get AI entities | `links.sh get-entities ENTRY_ID` |
| Get AI summary | `links.sh get-summary ENTRY_ID` |
| Trigger AI processing | `links.sh process ENTRY_ID` |
| Pot intelligence overview | `links.sh intelligence POT_ID` |
| Ask AI about a pot | `links.sh chat POT_ID "question"` |
| Global assistant chat | `links.sh global-chat "question"` |
| Cross-entry connections | `links.sh get-links POT_ID` |
| Start deep research | `links.sh research POT_ID "query"` |
| Read agent insights | `links.sh agent-insights POT_ID` |
| Today's journal | `links.sh journal` |
| List RSS articles | `links.sh rss-articles` |
| Add RSS feed | `links.sh rss-add "url"` |
| Today's calendar | `links.sh calendar-today YYYY-MM-DD` |
| Create calendar event | `links.sh calendar-add "title" YYYY-MM-DD` |

---

## Data Shapes Reference

These describe what each MCP tool / artifact returns. Useful for understanding response JSON.

### Pot Management

**`list_pots`** — List all research pots ordered by most recently updated.
- Optional: `limit` (default 50, max 1000), `offset`
- Returns: array of pots with `id`, `name`, `description`, `created_at`, `updated_at`

**`create_pot`** — Create a new research pot (vault).
- Required: `name` (1–200 chars)
- Optional: `description` (max 2000 chars)
- Returns: created pot object

**`get_pot`** — Get details for a specific pot by ID.
- Required: `pot_id` (UUID)
- Returns: full pot object

**`delete_pot`** — Delete a pot and all its contents. **Irreversible.**
- Required: `pot_id` (UUID), `confirm_name` (must match pot name exactly — safety check)
- Returns: `{ deleted: true, pot_id }`

### Capture

**`capture_text`** — Save text content into a pot.
- Required: `pot_id`, `content_text`, `capture_method` (`manual`|`extension`|`api`|`import`|`mcp`)
- Optional: `source_url`, `source_title`, `notes` (max 10 000 chars), `captured_at` (Unix ms), `client_capture_id` (for idempotent capture)
- Returns: `{ entry, created, deduped }`

**`capture_link`** — Save a URL into a pot.
- Required: `pot_id`, `source_url`, `capture_method`
- Optional: `source_title`, `notes`, `captured_at`, `client_capture_id`
- Returns: `{ entry, created, deduped }`

### Entries

**`list_entries`** — List entries in a pot.
- Required: `pot_id`
- Optional: `limit` (default 100), `offset`, `capture_method` filter, `source_url` filter
- Returns: array of entry objects (`id`, `type`, `content_text`, `source_url`, `source_title`, `created_at`, …)

**`get_entry`** — Get full details for a single entry.
- Required: `entry_id` (UUID)
- Returns: entry object with all fields

### Artifacts (AI-extracted intelligence)

**`list_artifacts_for_entry`** — List all AI-generated artifacts for an entry.
- Required: `entry_id`
- Returns: array of artifacts. Each has `artifact_type` (`tags`|`entities`|`summary`|`extracted_text`|…), `payload`, `created_at`, model/prompt provenance

**`get_latest_artifact`** — Get the most recent artifact of a given type for an entry.
- Required: `entry_id`, `artifact_type` (`tags`|`entities`|`summary`|`extracted_text`)
- Returns: single artifact with `payload` parsed JSON

**Artifact payload shapes:**
- `tags`: `{ tags: [{ label, confidence, category }] }`
- `entities`: `{ entities: [{ label, type: "person"|"org"|"place"|"concept", confidence }] }`
- `summary`: `{ summary: string, key_points: string[] }`
- `extracted_text`: `{ text: string }`

---

## HTTP API Endpoints

Base URL: `http://192.168.56.1:3000`

### Pots

| Method | Path | Description |
|--------|------|-------------|
| POST | `/pots` | Create pot (`{ name, description? }`) |
| GET | `/pots` | List pots (`?limit&offset`) |
| GET | `/pots/:id` | Get pot by ID |
| PATCH | `/pots/:id` | Update pot name/description |
| DELETE | `/pots/:id` | Delete pot |
| GET | `/pots/:id/role` | Get effective AI role for pot |
| PUT | `/pots/:id/role` | Set user-defined AI role for pot |

### Entries

| Method | Path | Description |
|--------|------|-------------|
| POST | `/pots/:potId/entries/text` | Create text entry — body: `{"text":"...","capture_method":"api","source_url":"...","source_title":"..."}` — **field is `text` not `content_text`** |
| POST | `/pots/:potId/videos` | Submit video URL for transcription |
| GET | `/pots/:potId/entries` | List entries |
| GET | `/entries/:entryId` | Get entry by ID |
| DELETE | `/entries/:entryId` | Delete entry |

### Artifacts & Processing

| Method | Path | Description |
|--------|------|-------------|
| GET | `/entries/:entryId/artifacts` | List all artifacts for entry |
| GET | `/entries/:entryId/artifacts/:type/latest` | Get latest artifact of type (`tags`\|`entities`\|`summary`\|`extracted_text`) |
| POST | `/entries/:entryId/process` | Trigger background processing (`{ types: ["tags","entities","summary"], force? }`) |
| GET | `/pots/:potId/intelligence-summary` | **Aggregated pot intelligence** — top tags/entities, processing progress, recent connections, latest agent insight |

**Intelligence summary response:**
```json
{
  "processed_count": 12,
  "total_eligible": 15,
  "top_tags": [{ "label": "machine-learning", "count": 5, "avg_confidence": 0.82 }],
  "top_entities": [{ "label": "John Smith", "type": "person", "count": 3 }],
  "entity_type_counts": { "person": 2, "org": 1, "place": 0, "concept": 4 },
  "entries_status": { "<entryId>": { "tags": true, "entities": true, "summary": true } },
  "recent_links": [{ "src_entry_id": "...", "dst_entry_id": "...", "link_type": "...", "confidence": 0.9, "rationale": "..." }],
  "latest_candidate": { "title": "...", "body": "...", "candidate_type": "...", "confidence": 0.8 }
}
```

### Semantic Links (Cross-entry Connections)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/entries/:entryId/links` | List links for an entry |
| GET | `/pots/:potId/links` | List all links in a pot |
| POST | `/entries/:entryId/link-discovery` | Manually trigger link discovery for entry |
| GET | `/entries/:entryId/links/count` | Count links for entry |

### AI-Generated Intelligence (Q&A)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/pots/:potId/intelligence/generate` | Trigger new intelligence run (generates questions + answers from pot content) |
| GET | `/pots/:potId/intelligence/runs` | List intelligence runs |
| GET | `/pots/:potId/intelligence/questions` | List all generated questions |
| GET | `/pots/:potId/intelligence/questions/:questionId` | Get question with answer |
| GET | `/pots/:potId/intelligence/answers` | List all answers |
| POST | `/pots/:potId/intelligence/answers/:answerId/promote` | Promote an answer to a permanent artifact |
| POST | `/intelligence/improve-prompt` | AI-improve a user-supplied research focus prompt |

### Chat (Pot-scoped)

Send messages to an AI with full access to the pot's entries and artifacts as context.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/pots/:potId/chat/send` | Send message (`{ thread_id?, message, model_id? }`) — returns AI reply |
| GET | `/pots/:potId/chat/threads` | List chat threads |
| GET | `/pots/:potId/chat/threads/:threadId` | Get thread with all messages |
| DELETE | `/pots/:potId/chat/threads/:threadId` | Delete thread |
| POST | `/pots/:potId/chat/threads/:threadId/save-as-entry` | Save chat transcript as a new entry |

### Chat (Global / Main)

Global assistant not scoped to a pot — has context of recent journal, notifications, entries.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/main-chat/threads` | List global chat threads |
| GET | `/main-chat/threads/:threadId/messages` | Get thread messages |
| DELETE | `/main-chat/threads/:threadId` | Delete thread |
| GET | `/main-chat/context-pack` | Get global context (journal, notifications, recent entries) |
| POST | `/main-chat/send` | Send message to global assistant |

### Deep Research Agent

Multi-step autonomous research runs with budget control, approval gates, and reports.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/research/runs` | Create run (`{ pot_id, query, config: { budget: { max_links_per_run } } }`) |
| GET | `/research/runs` | List runs for pot (`?pot_id`) |
| GET | `/research/runs/:runId` | Get run status and details |
| POST | `/research/runs/:runId/plan/approve` | Approve the generated research plan to proceed |
| POST | `/research/runs/:runId/cancel` | Cancel run |
| POST | `/research/runs/:runId/resume` | Resume paused run |
| GET | `/research/runs/:runId/plan` | Get research plan artifact |
| GET | `/research/runs/:runId/report` | Get final research report |
| GET | `/research/runs/:runId/delta` | Get what's new vs prior run |
| GET | `/research/runs/:runId/novelty` | Get novelty assessment |
| GET | `/research/runs/:runId/progress` | Get live progress and budget usage |

### Journal

Auto-generated periodic reviews aggregated from captured content.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/journal/daily` | Global daily journal (`?date=YYYY-MM-DD`) |
| GET | `/journal/weekly` | Global weekly journal (`?end_date=YYYY-MM-DD`) |
| GET | `/journal/monthly` | Global monthly journal (`?month=YYYY-MM`) |
| GET | `/journal/quarterly` | Global quarterly journal (`?year=YYYY&quarter=1-4`) |
| GET | `/journal/yearly` | Global yearly journal (`?year=YYYY`) |
| GET | `/pots/:potId/journal/daily` | Pot-scoped daily journal |
| GET | `/pots/:potId/journal/weekly` | Pot-scoped weekly journal |
| GET | `/pots/:potId/journal/monthly` | Pot-scoped monthly journal |
| GET | `/pots/:potId/journal/quarterly` | Pot-scoped quarterly journal |
| GET | `/pots/:potId/journal/yearly` | Pot-scoped yearly journal |
| POST | `/journal/rebuild` | Manually trigger journal rebuild |

### Autonomous Agent (Self-Evolving Insights)

The agent runs on a schedule, reflects on pot content, and delivers surprise insights. It can build and test its own tools.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/pots/:potId/agent-config` | Get agent configuration |
| PUT | `/pots/:potId/agent-config` | Update agent config (`enabled`, `mode`: quiet\|balanced\|bold, `goal_text`, `delivery_time_local`, etc.) |
| POST | `/pots/:potId/agent-runs` | Trigger manual agent run |
| GET | `/pots/:potId/agent-runs` | List agent runs |
| GET | `/agent-runs/:runId` | Get run details + progress |
| POST | `/agent-runs/:runId/cancel` | Cancel run |
| POST | `/agent-runs/:runId/resume` | Resume paused run |
| GET | `/pots/:potId/agent-candidates` | List insight candidates (`?status=delivered\|pending\|selected`) |
| POST | `/agent-candidates/:id/feedback` | Submit feedback (`{ action: "cool"\|"meh"\|"useless"\|"interested"\|"snooze"\|"known" }`) |
| POST | `/agent-candidates/:id/undo` | Undo feedback |
| POST | `/agent-candidates/:id/open-chat` | Open chat seeded with this candidate's context |
| POST | `/agent-candidates/:id/open-search` | Get search prompt from candidate |
| GET | `/pots/:potId/agent-tools` | List auto-built tools for pot |
| GET | `/agent-tools/:toolId` | Get tool details + status |
| POST | `/agent-tools/:toolId/approve` | Approve tool for use |
| POST | `/agent-tools/:toolId/reject` | Reject tool |
| POST | `/agent-tools/:toolId/disable` | Disable active tool |
| POST | `/agent-tools/:toolId/enable` | Re-enable disabled tool |
| POST | `/agent-tools/:toolId/run` | Run tool (`{ input_payload? }`) |
| POST | `/agent-tools/:toolId/rollback` | Roll back to previous version (`{ version_id }`) |
| GET | `/agent-tools/:toolId/versions` | List tool version history |
| GET | `/agent-tool-runs/:runId` | Get tool run result |
| GET | `/agent/pots/:potId/snapshots` | List agent snapshots (periodic summaries) |
| GET | `/agent/registry` | Get list of registered agent capabilities |
| GET | `/agent/diagnostics` | Agent health/status diagnostics |

### "Did You Know" (DYK)

Bite-sized auto-generated insights from pot content, delivered as notifications.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/pots/:potId/dyk` | List DYK items for pot |
| GET | `/dyk/:dykId` | Get single DYK item |
| POST | `/dyk/:dykId/feedback` | Submit feedback |
| GET | `/pots/:potId/dyk/inbox` | List DYK notifications |
| POST | `/dyk-notifications/:id/read` | Mark notification read |
| POST | `/dyk-notifications/:id/dismiss` | Dismiss notification |

### Translation

| Method | Path | Description |
|--------|------|-------------|
| POST | `/entries/:entryId/translate` | Translate entry content (`{ target_language }`) |
| GET | `/entries/:entryId/translations` | List available translations |
| GET | `/entries/:entryId/translations/:language` | Get translation by language code |

### RSS Feeds

Subscribe to external feeds; articles are collected on schedule and shown in inbox.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/rss/settings` | Get RSS settings |
| PATCH | `/rss/settings` | Update settings (`enabled`, `collect_time`, `retention_days`, `articles_per_page`) |
| GET | `/rss/feeds` | List subscribed feeds |
| POST | `/rss/feeds` | Add feed (`{ url, name? }`) |
| PATCH | `/rss/feeds/:id` | Update feed |
| DELETE | `/rss/feeds/:id` | Remove feed |
| GET | `/rss/articles` | List articles (`?limit&offset&feed_id&unread_only`) |
| POST | `/rss/articles/:id/feedback` | Set feedback (`like`\|`dislike`\|`hidden`) |
| DELETE | `/rss/articles/:id/feedback` | Clear feedback |
| POST | `/rss/articles/:id/read` | Mark article as read |
| POST | `/rss/discover` | AI-discover feeds for a topic (`{ topic }`) |
| GET | `/rss/suggestions` | List discovery suggestions |
| POST | `/rss/suggestions/:id/add` | Subscribe to suggestion |
| POST | `/rss/suggestions/:id/dismiss` | Dismiss suggestion |
| POST | `/rss/collect` | Manually trigger collection now |

### Calendar

| Method | Path | Description |
|--------|------|-------------|
| POST | `/calendar/events` | Create manual event |
| GET | `/calendar/events/:id` | Get event by ID |
| PATCH | `/calendar/events/:id` | Update event (partial) |
| DELETE | `/calendar/events/:id` | Delete event |
| GET | `/calendar/range` | Events in date range (`?start=YYYY-MM-DD&end=YYYY-MM-DD`) |
| GET | `/calendar/date/:dateKey` | Events for exact date (`YYYY-MM-DD`) |
| GET | `/calendar/search` | Search events (`?q=`) |
| GET | `/calendar/notifications` | List unread event notifications |
| POST | `/calendar/notifications/:id/read` | Mark notification read |

### Nutrition & Wellness

Full diet tracking: meals (with AI vision analysis), daily/weekly reviews, recipes, cravings, supplements, wellbeing logs.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/nutrition/provision` | Get or auto-create diet pot |
| GET | `/nutrition/profile` | Get nutrition profile (goals, diet type, allergens, etc.) |
| PUT | `/nutrition/profile` | Update nutrition profile |
| POST | `/nutrition/meals` | Create meal (multipart: image + JSON metadata) |
| GET | `/nutrition/meals` | List meals by date (`?date=YYYY-MM-DD`) |
| GET | `/nutrition/meals/:id` | Get meal by ID |
| PATCH | `/nutrition/meals/:id/correction` | Apply user correction to meal macros |
| POST | `/nutrition/meals/:id/recalculate` | AI-assisted macro recalculation |
| DELETE | `/nutrition/meals/:id` | Delete meal |
| POST | `/nutrition/meals/:id/analyze` | Trigger background AI meal analysis |
| POST | `/nutrition/checkin` | Submit weekly check-in |
| GET | `/nutrition/checkin/:weekKey` | Get weekly check-in (`YYYY-WNN`) |
| GET | `/nutrition/reviews/daily` | List daily reviews |
| GET | `/nutrition/reviews/daily/:date` | Get daily review |
| GET | `/nutrition/reviews/weekly` | List weekly reviews |
| GET | `/nutrition/reviews/weekly/:weekKey` | Get weekly review |
| POST | `/nutrition/recipes/generate` | AI-generate recipes based on profile + pantry |
| POST | `/nutrition/cravings` | Process craving request with AI suggestions |
| POST | `/nutrition/recipes/:id/feedback` | Like/dislike recipe |
| GET | `/nutrition/recipes` | List generated recipes |
| GET | `/nutrition/recipes/:id` | Get recipe by ID |
| GET | `/nutrition/recipe-book` | Get liked/saved recipes |
| GET | `/nutrition/recipe-book/search` | Search recipe book |
| POST | `/nutrition/reviews/weekly/generate` | Manually trigger weekly review generation |
| POST | `/nutrition/wellbeing` | Log wellbeing entry (mood, energy, sleep, stress) |
| GET | `/nutrition/wellbeing` | Get wellbeing log by date |
| GET | `/nutrition/wellbeing/range` | Get wellbeing logs for range |
| PATCH | `/nutrition/wellbeing/:id` | Update wellbeing log |
| DELETE | `/nutrition/wellbeing/:id` | Delete wellbeing log |
| GET | `/nutrition/supplements` | List supplements |
| POST | `/nutrition/supplements` | Create supplement |
| PATCH | `/nutrition/supplements/:id` | Update supplement |
| DELETE | `/nutrition/supplements/:id` | Delete supplement |
| GET | `/nutrition/supplements/entries` | List supplement entries by date |
| POST | `/nutrition/supplements/entries` | Log supplement taken |
| DELETE | `/nutrition/supplements/entries/:id` | Delete supplement entry |
| POST | `/nutrition/patterns/analyze` | Trigger AI pattern analysis across nutrition data |
| GET | `/nutrition/patterns` | List pattern analyses |
| GET | `/nutrition/patterns/:id` | Get pattern analysis |

### Voice

STT → Chat → TTS pipeline; requires Whisper (STT) and Piper (TTS) binaries.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/voice/health` | Voice service health check |
| GET | `/voice/settings` | Get voice settings |
| PUT | `/voice/settings` | Update settings (enabled, STT model, TTS voice) |
| GET | `/voice/voices` | List available TTS voices |
| POST | `/voice/voices/preview` | Preview a voice (returns audio) |
| POST | `/voice/session/start` | Start voice session |
| POST | `/voice/session/stop` | Stop voice session |
| POST | `/voice/process` | Full pipeline: audio → transcript → AI response → audio |
| GET | `/voice/sessions/:id` | Get session record |

---

## Key Concepts

**Pots** — Research vaults. All content belongs to a pot. Each pot can have its own AI role, agent config, chat threads, journal, and DYK stream.

**Entries** — Captured items inside a pot. Types: `text`, `link`, `image`, `audio`, `video`, `document`.

**Artifacts** — AI-derived outputs attached to entries. Each has a type (`tags`, `entities`, `summary`, `extracted_text`, …), schema version, model, prompt version, and payload. Always derived, never overwrites originals.

**Links** — Cross-entry semantic connections discovered by AI. Each link has `src_entry_id`, `dst_entry_id`, `link_type`, `confidence`, `rationale`.

**Intelligence Runs** — AI reads all entries in a pot and generates questions + answers about the content as a whole.

**Agent** — Self-evolving background process that reflects on pot content and delivers surprise insights ("candidates") on a schedule. Can build and test its own JavaScript tools. Configured per pot.

**Agent Candidates** — Insight outputs from agent runs. Types: `insight`, `lead`, `contradiction`, `next_action`, `chat_seed`, `search_prompt`, `research_novelty`, `journal_theme`, `tool_offer`, `nutrition_correlation`, `foreign_language_finding`.

**Deep Research** — Multi-step autonomous research: generates a plan (approvable), searches and synthesises across entries, produces a report + delta + novelty assessment.

**Journal** — Auto-generated periodic summaries (daily/weekly/monthly/quarterly/yearly) at both global and per-pot level, aggregated from entries captured in that period.

**DYK** — "Did You Know" — bite-sized insights delivered as inbox notifications, generated from entry content.

---

## Tips for OpenClaw

0. **NEVER use web_fetch or direct HTTP** — always fails. Use the **tmux skill** with `~/openclaw/links.sh`.
1. **No JSON required** — `links.sh` handles all JSON internally. Just pass plain string arguments.
2. **Always start by listing pots** to get pot IDs:
   ```bash
   ~/openclaw/links.sh list-pots
   ```
3. **Save content** — text or URL, one call each:
   ```bash
   ~/openclaw/links.sh save-note POT_ID "your content here"
   ~/openclaw/links.sh save-url POT_ID "https://example.com" "Title"
   ```
4. **After saving, intelligence is generated in background** — check after a few seconds:
   ```bash
   ~/openclaw/links.sh intelligence POT_ID
   ```
5. **Chat with a pot** — the AI has full context of all entries:
   ```bash
   ~/openclaw/links.sh chat POT_ID "What are the key themes?"
   ```
6. **Agent insights** are delivered automatically on a schedule — read them with:
   ```bash
   ~/openclaw/links.sh agent-insights POT_ID
   ```
7. **Pipe to `jq`** for readable output:
   ```bash
   ~/openclaw/links.sh list-pots | jq .
   ```
8. **Run `help`** to see all available commands:
   ```bash
   ~/openclaw/links.sh help
   ```
