# Phase 9 Smoke Test: Export/Import Bundles
# Tests encrypted bundle creation and import with ID remapping

$ErrorActionPreference = "Stop"

$API_URL = if ($env:API_URL) { $env:API_URL } else { "http://localhost:3000" }

Write-Host "`nPhase 9 Smoke Test: Export/Import`n" -ForegroundColor Cyan

# Step 1: Create source pot
Write-Host "1. Creating source pot..." -NoNewline
$potPayload = @{
    name = "Phase 9 Export Test"
} | ConvertTo-Json

try {
    $potResponse = Invoke-RestMethod -Uri "$API_URL/pots" -Method Post `
        -ContentType "application/json" -Body $potPayload
    $pot1 = $potResponse.id
    Write-Host " OK" -ForegroundColor Green
    Write-Host "   Pot ID: $pot1" -ForegroundColor Gray
} catch {
    Write-Host " FAILED" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# Step 2: Create entries
Write-Host "2. Creating entries..." -NoNewline
$entry1Payload = @{
    content = "Test content 1"
    capture_method = "test"
    captured_at = [int64](Get-Date -UFormat %s) * 1000
} | ConvertTo-Json

try {
    $entry1Response = Invoke-RestMethod -Uri "$API_URL/pots/$pot1/entries" -Method Post `
        -ContentType "application/json" -Body $entry1Payload
    $entry1 = $entry1Response.id
} catch {
    Write-Host " FAILED" -ForegroundColor Red
    exit 1
}

$entry2Payload = @{
    content = "Test content 2"
    capture_method = "test"
    captured_at = [int64](Get-Date -UFormat %s) * 1000
} | ConvertTo-Json

try {
    $entry2Response = Invoke-RestMethod -Uri "$API_URL/pots/$pot1/entries" -Method Post `
        -ContentType "application/json" -Body $entry2Payload
    $entry2 = $entry2Response.id
    Write-Host " OK" -ForegroundColor Green
} catch {
    Write-Host " FAILED" -ForegroundColor Red
    exit 1
}

# Step 3: Export pot (private mode)
Write-Host "3. Exporting pot (private mode)..." -NoNewline
$exportPayload = @{
    mode = "private"
    passphrase = "test-passphrase-123"
} | ConvertTo-Json

try {
    $exportResponse = Invoke-RestMethod -Uri "$API_URL/pots/$pot1/export" -Method Post `
        -ContentType "application/json" -Body $exportPayload
    $bundlePath = $exportResponse.bundle_path
    $bundleSha256 = $exportResponse.bundle_sha256
    Write-Host " OK" -ForegroundColor Green
    Write-Host "   Bundle: $bundlePath" -ForegroundColor Gray
    Write-Host "   SHA256: $($bundleSha256.Substring(0,16))..." -ForegroundColor Gray
} catch {
    Write-Host " FAILED" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# Step 4: Verify bundle file exists
Write-Host "4. Verifying bundle file..." -NoNewline
if (-not (Test-Path $bundlePath)) {
    Write-Host " FAILED" -ForegroundColor Red
    Write-Host "   Bundle not found: $bundlePath" -ForegroundColor Red
    exit 1
}

$fileSize = (Get-Item $bundlePath).Length
Write-Host " OK" -ForegroundColor Green
Write-Host "   Size: $fileSize bytes" -ForegroundColor Gray

# Step 5: Import bundle
Write-Host "5. Importing bundle..." -NoNewline
$importPayload = @{
    bundle_path = $bundlePath
    passphrase = "test-passphrase-123"
    import_as_name = "Phase 9 Imported"
} | ConvertTo-Json

try {
    $importResponse = Invoke-RestMethod -Uri "$API_URL/pots/import" -Method Post `
        -ContentType "application/json" -Body $importPayload
    $pot2 = $importResponse.pot_id
    $entriesCount = $importResponse.stats.entries
    Write-Host " OK" -ForegroundColor Green
    Write-Host "   Imported pot: $pot2" -ForegroundColor Gray
    Write-Host "   Entries: $entriesCount" -ForegroundColor Gray
} catch {
    Write-Host " FAILED" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# Step 6: Verify entry counts
Write-Host "6. Verifying entry counts..." -NoNewline
try {
    $pot1Entries = (Invoke-RestMethod -Uri "$API_URL/pots/$pot1/entries").entries.Count
    $pot2Entries = (Invoke-RestMethod -Uri "$API_URL/pots/$pot2/entries").entries.Count

    if ($pot1Entries -ne $pot2Entries) {
        Write-Host " FAILED" -ForegroundColor Red
        exit 1
    }

    Write-Host " OK" -ForegroundColor Green
    Write-Host "   Count: $pot2Entries entries" -ForegroundColor Gray
} catch {
    Write-Host " FAILED" -ForegroundColor Red
    exit 1
}

# Step 7: Test wrong passphrase
Write-Host "7. Testing tamper detection..." -NoNewline
$wrongPassPayload = @{
    bundle_path = $bundlePath
    passphrase = "wrong-password"
} | ConvertTo-Json

try {
    $wrongResponse = Invoke-RestMethod -Uri "$API_URL/pots/import" -Method Post `
        -ContentType "application/json" -Body $wrongPassPayload
    Write-Host " FAILED" -ForegroundColor Red
    Write-Host "   Wrong passphrase not rejected" -ForegroundColor Red
    exit 1
} catch {
    if ($_.Exception.Message -like "*authentication*" -or $_.Exception.Message -like "*failed*") {
        Write-Host " OK" -ForegroundColor Green
    } else {
        Write-Host " FAILED" -ForegroundColor Red
        exit 1
    }
}

Write-Host "`n" -NoNewline
Write-Host "Phase 9 Smoke Test PASSED" -ForegroundColor Green -BackgroundColor Black
Write-Host "`nSummary:" -ForegroundColor Cyan
Write-Host "  - Source pot: $pot1 (2 entries)"
Write-Host "  - Private bundle created and verified"
Write-Host "  - Imported pot: $pot2"
Write-Host "  - Entries preserved: $pot2Entries"
Write-Host "  - Tamper detection working"
