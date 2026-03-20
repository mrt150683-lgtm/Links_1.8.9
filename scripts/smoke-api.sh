#!/usr/bin/env bash

set -e

echo "🔍 Running API smoke test..."

# Configuration
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3000}"
URL="http://${HOST}:${PORT}/health"

# Wait for API to be ready (if starting it)
echo "Checking $URL"

# Make request
RESPONSE=$(curl -s -w "\n%{http_code}" "$URL")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

# Check HTTP status
if [ "$HTTP_CODE" != "200" ]; then
  echo "❌ Failed: Expected HTTP 200, got $HTTP_CODE"
  exit 1
fi

# Check JSON structure
echo "$BODY" | jq -e '.ok == true' > /dev/null || {
  echo "❌ Failed: Missing or invalid 'ok' field"
  exit 1
}

echo "$BODY" | jq -e '.service == "api"' > /dev/null || {
  echo "❌ Failed: Missing or invalid 'service' field"
  exit 1
}

echo "$BODY" | jq -e '.version' > /dev/null || {
  echo "❌ Failed: Missing 'version' field"
  exit 1
}

echo "$BODY" | jq -e '.time' > /dev/null || {
  echo "❌ Failed: Missing 'time' field"
  exit 1
}

echo "✅ Smoke test passed"
echo "Response: $BODY"
