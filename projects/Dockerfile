# syntax=docker/dockerfile:1.7

FROM node:24.18.0-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime-base

WORKDIR /app

FROM runtime-base AS build-base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

FROM build-base AS package-manifests

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Keep patches as an optional tracked directory so clean build contexts can copy it when empty.
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
COPY packages/reaction-roles/package.json ./packages/reaction-roles/package.json
COPY apps/bot/package.json ./apps/bot/package.json
COPY apps/web/package.json ./apps/web/package.json

FROM package-manifests AS deps

ARG TARGETARCH
ARG TARGETOS

RUN --mount=type=cache,id=neonflux-pnpm-${TARGETOS}-${TARGETARCH},target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

FROM deps AS build-bot

ARG TARGETARCH
ARG TARGETOS

COPY tsconfig.json tsconfig.base.json tsconfig.eslint.json ./
COPY convex ./convex
COPY packages/blueprint ./packages/blueprint
COPY packages/config ./packages/config
COPY packages/convex ./packages/convex
COPY packages/core ./packages/core
COPY packages/fluxer ./packages/fluxer
COPY packages/db ./packages/db
COPY packages/messaging ./packages/messaging
COPY packages/reaction-roles ./packages/reaction-roles
COPY apps/bot ./apps/bot

RUN pnpm -r --filter @neonflux/bot... build
RUN --mount=type=cache,id=neonflux-pnpm-${TARGETOS}-${TARGETARCH},target=/pnpm/store,sharing=locked \
    pnpm --filter @neonflux/bot deploy --prod --legacy /deploy/bot

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
COPY packages/reaction-roles ./packages/reaction-roles
COPY apps/web ./apps/web
COPY scripts/check-dashboard-bundle-boundaries.mjs ./scripts/check-dashboard-bundle-boundaries.mjs

RUN pnpm -r --filter neonflux-web... build

FROM runtime-base AS bot

ENV APP_ENV=production
ENV NODE_ENV=production

COPY --link --chown=1000:1000 --from=build-bot /deploy/bot ./

USER node

CMD ["node", "--enable-source-maps", "dist/index.js"]

FROM runtime-base AS web

ENV APP_ENV=production
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --link --chown=1000:1000 --from=build-web /app/apps/web/.output ./.output

USER node

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
