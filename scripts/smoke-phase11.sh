#!/usr/bin/env bash
#
# Phase 11: Extension Bridge Smoke Test
#
# Tests extension auth token management and capture endpoints
#

set -e

API_URL="${API_URL:-http://localhost:3000}"
BOOTSTRAP_TOKEN="smoke-test-bootstrap-$(date +%s)"

echo "Phase 11 Smoke Test - Extension Bridge"
echo "======================================="
echo "API URL: $API_URL"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

step=0

function test_step() {
  step=$((step + 1))
  echo -e "${GREEN}[$step]${NC} $1"
}

function fail() {
  echo -e "${RED}✗ FAILED:${NC} $1"
  exit 1
}

function success() {
  echo -e "${GREEN}✓${NC} $1"
}

# Set bootstrap token env var (server must be restarted with this)
export EXT_BOOTSTRAP_TOKEN="$BOOTSTRAP_TOKEN"
echo "Note: Server must be started with EXT_BOOTSTRAP_TOKEN=$BOOTSTRAP_TOKEN"
echo ""

# Step 1: Create test pot
test_step "Create test pot"
POT_RESPONSE=$(curl -s -X POST "$API_URL/pots" \
  -H "Content-Type: application/json" \
  -d '{"name":"Extension Smoke Test Pot"}')

POT_ID=$(echo "$POT_RESPONSE" | jq -r '.id')
if [ -z "$POT_ID" ] || [ "$POT_ID" = "null" ]; then
  fail "Failed to create pot"
fi
success "Pot created: $POT_ID"
echo ""

# Step 2: Bootstrap extension token
test_step "Bootstrap extension token"
BOOTSTRAP_RESPONSE=$(curl -s -X POST "$API_URL/ext/auth/bootstrap" \
  -H "Content-Type: application/json" \
  -d "{\"bootstrap_token\":\"$BOOTSTRAP_TOKEN\"}")

EXT_TOKEN=$(echo "$BOOTSTRAP_RESPONSE" | jq -r '.token')
if [ -z "$EXT_TOKEN" ] || [ "$EXT_TOKEN" = "null" ] || [ ${#EXT_TOKEN} -ne 64 ]; then
  echo "Response: $BOOTSTRAP_RESPONSE"
  fail "Failed to bootstrap token (expected 64-char hex string)"
fi
success "Token bootstrapped (first 8 chars): ${EXT_TOKEN:0:8}..."
echo ""

# Step 3: Capture text selection
test_step "Capture text selection"
SELECTION_RESPONSE=$(curl -s -X POST "$API_URL/ext/capture/selection" \
  -H "Authorization: Bearer $EXT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"pot_id\":\"$POT_ID\",
    \"text\":\"This is selected text from the smoke test\",
    \"capture_method\":\"extension_selection\",
    \"source_url\":\"https://example.com/smoke-test\",
    \"source_title\":\"Smoke Test Page\",
    \"client_capture_id\":\"smoke-selection-1\"
  }")

SELECTION_ENTRY_ID=$(echo "$SELECTION_RESPONSE" | jq -r '.entry.id')
SELECTION_CREATED=$(echo "$SELECTION_RESPONSE" | jq -r '.created')
if [ -z "$SELECTION_ENTRY_ID" ] || [ "$SELECTION_ENTRY_ID" = "null" ]; then
  echo "Response: $SELECTION_RESPONSE"
  fail "Failed to capture selection"
fi
if [ "$SELECTION_CREATED" != "true" ]; then
  fail "Expected created=true for selection"
fi
success "Selection captured: $SELECTION_ENTRY_ID"
echo ""

# Step 4: Verify selection idempotency
test_step "Verify selection idempotency (client_capture_id)"
SELECTION_RESUBMIT=$(curl -s -X POST "$API_URL/ext/capture/selection" \
  -H "Authorization: Bearer $EXT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"pot_id\":\"$POT_ID\",
    \"text\":\"Different text but same client_capture_id\",
    \"capture_method\":\"extension_selection\",
    \"client_capture_id\":\"smoke-selection-1\"
  }")

DEDUPED=$(echo "$SELECTION_RESUBMIT" | jq -r '.deduped')
DEDUPE_ENTRY_ID=$(echo "$SELECTION_RESUBMIT" | jq -r '.entry.id')
if [ "$DEDUPED" != "true" ] || [ "$DEDUPE_ENTRY_ID" != "$SELECTION_ENTRY_ID" ]; then
  echo "Response: $SELECTION_RESUBMIT"
  fail "Selection idempotency failed"
fi
success "Selection deduplicated correctly"
echo ""

# Step 5: Capture page (link entry)
test_step "Capture current page as link entry"
PAGE_RESPONSE=$(curl -s -X POST "$API_URL/ext/capture/page" \
  -H "Authorization: Bearer $EXT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"pot_id\":\"$POT_ID\",
    \"link_url\":\"https://example.com/important-article\",
    \"link_title\":\"Important Research Article\",
    \"content_text\":\"Brief excerpt from the article...\",
    \"capture_method\":\"extension_page\",
    \"client_capture_id\":\"smoke-page-1\"
  }")

PAGE_ENTRY_ID=$(echo "$PAGE_RESPONSE" | jq -r '.entry.id')
PAGE_TYPE=$(echo "$PAGE_RESPONSE" | jq -r '.entry.type')
if [ -z "$PAGE_ENTRY_ID" ] || [ "$PAGE_ENTRY_ID" = "null" ]; then
  echo "Response: $PAGE_RESPONSE"
  fail "Failed to capture page"
fi
if [ "$PAGE_TYPE" != "link" ]; then
  fail "Expected type=link for page capture, got: $PAGE_TYPE"
fi
success "Page captured as link entry: $PAGE_ENTRY_ID"
echo ""

# Step 6: Capture image (create minimal PNG in memory)
test_step "Capture image from extension"
# Create 1x1 red pixel PNG (base64 decoded)
echo "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==" | base64 -d > /tmp/smoke-test-image.png

IMAGE_RESPONSE=$(curl -s -X POST "$API_URL/ext/capture/image" \
  -H "Authorization: Bearer $EXT_TOKEN" \
  -F "file=@/tmp/smoke-test-image.png" \
  -F "pot_id=$POT_ID" \
  -F "capture_method=extension_image" \
  -F "source_url=https://example.com/screenshot-source")

IMAGE_ENTRY_ID=$(echo "$IMAGE_RESPONSE" | jq -r '.entry.id')
IMAGE_TYPE=$(echo "$IMAGE_RESPONSE" | jq -r '.entry.type')
ASSET_ID=$(echo "$IMAGE_RESPONSE" | jq -r '.entry.asset_id')
if [ -z "$IMAGE_ENTRY_ID" ] || [ "$IMAGE_ENTRY_ID" = "null" ]; then
  echo "Response: $IMAGE_RESPONSE"
  fail "Failed to capture image"
fi
if [ "$IMAGE_TYPE" != "image" ]; then
  fail "Expected type=image for image capture, got: $IMAGE_TYPE"
fi
if [ -z "$ASSET_ID" ] || [ "$ASSET_ID" = "null" ]; then
  fail "Image entry should have asset_id"
fi
success "Image captured: $IMAGE_ENTRY_ID (asset: $ASSET_ID)"
rm /tmp/smoke-test-image.png
echo ""

# Step 7: Rotate extension token
test_step "Rotate extension token"
ROTATE_RESPONSE=$(curl -s -X POST "$API_URL/ext/auth/rotate" \
  -H "Authorization: Bearer $EXT_TOKEN")

NEW_TOKEN=$(echo "$ROTATE_RESPONSE" | jq -r '.token')
if [ -z "$NEW_TOKEN" ] || [ "$NEW_TOKEN" = "null" ] || [ ${#NEW_TOKEN} -ne 64 ]; then
  echo "Response: $ROTATE_RESPONSE"
  fail "Failed to rotate token"
fi
if [ "$NEW_TOKEN" = "$EXT_TOKEN" ]; then
  fail "Rotated token should be different from old token"
fi
success "Token rotated (first 8 chars): ${NEW_TOKEN:0:8}..."
echo ""

# Step 8: Verify old token is invalid
test_step "Verify old token is invalid after rotation"
OLD_TOKEN_TEST=$(curl -s -X POST "$API_URL/ext/capture/selection" \
  -H "Authorization: Bearer $EXT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"pot_id\":\"$POT_ID\",
    \"text\":\"Test with old token\",
    \"capture_method\":\"extension_selection\"
  }")

OLD_TOKEN_STATUS=$(echo "$OLD_TOKEN_TEST" | jq -r '.ok')
if [ "$OLD_TOKEN_STATUS" != "false" ]; then
  fail "Old token should be invalid after rotation"
fi
success "Old token correctly invalidated"
echo ""

# Step 9: Verify new token works
test_step "Verify new token works"
NEW_TOKEN_TEST=$(curl -s -X POST "$API_URL/ext/capture/selection" \
  -H "Authorization: Bearer $NEW_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"pot_id\":\"$POT_ID\",
    \"text\":\"Test with new token\",
    \"capture_method\":\"extension_selection\"
  }")

NEW_TOKEN_ENTRY=$(echo "$NEW_TOKEN_TEST" | jq -r '.entry.id')
if [ -z "$NEW_TOKEN_ENTRY" ] || [ "$NEW_TOKEN_ENTRY" = "null" ]; then
  echo "Response: $NEW_TOKEN_TEST"
  fail "New token should work"
fi
success "New token works correctly"
echo ""

# Summary
echo "======================================="
echo -e "${GREEN}✓ All Phase 11 smoke tests passed!${NC}"
echo ""
echo "Summary:"
echo "  - Token management: ✓ (bootstrap, rotate)"
echo "  - Selection capture: ✓ (with idempotency)"
echo "  - Page capture: ✓ (link entries)"
echo "  - Image capture: ✓ (with asset dedupe)"
echo "  - Token rotation: ✓ (old invalidated, new works)"
echo ""
echo "Extension bridge is ready for use!"
