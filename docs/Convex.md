# Convex Self-Hosting Guide

This guide is for running Convex yourself instead of using a hosted Convex deployment.

The current NeonFlux migration target is Convex. See `Research/convex-full-migration.md` for that migration plan.

## Defaults

- Prefer hosted Convex unless self-hosting is required.
- Stack: Convex backend, Convex dashboard, dedicated Convex Postgres.
- Postgres default: `postgres:17-alpine`. Convex docs say Postgres 17 is tested.
- Postgres 18 is unvalidated until Convex documents support or this repo records a passing smoke test.
- Do not share the NeonFlux app database with Convex.
- Do not move OAuth sessions, encrypted Fluxer tokens, deployment config, or bot bootstrap into Convex without a migration plan.

## Convex Migration Config

Runtime-facing values:

```dotenv
CONVEX_URL=
VITE_CONVEX_URL=
NEONFLUX_AUTH_JWT_ISSUER=
NEONFLUX_AUTH_JWT_AUDIENCE=neonflux-convex
NEONFLUX_AUTH_JWT_PRIVATE_KEY=
```

Deployment-facing values:

```dotenv
CONVEX_DEPLOYMENT=
CONVEX_DEPLOY_KEY=
```

`CONVEX_DEPLOY_KEY` is for deploy/codegen automation only and must not be exposed to browser code.

The current foundation keeps these optional until Convex-backed services or migration tooling need them. Use `requireConvexConfig` as the cutover/deploy gate.

## Convex Deployment Link

Run deployment commands from `projects`.

Required local values before codegen or deploy:

```dotenv
CONVEX_DEPLOYMENT=
CONVEX_DEPLOY_KEY=
NEONFLUX_AUTH_JWT_ISSUER=
NEONFLUX_AUTH_JWT_AUDIENCE=neonflux-convex
```

`NEONFLUX_AUTH_JWT_ISSUER` must be the public web auth origin that serves `/.well-known/jwks.json`.

Generate typed Convex API files:

```sh
pnpm convex:codegen
pnpm convex:typecheck
```

Check generated API drift in CI or another trusted environment:

```sh
pnpm convex:codegen:check
```

Deploy Convex functions only from the protected `Deploy Convex` GitHub workflow or an equivalent trusted operator shell:

```sh
pnpm convex:deploy
```

The current migration switches web and bot runtime to Convex before app Postgres and Drizzle are removed. The old app database stays only until cutover and removal gates are satisfied.

## Convex Auth Bridge

Fluxer OAuth remains the web login flow. After the existing web session is valid, NeonFlux issues short-lived Convex JWTs signed with `NEONFLUX_AUTH_JWT_PRIVATE_KEY`.

Public JWKS endpoint:

```text
/.well-known/jwks.json
```

Server-only browser token endpoint:

```text
/auth/convex/token
```

The token endpoint returns `{ token, expiresAt }`, sends `Cache-Control: no-store`, and derives manageable guild scope on the server. It must never expose Fluxer OAuth access tokens, refresh tokens, auth codes, cookies, encrypted payloads, or JWT private key material.

## Configuration

Use one Convex instance per project/environment.

```env
# Use latest only for local tests. Pin production.
CONVEX_REV=latest

# Database name is INSTANCE_NAME with "-" replaced by "_".
CONVEX_INSTANCE_NAME=neonflux-prod
CONVEX_POSTGRES_DB=neonflux_prod
CONVEX_INSTANCE_SECRET=<openssl rand -hex 32>

# Dedicated Postgres.
CONVEX_POSTGRES_USER=convex
CONVEX_POSTGRES_PASSWORD=<strong password>

# Browser-facing URLs.
CONVEX_CLOUD_ORIGIN=https://convex-api.example.com
CONVEX_SITE_ORIGIN=https://convex-site.example.com
NEXT_PUBLIC_DEPLOYMENT_URL=https://convex-api.example.com

# Local Docker Postgres is not TLS.
CONVEX_DO_NOT_REQUIRE_SSL=1
CONVEX_RUST_LOG=info

# Optional direct ports.
CONVEX_PORT=3210
CONVEX_SITE_PROXY_PORT=3211
CONVEX_DASHBOARD_PORT=6791
```

- `POSTGRES_URL` must not include the database name.
- `NEXT_PUBLIC_DEPLOYMENT_URL` must be browser-reachable.
- Keep `CONVEX_INSTANCE_SECRET` private. Rotating it invalidates admin keys/sessions.

Generate the instance secret:

```sh
openssl rand -hex 32
```

## Docker Compose

Use [projects/docker-compose.convex.yml](../projects/docker-compose.convex.yml).

For reverse-proxy-only deployments, remove `ports` and attach services to the proxy network.

| Public URL                     | Internal target  |
| ------------------------------ | ---------------- |
| `convex-api.example.com`       | `backend:3210`   |
| `convex-site.example.com`      | `backend:3211`   |
| `convex-dashboard.example.com` | `dashboard:6791` |

## Start

From `projects`:

```sh
docker compose -f docker-compose.convex.yml up -d
docker compose -f docker-compose.convex.yml logs backend
curl http://localhost:3210/version
docker compose -f docker-compose.convex.yml exec backend ./generate_admin_key.sh
```

Open `http://localhost:6791` and paste the admin key.

## Convex Project

In the Convex functions project:

```env
CONVEX_SELF_HOSTED_URL=https://convex-api.example.com
CONVEX_SELF_HOSTED_ADMIN_KEY=<generated admin key>
```

Use pnpm:

```sh
pnpm add convex
pnpm exec convex dev
pnpm exec convex deploy --env-file .env.local
```

Use `convex dev` for development and `convex deploy` for production-style deployment.

## Optional Storage

Default storage is Docker volumes. For file-heavy production, use Convex S3-compatible storage env vars. Switching storage providers requires export/import.

## Backup And Upgrade

Before upgrading:

```sh
pnpm exec convex export --path ./convex-backup.zip
```

Upgrade flow:

1. Stop external traffic.
2. Export data.
3. Save Convex env vars from dashboard or `convex env list`.
4. Upgrade backend and dashboard images together.
5. Watch backend migration logs.
6. Restore traffic.

Pin a known Convex image version/revision for production. Do not stay on mutable `latest`.

## Troubleshooting

| Problem                      | Check                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `BadAdminKey`                | Key came from this backend, `INSTANCE_SECRET` did not change, dashboard and CLI use the same backend. |
| Backend cannot find Postgres | `CONVEX_INSTANCE_NAME`, `CONVEX_POSTGRES_DB`, derived DB name, and `POSTGRES_URL` without DB name.    |
| Dashboard cannot connect     | `NEXT_PUBLIC_DEPLOYMENT_URL` is browser-reachable and proxy forwards API traffic to `3210`.           |
| HTTP actions fail            | Proxy forwards site/action traffic to `3211`. `CONVEX_SITE_ORIGIN` is the public site/action URL.     |
| Slow queries                 | Keep Convex backend and Postgres in the same region and as close as possible.                         |

## Self-Hosted Experiment Rule

This self-hosted stack is not the current NeonFlux migration target. Do not use it to move NeonFlux app data without the Convex migration runbook.

For local or self-hosted experiments:

1. Stand up Convex as an optional side stack.
2. Pick one dashboard live-data proof slice.
3. Choose Convex or existing Postgres as that domain's owner.
4. Avoid dual writes.
5. Move durable data only after backup, restore, retention, deletion, and rollback are defined.
