# Phase 7 Smoke Test (Tagging + Classification)
$ErrorActionPreference = "Stop"

Write-Host "=== Phase 7 Smoke Test (Derived Artifacts) ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "⚠ NOTE: Requires OPENROUTER_API_KEY to be set" -ForegroundColor Yellow

$BaseUrl = "http://localhost:3000"

function Check-Status {
    param([int]$Expected, [int]$Actual, [string]$Message)
    if ($Expected -eq $Actual) {
        Write-Host "✓ $Message (status: $Actual)" -ForegroundColor Green
    } else {
        Write-Host "✗ $Message (expected: $Expected, got: $Actual)" -ForegroundColor Red
        exit 1
    }
}

Write-Host "Step 1: Create pot"
$PotResponse = Invoke-WebRequest -Uri "$BaseUrl/pots" -Method POST `
    -Headers @{"Content-Type"="application/json"} `
    -Body '{"name":"Phase 7 Test Pot"}' -UseBasicParsing
$PotBody = $PotResponse.Content | ConvertFrom-Json
$PotId = $PotBody.id
Check-Status 201 $PotResponse.StatusCode "Create pot"

Write-Host ""
Write-Host "Step 2: Create text entry (triggers artifact jobs)"
$EntryText = "Machine learning is transforming healthcare. Researchers at Stanford University developed a new neural network architecture that improves diagnostic accuracy. The study, published in Nature Medicine, demonstrates significant improvements in detecting early-stage diseases."
$EntryBody = @{
    pot_id = $PotId
    text = $EntryText
    capture_method = "smoke-test"
} | ConvertTo-Json

$EntryResponse = Invoke-WebRequest -Uri "$BaseUrl/capture/text" -Method POST `
    -Headers @{"Content-Type"="application/json"} -Body $EntryBody -UseBasicParsing
$Entry = $EntryResponse.Content | ConvertFrom-Json
$EntryId = $Entry.entry.id
Check-Status 201 $EntryResponse.StatusCode "Create text entry"

Write-Host ""
Write-Host "Step 3: Run worker to process jobs (3 times for 3 jobs)"
pnpm worker --once *> $null
Write-Host "  Worker run 1 complete"
Start-Sleep -Seconds 2
pnpm worker --once *> $null
Write-Host "  Worker run 2 complete"
Start-Sleep -Seconds 2
pnpm worker --once *> $null
Write-Host "  Worker run 3 complete"
Write-Host "✓ Worker executed 3 times" -ForegroundColor Green

Write-Host ""
Write-Host "Step 4: Fetch artifacts for entry"
$ArtifactsResponse = Invoke-WebRequest -Uri "$BaseUrl/entries/$EntryId/artifacts" -Method GET -UseBasicParsing
$Artifacts = $ArtifactsResponse.Content | ConvertFrom-Json
Check-Status 200 $ArtifactsResponse.StatusCode "Fetch artifacts"

Write-Host ""
Write-Host "Step 5: Verify tags artifact exists"
$TagsArtifact = $Artifacts.artifacts | Where-Object { $_.artifact_type -eq "tags" }
if ($TagsArtifact) {
    $TagsCount = $TagsArtifact.payload.tags.Count
    Write-Host "✓ Tags artifact exists with $TagsCount tags" -ForegroundColor Green
} else {
    Write-Host "✗ Tags artifact not found" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 6: Verify entities artifact exists"
$EntitiesArtifact = $Artifacts.artifacts | Where-Object { $_.artifact_type -eq "entities" }
if ($EntitiesArtifact) {
    $EntitiesCount = $EntitiesArtifact.payload.entities.Count
    Write-Host "✓ Entities artifact exists with $EntitiesCount entities" -ForegroundColor Green
} else {
    Write-Host "✗ Entities artifact not found" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 7: Verify summary artifact exists"
$SummaryArtifact = $Artifacts.artifacts | Where-Object { $_.artifact_type -eq "summary" }
if ($SummaryArtifact) {
    $ClaimsCount = $SummaryArtifact.payload.claims.Count
    Write-Host "✓ Summary artifact exists with $ClaimsCount claims" -ForegroundColor Green
} else {
    Write-Host "✗ Summary artifact not found" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Phase 7 Smoke Test PASSED ===" -ForegroundColor Green
Write-Host "All 7 steps completed successfully!"
