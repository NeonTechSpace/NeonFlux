# Convex Self-Hosting Guide

This guide is for running Convex yourself instead of using a hosted Convex deployment.

NeonFlux uses Convex as its durable runtime store. This guide covers optional self-hosted Convex infrastructure.

## Defaults

- Prefer hosted Convex unless self-hosting is required.
- Stack: Convex backend, Convex dashboard, dedicated Convex Postgres.
- Postgres default: `postgres:17-alpine`. Convex docs say Postgres 17 is tested.
- Postgres 18 is unvalidated until Convex documents support or this repo records a passing smoke test.
- Do not share the NeonFlux app database with Convex.
- Do not add new durable NeonFlux app domains to Convex without an ownership, lifecycle, retention, deletion, and rollback plan.

## Convex Runtime Config

Runtime-facing values:

```dotenv
CONVEX_URL=
VITE_CONVEX_URL=
NEONFLUX_AUTH_JWT_ISSUER=
NEONFLUX_AUTH_JWT_AUDIENCE=neonflux-convex
NEONFLUX_AUTH_JWT_JWKS=
NEONFLUX_AUTH_JWT_PRIVATE_KEY=
```

Deployment-facing values:

```dotenv
CONVEX_DEPLOYMENT=
CONVEX_DEPLOY_KEY=
```

`CONVEX_DEPLOY_KEY` is for deploy/codegen automation only and must not be exposed to browser code.

Convex-backed runtime and deploy commands fail fast through `requireConvexConfig` when required connection/auth values are missing.

## Convex Deployment Link

Run deployment commands from `projects`.

Required local values before codegen or deploy:

```dotenv
CONVEX_DEPLOYMENT=
CONVEX_DEPLOY_KEY=
NEONFLUX_AUTH_JWT_ISSUER=
NEONFLUX_AUTH_JWT_AUDIENCE=neonflux-convex
NEONFLUX_AUTH_JWT_JWKS=
```

`NEONFLUX_AUTH_JWT_ISSUER` is the stable `iss` claim for NeonFlux-issued Convex JWTs. It is separate from Fluxer OAuth URLs and does not need to be publicly fetchable when `NEONFLUX_AUTH_JWT_JWKS` is set.

Prefer `NEONFLUX_AUTH_JWT_JWKS=data:application/json,...` with the public JWKS for local dev and deployment. Convex deploy/codegen environments should receive issuer, audience, and public JWKS only. `NEONFLUX_AUTH_JWT_PRIVATE_KEY` stays server-only for web, bot, and service signing.

Generate a new server-only signing key if this environment does not already have one:

```sh
pnpm generate:convex-private-key
```

Store the output in `NEONFLUX_AUTH_JWT_PRIVATE_KEY`. Then generate the public JWKS data URI from the current server-only signing key:

```sh
pnpm --silent generate:convex-jwks
```

Dry-run the public Convex auth env update before applying it:

```sh
pnpm convex:configure-auth-env -- --issuer http://localhost:3000/auth --deployment <CONVEX_DEPLOYMENT>
```

For deployed environments, use that environment's stable NeonFlux issuer instead of `localhost`. This command only mutates Convex env when `--apply --confirm-apply-target <target>` is added and the confirmation target exactly matches the selected deployment. It sends issuer, audience, and public JWKS only. It does not send `NEONFLUX_AUTH_JWT_PRIVATE_KEY` to Convex.

Apply only after the dry-run output targets the intended deployment:

```sh
pnpm convex:configure-auth-env -- --issuer <stable-NeonFlux-issuer> --deployment <target> --apply --confirm-apply-target <target>
```

After target Convex env is updated, make the local shell or protected deploy environment use the same public auth values. Then validate and redeploy so `auth.config.ts` is evaluated with those values:

```sh
pnpm convex:validate-auth-config
pnpm convex:check-auth-env -- --compare-deploy-env
pnpm convex:deploy
```

For protected environments, set the same public auth values in protected environment variables and use the protected Convex deploy workflow instead of a local shell. After the deployment updates auth config, prove the target auth env is configured and run a bounded local/dev Convex check with:

```sh
pnpm convex:check-auth-env
pnpm convex:dev:once
```

`pnpm convex:check-auth-env` first checks required env names, then validates the public issuer, audience, and JWKS values without printing JWKS content. It rejects Fluxer-owned issuers and any public JWKS value that exposes private key parameters.

For GitHub codegen/deploy jobs, store `NEONFLUX_AUTH_JWT_ISSUER`, `NEONFLUX_AUTH_JWT_AUDIENCE`, and `NEONFLUX_AUTH_JWT_JWKS` as protected environment or repository variables. Keep only `CONVEX_DEPLOY_KEY` in secrets for Convex deploy automation.

Validate deploy/codegen auth config from the current process environment without reading local `.env` private signing material:

```sh
pnpm convex:validate-auth-config
```

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

The current codebase uses Convex for durable web and bot runtime state and removes old app Postgres and Drizzle infrastructure. Do not add dual DB runtime or Postgres fallback paths.

## Convex Auth Bridge

Fluxer OAuth remains the web login flow. After the existing web session is valid, NeonFlux issues short-lived Convex JWTs signed with `NEONFLUX_AUTH_JWT_PRIVATE_KEY`.

Fluxer-owned OAuth hosts such as `web.fluxer.app` are not valid NeonFlux JWT issuers. Use a NeonFlux issuer and configure Convex with the matching public JWKS through `NEONFLUX_AUTH_JWT_JWKS`. Convex auth config fails closed when JWT auth is enabled without that public JWKS value.

Optional public JWKS endpoint for diagnostics/compatibility:

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

This self-hosted stack is optional infrastructure research. Do not use it to move NeonFlux app data without a new, explicit data-movement plan.

For local or self-hosted experiments:

1. Stand up Convex as an isolated side stack.
2. Keep NeonFlux app data on the configured Convex runtime unless a new data-movement plan is approved.
3. Do not create new Postgres-owned app domains or dual-write paths.
4. Move any durable experiment data only after backup, restore, retention, deletion, and rollback are defined.
