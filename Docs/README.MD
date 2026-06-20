# NeonFlux

A multi functional bot for fluxer.

## Initial Plan

NeonFlux is planned as a Fluxer bot with a small web dashboard.

It supports two modes:

- Single instance: one bot for one configured guild.
- Multi instance: one bot can serve multiple guilds.

The planned feature areas are:

- Public and private tickets
- Moderation
- Logging
- XP and levels
- Voice channel generator
- Reaction roles and verification
- Suggestions and voting
- Message and embed posting
- Profile / about me embed builder with admin approval settings
- Autorole
- Import/export for roles, channels, categories, emojis, and permissions

The goal is to build the bot in small, clear pieces and keep shared logic reusable between the bot and web app.

## Project Shape

The main workspace is in `Projects`.

- `apps/bot`: Fluxer bot process
- `apps/web`: web dashboard
- `packages/config`: shared env parsing
- `packages/db`: Postgres schema and database access
- `packages/core`: shared bot/web rules
- `packages/fluxer`: Fluxer API and permission helpers

Use `pnpm` from the `Projects` folder.

Environment values live in `Projects/.env`. The tracked template is `Projects/.env.example`.

Generate a strong session secret from the `Projects` folder:

```bash
pnpm generate:session-secret
```

Put the output in `SESSION_SECRET`.

Production uses real Postgres. PGlite is only for local migration checks.

## Docker

Docker users can run NeonFlux with the published GHCR images for the bot and web app.

See [Docs/Docker.md](Docs/Docker.md) for the Docker Compose guide.
