#!/usr/bin/env bash
# Start all Links services (API + Worker)

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$PROJECT_ROOT/.pids"

# Function to check if process is running (Windows-compatible)
is_process_running() {
  local pid=$1
  if ps -p "$pid" >/dev/null 2>&1; then
    return 0
  else
    return 1
  fi
}

mkdir -p "$PID_DIR"

echo "=== Starting Links Services ==="

# Check if already running
if [ -f "$PID_DIR/api.pid" ]; then
  API_PID=$(cat "$PID_DIR/api.pid")
  if is_process_running "$API_PID"; then
    echo "⚠️  API already running (PID: $API_PID)"
  else
    rm "$PID_DIR/api.pid"
  fi
fi

if [ -f "$PID_DIR/worker.pid" ]; then
  WORKER_PID=$(cat "$PID_DIR/worker.pid")
  if is_process_running "$WORKER_PID"; then
    echo "⚠️  Worker already running (PID: $WORKER_PID)"
  else
    rm "$PID_DIR/worker.pid"
  fi
fi

# Start API
if [ ! -f "$PID_DIR/api.pid" ]; then
  echo "Starting API..."
  cd "$PROJECT_ROOT/apps/api"
  pnpm dev > "$PROJECT_ROOT/.pids/api.log" 2>&1 &
  API_PID=$!
  echo $API_PID > "$PID_DIR/api.pid"
  echo "✓ API started (PID: $API_PID)"
  echo "  Log: .pids/api.log"
fi

# Start Worker
if [ ! -f "$PID_DIR/worker.pid" ]; then
  echo "Starting Worker..."
  cd "$PROJECT_ROOT/apps/worker"
  pnpm dev > "$PROJECT_ROOT/.pids/worker.log" 2>&1 &
  WORKER_PID=$!
  echo $WORKER_PID > "$PID_DIR/worker.pid"
  echo "✓ Worker started (PID: $WORKER_PID)"
  echo "  Log: .pids/worker.log"
fi

echo ""
echo "=== Services Running ==="
echo "API:    http://127.0.0.1:3000"
echo "Worker: daemon mode"
echo ""
echo "Use 'bash scripts/status.sh' to check status"
echo "Use 'bash scripts/stop.sh' to stop all services"
