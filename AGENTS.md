# Repository navigation

When locating code or documentation, or deciding where a file belongs, read [the repository guide](docs/REPOSITORY.md)

Before changing the toolchain, runtime, dependencies, or delivery setup, read [technology choices](docs/TECHNOLOGY.md)

Before changing code or documentation, read [the contributing guide](docs/CONTRIBUTING.md). It lists the checks, the documentation style and every place a new feature or table must be registered

# Checks

Run commands from `projects/`. `pnpm run check` is the gate every change passes, with no credentials or network connection. While working, the faster steps are:

| Step | Command |
| --- | --- |
| Formatting | `pnpm run format`, then `pnpm run format:check` |
| Lint and repository scans | `pnpm run lint` |
| One package | `pnpm --filter @neonflux/bot run check`, or `backend`, `contracts` or `web` in place of `bot` |
| One test file | See [the contributing guide](docs/CONTRIBUTING.md#prepare-and-check) |

A lint finding is fixed in the code. When a rule is wrong for one line, an `oxlint-disable-next-line <rule> -- <reason>` comment names why, and an unused disable comment fails the lint
