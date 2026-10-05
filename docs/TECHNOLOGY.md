# Technology choices

This document is for contributors who change the toolchain, runtime, dependencies or delivery setup.
It records the selected technology, why it was selected, where each version is pinned and what remains planned.
Feature behavior and its limits are documented in [the bot guide](BOT.md), [the backend guide](BACKEND.md) and [the dashboard guide](WEB.md)

## Selected stack

| Area | Selection |
| --- | --- |
| Bot SDK | [Fluxerly.js](https://github.com/NeonTechSpace/Fluxerly.js) as `@neontechspace/fluxerly` 1000.0.0-rc.6, through its `@neontechspace/fluxerly/effect` entry point |
| Runtime composition | Effect 4 |
| Language and modules | TypeScript 7 with ECMAScript modules in all three packages |
| Runtime | Node.js 24 |
| Backend and database | Convex |
| Website | React 19, TanStack Start, TanStack Router, TanStack Query, Vite 8, Nitro 3 beta and Tailwind CSS 4 |
| Package manager | pnpm 12 workspace |
| Bot distribution (planned) | One bot Docker image on GitHub Container Registry (GHCR) |

## Bot

The bot runs on the SDK's native Effect lifecycle through `runBot`, with background workers as scoped Effect fibers rather than a separate scheduler.
Command parsing uses the SDK's public `commands.parseQuoted` parser, with no separate command framework

Single-server mode keeps one serialized `messageCreate` pipeline.
Multi-server mode uses the SDK's guild partitioning with a concurrency of two over one shared client, and sets the SDK REST limits to four API slots, one media slot, a queue of 64 requests and 4 MiB of queued JSON

The bot owns its Fluxer token and every provider operation.
It decodes every HTTP response with the [shared contracts](#shared-contracts) and takes its types from them, so no backend implementation code enters the bot's executable.
Selective backup encryption uses Node's built-in `node:crypto` with AES-256-GCM, without a compression or archive dependency

## Shared contracts

The [contracts package](../projects/contracts/) `@neonflux/contracts` holds one Effect Schema for every request and answer that passes between the bot and the backend.
The backend decodes each bot request with its schema, which refuses unknown keys, and the bot decodes each answer with its schema, so each data shape is written once and both sides check it.
Both take their TypeScript types from the schemas. Rules that need stored state, such as authorization, freshness and uniqueness, stay in the backend's functions.
The package exports its TypeScript source as `@neonflux/contracts/<module>`, with no build step. Node runs it through type stripping, Convex bundles it into the backend functions and Vite bundles it for the website.
Node does not strip types in files under `node_modules`, so the planned bot image must build or bundle the package rather than copy its source there

## Backend

Convex owns durable state that the bot and dashboard share, separately from the bot image.
One deployment serves the bot's authenticated HTTP actions, the dashboard's live subscriptions and scheduled cleanup, and Convex meets the requirement for self-hosting support.
Domain validation, reservations and retention live in Convex functions, while the bot keeps fresh platform permission reads and native writes.
Development targets a Convex cloud development deployment with a deployment-specific key and no CLI account login.
See [the backend guide](BACKEND.md) for setup and the HTTP contract

## Website

The website hosts the authenticated configuration dashboard and the web verification page.
The OAuth client secret stays on the web server, while the Convex deployment owns the application ID and the website origin. Provider tokens stay private in Convex and the browser holds only an opaque, revocable session capability.
Dashboard authorization belongs to the trusted server and backend, and bot credentials never reach the website or browser.
Cloudflare Turnstile gates verification starts through server-side token validation in Convex, without another package dependency.
The motion challenge is drawn on a browser canvas from backend-generated frames, as described in [the challenge evaluation guide](CAPTCHA.md).
Keep the website visually plain until the selected bot features work.
See [the dashboard guide](WEB.md) for setup

## Version ownership

- Node: The exact development version lives in [projects/.node-version](../projects/.node-version). The workspace manifest's `engines.node` keeps the supported major range, not a second exact pin
- pnpm: The exact version lives in `packageManager` in [projects/package.json](../projects/package.json). Use pnpm 12 without Corepack. Update the pin deliberately, regenerate the lockfile with that version and verify a frozen install
- Shared versions: The `catalog` in the [workspace configuration](../projects/pnpm-workspace.yaml) pins Convex and Effect once, and every package that uses them names `catalog:`. Convex must match because both sides of the website's function calls come from it, and Effect because each side decodes with the schema values the contracts build. Keep Effect within the SDK's `effect` peer range, currently `^4.0.0`, and recheck it on every SDK upgrade
- Bot: The [bot manifest](../projects/bot/package.json) pins the SDK, TypeScript and Node type declarations, and takes Effect from the catalog
- Backend: The [backend manifest](../projects/backend/package.json) pins `convex-test`, TypeScript and Node type declarations, and takes Convex and Effect from the catalog
- Contracts: The [contracts manifest](../projects/contracts/package.json) pins TypeScript and takes Effect from the catalog
- Website: The [web manifest](../projects/web/package.json) pins every other website dependency and takes its Convex client from the catalog
- Neither the bot nor the backend uses a TypeScript 6 compatibility alias
- Add a dependency only when code uses it, and keep project-specific dependencies in their project rather than the workspace root

## Build and check constraints

Test, typecheck, build, code generation and challenge evaluation scripts run through the [heavy-task gate](../projects/scripts/heavy.mjs).
It lets half as many of them run at once as the machine has logical threads, between one and four, across all terminals, and queues the rest.
`NEONFLUX_HEAVY_SLOTS` overrides the limit, CI runs use every thread and nested scripts reuse the slot they already hold.
The gate passes each argument to its command unchanged, and `--shell` runs one command line through the shell instead. On POSIX the command runs in its own process group, so stopping the gate stops every process the command started before the slot is freed. Each gate creates a lock file under a name used only once and keeps it only when no other live lock for that slot exists afterwards. A lock whose holder has died, or that the gate has seen stand still for 45 seconds, is deleted by its own name.
Gated TypeScript compiles run with `--singleThreaded`, and Node's test runner uses one worker per package

Web source checking is strict, with `skipLibCheck` in the web package only, for Nitro's optional provider declarations

Effect 4.0.0's declarations reference the browser-only global `TextDecoderOptions` type.
The bot's [compatibility declaration](../projects/bot/src/effect-compat.d.ts) derives that type from Node's `TextDecoder`, which keeps strict checking without adding browser libraries.
Remove it once an Effect release no longer needs it

## Planned

- Bot container image: One Docker image published to GHCR, with build and release automation. It must build or bundle the [shared contracts](#shared-contracts)
- Website hosting and packaging: Not selected yet
- Public documentation pages: Fumadocs with MDX. These dependencies are not installed
