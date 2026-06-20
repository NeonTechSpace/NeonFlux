# syntax=docker/dockerfile:1.7

FROM node:24.16.0-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.6.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json tsconfig.base.json tsconfig.eslint.json ./
COPY eslint.config.js prettier.config.js vitest.config.ts drizzle.config.ts ./
COPY scripts ./scripts
COPY packages ./packages
COPY apps ./apps

RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM build AS bot

ENV APP_ENV=production
ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@neonflux/bot", "start"]

FROM build AS web

ENV APP_ENV=production
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["pnpm", "--filter", "neonflux-web", "start"]
