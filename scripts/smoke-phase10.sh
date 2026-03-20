#!/usr/bin/env bash
#
# Phase 10 Smoke Test: MCP Server Tools
#
# Tests MCP tool catalog and basic operations via MCP SDK.
# Note: This is a simplified smoke test that verifies server startup and tool listing.
# Full MCP integration testing requires an MCP client (Claude Desktop, etc.).
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

log_info() {
  echo -e "${GREEN}✓${NC} $1"
}

log_error() {
  echo -e "${RED}✗${NC} $1"
}

log_step() {
  echo -e "\n${YELLOW}==>${NC} $1"
}

test_pass() {
  ((TESTS_PASSED++))
  log_info "$1"
}

test_fail() {
  ((TESTS_FAILED++))
  log_error "$1"
}

# Cleanup function
cleanup() {
  log_step "Cleaning up test resources"
  if [ -n "${TEST_DB:-}" ]; then
    rm -f "$TEST_DB"
  fi
  if [ -n "${MCP_PID:-}" ]; then
    kill "$MCP_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT

cd "$PROJECT_ROOT"

log_step "Phase 10 Smoke Test: MCP Server"

# Step 1: Build MCP app
log_step "Step 1: Build MCP app"
if pnpm --filter @links/mcp build >/dev/null 2>&1; then
  test_pass "MCP app builds successfully"
else
  test_fail "MCP app build failed"
  exit 1
fi

# Step 2: Verify server.js exists
log_step "Step 2: Verify MCP server executable"
if [ -f "apps/mcp/dist/server.js" ]; then
  test_pass "MCP server executable exists"
else
  test_fail "MCP server executable not found"
  exit 1
fi

# Step 3: Verify tool catalog
log_step "Step 3: Verify tool implementations exist"
REQUIRED_TOOLS=(
  "pots"
  "capture"
  "entries"
  "artifacts"
  "processing"
  "bundles"
)

for tool in "${REQUIRED_TOOLS[@]}"; do
  if [ -f "apps/mcp/dist/tools/${tool}.js" ]; then
    test_pass "Tool module exists: $tool"
  else
    test_fail "Tool module missing: $tool"
  fi
done

# Step 4: Check MCP SDK integration
log_step "Step 4: Verify MCP SDK dependency"
if grep -q "@modelcontextprotocol/sdk" "apps/mcp/package.json"; then
  test_pass "MCP SDK dependency declared"
else
  test_fail "MCP SDK dependency missing"
fi

# Step 5: Verify error handling modules
log_step "Step 5: Verify error handling and auth modules"
if [ -f "apps/mcp/dist/schemas/errors.js" ]; then
  test_pass "Error schemas module exists"
else
  test_fail "Error schemas module missing"
fi

if [ -f "apps/mcp/dist/auth/token.js" ]; then
  test_pass "Token auth module exists"
else
  test_fail "Token auth module missing"
fi

# Step 6: Test basic server startup (if Node.js can load the module)
log_step "Step 6: Test server module loading"
TEST_DB="$(mktemp -u).db"
export DATABASE_PATH="$TEST_DB"
export NODE_ENV="test"

# Try to load the server module (it will fail to start without stdio, but we can check syntax)
if node -c "apps/mcp/dist/server.js" 2>/dev/null; then
  test_pass "Server module syntax valid"
else
  test_fail "Server module has syntax errors"
fi

# Step 7: Verify tool count
log_step "Step 7: Verify all 14 tools are registered"
EXPECTED_TOOL_COUNT=14
# Count tool definitions in source (LIST_*_TOOL, CREATE_*_TOOL, etc.)
TOOL_COUNT=$(grep -r "export const.*_TOOL: Tool" apps/mcp/src/tools/ 2>/dev/null | wc -l)

if [ "$TOOL_COUNT" -ge "$EXPECTED_TOOL_COUNT" ]; then
  test_pass "Expected tool count: $TOOL_COUNT >= $EXPECTED_TOOL_COUNT"
else
  test_fail "Tool count mismatch: $TOOL_COUNT < $EXPECTED_TOOL_COUNT"
fi

# Step 8: Summary
log_step "Test Summary"
echo "  Passed: $TESTS_PASSED"
echo "  Failed: $TESTS_FAILED"

if [ "$TESTS_FAILED" -eq 0 ]; then
  echo -e "\n${GREEN}✓ All smoke tests passed!${NC}"
  echo "Note: Full MCP integration testing requires an MCP client (Claude Desktop, etc.)"
  exit 0
else
  echo -e "\n${RED}✗ Some tests failed!${NC}"
  exit 1
fi
