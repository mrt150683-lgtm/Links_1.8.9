# Links — Automated Setup Script
# Run from the repo root: .\install_script.ps1

param(
    [switch]$SkipDependencies,
    [switch]$DevOnly
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
    Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Write-Success($msg) {
    Write-Host "  [OK] $msg" -ForegroundColor Green
}

function Write-Warn($msg) {
    Write-Host "  [WARN] $msg" -ForegroundColor Yellow
}

function Write-Fail($msg) {
    Write-Host "  [FAIL] $msg" -ForegroundColor Red
}

function Generate-HexKey {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

# ─── Header ──────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  Links Setup Script" -ForegroundColor White
Write-Host "  ==================" -ForegroundColor DarkGray
Write-Host ""

# ─── Check Prerequisites ─────────────────────────────────────────────────────

Write-Step "Checking prerequisites..."

# Node.js
try {
    $nodeVersion = node --version 2>&1
    Write-Success "Node.js $nodeVersion"
} catch {
    Write-Fail "Node.js not found. Install from https://nodejs.org (v22+)"
    exit 1
}

# pnpm
try {
    $pnpmVersion = pnpm --version 2>&1
    Write-Success "pnpm $pnpmVersion"
} catch {
    Write-Warn "pnpm not found. Installing..."
    npm install -g pnpm
    Write-Success "pnpm installed"
}

# ─── Install Dependencies ─────────────────────────────────────────────────────

if (-not $SkipDependencies) {
    Write-Step "Installing dependencies..."
    pnpm install
    Write-Success "Dependencies installed"
}

# ─── Environment File ─────────────────────────────────────────────────────────

Write-Step "Setting up environment..."

if (Test-Path ".env") {
    Write-Warn ".env already exists — skipping generation. Check it manually."
} else {
    Copy-Item ".env.example" ".env"
    Write-Success "Created .env from .env.example"

    # Generate ENCRYPTION_KEY
    $encryptionKey = Generate-HexKey
    (Get-Content ".env") -replace "ENCRYPTION_KEY=", "ENCRYPTION_KEY=$encryptionKey" | Set-Content ".env"
    Write-Success "Generated ENCRYPTION_KEY"

    # Generate EXT_BOOTSTRAP_TOKEN
    $bootstrapToken = Generate-HexKey
    (Get-Content ".env") -replace "EXT_BOOTSTRAP_TOKEN=", "EXT_BOOTSTRAP_TOKEN=$bootstrapToken" | Set-Content ".env"
    Write-Success "Generated EXT_BOOTSTRAP_TOKEN"

    # Prompt for OpenRouter key
    Write-Host ""
    Write-Host "  Your OpenRouter API key is required for AI features." -ForegroundColor White
    Write-Host "  Get one free at https://openrouter.ai" -ForegroundColor DarkGray
    Write-Host ""
    $openrouterKey = Read-Host "  Paste your OpenRouter API key (or press Enter to skip)"

    if ($openrouterKey -ne "") {
        (Get-Content ".env") -replace "OPENROUTER_API_KEY=sk-or-v1-", "OPENROUTER_API_KEY=$openrouterKey" | Set-Content ".env"
        Write-Success "OpenRouter key saved"
    } else {
        Write-Warn "Skipped — add OPENROUTER_API_KEY to .env before running the app"
    }
}

# ─── Dev Mode Exit ────────────────────────────────────────────────────────────

if ($DevOnly) {
    Write-Host ""
    Write-Host "  Dev setup complete." -ForegroundColor Green
    Write-Host "  Start the app with:" -ForegroundColor DarkGray
    Write-Host "    Terminal 1: cd apps/api  && pnpm dev" -ForegroundColor White
    Write-Host "    Terminal 2: cd apps/worker && pnpm dev" -ForegroundColor White
    Write-Host "    Terminal 3: cd apps/web  && pnpm dev" -ForegroundColor White
    Write-Host ""
    exit 0
}

# ─── Build ────────────────────────────────────────────────────────────────────

Write-Step "Building web UI..."
Push-Location "apps/web"
npx vite build
Pop-Location
Write-Success "Web UI built"

Write-Step "Bundling API and Worker for Electron..."
Push-Location "apps/launcher"
node scripts/copy-deps.mjs
Write-Success "API and Worker bundled"

Write-Step "Building Electron main process..."
node_modules/.bin/electron-vite build
Write-Success "Electron main process built"

Write-Step "Packaging installer..."
node_modules/.bin/electron-builder --win portable nsis
Pop-Location
Write-Success "Installer built"

# ─── Done ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  Build complete." -ForegroundColor Green
Write-Host ""
Write-Host "  Installer output:" -ForegroundColor DarkGray

$distPath = "apps\launcher\dist"
if (Test-Path $distPath) {
    Get-ChildItem $distPath -Filter "*.exe" | ForEach-Object {
        Write-Host "    $($_.FullName)" -ForegroundColor White
    }
}

Write-Host ""
Write-Host "  See SETUP_GUIDE.md for full documentation." -ForegroundColor DarkGray
Write-Host ""
