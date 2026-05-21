# syntax=docker/dockerfile:1.7
#
# Build context is the REPO ROOT (see .github/workflows/docker-publish.yml
# `context: .` and `file: ./backend/Dockerfile`). The image mirrors the repo
# layout — /app/backend + /app/packages/game-core — so the backend's
# `file:../packages/game-core` dependency resolves to the same relative path
# inside the image as it does in the working tree.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Shared package first: install (no scripts), then build its dist. Kept as
# its own layers so a backend-only src change doesn't rebuild game-core.
COPY packages/game-core/package.json packages/game-core/package-lock.json packages/game-core/tsconfig*.json ./packages/game-core/
RUN npm --prefix packages/game-core ci --ignore-scripts
COPY packages/game-core/src ./packages/game-core/src
RUN npm --prefix packages/game-core run build

# Backend deps (resolves file:../packages/game-core — dir present + built, so
# game-core's dist-guarded `prepare` is a no-op), then compile.
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

# Shared package: ship package.json + prebuilt dist only (no sources/devDeps).
# Copied BEFORE the backend install so the dist-guarded `prepare` stays a
# no-op when npm links the file: dependency.
COPY packages/game-core/package.json ./packages/game-core/
COPY --from=build /app/packages/game-core/dist ./packages/game-core/dist

# Prod-only backend deps (better-sqlite3's native install script still runs;
# game-core is linked from the path above).
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci --omit=dev && npm cache clean --force
COPY --from=build /app/backend/dist ./backend/dist

# Static web bundle, served by Express at runtime (server.ts: SPA_DIR).
COPY --from=build /app/frontend/dist ./backend/public

RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3737
CMD ["node", "backend/dist/server.js"]
