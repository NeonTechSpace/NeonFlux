# NeonFlux Docker Guide

This guide is for running NeonFlux from the published Docker images.

## Images

- `ghcr.io/neontechspace/neonflux-bot`
- `ghcr.io/neontechspace/neonflux-web`
- `postgres:17-alpine`

Use pinned version tags for stable deployments:

```yaml
ghcr.io/neontechspace/neonflux-bot:1.2.0
ghcr.io/neontechspace/neonflux-web:1.4.0
```

`latest` is available, but version tags are easier to roll back.

## Compose File

```yaml
name: neonflux

services:
    db:
        image: postgres:17-alpine
        restart: unless-stopped
        environment:
            POSTGRES_USER: neonflux
            POSTGRES_PASSWORD: change-me
            POSTGRES_DB: neonflux
        volumes:
            - postgres-data:/var/lib/postgresql/data
        healthcheck:
            test:
                [
                    "CMD-SHELL",
                    'pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"',
                ]
            interval: 10s
            timeout: 5s
            retries: 10

    bot:
        image: ghcr.io/neontechspace/neonflux-bot:latest
        restart: unless-stopped
        environment:
            APP_ENV: production
            NODE_ENV: production
            DATABASE_URL: ${DATABASE_URL:?DATABASE_URL is required}
            AUTO_MIGRATE: ${AUTO_MIGRATE:-true}
            INSTANCE_MODE: ${INSTANCE_MODE:-multi}
            SINGLE_GUILD_ID: ${SINGLE_GUILD_ID:-}
            FLUXER_BOT_TOKEN: ${FLUXER_BOT_TOKEN:?FLUXER_BOT_TOKEN is required}
            LOG_LEVEL: ${LOG_LEVEL:-info}
            OWNER_IDS: ${OWNER_IDS:-}
        depends_on:
            db:
                condition: service_healthy

    web:
        image: ghcr.io/neontechspace/neonflux-web:latest
        restart: unless-stopped
        environment:
            APP_ENV: production
            NODE_ENV: production
            DATABASE_URL: ${DATABASE_URL:?DATABASE_URL is required}
            AUTO_MIGRATE: ${AUTO_MIGRATE:-true}
            INSTANCE_MODE: ${INSTANCE_MODE:-multi}
            SINGLE_GUILD_ID: ${SINGLE_GUILD_ID:-}
            FLUXER_APP_ID: ${FLUXER_APP_ID:?FLUXER_APP_ID is required}
            FLUXER_CLIENT_SECRET: ${FLUXER_CLIENT_SECRET:?FLUXER_CLIENT_SECRET is required}
            FLUXER_OAUTH_REDIRECT_URL: ${FLUXER_OAUTH_REDIRECT_URL:?FLUXER_OAUTH_REDIRECT_URL is required}
            SESSION_SECRET: ${SESSION_SECRET:?SESSION_SECRET is required}
            LOG_LEVEL: ${LOG_LEVEL:-info}
            OWNER_IDS: ${OWNER_IDS:-}
            HOST: "0.0.0.0"
            PORT: "3000"
        ports:
            - "3000:3000"
        depends_on:
            db:
                condition: service_healthy

volumes:
    postgres-data:
```

## Environment

Use the same key names as local development. In Docker, `DATABASE_URL` must use the Compose service name `db`.

```env
INSTANCE_MODE=multi
AUTO_MIGRATE=true

DATABASE_URL=postgres://neonflux:change-me@db:5432/neonflux

FLUXER_APP_ID=
FLUXER_CLIENT_SECRET=
FLUXER_BOT_TOKEN=
FLUXER_OAUTH_REDIRECT_URL=https://your-domain.example/auth/fluxer/callback

SESSION_SECRET=
LOG_LEVEL=info
OWNER_IDS=
```

Generate `SESSION_SECRET` with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

## Migrations

`AUTO_MIGRATE=true` lets bot and web run pending migrations on startup.

Both services may start at the same time. NeonFlux uses a Postgres lock so only one service migrates, and already-applied migrations are skipped.

If migration fails, the app fails startup instead of running against an unsafe schema.
