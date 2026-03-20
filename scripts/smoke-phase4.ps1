# Phase 4 Smoke Test (Asset Store)
$ErrorActionPreference = "Stop"

Write-Host "=== Phase 4 Smoke Test (Asset Store) ===" -ForegroundColor Cyan
Write-Host ""

$BaseUrl = "http://localhost:3000"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ImageFile = Join-Path $ScriptDir "fixtures\smoke-test-image.png"
$DocFile = Join-Path $ScriptDir "fixtures\smoke-test-doc.pdf"

function Check-Status {
    param(
        [int]$Expected,
        [int]$Actual,
        [string]$Message
    )

    if ($Expected -eq $Actual) {
        Write-Host "✓ $Message (status: $Actual)" -ForegroundColor Green
    } else {
        Write-Host "✗ $Message (expected: $Expected, got: $Actual)" -ForegroundColor Red
        exit 1
    }
}

# Verify fixtures exist
if (-not (Test-Path $ImageFile)) {
    Write-Host "✗ Test image not found: $ImageFile" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $DocFile)) {
    Write-Host "✗ Test document not found: $DocFile" -ForegroundColor Red
    exit 1
}

Write-Host "Step 1: Create pot"
$PotResponse = Invoke-WebRequest -Uri "$BaseUrl/pots" -Method POST `
    -Headers @{"Content-Type"="application/json"} `
    -Body '{"name":"Asset Test Pot"}' `
    -UseBasicParsing
$PotBody = $PotResponse.Content | ConvertFrom-Json
$PotId = $PotBody.id
Check-Status 201 $PotResponse.StatusCode "Create pot"

Write-Host ""
Write-Host "Step 2: Upload test image"
$Form = @{
    file = Get-Item -Path $ImageFile
}
$Upload1Response = Invoke-WebRequest -Uri "$BaseUrl/pots/$PotId/assets" -Method POST `
    -Form $Form -UseBasicParsing
$Upload1Body = $Upload1Response.Content | ConvertFrom-Json
$Asset1Id = $Upload1Body.asset.id
$Created1 = $Upload1Body.created
Check-Status 201 $Upload1Response.StatusCode "Upload image"

if ($Created1 -eq $true) {
    Write-Host "✓ Asset created (not deduped)" -ForegroundColor Green
} else {
    Write-Host "✗ Expected created=true, got $Created1" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 3: Verify asset metadata"
$Sha256 = $Upload1Body.asset.sha256
$Size = $Upload1Body.asset.size_bytes
$Mime = $Upload1Body.asset.mime_type

if ($Sha256 -match '^[0-9a-f]{64}$') {
    Write-Host "✓ Asset has valid SHA-256: $Sha256" -ForegroundColor Green
} else {
    Write-Host "✗ Invalid SHA-256: $Sha256" -ForegroundColor Red
    exit 1
}

if ($Size -gt 0) {
    Write-Host "✓ Asset size: $Size bytes" -ForegroundColor Green
} else {
    Write-Host "✗ Invalid asset size: $Size" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Asset MIME type: $Mime" -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Create image entry"
$Entry1Response = Invoke-WebRequest -Uri "$BaseUrl/pots/$PotId/entries/image" -Method POST `
    -Headers @{"Content-Type"="application/json"} `
    -Body "{`"asset_id`":`"$Asset1Id`",`"capture_method`":`"smoke-test`"}" `
    -UseBasicParsing
$Entry1Body = $Entry1Response.Content | ConvertFrom-Json
$Entry1Id = $Entry1Body.id
Check-Status 201 $Entry1Response.StatusCode "Create image entry"

if ($Entry1Body.type -eq "image") {
    Write-Host "✓ Entry type is 'image'" -ForegroundColor Green
} else {
    Write-Host "✗ Expected type='image', got $($Entry1Body.type)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 5: Fetch entry with asset metadata"
$FetchResponse = Invoke-WebRequest -Uri "$BaseUrl/entries/$Entry1Id" -Method GET -UseBasicParsing
$FetchBody = $FetchResponse.Content | ConvertFrom-Json
Check-Status 200 $FetchResponse.StatusCode "Fetch entry"

if ($FetchBody.asset.id -eq $Asset1Id) {
    Write-Host "✓ Entry includes embedded asset metadata" -ForegroundColor Green
} else {
    Write-Host "✗ Asset metadata not embedded correctly" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 6: Upload test PDF"
$Form2 = @{
    file = Get-Item -Path $DocFile
}
$Upload2Response = Invoke-WebRequest -Uri "$BaseUrl/pots/$PotId/assets" -Method POST `
    -Form $Form2 -UseBasicParsing
$Upload2Body = $Upload2Response.Content | ConvertFrom-Json
$Asset2Id = $Upload2Body.asset.id
Check-Status 201 $Upload2Response.StatusCode "Upload PDF"

Write-Host ""
Write-Host "Step 7: Create doc entry"
$Entry2Response = Invoke-WebRequest -Uri "$BaseUrl/pots/$PotId/entries/doc" -Method POST `
    -Headers @{"Content-Type"="application/json"} `
    -Body "{`"asset_id`":`"$Asset2Id`",`"capture_method`":`"smoke-test`",`"notes`":`"Test document`"}" `
    -UseBasicParsing
$Entry2Body = $Entry2Response.Content | ConvertFrom-Json
Check-Status 201 $Entry2Response.StatusCode "Create doc entry"

if ($Entry2Body.type -eq "doc") {
    Write-Host "✓ Entry type is 'doc'" -ForegroundColor Green
} else {
    Write-Host "✗ Expected type='doc', got $($Entry2Body.type)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 8: Re-upload image (dedupe test)"
$Form3 = @{
    file = Get-Item -Path $ImageFile
}
$Upload3Response = Invoke-WebRequest -Uri "$BaseUrl/pots/$PotId/assets" -Method POST `
    -Form $Form3 -UseBasicParsing
$Upload3Body = $Upload3Response.Content | ConvertFrom-Json
$Created3 = $Upload3Body.created
$Deduped3 = $Upload3Body.deduped
Check-Status 200 $Upload3Response.StatusCode "Re-upload image"

if ($Created3 -eq $false -and $Deduped3 -eq $true) {
    Write-Host "✓ Asset correctly deduped (created=false, deduped=true)" -ForegroundColor Green
} else {
    Write-Host "✗ Dedupe failed (created=$Created3, deduped=$Deduped3)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 9: List pot assets"
$ListResponse = Invoke-WebRequest -Uri "$BaseUrl/pots/$PotId/assets" -Method GET -UseBasicParsing
$ListBody = $ListResponse.Content | ConvertFrom-Json
Check-Status 200 $ListResponse.StatusCode "List pot assets"

$AssetCount = $ListBody.assets.Count
if ($AssetCount -eq 2) {
    Write-Host "✓ Pot has 2 assets" -ForegroundColor Green
} else {
    Write-Host "✗ Expected 2 assets, got $AssetCount" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Phase 4 Smoke Test PASSED ===" -ForegroundColor Green
Write-Host "All 9 steps completed successfully!"
