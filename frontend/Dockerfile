FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ENV VITE_API_URL=/api
RUN npm run build

# Reuse this stage's installed dependencies instead of npm ci on the runner.
ARG CHECK_SESSIONS=false
ARG CHECK_UPLOADS=false
RUN if [ "$CHECK_SESSIONS" = "true" ]; then npm run test:auth; fi \
    && if [ "$CHECK_UPLOADS" = "true" ]; then npm run test:upload; fi

FROM caddy:2.11.7-alpine AS runtime
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80 443
