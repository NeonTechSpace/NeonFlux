# Technology choices

This document is for contributors who change the toolchain, runtime, dependencies or delivery setup.
It records the selected technology, why it was selected, where each version is pinned and what remains planned

## Selected stack

| Area | Selection |
| --- | --- |
| Bot SDK | [Fluxerly.js](https://github.com/NeonTechSpace/Fluxerly.js) as `@neontechspace/fluxerly` 1000.0.0-rc.6, through its `@neontechspace/fluxerly/effect` entry point |
| Runtime composition | Effect 4 |
| Language and modules | TypeScript 7 with ECMAScript modules |
| Runtime | Node.js 24 |
| Backend and database | Convex |
| Package manager | pnpm 12 workspace |
| Bot distribution (planned) | One bot Docker image on GitHub Container Registry (GHCR) |

## Version ownership

- Node: The exact development version lives in [projects/.node-version](../projects/.node-version). The workspace manifest's `engines.node` keeps the supported major range, not a second exact pin
- pnpm: The exact version lives in `packageManager` in [projects/package.json](../projects/package.json). Use pnpm 12 without Corepack. Update the pin deliberately, regenerate the lockfile with that version and verify a frozen install
- Add a dependency only when code uses it, and keep project-specific dependencies in their project rather than the workspace root

## Planned

- Bot container image: One Docker image published to GHCR, with build and release automation
- Public documentation pages: Fumadocs with MDX. These dependencies are not installed
