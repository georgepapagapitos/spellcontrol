# syntax=docker/dockerfile:1.7
#
# Build context is the REPO ROOT (see .github/workflows/docker-publish.yml
# `context: .` and `file: ./frontend/Dockerfile`). The build image mirrors
# the repo layout so the frontend's `file:../packages/game-core` dependency
# resolves; the runtime image is just nginx serving the static bundle (no
# node_modules at runtime, so nothing to link there).

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Shared package first: install (no scripts), then build its dist.
COPY packages/game-core/package.json packages/game-core/package-lock.json packages/game-core/tsconfig*.json ./packages/game-core/
RUN npm --prefix packages/game-core ci --ignore-scripts
COPY packages/game-core/src ./packages/game-core/src
RUN npm --prefix packages/game-core run build

# Frontend deps (resolves file:../packages/game-core — dist present, so the
# guarded prepare is a no-op), then build the static bundle. Vite/Rollup
# resolves the package's "exports" → "import" (ESM) condition.
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci
COPY frontend/ ./frontend/
RUN npm --prefix frontend run build

FROM nginx:1.27-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
