# syntax=docker/dockerfile:1.7

FROM node:24.16.0-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN npm install --global pnpm@11.6.0

FROM base AS package-manifests

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json ./packages/config/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/fluxer/package.json ./packages/fluxer/package.json
COPY apps/bot/package.json ./apps/bot/package.json
COPY apps/web/package.json ./apps/web/package.json

FROM package-manifests AS deps

RUN pnpm install --frozen-lockfile

FROM deps AS build

COPY tsconfig.json tsconfig.base.json tsconfig.eslint.json ./
COPY eslint.config.js prettier.config.js vitest.config.ts drizzle.config.ts ./
COPY scripts ./scripts
COPY packages ./packages
COPY apps ./apps

RUN pnpm build

FROM package-manifests AS production-deps

RUN pnpm install --frozen-lockfile --prod

FROM base AS bot

ENV APP_ENV=production
ENV NODE_ENV=production

COPY --from=production-deps /app ./
COPY --from=build /app/apps/bot/dist ./apps/bot/dist
COPY --from=build /app/packages/config/dist ./packages/config/dist
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=build /app/packages/fluxer/dist ./packages/fluxer/dist

CMD ["node", "--enable-source-maps", "apps/bot/dist/index.js"]

FROM base AS web

ENV APP_ENV=production
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY --from=production-deps /app ./
COPY --from=build /app/apps/web/.output ./apps/web/.output
COPY --from=build /app/scripts/start-web.mjs ./scripts/start-web.mjs
COPY --from=build /app/packages/config/dist ./packages/config/dist
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=build /app/packages/fluxer/dist ./packages/fluxer/dist

EXPOSE 3000

CMD ["node", "scripts/start-web.mjs"]
