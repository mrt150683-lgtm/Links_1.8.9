#!/usr/bin/env bash
# Phase 7 Smoke Test (Tagging + Classification)
set -e

echo "=== Phase 7 Smoke Test (Derived Artifacts) ==="
echo ""
echo "⚠ NOTE: Requires OPENROUTER_API_KEY to be set"

BASE_URL="http://localhost:3000"

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
  -d '{"name":"Phase 7 Test Pot"}')
POT_STATUS=$(echo "$POT_RESPONSE" | tail -1)
POT_BODY=$(echo "$POT_RESPONSE" | head -1)
POT_ID=$(echo "$POT_BODY" | jq -r '.id')
check_status 201 "$POT_STATUS" "Create pot"

echo ""
echo "Step 2: Create text entry (triggers artifact jobs)"
ENTRY_TEXT="Machine learning is transforming healthcare. Researchers at Stanford University developed a new neural network architecture that improves diagnostic accuracy. The study, published in Nature Medicine, demonstrates significant improvements in detecting early-stage diseases."

ENTRY_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/capture/text" \
  -H "Content-Type: application/json" \
  -d "{\"pot_id\":\"$POT_ID\",\"text\":\"$ENTRY_TEXT\",\"capture_method\":\"smoke-test\"}")
ENTRY_STATUS=$(echo "$ENTRY_RESPONSE" | tail -1)
ENTRY_BODY=$(echo "$ENTRY_RESPONSE" | head -1)
ENTRY_ID=$(echo "$ENTRY_BODY" | jq -r '.entry.id')
check_status 201 "$ENTRY_STATUS" "Create text entry"

echo ""
echo "Step 3: Run worker to process jobs (3 times for 3 jobs)"
pnpm worker --once > /dev/null 2>&1 || true
echo "  Worker run 1 complete"
sleep 2
pnpm worker --once > /dev/null 2>&1 || true
echo "  Worker run 2 complete"
sleep 2
pnpm worker --once > /dev/null 2>&1 || true
echo "  Worker run 3 complete"
echo "✓ Worker executed 3 times"

echo ""
echo "Step 4: Fetch artifacts for entry"
ARTIFACTS_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/entries/$ENTRY_ID/artifacts")
ARTIFACTS_STATUS=$(echo "$ARTIFACTS_RESPONSE" | tail -1)
ARTIFACTS_BODY=$(echo "$ARTIFACTS_RESPONSE" | head -1)
check_status 200 "$ARTIFACTS_STATUS" "Fetch artifacts"

echo ""
echo "Step 5: Verify tags artifact exists"
TAGS_COUNT=$(echo "$ARTIFACTS_BODY" | jq '[.artifacts[] | select(.artifact_type=="tags")] | length')
if [ "$TAGS_COUNT" -ge 1 ]; then
  TAGS=$(echo "$ARTIFACTS_BODY" | jq -r '.artifacts[] | select(.artifact_type=="tags") | .payload.tags | length')
  echo "✓ Tags artifact exists with $TAGS tags"
else
  echo "✗ Tags artifact not found"
  exit 1
fi

echo ""
echo "Step 6: Verify entities artifact exists"
ENTITIES_COUNT=$(echo "$ARTIFACTS_BODY" | jq '[.artifacts[] | select(.artifact_type=="entities")] | length')
if [ "$ENTITIES_COUNT" -ge 1 ]; then
  ENTITIES=$(echo "$ARTIFACTS_BODY" | jq -r '.artifacts[] | select(.artifact_type=="entities") | .payload.entities | length')
  echo "✓ Entities artifact exists with $ENTITIES entities"
else
  echo "✗ Entities artifact not found"
  exit 1
fi

echo ""
echo "Step 7: Verify summary artifact exists"
SUMMARY_COUNT=$(echo "$ARTIFACTS_BODY" | jq '[.artifacts[] | select(.artifact_type=="summary")] | length')
if [ "$SUMMARY_COUNT" -ge 1 ]; then
  CLAIMS=$(echo "$ARTIFACTS_BODY" | jq -r '.artifacts[] | select(.artifact_type=="summary") | .payload.claims | length')
  echo "✓ Summary artifact exists with $CLAIMS claims"
else
  echo "✗ Summary artifact not found"
  exit 1
fi

echo ""
echo "=== Phase 7 Smoke Test PASSED ==="
echo "All 7 steps completed successfully!"
