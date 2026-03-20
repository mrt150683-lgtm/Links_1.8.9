#!/usr/bin/env bash
# Phase 5 Smoke Test (Processing Engine)
set -e

echo "=== Phase 5 Smoke Test (Processing Engine) ==="
echo ""

BASE_URL="http://localhost:3000"

# Helper: Check HTTP status
check_status() {
  expected=$1
  actual=$2
  message=$3

  if [ "$expected" -eq "$actual" ]; then
    echo "✓ $message (status: $actual)"
  else
    echo "✗ $message (expected: $expected, got: $actual)"
    exit 1
  fi
}

echo "Step 1: Create pot"
POT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/pots" \
  -H "Content-Type: application/json" \
  -d '{"name":"Job Test Pot"}')
POT_STATUS=$(echo "$POT_RESPONSE" | tail -1)
POT_BODY=$(echo "$POT_RESPONSE" | head -1)
POT_ID=$(echo "$POT_BODY" | jq -r '.id')
check_status 201 "$POT_STATUS" "Create pot"

echo ""
echo "Step 2: Create entry"
ENTRY_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/pots/$POT_ID/entries/text" \
  -H "Content-Type: application/json" \
  -d '{"content_text":"Test content for hash verification","capture_method":"smoke-test"}')
ENTRY_STATUS=$(echo "$ENTRY_RESPONSE" | tail -1)
ENTRY_BODY=$(echo "$ENTRY_RESPONSE" | head -1)
ENTRY_ID=$(echo "$ENTRY_BODY" | jq -r '.id')
check_status 201 "$ENTRY_STATUS" "Create entry"

echo ""
echo "Step 3: Enqueue touch_pot_usage job"
JOB1_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/jobs/enqueue" \
  -H "Content-Type: application/json" \
  -d "{\"job_type\":\"touch_pot_usage\",\"pot_id\":\"$POT_ID\"}")
JOB1_STATUS=$(echo "$JOB1_RESPONSE" | tail -1)
JOB1_BODY=$(echo "$JOB1_RESPONSE" | head -1)
JOB1_ID=$(echo "$JOB1_BODY" | jq -r '.job.id')
check_status 201 "$JOB1_STATUS" "Enqueue touch_pot_usage job"

echo ""
echo "Step 4: Verify job is queued"
STATUS1_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/jobs/$JOB1_ID")
STATUS1_CODE=$(echo "$STATUS1_RESPONSE" | tail -1)
STATUS1_BODY=$(echo "$STATUS1_RESPONSE" | head -1)
STATUS1=$(echo "$STATUS1_BODY" | jq -r '.job.status')
check_status 200 "$STATUS1_CODE" "Fetch job status"
if [ "$STATUS1" == "queued" ]; then
  echo "✓ Job status is 'queued'"
else
  echo "✗ Expected status 'queued', got '$STATUS1'"
  exit 1
fi

echo ""
echo "Step 5: Enqueue verify_entry_hash job"
JOB2_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/jobs/enqueue" \
  -H "Content-Type: application/json" \
  -d "{\"job_type\":\"verify_entry_hash\",\"pot_id\":\"$POT_ID\",\"entry_id\":\"$ENTRY_ID\"}")
JOB2_STATUS=$(echo "$JOB2_RESPONSE" | tail -1)
JOB2_BODY=$(echo "$JOB2_RESPONSE" | head -1)
JOB2_ID=$(echo "$JOB2_BODY" | jq -r '.job.id')
check_status 201 "$JOB2_STATUS" "Enqueue verify_entry_hash job"

echo ""
echo "Step 6: Run worker once (should process first job)"
pnpm worker --once > /dev/null 2>&1 || true
echo "✓ Worker executed"

echo ""
echo "Step 7: Verify first job is done"
DONE1_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/jobs/$JOB1_ID")
DONE1_CODE=$(echo "$DONE1_RESPONSE" | tail -1)
DONE1_BODY=$(echo "$DONE1_RESPONSE" | head -1)
DONE1_STATUS=$(echo "$DONE1_BODY" | jq -r '.job.status')
check_status 200 "$DONE1_CODE" "Fetch completed job"
if [ "$DONE1_STATUS" == "done" ]; then
  echo "✓ First job status is 'done'"
else
  echo "✗ Expected status 'done', got '$DONE1_STATUS'"
  exit 1
fi

echo ""
echo "Step 8: Run worker once again (should process second job)"
pnpm worker --once > /dev/null 2>&1 || true
echo "✓ Worker executed"

echo ""
echo "Step 9: Verify second job is done"
DONE2_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/jobs/$JOB2_ID")
DONE2_CODE=$(echo "$DONE2_RESPONSE" | tail -1)
DONE2_BODY=$(echo "$DONE2_RESPONSE" | head -1)
DONE2_STATUS=$(echo "$DONE2_BODY" | jq -r '.job.status')
check_status 200 "$DONE2_CODE" "Fetch completed job"
if [ "$DONE2_STATUS" == "done" ]; then
  echo "✓ Second job status is 'done'"
else
  echo "✗ Expected status 'done', got '$DONE2_STATUS'"
  exit 1
fi

echo ""
echo "Step 10: List completed jobs"
LIST_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/jobs?status=done")
LIST_CODE=$(echo "$LIST_RESPONSE" | tail -1)
LIST_BODY=$(echo "$LIST_RESPONSE" | head -1)
JOB_COUNT=$(echo "$LIST_BODY" | jq '.jobs | length')
check_status 200 "$LIST_CODE" "List jobs"
if [ "$JOB_COUNT" -ge 2 ]; then
  echo "✓ Found $JOB_COUNT completed jobs"
else
  echo "✗ Expected at least 2 jobs, found $JOB_COUNT"
  exit 1
fi

echo ""
echo "=== Phase 5 Smoke Test PASSED ==="
echo "All 10 steps completed successfully!"
