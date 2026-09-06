# Technology choices

This document is for contributors who change the toolchain, runtime, dependencies or delivery setup.
It records the selected technology, why it was selected, where each version is pinned and what remains planned

## Selected stack

| Area | Selection |
| --- | --- |
| Bot SDK | [Fluxerly.js](https://github.com/NeonTechSpace/Fluxerly.js) as `@neontechspace/fluxerly`, through its `@neontechspace/fluxerly/effect` entry point |
| Runtime composition | Effect 4 |
| Language and modules | TypeScript 7 with ECMAScript modules |
| Runtime | Node.js 24 |
| Backend and database | Convex |
| Package manager | pnpm 12 workspace |
| Bot distribution (planned) | One bot Docker image on GitHub Container Registry (GHCR) |

## Version ownership

- Node: The exact development version lives in [projects/.node-version](../projects/.node-version). The workspace manifest's `engines.node` keeps the supported major range, not a second exact pin
- pnpm: The exact version lives in `packageManager` in [projects/package.json](../projects/package.json). Use pnpm 12 without Corepack. Update the pin deliberately, regenerate the lockfile with that version and verify a frozen install
- Workspace tools: The [workspace manifest](../projects/package.json) pins Prettier, which formats the workspace
- Add a dependency only when code uses it, and keep project-specific dependencies in their project rather than the workspace root

## Formatting

Prettier formats the workspace with the settings in [projects/.prettierrc.json](../projects/.prettierrc.json): 120 characters a line, four spaces, LF line endings and no semicolons. `pnpm run format` rewrites files, and `pnpm run format:check` fails on unformatted ones. Prettier reads only the workspace's own `.gitignore`, so [projects/.prettierignore](../projects/.prettierignore) adds the generated files git tracks

## Planned

- Bot container image: One Docker image published to GHCR, with build and release automation
- Public documentation pages: Fumadocs with MDX. These dependencies are not installed
