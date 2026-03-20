# Links — Setup Guide

This guide covers everything you need to get Links running from source on Windows.

---

## Prerequisites

Before you start, make sure you have the following installed:

- **Node.js** v22 or later — https://nodejs.org
- **pnpm** v9 or later — `npm install -g pnpm`
- **Git** — https://git-scm.com

---

## 1. Clone the Repository

```bash
git clone https://github.com/mrt150683-lgtm/Links_1.8.9.git
cd Links_1.8.9
```

---

## 2. Install Dependencies

```bash
pnpm install
```

This installs all workspace packages across `apps/` and `packages/`.

---

## 3. Configure Your Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Then open `.env` and fill in the values. The required fields are explained below.

### `OPENROUTER_API_KEY`

Links routes all AI calls through [OpenRouter](https://openrouter.ai). Create a free account, generate an API key, and paste it here.

```
OPENROUTER_API_KEY=sk-or-v1-your_key_here
```

### `ENCRYPTION_KEY`

This is a 64-character hex string used to encrypt all assets stored on disk. **Generate one — do not reuse or share it.**

If the launcher does not generate this automatically, run the following in your terminal:

**PowerShell:**
```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
```

**Node.js:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the output into your `.env`:

```
ENCRYPTION_KEY=your_64_char_hex_string_here
```

> **Important:** If you lose this key, you lose access to all encrypted assets. Store it somewhere safe.

### `EXT_BOOTSTRAP_TOKEN`

This is a one-time token used by the browser extension to authenticate with the API on first connection. The Electron launcher generates this automatically when you first run the app. If you are running in dev mode (without the launcher), generate one manually:

**PowerShell:**
```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
```

**Node.js:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```
EXT_BOOTSTRAP_TOKEN=your_64_char_hex_string_here
```

### Other Fields

```
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info
DATABASE_PATH=./data/links.db
```

These defaults work for local development. You generally do not need to change them.

---

## 4. Run in Development Mode

Open **three separate terminals**:

**Terminal 1 — API server:**
```bash
cd apps/api
pnpm dev
```

**Terminal 2 — Worker:**
```bash
cd apps/worker
pnpm dev
```

**Terminal 3 — Web UI:**
```bash
cd apps/web
pnpm dev
```

The web UI will be available at `http://localhost:5173`.

---

## 5. Build the Electron Desktop App

To build the full Windows desktop installer, run the following steps in order from the repo root:

```bash
# 1. Build the web UI
cd apps/web && npx vite build && cd ../..

# 2. Bundle the API and Worker into the Electron package
cd apps/launcher && node scripts/copy-deps.mjs

# 3. Build the Electron main process
node_modules/.bin/electron-vite build

# 4. Package the installer
node_modules/.bin/electron-builder --win portable nsis
```

The installer will be output to `apps/launcher/dist/`:
- `Links Setup x.x.x.exe` — standard NSIS installer
- `Links_vx.x.x.exe` — portable executable (no install required)

---

## 6. Voice Mode (Optional)

Voice mode requires three external components that are **not included** in the repository due to file size. All three are optional — the rest of the app works fully without them.

### Whisper (Speech-to-Text)

Download the Whisper CLI binary for Windows:

- https://github.com/ggerganov/whisper.cpp/releases

Place the contents in a `whisper/` folder at the root of the repo.

### Piper (Text-to-Speech)

Download the Piper TTS binary for Windows:

- https://github.com/rhasspy/piper/releases

Place the contents in a `piper/` folder at the root of the repo.

### Voice Models

Piper uses `.onnx` voice model files. Download models from:

- https://huggingface.co/rhasspy/piper-voices

Place model files in a `voices/` folder at the root of the repo. File naming convention:

```
voices/{lang_code}-{speaker_name}-{quality}.onnx
```

For example: `voices/en_US-amy-medium.onnx`

---

## 7. Automated Setup (Windows)

An automated PowerShell setup script is included to handle steps 2–4 in one go:

```powershell
.\install_script.ps1
```

See `install_script.ps1` for details on what it does.

---

## Troubleshooting

**`better-sqlite3` fails to load**
This is a native Node.js module that must be compiled for Electron. The build process handles this automatically via `@electron/rebuild`. If you get errors, make sure you have the Visual C++ Build Tools installed: https://visualstudio.microsoft.com/visual-cpp-build-tools/

**App starts but AI features don't work**
Check that your `OPENROUTER_API_KEY` is set correctly in `.env` and that you have credits on your OpenRouter account.

**Encryption errors on startup**
Your `ENCRYPTION_KEY` is missing or malformed. It must be exactly 64 hex characters.

**Extension won't connect**
Make sure `EXT_BOOTSTRAP_TOKEN` is set in `.env` and matches what the extension is configured with.
