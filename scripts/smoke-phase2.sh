#!/usr/bin/env bash

set -e

echo "🔍 Running Phase 2 smoke test..."

# Configuration
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3000}"
BASE_URL="http://${HOST}:${PORT}"

# Helper function to check JSON response
check_json() {
  local response=$1
  local field=$2
  local expected=$3

  if command -v jq &> /dev/null; then
    echo "$response" | jq -e ".${field}" > /dev/null || {
      echo "❌ Failed: Missing field '${field}'"
      exit 1
    }

    if [ -n "$expected" ]; then
      local actual=$(echo "$response" | jq -r ".${field}")
      if [ "$actual" != "$expected" ]; then
        echo "❌ Failed: Expected ${field}='${expected}', got '${actual}'"
        exit 1
      fi
    fi
  fi
}

echo ""
echo "Step 1: Creating a pot..."
POT_RESPONSE=$(curl -s -X POST "${BASE_URL}/pots" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke Test Pot","description":"Testing Phase 2"}')

check_json "$POT_RESPONSE" "id"
check_json "$POT_RESPONSE" "name" "Smoke Test Pot"

POT_ID=$(echo "$POT_RESPONSE" | jq -r '.id')
echo "✓ Created pot: $POT_ID"

echo ""
echo "Step 2: Creating a text entry..."
ENTRY_RESPONSE=$(curl -s -X POST "${BASE_URL}/pots/${POT_ID}/entries/text" \
  -H "Content-Type: application/json" \
  -d '{"text":"This is a smoke test entry","capture_method":"test","source_url":"https://example.com"}')

check_json "$ENTRY_RESPONSE" "id"
check_json "$ENTRY_RESPONSE" "content_text" "This is a smoke test entry"
check_json "$ENTRY_RESPONSE" "content_sha256"

ENTRY_ID=$(echo "$ENTRY_RESPONSE" | jq -r '.id')
echo "✓ Created entry: $ENTRY_ID"

echo ""
echo "Step 3: Listing pots..."
POTS_RESPONSE=$(curl -s "${BASE_URL}/pots")

check_json "$POTS_RESPONSE" "pots"
check_json "$POTS_RESPONSE" "total"
echo "✓ Listed pots successfully"

echo ""
echo "Step 4: Listing entries for pot..."
ENTRIES_RESPONSE=$(curl -s "${BASE_URL}/pots/${POT_ID}/entries")

check_json "$ENTRIES_RESPONSE" "entries"
check_json "$ENTRIES_RESPONSE" "total"
check_json "$ENTRIES_RESPONSE" "pot_id" "$POT_ID"
echo "✓ Listed entries successfully"

echo ""
echo "Step 5: Getting single entry..."
GET_ENTRY_RESPONSE=$(curl -s "${BASE_URL}/entries/${ENTRY_ID}")

check_json "$GET_ENTRY_RESPONSE" "id" "$ENTRY_ID"
echo "✓ Retrieved entry successfully"

echo ""
echo "Step 6: Getting single pot..."
GET_POT_RESPONSE=$(curl -s "${BASE_URL}/pots/${POT_ID}")

check_json "$GET_POT_RESPONSE" "id" "$POT_ID"
echo "✓ Retrieved pot successfully"

echo ""
echo "✅ All Phase 2 smoke tests passed!"
echo ""
echo "Summary:"
echo "  Pot ID: $POT_ID"
echo "  Entry ID: $ENTRY_ID"
