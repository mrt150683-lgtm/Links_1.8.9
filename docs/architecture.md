# Architecture Overview

## Services

- API: request validation, persistence, job enqueue
- Worker: pipeline jobs, derived artifacts, linking
- MCP: tool surface for external AI clients
- Extension Bridge: endpoints used by Chrome extension

## Data flow

Capture → Store → Enqueue → Process → Derived artifacts → Query/MCP

## Storage (Phase 2+)

### Database: SQLite with Kysely

- **Engine:** SQLite (local-first, single-file)
- **Query Builder:** Kysely (type-safe SQL)
- **Location:** Configured via `DATABASE_PATH` env var (default: `./data/links.db`)

### Pragmas (enforced)

- `journal_mode = WAL` (Write-Ahead Logging for concurrency)
- `foreign_keys = ON` (referential integrity)
- `synchronous = NORMAL` (balanced durability/performance)

### Migrations

- SQL files in `packages/storage/migrations/`
- Naming: `001_description.sql`, `002_description.sql`, etc.
- Applied in order, tracked in `migrations` table
- Commands:
  - `pnpm db:migrate` - apply pending migrations
  - `pnpm db:reset` - delete DB and recreate from scratch

### Schema (Phase 2)

**pots:** Research projects/vaults
- `id` (uuid), `name`, `description`, `security_level`, `created_at`, `updated_at`

**entries:** Captured items (text only in Phase 2)
- `id`, `pot_id` (FK), `type`, `content_text`, `content_sha256`, `capture_method`, `source_url`, `source_title`, `notes`, `captured_at`, `created_at`, `updated_at`

**audit_events:** Provenance trail
- `id`, `timestamp`, `actor`, `action`, `pot_id` (FK), `entry_id` (FK), `metadata_json`

### Canonical Hashing

Text content is canonicalized before hashing to ensure identical content with different formatting produces the same hash:

1. CRLF → LF
2. Trim trailing whitespace per line
3. Collapse 3+ blank lines to 2
4. Trim overall leading/trailing whitespace
5. SHA-256 → lowercase hex (64 chars)

This enables duplicate detection and integrity verification.

### Repository Pattern

- `potsRepo`: CRUD for pots
- `entriesRepo`: CRUD for entries (text/image/doc) + canonical hashing
- `assetsRepo`: CRUD for assets + SHA-256 deduplication
- `auditRepo`: Write-only audit event logging

All repositories auto-update timestamps and log audit events.

### Asset Store (Phase 4)

**Global Asset Pool:**
- All encrypted blobs stored in: `ASSETS_DIR/<sha256>.blob`
- Cross-pot deduplication (same file used in multiple pots)
- Encryption: AES-256-GCM (see `docs/encryption.md`)

**Upload Workflow:**
```
1. Receive multipart file upload
2. Buffer to memory (size limit: ASSET_MAX_BYTES)
3. Compute SHA-256 hash on raw bytes
4. Check dedupe: query assets table by sha256
5a. If exists: return existing asset (deduped=true, created=false)
5b. If new:
    - Encrypt with AES-256-GCM (random 12-byte nonce)
    - Write to ASSETS_DIR/<sha256>.blob (atomic: temp + rename)
    - Insert row in assets table
    - Return new asset (deduped=false, created=true)
```

**Entry-Asset Relationship:**
- Text entries: `type='text'`, `asset_id=NULL`, `content_text` NOT NULL
- Image entries: `type='image'`, `asset_id` FK, `content_text=''` (workaround)
- Doc entries: `type='doc'`, `asset_id` FK, `content_text=''` (workaround)
- Foreign key: `asset_id REFERENCES assets(id) ON DELETE CASCADE`

**Storage Layout:**
```
data/
├── links.db          # SQLite database
└── assets/           # Encrypted asset blobs
    ├── a3f5...2c1.blob
    ├── b7e2...9d4.blob
    └── ...
```

**Encryption Details:**
- Cipher: AES-256-GCM (Node.js crypto module)
- Key: 32 bytes from ENCRYPTION_KEY env var
- Nonce: 12 bytes random per file
- Overhead: 29 bytes (1 version + 12 nonce + 16 GCM tag)
- Blob format: `[version][nonce][ciphertext][tag]`
- Permissions: 0600 (owner read/write only)

## MCP Server (Phase 10)

The MCP (Model Context Protocol) server exposes the Links backend as a tool surface for external AI clients (Claude Desktop, Cline, etc.).

### Architecture

- **Transport:** stdio (local-only by default)
- **Protocol:** MCP 1.0 via `@modelcontextprotocol/sdk`
- **Authentication:** Optional token-based auth via `MCP_TOKEN` env var
- **Error Handling:** Structured errors (ErrorCode enum), no stack traces exposed
- **Validation:** Strict Zod schemas (reject unknown fields)

### Tool Catalog (14 tools)

**Pots Management:**
- `list_pots` - List all pots with pagination
- `create_pot` - Create new pot
- `get_pot` - Get pot details by ID
- `delete_pot` - Delete pot with name confirmation

**Content Capture:**
- `capture_text` - Capture text content with metadata
- `capture_link` - Capture URL/link bookmark

**Entries Query:**
- `list_entries` - List entries with filters (capture_method, source_url)
- `get_entry` - Get entry details by ID

**Derived Artifacts:**
- `list_artifacts_for_entry` - List AI-generated artifacts for entry
- `get_latest_artifact` - Get latest artifact of specific type (tags/entities/summary)

**Processing Jobs:**
- `enqueue_processing` - Queue background job (tagging, entity extraction, etc.)
- `run_processing_now` - High-priority immediate processing

**Export/Import:**
- `export_pot` - Export to encrypted .lynxpot bundle (private/public modes)
- `import_pot` - Import from encrypted bundle with ID remapping

### Security

- Binds to local stdio only (no network exposure)
- Optional token auth via `__auth` field
- Passphrase fields never logged
- Errors sanitized (no sensitive data in responses)

### Usage

```bash
# Start MCP server (stdio mode)
node apps/mcp/dist/server.js

# With token auth
MCP_TOKEN=secret node apps/mcp/dist/server.js

# Configure in Claude Desktop:
# ~/.config/claude/claude_desktop_config.json
{
  "mcpServers": {
    "links": {
      "command": "node",
      "args": ["/path/to/Links/apps/mcp/dist/server.js"],
      "env": {
        "DATABASE_PATH": "/path/to/data/links.db"
      }
    }
  }
}
```

## Modules

- storage adapter (Phase 2: SQLite + Kysely)
- ai provider adapter (OpenRouter) - Phase 6+
- pipeline job registry - Phase 5+
- prompts registry (versioned) - Phase 6+
- mcp server (Phase 10: tool surface for AI clients)

## Invariants

- originals are immutable
- derived artifacts are versioned (Phase 7+)
- provenance is mandatory (capture_method, timestamps, source metadata, content_sha256)
