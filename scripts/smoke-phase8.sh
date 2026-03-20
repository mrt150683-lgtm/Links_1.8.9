#!/usr/bin/env bash
# Phase 8 Smoke Test: Link Discovery
# Tests candidate generation and link queries

set -e

API_URL="${API_URL:-http://localhost:3000}"
BOLD="\033[1m"
GREEN="\033[0;32m"
RED="\033[0;31m"
RESET="\033[0m"

echo -e "${BOLD}Phase 8 Smoke Test: Link Discovery${RESET}\n"

# Check if jq is available
if ! command -v jq &> /dev/null; then
  echo -e "${RED}✗ jq is required but not installed${RESET}"
  echo "Install: brew install jq (macOS) or apt-get install jq (Linux)"
  exit 1
fi

# Step 1: Create pot
echo "1. Creating pot..."
POT_RESPONSE=$(curl -s -X POST "$API_URL/pots" \
  -H "Content-Type: application/json" \
  -d '{"name":"Phase 8 Smoke Test","description":"Testing link discovery"}')

POT_ID=$(echo "$POT_RESPONSE" | jq -r '.id')
if [ "$POT_ID" = "null" ] || [ -z "$POT_ID" ]; then
  echo -e "${RED}✗ Failed to create pot${RESET}"
  echo "$POT_RESPONSE"
  exit 1
fi
echo -e "${GREEN}✓ Created pot: $POT_ID${RESET}"

# Step 2: Create entry 1 with specific content
echo "2. Creating entry 1 (about AI research)..."
ENTRY1_RESPONSE=$(curl -s -X POST "$API_URL/pots/$POT_ID/entries" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Dr. Jane Smith published research on neural networks at Stanford. The machine learning study examined transformer architectures.",
    "capture_method": "smoke_test",
    "captured_at": '$(date +%s000)'
  }')

ENTRY1_ID=$(echo "$ENTRY1_RESPONSE" | jq -r '.id')
if [ "$ENTRY1_ID" = "null" ] || [ -z "$ENTRY1_ID" ]; then
  echo -e "${RED}✗ Failed to create entry 1${RESET}"
  exit 1
fi
echo -e "${GREEN}✓ Created entry 1: $ENTRY1_ID${RESET}"

# Step 3: Create entry 2 with overlapping content
echo "3. Creating entry 2 (related to entry 1)..."
ENTRY2_RESPONSE=$(curl -s -X POST "$API_URL/pots/$POT_ID/entries" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Jane Smith team at Stanford developed new machine learning techniques. Neural network training showed significant improvements.",
    "capture_method": "smoke_test",
    "captured_at": '$(date +%s000)'
  }')

ENTRY2_ID=$(echo "$ENTRY2_RESPONSE" | jq -r '.id')
if [ "$ENTRY2_ID" = "null" ] || [ -z "$ENTRY2_ID" ]; then
  echo -e "${RED}✗ Failed to create entry 2${RESET}"
  exit 1
fi
echo -e "${GREEN}✓ Created entry 2: $ENTRY2_ID${RESET}"

# Step 4: Create entry 3 on different topic
echo "4. Creating entry 3 (unrelated topic)..."
ENTRY3_RESPONSE=$(curl -s -X POST "$API_URL/pots/$POT_ID/entries" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Climate scientists reported accelerating ice melt in Antarctica. Ocean temperatures reached record highs.",
    "capture_method": "smoke_test",
    "captured_at": '$(date +%s000)'
  }')

ENTRY3_ID=$(echo "$ENTRY3_RESPONSE" | jq -r '.id')
if [ "$ENTRY3_ID" = "null" ] || [ -z "$ENTRY3_ID" ]; then
  echo -e "${RED}✗ Failed to create entry 3${RESET}"
  exit 1
fi
echo -e "${GREEN}✓ Created entry 3: $ENTRY3_ID${RESET}"

# Step 5: Trigger link discovery for entry 1
echo "5. Triggering link discovery for entry 1..."
DISCOVERY_RESPONSE=$(curl -s -X POST "$API_URL/entries/$ENTRY1_ID/link-discovery" \
  -H "Content-Type: application/json" \
  -d '{"max_candidates":30,"force":true}')

JOB_ID=$(echo "$DISCOVERY_RESPONSE" | jq -r '.job_id')
if [ "$JOB_ID" = "null" ] || [ -z "$JOB_ID" ]; then
  echo -e "${RED}✗ Failed to trigger link discovery${RESET}"
  echo "$DISCOVERY_RESPONSE"
  exit 1
fi
echo -e "${GREEN}✓ Link discovery job enqueued: $JOB_ID${RESET}"

# Step 6: Wait briefly for processing (in real scenario, worker would process)
echo "6. Waiting for candidate generation..."
sleep 2
echo -e "${GREEN}✓ Wait complete${RESET}"

# Step 7: Query links for entry 1
echo "7. Querying links for entry 1..."
LINKS_RESPONSE=$(curl -s "$API_URL/entries/$ENTRY1_ID/links?min_confidence=0")
LINKS_COUNT=$(echo "$LINKS_RESPONSE" | jq '.links | length')
echo -e "${GREEN}✓ Found $LINKS_COUNT links for entry 1${RESET}"

# Step 8: Query links for pot
echo "8. Querying all links in pot..."
POT_LINKS_RESPONSE=$(curl -s "$API_URL/pots/$POT_ID/links?min_confidence=0")
POT_LINKS_COUNT=$(echo "$POT_LINKS_RESPONSE" | jq '.total_count')
echo -e "${GREEN}✓ Total links in pot: $POT_LINKS_COUNT${RESET}"

# Step 9: Count links for entry
echo "9. Counting links for entry 1..."
COUNT_RESPONSE=$(curl -s "$API_URL/entries/$ENTRY1_ID/links/count?min_confidence=0")
COUNT=$(echo "$COUNT_RESPONSE" | jq '.count')
echo -e "${GREEN}✓ Link count: $COUNT${RESET}"

# Step 10: Verify response structure
echo "10. Verifying response structure..."
if echo "$LINKS_RESPONSE" | jq -e '.entry_id' > /dev/null && \
   echo "$LINKS_RESPONSE" | jq -e '.links' > /dev/null; then
  echo -e "${GREEN}✓ Response structure valid${RESET}"
else
  echo -e "${RED}✗ Invalid response structure${RESET}"
  exit 1
fi

echo ""
echo -e "${GREEN}${BOLD}✓ Phase 8 Smoke Test PASSED${RESET}"
echo ""
echo "Summary:"
echo "  - Pot created: $POT_ID"
echo "  - Entries created: 3"
echo "  - Link discovery job: $JOB_ID"
echo "  - Links found: $LINKS_COUNT"
echo ""
echo "Note: If links count is 0, worker may not have processed yet."
echo "Run worker with: pnpm worker --once"
