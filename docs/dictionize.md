\# Dictionize: User Style Profile Extraction (Per-User, From Chat Only)



\## 0) Purpose

Add a post-chat processing module (“Dictionize”) that learns a user’s conversational mannerisms over time by analyzing ONLY the USER messages from completed chat threads. It produces a versioned, frequency-weighted, decayed “User Style Profile” artifact used to make future chats feel more natural (greetings, tone, brevity, sarcasm/humour level, etc.) without contaminating from external data or assistant outputs.



Non-goal: It must not become a general “profile of the user’s beliefs” or ingest arbitrary pot data. This is purely surface-level style shaping.



---



\## 1) Core Requirements (Hard Rules)

1\) Source purity:

&nbsp;  - ONLY analyze USER-role messages from chat threads.

&nbsp;  - NEVER analyze assistant messages.

&nbsp;  - NEVER analyze non-chat entries, docs, transcripts, web content, or imported text.



2\) One-shot per conversation:

&nbsp;  - Run once after a conversation is considered “ended” (idle timeout or explicit end).

&nbsp;  - Ensure idempotency: never re-process the same thread version twice.



3\) Output:

&nbsp;  - Update a single per-user “style profile” object (versioned).

&nbsp;  - Store counts, frequency signals, and context markers.

&nbsp;  - Apply decay so old style signals fade over time.



4\) Usage:

&nbsp;  - At start of each chat session (or per new thread), load the style profile and inject a \*compact summary\* into the chat system prompt (“surface adaptation only”).



5\) Model:

&nbsp;  - Use default fallback model `x-ai/grok-4.1-fast` (cheap) for the Dictionize worker.



---



\## 2) Data Model



\### 2.1 New Derived Artifact Type

Add derived artifact type:

\- `artifact\_type = "user\_style\_profile"`

Scope: per-user (global), not per pot.



\### 2.2 Profile JSON Schema (v1)

Store structured signals, not vibes:



\- meta:

&nbsp; - version, updated\_at, source\_threads\_seen\[], decay\_half\_life\_days

\- phrases:

&nbsp; - greetings { phrase -> count, last\_seen, contexts\[] }

&nbsp; - signoffs { ... }

&nbsp; - fillers { ... }

&nbsp; - emphasis/profanity { ... }

\- style scores (0..1):

&nbsp; - directness\_score

&nbsp; - sarcasm\_level

&nbsp; - humour\_density

&nbsp; - verbosity\_preference (enum: concise/normal/detailed)

\- context markers:

&nbsp; - serious\_mode\_markers\[]

&nbsp; - casual\_mode\_markers\[]

\- stats:

&nbsp; - avg\_sentence\_length

&nbsp; - avg\_message\_length\_chars

&nbsp; - question\_rate

\- safety constraints:

&nbsp; - disallowed\_phrases\[] (optional; for filtering obviously bad stuff)



Also store phrase contexts with coarse labels only:

\- `casual`, `neutral`, `serious`, `frustrated`, `excited`



\### 2.3 Idempotency Fields

Track processed threads:

\- `processed\_thread\_ids: { threadId: lastProcessedAt, lastMessageIdHash }`

or store a `thread\_digest` to ensure “process once per version”.



---



\## 3) Pipeline Integration



\### 3.1 When To Trigger

Trigger Dictionize job when:

\- A chat thread receives a new message AND

\- The thread is “inactive” for N minutes (e.g. 20 minutes), OR

\- User explicitly clicks “End conversation” (optional UI action), OR

\- On app idle/background job sweep (existing scheduler).



\### 3.2 Job Type

Add worker job:

\- `job\_type = "dictionize\_user\_style"`



Input payload:

\- userId

\- threadId

\- threadDigest (hash of all USER messages IDs + content hashes)

\- lastMessageAt



Worker steps:

1\) Load USER messages for threadId

2\) If no new digest since last run → exit (idempotent)

3\) Load existing style profile artifact (or initialize empty)

4\) Run LLM extraction (delta) using grok-4.1-fast

5\) Merge delta into profile (with decay + thresholds)

6\) Save updated profile artifact (version bump)

7\) Save processed digest marker



---



\## 4) LLM Prompting Strategy



\### 4.1 Prompt Location

Create a tweakable prompt file at:

`<install_dir>\prompts\`

Suggested name:

\- `dictionize\_user\_style.md`



\### 4.2 Prompt Principles

\- Strict JSON output only.

\- No speculation about user beliefs or identity.

\- Extract only “style signals”.

\- Output delta format, not full profile, to reduce overwrite risk.



\### 4.3 Delta Output Schema (v1)

Return:

\- new\_phrases: \[{ category, phrase, count\_increment, contexts\[], evidence\_examples\[] (<=2, <=12 words each) }]

\- score\_adjustments: { sarcasm\_level\_delta, directness\_score\_delta, humour\_density\_delta, verbosity\_pref\_vote }

\- markers\_add: { serious\_mode\_markers\[], casual\_mode\_markers\[] }

\- stats\_sample: { avg\_sentence\_length, avg\_message\_length\_chars, question\_rate }

\- notes (optional for debug; not stored long-term)



The merge layer decides actual stored values.



---



\## 5) Merge Logic (Deterministic, Non-LLM)



\### 5.1 Decay

Apply time decay to counts/scores:

\- Choose half-life, e.g. 60 days

\- On each update:

&nbsp; - `decayedCount = count \* 0.5^(daysSinceLastUpdate / halfLifeDays)`



\### 5.2 Thresholds

\- Only persist a phrase if:

&nbsp; - total\_count >= 3 OR appears across >= 2 threads

\- Cap phrases per category, e.g. 50 max.



\### 5.3 Score Update Rules

Use EMA (exponential moving average) for scores:

\- `newScore = (1 - alpha) \* old + alpha \* sample`

Alpha small (0.05–0.15).



\### 5.4 Safety Filter

Reject phrases that:

\- are too long (>40 chars)

\- contain PII-like patterns (emails/phones)

\- look like secrets/tokens

\- are pure URLs



---



\## 6) Chat Usage Integration



\### 6.1 Where It Injects

At start of new thread / opening PotChat:

\- Load latest style profile artifact

\- Summarize it into a compact “Style Hints” block (max ~120 words)

\- Add to system prompt as “surface adaptation only”.



Example injected summary:

\- Greeting preference: short (“hi”, “yo”)

\- Default verbosity: concise

\- Sarcasm: moderate in casual topics, reduced in serious topics

\- Directness: high

\- Preferred format: structured bullets when complex



\### 6.2 Interaction With Router

Your response router should use style profile too:

\- If user prefers concise → lower default max\_tokens

\- If serious markers detected → reduce sarcasm



---



\## 7) UI/UX (Optional)

\- Settings toggle: “Personalize assistant style from my chats” (default ON)

\- Button: “Reset style profile”

\- Viewer: show top phrases + scores (read-only) for transparency



---



\## 8) QA / Tests

\- Unit tests:

&nbsp; - digest/idempotency

&nbsp; - merge + decay math

&nbsp; - thresholds/caps

&nbsp; - safety filters

\- Integration:

&nbsp; - create thread with USER messages → dictionize runs → profile updates

&nbsp; - re-run with no changes → no update

&nbsp; - new thread → updates again

\- Safety:

&nbsp; - ensure assistant messages are never read

&nbsp; - ensure non-chat entries never used



---



\## 9) Risks \& Mitigations

\- Overfitting / noise:

&nbsp; - thresholds + decay + caps

\- Contamination from assistant / documents:

&nbsp; - strict query filtering (role=user, entry\_type=chat only)

\- Privacy creep:

&nbsp; - style only (no beliefs, no identity inferences)

&nbsp; - optional disable/reset

\- Performance:

&nbsp; - run on idle and batch, low token, cheap model



---



\## 10) Definition of Done

\- Style profile artifact exists and updates only from USER chat messages

\- Router + system prompt uses style hints

\- Idempotent processing with digest markers

\- Reset/disable supported

\- Tests passing

