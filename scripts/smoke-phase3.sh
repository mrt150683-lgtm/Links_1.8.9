#!/usr/bin/env bash
set -e

echo "=== Phase 3 Smoke Test ==="
echo ""

BASE_URL="http://localhost:3000"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to check response
check_status() {
  local expected=$1
  local actual=$2
  local message=$3

  if [ "$expected" -eq "$actual" ]; then
    echo -e "${GREEN}✓${NC} $message (status: $actual)"
  else
    echo -e "${RED}✗${NC} $message (expected: $expected, got: $actual)"
    exit 1
  fi
}

echo "Step 1: Create two pots"
POT1_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X POST "$BASE_URL/pots" \
  -H "Content-Type: application/json" \
  -d '{"name":"Research Pot"}')
POT1_BODY=$(echo "$POT1_RESPONSE" | head -n -1)
POT1_STATUS=$(echo "$POT1_RESPONSE" | tail -n 1)
POT1_ID=$(echo "$POT1_BODY" | jq -r '.id')
check_status 201 "$POT1_STATUS" "Create pot 1"

POT2_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X POST "$BASE_URL/pots" \
  -H "Content-Type: application/json" \
  -d '{"name":"Work Pot"}')
POT2_BODY=$(echo "$POT2_RESPONSE" | head -n -1)
POT2_STATUS=$(echo "$POT2_RESPONSE" | tail -n 1)
POT2_ID=$(echo "$POT2_BODY" | jq -r '.id')
check_status 201 "$POT2_STATUS" "Create pot 2"

echo ""
echo "Step 2: Get pot picker (should be sorted by created_at initially)"
PICKER_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X GET "$BASE_URL/capture/pots")
PICKER_BODY=$(echo "$PICKER_RESPONSE" | head -n -1)
PICKER_STATUS=$(echo "$PICKER_RESPONSE" | tail -n 1)
check_status 200 "$PICKER_STATUS" "Get pot picker"

POT_COUNT=$(echo "$PICKER_BODY" | jq 'length')
if [ "$POT_COUNT" -eq 2 ]; then
  echo -e "${GREEN}✓${NC} Pot picker returned 2 pots"
else
  echo -e "${RED}✗${NC} Expected 2 pots, got $POT_COUNT"
  exit 1
fi

echo ""
echo "Step 3: Set default pot preference"
PREFS_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X PUT "$BASE_URL/prefs/capture" \
  -H "Content-Type: application/json" \
  -d "{\"default_pot_id\":\"$POT1_ID\"}")
PREFS_STATUS=$(echo "$PREFS_RESPONSE" | tail -n 1)
check_status 200 "$PREFS_STATUS" "Set default pot preference"

echo ""
echo "Step 4: Get preferences (verify persistence)"
GET_PREFS_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X GET "$BASE_URL/prefs/capture")
GET_PREFS_BODY=$(echo "$GET_PREFS_RESPONSE" | head -n -1)
GET_PREFS_STATUS=$(echo "$GET_PREFS_RESPONSE" | tail -n 1)
check_status 200 "$GET_PREFS_STATUS" "Get preferences"

DEFAULT_POT=$(echo "$GET_PREFS_BODY" | jq -r '.default_pot_id')
if [ "$DEFAULT_POT" = "$POT1_ID" ]; then
  echo -e "${GREEN}✓${NC} Default pot preference persisted correctly"
else
  echo -e "${RED}✗${NC} Default pot preference mismatch"
  exit 1
fi

echo ""
echo "Step 5: Capture text with client_capture_id"
CAPTURE1_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X POST "$BASE_URL/capture/text" \
  -H "Content-Type: application/json" \
  -d "{
    \"pot_id\":\"$POT2_ID\",
    \"text\":\"Important research finding\",
    \"capture_method\":\"clipboard\",
    \"client_capture_id\":\"test-capture-123\"
  }")
CAPTURE1_BODY=$(echo "$CAPTURE1_RESPONSE" | head -n -1)
CAPTURE1_STATUS=$(echo "$CAPTURE1_RESPONSE" | tail -n 1)
check_status 201 "$CAPTURE1_STATUS" "First capture"

CREATED=$(echo "$CAPTURE1_BODY" | jq -r '.created')
if [ "$CREATED" = "true" ]; then
  echo -e "${GREEN}✓${NC} Entry created successfully"
else
  echo -e "${RED}✗${NC} Expected created=true"
  exit 1
fi

echo ""
echo "Step 6: Repeat capture (should dedupe by client_capture_id)"
CAPTURE2_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X POST "$BASE_URL/capture/text" \
  -H "Content-Type: application/json" \
  -d "{
    \"pot_id\":\"$POT2_ID\",
    \"text\":\"Different content\",
    \"capture_method\":\"clipboard\",
    \"client_capture_id\":\"test-capture-123\"
  }")
CAPTURE2_BODY=$(echo "$CAPTURE2_RESPONSE" | head -n -1)
CAPTURE2_STATUS=$(echo "$CAPTURE2_RESPONSE" | tail -n 1)
check_status 200 "$CAPTURE2_STATUS" "Duplicate capture"

DEDUPED=$(echo "$CAPTURE2_BODY" | jq -r '.deduped')
DEDUPE_REASON=$(echo "$CAPTURE2_BODY" | jq -r '.dedupe_reason')
if [ "$DEDUPED" = "true" ] && [ "$DEDUPE_REASON" = "client_capture_id" ]; then
  echo -e "${GREEN}✓${NC} Deduplication worked (reason: $DEDUPE_REASON)"
else
  echo -e "${RED}✗${NC} Expected deduped=true with reason=client_capture_id"
  exit 1
fi

echo ""
echo "Step 7: Check pot picker ordering (pot 2 should be first now)"
PICKER2_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X GET "$BASE_URL/capture/pots")
PICKER2_BODY=$(echo "$PICKER2_RESPONSE" | head -n -1)
PICKER2_STATUS=$(echo "$PICKER2_RESPONSE" | tail -n 1)
check_status 200 "$PICKER2_STATUS" "Get pot picker (after capture)"

FIRST_POT=$(echo "$PICKER2_BODY" | jq -r '.[0].id')
if [ "$FIRST_POT" = "$POT2_ID" ]; then
  echo -e "${GREEN}✓${NC} Pot picker correctly sorted by last_used_at"
else
  echo -e "${RED}✗${NC} Expected pot 2 to be first (most recently used)"
  exit 1
fi

echo ""
echo "Step 8: Enable autosave globally"
AUTOSAVE_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X PUT "$BASE_URL/prefs/capture" \
  -H "Content-Type: application/json" \
  -d '{"autosave":{"enabled":true}}')
AUTOSAVE_STATUS=$(echo "$AUTOSAVE_RESPONSE" | tail -n 1)
check_status 200 "$AUTOSAVE_STATUS" "Enable autosave"

echo ""
echo "Step 9: Test autosave endpoint"
AUTOSAVE_CAPTURE_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X POST "$BASE_URL/capture/text/auto" \
  -H "Content-Type: application/json" \
  -d "{
    \"pot_id\":\"$POT1_ID\",
    \"text\":\"Autosaved content\",
    \"capture_method\":\"autosave\"
  }")
AUTOSAVE_CAPTURE_BODY=$(echo "$AUTOSAVE_CAPTURE_RESPONSE" | head -n -1)
AUTOSAVE_CAPTURE_STATUS=$(echo "$AUTOSAVE_CAPTURE_RESPONSE" | tail -n 1)
check_status 201 "$AUTOSAVE_CAPTURE_STATUS" "Autosave capture"

AUTOSAVE_CREATED=$(echo "$AUTOSAVE_CAPTURE_BODY" | jq -r '.created')
if [ "$AUTOSAVE_CREATED" = "true" ]; then
  echo -e "${GREEN}✓${NC} Autosave entry created successfully"
else
  echo -e "${RED}✗${NC} Expected created=true for autosave"
  exit 1
fi

echo ""
echo -e "${GREEN}✅ All Phase 3 smoke tests passed!${NC}"
