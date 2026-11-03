#!/usr/bin/env bash
# CareerFlow SG — start the backend and frontend together (macOS / Linux).
# Press Ctrl+C once to stop both.
set -e
cd "$(dirname "$0")"

[ -x backend/.venv/bin/uvicorn ] || { echo "Run ./setup.sh first."; exit 1; }
[ -f backend/.env ] || { echo "backend/.env is missing. Run ./setup.sh, then add your AI key to backend/.env."; exit 1; }

cleanup() { kill "$BACKEND_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "Starting the backend on http://localhost:8000 ..."
(cd backend && exec .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000) &
BACKEND_PID=$!

echo "Starting the frontend on http://localhost:3000 ..."
echo "When you see 'Ready', open http://localhost:3000 in your browser."
npm --prefix frontend run dev
