# Repository guide

This guide is for contributors who need to find documentation, decide where a new file belongs or prepare the development toolchain.
For the selected stack and version pins, see [technology choices](TECHNOLOGY.md)

## Layout

| Path | Contents |
| --- | --- |
| Repository root | The [license](../LICENSE), the `AGENTS.md` navigation file and shared editor and Git attribute settings |
| `docs/` | All repository documentation, including the public [README](README.md). The README is a regular file, with no root copy or symlink |
| [projects/](../projects/) | The pnpm development workspace |
| [projects/bot/](../projects/bot/) | The Fluxer bot package `@neonflux/bot`, with its manifest and [TypeScript configuration](../projects/bot/tsconfig.json) |

The workspace [manifest](../projects/package.json), [workspace configuration](../projects/pnpm-workspace.yaml) and generated [lockfile](../projects/pnpm-lock.yaml) own shared dependency management.
The [Node version file](../projects/.node-version) owns the exact development runtime

## Prepare the toolchain

Install the Node version in `projects/.node-version` and a pnpm 12 bootstrap, then run the following from `projects/`

```sh
pnpm install --frozen-lockfile
```

pnpm selects the exact version pinned in the workspace manifest.
There are no build, check, deployment or container commands yet

## Generated and local files

- Regenerate the lockfile through pnpm when dependency inputs change, review it and verify a frozen install
- Dependency installs, compiler output, build caches and private `.env` files stay ignored through the [workspace ignore rules](../projects/.gitignore)
- Keep ignore rules at workspace scope, not in a root `.gitignore`. Use Git's local `.git/info/exclude` for repository-root machine files
