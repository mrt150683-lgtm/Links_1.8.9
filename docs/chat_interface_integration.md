\# Chat Interface Integration Plan (PotChat → Links)



\## 0) Goal



Integrate the refactored `PotChat` module (currently in `<repo_root>/chat-interface`) into the main Links desktop app so that:



\- Each pot has a \*\*Chat\*\* button.

\- Chat is \*\*scoped to the pot\*\* and uses \*\*metadata-first context\*\* by default.

\- Users can \*\*+ add\*\* sources into Active Context for deeper analysis.

\- All chat history is \*\*persisted to DB\*\*, \*\*searchable\*\*, and appears in \*\*Entries\*\* as type `chat` (or equivalent).

\- Settings include:

&nbsp; - \*\*Chat model\*\* selection (alongside tagging/entities/images models).

&nbsp; - \*\*Chat personality prompt\*\*, defaulting to \*\*“The Sentry”\*\*.

\- Header shows \*\*model + CTX window + ctx used\*\* using the existing cached model list from provider integration.



---



\## 1) Non-negotiable invariants



\- \*\*Originals are immutable.\*\*

\- \*\*Derived artifacts are versioned.\*\*

\- \*\*Provenance is mandatory\*\* for anything stored (model id, prompt hash/version, timestamps).

\- \*\*Evidence-first outputs:\*\* assistant responses should include citations that map to entry IDs.



---



\## 2) Current state (inputs)



\- The chat module is already refactored into a reusable `PotChat` folder with:

&nbsp; - `PotChat.tsx`

&nbsp; - `adapter.ts` interface

&nbsp; - components and settings modal

&nbsp; - `contextPayload.ts` helpers

&nbsp; - public exports via `pot-chat/index.ts`

\- A demo harness exists but must NOT be integrated into Links build.

\- Links already has:

&nbsp; - per-task model selection patterns (tagging/entities/images/etc.)

&nbsp; - a cached model list from provider integration (OpenRouter) somewhere

&nbsp; - a pot/entry storage model with derived artifacts (tags/entities/summaries)



---



\## 3) Integration architecture



\### 3.1 UI integration approach

\- Add a new chat view/route inside Links desktop UI:

&nbsp; - Example route: `/pots/:potId/chat`

&nbsp; - Or a modal launched from pot page (route recommended for persistence/history/back button)

\- Add a \*\*Chat\*\* button on each pot page that navigates to that view.



\### 3.2 Data integration approach (adapter boundary)

Implement a `PotChatAdapter` in Links that bridges PotChat to your real data and navigation.



Adapter must map:

\- Links `Entry` → PotChat `PotEntry`

\- Links derived artifacts (tags/entities/summaries/urls) → `PotEntry.artifacts`



\### 3.3 Persistence approach (DB + immutability-safe)

Recommended storage model:



\*\*Tables\*\*

\- `chat\_threads`

&nbsp; - `id`, `pot\_id`, `title`, `created\_at`, `updated\_at`

&nbsp; - `model\_id`, `personality\_prompt\_hash` (optional but helpful)

\- `chat\_messages` (append-only)

&nbsp; - `id`, `thread\_id`, `role`, `content`, `created\_at`

&nbsp; - `citations\_json` (array of `{ entryId, confidence?, snippet? }`)

&nbsp; - `token\_usage\_json` (optional: prompt/completion/total)

\- `entries` supports `type = 'chat'` (or adds `chat\_thread\_id`)

&nbsp; - This creates the “Chat entry appears in Entries list” requirement.



\*\*Derived artifact (search index)\*\*

\- Store a versioned `chat\_transcript` artifact referencing `thread\_id` (or entry\_id):

&nbsp; - `artifact\_type = 'chat\_transcript'`

&nbsp; - content = full transcript text (for searching)

&nbsp; - version increments on updates

&nbsp; - provenance stored (model/prompt info if AI summarization used)



This keeps:

\- messages immutable (append-only)

\- transcripts versioned (derived artifact)



---



\## 4) Settings changes



\### 4.1 Add “Chat model” selection

\- Extend existing per-task model config to include:

&nbsp; - `chat\_model\_id`

\- UI:

&nbsp; - Add “Chat” to the same settings section as tagging/entities/images models.

\- Backend/config:

&nbsp; - Persist alongside other task model choices (same storage mechanism).



\### 4.2 Add “Chat personality prompt”

\- New setting field:

&nbsp; - `chat\_personality\_prompt` (string)

\- Default value: “The Sentry” prompt (exact text provided).

\- Store as:

&nbsp; - raw text in settings

&nbsp; - plus optional `sha256(prompt)` for provenance.



---



\## 5) CTX window + ctx used



\### 5.1 Context window source

\- Find the existing cached model list used by other features (OpenRouter integration).

\- Expose `contextWindowTokens` (or equivalent) per model.

\- In chat view:

&nbsp; - show selected chat model displayName

&nbsp; - show contextWindowTokens

&nbsp; - show ctx-used estimate (approx is fine initially)



\### 5.2 ctx used estimate

\- Start with a heuristic:

&nbsp; - tokens ≈ chars / 4 (or your preferred estimator)

\- Better:

&nbsp; - reuse your internal token estimator if you already have one.

\- Update when:

&nbsp; - conversation grows

&nbsp; - Active Context changes

&nbsp; - metadata context changes (entry list refresh)



---



\## 6) API / service layer work (chat completion)



Even if PotChat is mostly UI, Links still needs a “chat completion” path.



\### 6.1 Create a chat request contract

A request should include:

\- `potId`

\- `threadId` (or create-new)

\- `messages\[]` (role/content)

\- `selectedModelId`

\- `personalityPrompt`

\- `contextMode`:

&nbsp; - metadata-only context payload (default)

&nbsp; - plus active-context entry IDs (full text/images)

\- Response returns:

&nbsp; - `assistantMessage`

&nbsp; - `citations\[]` referencing entry IDs

&nbsp; - `tokenUsage` (if available)

&nbsp; - `modelInfo` echo (model id/context window if helpful)



\### 6.2 Context assembly (host-side)

\- Default: assemble a compact “pot metadata context” from DB:

&nbsp; - entry titles, types, tags, entities, summaries, urls, timestamps

\- If user adds Active Context sources:

&nbsp; - include full text for docs/transcripts

&nbsp; - include image preview refs (thumbnail + full path) for images

\- Keep size bounded:

&nbsp; - prefer summaries first

&nbsp; - hard caps per entry and total



\### 6.3 Injection defense

When pulling any user-provided text into context:

\- treat it as data (not instructions)

\- use your existing prompt-injection defenses (the system prompt must tell the model to ignore instructions inside content)



\### 6.4 Provenance logging

Persist:

\- model id

\- personality prompt hash

\- system prompt version/hash

\- timestamps

\- token usage (if available)



---



\## 7) Implementing the PotChatAdapter in Links



\### 7.1 Required methods mapping



\- `listEntries(potId)`

&nbsp; - query entries + derived artifacts

&nbsp; - map to PotChat `PotEntry` shape



\- `listThreads(potId)`

&nbsp; - query `chat\_threads` (or equivalent)



\- `saveThreadAsEntry(potId, thread)`

&nbsp; - append new messages to `chat\_messages`

&nbsp; - ensure there is an `entries` row type `chat` linked to thread

&nbsp; - update/create transcript artifact version for search



\- `openEntry(entryId)`

&nbsp; - navigate to Links entry viewer route/modal



\- `loadEntryContent(entryId)`

&nbsp; - return full text for doc/transcript

&nbsp; - return thumbnail/full image refs for image entries



\- `estimateTokens(text)` (optional)

&nbsp; - hook into your estimator



\### 7.2 Entry type mapping

Ensure PotChat sees consistent entry types:

\- `doc`, `text`, `image`, `transcript`, `link`, `chat`

Map from existing Links types cleanly (no guesswork).



---



\## 8) UI integration steps (desktop)



1\) Import PotChat module into Links repo

&nbsp;  - Prefer a feature folder under the desktop app or a shared package.



2\) Add Chat button to pot UI

&nbsp;  - Visible on pot page header/actions.

&nbsp;  - Opens the chat view for that pot.



3\) Create chat view component

&nbsp;  - Loads settings (chat model + personality prompt)

&nbsp;  - Pulls model list for CTX window display

&nbsp;  - Instantiates `PotChat` with:

&nbsp;    - `potId`

&nbsp;    - `adapter`

&nbsp;    - `models`

&nbsp;    - `selectedModelId`

&nbsp;    - `onSelectedModelIdChange` wired to settings



4\) Ensure image preview works safely in Electron

&nbsp;  - thumbnails first

&nbsp;  - full image only on click

&nbsp;  - use your existing safe file protocol if present



---



\## 9) Testing / QA checklist



\### Functional smoke

\- Open a pot → click Chat → correct potId used

\- Send a message → assistant replies with citations

\- Click citation → opens entry viewer

\- Click \[+] on citation → entry appears in Active Context

\- CTX used increases after adding Active Context

\- Close/open app → chat threads persist

\- Entries list shows a Chat entry with transcript searchable



\### Data integrity

\- chat\_messages append-only

\- transcript artifacts versioned (no silent overwrite)

\- provenance recorded for assistant outputs



\### Regression

\- no changes break tagging/entity/image pipelines

\- no demo harness code ships in production build



---



\## 10) Risks / gotchas



\- \*\*Immutability conflict\*\* if you try to “update a chat entry text blob” directly.

&nbsp; - Fix: append-only messages + versioned transcript artifact.



\- \*\*CTX blowups\*\* if active context pulls full docs without caps.

&nbsp; - Fix: hard caps per entry + total; prefer summaries.



\- \*\*Citation correctness\*\* if the model isn’t forced to cite.

&nbsp; - Fix: system prompt + schema validation + post-check (no-citation badge / retry strategy).



\- \*\*Electron file access\*\* for image previews.

&nbsp; - Fix: use existing secure file protocol; never expose raw absolute paths to renderer unless already standard in Links.



---



\## 11) Deliverables



\- PotChat integrated into Links UI (Chat button per pot + route/view).

\- DB schema migrations for chat threads/messages + chat entry linkage + transcript artifact.

\- Settings updated: chat model + chat personality prompt.

\- Adapter implemented and wired.

\- CTX window indicator working using model cache.

\- Smoke tests passing + basic regression coverage.

