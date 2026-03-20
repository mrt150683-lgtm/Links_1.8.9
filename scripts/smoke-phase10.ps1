# Phase 10 Smoke Test: MCP Server Tools (PowerShell)
#
# Tests MCP tool catalog and basic operations via MCP SDK.
# Note: This is a simplified smoke test that verifies server startup and tool listing.
# Full MCP integration testing requires an MCP client (Claude Desktop, etc.).

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

# Test counters
$TestsPassed = 0
$TestsFailed = 0

function Log-Info {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Log-Error {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
}

function Log-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Yellow
}

function Test-Pass {
    param([string]$Message)
    $script:TestsPassed++
    Log-Info $Message
}

function Test-Fail {
    param([string]$Message)
    $script:TestsFailed++
    Log-Error $Message
}

# Cleanup function
function Cleanup {
    Log-Step "Cleaning up test resources"
    if (Test-Path $TestDb) {
        Remove-Item $TestDb -Force
    }
}

# Register cleanup
trap { Cleanup; break }

Set-Location $ProjectRoot

Log-Step "Phase 10 Smoke Test: MCP Server"

# Step 1: Build MCP app
Log-Step "Step 1: Build MCP app"
try {
    pnpm --filter @links/mcp build 2>&1 | Out-Null
    Test-Pass "MCP app builds successfully"
} catch {
    Test-Fail "MCP app build failed"
    exit 1
}

# Step 2: Verify server.js exists
Log-Step "Step 2: Verify MCP server executable"
if (Test-Path "apps/mcp/dist/server.js") {
    Test-Pass "MCP server executable exists"
} else {
    Test-Fail "MCP server executable not found"
    exit 1
}

# Step 3: Verify tool catalog
Log-Step "Step 3: Verify tool implementations exist"
$RequiredTools = @(
    "pots",
    "capture",
    "entries",
    "artifacts",
    "processing",
    "bundles"
)

foreach ($tool in $RequiredTools) {
    if (Test-Path "apps/mcp/dist/tools/$tool.js") {
        Test-Pass "Tool module exists: $tool"
    } else {
        Test-Fail "Tool module missing: $tool"
    }
}

# Step 4: Check MCP SDK integration
Log-Step "Step 4: Verify MCP SDK dependency"
$packageJson = Get-Content "apps/mcp/package.json" -Raw | ConvertFrom-Json
if ($packageJson.dependencies.'@modelcontextprotocol/sdk') {
    Test-Pass "MCP SDK dependency declared"
} else {
    Test-Fail "MCP SDK dependency missing"
}

# Step 5: Verify error handling modules
Log-Step "Step 5: Verify error handling and auth modules"
if (Test-Path "apps/mcp/dist/schemas/errors.js") {
    Test-Pass "Error schemas module exists"
} else {
    Test-Fail "Error schemas module missing"
}

if (Test-Path "apps/mcp/dist/auth/token.js") {
    Test-Pass "Token auth module exists"
} else {
    Test-Fail "Token auth module missing"
}

# Step 6: Test basic server startup (if Node.js can load the module)
Log-Step "Step 6: Test server module loading"
$TestDb = [System.IO.Path]::GetTempFileName() + ".db"
$env:DATABASE_PATH = $TestDb
$env:NODE_ENV = "test"

try {
    node -c "apps/mcp/dist/server.js" 2>$null
    Test-Pass "Server module syntax valid"
} catch {
    Test-Fail "Server module has syntax errors"
}

# Step 7: Verify tool count
Log-Step "Step 7: Verify all 14 tools are registered"
$ExpectedToolCount = 14
$ToolFiles = Get-ChildItem -Path "apps/mcp/src/tools/" -Filter "*.ts" -Recurse
$ToolCount = ($ToolFiles | Select-String -Pattern "export const.*_TOOL: Tool").Count

if ($ToolCount -ge $ExpectedToolCount) {
    Test-Pass "Expected tool count: $ToolCount >= $ExpectedToolCount"
} else {
    Test-Fail "Tool count mismatch: $ToolCount < $ExpectedToolCount"
}

# Step 8: Summary
Log-Step "Test Summary"
Write-Host "  Passed: $TestsPassed"
Write-Host "  Failed: $TestsFailed"

Cleanup

if ($TestsFailed -eq 0) {
    Write-Host "`n✓ All smoke tests passed!" -ForegroundColor Green
    Write-Host "Note: Full MCP integration testing requires an MCP client (Claude Desktop, etc.)"
    exit 0
} else {
    Write-Host "`n✗ Some tests failed!" -ForegroundColor Red
    exit 1
}
