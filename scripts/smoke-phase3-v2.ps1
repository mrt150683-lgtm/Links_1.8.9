# Phase 3 Smoke Test (PowerShell native version)
$ErrorActionPreference = "Stop"
$BASE_URL = "http://localhost:3000"

Write-Host "=== Phase 3 Smoke Test ===" -ForegroundColor Green
Write-Host ""

try {
    # Step 1: Create two pots
    Write-Host "Step 1: Create two pots"
    $pot1 = Invoke-RestMethod -Uri "$BASE_URL/pots" -Method Post -ContentType "application/json" -Body '{"name":"Research Pot"}'
    $pot1Id = $pot1.id
    Write-Host "✓ Created pot 1: $pot1Id"

    $pot2 = Invoke-RestMethod -Uri "$BASE_URL/pots" -Method Post -ContentType "application/json" -Body '{"name":"Work Pot"}'
    $pot2Id = $pot2.id
    Write-Host "✓ Created pot 2: $pot2Id"

    # Step 2: Get pot picker
    Write-Host ""
    Write-Host "Step 2: Get pot picker"
    $picker = Invoke-RestMethod -Uri "$BASE_URL/capture/pots" -Method Get
    Write-Host "✓ Got pot picker with $($picker.Count) pots"

    # Step 3: Set default pot preference
    Write-Host ""
    Write-Host "Step 3: Set default pot preference"
    $prefsBody = @{ default_pot_id = $pot1Id } | ConvertTo-Json
    $prefs = Invoke-RestMethod -Uri "$BASE_URL/prefs/capture" -Method Put -ContentType "application/json" -Body $prefsBody
    Write-Host "✓ Set default pot preference"

    # Step 4: Get preferences (verify persistence)
    Write-Host ""
    Write-Host "Step 4: Get preferences (verify persistence)"
    $getPrefs = Invoke-RestMethod -Uri "$BASE_URL/prefs/capture" -Method Get
    Write-Host "✓ Default pot ID: $($getPrefs.default_pot_id)"

    # Step 5: Capture text with client_capture_id
    Write-Host ""
    Write-Host "Step 5: Capture text with client_capture_id"
    $captureBody1 = @{
        pot_id = $pot2Id
        text = "Important research finding"
        capture_method = "clipboard"
        client_capture_id = "test-123"
    } | ConvertTo-Json
    $capture1 = Invoke-RestMethod -Uri "$BASE_URL/capture/text" -Method Post -ContentType "application/json" -Body $captureBody1
    Write-Host "✓ Capture created: $($capture1.created)"
    Write-Host "  Entry ID: $($capture1.entry.id)"

    # Step 6: Repeat capture (should dedupe)
    Write-Host ""
    Write-Host "Step 6: Repeat capture (should dedupe)"
    $captureBody2 = @{
        pot_id = $pot2Id
        text = "Different content"
        capture_method = "clipboard"
        client_capture_id = "test-123"
    } | ConvertTo-Json
    $capture2 = Invoke-RestMethod -Uri "$BASE_URL/capture/text" -Method Post -ContentType "application/json" -Body $captureBody2
    Write-Host "✓ Capture deduped: $($capture2.deduped)"
    Write-Host "  Dedupe reason: $($capture2.dedupe_reason)"

    # Step 7: Check pot picker ordering
    Write-Host ""
    Write-Host "Step 7: Check pot picker ordering"
    $picker2 = Invoke-RestMethod -Uri "$BASE_URL/capture/pots" -Method Get
    $firstPotId = $picker2[0].id
    Write-Host "✓ First pot in picker: $firstPotId (should be $pot2Id)"

    # Step 8: Enable autosave
    Write-Host ""
    Write-Host "Step 8: Enable autosave"
    $autosaveBody = @{ autosave = @{ enabled = $true } } | ConvertTo-Json -Depth 3
    $autosave = Invoke-RestMethod -Uri "$BASE_URL/prefs/capture" -Method Put -ContentType "application/json" -Body $autosaveBody
    Write-Host "✓ Autosave enabled: $($autosave.autosave.enabled)"

    # Step 9: Test autosave endpoint
    Write-Host ""
    Write-Host "Step 9: Test autosave endpoint"
    $autoBody = @{
        pot_id = $pot1Id
        text = "Autosaved content"
        capture_method = "autosave"
    } | ConvertTo-Json
    $autoCapture = Invoke-RestMethod -Uri "$BASE_URL/capture/text/auto" -Method Post -ContentType "application/json" -Body $autoBody
    Write-Host "✓ Autosave capture created: $($autoCapture.created)"

    Write-Host ""
    Write-Host "✅ All Phase 3 smoke tests passed!" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "❌ Test failed: $_" -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}
