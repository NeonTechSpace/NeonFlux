# NeonFlux Docker Guide

Use this for self-hosted NeonFlux deployments.

## Compose Files

- Main bot/web stack: [projects/docker-compose.yml](../projects/docker-compose.yml)
- Optional self-hosted Convex stack: [projects/docker-compose.convex.yml](../projects/docker-compose.convex.yml)
- Convex self-hosting guide: [docs/Convex.md](Convex.md)

## Images

- `ghcr.io/neontechspace/neonflux-bot`
- `ghcr.io/neontechspace/neonflux-web`
  Use pinned tags for stable deployments. `latest` is convenient for testing but harder to roll back.

## Environment

Use [projects/.env.example](../projects/.env.example) as the source of truth for variable order and explanations.

Important deployment notes:

- Convex values are the durable runtime store configuration for bot and web.
- The main bot/web Compose stack does not start or use an app Postgres database.
- `NEONFLUX_AUTH_JWT_JWKS` is public JWKS material and is required by both bot and web runtime containers alongside the server-only `NEONFLUX_AUTH_JWT_PRIVATE_KEY`.
- `FLUXER_OAUTH_REDIRECT_URL` must match the URL registered in the Fluxer application.
- `FLUXER_BOT_INVITE_URL` is optional and controls the `+` invite action in dashboard guild navigation.
- `SESSION_SECRET` signs web sessions.
- `FLUXER_TOKEN_ENCRYPTION_KEY` encrypts stored Fluxer OAuth tokens.

Generate secrets from the `projects` folder:

Run `pnpm generate:session-secret` and `pnpm generate:token-encryption-key`.

## Start

From `projects`:

Run `docker compose up -d`.

For self-hosted Convex:

Run `docker compose -f docker-compose.convex.yml up -d`.
