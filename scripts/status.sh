#!/usr/bin/env bash
# Check status of Links services

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$PROJECT_ROOT/.pids"

echo "=== Links Services Status ==="
echo ""

RUNNING=0

# Check API (by testing if port 3000 responds)
if curl -s http://127.0.0.1:3000/health >/dev/null 2>&1; then
  echo "✓ API:    RUNNING"
  echo "  URL:    http://127.0.0.1:3000"
  echo "  Log:    .pids/api.log"
  RUNNING=$((RUNNING + 1))
else
  echo "✗ API:    STOPPED"
fi

echo ""

# Check Worker (by checking if log file has recent activity in last 30 seconds)
if [ -f "$PID_DIR/worker.log" ]; then
  # Check if file has been modified in the last 30 seconds
  if [ "$(find "$PID_DIR/worker.log" -mmin -0.5 2>/dev/null)" ]; then
    echo "✓ Worker: RUNNING (log active)"
    echo "  Log:    .pids/worker.log"
    RUNNING=$((RUNNING + 1))
  else
    # Fallback: check if there's a worker process in the process list
    if ps aux | grep -E "tsx.*worker|node.*worker" | grep -v grep >/dev/null 2>&1; then
      echo "✓ Worker: RUNNING (process found)"
      echo "  Log:    .pids/worker.log"
      RUNNING=$((RUNNING + 1))
    else
      echo "✗ Worker: STOPPED"
    fi
  fi
else
  echo "✗ Worker: STOPPED (no log file)"
fi

echo ""
echo "---"
if [ $RUNNING -eq 2 ]; then
  echo "All services running"
elif [ $RUNNING -eq 0 ]; then
  echo "No services running"
  echo "Run 'bash scripts/start.sh' to start services"
else
  echo "$RUNNING of 2 services running"
  echo "Run 'bash scripts/start.sh' to start missing services"
fi
