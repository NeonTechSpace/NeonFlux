# Contributing to NeonFlux

This project is unreleased, but changes still need to be safe, reviewable, and tested against the behavior they touch.

Run commands from `projects` unless a section says otherwise.

## Checks every change needs

First, run the smallest relevant check while working. Examples:

```sh
pnpm --filter neonflux-web test
pnpm --filter neonflux-bot test
pnpm --filter @neonflux/blueprint test
pnpm --filter @neonflux/messaging test
```

Before handing off a change, run the complete workspace check:

```sh
pnpm check
```

It checks formatting, lint rules, Convex types, TypeScript, forbidden migration-era compatibility code, unused code, unit tests, and production builds.

If a relevant check cannot run on your machine, say exactly which check was skipped and why. Do not replace it with a weaker check and call the result equivalent.

## After changing web routes

Regenerate the route file, then verify that only the expected generated output changed:

```sh
pnpm --filter neonflux-web generate-routes
pnpm --filter neonflux-web build
```

Do not edit `apps/web/src/routeTree.gen.ts` by hand.

## Browser checks when Chromium is available

Install the Playwright browser once:

```sh
pnpm --filter neonflux-web exec playwright install chromium
```

Run the public browser tests:

```sh
pnpm test:e2e:web
```

These open the built web app in Chromium and check public pages plus sign-in boundaries.

## Signed-in feature checks when Docker and Chromium are available

```sh
pnpm build:runtime-packages
pnpm --filter neonflux-web exec playwright install chromium
pnpm --filter neonflux-web e2e:authenticated
```

This command starts one temporary self-hosted Convex instance, then runs:

1. Convex code generation and a check that generated files are committed.
2. signed-in service tests for message delivery and Server Blueprint workers.
3. signed-in browser tests for the real dashboard screens.

The service tests use a fake Fluxer boundary, so they never send a real message or change a real server. The command removes its containers, volumes, generated credentials, and fixture files when it finishes.

Do not point these tests at a shared or cloud Convex deployment.

## Production-container checks when Docker is available

From `projects`:

```sh
docker build --target bot -t neonflux-bot:local .
docker build --target web -t neonflux-web:local .
```

These builds catch missing workspace packages and runtime files. CI also runs no-network import checks inside both images.

Docker checks are extra when Docker is unavailable locally. `pnpm check` is still required.

## Safety rules

- Never commit `.env` files, private signing keys, session secrets, token-encryption keys, OAuth secrets, bot tokens, or generated test credentials.
- Never reset a Convex deployment without identifying the exact target and obtaining explicit approval.
- Keep the bot token inside the bot service.
- Preserve explicit uncertain outcomes. Do not turn them into automatic retries.
- Keep generated files owned by their generators.

For local configuration, read [Local setup](docs/Local-Setup.md). For the system boundaries, read [How NeonFlux works](docs/How-NeonFlux-Works.md).
