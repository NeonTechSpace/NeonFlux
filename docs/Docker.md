# NeonFlux Docker Guide

The main Compose stack runs two application services. Convex remains the durable store and can be hosted separately or started with the optional Convex Compose file.

## Files and images

- App stack: [`projects/docker-compose.yml`](../projects/docker-compose.yml)
- Optional Convex stack: [`projects/docker-compose.convex.yml`](../projects/docker-compose.convex.yml)
- Environment reference: [`projects/.env.example`](../projects/.env.example)
- Convex operations: [Convex guide](Convex.md)
- Bot image: `ghcr.io/neontechspace/neonflux-bot`
- Web image: `ghcr.io/neontechspace/neonflux-web`

Use pinned image tags for deployments that need reliable rollback. `latest` is intended for active testing.

## Service ownership

| Service | Owns                                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------------------- |
| `bot`   | Fluxer bot token, gateway, installation/deployment bootstrap, provider reads, posting and Blueprint workers |
| `web`   | Fluxer OAuth, sessions, public docs, dashboard authorization, user/web Convex tokens                        |

Both services connect to Convex. There is no application PostgreSQL container.

The web service does not receive `FLUXER_BOT_TOKEN`. Live provider reads use `NEONFLUX_BOT_READ_URL=http://bot:3001` on the private Compose network. The bot verifies a short-lived web-service JWT before reading through its existing Fluxer gateway client. Port 3001 is not published by the app stack.

## Authentication material

Convex uses three distinct issuer/audience/key tuples:

- the bot container receives the bot provider's private key.
- the web container receives the web-service and user provider private keys.
- the bot receives the web provider's public JWKS to authenticate internal read requests.
- Convex receives all three public JWKS values through its deployment environment.

No private JWT key is configured in Convex. The browser receives only short-lived guild-scoped user tokens.

Generate secrets from `projects` as described in [the Convex guide](Convex.md). Keep the complete operator configuration in `.env`. `.env.local` is optional ignored Convex CLI metadata, not the app configuration file.

## Required setup

At minimum, configure:

- Convex deployment and runtime URLs.
- three distinct Convex JWT providers.
- `FLUXER_BOT_TOKEN` for the bot.
- Fluxer application id, OAuth secret, and exact registered callback URL for web.
- `SESSION_SECRET` and `FLUXER_TOKEN_ENCRYPTION_KEY`.
- deployment mode and guild/owner settings.
- `NEONFLUX_DATA_RETENTION_DAYS` when the 90-day default is not desired.

Dry-run and explicitly apply Convex auth and runtime values before starting a new deployment:

```sh
pnpm convex:configure-auth-env -- --deployment <target>
pnpm convex:configure-runtime-env -- --deployment <target>

pnpm convex:configure-auth-env -- --deployment <target> --apply --confirm-apply-target <target>
pnpm convex:configure-runtime-env -- --deployment <target> --apply --confirm-apply-target <target>
pnpm convex:check-auth-env -- --deployment <target> --compare-deploy-env
```

## Start

From `projects`:

```sh
docker compose up -d
docker compose logs -f bot web
```

The bot must successfully bootstrap deployment config before authenticated dashboard guild flows are authoritative.

For optional self-hosted Convex infrastructure:

```sh
docker compose -f docker-compose.convex.yml up -d
```

Do not expose the internal bot-read port. Publish only the web port and any deliberately reverse-proxied Convex endpoints.
