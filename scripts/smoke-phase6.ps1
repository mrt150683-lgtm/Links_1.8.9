# Phase 6 Smoke Test (OpenRouter Integration)
$ErrorActionPreference = "Stop"

Write-Host "=== Phase 6 Smoke Test (OpenRouter Integration) ===" -ForegroundColor Cyan
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

Write-Host "Step 1: Check initial models cache (should be empty)"
$ModelsResponse = Invoke-WebRequest -Uri "$BaseUrl/models" -Method GET -UseBasicParsing
$ModelsBody = $ModelsResponse.Content | ConvertFrom-Json
Check-Status 200 $ModelsResponse.StatusCode "GET /models"

if ($ModelsBody.cache.count -eq 0) {
    Write-Host "✓ Models cache is empty initially" -ForegroundColor Green
} else {
    Write-Host "✗ Expected empty cache, found $($ModelsBody.cache.count) models" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 2: Enqueue model refresh job"
$RefreshResponse = Invoke-WebRequest -Uri "$BaseUrl/models/refresh" -Method POST `
    -Headers @{"Content-Type"="application/json"} `
    -Body '{"trigger":"manual"}' `
    -UseBasicParsing
$RefreshBody = $RefreshResponse.Content | ConvertFrom-Json
$JobId = $RefreshBody.job.id
Check-Status 201 $RefreshResponse.StatusCode "POST /models/refresh"

Write-Host ""
Write-Host "Step 3: Verify job is queued"
$JobResponse = Invoke-WebRequest -Uri "$BaseUrl/jobs/$JobId" -Method GET -UseBasicParsing
$JobBody = $JobResponse.Content | ConvertFrom-Json
Check-Status 200 $JobResponse.StatusCode "GET /jobs/:id"

if ($JobBody.job.status -eq "queued") {
    Write-Host "✓ Job status is 'queued'" -ForegroundColor Green
} else {
    Write-Host "✗ Expected status 'queued', got '$($JobBody.job.status)'" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 4: Set AI preferences"
$PrefsPutResponse = Invoke-WebRequest -Uri "$BaseUrl/prefs/ai" -Method PUT `
    -Headers @{"Content-Type"="application/json"} `
    -Body '{"default_model":"anthropic/claude-3-5-sonnet","temperature":0.3}' `
    -UseBasicParsing
Check-Status 200 $PrefsPutResponse.StatusCode "PUT /prefs/ai"

Write-Host ""
Write-Host "Step 5: Get AI preferences"
$PrefsGetResponse = Invoke-WebRequest -Uri "$BaseUrl/prefs/ai" -Method GET -UseBasicParsing
$PrefsGetBody = $PrefsGetResponse.Content | ConvertFrom-Json
Check-Status 200 $PrefsGetResponse.StatusCode "GET /prefs/ai"

if ($PrefsGetBody.default_model -eq "anthropic/claude-3-5-sonnet") {
    Write-Host "✓ Default model is correct" -ForegroundColor Green
} else {
    Write-Host "✗ Expected 'anthropic/claude-3-5-sonnet', got '$($PrefsGetBody.default_model)'" -ForegroundColor Red
    exit 1
}

if ($PrefsGetBody.temperature -eq 0.3) {
    Write-Host "✓ Temperature is correct" -ForegroundColor Green
} else {
    Write-Host "✗ Expected '0.3', got '$($PrefsGetBody.temperature)'" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Step 6: Test API connectivity (diagnostic)"
Write-Host "⚠ NOTE: This step requires OPENROUTER_API_KEY to be set" -ForegroundColor Yellow
Write-Host "⚠ Skipping API test if key not configured (non-fatal)" -ForegroundColor Yellow

try {
    $TestResponse = Invoke-WebRequest -Uri "$BaseUrl/ai/test" -Method POST -UseBasicParsing
    $TestBody = $TestResponse.Content | ConvertFrom-Json

    if ($TestResponse.StatusCode -eq 200 -and $TestBody.success -eq $true) {
        Write-Host "✓ OpenRouter API test successful" -ForegroundColor Green
        Write-Host "  Model used: $($TestBody.model)"
    } else {
        Write-Host "⚠ OpenRouter API test returned unexpected status: $($TestResponse.StatusCode)" -ForegroundColor Yellow
        Write-Host "  This is non-fatal for smoke test"
    }
} catch {
    Write-Host "⚠ OpenRouter API test skipped (key not configured or network error)" -ForegroundColor Yellow
    Write-Host "  This is non-fatal for smoke test"
}

Write-Host ""
Write-Host "=== Phase 6 Smoke Test PASSED ===" -ForegroundColor Green
Write-Host "All critical steps completed successfully!"
Write-Host "Note: API connectivity test may have been skipped if OPENROUTER_API_KEY not set"
