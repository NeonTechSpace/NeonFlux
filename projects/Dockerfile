# syntax=docker/dockerfile:1.7

FROM node:24.18.0-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable

FROM base AS package-manifests

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN corepack prepare "$(node -p "require('./package.json').packageManager")" --activate

COPY convex/package.json ./convex/package.json
COPY packages/blueprint/package.json ./packages/blueprint/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/convex/package.json ./packages/convex/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/fluxer/package.json ./packages/fluxer/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/messaging/package.json ./packages/messaging/package.json
COPY apps/bot/package.json ./apps/bot/package.json
COPY apps/web/package.json ./apps/web/package.json

FROM package-manifests AS deps

ARG TARGETARCH
ARG TARGETOS

RUN --mount=type=cache,id=neonflux-pnpm-${TARGETOS}-${TARGETARCH},target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

FROM deps AS build-bot

COPY tsconfig.json tsconfig.base.json tsconfig.eslint.json ./
COPY convex ./convex
COPY packages/blueprint ./packages/blueprint
COPY packages/config ./packages/config
COPY packages/convex ./packages/convex
COPY packages/core ./packages/core
COPY packages/fluxer ./packages/fluxer
COPY packages/db ./packages/db
COPY packages/messaging ./packages/messaging
COPY apps/bot ./apps/bot

RUN pnpm -r --filter @neonflux/bot... build

FROM deps AS build-web

COPY tsconfig.json tsconfig.base.json tsconfig.eslint.json ./
COPY convex ./convex
COPY packages/blueprint ./packages/blueprint
COPY packages/config ./packages/config
COPY packages/convex ./packages/convex
COPY packages/core ./packages/core
COPY packages/fluxer ./packages/fluxer
COPY packages/db ./packages/db
COPY packages/messaging ./packages/messaging
COPY apps/web ./apps/web
COPY scripts/check-dashboard-bundle-boundaries.mjs ./scripts/check-dashboard-bundle-boundaries.mjs
COPY scripts/start-web.mjs ./scripts/start-web.mjs

RUN pnpm -r --filter neonflux-web... build

FROM package-manifests AS production-deps

ARG TARGETARCH
ARG TARGETOS

RUN --mount=type=cache,id=neonflux-pnpm-${TARGETOS}-${TARGETARCH},target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --prod --store-dir /pnpm/store

FROM base AS bot

ENV APP_ENV=production
ENV NODE_ENV=production

COPY --from=production-deps /app ./
COPY --from=build-bot /app/apps/bot/dist ./apps/bot/dist
COPY --from=build-bot /app/convex/_generated ./convex/_generated
COPY --from=build-bot /app/packages/blueprint/dist ./packages/blueprint/dist
COPY --from=build-bot /app/packages/config/dist ./packages/config/dist
COPY --from=build-bot /app/packages/convex/dist ./packages/convex/dist
COPY --from=build-bot /app/packages/core/dist ./packages/core/dist
COPY --from=build-bot /app/packages/fluxer/dist ./packages/fluxer/dist
COPY --from=build-bot /app/packages/db/dist ./packages/db/dist
COPY --from=build-bot /app/packages/messaging/dist ./packages/messaging/dist

CMD ["node", "--enable-source-maps", "apps/bot/dist/index.js"]

FROM base AS web

ENV APP_ENV=production
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=production-deps /app ./
COPY --from=build-web /app/apps/web/.output ./apps/web/.output
COPY --from=build-web /app/scripts/start-web.mjs ./scripts/start-web.mjs
COPY --from=build-web /app/convex/_generated ./convex/_generated
COPY --from=build-web /app/packages/blueprint/dist ./packages/blueprint/dist
COPY --from=build-web /app/packages/config/dist ./packages/config/dist
COPY --from=build-web /app/packages/convex/dist ./packages/convex/dist
COPY --from=build-web /app/packages/core/dist ./packages/core/dist
COPY --from=build-web /app/packages/fluxer/dist ./packages/fluxer/dist
COPY --from=build-web /app/packages/db/dist ./packages/db/dist
COPY --from=build-web /app/packages/messaging/dist ./packages/messaging/dist

EXPOSE 3000

CMD ["node", "scripts/start-web.mjs"]
