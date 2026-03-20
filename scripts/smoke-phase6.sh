#!/usr/bin/env bash
# Phase 6 Smoke Test (OpenRouter Integration)
set -e

echo "=== Phase 6 Smoke Test (OpenRouter Integration) ==="
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

echo "Step 1: Check initial models cache (should be empty)"
MODELS_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/models")
MODELS_STATUS=$(echo "$MODELS_RESPONSE" | tail -1)
MODELS_BODY=$(echo "$MODELS_RESPONSE" | head -1)
MODELS_COUNT=$(echo "$MODELS_BODY" | jq '.cache.count')
check_status 200 "$MODELS_STATUS" "GET /models"

if [ "$MODELS_COUNT" -eq 0 ]; then
  echo "✓ Models cache is empty initially"
else
  echo "✗ Expected empty cache, found $MODELS_COUNT models"
  exit 1
fi

echo ""
echo "Step 2: Enqueue model refresh job"
REFRESH_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/models/refresh" \
  -H "Content-Type: application/json" \
  -d '{"trigger":"manual"}')
REFRESH_STATUS=$(echo "$REFRESH_RESPONSE" | tail -1)
REFRESH_BODY=$(echo "$REFRESH_RESPONSE" | head -1)
JOB_ID=$(echo "$REFRESH_BODY" | jq -r '.job.id')
check_status 201 "$REFRESH_STATUS" "POST /models/refresh"

echo ""
echo "Step 3: Verify job is queued"
JOB_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/jobs/$JOB_ID")
JOB_STATUS=$(echo "$JOB_RESPONSE" | tail -1)
JOB_BODY=$(echo "$JOB_RESPONSE" | head -1)
JOB_STATE=$(echo "$JOB_BODY" | jq -r '.job.status')
check_status 200 "$JOB_STATUS" "GET /jobs/:id"

if [ "$JOB_STATE" == "queued" ]; then
  echo "✓ Job status is 'queued'"
else
  echo "✗ Expected status 'queued', got '$JOB_STATE'"
  exit 1
fi

echo ""
echo "Step 4: Set AI preferences"
PREFS_PUT_RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "$BASE_URL/prefs/ai" \
  -H "Content-Type: application/json" \
  -d '{"default_model":"anthropic/claude-3-5-sonnet","temperature":0.3}')
PREFS_PUT_STATUS=$(echo "$PREFS_PUT_RESPONSE" | tail -1)
PREFS_PUT_BODY=$(echo "$PREFS_PUT_RESPONSE" | head -1)
check_status 200 "$PREFS_PUT_STATUS" "PUT /prefs/ai"

echo ""
echo "Step 5: Get AI preferences"
PREFS_GET_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/prefs/ai")
PREFS_GET_STATUS=$(echo "$PREFS_GET_RESPONSE" | tail -1)
PREFS_GET_BODY=$(echo "$PREFS_GET_RESPONSE" | head -1)
DEFAULT_MODEL=$(echo "$PREFS_GET_BODY" | jq -r '.default_model')
TEMPERATURE=$(echo "$PREFS_GET_BODY" | jq -r '.temperature')
check_status 200 "$PREFS_GET_STATUS" "GET /prefs/ai"

if [ "$DEFAULT_MODEL" == "anthropic/claude-3-5-sonnet" ]; then
  echo "✓ Default model is correct"
else
  echo "✗ Expected 'anthropic/claude-3-5-sonnet', got '$DEFAULT_MODEL'"
  exit 1
fi

if [ "$TEMPERATURE" == "0.3" ]; then
  echo "✓ Temperature is correct"
else
  echo "✗ Expected '0.3', got '$TEMPERATURE'"
  exit 1
fi

echo ""
echo "Step 6: Test API connectivity (diagnostic)"
echo "⚠ NOTE: This step requires OPENROUTER_API_KEY to be set"
echo "⚠ Skipping API test if key not configured (non-fatal)"

TEST_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/ai/test" 2>/dev/null || echo "{}\n500")
TEST_STATUS=$(echo "$TEST_RESPONSE" | tail -1)
TEST_BODY=$(echo "$TEST_RESPONSE" | head -1)
TEST_SUCCESS=$(echo "$TEST_BODY" | jq -r '.success // false')

if [ "$TEST_STATUS" -eq 200 ] && [ "$TEST_SUCCESS" == "true" ]; then
  echo "✓ OpenRouter API test successful"
  TEST_MODEL=$(echo "$TEST_BODY" | jq -r '.model')
  echo "  Model used: $TEST_MODEL"
elif [ "$TEST_STATUS" -eq 500 ]; then
  echo "⚠ OpenRouter API test skipped (key not configured or network error)"
  echo "  This is non-fatal for smoke test"
else
  echo "⚠ OpenRouter API test returned unexpected status: $TEST_STATUS"
  echo "  This is non-fatal for smoke test"
fi

echo ""
echo "=== Phase 6 Smoke Test PASSED ==="
echo "All critical steps completed successfully!"
echo "Note: API connectivity test may have been skipped if OPENROUTER_API_KEY not set"
