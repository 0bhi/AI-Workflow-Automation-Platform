#!/usr/bin/env bash
# One-time local install for the AI Workflow Automation Platform
# Usage: ./setup.sh

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "==> Installing backend-node dependencies..."
(cd backend-node && npm install)

echo "==> Installing frontend dependencies..."
(cd frontend && npm install)

echo "==> Setting up agent-python virtualenv..."
PYTHON="${PYTHON:-python3}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "error: $PYTHON not found. Install Python 3.11+ and retry." >&2
  exit 1
fi

if [[ ! -d agent-python/.venv ]]; then
  "$PYTHON" -m venv agent-python/.venv
fi

agent-python/.venv/bin/python -m pip install --upgrade pip
agent-python/.venv/bin/python -m pip install -r agent-python/requirements.txt

echo ""
echo "Setup complete. Next: ./start-all.sh"
