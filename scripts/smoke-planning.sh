#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://127.0.0.1:3000}"

POT_ID=$(curl -s -X POST "$API_URL/pots" -H 'content-type: application/json' -d '{"name":"Planning Smoke Pot"}' | python -c "import sys,json;print(json.load(sys.stdin)['id'])")
RUN_ID=$(curl -s -X POST "$API_URL/planning/runs" -H 'content-type: application/json' -d "{\"pot_id\":\"$POT_ID\",\"project_name\":\"Smoke Project\",\"project_type\":\"software\"}" | python -c "import sys,json;print(json.load(sys.stdin)['run']['id'])")

curl -s -X POST "$API_URL/planning/runs/$RUN_ID/questions:generate" -H 'content-type: application/json' -d '{}' > /dev/null
curl -s -X POST "$API_URL/planning/runs/$RUN_ID/plan:generate" -H 'content-type: application/json' -d '{}' > /dev/null

echo "Planning smoke queued for run: $RUN_ID"
