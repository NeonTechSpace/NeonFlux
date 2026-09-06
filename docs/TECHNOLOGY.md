# Technology choices

This document records the selected direction for rebuilding NeonFlux.
The repository contains compiler and workspace configuration only.
Application dependencies, backend functions, the website, image builds, and release automation are not implemented

## Bot and backend

| Area | Selected direction |
| --- | --- |
| Bot SDK | [Fluxerly.js](https://github.com/NeonTechSpace/Fluxerly.js), using `@neontechspace/fluxerly` |
| Bot language | TypeScript 7 |
| Module format | ECMAScript modules (ESM) |
| Runtime | Node.js 24 |
| Runtime composition | Effect |
| Backend | Convex |
| Distribution | One bot Docker image on GitHub Container Registry (GHCR) |

Use Fluxerly's Effect-native entry point when implementing the bot and verify compatibility with its selected Effect version.
The SDK dependency and a usable connection lifecycle must be available before a connected bot can be implemented.
Keep application dependencies uninstalled until code uses them

The bot owns its Fluxer token and provider operations.
Convex owns durable application state, separately from the bot image.
Define authorization, data lifecycle, and recovery around the first actual persisted feature rather than restoring the former schema

## Website

The future website provides public documentation and an authenticated dashboard.
Retain React 19, TanStack Start and Router, Vite, Nitro, Tailwind CSS, Fumadocs with MDX, and TanStack Query as its core stack.
Select compatible versions when recreating it.
No website dependencies or implementation remain in this workspace

The bot's TypeScript 7 requirement is independent of any future website tooling compatibility exception.
Website hosting and packaging remain undecided.
Dashboard authorization belongs at a trusted server or backend boundary, and bot credentials never belong in the website or browser

## Version ownership

The exact development Node version lives in [projects/.node-version](../projects/.node-version).
Keep the supported major range in the workspace manifest's `engines.node`, not a second exact runtime pin

The exact pnpm version lives in [projects/package.json](../projects/package.json) under `packageManager`.
Use pnpm 12 without Corepack.
Update the exact pin deliberately, regenerate the lockfile with that version, and verify a frozen install.
This workspace uses an exact package-manager pin rather than a floating `devEngines.packageManager` range

The bot manifest pins TypeScript 7 and Node type declarations directly.
The bot does not use a TypeScript 6 compatibility alias

## Planned container build

Add the Dockerfile and a repository-owned image command only when a real bot entry point exists.
Use `projects/` as the build context and define the bot's production build command, output, dependencies, assets, and entry point explicitly.
The command must read and validate `.node-version` before invoking Docker Buildx

The selected build sequence is:

1. Run the implemented project checks before any registry login or publication
2. Use `docker/dockerfile:1` and pass the exact Node pin as required `NODE_VERSION`, without a Dockerfile default
3. Build from `node:${NODE_VERSION}-bookworm-slim` and install pnpm from the workspace manifest's `packageManager`
4. Copy package metadata and any required workspace resolution inputs before application source
5. Populate `/pnpm/store` with `pnpm fetch --frozen-lockfile --store-dir /pnpm/store`
6. Install offline from that store with the frozen lockfile, then compile the bot with TypeScript 7 inside Docker
7. Assemble the bot with `pnpm --filter @neonflux/bot --prod deploy /prod/bot`
8. Copy the portable production directory into a clean runtime stage using the same Node base and run emitted JavaScript directly as the non-root `node` user

Docker owns the production artifact even when host-side checks also build it.
Use modern [pnpm deploy](https://pnpm.io/cli/deploy), enabling `injectWorkspacePackages: true` when introducing deployment.
Define the package's included files and verify that built workspace dependencies reach the portable directory.
Keep development dependencies, compiler tools, pnpm, local environment files, and source-only resolution out of the runtime image

Use a `.dockerignore` scoped to the build context to exclude dependencies, local credentials, temporary files, coverage, and existing build output.
Convex remains external, and the bot receives runtime credentials only when launched.
Use BuildKit secret mounts for any required build-time authentication

### Cache and release boundaries

Use the exportable fetch layer described in [pnpm's Docker guidance](https://pnpm.io/docker).
Do not mount a cache over its populated store.
Start with local BuildKit caching and add one registry cache only when another builder needs it.
Serialize writes to a shared cache reference and keep untrusted writers out of trusted caches.
The [GitHub Actions cache backend](https://docs.docker.com/build/ci/github-actions/cache/) requires a workflow context and is not part of this configuration-only baseline

Build only deployed architectures.
Before releasing, pin the base image to a reviewed digest and add source, revision, and version labels, provenance, and an SBOM.
Validate the real container entry point, production dependencies, failures, and bounded shutdown.
Verify publication by pulling and running the published digest.
Choose ports and health checks from actual runtime needs rather than adding a placeholder server

No packages have been released.
Image publication and GitHub workflows require separate implementation and authorization
