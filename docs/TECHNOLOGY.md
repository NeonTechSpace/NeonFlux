# Technology choices

This document is for contributors who change the toolchain, runtime, dependencies or delivery setup.
It records the selected technology, why it was selected, where each version is pinned and what remains planned.
Feature behavior and its limits are documented in [the bot guide](BOT.md), [the backend guide](BACKEND.md) and [the dashboard guide](WEB.md)

## Selected stack

| Area | Selection |
| --- | --- |
| Bot SDK | [Fluxerly.js](https://github.com/NeonTechSpace/Fluxerly.js) as `@neontechspace/fluxerly` 1000.0.0-rc.7, through its `@neontechspace/fluxerly/effect` entry point |
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
Multi-server mode is sized for a public bot on one shared client.
Event handlers run eight at a time with the SDK's guild partitioning, so events from one server stay in order while other servers proceed.
The SDK REST limits are six API slots, two media slots, a queue of 256 requests and 4 MiB of queued JSON, which leaves room for many servers without unbounded queueing.
The SDK's automatic sharding counts the bot's servers at connect and uses one shard per 2,000, below Fluxer's limit of 2,500 servers per shard.
Server runtimes start four at a time, so a restart does not start every server against the backend at once

The bot owns its Fluxer token and every provider operation.
It reads backend-owned types through the types-only `@neonflux/backend/contracts` export and validates every HTTP response at runtime, so no backend implementation code enters the bot's executable.
Selective backup encryption uses Node's built-in `node:crypto` with AES-256-GCM, without a compression or archive dependency

### Background work dispatch

Background workers run only when there is work. One dispatcher per bot process sends `POST /service/work` every five seconds, and the backend answers which servers have due work for each worker from bounded reads of global indexes. The dispatcher then wakes only those servers' workers. Failed polls back off from 10 seconds to at most five minutes. Greetings, role reactions and level credits stay event driven. See [the backend guide](BACKEND.md#background-work-dispatch) for the route

Before, every server runtime polled on timers. The dashboard worker sent four job reads every five seconds, web verification, when the website is configured, one read every five seconds, events two reads a minute, and schedules, birthdays and anniversaries, suggestions, message cleanup, metadata logs and level rewards one read a minute each. Each bot request runs one HTTP action and one Convex query or mutation

| Cost per day | Before | After |
| --- | --- | --- |
| Idle server | 97,920 requests, which ran 195,840 Convex functions: 69,120 dashboard, 17,280 verification, 2,880 event and 8,640 other worker reads | None from these workers |
| Whole bot | 97,920 requests for every served server | 17,280 dispatcher requests, which run 34,560 Convex functions, whatever the number of servers, plus worker requests for due work |

## Backend

Convex owns durable state that the bot and dashboard share, separately from the bot image.
One deployment serves the bot's authenticated HTTP actions, the dashboard's live subscriptions and scheduled cleanup, and Convex meets the requirement for self-hosting support.
Domain validation, reservations and retention live in Convex functions, while the bot keeps fresh platform permission reads and native writes.
Development targets a Convex cloud development deployment with a deployment-specific key and no CLI account login.
See [the backend guide](BACKEND.md) for setup and the HTTP contract

## Website

The website hosts the authenticated configuration dashboard and the web verification page.
OAuth client credentials stay on the web server, provider tokens stay private in Convex and the browser holds only an opaque, revocable session capability.
Dashboard authorization belongs to the trusted server and backend, and bot credentials never reach the website or browser.
Cloudflare Turnstile gates verification starts through server-side token validation in Convex, without another package dependency.
The motion challenge is drawn on a browser canvas from backend-generated frames, as described in [the challenge evaluation guide](CAPTCHA.md).
Keep the website visually plain until the selected bot features work.
See [the dashboard guide](WEB.md) for setup

## Version ownership

- Node: The exact development version lives in [projects/.node-version](../projects/.node-version). The workspace manifest's `engines.node` keeps the supported major range, not a second exact pin
- pnpm: The exact version lives in `packageManager` in [projects/package.json](../projects/package.json). Use pnpm 12 without Corepack. Update the pin deliberately, regenerate the lockfile with that version and verify a frozen install
- Bot: The [bot manifest](../projects/bot/package.json) pins the SDK, Effect, TypeScript and Node type declarations. Keep Effect within the SDK's `effect` peer range, currently `^4.0.0`, and recheck it on every SDK upgrade
- Backend: The [backend manifest](../projects/backend/package.json) pins Convex, `convex-test`, TypeScript and Node type declarations
- Website: The [web manifest](../projects/web/package.json) pins every website dependency, including its own Convex client
- Neither the bot nor the backend uses a TypeScript 6 compatibility alias
- Add a dependency only when code uses it, and keep project-specific dependencies in their project rather than the workspace root

## Build and check constraints

Test, typecheck, build, code generation and challenge evaluation scripts run through the [heavy-task gate](../projects/scripts/heavy.mjs).
It lets half as many of them run at once as the machine has logical threads, between one and four, across all terminals, and queues the rest.
`NEONFLUX_HEAVY_SLOTS` overrides the limit, CI runs use every thread and nested scripts reuse the slot they already hold.
Gated TypeScript compiles run with `--singleThreaded`, and Node's test runner uses one worker per package

Web source checking is strict, with `skipLibCheck` in the web package only, for Nitro's optional provider declarations

Effect 4.0.0's declarations reference the browser-only global `TextDecoderOptions` type.
The bot's [compatibility declaration](../projects/bot/src/effect-compat.d.ts) derives that type from Node's `TextDecoder`, which keeps strict checking without adding browser libraries.
Remove it once an Effect release no longer needs it

## Planned

- Bot container image: One Docker image published to GHCR, with build and release automation
- Website hosting and packaging: Not selected yet
- Public documentation pages: Fumadocs with MDX. These dependencies are not installed
