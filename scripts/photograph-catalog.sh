#!/usr/bin/env bash
# Build the frontend and photograph /dev/catalog into the directory given as $1.
# Used by .github/workflows/visual-catalog.yml, once per side of a PR. The
# catalog needs no backend, so the built bundle is served by `vite preview`.
set -euo pipefail
out="$1"
(cd frontend && rm -rf dist && npx vite build)
(cd frontend && nohup npx vite preview --port 4173 --strictPort > ../preview.log 2>&1 &)
for _ in $(seq 1 30); do
  curl -sf http://localhost:4173/dev/catalog > /dev/null && break
  sleep 1
done
curl -sf http://localhost:4173/dev/catalog > /dev/null || { cat preview.log; exit 1; }
status=0
node scripts/catalog-shots.mjs --base http://localhost:4173 --browser chrome --out "$out" || status=$?
pkill -f 'vite preview' || true
exit "$status"
