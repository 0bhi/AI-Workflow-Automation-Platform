#!/usr/bin/env bash
# Start all services for the AI Workflow Automation Platform
# Usage: ./start-all.sh

set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PIDS=()
cleanup() {
  echo ""
  echo "Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "==> Starting infra (Postgres + Redis + Qdrant)..."
(cd infra && docker compose up -d)
echo "    Waiting for Postgres to be ready..."
for i in {1..30}; do
  if (echo >/dev/tcp/localhost/5432) 2>/dev/null; then
    break
  fi
  sleep 1
done
sleep 1

echo "==> Applying database schema..."
(cd backend-node && npm run db:schema) || true

echo "==> Starting backend-node (API)..."
(cd backend-node && npm run dev) &
PIDS+=($!)

echo "==> Starting backend-node worker..."
(cd backend-node && npm run dev:worker) &
PIDS+=($!)

echo "==> Starting backend-node scheduler..."
(cd backend-node && npm run dev:scheduler) &
PIDS+=($!)

echo "==> Starting agent-python..."
(cd agent-python && uvicorn app.main:app --host 0.0.0.0 --port 5000 --reload) &
PIDS+=($!)

echo "==> Starting frontend..."
(cd frontend && npm run dev) &
PIDS+=($!)

echo ""
echo "All services started. Press Ctrl+C to stop everything."
echo "  - Frontend:    http://localhost:3000"
echo "  - Backend API: http://localhost:4000"
echo "  - Agent API:   http://localhost:5000"
echo "  - Postgres:    localhost:5432"
echo "  - Redis:       localhost:6379"
echo "  - Qdrant:      localhost:6333"
echo "  - Metrics:     http://localhost:4000/metrics"
echo ""

wait
