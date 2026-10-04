# Technology choices

This document is for contributors who change the toolchain, runtime, dependencies or delivery setup.
It records the selected technology, why it was selected, where each version is pinned and what remains planned.
Feature behavior and its limits are documented in [the bot guide](BOT.md) and [the backend guide](BACKEND.md)

## Selected stack

| Area | Selection |
| --- | --- |
| Bot SDK | [Fluxerly.js](https://github.com/NeonTechSpace/Fluxerly.js) as `@neontechspace/fluxerly` 1000.0.0-rc.6, through its `@neontechspace/fluxerly/effect` entry point |
| Runtime composition | Effect 4 |
| Language and modules | TypeScript 7 with ECMAScript modules in both packages |
| Runtime | Node.js 24 |
| Backend and database | Convex |
| Package manager | pnpm 12 workspace |
| Bot distribution (planned) | One bot Docker image on GitHub Container Registry (GHCR) |

## Bot

The bot runs on the SDK's native Effect lifecycle through `runBot`.
Command parsing uses the SDK's public `commands.parseQuoted` parser, with no separate command framework

The bot keeps one serialized `messageCreate` pipeline

The bot owns its Fluxer token and every provider operation.
It reads backend-owned types through the types-only `@neonflux/backend/contracts` export and validates every HTTP response at runtime, so no backend implementation code enters the bot's executable

## Backend

Convex owns the bot's durable state, separately from the bot image.
One deployment serves the bot's authenticated HTTP actions and scheduled cleanup, and Convex meets the requirement for self-hosting support.
Domain validation, reservations and retention live in Convex functions, while the bot keeps fresh platform permission reads and native writes.
Development targets a Convex cloud development deployment with a deployment-specific key and no CLI account login.
See [the backend guide](BACKEND.md) for setup and the HTTP contract

## Version ownership

- Node: The exact development version lives in [projects/.node-version](../projects/.node-version). The workspace manifest's `engines.node` keeps the supported major range, not a second exact pin
- pnpm: The exact version lives in `packageManager` in [projects/package.json](../projects/package.json). Use pnpm 12 without Corepack. Update the pin deliberately, regenerate the lockfile with that version and verify a frozen install
- Bot: The [bot manifest](../projects/bot/package.json) pins the SDK, Effect, TypeScript and Node type declarations. Keep Effect within the SDK's `effect` peer range, currently `^4.0.0`, and recheck it on every SDK upgrade
- Backend: The [backend manifest](../projects/backend/package.json) pins Convex, `convex-test`, TypeScript and Node type declarations
- Neither the bot nor the backend uses a TypeScript 6 compatibility alias
- Add a dependency only when code uses it, and keep project-specific dependencies in their project rather than the workspace root

## Build and check constraints

Test, typecheck, build and code generation scripts run through the [heavy-task gate](../projects/scripts/heavy.mjs).
It lets half as many of them run at once as the machine has logical threads, between one and four, across all terminals, and queues the rest.
`NEONFLUX_HEAVY_SLOTS` overrides the limit, CI runs use every thread and nested scripts reuse the slot they already hold.
Gated TypeScript compiles run with `--singleThreaded`, and Node's test runner uses one worker per package

Effect 4.0.0's declarations reference the browser-only global `TextDecoderOptions` type.
The bot's [compatibility declaration](../projects/bot/src/effect-compat.d.ts) derives that type from Node's `TextDecoder`, which keeps strict checking without adding browser libraries.
Remove it once an Effect release no longer needs it

## Planned

- Bot container image: One Docker image published to GHCR, with build and release automation
- Public documentation pages: Fumadocs with MDX. These dependencies are not installed
