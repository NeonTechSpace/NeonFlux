<h1 align="center">NeonFlux</h1>

<h3 align="center">A Fluxer bot with a protected, Convex-backed web dashboard</h3>

<div align="center">

[![CI](https://img.shields.io/github/actions/workflow/status/NeonTechSpace/NeonFlux/ci.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=fff&labelColor=0B1221&color=237DBE&label=CI)](https://github.com/NeonTechSpace/NeonFlux/actions/workflows/ci.yml)

</div>

NeonFlux is an unreleased work in progress. This README lists implemented runtime surfaces rather than roadmap features.

## Implemented surfaces

The bot currently provides:

- installation reconciliation for single- and multi-instance deployments.
- configurable prefix, help, ping, and mention responses.
- replay-safe message activity and member-join tracking, invite attribution, and explicitly at-least-once member-leave tracking.
- a bounded, best-effort telemetry queue that cannot block command routing.
- durable dashboard message delivery through a bot-owned worker.
- server-structure observation, backups, drift checks, and reviewed Blueprint execution.

The authenticated dashboard currently ships these guild routes:

- Overview.
- Messaging → Message Builder.
- General Settings → Command Prefix.
- Events & Logs → Audit Events.
- Server Blueprint → Overview, Backups, Compare, Deploy, and Runs.

Unlisted dashboard features are not implemented routes.

## Workspace

The pnpm workspace lives in `projects`:

- `apps/bot`: Fluxer gateway process, provider reads, and bot-owned workers.
- `apps/web`: OAuth, sessions, public docs, and the protected dashboard.
- `convex`: the only durable application database and live-query functions.
- `packages/config`: environment parsing and runtime boundaries.
- `packages/convex`: scoped Convex JWT/client helpers.
- `packages/db`: the bot/web persistence contract.
- `packages/core`: shared domain policy.
- `packages/fluxer`: Fluxer clients and provider adapters.

## Local setup

Use Node 24.18.0 and pnpm 11 from `projects`.

```sh
cd projects
pnpm install
cp .env.example .env
```

On PowerShell, use `Copy-Item .env.example .env`.

`projects/.env` is the application source of truth. Convex CLI setup may create the ignored `.env.local` file for its own deployment metadata. NeonFlux's config loader searches for `.env`, not `.env.local`. Keep the complete application configuration in `.env` and avoid maintaining conflicting duplicate values.

Generate the session and OAuth-token encryption secrets once per environment:

```sh
pnpm generate:session-secret
pnpm generate:token-encryption-key
```

### Convex authentication

Convex authenticates three isolated JWT providers:

| Provider    | Used by                                                | Default audience       |
| ----------- | ------------------------------------------------------ | ---------------------- |
| Bot service | Bot-to-Convex calls                                    | `neonflux-convex-bot`  |
| Web service | Web-to-Convex calls and the internal bot-read boundary | `neonflux-convex-web`  |
| User        | Browser live subscriptions after server authorization  | `neonflux-convex-user` |

Each provider needs a distinct issuer and RSA key pair. Run the private-key generator three times and assign one output to each of `NEONFLUX_BOT_AUTH_JWT_PRIVATE_KEY`, `NEONFLUX_WEB_AUTH_JWT_PRIVATE_KEY`, and `NEONFLUX_USER_AUTH_JWT_PRIVATE_KEY`.

```sh
pnpm generate:convex-private-key
pnpm generate:convex-private-key
pnpm generate:convex-private-key
```

After the three private keys, audiences, and distinct issuers are in `.env`, derive their public JWKS values:

```sh
pnpm --silent generate:convex-jwks bot
pnpm --silent generate:convex-jwks web
pnpm --silent generate:convex-jwks user
```

Store each result in the matching `*_JWKS` variable. Convex receives the three issuer/audience/public-JWKS tuples. It must never receive a private JWT key, the Fluxer bot token, OAuth secrets, session secrets, or token-encryption keys.

Validate the local public configuration and dry-run the selected Convex target:

```sh
pnpm convex:validate-auth-config
pnpm convex:configure-auth-env -- --deployment <target>
pnpm convex:configure-runtime-env -- --deployment <target>
```

The configure commands read `.env`. They mutate nothing without `--apply`, an explicit deployment, and an exact confirmation target:

```sh
pnpm convex:configure-auth-env -- --deployment <target> --apply --confirm-apply-target <target>
pnpm convex:configure-runtime-env -- --deployment <target> --apply --confirm-apply-target <target>
pnpm convex:check-auth-env -- --deployment <target> --compare-deploy-env
```

See [the Convex guide](docs/Convex.md) for the complete target, deployment, retention, and self-hosting workflow.

### Run development

The complete development stack builds shared runtime packages, uploads/checks Convex functions once, then starts Convex, bot, and web watchers:

```sh
pnpm dev
```

For isolated work:

```sh
pnpm dev:bot
pnpm dev:web
```

The public homepage and docs can render with the web process alone. Authenticated dashboard behavior needs configured Convex auth and the bot process: the bot bootstraps deployment state and owns live Fluxer provider reads.

## Security boundaries

- The Fluxer bot token belongs to the bot runtime. The web config loader removes it, and the production web container is not given it.
- Live provider reads go through the bot-owned internal HTTP service. It accepts short-lived web-service JWTs, is loopback-only in direct development, and is private to the Compose network in Docker.
- Browser Convex tokens are short-lived user tokens whose manageable-guild scope is derived server-side. Token and JWKS responses are non-secret public/auth boundaries. OAuth credentials and private signing material are never returned.
- Provider mutations use explicit retry and unknown-outcome policy. Non-idempotent actions are not blindly replayed after an ambiguous response.

## Data lifecycle

`NEONFLUX_DATA_RETENTION_DAYS` configures historical growth, audit, and completed Blueprint workflow retention. It defaults to 90 days and accepts integers from 1 through 730. Convex-owned daily jobs drain expired rows in bounded batches. Active, paused, reconciliation-required, and outcome-unknown Blueprint executions are protected.

Message activity uses durable `(guildId, messageId)` receipts before incrementing aggregates. Member joins deduplicate by membership identity. Fluxer member-leave callbacks do not expose a reliable event identity, so leaves remain explicitly at-least-once and can overcount if the provider redelivers them.

Growth ingestion is best effort: four writes may run concurrently and at most 1,000 more are queued. Overload, shutdown, or persistence failure is logged without blocking the primary bot event path.

## Reset Convex data

The reset wrapper replaces every table in the selected deployment with an empty schema-shaped snapshot. It is destructive and refuses ambient non-dry-run targets.

Push current functions/schema before resetting a development deployment:

```sh
pnpm convex:dev:once
pnpm convex:reset-data -- --deployment dev --dry-run
pnpm convex:reset-data -- --deployment dev --yes
```

Production additionally requires the explicit production acknowledgement:

```sh
pnpm convex:reset-data -- --prod --confirm-production-reset --dry-run
pnpm convex:reset-data -- --prod --confirm-production-reset --yes
```

The wrapper rejects `--deployment local`. A manually created local Convex deployment must be operated with the Convex CLI directly.

## Web architecture and validation

The dashboard keeps guild authorization, selected-guild identity, and stable navigation in parent shells. Each shipped leaf route owns its feature code, query cache, mutations, local loading/error state, and optional heavy tools. Static feature chrome remains visible while the smallest unresolved data island loads. Confirmed data stays visible during background refresh.

After route changes, regenerate the TanStack route tree and run the production build:

```sh
pnpm --filter neonflux-web generate-routes
pnpm --filter neonflux-web build
```

The web build automatically runs the dashboard bundle-boundary guard. It rejects shell-to-leaf and sibling-feature static imports, unexpected optional-tool reachability, development JSX in production chunks, absolute source paths, and entry chunks beyond the accepted ceilings.

Run the complete workspace validation with:

```sh
pnpm check
```

## Docker

Use [the Docker guide](docs/Docker.md) and [`projects/.env.example`](projects/.env.example). The app stack is [`projects/docker-compose.yml`](projects/docker-compose.yml). Optional self-hosted Convex infrastructure is [`projects/docker-compose.convex.yml`](projects/docker-compose.convex.yml).
