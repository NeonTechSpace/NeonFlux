# Repository guide

This guide is for contributors who need to find code or documentation, decide where a new file belongs or prepare the development toolchain.
For the selected stack and version pins, see [technology choices](TECHNOLOGY.md)

## Layout

| Path | Contents |
| --- | --- |
| Repository root | The [license](../LICENSE), the `AGENTS.md` navigation file and the Git attribute settings |
| `docs/` | All repository documentation, including the public [README](README.md). The README is a regular file, with no root copy or symlink |
| [projects/](../projects/) | The pnpm development workspace |
| [projects/bot/](../projects/bot/) | The Fluxer bot package `@neonflux/bot` |
| [projects/backend/](../projects/backend/) | The Convex backend package `@neonflux/backend` |
| [projects/contracts/](../projects/contracts/) | The shared contracts package `@neonflux/contracts` |
| [projects/scripts/](../projects/scripts/) | The [heavy-task gate](../projects/scripts/heavy.mjs) that limits concurrent machine-heavy package scripts, with [its test](../projects/scripts/heavy.test.mjs), and the [Effect typecheck runner](../projects/scripts/effect-tsc.mjs) |

The workspace [manifest](../projects/package.json), [workspace configuration](../projects/pnpm-workspace.yaml) and generated [lockfile](../projects/pnpm-lock.yaml) own shared dependency management.
The [Node version file](../projects/.node-version) owns the exact development runtime

## Bot package

- `src/` holds the bot source. [main.ts](../projects/bot/src/main.ts) starts the process, [config.ts](../projects/bot/src/config.ts) reads the environment and [bot.ts](../projects/bot/src/bot.ts) builds the SDK lifecycle, gateway routing and the serial message pipeline
- [server-scope.ts](../projects/bot/src/server-scope.ts) routes commands to the server of the scope, and [server-runtime.ts](../projects/bot/src/server-runtime.ts) adopts the backend's scope at startup and binds one runtime and its backend adapters to the server
- [backend-http.ts](../projects/bot/src/backend-http.ts) sends every backend request through the Convex client in
  [convex-client.ts](../projects/bot/src/convex-client.ts), and
  [backend-routes.ts](../projects/bot/src/backend-routes.ts) maps each request path to its backend function, whose name
  and kind the [service contract](../projects/contracts/src/service.ts) owns
- [channel-parents.ts](../projects/bot/src/channel-parents.ts) is the one source of thread parents, from Fluxerly's channel cache and one read for a channel it does not hold
- [reply-style.ts](../projects/bot/src/reply-style.ts) builds every status, detail and list reply once, from a title, labelled fields, an optional closing note that may hold commands, mentions and times and an optional plain footer, and renders it as embeds
- [help.ts](../projects/bot/src/help.ts) holds the forms each command's own help leaves out, which `help all` lists,
  and [permission-fix.ts](../projects/bot/src/permission-fix.ts) turns a missing permission or role position into the
  sentence that names its fix
- `tests/` holds the bot tests, which use the SDK's in-memory transport and the in-memory backend in [backend-fake.ts](../projects/bot/tests/backend-fake.ts)
- `scripts/` holds the opt-in [live smoke script](../projects/bot/scripts/smoke-live.ts). The test compiler checks it and Node runs it directly. [smoke-live.example.json](../projects/bot/smoke-live.example.json) shows its configuration, and the private local copy stays ignored
- [tsconfig.json](../projects/bot/tsconfig.json) compiles `src/` into `dist/`, and [tsconfig.test.json](../projects/bot/tsconfig.test.json) checks source, tests and scripts without emitting

## Backend package

- `convex/` holds the Convex functions. [schema.ts](../projects/backend/convex/schema.ts) owns every table, [botService.ts](../projects/backend/convex/botService.ts) owns the bot's key-checked public entry points, [serviceKey.ts](../projects/backend/convex/serviceKey.ts) checks the key, [crons.ts](../projects/backend/convex/crons.ts) starts scheduled jobs and [retention.ts](../projects/backend/convex/retention.ts) runs every feature's bounded retention cleanup as one chain
- `convex/_generated/` is created by the Convex CLI and kept in version control
- `tests/` holds `convex-test` tests

## Contracts package

- `src/` holds one module per feature with an Effect Schema, and a type of the same name, for every request and answer between the bot and the backend. The bot imports them as `@neonflux/contracts/<module>`
- [common.ts](../projects/contracts/src/common.ts) holds IDs, limits and other building blocks, and [shared.ts](../projects/contracts/src/shared.ts) the member and actor reads that many features send
- A module imports only these base modules and the modules of the features it builds on, never in a cycle
- The backend decodes requests with `decode` from [validation.ts](../projects/backend/convex/validation.ts), and each bot `-store.ts` decodes the answers

## Find a feature

Each feature uses the same file prefix in both packages.
In the bot, `<prefix>-command.ts` owns command grammar, `-permissions.ts` owns native permission checks, which actions read fresh, and `-store.ts` decodes backend answers with the feature's shared schemas.
In the backend, `<prefix>.ts` owns queries and mutations, `Domain.ts` owns domain rules, `Store.ts` owns state helpers and `Validators.ts` owns persisted shapes.
The requests and answers between them live in the feature's module of the [contracts package](#contracts-package)

| Feature | Bot `src/` prefix | Backend `convex/` prefix | Contracts `src/` module |
| --- | --- | --- | --- |
| Bot foundation, AFK and responses | `bot`, `main`, `config`, `reply-style`, `backend-http`, `backend-routes`, `convex-client`, `message-revisions`, `protections`, `member-evidence`, `channel-parents`, `general-settings`, `afk`, `response`, `responses` | `schema`, `botService`, `serviceKey`, `crons`, `retention`, `validation`, `protection`, `generalSettings`, `afk`, `response`, `responses` | `common`, `shared`, `afk`, `responses`, `general` |
| Moderation, automod, security and appeals | `moderation`, `safety-permissions`, `action-executor` | `moderation`, `appeals` | `moderation`, `appeal` |
| Command help and permission fixes | `help`, `permission-fix` | None | None |
| Server scope | `server-scope`, `server-runtime` | `serverScope`, `serviceGuard` | `service` |

Keep one-consumer code in its owning package, and introduce a shared package only for a demonstrated shared responsibility.
Update this guide when ownership or navigation changes

## Prepare the toolchain

Install the Node version in `projects/.node-version` and a pnpm 12 bootstrap, then run the following from `projects/`

```sh
pnpm install --frozen-lockfile
pnpm run check
```

pnpm selects the exact version pinned in the workspace manifest.
The aggregate check checks formatting with Prettier, then runs the heavy-task gate's test, then the contracts typecheck, then the backend checks, then the bot typecheck, build and tests.
Tests need no live credentials.
The opt-in live smoke runs separately through `pnpm run smoke:live` and is not part of the aggregate check

Use `pnpm run build` to compile the bot and `pnpm run start` to run the bot's last build.
During development, `pnpm run dev:bot` runs the bot from its source and restarts it on changes, and `pnpm run deploy:dev` publishes the backend once to the development deployment.
The bot reads a private `.env` described by its `.env.example`, and the backend's `.env.example` is a template for the Convex CLI's `.env.local` with only the deploy key.
See [the bot guide](BOT.md) and [the backend guide](BACKEND.md) for environment setup.
There are no production deployment or container commands yet

## Generated and local files

- Regenerate the lockfile through pnpm when dependency inputs change, review it and verify a frozen install
- Regenerate `convex/_generated/` against a configured deployment after changing the backend schema or function interfaces, as described in [the backend guide](BACKEND.md)
- Dependency installs, compiler output, build caches and private `.env` files stay ignored through the [workspace ignore rules](../projects/.gitignore) and each package's own `.gitignore`
- Keep ignore rules at workspace or package scope, not in a root `.gitignore`. Use Git's local `.git/info/exclude` for repository-root machine files
- The [workspace configuration](../projects/pnpm-workspace.yaml) allows build scripts only for the reviewed `esbuild` version that Convex needs, and exempts the pinned SDK release from the minimum release age. Review a changed script or version before updating these entries
