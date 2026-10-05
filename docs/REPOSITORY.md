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
| [projects/web/](../projects/web/) | The dashboard and web verification package `@neonflux/web` |
| [projects/scripts/](../projects/scripts/) | The [heavy-task gate](../projects/scripts/heavy.mjs) that limits concurrent machine-heavy package scripts, with [its test](../projects/scripts/heavy.test.mjs), and the [Effect typecheck runner](../projects/scripts/effect-tsc.mjs) |

The workspace [manifest](../projects/package.json), [workspace configuration](../projects/pnpm-workspace.yaml) and generated [lockfile](../projects/pnpm-lock.yaml) own shared dependency management.
The [Node version file](../projects/.node-version) owns the exact development runtime

## Bot package

- `src/` holds the bot source. [main.ts](../projects/bot/src/main.ts) starts the process, [config.ts](../projects/bot/src/config.ts) reads the environment and [bot.ts](../projects/bot/src/bot.ts) builds the SDK lifecycle, gateway routing, the hold on a starting server's events and the serial message pipeline
- [server-scope.ts](../projects/bot/src/server-scope.ts) routes commands to a server of the scope, and [server-runtime.ts](../projects/bot/src/server-runtime.ts) adopts the backend's scope and website origin at startup, binds one runtime and its backend adapters to each server and calls the backend's installation functions
- [backend-http.ts](../projects/bot/src/backend-http.ts) sends every backend request through the Convex client in
  [convex-client.ts](../projects/bot/src/convex-client.ts), and
  [backend-routes.ts](../projects/bot/src/backend-routes.ts) maps each request path to its backend function, whose name
  and kind the [service contract](../projects/contracts/src/service.ts) owns.
  [work-dispatcher.ts](../projects/bot/src/work-dispatcher.ts) runs the one work dispatcher, and
  [signalled-worker.ts](../projects/bot/src/signalled-worker.ts) is the wake-driven loop workers can share
- [channel-parents.ts](../projects/bot/src/channel-parents.ts) is the one source of thread parents, from Fluxerly's channel cache and one read for a channel it does not hold. [thread-memory.ts](../projects/bot/src/thread-memory.ts) keeps the last seen state of threads for metadata logs
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
- [dashboard-contracts.d.ts](../projects/backend/dashboard-contracts.d.ts) and [verification-contracts.d.ts](../projects/backend/verification-contracts.d.ts) are types-only exports of the website's own contracts. They re-export the shared types the website also uses and the generated types of the public functions it calls, and contain no runtime code or credentials
- `tests/` holds `convex-test` tests and `*-contract.test.ts` files that run the bot's backend adapters against an isolated backend fixture
- `scripts/` holds the [motion challenge screenshot evaluation](../projects/backend/scripts/motion-screenshot-eval.ts), described in [the challenge evaluation guide](CAPTCHA.md)

## Contracts package

- `src/` holds one module per feature with an Effect Schema, and a type of the same name, for every request and answer between the bot and the backend. The bot imports them as `@neonflux/contracts/<module>`
- [common.ts](../projects/contracts/src/common.ts) holds IDs, limits and other building blocks, [shared.ts](../projects/contracts/src/shared.ts) the member and actor reads that many features send, and [publishing-base.ts](../projects/contracts/src/publishing-base.ts) message content and the publishing grants, attempts and posts every posting feature shares
- [motion-captcha.ts](../projects/contracts/src/motion-captcha.ts) holds the motion challenge's public frame format, palette, particle geometry and spark path bounds, which the backend and the website share. Seeds and route geometry stay in the backend
- [permission-names.ts](../projects/contracts/src/permission-names.ts) holds Fluxer's titles for each permission bit,
  which the backend shows because it cannot load the SDK. A bot test compares every entry with the SDK
- A module imports only these base modules and the modules of the features it builds on, never in a cycle
- The backend decodes requests with `decode` from [validation.ts](../projects/backend/convex/validation.ts), and each bot `-store.ts` decodes the answers

## Web package

- `src/routes/` holds TanStack Router file routes for the dashboard, verification page, session and verification APIs and Fluxer OAuth sign-in and sign-out
- `src/server/` holds OAuth, session and verification server handlers that run only on the web server
- [dashboard.tsx](../projects/web/src/dashboard.tsx) owns sign-in state and the section layout, and [server-picker.tsx](../projects/web/src/server-picker.tsx) holds the server picker. [dashboard-sections.tsx](../projects/web/src/dashboard-sections.tsx) lists the sections and loads each one's code on first use, and every section subscribes to its own live data. [drafts.ts](../projects/web/src/drafts.ts) keeps unsaved drafts in session storage, and [catalog.tsx](../projects/web/src/catalog.tsx) loads and refreshes a server's channels and roles
- Other `src/` files hold dashboard settings sections, the [overview](../projects/web/src/overview.tsx), the [search
  picker](../projects/web/src/search-picker.tsx), the [message builder](../projects/web/src/message-builder.tsx), the [verification
  page](../projects/web/src/verification-page.tsx), the [motion canvas](../projects/web/src/motion-canvas.tsx) and the
  [Turnstile widget](../projects/web/src/turnstile.tsx)
- `src/routeTree.gen.ts` is generated by TanStack Router and kept in version control. Nitro builds `.output/`, which stays ignored
- `tests/` holds component and server handler tests

## Find a feature

Each feature uses the same file prefix in both packages.
In the bot, `<prefix>-command.ts` owns command grammar, `-management.ts` owns management replies, `-permissions.ts` owns native permission checks, which actions read fresh, `-store.ts` decodes backend answers with the feature's shared schemas and `-worker.ts` runs scoped background work.
In the backend, `<prefix>.ts` owns queries and mutations, `Domain.ts` owns domain rules, `Store.ts` owns state helpers and `Validators.ts` owns persisted shapes.
The requests and answers between them live in the feature's module of the [contracts package](#contracts-package)

| Feature | Bot `src/` prefix | Backend `convex/` prefix | Contracts `src/` module |
| --- | --- | --- | --- |
| Bot foundation, AFK and responses | `bot`, `main`, `config`, `reply-style`, `backend-http`, `backend-routes`, `convex-client`, `message-revisions`, `protections`, `member-evidence`, `channel-parents`, `thread-memory`, `afk`, `response`, `responses` | `schema`, `botService`, `serviceKey`, `crons`, `retention`, `validation`, `protection`, `afk`, `response`, `responses` | `common`, `shared`, `afk`, `responses` |
| Moderation, automod, security and appeals | `moderation`, `safety-permissions`, `action-executor` | `moderation`, `appeals` | `moderation`, `appeal` |
| Publishing and scheduled publishing | `publishing`, `schedule`, `civil-calendar` | `publishing`, `schedules`, `civilDomain` | `publishing-base`, `publishing`, `schedules`, `civil` |
| Role panels, rules and autorole | `role`, `roles` | `role`, `roles` | `roles` |
| Welcome and goodbye | `welcome` | `greeting`, `greetings` | `greetings` |
| Tickets | `ticket`, `tickets` | `ticket`, `tickets` | `tickets` |
| Message leveling | `level`, `leveling` | `leveling` | `leveling` |
| Events, birthdays and suggestions | `event`, `events`, `milestone`, `suggestion` | `events`, `milestones`, `suggestions` | `events`, `milestones`, `suggestions` |
| Message cleanup and metadata logs | `cleanup`, `metadata-log` | `cleanup`, `metadataLogs` | `cleanup`, `metadata-logs` |
| Selective backup | `backup` | `backup` | `backup`, `permission-names` |
| Command help, setup progress and permission fixes | `help`, `permission-fix` | `setupCheck` | `setup` |
| Multi-server scope and installations | `server-scope`, `server-runtime`, `event-receipts` | `serverScope`, `serviceGuard`, `installations` | `service` |
| Background work dispatch | `work-dispatcher` | `workDispatch`, `workSignal` | `service` |
| Dashboard | `dashboard`, `general-settings` | `dashboard`, `configuration`, `generalSettings` | `dashboard`, `general` |
| Web verification | `verification` | `verification`, `motionCaptcha`, `captchaDomain`, `turnstile` | `verification` |

Keep one-consumer code in its owning package, and introduce a shared package only for a demonstrated shared responsibility.
Update this guide when ownership or navigation changes

## Prepare the toolchain

Install the Node version in `projects/.node-version` and a pnpm 12 bootstrap, then run the following from `projects/`

```sh
pnpm install --frozen-lockfile
pnpm run check
```

pnpm selects the exact version pinned in the workspace manifest.
The aggregate check checks formatting with Prettier, then runs the heavy-task gate's test, then the contracts typecheck, then the backend checks, then the bot typecheck, build and tests, then the web build, which regenerates the route tree, and the web typecheck and tests.
Tests need no live credentials.
The opt-in live smoke runs separately through `pnpm run smoke:live` and is not part of the aggregate check

Use `pnpm run build` to compile the bot and website and `pnpm run start` to run the bot's last build.
During development, `pnpm run dev:bot` runs the bot from its source and restarts it on changes, `pnpm run dev:web` runs the website and `pnpm run deploy:dev` publishes the backend once to the development deployment.
The bot and website read a private `.env` described by their `.env.example`, and the backend's `.env.example` is a template for the Convex CLI's `.env.local` with only the deploy key.
See [the bot guide](BOT.md), [the backend guide](BACKEND.md) and [the dashboard guide](WEB.md) for environment setup.
There are no production deployment or container commands yet

## Generated and local files

- Regenerate the lockfile through pnpm when dependency inputs change, review it and verify a frozen install
- Regenerate `convex/_generated/` against a configured deployment after changing the backend schema or function interfaces, as described in [the backend guide](BACKEND.md)
- Dependency installs, compiler output, build caches and private `.env` files stay ignored through the [workspace ignore rules](../projects/.gitignore) and each package's own `.gitignore`
- Keep ignore rules at workspace or package scope, not in a root `.gitignore`. Use Git's local `.git/info/exclude` for repository-root machine files
- The [workspace configuration](../projects/pnpm-workspace.yaml) allows build scripts only for the reviewed `esbuild` versions that Convex and the web build tools need, and exempts the pinned SDK release from the minimum release age. Review a changed script or version before updating these entries
