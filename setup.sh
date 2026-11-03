#!/usr/bin/env bash
# CareerFlow SG — one-time setup (macOS / Linux). Windows: see README.md.
# Safe to run again; it only adds what's missing.
set -e
cd "$(dirname "$0")"

say()  { printf "\n\033[1;36m%s\033[0m\n" "$1"; }
fail() { printf "\n\033[1;31m✗ %s\033[0m\n" "$1"; exit 1; }

say "1/6  Checking Python (3.10 or newer) and Node.js (20 or newer)"
PYTHON=""
for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" >/dev/null 2>&1 &&
     "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    PYTHON="$candidate"; break
  fi
done
[ -n "$PYTHON" ] || fail "Python 3.10+ not found. Install it from https://www.python.org/downloads/ (macOS: brew install python@3.12)"
command -v node >/dev/null 2>&1 || fail "Node.js not found. Install the LTS version from https://nodejs.org"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js $NODE_MAJOR is too old; install version 20 or newer from https://nodejs.org"
echo "  Python: $($PYTHON --version)   Node.js: $(node --version)"

say "2/6  Installing the backend (Python packages)"
[ -d backend/.venv ] || "$PYTHON" -m venv backend/.venv
backend/.venv/bin/pip install --quiet --upgrade pip
backend/.venv/bin/pip install --quiet -r backend/requirements.txt

say "3/6  Installing the browser used for PDFs and job portals (Chromium, ~150 MB)"
backend/.venv/bin/playwright install chromium

say "4/6  Downloading SkillsFuture's Skills Framework (for skill gaps, ~13 MB)"
if [ -f backend/data/skills_framework.json.gz ]; then
  echo "  Already downloaded."
else
  (cd backend && .venv/bin/python data/build_skills_framework.py --download) ||
    echo "  ⚠ Couldn't download it now. Skill gaps will ask you to run: cd backend && .venv/bin/python data/build_skills_framework.py --download"
fi

say "5/6  Installing the frontend (Node packages)"
npm install --no-audit --no-fund

say "6/6  Creating your settings file"
if [ -f backend/.env ]; then
  echo "  backend/.env already exists; leaving it alone."
else
  cp backend/.env.example backend/.env
  echo "  Created backend/.env"
fi

printf "\n\033[1;32m✓ Setup complete.\033[0m\n\n"
echo "Next:"
echo "  1. Open backend/.env and paste your AI key after MODEL_API_KEY="
echo "     (free Groq key: https://console.groq.com/keys — or pick another provider in that file)"
echo "  2. Start the app:   ./start.sh"
echo "  3. Open http://localhost:3000 and sign in with the invite code in backend/.env (default: bertbrainco)"
echo ""
