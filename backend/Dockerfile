FROM node:22-bookworm-slim AS build
WORKDIR /app
# bcrypt can fall back to a native build on ARM.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY backend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p storage/videos storage/posters storage/masters \
    && chown -R node:node /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node backend/package.json ./package.json
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
