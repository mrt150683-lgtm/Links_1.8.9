#!/usr/bin/env bash
set -e

echo "=== Phase 4 Smoke Test (Asset Store) ==="
echo ""

BASE_URL="http://localhost:3000"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_FILE="$SCRIPT_DIR/fixtures/smoke-test-image.png"
DOC_FILE="$SCRIPT_DIR/fixtures/smoke-test-doc.pdf"

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

# Verify fixtures exist
if [ ! -f "$IMAGE_FILE" ]; then
  echo -e "${RED}✗${NC} Test image not found: $IMAGE_FILE"
  exit 1
fi

if [ ! -f "$DOC_FILE" ]; then
  echo -e "${RED}✗${NC} Test document not found: $DOC_FILE"
  exit 1
fi

echo "Step 1: Create pot"
POT_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X POST "$BASE_URL/pots" \
  -H "Content-Type: application/json" \
  -d '{"name":"Asset Test Pot"}')
POT_BODY=$(echo "$POT_RESPONSE" | head -n -1)
POT_STATUS=$(echo "$POT_RESPONSE" | tail -n 1)
POT_ID=$(echo "$POT_BODY" | jq -r '.id')
check_status 201 "$POT_STATUS" "Create pot"

echo ""
echo "Step 2: Upload test image"
UPLOAD1_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X POST "$BASE_URL/pots/$POT_ID/assets" \
  -F "file=@$IMAGE_FILE")
UPLOAD1_BODY=$(echo "$UPLOAD1_RESPONSE" | head -n -1)
UPLOAD1_STATUS=$(echo "$UPLOAD1_RESPONSE" | tail -n 1)
ASSET1_ID=$(echo "$UPLOAD1_BODY" | jq -r '.asset.id')
CREATED1=$(echo "$UPLOAD1_BODY" | jq -r '.created')
check_status 201 "$UPLOAD1_STATUS" "Upload image"

if [ "$CREATED1" = "true" ]; then
  echo -e "${GREEN}✓${NC} Asset created (not deduped)"
else
  echo -e "${RED}✗${NC} Expected created=true, got $CREATED1"
  exit 1
fi

echo ""
echo "Step 3: Verify asset metadata"
SHA256=$(echo "$UPLOAD1_BODY" | jq -r '.asset.sha256')
SIZE=$(echo "$UPLOAD1_BODY" | jq -r '.asset.size_bytes')
MIME=$(echo "$UPLOAD1_BODY" | jq -r '.asset.mime_type')

if [[ "$SHA256" =~ ^[0-9a-f]{64}$ ]]; then
  echo -e "${GREEN}✓${NC} Asset has valid SHA-256: $SHA256"
else
  echo -e "${RED}✗${NC} Invalid SHA-256: $SHA256"
  exit 1
fi

if [ "$SIZE" -gt 0 ]; then
  echo -e "${GREEN}✓${NC} Asset size: $SIZE bytes"
else
  echo -e "${RED}✗${NC} Invalid asset size: $SIZE"
  exit 1
fi

echo -e "${GREEN}✓${NC} Asset MIME type: $MIME"

echo ""
echo "Step 4: Create image entry"
ENTRY1_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X POST "$BASE_URL/pots/$POT_ID/entries/image" \
  -H "Content-Type: application/json" \
  -d "{\"asset_id\":\"$ASSET1_ID\",\"capture_method\":\"smoke-test\"}")
ENTRY1_BODY=$(echo "$ENTRY1_RESPONSE" | head -n -1)
ENTRY1_STATUS=$(echo "$ENTRY1_RESPONSE" | tail -n 1)
ENTRY1_ID=$(echo "$ENTRY1_BODY" | jq -r '.id')
check_status 201 "$ENTRY1_STATUS" "Create image entry"

ENTRY1_TYPE=$(echo "$ENTRY1_BODY" | jq -r '.type')
if [ "$ENTRY1_TYPE" = "image" ]; then
  echo -e "${GREEN}✓${NC} Entry type is 'image'"
else
  echo -e "${RED}✗${NC} Expected type='image', got $ENTRY1_TYPE"
  exit 1
fi

echo ""
echo "Step 5: Fetch entry with asset metadata"
FETCH_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X GET "$BASE_URL/entries/$ENTRY1_ID")
FETCH_BODY=$(echo "$FETCH_RESPONSE" | head -n -1)
FETCH_STATUS=$(echo "$FETCH_RESPONSE" | tail -n 1)
check_status 200 "$FETCH_STATUS" "Fetch entry"

EMBEDDED_ASSET_ID=$(echo "$FETCH_BODY" | jq -r '.asset.id')
if [ "$EMBEDDED_ASSET_ID" = "$ASSET1_ID" ]; then
  echo -e "${GREEN}✓${NC} Entry includes embedded asset metadata"
else
  echo -e "${RED}✗${NC} Asset metadata not embedded correctly"
  exit 1
fi

echo ""
echo "Step 6: Upload test PDF"
UPLOAD2_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X POST "$BASE_URL/pots/$POT_ID/assets" \
  -F "file=@$DOC_FILE")
UPLOAD2_BODY=$(echo "$UPLOAD2_RESPONSE" | head -n -1)
UPLOAD2_STATUS=$(echo "$UPLOAD2_RESPONSE" | tail -n 1)
ASSET2_ID=$(echo "$UPLOAD2_BODY" | jq -r '.asset.id')
check_status 201 "$UPLOAD2_STATUS" "Upload PDF"

echo ""
echo "Step 7: Create doc entry"
ENTRY2_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X POST "$BASE_URL/pots/$POT_ID/entries/doc" \
  -H "Content-Type: application/json" \
  -d "{\"asset_id\":\"$ASSET2_ID\",\"capture_method\":\"smoke-test\",\"notes\":\"Test document\"}")
ENTRY2_BODY=$(echo "$ENTRY2_RESPONSE" | head -n -1)
ENTRY2_STATUS=$(echo "$ENTRY2_RESPONSE" | tail -n 1)
check_status 201 "$ENTRY2_STATUS" "Create doc entry"

ENTRY2_TYPE=$(echo "$ENTRY2_BODY" | jq -r '.type')
if [ "$ENTRY2_TYPE" = "doc" ]; then
  echo -e "${GREEN}✓${NC} Entry type is 'doc'"
else
  echo -e "${RED}✗${NC} Expected type='doc', got $ENTRY2_TYPE"
  exit 1
fi

echo ""
echo "Step 8: Re-upload image (dedupe test)"
UPLOAD3_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X POST "$BASE_URL/pots/$POT_ID/assets" \
  -F "file=@$IMAGE_FILE")
UPLOAD3_BODY=$(echo "$UPLOAD3_RESPONSE" | head -n -1)
UPLOAD3_STATUS=$(echo "$UPLOAD3_RESPONSE" | tail -n 1)
CREATED3=$(echo "$UPLOAD3_BODY" | jq -r '.created')
DEDUPED3=$(echo "$UPLOAD3_BODY" | jq -r '.deduped')
check_status 200 "$UPLOAD3_STATUS" "Re-upload image"

if [ "$CREATED3" = "false" ] && [ "$DEDUPED3" = "true" ]; then
  echo -e "${GREEN}✓${NC} Asset correctly deduped (created=false, deduped=true)"
else
  echo -e "${RED}✗${NC} Dedupe failed (created=$CREATED3, deduped=$DEDUPED3)"
  exit 1
fi

echo ""
echo "Step 9: List pot assets"
LIST_RESPONSE=$(curl.exe -s -w "\n%{http_code}" -X GET "$BASE_URL/pots/$POT_ID/assets")
LIST_BODY=$(echo "$LIST_RESPONSE" | head -n -1)
LIST_STATUS=$(echo "$LIST_RESPONSE" | tail -n 1)
check_status 200 "$LIST_STATUS" "List pot assets"

ASSET_COUNT=$(echo "$LIST_BODY" | jq '.assets | length')
if [ "$ASSET_COUNT" -eq 2 ]; then
  echo -e "${GREEN}✓${NC} Pot has 2 assets"
else
  echo -e "${RED}✗${NC} Expected 2 assets, got $ASSET_COUNT"
  exit 1
fi

echo ""
echo -e "${GREEN}=== Phase 4 Smoke Test PASSED ===${NC}"
echo "All 9 steps completed successfully!"
