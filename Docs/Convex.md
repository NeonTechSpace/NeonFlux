# Convex Self-Hosting Guide

Run Convex yourself instead of using Convex Cloud.

## Defaults

- Prefer Convex Cloud unless self-hosting is required.
- Stack: Convex backend, Convex dashboard, dedicated Convex Postgres.
- Postgres default: `postgres:17-alpine`. Convex docs say Postgres 17 is tested.
- Postgres 18 is unvalidated until Convex documents support or this repo records a passing smoke test.
- Do not share the NeonFlux app database with Convex.
- Do not move OAuth sessions, encrypted Fluxer tokens, deployment config, or bot bootstrap into Convex without a migration plan.

## Configuration

Use one Convex instance per project/environment.

```env
# Use latest only for local tests; pin production.
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

Use [Projects/docker-compose.convex.yml](../Projects/docker-compose.convex.yml).

For reverse-proxy-only deployments, remove `ports` and attach services to the proxy network.

| Public URL | Internal target |
| --- | --- |
| `convex-api.example.com` | `backend:3210` |
| `convex-site.example.com` | `backend:3211` |
| `convex-dashboard.example.com` | `dashboard:6791` |

## Start

From `Projects`:

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

| Problem | Check |
| --- | --- |
| `BadAdminKey` | Key came from this backend, `INSTANCE_SECRET` did not change, dashboard and CLI use the same backend. |
| Backend cannot find Postgres | `CONVEX_INSTANCE_NAME`, `CONVEX_POSTGRES_DB`, derived DB name, and `POSTGRES_URL` without DB name. |
| Dashboard cannot connect | `NEXT_PUBLIC_DEPLOYMENT_URL` is browser-reachable and proxy forwards API traffic to `3210`. |
| HTTP actions fail | Proxy forwards site/action traffic to `3211`; `CONVEX_SITE_ORIGIN` is the public site/action URL. |
| Slow queries | Keep Convex backend and Postgres in the same region and as close as possible. |

## NeonFlux Migration Rule

Do not move all NeonFlux data to Convex at once.

Recommended path:

1. Stand up Convex as an optional side stack.
2. Pick one dashboard live-data proof slice.
3. Choose Convex or existing Postgres as that domain's owner.
4. Avoid dual writes.
5. Migrate durable data only after backup, restore, retention, deletion, and rollback are defined.
