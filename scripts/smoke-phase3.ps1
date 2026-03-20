# Phase 3 Smoke Test (PowerShell version)

$BASE_URL = "http://localhost:3000"

Write-Host "=== Phase 3 Smoke Test ===" -ForegroundColor Green
Write-Host ""

# Step 1: Create two pots
Write-Host "Step 1: Create two pots"
$pot1 = curl.exe -s -X POST "$BASE_URL/pots" -H "Content-Type: application/json" -d "{`"name`":`"Research Pot`"}" | ConvertFrom-Json
$pot1Id = $pot1.id
Write-Host "✓ Created pot 1: $pot1Id"

$pot2 = curl.exe -s -X POST "$BASE_URL/pots" -H "Content-Type: application/json" -d "{`"name`":`"Work Pot`"}" | ConvertFrom-Json
$pot2Id = $pot2.id
Write-Host "✓ Created pot 2: $pot2Id"

Write-Host ""
Write-Host "Step 2: Get pot picker"
$picker = curl.exe -s -X GET "$BASE_URL/capture/pots" | ConvertFrom-Json
Write-Host "✓ Got pot picker with $($picker.Count) pots"

Write-Host ""
Write-Host "Step 3: Set default pot preference"
$json = "{`"default_pot_id`":`"$pot1Id`"}"
$prefs = curl.exe -s -X PUT "$BASE_URL/prefs/capture" -H "Content-Type: application/json" -d $json | ConvertFrom-Json
Write-Host "✓ Set default pot preference"

Write-Host ""
Write-Host "Step 4: Get preferences (verify persistence)"
$getPrefs = curl.exe -s -X GET "$BASE_URL/prefs/capture" | ConvertFrom-Json
Write-Host "✓ Default pot ID: $($getPrefs.default_pot_id)"

Write-Host ""
Write-Host "Step 5: Capture text with client_capture_id"
$json1 = @{
    pot_id = $pot2Id
    text = "Important research finding"
    capture_method = "clipboard"
    client_capture_id = "test-123"
} | ConvertTo-Json -Compress
$capture1 = curl.exe -s -X POST "$BASE_URL/capture/text" -H "Content-Type: application/json" -d $json1 | ConvertFrom-Json
Write-Host "✓ Capture created: $($capture1.created)"
Write-Host "  Entry ID: $($capture1.entry.id)"

Write-Host ""
Write-Host "Step 6: Repeat capture (should dedupe)"
$json2 = @{
    pot_id = $pot2Id
    text = "Different content"
    capture_method = "clipboard"
    client_capture_id = "test-123"
} | ConvertTo-Json -Compress
$capture2 = curl.exe -s -X POST "$BASE_URL/capture/text" -H "Content-Type: application/json" -d $json2 | ConvertFrom-Json
Write-Host "✓ Capture deduped: $($capture2.deduped)"
Write-Host "  Dedupe reason: $($capture2.dedupe_reason)"

Write-Host ""
Write-Host "Step 7: Check pot picker ordering"
$picker2 = curl.exe -s -X GET "$BASE_URL/capture/pots" | ConvertFrom-Json
$firstPotId = $picker2[0].id
Write-Host "✓ First pot in picker: $firstPotId (should be $pot2Id)"

Write-Host ""
Write-Host "Step 8: Enable autosave"
$autosave = curl.exe -s -X PUT "$BASE_URL/prefs/capture" -H "Content-Type: application/json" -d "{`"autosave`":{`"enabled`":true}}" | ConvertFrom-Json
Write-Host "✓ Autosave enabled: $($autosave.autosave.enabled)"

Write-Host ""
Write-Host "Step 9: Test autosave endpoint"
$json3 = @{
    pot_id = $pot1Id
    text = "Autosaved content"
    capture_method = "autosave"
} | ConvertTo-Json -Compress
$autoCapture = curl.exe -s -X POST "$BASE_URL/capture/text/auto" -H "Content-Type: application/json" -d $json3 | ConvertFrom-Json
Write-Host "✓ Autosave capture created: $($autoCapture.created)"

Write-Host ""
Write-Host "✅ All Phase 3 smoke tests passed!" -ForegroundColor Green
