# Local setup

This guide gets the bot and web dashboard running from a fresh checkout.

## Requirements

- Node 24.18.0
- pnpm 11
- a Fluxer application with an OAuth client and bot token
- a Convex deployment for normal development

Docker is optional. It is only needed for the temporary local Convex test environment and production-container checks.

## Install

From the repository root:

```sh
cd projects
pnpm install
cp .env.example .env
```

On PowerShell:

```powershell
Copy-Item .env.example .env
```

`projects/.env` is the application configuration file. The Convex command-line tool may also create an ignored `.env.local`, but NeonFlux does not read application secrets from it.

## Create local secrets

Preview what the setup command would create:

```sh
pnpm setup:dev
```

Write the missing local values:

```sh
pnpm setup:dev -- --write
```

The command preserves existing values and creates:

- the web session secret.
- the OAuth-token encryption key.
- separate signing keys for the bot, web server, and signed-in browser user.

It never prints those secrets. Add the Fluxer application ID, OAuth client secret, and bot token yourself.

## Check Convex configuration

These commands inspect configuration without changing a deployment:

```sh
pnpm convex:validate-auth-config
pnpm convex:configure-auth-env -- --deployment <target>
pnpm convex:configure-runtime-env -- --deployment <target>
```

Applying values requires both `--apply` and the exact target name:

```sh
pnpm convex:configure-auth-env -- --deployment <target> --apply --confirm-apply-target <target>
pnpm convex:configure-runtime-env -- --deployment <target> --apply --confirm-apply-target <target>
pnpm convex:check-auth-env -- --deployment <target> --compare-deploy-env
```

Read [Convex](Convex.md) before changing, resetting, or self-hosting a deployment.

## Start NeonFlux

```sh
pnpm dev
```

This checks and uploads Convex functions once, then starts Convex development tooling, the bot, and the web app.

For isolated work:

```sh
pnpm dev:bot
pnpm dev:web
```

The public website can run with only the web process. The signed-in dashboard needs working Convex authentication and the bot for live Fluxer access.

## Before sharing a change

Run the required checks described in [CONTRIBUTING.md](../CONTRIBUTING.md).
