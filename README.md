# Links

> Capture it. Connect it. Actually use it.

Links is a local-first AI research workspace for people dealing with messy information, half-finished ideas, evidence trails, scattered notes, and too many tabs.

It helps you collect material, organise it into isolated project spaces, and turn raw inputs into something usable: searchable context, linked evidence, summaries, questions, patterns, and deeper research workflows.

**Links is now open source.** I built most of this solo. There is a lot already working, a lot that still needs polish, and a lot more I want to build. If you find it useful, break it, improve it, or want to help push it further, contributions are welcome.

### Demo

[![Links Demo](https://img.youtube.com/vi/GZ0X_1NZYqk/0.jpg)](https://youtu.be/GZ0X_1NZYqk?si=YOjPGhByWmNtAbky)

### Download

- [**Links Setup 1.8.9.exe**](https://github.com/mrt150683-lgtm/Links_1.8.9/releases/download/v1.8.9/Links.Setup.1.8.9.exe) — Windows installer
- [**Links_v1.8.9.exe**](https://github.com/mrt150683-lgtm/Links_1.8.9/releases/download/v1.8.9/Links_v1.8.9.exe) — Portable executable (no install required)

---

## Table of Contents

- [What Links Is](#what-links-is)
- [Why It Exists](#why-it-exists)
- [Who It Is For](#who-it-is-for)
- [Core Design Principles](#core-design-principles)
- [What It Does](#what-it-does)
- [Architecture Overview](#architecture-overview)
- [Data Model and Storage](#data-model-and-storage)
- [Asset Store and Encryption at Rest](#asset-store-and-encryption-at-rest)
- [Ingestion API](#ingestion-api)
- [Processing Engine](#processing-engine)
- [AI Integration](#ai-integration)
- [Research and Intelligence Systems](#research-and-intelligence-systems)
- [Chat, Voice, and User Personalisation](#chat-voice-and-user-personalisation)
- [Desktop App, Browser, and Extension](#desktop-app-browser-and-extension)
- [OpenClaw Integration](#openclaw-integration)
- [Security and Privacy Model](#security-and-privacy-model)
- [Design System](#design-system)
- [Observability and Audit Trail](#observability-and-audit-trail)
- [Open Source](#open-source)
- [Screenshots](#screenshots)
- [Acknowledgements](#acknowledgements)
- [Planned Directions](#planned-directions)
- [Feedback, Ideas, Contributions](#feedback-ideas-contributions)

---

## What Links Is

Links is a private, modular research and intelligence system built around a simple idea:

**your data should stay under your control.**

You can capture text, links, documents, images, audio, notes, and research threads into separate project spaces called **pots**.

From there, Links can help you explore:

- what something is about
- who or what is mentioned
- what connects to what
- what looks important
- what is missing
- what deserves a deeper look

It is designed for people who want more than a chatbot and less than a bloated surveillance platform pretending to be productivity software.

---

## Why It Exists

A lot of modern AI tooling is built around convenience first and control second.

That usually means:
- your data leaves your machine
- your workflow gets trapped inside someone else's product
- provenance gets blurry
- outputs become hard to trust
- "intelligence" becomes summary sludge with nice fonts

Links goes the other way.

It is built to be a **local-first research capture and intelligence environment** where original material stays intact, derived AI outputs are separated from source truth, and every useful layer is stored in a way that can be inspected, reproduced, and improved over time.

The goal is not to be magic.

The goal is to be **useful, inspectable, modular, and private**.

---

## Who It Is For

### Researchers
Academic, technical, scientific, independent, private, or OSINT-style work where evidence, context, and source handling matter.

### Investigators and Analysts
Anyone trying to connect people, claims, events, documents, contradictions, timelines, or patterns without losing the trail.

### Legal and Case-Prep Workflows
Teams or individuals organising transcripts, evidence, notes, references, and related documents in isolated workspaces.

### Founders, Builders, and Developers
People researching products, markets, technical options, competitors, implementation ideas, and messy project planning material.

### Serious Knowledge Workers
If your current system is **50 tabs, 7 notes apps, a graveyard of PDFs, and raw optimism**, Links was built for you.

---

## Core Design Principles

| Principle | What it means in practice |
|---|---|
| **Local-first** | Data stays on your machine unless you explicitly use your own external AI/API services |
| **Evidence-first** | AI outputs are grounded in captured material, with provenance and validation where applicable |
| **Provenance always** | Source URLs, timestamps, capture methods, content hashes, and audit records matter |
| **Originals are immutable** | Raw captures are never silently rewritten; derived AI outputs are stored separately |
| **Modular by default** | Major features are built as separable modules rather than one giant blob of regret |
| **Security is required** | Storage, AI calls, extension endpoints, and automation are built with threat boundaries in mind |
| **Logs or it didn't happen** | Important actions are logged and traceable without leaking secrets |
| **Real workflows over demo fluff** | Built for serious use, not just one polished landing page and a hallucinated roadmap |

---

## What It Does

### 1. Capture Into Isolated Project Spaces
Research is stored inside separate **pots** so projects do not bleed into each other.

Capture can include:
- text snippets
- saved links
- PDFs and documents
- images and screenshots
- audio and video transcripts
- notes and chat context

### 2. Background Processing
Once content is captured, Links processes it in the background and turns it into structured, usable layers:

- tags and classifications
- summaries
- extracted entities
- linked relationships between entries
- searchable context
- derived research artifacts

Originals stay original. AI outputs are stored as separate derived layers.

### 3. Per-Pot and Global Chat
Each pot has its own context-aware chat based on the material inside it. There is also a **Main Chat** for broader system use.

### 4. Deep Research Agent
A multi-stage research pipeline that:
- generates structured questions
- plans research runs
- searches the web
- evaluates and ranks sources
- scores novelty
- assembles reports with provenance
- supports budget limits and scheduling

### 5. Self-Evolving Research Agent
A background agent that generates candidate insights per pot, deduplicates and scores them, and delivers the best result as a notification. It can also build and test custom analysis tools in a sandboxed flow.

### 6. Automation and Heartbeat
Per-pot automation features include:
- heartbeat reports
- agent task management
- proactive conversations
- proactive Main Chat starters based on prior chat history and patterns

### 7. Voice Mode
Speech-to-text, chat processing, and text-to-speech with support for local voice models, VAD, and playback interruption.

### 8. RSS Intelligence
AI-assisted feed discovery, article collection, retention rules, article feedback, and in-app reading.

### 9. Calendar Integration
Calendar event extraction, local file sync, notifications, and timeline linking between entries and calendar activity.

### 10. Nutrition and Wellness Module
Meal logging, image analysis, nutrition reviews, recipe support, craving handling, supplement tracking, and wellbeing check-ins.

### 11. Mixture-of-Models Chat
Multiple models can answer the same question, critique one another, and merge toward a final response.

### 12. Journal System
Automatic daily, weekly, monthly, quarterly, and yearly journals across both pots and global scope.

### 13. Dictionize
Learns user style patterns from chat history and injects style guidance into future chat behaviour.

### 14. Planning Module
Structured project planning with question generation, plan drafting, phase breakdowns, document generation, and export.

### 15. Links Browser
An Electron-based browser with tabs, a capture sidebar, and direct save-to-pot integration.

### 16. MCP Server
A Model Context Protocol server exposing Links tools to external AI clients.

### 17. Local-First Privacy
Processing runs locally or through your own configured APIs. No mandatory cloud sync, no telemetry-dependent architecture, no vendor lock-in.

---

## Architecture Overview

Links is built as a **pnpm workspace monorepo** with clear separation between apps and shared packages.

### Apps

```text
apps/
  api/        Fastify HTTP API server
  worker/     Background processing engine
  web/        React + Vite frontend
  launcher/   Electron desktop app
  mcp/        Model Context Protocol server
  extension/  Browser extension
```

### Packages

```text
packages/
  core/           Zod schemas and domain types
  storage/        Kysely + SQLite repositories and migrations
  ai/             OpenRouter client, prompts, roles, routing
  config/         Environment and secrets management
  logging/        Structured logging and audit helpers
  licensing/      Offline license generation and verification
  deep-research/  Isolated deep research agent package
```

### Design Direction

The system is designed around:

- strict boundaries between source data and derived AI outputs
- background processing rather than blocking capture flows
- reproducibility via prompt IDs, model IDs, hashes, and audit trails
- modular feature growth without turning the whole thing into spaghetti wearing a nice logo

---

## Data Model and Storage

Links uses SQLite with Kysely and WAL mode for a type-safe local storage layer.

### Core Concepts

- **`pots`** — isolated research spaces
- **`entries`** — captured items such as text, links, docs, images, and audio
- **`assets`** — uploaded binary files tracked by SHA-256
- **`derived_artifacts`** — AI outputs stored separately from originals
- **`links`** — discovered relationships between entries
- **`processing_jobs`** — tracked background work
- **`audit_events`** — immutable action history
- **`user_prefs`** — configurable user and system preferences

### Important Storage Properties

- raw captures are preserved
- binary assets are deduplicated by content hash
- derived artifacts are idempotent and version-aware
- links are normalised and deduplicated
- audit data records meaningful actions across capture, processing, and automation

### Canonical Hashing

Text is canonicalised before hashing to improve duplicate detection and integrity checking:

- CRLF normalisation
- whitespace cleanup
- blank-line collapsing
- lower-case SHA-256 output

---

## Asset Store and Encryption at Rest

Uploaded files such as images, documents, and audio are stored as encrypted blobs on disk.

### Properties

- AES-256-GCM encrypted blob storage
- content-addressed by SHA-256 hash
- deduplicated across pots
- authentication tag validation on read
- atomic file write workflow
- startup validation for required encryption key
- file permission restrictions for stored assets

> This is not a "please trust the vibes" storage layer.

---

## Ingestion API

Links exposes a local API for capture, management, processing, research, and integration workflows.

### Core Capabilities

- pot creation and management
- capture endpoints for text, link, image, doc, and audio
- asset upload
- artifact retrieval
- processing triggers
- export/import
- model preference handling
- research run management
- extension token bootstrap and rotation

### API Design Notes

- input validation via Zod
- local bind by default
- logged with pot and entry context
- raw sensitive content avoided in logs
- browser extension endpoints protected with token auth and rate limiting

---

## Processing Engine

The Worker is a separate process from the API and handles queued background jobs.

### Job Lifecycle

```text
queued → running → done | failed | deadletter
```

### Processing Themes

- tag extraction
- entity extraction
- summarisation
- audio transcription
- link candidate generation
- link classification
- deep research planning and execution
- journal generation
- intelligence generation
- dictionize style updates
- scheduled automation tasks

### Processing Behaviour

- background-first, not inline chaos
- downstream job chaining
- idempotent artifact generation
- deterministic reprocessing when prompts, roles, or models change
- configurable scheduling and priority handling

---

## AI Integration

Links routes AI functionality through external model providers while preserving reproducibility and per-task control.

### AI Layer Includes

- model registry and refresh flow
- per-task model selection
- versioned prompt registry
- low-temperature defaults
- retry and backoff behaviour
- structured logging of model, prompt, and token usage
- role-aware prompt assembly
- validation before artifact write

### Prompt Strategy

Prompts are versioned and associated with stored outputs, so derived artifacts can be traced back to:

- prompt ID
- prompt version
- model ID
- role hash
- temperature
- max tokens

That makes behaviour easier to debug when something goes clever in the wrong direction.

---

## Research and Intelligence Systems

### Deep Research Agent

A multi-phase research engine that supports:

- plan generation
- user approval flow
- recursive execution
- local corpus retrieval
- optional web augmentation
- checkpoint and resume
- delta comparison
- novelty scoring
- schedule-driven runs
- alert generation

### Budget Controls

The research system enforces hard limits on:

- wall-clock time
- tokens
- cost
- entries read
- web pages fetched
- total sources
- depth and breadth
- links extracted

When limits are hit, it pauses cleanly and preserves progress.

### Link Discovery Engine

Link discovery is deliberately two-phase:

1. deterministic candidate generation using overlap signals
2. AI classification of pre-generated pairs

This prevents the model from inventing random relationships out of thin air because it got overexcited.

### Generated Intelligence

A separate synthesis pipeline that:

- builds multi-entry pot snapshots
- generates cross-entry questions
- answers them with evidence constraints
- quarantines results until explicitly promoted by the user

### Journal System

Automatic journal generation across multiple time horizons: daily, weekly, monthly, quarterly, and yearly.

Journals are evidence-first and linked across periods, creating a traceable narrative chain from yearly views all the way down to underlying entries.

---

## Chat, Voice, and User Personalisation

### Chat Controller

Before the main chat response, a lightweight controller classifies the incoming request and determines:

- mode
- verbosity
- max tokens
- formatting style
- whether more context is needed

That routing decision shapes the final response without blocking the chat flow.

### PotChat

A reusable chat interface with:

- per-pot context
- thread persistence
- knowledge browser
- entry viewer
- token-aware context assembly
- configurable settings
- citation-aware rendering

### Dictionize

Learns from the user's own chat messages over time and extracts:

- phrase patterns
- style scores
- verbosity preference
- tone markers
- structural tendencies

Designed for surface adaptation, not identity profiling nonsense.

### Voice

Voice mode combines:

- speech-to-text
- model interaction
- text-to-speech
- local voice model support
- voice activity detection
- barge-in interruption

---

## Desktop App, Browser, and Extension

### Electron Launcher

The Windows-first desktop launcher:

- starts API and Worker processes
- serves the web UI inside Electron
- manages process lifecycle
- stores user data in the correct application directory

### Links Browser

A built-in browser inside the desktop environment with:

- tab management
- integrated capture
- sidebar workflows
- direct save-to-pot interaction

### Browser Extension

The browser extension supports:

- text selection capture
- page capture
- image capture
- video-page metadata capture
- current pot switching
- API endpoint configuration
- token-based authentication and rotation

The extension is minimal on purpose: capture quickly, then get out of the way.

---

## OpenClaw Integration

Links integrates natively with [OpenClaw](https://github.com/openclaw/openclaw) via a secure shell wrapper (`links.sh`).

Your OpenClaw agent can manage pots, capture entries, chat, run deep research agents, query RSS/journal/calendar/health — everything stays local and mediated through the wrapper (no direct HTTP allowed).

Full command list, syntax, and examples: [`SKILL.md`](https://github.com/mrt150683-lgtm/Links_1.8.9/blob/main/SKILL.md)

---

## Security and Privacy Model

Security is not treated as a decorative paragraph.

### Core Controls

- local bind by default
- encrypted asset storage
- rotating extension tokens
- request rate limiting
- request size limits
- prompt injection defences
- strict schema validation for AI outputs
- evidence validation for stored claims and links
- immutable originals
- budget guards on research automation
- sanitised logging
- no secret leakage in audit events

### Provenance and Reproducibility

Every derived artifact carries:

- model ID
- prompt ID
- prompt version
- role hash
- generation settings
- creation time

Combined with entry hashes and audit records, that allows meaningful reprocessing and comparison rather than "it changed because AI, apparently."

---

## Design System

Links uses an **Obsidian + Gold** visual language.

### Visual Direction

- dark, calm, premium, slightly futuristic
- more quiet command centre than neon arcade
- gold for active states, focus, and highlights
- consistent surfaces, borders, spacing, and motion language

### UI Principles

- readable and restrained
- high signal, low clutter
- premium without being obnoxious
- consistent across web, Electron, and extension surfaces

---

## Observability and Audit Trail

Links uses structured JSON logging and audit records to make behaviour traceable.

### Logging Includes

- request IDs
- job IDs
- pot IDs
- entry IDs
- model identifiers
- prompt versions
- sanitised errors
- service and module origin

### Audit Trail Covers

- pot creation
- entry capture
- asset upload
- job enqueue/start/finish
- artifact creation
- export/import
- token bootstrap/rotation
- research runs and approvals

This is useful when debugging, reviewing behaviour, or proving that a feature did exactly what it claimed to do.

---

## Open Source

This project is now open source.

I built the majority of it solo over the past year. It has grown well beyond what one person can maintain and improve at the pace it deserves. There is a lot already working, a lot that needs polish, and a lot more I want to build.

### Contributions Welcome

- bug fixes
- stability improvements
- test coverage
- documentation improvements
- UI cleanup
- architecture discussions
- feature proposals that actually fit the direction of the project

There is no formal contribution guide yet. That will come. For now, opening an issue before large changes is the sensible move.

---

## Screenshots

Screenshots from the March 2026 build are in:

```text
docs/Links Images_9_3_26/
```

---

## Acknowledgements

A lot of this project was shaped through an absurd number of long voice-chat brainstorming sessions, prompt iterations, architecture discussions, and coding marathons.

Massive thanks to:

- xAI Grok
- OpenAI ChatGPT models
- Claude Code
- Gemini in Antigravity

They all played a meaningful role in helping me think through features, refine prompts, pressure-test ideas, and keep the build moving through a fairly ridiculous solo sprint.

I also want to acknowledge the following repository, which helped inform part of the Deep Research direction and implementation approach:

[deep-research by dzhng](https://github.com/dzhng/deep-research)

---

## Planned Directions

Things still on the list:

- richer browser workflows and extension integration
- offline local model support
- deeper cross-pot analysis and relationship mapping
- better retention, redaction, and forget workflows
- casework mode and disclosure-oriented controls
- broader automation and agent capabilities
- improved UI polish across the system
- more packaging, onboarding, and documentation work

The goal is not to bolt on random gimmicks.

The goal is a modular system where useful capabilities plug into the same core architecture without turning the whole thing into spaghetti with branding.

---

## Feedback, Ideas, Contributions

If you have:

- thoughtful feedback
- use-case ideas
- technical suggestions
- product direction thoughts
- bug reports
- interest in contributing

Open an issue or reach out directly.

**Email:** mrt150683@gmail.com
