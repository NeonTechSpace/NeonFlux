<h1 align="center">NeonFlux</h1>

<h3 align="center">A multi functional bot for Fluxer</h3>

<div align="center">

[![CI](https://img.shields.io/github/actions/workflow/status/NeonTechSpace/NeonFlux/ci.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=fff&labelColor=0B1221&color=237DBE&label=CI)](https://github.com/NeonTechSpace/NeonFlux/actions/workflows/ci.yml)

</div>

<div align="center">

[![Bot Release](https://img.shields.io/static/v1?style=for-the-badge&label=Bot%20Release&message=Pending&logo=github&logoColor=fff&labelColor=0B1221&color=5A1730)](https://github.com/NeonTechSpace/NeonFlux/tags)
    
[![Web Release](https://img.shields.io/static/v1?style=for-the-badge&label=Web%20Release&message=Pending&logo=github&logoColor=fff&labelColor=0B1221&color=1E40AF)](https://github.com/NeonTechSpace/NeonFlux/tags)

</div>

## Initial Plan

NeonFlux is planned as a Fluxer bot with a web dashboard and Convex-backed live dashboard data.

It supports two modes:

- Single instance: one bot for one configured guild.
- Multi instance: one bot can serve multiple guilds.

The planned feature areas are:

- Autorole
- Bot installation sync and reconciliation
- Command help
- Convex dashboard data
- Dashboard access for single and multi instance
- Dashboard audit events
- Dashboard server overview and growth tracking
- Docker / GHCR deployment
- Free game alerts
- Fumadocs documentation under `/docs`
- Giveaways
- Import/export for roles, channels, categories, emojis, and permissions
- Invite tracker
- Logging
- Message and embed posting
- Moderation
- OAuth login, sessions, and refreshed permissions
- Profile / about me embed builder
- Public/private tickets
- Public web URL and generated links
- Reaction roles
- Suggestion voting
- Verification reaction roles
- Voice channel generator
- XP / levels

The goal is to build the bot in small, clear pieces and keep shared logic reusable between the bot and web app.

## Repo Beats

![Alt](https://repobeats.axiom.co/api/embed/79b0b7006e59290b742ddcd8cacb309dd81e0fff.svg "Repobeats analytics image")

## Star Map

<a href="https://www.star-history.com/?repos=NeonTechSpace%2FNeonFlux&type=date&legend=top-left">
    <picture>
        <source
            media="(prefers-color-scheme: dark)"
            srcset="https://api.star-history.com/chart?repos=NeonTechSpace/NeonFlux&type=date&legend=top-left&theme=dark" />
        <source
            media="(prefers-color-scheme: light)"
            srcset="https://api.star-history.com/chart?repos=NeonTechSpace/NeonFlux&type=date&legend=top-left" />
        <img
            alt="Star History Chart"
            src="https://api.star-history.com/chart?repos=NeonTechSpace/NeonFlux&type=date&legend=top-left" />
    </picture>
</a>

## Project Shape

The main workspace is in `projects`.

- `apps/bot`: Fluxer bot process
- `apps/web`: web dashboard
- `packages/config`: shared env parsing
- `packages/convex`: shared Convex client and JWT helpers
- `convex`: Convex functions and the generated `@neonflux/convex-api` workspace package
- `packages/db`: runtime database boundary
- `packages/core`: shared bot/web rules
- `packages/fluxer`: Fluxer API and permission helpers

## Environment Setup

Use `pnpm` from the `projects` folder. Environment values live in `projects/.env`. The tracked template is `projects/.env.example`.

Start a local env file:

```bash
cd projects
cp .env.example .env
```

On Windows PowerShell, use `Copy-Item .env.example .env`.

Generate separate secrets for every environment. Do not reuse dev values in production.

```bash
pnpm generate:session-secret
pnpm generate:token-encryption-key
pnpm generate:convex-private-key
```

Put those outputs in `SESSION_SECRET`, `FLUXER_TOKEN_ENCRYPTION_KEY`, and `NEONFLUX_AUTH_JWT_PRIVATE_KEY`.

After `NEONFLUX_AUTH_JWT_PRIVATE_KEY` and the intended `NEONFLUX_AUTH_JWT_ISSUER` are set, generate the public JWKS value:

```bash
pnpm --silent generate:convex-jwks
```

Put the output in `NEONFLUX_AUTH_JWT_JWKS`. Convex receives issuer, audience, and this public JWKS value only. Do not send `NEONFLUX_AUTH_JWT_PRIVATE_KEY`, `SESSION_SECRET`, Fluxer secrets, or token encryption keys to Convex.

### Development

For local development, keep the app issuer local and point OAuth back to localhost:

```dotenv
APP_ENV=development
NODE_ENV=development
PUBLIC_WEB_URL=
FLUXER_OAUTH_REDIRECT_URL=http://localhost:3000/auth/fluxer/callback
NEONFLUX_AUTH_JWT_ISSUER=http://localhost:3000/auth
NEONFLUX_AUTH_JWT_AUDIENCE=neonflux-convex
CONVEX_DEPLOYMENT=<dev Convex deployment>
CONVEX_URL=<dev Convex URL>
VITE_CONVEX_URL=<dev Convex URL>
```

Then validate the selected Convex target and run the processes you need:

```bash
pnpm convex:check-auth-env
pnpm dev:bot
pnpm dev:web
```

For dashboard routes, start the bot before the web app so the bot can bootstrap deployment config and runtime guild state. The homepage and docs can run with only `pnpm dev:web`. Local development does not require app Postgres. Convex is the durable store target.

### Production

Production uses the same variable names with production values:

```dotenv
APP_ENV=production
NODE_ENV=production
PUBLIC_WEB_URL=https://<your NeonFlux web host>
FLUXER_OAUTH_REDIRECT_URL=https://<your NeonFlux web host>/auth/fluxer/callback
NEONFLUX_AUTH_JWT_ISSUER=https://<your NeonFlux web host>/auth
NEONFLUX_AUTH_JWT_AUDIENCE=neonflux-convex
CONVEX_DEPLOYMENT=<production Convex deployment>
CONVEX_URL=<production Convex URL>
VITE_CONVEX_URL=<production Convex URL>
```

`NEONFLUX_AUTH_JWT_ISSUER` is a NeonFlux issuer, not the Fluxer OAuth host. Use protected environment variables or a secret store for production secrets. Keep `CONVEX_DEPLOY_KEY` protected for deploy automation.

Dry-run the public Convex auth update before applying it:

```bash
pnpm convex:configure-auth-env -- --issuer https://<your NeonFlux web host>/auth --deployment <production Convex deployment>
```

Apply only after the dry-run targets the intended deployment:

```bash
pnpm convex:configure-auth-env -- --issuer https://<your NeonFlux web host>/auth --deployment <production Convex deployment> --apply --confirm-apply-target <production Convex deployment>
pnpm convex:check-auth-env -- --compare-deploy-env
pnpm convex:deploy
```

See [docs/Convex.md](docs/Convex.md) for the full Convex auth and deploy workflow.

## Convex

NeonFlux uses Convex for durable state and live dashboard data. To self-host Convex separately from NeonFlux app data, see [docs/Convex.md](docs/Convex.md).

## Docker

Docker users can run NeonFlux with the published GHCR images for the bot and web app.

See [docs/Docker.md](docs/Docker.md) for the Docker Compose guide, including environment setup through [projects/.env.example](projects/.env.example). The main stack is [projects/docker-compose.yml](projects/docker-compose.yml). The optional Convex stack is [projects/docker-compose.convex.yml](projects/docker-compose.convex.yml).
