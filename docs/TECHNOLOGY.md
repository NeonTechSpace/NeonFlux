# Technology choices

This document is for contributors who change the toolchain, runtime, dependencies or delivery setup.
It records the selected technology, why it was selected, where each version is pinned and what remains planned.
Feature behavior and its limits are documented in [the bot guide](BOT.md), [the backend guide](BACKEND.md) and [the dashboard guide](WEB.md)

## Selected stack

| Area | Selection |
| --- | --- |
| Bot SDK | [Fluxerly.js](https://github.com/NeonTechSpace/Fluxerly.js) as `@neontechspace/fluxerly` 1000.0.0-nightly.20261021.25, through its `@neontechspace/fluxerly/effect` entry point |
| Runtime composition | Effect 4 |
| Language and modules | TypeScript 7 with ECMAScript modules in all four packages |
| Runtime | Node.js 24 |
| Backend and database | Convex, which the bot reaches with the Convex client library |
| Website | React 19, TanStack Start, TanStack Router, TanStack Query, Vite 8, Nitro 3 beta and Tailwind CSS 4 |
| Package manager | pnpm 12 workspace |
| Bot distribution (planned) | One bot Docker image on GitHub Container Registry (GHCR) |

## Bot

The bot runs on the SDK's native Effect lifecycle through `runBot`, with background workers as scoped Effect fibers
rather than a separate scheduler.
Command parsing uses the SDK's public `commands.parseQuoted` parser, with no separate command framework

Single-server mode keeps one serialized `messageCreate` pipeline.
Multi-server mode is sized for a public bot on one shared client.
Event handlers run eight at a time with the SDK's guild partitioning, so events of one type from one server stay in
order while other servers proceed.
The SDK REST limits are six API slots, two media slots, a queue of 256 requests and 4 MiB of queued JSON, which leaves
room for many servers without unbounded queueing.
The SDK's automatic sharding counts the bot's servers at connect and uses one shard per 2,000, below Fluxer's limit of
2,500 servers per shard.
Server runtimes start four at a time, at startup and on later joins alike, so a restart or a burst of joins does not
start every server against the backend at once.
A starting server's events wait in the SDK's per-server queue through the `partitionReady` hook of the
guild-partitioned handlers. Each routed event name holds up to 2,000 waiting events instead of the SDK's default 256, and
the event that a server availability frame carries has a 1 GiB byte limit instead of 4 MiB, because the SDK
counts it at the size of the whole frame

The bot owns its Fluxer token and every provider operation.
It decodes every backend answer with the [shared contracts](#shared-contracts) and takes its types from them, so no backend implementation code enters the bot's executable.
The bot calls the backend's public functions with the `convex` package, the same exact version as the backend and website. Requests use its HTTP client, one per request, so each keeps its own abort signal and five-second timeout, and mutations skip that client's queue so concurrent requests still run in parallel. The WebSocket client would run every mutation of the process one after another, so the bot uses it only for its one work signal subscription. Node 24 provides the global `WebSocket` it uses. The package also brings its own command-line dependencies, such as `esbuild` and `prettier`, into the bot's install, which matters for the planned container image

Selective backup encryption uses Node's built-in `node:crypto` with AES-256-GCM, without a compression or archive dependency

### Background work dispatch

Background workers run only when there is work. One dispatcher per bot process asks the backend which servers have due work for each worker, from bounded reads of global indexes, and wakes only those servers' workers. It does not poll on a short interval. It asks at startup, at once when the backend's work signal changes, at the next due time a dispatch or a mutation answer reports, and otherwise every two minutes. Passes start at least three seconds apart, full pages are read back to back up to ten per pass, and failures back off from 10 seconds to at most five minutes, with one early try per backoff when the work signal changes. Greetings, role reactions and level credits stay event driven. See [the backend guide](BACKEND.md#background-work-dispatch) for the signal and the due times

Each bot request is one billed Convex function call. The bot's functions check a key derived from the bot secret themselves, so no HTTP action runs in front of them

Idle counts below are computed from the code, not measured, and exclude worker requests for work that is due

| Billed Convex calls per day | Count |
| --- | --- |
| Idle server | None |
| Idle bot | About 721: 720 safety passes and the work signal's first read, plus one more pass and read after each restart or reconnect |
| Worker request for due work | 1 |
| Busiest dispatch | At most 28,800 passes of one call each, plus extra pages and one signal read for each change of the work signal |

## Shared contracts

The [contracts package](../projects/contracts/) `@neonflux/contracts` holds one Effect Schema for every request and answer that passes between the bot and the backend.
The backend decodes each bot request with its schema, which refuses unknown keys, and the bot decodes each answer with its schema, so each data shape is written once and both sides check it.
Both take their TypeScript types from the schemas. Rules that need stored state, such as authorization, freshness and uniqueness, stay in the backend's functions.
The package exports its TypeScript source as `@neonflux/contracts/<module>`, with no build step. Node runs it through type stripping, Convex bundles it into the backend functions and Vite bundles it for the website.
Node does not strip types in files under `node_modules`, so the planned bot image must build or bundle the package rather than copy its source there

## Backend

Convex owns durable state that the bot and dashboard share, separately from the bot image.
One deployment serves the bot's key-checked functions and work signal, the dashboard's live subscriptions and scheduled cleanup, and Convex meets the requirement for self-hosting support.
Domain validation, reservations and retention live in Convex functions, while the bot keeps fresh platform permission reads and native writes.
Development targets a Convex cloud development deployment with a deployment-specific key and no CLI account login.
See [the backend guide](BACKEND.md) for setup and the bot's function contract

## Website

The website hosts the authenticated configuration dashboard and the web verification page.
The OAuth client secret stays on the web server, while the Convex deployment owns the application ID and the website origin. Provider tokens stay private in Convex and the browser holds only an opaque, revocable session capability.
Dashboard authorization belongs to the trusted server and backend, and bot credentials never reach the website or browser.
Cloudflare Turnstile gates verification starts through server-side token validation in Convex, without another package dependency.
The motion challenge is drawn on a browser canvas from backend-generated frames, as described in [the challenge evaluation guide](CAPTCHA.md).
See [the dashboard guide](WEB.md) for setup

## Version ownership

- Node: The exact development version lives in [projects/.node-version](../projects/.node-version). The workspace manifest's `engines.node` keeps the supported major range, not a second exact pin
- pnpm: The exact version lives in `packageManager` in [projects/package.json](../projects/package.json). Use pnpm 12 without Corepack. Update the pin deliberately, regenerate the lockfile with that version and verify a frozen install
- Shared versions: The `catalog` in the [workspace configuration](../projects/pnpm-workspace.yaml) pins Convex, Effect and TypeScript once, and every package that uses them names `catalog:`. Convex must match because both sides of the bot's function calls and the website's come from it, Effect because each side decodes with the schema values the contracts build, and TypeScript because the Effect typecheck needs an `@effect/tsgo` release that supports the version every package checks with. Keep Effect within the SDK's `effect` peer range, currently `^4.0.0`, and recheck it on every SDK upgrade
- Bot: The [bot manifest](../projects/bot/package.json) pins the SDK and Node type declarations, and takes Effect, TypeScript and the Convex client from the catalog
- Backend: The [backend manifest](../projects/backend/package.json) pins `convex-test` and Node type declarations, and takes Convex, Effect and TypeScript from the catalog
- Contracts: The [contracts manifest](../projects/contracts/package.json) takes Effect and TypeScript from the catalog
- `@effect/tsgo` must support the pinned TypeScript version. Its release notes list the versions each release supports
- Website: The [web manifest](../projects/web/package.json) pins every other website dependency and takes its Convex client and TypeScript from the catalog
- Workspace tools: The [workspace manifest](../projects/package.json) pins Prettier, which formats every package, and `@effect/tsgo`, which the Effect typecheck runs
- Add a dependency only when code uses it, and keep project-specific dependencies in their project rather than the workspace root

## Build and check constraints

Test, typecheck, build, code generation and challenge evaluation scripts run through the [heavy-task gate](../projects/scripts/heavy.mjs).
It lets half as many of them run at once as the machine has logical threads, between one and four, across all terminals, and queues the rest.
`NEONFLUX_HEAVY_SLOTS` overrides the limit, CI runs use every thread and nested scripts reuse the slot they already hold.
The gate passes each argument to its command unchanged, and `--shell` runs one command line through the shell instead. On POSIX the command runs in its own process group, so stopping the gate stops every process the command started before the slot is freed. A slot held by a run that crashed or was killed frees itself, so no manual cleanup is needed.
Gated TypeScript compiles run with `--singleThreaded`, and Node's test runner uses one worker per package

Prettier formats the workspace with the settings in [projects/.prettierrc.json](../projects/.prettierrc.json): 120 characters a line, four spaces, LF line endings and no semicolons. `pnpm run format` rewrites files, and `pnpm run format:check`, the first step of `pnpm run check`, fails on unformatted ones. Prettier reads only the workspace's own `.gitignore`, so [projects/.prettierignore](../projects/.prettierignore) adds the generated files git tracks and the files the package `.gitignore` files list, such as the website's build output

Web source checking is strict, with `skipLibCheck` in the web package only, for Nitro's optional provider declarations

Typechecks of the bot, backend and contracts also report the Effect language service's diagnostics, which each package turns on as a plugin in its `tsconfig.json`. `@effect/tsgo` ships a TypeScript 7 build with those rules, and their typecheck scripts run it through [effect-tsc.mjs](../projects/scripts/effect-tsc.mjs) instead of `tsc`. Nothing in `node_modules` is changed, so `tsc` stays the plain TypeScript the bot's build and the website use. Effect errors and warnings fail a typecheck, and the `schemaNumber` rule is raised to a warning, so schemas keep to finite numbers. Editors show the Effect diagnostics, suggestions included, only after `pnpm --filter @neonflux/contracts exec effect-tsgo patch --typescript` in `projects/` puts the Effect build in place of the workspace's TypeScript binary. The same command with `unpatch` restores the original

Effect 4.0.0's declarations reference the browser-only global `TextDecoderOptions` type.
The bot's [compatibility declaration](../projects/bot/src/effect-compat.d.ts) derives that type from Node's `TextDecoder`, which keeps strict checking without adding browser libraries.
Remove it once an Effect release no longer needs it

## Planned

- Bot container image: One Docker image published to GHCR, with build and release automation. It must build or bundle the [shared contracts](#shared-contracts)
- Website hosting and packaging: Not selected yet
- Public documentation pages: Fumadocs with MDX. These dependencies are not installed
