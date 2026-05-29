#!/usr/bin/env bash
# Use in Codespaces when `git pull` fails because an untracked pnpm-lock.yaml
# would be overwritten by the version on main.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f pnpm-lock.yaml ]] && ! git ls-files --error-unmatch pnpm-lock.yaml >/dev/null 2>&1; then
  echo "Removing untracked pnpm-lock.yaml (will restore from origin after pull)..."
  rm -f pnpm-lock.yaml
fi

git pull "$@"
echo "Installing dependencies from lockfile..."
pnpm install

echo "Done. Run: pnpm typecheck && pnpm dev:web"
