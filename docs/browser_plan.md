0\) Mission and constraints (updated)

Mission



Ship a Links Browser: Chromium-based Electron browser where:



Pinned, non-closable “Links App” tab is always present.



Users browse normally in tabs (full web surfaces).



Links capture tools are embedded (context menu + toolbar + hotkeys).



A sidebar AI chat can load page context only when explicitly requested.



Browser adds session intelligence + organization without betraying privacy.



Non-negotiables (expanded)



Local-first storage and mandatory provenance on any capture (URL/title/time/method/tab/session/group).



History is searchable but never auto-AI processed. Only becomes pot data via explicit action.



Security posture: treat every page as hostile. Strong isolation + permission gating.



Privacy modes are first-class:



Zero AI monitoring (default)



End-of-session review (“save anything from this session?”)



Full capture mode (everything saved, explicitly enabled)



1\) Target architecture (updated feature surfaces)

1.1 Shell layout



Tab strip (pinned Links tab + web tabs)



Address/navigation controls



Sidebar panel (chat + tools)



Main browser surface per tab



1.2 Core organizational primitives (new)



These are not “nice-to-haves”; they’re foundational:



Active Tab Cap + Shelf



Max 10 active tabs.



When a new tab would exceed 10, a tab is closed and moved to a “Shelf” (URL + title + last-active time + optional snapshot/metadata).



Shelf is searchable and can restore tabs instantly.



Project Groups



Tabs belong to project groups (research topics/workstreams).



Group membership persists even if a tab is shelved.



Groups can hold: active tabs + shelved tabs + session snapshots + captures.



Named Sessions



A “Session Snapshot” captures the whole working set (tabs + groups + sidebar state if you want).



User can later restore a session (closing current tabs except the pinned Links tab).



2\) Phased implementation plan (upgraded)

Phase A — Browser Shell MVP (tabs + pinned Links tab)



Goal: Basic tabbed browser + pinned Links tab.



Deliverables



Pinned Links tab (non-closable, left-most)



New tab, close tab (except Links), duplicate tab



Per-tab navigation (back/forward/reload)



Address bar for active tab



QA



Links tab cannot be closed



Open/switch/close tabs works cleanly



Navigation is isolated per tab



Phase B — Tab Intelligence v1 (Active Tab Cap + Shelf)



Goal: Enforce “10 active tabs max” + shelved recall list.



Deliverables



Active tab counter and hard cap at 10



Shelf UI (list view):



URL, title, time, group (if assigned), optional note



Restore from shelf (“reopen”)



Basic rules for which tab gets shelved (deterministic policy)



QA



Open 11th tab → one tab is shelved, active stays at 10



Restore from shelf works



Shelf entries keep provenance metadata



Phase C — Project Groups (tab grouping that survives shelving)



Goal: Tabs are organized into groups regardless of active/shelved state.



Deliverables



Create/rename/delete group



Add tab to group (right-click / quick action)



Group view shows:



Active tabs



Shelved tabs



Group search/filter



QA



Tab placed into group remains in group even after shelving



Restored tab returns to correct group



Group state persists across restart (at least minimally)



Phase D — Secure Web Tab Bridge (capture + sidebar plumbing)



Goal: Safe boundary that lets your app interact with websites without becoming malware’s best mate.



Deliverables



Explicit, permissioned page-context read (only when user requests)



Capture actions can send payloads to Links ingestion



Permission gating for camera/mic/notifications



Logging/audit trail per action



QA



Hostile page cannot access app internals



Permissions are per-site and denyable



Captures always record provenance + audit event



Phase E — “Extension Features” inside the browser (context menu + toolbar)



Goal: Right-click menu becomes Links-first, not Chrome’s “museum of irrelevant options”.



Deliverables



Custom context menu on web tabs:



Save Selection



Save Page



Save Image



Save Transcript (where applicable)



Add Tab to Group



Save Session Snapshot



Toolbar actions for the same, plus “Choose target pot / last used pot”



Capture Comment Prompt (new, important)



On any save action, optionally prompt: “Why are you saving this?”



That comment becomes searchable metadata.



QA



Context menu is clean and only shows Links actions



Save Selection repeated quickly → dedupe works



Comment is stored + searchable



Phase F — Highlight-to-Save (zero-friction capture)



Goal: If the user highlights text, treat that as intent.



Deliverables



Option: Auto-save highlight (off by default)



Modes:



Immediate auto-save



“Highlight buffer” (queue highlights, save later)



Always includes provenance (URL/title/selection location/time)



QA



Highlight capture works without breaking normal browsing



Auto-save can be disabled globally and per-group/per-session if needed



No DB spam: rate limits + dedupe rules



Phase G — Sidebar Chat “Ask about this page” + switchable roles



Goal: A chat sidebar that can answer questions about the page, with roles and custom model choices.



Deliverables



Sidebar chat UI (dock/popout)



“Load page context” button (explicit, shows preview of what will be sent)



Role switcher:



Fact-checker



Summarizer



Critic / Devil’s advocate



Research assistant



Custom role



Custom model selection (per role or per task)



QA



Page context is never auto-sent



Role switching changes behavior predictably



Clear provenance: “Answer based on page snapshot X”



Phase H — Audio/Video capture + “Note button” timestamps



Goal: Capture meeting/video streams (with consent) and attach notes at moments.



Deliverables



Recording modes (user-controlled):



Audio-only capture



Audio+video capture (where feasible)



Note button



Adds a timestamped note marker while recording/playing



Notes are searchable later and link to timestamp



Transcript pipeline:



If transcript exists → capture it



If not → audio → transcription → store transcript as entry (then normal pot processing)



QA



Recording can only occur with explicit user action + clear UI indicator



Note markers are saved and searchable



Transcript capture works for at least one supported source, robust mode works on a short clip



Phase I — Privacy modes + end-of-session review (your “don’t be creepy” system)



Goal: Users can choose how invasive the browser is.



Deliverables



Privacy mode selector:



Zero AI monitoring (default)



End-of-session review (choose what to keep)



Full capture mode (always save)



End-of-session UI:



List visited pages / candidate captures



Let user delete/keep/promote-to-pot



Clear separation:



History stays history unless promoted



QA



In Zero mode: nothing is auto-sent to AI, nothing becomes pot data without explicit action



End-of-session review produces expected saved set



Full mode records everything but still respects “Send to AI” gating



Phase J — Named Sessions (restore whole working sets)



Goal: Save/restore complete tab states as named snapshots.



Deliverables



“Save Session Snapshot” with name



Restore snapshot:



Closes current tabs except pinned Links tab



Opens session tabs in order



Restores group layout and shelf state



Sessions searchable + group-attachable



QA



Save snapshot → restore snapshot reproduces working set



Session restore never kills Links tab



Sessions persist across restarts



Phase K — History (searchable, not AI processed)



(Keep your original Phase D idea, but now it sits cleanly with privacy/session logic.)



QA



No processing jobs triggered by browsing history alone



Only explicit promotion becomes pot data



Phase L — Hardening + Ship readiness



Goal: “It works on your machine” is not a product.



Deliverables



One-command smoke flow:



Open app → open page → highlight save → save page/image → assign group → save session → restore → verify pot entries



Diagnostics dashboard:



Worker status



Capture stats



Errors



Threat model update for embedded browsing



3\) Data and processing rules (expanded)



Captured items (selection/page/image/transcript/recording notes) are pot entries and can be processed normally.



History is separate and never processed unless promoted.



Comments/notes are first-class searchable fields (and should be queryable without AI).



4\) Risk register (updated)



DRM/Widevine breaks some streaming sites → need graceful fallback



Transcript scraping brittle → robust audio→STT is the reliable path



Recording features expand trust/safety requirements → must be explicit + visible + audit logged



Tab/session/group state persistence can become spaghetti → treat them as core data model entities early



5\) What the IDE agent must do (no excuses checklist)



Tell the IDE agent to:



Implement phases in order and do not merge phases unless a dependency requires it.



For every phase:



produce a feature checklist



produce a QA checklist



implement logging hooks (“logs or it didn’t happen”)



Ensure the new features are explicitly implemented:



10 active tab cap + shelf recall list



project tab groups (persist through shelving)



named session snapshots (restore full set)



custom right-click menu (Links actions only)



capture comment prompt + searchable metadata



highlight-to-save option (off by default)



privacy modes (zero / end-session / full)



audio/video capture + timestamped note button



sidebar chat with role switching + custom models



Keep ingestion consistent with your existing capture pipeline contracts (don’t invent new formats).

