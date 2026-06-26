<h1 align="center">NeonFlux</h1>

<h3 align="center">A multi functional bot for Fluxer</h3>

<div align="center">

[![CI](https://img.shields.io/github/actions/workflow/status/NeonTechSpace/NeonFlux/ci.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=fff&labelColor=0B1221&color=237DBE&label=CI)](https://github.com/NeonTechSpace/NeonFlux/actions/workflows/ci.yml)

</div>

<div align="center">

[![Bot Release](https://img.shields.io/static/v1?style=for-the-badge&label=Bot%20Release&message=Pending&logo=github&logoColor=fff&labelColor=0B1221&color=5A1730)](https://github.com/NeonTechSpace/NeonFlux/tags)
&nbsp;&nbsp;&nbsp;&nbsp;
[![Web Release](https://img.shields.io/static/v1?style=for-the-badge&label=Web%20Release&message=Pending&logo=github&logoColor=fff&labelColor=0B1221&color=1E40AF)](https://github.com/NeonTechSpace/NeonFlux/tags)

</div>

## Initial Plan

NeonFlux is planned as a Fluxer bot with a small web dashboard.

It supports two modes:

- Single instance: one bot for one configured guild.
- Multi instance: one bot can serve multiple guilds.

The planned feature areas are:

- Autorole
- Bot installation sync and reconciliation
- Command help
- Dashboard access for single and multi instance
- Dashboard audit events
- Dashboard server overview and growth tracking
- Docker / GHCR deployment
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

<a href="https://www.star-history.com/?repos=NeonTechSpace%2FNeonFlux&amp;type=date&amp;legend=top-left">
    <picture>
        <source
            media="(prefers-color-scheme: dark)"
            srcset="https://api.star-history.com/chart?repos=NeonTechSpace/NeonFlux&amp;type=date&amp;legend=top-left&amp;theme=dark" />
        <source
            media="(prefers-color-scheme: light)"
            srcset="https://api.star-history.com/chart?repos=NeonTechSpace/NeonFlux&amp;type=date&amp;legend=top-left" />
        <img
            alt="Star History Chart"
            src="https://api.star-history.com/chart?repos=NeonTechSpace/NeonFlux&amp;type=date&amp;legend=top-left" />
    </picture>
</a>

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

Local development does not require running Postgres on this machine. PGlite is used for local migration checks.

Real bot/web smoke tests do require a reachable Postgres-compatible database through `DATABASE_URL`.

## Docker

Docker users can run NeonFlux with the published GHCR images for the bot and web app.

See [Docs/Docker.md](Docs/Docker.md) for the Docker Compose guide.
