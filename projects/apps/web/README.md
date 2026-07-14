# NeonFlux web

The web application owns Fluxer OAuth, signed sessions, public documentation, dashboard authorization, and the guild-scoped dashboard UI. Convex is its durable database and live-query transport.

Run workspace commands from `projects`, not this package directory, unless a command explicitly uses the package filter.

## Development

Start the full Convex, bot, and web development stack:

```sh
pnpm dev
```

Start only web after building shared runtime packages:

```sh
pnpm dev:web
```

Web alone is sufficient for the public homepage and documentation. Authenticated dashboard flows require configured Convex auth and the bot: the bot bootstraps deployment state and owns live Fluxer provider reads.

The workspace reads application values from `projects/.env`. The Convex CLI may create ignored `.env.local` deployment metadata, but NeonFlux's config loader does not use it as the application source of truth.

## Implemented routes

Public and authentication routes:

- `/`
- `/docs/*`
- `/auth/fluxer/login`
- `/auth/fluxer/callback`
- `/auth/convex/token`
- `/.well-known/jwks.json`

Dashboard routes:

- `/dashboard`
- `/dashboard/$guildId`
- `/dashboard/$guildId/general/command-prefix`
- `/dashboard/$guildId/messaging/message-builder`
- `/dashboard/$guildId/events/audit-events`
- `/dashboard/$guildId/structure/current`
- `/dashboard/$guildId/structure/backups`
- `/dashboard/$guildId/structure/compare`
- `/dashboard/$guildId/structure/deploy`
- `/dashboard/$guildId/structure/runs`

Category index routes redirect to their implemented leaf. Unknown guild subroutes render the route-not-found state. There are no shipped roadmap-placeholder feature routes.

## Async and bundle ownership

The guild route owns authorization, selected-guild identity, stable dashboard navigation, target pending identity, and the authenticated guild context. It must not statically import feature implementations.

Each leaf route directly imports its own feature entry and owns its query cache, mutations, local loading/error/empty/refreshing states, and optional heavy tools. Static feature identity and controls render independently from unresolved data islands. Cached data remains visible while background reads refresh.

Server Blueprint has a small guild-scoped runtime for genuinely cross-surface state: request coalescing, active execution progress, deliberate deploy/compare handoff, and the workspace shell. Current, Backups, Compare, Deploy, and Runs remain separate route chunks and query owners.

Intent navigation acknowledges clicks in the stable shell. Pending states preserve known guild and feature identity rather than replacing the page with a broad skeleton. Retry controls enter a visible busy state and are locally scoped.

## Bot-owned provider reads

The web runtime never uses the Fluxer bot token. Live structure reads are sent to the internal bot-read service with a short-lived web-service JWT. The bot validates that token, enforces bounded concurrent reads and a provider deadline, and reads through its existing gateway client.

`loadWebConfig` explicitly removes `FLUXER_BOT_TOKEN`, and the production web container is not given that variable.

## Routes and production builds

TanStack Router generates `src/routeTree.gen.ts`. Do not edit it manually.

```sh
pnpm --filter neonflux-web generate-routes
pnpm --filter neonflux-web typecheck
```

The production build includes an automatic bundle-boundary check:

```sh
pnpm --filter neonflux-web build
```

The guard inspects emitted client chunks. It rejects static guild-shell access to feature leaves, Blueprint runtime access to leaf surfaces, sibling-feature coupling, eagerly included optional explorer/diff/chart tools, React development JSX, absolute source paths, and entries beyond accepted size ceilings.

## Validation

```sh
pnpm --filter neonflux-web format:check
pnpm --filter neonflux-web lint
pnpm --filter neonflux-web typecheck
pnpm --filter neonflux-web test
pnpm --filter neonflux-web build
```

Public production-built browser tests run from the workspace root:

```sh
pnpm test:e2e:web
```

Use `pnpm check` for the complete workspace gate.

## Production

Build all workspace outputs:

```sh
pnpm build
```

The web package emits a Nitro Node server at `apps/web/.output/server/index.mjs`. The workspace start wrapper runs that artifact:

```sh
node scripts/start-web.mjs
```

Docker deployment is documented in the root [Docker guide](../../../docs/Docker.md).
