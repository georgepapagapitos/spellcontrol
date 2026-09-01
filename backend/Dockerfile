# syntax=docker/dockerfile:1.7
#
# Build context is the REPO ROOT (see .github/workflows/docker-image-build.yml
# `context: .` and `file: ./backend/Dockerfile`). The image mirrors the repo
# layout — /app/backend + /app/packages/game-core — so the backend's
# `file:../packages/game-core` dependency resolves to the same relative path
# inside the image as it does in the working tree.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# node-gyp's toolchain, needed by `npm ci` alone — see the runtime stage below
# for the full explanation. Placed before any COPY so dependency churn doesn't
# invalidate this layer. No purge: this stage is discarded.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make \
  && rm -rf /var/lib/apt/lists/*

# Shared packages first: install (no scripts), then build each dist. Kept as
# their own layers so a backend-only src change doesn't rebuild them. The apps
# depend on these packages via `file:` deps, so every dist must exist before
# any `npm ci` below.
#
# ⚠️ ADDING A packages/* PACKAGE? It needs a stage here or the image build
# breaks — and CI will NOT catch it, because typecheck/lint/test run in a
# working tree where the package is already built. The failure only surfaces in
# the Fly deploy / GHCR publish. This bit us once already (PR #312 added
# binder-routing, #314 fixed this file).
COPY packages/game-core/package.json packages/game-core/package-lock.json packages/game-core/tsconfig*.json ./packages/game-core/
RUN npm --prefix packages/game-core ci --ignore-scripts
COPY packages/game-core/src ./packages/game-core/src
RUN npm --prefix packages/game-core run build

COPY packages/binder-routing/package.json packages/binder-routing/package-lock.json packages/binder-routing/tsconfig*.json ./packages/binder-routing/
RUN npm --prefix packages/binder-routing ci --ignore-scripts
COPY packages/binder-routing/src ./packages/binder-routing/src
RUN npm --prefix packages/binder-routing run build

# deck-metrics: the bracket estimator. Frontend-only consumer today, so it is
# built here (the web bundle imports it) but NOT copied into the runtime image
# below. When the backend takes a `file:` dep on it, add the runtime
# package.json + dist copy alongside the other two.
COPY packages/deck-metrics/package.json packages/deck-metrics/package-lock.json packages/deck-metrics/tsconfig*.json ./packages/deck-metrics/
RUN npm --prefix packages/deck-metrics ci --ignore-scripts
COPY packages/deck-metrics/src ./packages/deck-metrics/src
RUN npm --prefix packages/deck-metrics run build

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
# Google Drive picker credentials. Both are PUBLIC values that ship inside the
# bundle — security comes from the API key's HTTP-referrer restriction and the
# OAuth client's authorized origins, not from hiding them. They must arrive as
# build args because Vite inlines `import.meta.env.*` at BUILD time: setting
# them as Fly runtime secrets would leave the compiled bundle without them and
# the Drive button silently absent in prod. Unset is a supported state — the
# picker gates itself off and the pasted-link fallback renders instead.
ARG VITE_GOOGLE_API_KEY=""
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_GOOGLE_API_KEY=$VITE_GOOGLE_API_KEY \
    VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
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
# deck-metrics: #1637 deliberately shipped only the BUILD stage, because the
# backend took no file: dep on it yet. It does now (the AI check_bracket tool
# runs the bracket estimator), so the runtime copy has to exist or the `npm ci`
# below cannot resolve the link. CI does NOT catch this — it runs in a working
# tree where the package is already present, so a missing runtime copy surfaces
# only in the Fly/GHCR image builds. Same trap binder-routing hit in #312/#314.
COPY packages/deck-metrics/package.json ./packages/deck-metrics/
COPY --from=build /app/packages/deck-metrics/dist ./packages/deck-metrics/dist

# Prod-only backend deps (better-sqlite3's native install script still runs;
# game-core is linked from the path above).
COPY backend/package.json backend/package-lock.json ./backend/
# python3 + make are node-gyp's configure/build tools, and `npm ci` needs them
# even when nothing is compiled. better-sqlite3 >=13 ships prebuilt binaries and
# sets "gypfile": false to tell npm to skip the implicit `node-gyp rebuild` — but
# that flag lives only in the REGISTRY MANIFEST. `npm install` reads it and skips
# the rebuild; `npm ci` installs from package-lock.json, which does not record
# gypfile, so npm falls back to "binding.gyp on disk => run node-gyp rebuild".
# The rebuild is a no-op (better-sqlite3's binding.gyp detects the prebuild and
# emits `type: none` targets, so NO compiler is required and nothing is built) —
# but node-gyp still needs Python to run gyp and make to run the Makefile it
# generates. node:22-bookworm-slim ships neither, which is what broke this build
# on the better-sqlite3 12 -> 13 bump (#1701): "Could not find any Python
# installation to use". Installed and purged inside one layer so the runtime
# image doesn't carry a toolchain it never uses.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make \
  && npm --prefix backend ci --omit=dev \
  && npm cache clean --force \
  && apt-get purge -y --auto-remove python3 make \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/backend/dist ./backend/dist

# Scanner matcher data (pHash DB + MobileCLIP embeddings + ONNX model).
# Loaded by backend/src/scanner/matcher.ts at boot to serve
# `POST /api/scanner/match`. Refreshed nightly by
# .github/workflows/scanner-ingest.yml — the workflow runs the ingest
# scripts and opens a PR with the regenerated artifacts.
COPY backend/data/scanner ./backend/data/scanner
# Fail the build loudly if card-embeddings.bin came in as a Git-LFS pointer
# (~133 bytes) instead of the real 28 MB binary — a missing `lfs: true` on the
# deploy checkout otherwise ships a stub that bricks the scanner matcher at boot.
RUN test "$(wc -c < ./backend/data/scanner/card-embeddings.bin)" -gt 1000000 \
  || (echo 'ERROR: card-embeddings.bin is a stub/LFS pointer — run git lfs pull' && exit 1)

# Static web bundle, served by Express at runtime (server.ts: SPA_DIR).
COPY --from=build /app/frontend/dist ./backend/public

RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3737
CMD ["node", "backend/dist/server.js"]
