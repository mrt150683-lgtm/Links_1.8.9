# Phase 8 Smoke Test: Link Discovery
# Tests candidate generation and link queries

$ErrorActionPreference = "Stop"

$API_URL = if ($env:API_URL) { $env:API_URL } else { "http://localhost:3000" }

Write-Host "`nPhase 8 Smoke Test: Link Discovery`n" -ForegroundColor Cyan

# Step 1: Create pot
Write-Host "1. Creating pot..." -NoNewline
$potPayload = @{
    name = "Phase 8 Smoke Test"
    description = "Testing link discovery"
} | ConvertTo-Json

try {
    $potResponse = Invoke-RestMethod -Uri "$API_URL/pots" -Method Post `
        -ContentType "application/json" -Body $potPayload
    $potId = $potResponse.id
    Write-Host " OK" -ForegroundColor Green
    Write-Host "   Pot ID: $potId" -ForegroundColor Gray
} catch {
    Write-Host " FAILED" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}

# Step 2: Create entry 1
Write-Host "2. Creating entry 1 (about AI research)..." -NoNewline
$entry1Payload = @{
    content = "Dr. Jane Smith published research on neural networks at Stanford. The machine learning study examined transformer architectures."
    capture_method = "smoke_test"
    captured_at = [int64](Get-Date -UFormat %s) * 1000
} | ConvertTo-Json

try {
    $entry1Response = Invoke-RestMethod -Uri "$API_URL/pots/$potId/entries" -Method Post `
        -ContentType "application/json" -Body $entry1Payload
    $entry1Id = $entry1Response.id
    Write-Host " OK" -ForegroundColor Green
    Write-Host "   Entry 1 ID: $entry1Id" -ForegroundColor Gray
} catch {
    Write-Host " FAILED" -ForegroundColor Red
    exit 1
}

# Step 3: Create entry 2
Write-Host "3. Creating entry 2 (related to entry 1)..." -NoNewline
$entry2Payload = @{
    content = "Jane Smith team at Stanford developed new machine learning techniques. Neural network training showed significant improvements."
    capture_method = "smoke_test"
    captured_at = [int64](Get-Date -UFormat %s) * 1000
} | ConvertTo-Json

try {
    $entry2Response = Invoke-RestMethod -Uri "$API_URL/pots/$potId/entries" -Method Post `
        -ContentType "application/json" -Body $entry2Payload
    $entry2Id = $entry2Response.id
    Write-Host " OK" -ForegroundColor Green
    Write-Host "   Entry 2 ID: $entry2Id" -ForegroundColor Gray
} catch {
    Write-Host " FAILED" -ForegroundColor Red
    exit 1
}

# Step 4: Create entry 3
Write-Host "4. Creating entry 3 (unrelated topic)..." -NoNewline
$entry3Payload = @{
    content = "Climate scientists reported accelerating ice melt in Antarctica. Ocean temperatures reached record highs."
    capture_method = "smoke_test"
    captured_at = [int64](Get-Date -UFormat %s) * 1000
} | ConvertTo-Json

try {
    $entry3Response = Invoke-RestMethod -Uri "$API_URL/pots/$potId/entries" -Method Post `
        -ContentType "application/json" -Body $entry3Payload
    $entry3Id = $entry3Response.id
    Write-Host " OK" -ForegroundColor Green
    Write-Host "   Entry 3 ID: $entry3Id" -ForegroundColor Gray
} catch {
    Write-Host " FAILED" -ForegroundColor Red
    exit 1
}

# Step 5: Trigger link discovery
Write-Host "5. Triggering link discovery for entry 1..." -NoNewline
$discoveryPayload = @{
    max_candidates = 30
    force = $true
} | ConvertTo-Json

try {
    $discoveryResponse = Invoke-RestMethod -Uri "$API_URL/entries/$entry1Id/link-discovery" -Method Post `
        -ContentType "application/json" -Body $discoveryPayload
    $jobId = $discoveryResponse.job_id
    Write-Host " OK" -ForegroundColor Green
    Write-Host "   Job ID: $jobId" -ForegroundColor Gray
} catch {
    Write-Host " FAILED" -ForegroundColor Red
    exit 1
}

# Step 6: Wait for processing
Write-Host "6. Waiting for candidate generation..." -NoNewline
Start-Sleep -Seconds 2
Write-Host " OK" -ForegroundColor Green

# Step 7: Query links for entry 1
Write-Host "7. Querying links for entry 1..." -NoNewline
try {
    $linksResponse = Invoke-RestMethod -Uri "$API_URL/entries/$entry1Id/links?min_confidence=0" -Method Get
    $linksCount = $linksResponse.links.Count
    Write-Host " OK" -ForegroundColor Green
    Write-Host "   Links found: $linksCount" -ForegroundColor Gray
} catch {
    Write-Host " FAILED" -ForegroundColor Red
    exit 1
}

# Step 8: Query pot links
Write-Host "8. Querying all links in pot..." -NoNewline
try {
    $potLinksResponse = Invoke-RestMethod -Uri "$API_URL/pots/$potId/links?min_confidence=0" -Method Get
    $potLinksCount = $potLinksResponse.total_count
    Write-Host " OK" -ForegroundColor Green
    Write-Host "   Total links: $potLinksCount" -ForegroundColor Gray
} catch {
    Write-Host " FAILED" -ForegroundColor Red
    exit 1
}

# Step 9: Count links
Write-Host "9. Counting links for entry 1..." -NoNewline
try {
    $countResponse = Invoke-RestMethod -Uri "$API_URL/entries/$entry1Id/links/count?min_confidence=0" -Method Get
    $count = $countResponse.count
    Write-Host " OK" -ForegroundColor Green
    Write-Host "   Count: $count" -ForegroundColor Gray
} catch {
    Write-Host " FAILED" -ForegroundColor Red
    exit 1
}

# Step 10: Verify structure
Write-Host "10. Verifying response structure..." -NoNewline
if ($linksResponse.entry_id -and $linksResponse.links) {
    Write-Host " OK" -ForegroundColor Green
} else {
    Write-Host " FAILED" -ForegroundColor Red
    exit 1
}

Write-Host "`n" -NoNewline
Write-Host "Phase 8 Smoke Test PASSED" -ForegroundColor Green -BackgroundColor Black
Write-Host "`nSummary:" -ForegroundColor Cyan
Write-Host "  - Pot created: $potId"
Write-Host "  - Entries created: 3"
Write-Host "  - Link discovery job: $jobId"
Write-Host "  - Links found: $linksCount"
Write-Host "`nNote: If links count is 0, worker may not have processed yet."
Write-Host "Run worker with: pnpm worker --once"
