# Contributing to Links

Thanks for your interest in contributing to Links. This document covers how to get involved, what kinds of contributions are welcome, and how the project is structured.

---

## Quick Start

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<your-username>/Links_1.8.9.git`
3. Install dependencies: `pnpm install` (requires Node.js v22+ and pnpm v9+)
4. Create a branch: `git checkout -b your-branch-name`
5. Make your changes
6. Run the TypeScript check: `npx tsc --noEmit`
7. Commit with a clear message (see [Commit Style](#commit-style))
8. Open a pull request against `main`

For full setup instructions including environment variables and build steps, see [SETUP_GUIDE.md](SETUP_GUIDE.md).

---

## What We Welcome

**Bug fixes** — found something broken? Fix it and open a PR. Include steps to reproduce if possible.

**Test coverage** — the project needs more tests. Unit tests, integration tests, and smoke tests are all valuable.

**Documentation** — clearer setup instructions, better inline comments, architecture explanations, usage examples.

**UI improvements** — the frontend works but has rough edges. CSS fixes, accessibility improvements, UX refinements.

**Performance** — if you spot an inefficient query, unnecessary re-render, or slow path, improvements are welcome.

**Feature proposals** — open an issue first to discuss before writing code. This helps avoid wasted effort on things that don't fit the project direction.

**Architecture discussions** — if you see a better way to structure something, open an issue. Thoughtful critique is genuinely useful.

---

## What Probably Won't Get Merged

- Large features without prior discussion in an issue
- Changes that add mandatory cloud dependencies or telemetry
- Breaking changes to the storage layer without a migration
- Code that bypasses security controls (prompt injection defences, schema validation, budget guards)
- Cosmetic-only refactors that touch many files without functional improvement

---

## Project Structure

```text
apps/
  api/          Fastify HTTP API server
  worker/       Background job processor
  web/          React + Vite frontend
  launcher/     Electron desktop app (Windows)
  mcp/          Model Context Protocol server
  extension/    Chrome extension

packages/
  core/         Zod schemas and domain types (no implementation)
  storage/      Kysely + SQLite repositories and migrations
  ai/           OpenRouter client, prompt registry, role system
  config/       Environment and secrets management
  logging/      Structured logging and audit event helpers
  licensing/    License generation and verification
  deep-research/ Deep research agent (isolated package)
```

### Build Notes

- **TypeScript check:** `npx tsc --noEmit` from the repo root is the reliable way to check for type errors.
- **Per-package builds:** After changing `packages/core` or `packages/storage`, rebuild them before checking downstream:
  ```bash
  pnpm --filter @links/core build
  pnpm --filter @links/storage build
  ```
- **Full desktop build** (from `apps/launcher/`):
  1. `cd apps/web && npx vite build`
  2. `cd apps/launcher && node scripts/copy-deps.mjs`
  3. `node_modules/.bin/electron-vite build`
  4. `node_modules/.bin/electron-builder --win portable nsis`

---

## Commit Style

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(area): add new feature
fix(area): fix specific bug
chore: maintenance task
docs: documentation update
test(area): add or update tests
refactor(area): restructure without changing behaviour
```

Examples:
- `feat(storage): add migration for new table`
- `fix(worker): handle null checkpoint on resume`
- `docs: improve SETUP_GUIDE troubleshooting section`

Keep commits focused on one logical change. If a PR touches multiple areas, consider splitting into multiple commits.

---

## Pull Request Guidelines

- **Open an issue first** for anything non-trivial. A quick "I'm planning to do X" saves everyone time.
- **Keep PRs focused.** One feature or fix per PR. Smaller PRs get reviewed faster.
- **Include context.** Explain what you changed and why. If it fixes a bug, describe how to reproduce it.
- **Don't break the build.** Run `npx tsc --noEmit` before pushing.
- **Migrations matter.** If you add or change database tables, include a numbered SQL migration file in `packages/storage/migrations/`. SQLite has limitations — it cannot ALTER CHECK constraints, so use the table-rebuild pattern when needed (see existing migrations 010 and 019 for examples).

---

## Running in Development

You need three terminals:

```bash
# Terminal 1 — API
cd apps/api && pnpm dev

# Terminal 2 — Worker
cd apps/worker && pnpm dev

# Terminal 3 — Web UI
cd apps/web && pnpm dev
```

The web UI will be available at `http://localhost:5173`. See [SETUP_GUIDE.md](SETUP_GUIDE.md) for environment variable setup.

---

## Code Style

- TypeScript strict mode is enforced globally
- Prettier is configured (`.prettierrc.json`) — run it before committing
- ESLint is configured (`eslint.config.js`)
- Zod schemas are used for all API payloads and AI outputs
- AI outputs are always stored as derived artifacts, never overwriting originals

---

## Security

If you find a security vulnerability, please **do not open a public issue**. Email [mrt150683@gmail.com](mailto:mrt150683@gmail.com) directly with details.

For general security-related contributions (improving validation, tightening schema checks, adding rate limiting), normal PRs are fine.

---

## License

By contributing to Links, you agree that your contributions will be licensed under the same [MIT License](LICENSE) that covers the project.

---

## Questions?

Open an issue or email [mrt150683@gmail.com](mailto:mrt150683@gmail.com). No question is too basic.
