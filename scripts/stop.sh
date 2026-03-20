#!/usr/bin/env bash
# Stop all Links services

echo "=== Stopping Links Services ==="

STOPPED=0

# Find and kill API process (Windows-aware)
API_PID=$(netstat -ano | grep ":3000.*LISTENING" | awk '{print $5}' | head -1)
if [ -n "$API_PID" ]; then
  echo "Stopping API (Windows PID: $API_PID)..."
  taskkill //PID "$API_PID" //F >/dev/null 2>&1 || true
  echo "✓ API stopped"
  STOPPED=$((STOPPED + 1))
else
  echo "⚠️  API not running"
fi

# Find and kill Worker processes (search for node.exe running worker)
# Get all node.exe PIDs and check their command line
WORKER_STOPPED=false
for pid in $(tasklist | grep "node.exe" | awk '{print $2}'); do
  # Check if this node process is running the worker
  CMD=$(wmic process where processid=$pid get commandline 2>/dev/null | grep -i "worker" | grep -v "WMIC")
  if [ -n "$CMD" ]; then
    echo "Stopping Worker (Windows PID: $pid)..."
    taskkill //PID "$pid" //F >/dev/null 2>&1 || true
    WORKER_STOPPED=true
    STOPPED=$((STOPPED + 1))
  fi
done

if [ "$WORKER_STOPPED" = false ]; then
  echo "⚠️  Worker not running"
fi

# Clean up PID files
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$PROJECT_ROOT/.pids"
rm -f "$PID_DIR/api.pid" "$PID_DIR/worker.pid"

if [ $STOPPED -eq 0 ]; then
  echo ""
  echo "No services were running"
else
  echo ""
  echo "Stopped $STOPPED service(s)"
fi
