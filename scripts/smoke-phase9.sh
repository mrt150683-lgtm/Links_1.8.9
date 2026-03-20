#!/usr/bin/env bash
# Phase 9 Smoke Test: Export/Import Bundles
# Tests encrypted bundle creation and import with ID remapping

set -e

API_URL="${API_URL:-http://localhost:3000}"
BOLD="\033[1m"
GREEN="\033[0;32m"
RED="\033[0;31m"
RESET="\033[0m"

echo -e "${BOLD}Phase 9 Smoke Test: Export/Import${RESET}\n"

# Check jq
if ! command -v jq &> /dev/null; then
  echo -e "${RED}✗ jq is required${RESET}"
  exit 1
fi

# Step 1: Create source pot
echo "1. Creating source pot..."
POT1=$(curl -s -X POST "$API_URL/pots" \
  -H "Content-Type: application/json" \
  -d '{"name":"Phase 9 Export Test"}' | jq -r '.id')

if [ "$POT1" = "null" ] || [ -z "$POT1" ]; then
  echo -e "${RED}✗ Failed to create pot${RESET}"
  exit 1
fi
echo -e "${GREEN}✓ Created pot: $POT1${RESET}"

# Step 2: Add entries
echo "2. Creating entries..."
ENTRY1=$(curl -s -X POST "$API_URL/pots/$POT1/entries" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"Test content 1\",\"capture_method\":\"test\",\"captured_at\":$(date +%s)000}" | jq -r '.id')

ENTRY2=$(curl -s -X POST "$API_URL/pots/$POT1/entries" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"Test content 2\",\"capture_method\":\"test\",\"captured_at\":$(date +%s)000}" | jq -r '.id')

echo -e "${GREEN}✓ Created 2 entries${RESET}"

# Step 3: Export pot (private mode)
echo "3. Exporting pot (private mode)..."
EXPORT_RESPONSE=$(curl -s -X POST "$API_URL/pots/$POT1/export" \
  -H "Content-Type: application/json" \
  -d '{"mode":"private","passphrase":"test-passphrase-123"}')

BUNDLE_PATH=$(echo "$EXPORT_RESPONSE" | jq -r '.bundle_path')
BUNDLE_SHA256=$(echo "$EXPORT_RESPONSE" | jq -r '.bundle_sha256')

if [ "$BUNDLE_PATH" = "null" ] || [ -z "$BUNDLE_PATH" ]; then
  echo -e "${RED}✗ Failed to export pot${RESET}"
  echo "$EXPORT_RESPONSE"
  exit 1
fi
echo -e "${GREEN}✓ Exported: $BUNDLE_PATH${RESET}"
echo -e "${GREEN}✓ SHA256: ${BUNDLE_SHA256:0:16}...${RESET}"

# Step 4: Verify bundle file exists
echo "4. Verifying bundle file..."
if [ ! -f "$BUNDLE_PATH" ]; then
  echo -e "${RED}✗ Bundle file not found: $BUNDLE_PATH${RESET}"
  exit 1
fi

FILE_SIZE=$(stat -f%z "$BUNDLE_PATH" 2>/dev/null || stat -c%s "$BUNDLE_PATH" 2>/dev/null)
echo -e "${GREEN}✓ Bundle exists (${FILE_SIZE} bytes)${RESET}"

# Step 5: Import bundle
echo "5. Importing bundle..."
IMPORT_RESPONSE=$(curl -s -X POST "$API_URL/pots/import" \
  -H "Content-Type: application/json" \
  -d "{\"bundle_path\":\"$BUNDLE_PATH\",\"passphrase\":\"test-passphrase-123\",\"import_as_name\":\"Phase 9 Imported\"}")

POT2=$(echo "$IMPORT_RESPONSE" | jq -r '.pot_id')
ENTRIES_COUNT=$(echo "$IMPORT_RESPONSE" | jq -r '.stats.entries')

if [ "$POT2" = "null" ] || [ -z "$POT2" ]; then
  echo -e "${RED}✗ Failed to import pot${RESET}"
  echo "$IMPORT_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✓ Imported as pot: $POT2${RESET}"
echo -e "${GREEN}✓ Entries imported: $ENTRIES_COUNT${RESET}"

# Step 6: Verify pot names are different but counts match
echo "6. Verifying pot integrity..."
POT1_ENTRIES=$(curl -s "$API_URL/pots/$POT1/entries" | jq '.entries | length')
POT2_ENTRIES=$(curl -s "$API_URL/pots/$POT2/entries" | jq '.entries | length')

if [ "$POT1_ENTRIES" != "$POT2_ENTRIES" ]; then
  echo -e "${RED}✗ Entry count mismatch: $POT1_ENTRIES vs $POT2_ENTRIES${RESET}"
  exit 1
fi

echo -e "${GREEN}✓ Entry counts match: $POT1_ENTRIES${RESET}"

# Step 7: Test wrong passphrase
echo "7. Testing tamper detection (wrong passphrase)..."
WRONG_PASS=$(curl -s -X POST "$API_URL/pots/import" \
  -H "Content-Type: application/json" \
  -d "{\"bundle_path\":\"$BUNDLE_PATH\",\"passphrase\":\"wrong-password\"}")

ERROR=$(echo "$WRONG_PASS" | jq -r '.error' 2>/dev/null)
if [[ "$ERROR" == *"failed"* ]] || [[ "$ERROR" == *"authentication"* ]]; then
  echo -e "${GREEN}✓ Wrong passphrase rejected${RESET}"
else
  echo -e "${RED}✗ Wrong passphrase not caught${RESET}"
fi

# Step 8: Export public mode
echo "8. Exporting pot (public mode)..."
PUBLIC_EXPORT=$(curl -s -X POST "$API_URL/pots/$POT1/export" \
  -H "Content-Type: application/json" \
  -d '{"mode":"public","passphrase":"test-passphrase-123"}')

PUBLIC_PATH=$(echo "$PUBLIC_EXPORT" | jq -r '.bundle_path')

if [ "$PUBLIC_PATH" = "null" ] || [ -z "$PUBLIC_PATH" ]; then
  echo -e "${RED}✗ Failed to export public bundle${RESET}"
  exit 1
fi

echo -e "${GREEN}✓ Public bundle exported${RESET}"

echo ""
echo -e "${GREEN}${BOLD}✓ Phase 9 Smoke Test PASSED${RESET}"
echo ""
echo "Summary:"
echo "  - Source pot: $POT1 (2 entries)"
echo "  - Private bundle: $BUNDLE_PATH"
echo "  - Imported pot: $POT2"
echo "  - Entries preserved: $POT2_ENTRIES"
echo "  - Public mode: Supported"
