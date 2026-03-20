# Links - Current Implemented Features

*Based on the latest git commit history and project plan (`docs/plan.md`).*

## Core Architecture & Engine
*   **Local-First Backend**: Secure research "pots" (vaults/cases) supported by SQLite and an encrypted-at-rest file store.
*   **Daemon Worker & Job Queue**: Idle-time processing engine that handles extraction, tagging, and link discovery in the background.
*   **Offline Ed25519 Licensing**: Cryptographically secure, standalone deterministic licensing system enforced natively in the launcher.
*   **Packaged Desktop App**: Bundled API, worker, and database with tray-based execution and a robust NSIS installer.

## Capture & Ingestion (The Pipeline)
*   **Document Support**: Native text extraction for PDFs, DOCX, TXT, and Markdown files.
*   **Audio Processing**: Full audio capture pipeline with transcription and transcript display (`feature/audio-processing`).
*   **Image Processing**: Ingestion of image assets with support for passing them natively to intelligence/AI models.
*   **Chrome Extension Integration**: Manifest V3 extension ready with endpoints for capturing links, selected text, and page content right from the browser.
*   **Journal Module**: Global and pot-specific notes with a structured daily/rollup pipeline for active thoughts and logs.

## Intelligence & AI Workflows
*   **Advanced AI Integrations**: Seamlessly talks to top models via OpenRouter, currently leveraging `x-ai/grok-4.1-fast` and `gemini-2.0-flash` for high-quality, low-temp extraction.
*   **Intelligence Generation**: 
    *   Generates analytical questions and insights scoped safely to specific pots.
    *   Custom, user-driven research focus prompts powered by AI refinement.
    *   Configurable question caps and robust pipeline validations.
*   **Project Planning Generator**: Specialized autonomous workflow UI for breaking down and structuring large research cases.

## Search, Organization, & UI
*   **Full-Spectrum Search**: Deep querying across all ingested text, metadata, entries, and generated tags.
*   **Asset & Entity Management**: Clean interface with high-fidelity PNG assets, dark mode support in planning views, and real-time auto-refreshing UI tabs.
*   **Link Discovery**: Automatically tags and connects concepts across any entry type (text, audio, documents, images) to build a relational graph of evidence.

## System & Observability
*   **Dynamic Logging**: Comprehensive, portable logging system decoupled from external modules.
*   **Automatic Migrations & Locks**: Concurrency locks for migrations during startup to prevent database collisions.
*   **Environment Management**: Automatic `.env` patching and runtime variable resolution for seamless OS integrations.
