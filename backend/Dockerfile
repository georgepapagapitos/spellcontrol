# syntax=docker/dockerfile:1.7
#
# Build context is the REPO ROOT (see .github/workflows/docker-publish.yml
# `context: .` and `file: ./backend/Dockerfile`). The image mirrors the repo
# layout — /app/backend + /app/packages/game-core — so the backend's
# `file:../packages/game-core` dependency resolves to the same relative path
# inside the image as it does in the working tree.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Shared packages first: install (no scripts), then build each dist. Kept as
# their own layers so a backend-only src change doesn't rebuild them. Both
# apps depend on both packages via `file:` deps, so both dists must exist
# before any `npm ci` below.
COPY packages/game-core/package.json packages/game-core/package-lock.json packages/game-core/tsconfig*.json ./packages/game-core/
RUN npm --prefix packages/game-core ci --ignore-scripts
COPY packages/game-core/src ./packages/game-core/src
RUN npm --prefix packages/game-core run build

COPY packages/binder-routing/package.json packages/binder-routing/package-lock.json packages/binder-routing/tsconfig*.json ./packages/binder-routing/
RUN npm --prefix packages/binder-routing ci --ignore-scripts
COPY packages/binder-routing/src ./packages/binder-routing/src
RUN npm --prefix packages/binder-routing run build

# Backend deps (resolves file:../packages/{game-core,binder-routing} — dirs
# present + built, so their dist-guarded `prepare` is a no-op), then compile.
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci
COPY backend/tsconfig.json ./backend/
COPY backend/src ./backend/src
RUN npm --prefix backend run build

# Web frontend. Built here and served by Express from the runtime image so the
# browser sees a single origin (spellcontrol.com) — the bundle calls relative
# /api/* paths against its own origin, so the SameSite=lax session cookie
# needs no CORS / SameSite=None rework. VITE_API_BASE_URL is intentionally
# UNSET: an empty base makes apiUrl() a no-op. (The native APK is built
# separately WITH VITE_API_BASE_URL set — see docs/native_handoff.md.)
# frontend's file:../packages/game-core resolves to the dist built above.
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci
COPY frontend/ ./frontend/
RUN npm --prefix frontend run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    DB_PATH=/data/scryfall-cache.db \
    PORT=3737

# Shared packages: ship package.json + prebuilt dist only (no sources/devDeps).
# Copied BEFORE the backend install so the dist-guarded `prepare` stays a
# no-op when npm links the file: dependencies.
COPY packages/game-core/package.json ./packages/game-core/
COPY --from=build /app/packages/game-core/dist ./packages/game-core/dist
COPY packages/binder-routing/package.json ./packages/binder-routing/
COPY --from=build /app/packages/binder-routing/dist ./packages/binder-routing/dist

# Prod-only backend deps (better-sqlite3's native install script still runs;
# game-core is linked from the path above).
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci --omit=dev && npm cache clean --force
COPY --from=build /app/backend/dist ./backend/dist

# Scanner matcher data (pHash DB + MobileCLIP embeddings + ONNX model).
# Loaded by backend/src/scanner/matcher.ts at boot to serve
# `POST /api/scanner/match`. Refreshed nightly by
# .github/workflows/scanner-ingest.yml — the workflow runs the ingest
# scripts and opens a PR with the regenerated artifacts.
COPY backend/data/scanner ./backend/data/scanner

# Static web bundle, served by Express at runtime (server.ts: SPA_DIR).
COPY --from=build /app/frontend/dist ./backend/public

RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3737
CMD ["node", "backend/dist/server.js"]
