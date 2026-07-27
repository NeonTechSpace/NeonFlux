# Convex Operations Guide

NeonFlux uses Convex as its only durable application database and as the live dashboard transport. Hosted Convex is the default. The self-hosted stack at the end of this guide is optional.

Run workspace commands from `projects`.

## Environment ownership

Copy `.env.example` to `.env` and keep the application configuration there. NeonFlux's config loader searches upward for `.env` and does not load `.env.local`.

Convex tooling may generate the ignored `.env.local` file when linking a development deployment. That file follows Convex CLI convention. It is not NeonFlux's application source of truth. Keep `CONVEX_DEPLOYMENT`, `CONVEX_URL`, `CONVEX_SITE_URL`, and `VITE_CONVEX_URL` in `.env`, and remove conflicting duplicate values instead of maintaining two configurations.

Connection values:

```dotenv
CONVEX_DEPLOYMENT=
CONVEX_DEPLOY_KEY=
CONVEX_URL=
CONVEX_SITE_URL=
VITE_CONVEX_URL=
```

- `CONVEX_URL` is used by server-side bot and web clients.
- `CONVEX_SITE_URL` is the deployment HTTP Actions origin.
- `VITE_CONVEX_URL` is browser-safe and powers dashboard subscriptions.
- `CONVEX_DEPLOY_KEY` is a deployment secret. Do not expose it to browser code.

## Three isolated JWT providers

Convex auth has three custom RS256 providers. Configuration is all-or-nothing: if any provider value expresses auth intent, every bot, web, and user issuer/audience/JWKS value must be valid. The three issuers must be distinct and cannot be Fluxer-owned hosts.

```dotenv
NEONFLUX_BOT_AUTH_JWT_ISSUER=
NEONFLUX_BOT_AUTH_JWT_AUDIENCE=neonflux-convex-bot
NEONFLUX_BOT_AUTH_JWT_JWKS=
NEONFLUX_BOT_AUTH_JWT_PRIVATE_KEY=

NEONFLUX_WEB_AUTH_JWT_ISSUER=
NEONFLUX_WEB_AUTH_JWT_AUDIENCE=neonflux-convex-web
NEONFLUX_WEB_AUTH_JWT_JWKS=
NEONFLUX_WEB_AUTH_JWT_PRIVATE_KEY=

NEONFLUX_USER_AUTH_JWT_ISSUER=
NEONFLUX_USER_AUTH_JWT_AUDIENCE=neonflux-convex-user
NEONFLUX_USER_AUTH_JWT_JWKS=
NEONFLUX_USER_AUTH_JWT_PRIVATE_KEY=
```

Choose stable, distinct NeonFlux issuer URLs. The issuer is a JWT identity string. Only the web user's public JWKS endpoint is exposed for browser-token verification compatibility.

Generate one private key for each provider:

```sh
pnpm generate:convex-private-key
pnpm generate:convex-private-key
pnpm generate:convex-private-key
```

Assign the outputs to the bot, web, and user private-key variables, then generate each public JWKS data URI:

```sh
pnpm --silent generate:convex-jwks bot
pnpm --silent generate:convex-jwks web
pnpm --silent generate:convex-jwks user
```

The generator reads the matching issuer, audience, and private key from `.env`. Put each output in its matching `*_JWKS` variable.

Convex receives only the three public tuples: issuer, audience, and JWKS. Private JWT keys, `SESSION_SECRET`, `FLUXER_BOT_TOKEN`, `FLUXER_CLIENT_SECRET`, and `FLUXER_TOKEN_ENCRYPTION_KEY` remain application secrets.

## Runtime boundaries

- The bot signs bot-service JWTs for bot-scoped Convex functions.
- The web server signs web-service JWTs for its Convex functions.
- After validating the session and current Fluxer permissions, the web server issues a short-lived user JWT scoped to manageable guild ids at `/auth/convex/token`.
- `/.well-known/jwks.json` exposes the user provider's public JWKS only.
- The internal bot-read service verifies a short-lived web-service JWT. This lets web request live Fluxer structure without receiving the bot token.

The production Compose environment gives `FLUXER_BOT_TOKEN` only to the bot container. The web config loader also removes that variable before reading local web configuration.

## Configure a target

First validate the current public auth values without contacting Convex:

```sh
pnpm convex:validate-auth-config
```

Dry-run the nine public auth values against an explicit deployment:

```sh
pnpm convex:configure-auth-env -- --deployment <target>
```

The command reads all provider values from `.env`. It does not accept the old single-provider `--issuer` argument. Apply only after the output names the intended target:

```sh
pnpm convex:configure-auth-env -- --deployment <target> --apply --confirm-apply-target <target>
```

The apply path strips all three private keys from the child Convex process. It refuses an ambient target and refuses a confirmation string that differs from the selected deployment.

Verify the configured target and, for deploy environments, compare it with the current protected process environment:

```sh
pnpm convex:check-auth-env -- --deployment <target>
pnpm convex:check-auth-env -- --deployment <target> --compare-deploy-env
```

The readiness check validates values without printing JWKS payloads. It rejects missing providers, duplicate/Fluxer issuers, malformed public RSA keys, and any JWKS containing private parameters.

## Historical retention

`NEONFLUX_DATA_RETENTION_DAYS` defaults to `90` and accepts whole numbers from `1` through `730`. It governs the Convex-owned growth-history and historical audit/Blueprint drains.

Dry-run and apply it with the same explicit-target fence:

```sh
pnpm convex:configure-runtime-env -- --deployment <target>
pnpm convex:configure-runtime-env -- --deployment <target> --apply --confirm-apply-target <target>
```

Invalid values fail before a delete. Daily jobs use bounded transactions and continue until each eligible range is empty. Completed Blueprint history is deleted child-first. Active, paused, reconciliation-required, and outcome-unknown executions are protected.

Authentication-state and dashboard-posting cleanup use their own lifecycle-specific retention policies.

## Capacity and deployment choice

Hosted Convex provides managed operation with selectable capacity. Self-hosting removes hosted monthly quotas, but it remains bounded by the operator's hardware, Convex engine limits, backup and upgrade practices, and operational expertise. Choose between them from measured workload rather than an assumed quota tier.

Blueprint snapshots and plan authority are stored as cold, integrity-bound chunks and loaded only by operations that require the full artifact. Summary and History reads use metadata-only records. Hosted and self-hosted deployments execute the same authorization, validation, canonical parsing, and digest-verification path. NeonFlux does not provide a security-reducing low-resource mode.

Review the current [Convex limits](https://docs.convex.dev/production/state/limits) and [self-hosting guidance](https://docs.convex.dev/self-hosting) when sizing an installation.

## Code generation and deploy

The wrapper validates public auth configuration before `dev`, `codegen`, or `deploy`, and strips every private JWT key before spawning the Convex CLI.

```sh
pnpm convex:codegen
pnpm convex:typecheck
pnpm convex:codegen:check
```

Deploy from a trusted operator shell with the exact target identified and the required deployment credentials loaded:

```sh
pnpm convex:deploy
```

For development, `pnpm dev` runs one checked Convex upload before starting all watchers. A bounded one-shot upload is also available:

```sh
pnpm convex:dev:once
```

## Guarded data reset

`pnpm convex:reset-data` builds an empty snapshot from the current schema and imports it with `--replace-all`. Non-dry-run execution requires an explicit deployment and `--yes`. Only the exact default `--deployment dev` target is exempt from `--confirm-production-reset`. Named, cross-project, and production targets require the extra confirmation because their environment cannot be inferred safely from a name.

```sh
pnpm convex:reset-data -- --deployment dev --dry-run
pnpm convex:reset-data -- --deployment dev --yes

pnpm convex:reset-data -- --prod --confirm-production-reset --dry-run
pnpm convex:reset-data -- --prod --confirm-production-reset --yes
```

The wrapper rejects `--deployment local` and does not infer a destructive target from ambient Convex state. Upload current functions and schema before a development reset so the deployment and generated snapshot agree.

This unreleased schema uses the current cold-artifact format directly and has no compatibility reader. An existing non-ephemeral deployment therefore requires an explicit, operator-approved data reset before a coordinated Convex, bot, and web rollout.

## Optional self-hosting

Use one isolated Convex instance per NeonFlux environment. The optional stack is [`projects/docker-compose.convex.yml`](../projects/docker-compose.convex.yml) and contains:

- the Convex backend.
- the Convex dashboard.
- dedicated PostgreSQL 17 storage used only by Convex.

Do not share this PostgreSQL database with a separate application store or add a dual-write fallback.

```dotenv
# Pin production. Latest is suitable only for local evaluation.
CONVEX_REV=latest

CONVEX_INSTANCE_NAME=neonflux-prod
CONVEX_POSTGRES_DB=neonflux_prod
CONVEX_INSTANCE_SECRET=<openssl rand -hex 32>

CONVEX_POSTGRES_USER=convex
CONVEX_POSTGRES_PASSWORD=<strong password>

CONVEX_CLOUD_ORIGIN=https://convex-api.example.com
CONVEX_SITE_ORIGIN=https://convex-site.example.com
NEXT_PUBLIC_DEPLOYMENT_URL=https://convex-api.example.com

CONVEX_DO_NOT_REQUIRE_SSL=1
CONVEX_RUST_LOG=info

CONVEX_PORT=3210
CONVEX_SITE_PROXY_PORT=3211
CONVEX_DASHBOARD_PORT=6791
```

`POSTGRES_URL` in the Compose stack deliberately omits a database name. Convex derives the configured database from the instance name. `NEXT_PUBLIC_DEPLOYMENT_URL` must be browser-reachable. Keep `CONVEX_INSTANCE_SECRET` private because rotating it invalidates admin keys and sessions.

Start the optional stack from `projects`:

```sh
docker compose -f docker-compose.convex.yml up -d
docker compose -f docker-compose.convex.yml logs backend
curl http://localhost:3210/version
docker compose -f docker-compose.convex.yml exec backend ./generate_admin_key.sh
```

Open the dashboard at the configured dashboard port and paste the generated admin key. Configure the NeonFlux `.env` connection URLs for this deployment, then use the same guarded auth/runtime configuration and deployment workflow described above.

For reverse-proxy-only deployments, remove public Compose ports and attach the services to the proxy network:

| Public origin     | Internal target  |
| ----------------- | ---------------- |
| Convex API        | `backend:3210`   |
| HTTP Actions/site | `backend:3211`   |
| Convex dashboard  | `dashboard:6791` |

## Backup and upgrade

Before upgrading a self-hosted deployment:

```sh
pnpm exec convex export --path ./convex-backup.zip
```

Then:

1. stop external traffic.
2. export data and save Convex environment values.
3. upgrade backend and dashboard images together.
4. watch migration logs.
5. restore traffic only after health checks pass.

Pin a known Convex revision in production. Moving durable data between hosted and self-hosted targets requires an explicit backup, restore, retention, deletion, and rollback plan.
