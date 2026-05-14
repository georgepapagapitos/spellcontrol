# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    DB_PATH=/data/scryfall-cache.db \
    PHASH_DB_PATH=/data/phash.db \
    PORT=3737
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3737
CMD ["node", "dist/server.js"]
