# Repository guide

This guide is for contributors who need to find code or documentation, decide where a new file belongs or prepare the development toolchain.
For the selected stack and version pins, see [technology choices](TECHNOLOGY.md)

## Layout

| Path | Contents |
| --- | --- |
| Repository root | The [license](../LICENSE), the `AGENTS.md` navigation file and shared editor and Git attribute settings |
| `docs/` | All repository documentation, including the public [README](README.md). The README is a regular file, with no root copy or symlink |
| [projects/](../projects/) | The pnpm development workspace |
| [projects/bot/](../projects/bot/) | The Fluxer bot package `@neonflux/bot` |
| [projects/backend/](../projects/backend/) | The Convex backend package `@neonflux/backend` |
| [projects/scripts/](../projects/scripts/) | The [heavy-task gate](../projects/scripts/heavy.mjs) that limits concurrent machine-heavy package scripts |

The workspace [manifest](../projects/package.json), [workspace configuration](../projects/pnpm-workspace.yaml) and generated [lockfile](../projects/pnpm-lock.yaml) own shared dependency management.
The [Node version file](../projects/.node-version) owns the exact development runtime

## Bot package

- `src/` holds the bot source. [main.ts](../projects/bot/src/main.ts) starts the process, [config.ts](../projects/bot/src/config.ts) reads the environment and [bot.ts](../projects/bot/src/bot.ts) builds the SDK lifecycle, gateway routing and serial message pipeline
- [server-scope.ts](../projects/bot/src/server-scope.ts) parses single-server or explicit multi-server scope, and [server-runtime.ts](../projects/bot/src/server-runtime.ts) binds one runtime and its backend adapters to each server
- `tests/` holds the bot tests, which use the SDK's in-memory transport
- `scripts/` holds the opt-in [live smoke script](../projects/bot/scripts/smoke-live.ts). The test compiler checks it and Node runs it directly. [smoke-live.example.json](../projects/bot/smoke-live.example.json) shows its configuration, and the private local copy stays ignored
- [tsconfig.json](../projects/bot/tsconfig.json) compiles `src/` into `dist/`, and [tsconfig.test.json](../projects/bot/tsconfig.test.json) checks source, tests and scripts without emitting

## Backend package

- `convex/` holds the Convex functions. [schema.ts](../projects/backend/convex/schema.ts) owns every table, [http.ts](../projects/backend/convex/http.ts) owns the bot's authenticated HTTP entry points and [crons.ts](../projects/backend/convex/crons.ts) starts bounded retention cleanup
- `convex/_generated/` is created by the Convex CLI and kept in version control
- [contracts.d.ts](../projects/backend/contracts.d.ts) is a types-only export for the bot. It contains no runtime code or credentials
- `tests/` holds `convex-test` tests and `*-contract.test.ts` files that run the bot's HTTP adapters against an isolated backend fixture

## Find a feature

Each feature uses the same file prefix in both packages.
In the bot, `<prefix>-command.ts` owns command grammar, `-management.ts` owns management replies, `-permissions.ts` owns fresh native permission checks, `-store.ts` decodes backend HTTP responses and `-worker.ts` runs scoped background work.
In the backend, `<prefix>.ts` owns queries and mutations, `Domain.ts` owns validation, `Store.ts` owns state helpers and `Validators.ts` owns persisted shapes

| Feature | Bot `src/` prefix | Backend `convex/` prefix |
| --- | --- | --- |
| Bot foundation, AFK and responses | `bot`, `main`, `config`, `backend-http`, `protections`, `member-evidence`, `general-settings`, `afk`, `response`, `responses` | `schema`, `http`, `crons`, `validation`, `protection`, `generalSettings`, `afk`, `response`, `responses` |
| Moderation, automod, security and appeals | `moderation`, `safety-permissions`, `action-executor` | `moderation`, `appeals` |
| Publishing and scheduled publishing | `publishing`, `schedule`, `civil-calendar` | `publishing`, `schedules`, `civilDomain` |
| Role panels, rules and autorole | `role`, `roles` | `role`, `roles` |
| Welcome and goodbye | `welcome` | `greeting`, `greetings` |
| Tickets | `ticket`, `tickets` | `ticket`, `tickets` |
| Message leveling | `level`, `leveling` | `leveling` |
| Events, birthdays and suggestions | `event`, `events`, `milestone`, `suggestion` | `events`, `milestones`, `suggestions` |
| Message cleanup and metadata logs | `cleanup`, `metadata-log` | `cleanup`, `metadataLogs` |
| Selective backup | `backup` | `backup` |
| Multi-server scope | `server-scope`, `server-runtime` | `serverScope` |

Keep one-consumer code in its owning package, and introduce a shared package only for a demonstrated shared responsibility.
Update this guide when ownership or navigation changes

## Prepare the toolchain

Install the Node version in `projects/.node-version` and a pnpm 12 bootstrap, then run the following from `projects/`

```sh
pnpm install --frozen-lockfile
pnpm run check
```

pnpm selects the exact version pinned in the workspace manifest.
The aggregate check runs the backend checks, then the bot typecheck, build and tests.
Tests need no live credentials.
The opt-in live smoke runs separately through `pnpm run smoke:live` and is not part of the aggregate check

Use `pnpm run build` to compile the bot and `pnpm run start` to run the bot.
Each package has an `.env.example` file for its private `.env`.
See [the bot guide](BOT.md) and [the backend guide](BACKEND.md) for environment setup.
There are no deployment or container commands yet

## Generated and local files

- Regenerate the lockfile through pnpm when dependency inputs change, review it and verify a frozen install
- Regenerate `convex/_generated/` against a configured deployment after changing the backend schema or function interfaces, as described in [the backend guide](BACKEND.md)
- Dependency installs, compiler output, build caches and private `.env` files stay ignored through the [workspace ignore rules](../projects/.gitignore) and each package's own `.gitignore`
- Keep ignore rules at workspace or package scope, not in a root `.gitignore`. Use Git's local `.git/info/exclude` for repository-root machine files
- The [workspace configuration](../projects/pnpm-workspace.yaml) allows build scripts only for the reviewed `esbuild` version that Convex needs, and exempts the pinned SDK release from the minimum release age. Review a changed script or version before updating these entries
