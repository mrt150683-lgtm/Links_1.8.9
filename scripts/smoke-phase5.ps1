# Phase 5 Smoke Test (Processing Engine)
$ErrorActionPreference = "Stop"

Write-Host "=== Phase 5 Smoke Test (Processing Engine) ===" -ForegroundColor Cyan
Write-Host ""

$BaseUrl = "http://localhost:3000"

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

Write-Host "Step 1: Create pot"
$PotResponse = Invoke-WebRequest -Uri "$BaseUrl/pots" -Method POST `
    -Headers @{"Content-Type"="application/json"} `
    -Body '{"name":"Job Test Pot"}' `
    -UseBasicParsing
$PotBody = $PotResponse.Content | ConvertFrom-Json
$PotId = $PotBody.id
Check-Status 201 $PotResponse.StatusCode "Create pot"

Write-Host ""
Write-Host "Step 2: Create entry"
$EntryResponse = Invoke-WebRequest -Uri "$BaseUrl/pots/$PotId/entries/text" -Method POST `
    -Headers @{"Content-Type"="application/json"} `
    -Body '{"content_text":"Test content for hash verification","capture_method":"smoke-test"}' `
    -UseBasicParsing
$EntryBody = $EntryResponse.Content | ConvertFrom-Json
$EntryId = $EntryBody.id
Check-Status 201 $EntryResponse.StatusCode "Create entry"

Write-Host ""
Write-Host "Step 3: Enqueue touch_pot_usage job"
$Job1Response = Invoke-WebRequest -Uri "$BaseUrl/jobs/enqueue" -Method POST `
    -Headers @{"Content-Type"="application/json"} `
    -Body "{`"job_type`":`"touch_pot_usage`",`"pot_id`":`"$PotId`"}" `
    -UseBasicParsing
$Job1Body = $Job1Response.Content | ConvertFrom-Json
$Job1Id = $Job1Body.job.id
Check-Status 201 $Job1Response.StatusCode "Enqueue touch_pot_usage job"

Write-Host ""
Write-Host "Step 4: Verify job is queued"
$Status1Response = Invoke-WebRequest -Uri "$BaseUrl/jobs/$Job1Id" -Method GET -UseBasicParsing
$Status1Body = $Status1Response.Content | ConvertFrom-Json
Check-Status 200 $Status1Response.StatusCode "Fetch job status"
if ($Status1Body.job.status -eq "queued") {
    Write-Host "✓ Job status is 'queued'" -ForegroundColor Green
} else {
    Write-Host "✗ Expected status 'queued', got '$($Status1Body.job.status)'" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 5: Enqueue verify_entry_hash job"
$Job2Response = Invoke-WebRequest -Uri "$BaseUrl/jobs/enqueue" -Method POST `
    -Headers @{"Content-Type"="application/json"} `
    -Body "{`"job_type`":`"verify_entry_hash`",`"pot_id`":`"$PotId`",`"entry_id`":`"$EntryId`"}" `
    -UseBasicParsing
$Job2Body = $Job2Response.Content | ConvertFrom-Json
$Job2Id = $Job2Body.job.id
Check-Status 201 $Job2Response.StatusCode "Enqueue verify_entry_hash job"

Write-Host ""
Write-Host "Step 6: Run worker once (should process first job)"
pnpm worker --once *> $null
Write-Host "✓ Worker executed" -ForegroundColor Green

Write-Host ""
Write-Host "Step 7: Verify first job is done"
$Done1Response = Invoke-WebRequest -Uri "$BaseUrl/jobs/$Job1Id" -Method GET -UseBasicParsing
$Done1Body = $Done1Response.Content | ConvertFrom-Json
Check-Status 200 $Done1Response.StatusCode "Fetch completed job"
if ($Done1Body.job.status -eq "done") {
    Write-Host "✓ First job status is 'done'" -ForegroundColor Green
} else {
    Write-Host "✗ Expected status 'done', got '$($Done1Body.job.status)'" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 8: Run worker once again (should process second job)"
pnpm worker --once *> $null
Write-Host "✓ Worker executed" -ForegroundColor Green

Write-Host ""
Write-Host "Step 9: Verify second job is done"
$Done2Response = Invoke-WebRequest -Uri "$BaseUrl/jobs/$Job2Id" -Method GET -UseBasicParsing
$Done2Body = $Done2Response.Content | ConvertFrom-Json
Check-Status 200 $Done2Response.StatusCode "Fetch completed job"
if ($Done2Body.job.status -eq "done") {
    Write-Host "✓ Second job status is 'done'" -ForegroundColor Green
} else {
    Write-Host "✗ Expected status 'done', got '$($Done2Body.job.status)'" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 10: List completed jobs"
$ListResponse = Invoke-WebRequest -Uri "$BaseUrl/jobs?status=done" -Method GET -UseBasicParsing
$ListBody = $ListResponse.Content | ConvertFrom-Json
Check-Status 200 $ListResponse.StatusCode "List jobs"
$JobCount = $ListBody.jobs.Count
if ($JobCount -ge 2) {
    Write-Host "✓ Found $JobCount completed jobs" -ForegroundColor Green
} else {
    Write-Host "✗ Expected at least 2 jobs, found $JobCount" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Phase 5 Smoke Test PASSED ===" -ForegroundColor Green
Write-Host "All 10 steps completed successfully!"
