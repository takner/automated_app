# syntax=docker/dockerfile:1.7
# Hamrooz: one image for web (next start), worker (dist/worker.mjs), CLI and migrations.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
# install scripts are limited to the packages approved in package.json "allowScripts"
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ARG APP_RELEASE=dev
ENV APP_RELEASE=${APP_RELEASE}
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ARG APP_RELEASE=dev
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    APP_RELEASE=${APP_RELEASE} \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/package.json /app/next.config.ts /app/prisma.config.ts ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
USER node
EXPOSE 3000
LABEL org.opencontainers.image.source="https://github.com/takner/automated_app" \
      org.opencontainers.image.revision="${APP_RELEASE}"
CMD ["node_modules/.bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
