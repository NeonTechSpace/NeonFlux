# NeonFlux Docker Guide

Use this for self-hosted NeonFlux deployments.

## Compose Files

- Main bot/web/db stack: [Projects/docker-compose.yml](../Projects/docker-compose.yml)
- Optional self-hosted Convex stack: [Projects/docker-compose.convex.yml](../Projects/docker-compose.convex.yml)
- Convex self-hosting guide: [Docs/Convex.md](Convex.md)

## Images

- `ghcr.io/neontechspace/neonflux-bot`
- `ghcr.io/neontechspace/neonflux-web`
- `postgres:17-alpine`

Use pinned tags for stable deployments. `latest` is convenient for testing but harder to roll back.

## Environment

Use [Projects/.env.example](../Projects/.env.example) as the source of truth for variable order and explanations.

Important deployment notes:

- `DATABASE_URL` must use the Compose service name `db`, for example `postgres://neonflux:change-me@db:5432/neonflux`.
- `FLUXER_OAUTH_REDIRECT_URL` must match the URL registered in the Fluxer application.
- `FLUXER_BOT_INVITE_URL` is optional and controls the `+` invite action in dashboard guild navigation.
- `SESSION_SECRET` signs web sessions.
- `FLUXER_TOKEN_ENCRYPTION_KEY` encrypts stored Fluxer OAuth tokens.
- `CONVEX_*` values are only needed when using [Projects/docker-compose.convex.yml](../Projects/docker-compose.convex.yml).

Generate secrets from the `Projects` folder:

Run `pnpm generate:session-secret` and `pnpm generate:token-encryption-key`.

## Start

From `Projects`:

Run `docker compose up -d`.

For self-hosted Convex:

Run `docker compose -f docker-compose.convex.yml up -d`.

## Migrations

`AUTO_MIGRATE=true` lets bot and web run pending migrations on startup.

NeonFlux uses a Postgres lock so only one service migrates. If migration fails, the app fails startup instead of running against an unsafe schema.
