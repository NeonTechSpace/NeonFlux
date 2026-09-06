# Repository guide

Use this guide to locate files and prepare the development toolchain.
NeonFlux has configuration only, with no application source, backend schema, website, or container build

## File ownership

The repository root holds the [license](../LICENSE), agent navigation, and shared editor settings.
Repository documentation belongs in this directory, including the public [README](README.md).
The README is a regular file, with no root copy or symlink

The development workspace is [projects/](../projects/).
Its [manifest](../projects/package.json), [workspace configuration](../projects/pnpm-workspace.yaml), and generated [lockfile](../projects/pnpm-lock.yaml) own shared dependency management.
The [Node version file](../projects/.node-version) owns the exact development runtime

The private [bot package](../projects/bot/package.json) owns its compiler dependencies and [TypeScript configuration](../projects/bot/tsconfig.json).
Its configured source and output locations are `src/` and `dist/`, relative to the bot package.
Create source and tests when implementing the bot, and let the compiler create build output

Reserve `projects/backend/` for a future Convex project with its functions under `convex/`.
Reserve `projects/web/` for the future documentation website and dashboard.
Neither project exists yet

Keep one-consumer code in its owning project.
Introduce shared packages only for demonstrated shared responsibilities.
Project-specific dependencies belong in their project rather than the workspace root.
Update this guide when ownership or navigation changes

## Prepare the toolchain

Use the Node version recorded in `projects/.node-version` and an installed pnpm 12 bootstrap.
Run the following from `projects/`

```sh
pnpm install --frozen-lockfile
pnpm --version
pnpm --filter @neonflux/bot exec tsc --version
```

pnpm selects the exact version in the workspace manifest.
The bot compiler must report TypeScript 7.
These commands install and identify tooling, not validate an application

There are no application build, test, development, deployment, or aggregate check commands yet.
No source files exist for the configured compiler input.
Add real commands and proportional checks with the first implementation rather than placeholder scripts

## Generated and local files

Regenerate the lockfile through pnpm when dependency inputs change, then review the result and verify a frozen install.
Dependency installations and compiler output remain ignored through [workspace ignore rules](../projects/.gitignore).
Keep ignore rules at workspace or project scope, not in a root `.gitignore`.
Use Git's local `.git/info/exclude` for repository-root machine files.
Keep credentials and machine-local configuration out of version control

See [technology choices](TECHNOLOGY.md) for the selected stack and the future Docker build contract
