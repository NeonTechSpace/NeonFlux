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
| [projects/web/](../projects/web/) | The dashboard and web verification package `@neonflux/web` |
| [projects/scripts/](../projects/scripts/) | The [heavy-task gate](../projects/scripts/heavy.mjs) that limits concurrent machine-heavy package scripts |

The workspace [manifest](../projects/package.json), [workspace configuration](../projects/pnpm-workspace.yaml) and generated [lockfile](../projects/pnpm-lock.yaml) own shared dependency management.
The [Node version file](../projects/.node-version) owns the exact development runtime

## Bot package

- `src/` holds the bot source. [main.ts](../projects/bot/src/main.ts) starts the process, [config.ts](../projects/bot/src/config.ts) reads the environment and [bot.ts](../projects/bot/src/bot.ts) builds the SDK lifecycle, gateway routing and serial message pipeline
- [server-scope.ts](../projects/bot/src/server-scope.ts) parses single-server or multi-server scope, and [server-runtime.ts](../projects/bot/src/server-runtime.ts) binds one runtime and its backend adapters to each server and calls the backend's installation functions. [event-admission.ts](../projects/bot/src/event-admission.ts) holds a starting server's events until its runtime is ready
- [backend-http.ts](../projects/bot/src/backend-http.ts) sends every backend request through the Convex client in [convex-client.ts](../projects/bot/src/convex-client.ts), and [backend-routes.ts](../projects/bot/src/backend-routes.ts) maps each request path to its backend function. [work-dispatcher.ts](../projects/bot/src/work-dispatcher.ts) runs the one work dispatcher
- [costs.ts](../projects/bot/src/costs.ts) counts the process's Fluxer requests, backend requests and events. [usage.ts](../projects/bot/src/usage.ts) reports the backend calls to the bill guard and keeps its state, and [optional-work.ts](../projects/bot/src/optional-work.ts) holds the per-server limits on optional per-message work
- [fluxerly-next.ts](../projects/bot/src/fluxerly-next.ts) keeps the bot's own member, complete server role lists and channel and thread snapshots for evaluation, under the cache read names a later Fluxerly release is expected to provide, and is the one source of thread parents, including the forum a command in a forum post counts as in. Ticket transcripts list a ticket channel's threads in [ticket-transcripts.ts](../projects/bot/src/ticket-transcripts.ts), and message cleanup picks the next active thread of a policy channel in [cleanup-evidence.ts](../projects/bot/src/cleanup-evidence.ts), each with its own Fluxer read
- [suggestion-forum.ts](../projects/bot/src/suggestion-forum.ts) adds and applies the status tags of suggestion posts in a forum destination, and [events.ts](../projects/bot/src/events.ts) starts and closes event discussion threads
- [protections.ts](../projects/bot/src/protections.ts) sends messages and joins to automod and security, including webhook and other bots' messages for a server that checks them, and remembers whether each server does, so their messages cost nothing while it is off
- [help.ts](../projects/bot/src/help.ts) holds the one table of built-in commands that help pages and typo hints read, [setup-check.ts](../projects/bot/src/setup-check.ts) owns `!setup`, `!health` with its safety audit, `!recovery` and the dashboard's permission check, and [permission-fix.ts](../projects/bot/src/permission-fix.ts) turns a missing permission or role position into the sentence that names its fix [private-data.ts](../projects/bot/src/private-data.ts) answers the website's access checks for private cases with the bot's own reads
- `tests/` holds the bot tests, which use the SDK's in-memory transport and the in-memory backend in [backend-fake.ts](../projects/bot/tests/backend-fake.ts). [cost.test.ts](../projects/bot/tests/cost.test.ts) records how many Fluxer and backend requests one ordinary event costs with every feature configured, on a server's first message and on a warm server
- `scripts/` holds the opt-in [live smoke script](../projects/bot/scripts/smoke-live.ts). The test compiler checks it and Node runs it directly. [smoke-live.example.json](../projects/bot/smoke-live.example.json) shows its configuration, and the private local copy stays ignored
- [tsconfig.json](../projects/bot/tsconfig.json) compiles `src/` into `dist/`, and [tsconfig.test.json](../projects/bot/tsconfig.test.json) checks source, tests and scripts without emitting

## Backend package

- `convex/` holds the Convex functions. [schema.ts](../projects/backend/convex/schema.ts) owns every table, [botService.ts](../projects/backend/convex/botService.ts) owns the bot's key-checked public entry points, [serviceKey.ts](../projects/backend/convex/serviceKey.ts) checks the key, [crons.ts](../projects/backend/convex/crons.ts) starts scheduled jobs and [retention.ts](../projects/backend/convex/retention.ts) runs every feature's bounded retention cleanup as one chain
- [protection.ts](../projects/backend/convex/protection.ts) evaluates messages and joins for automod and security and checks text that NeonFlux posts for members against the content rules, and [moderationLinks.ts](../projects/backend/convex/moderationLinks.ts) judges deceptive links from the message text alone
- `convex/_generated/` is created by the Convex CLI and kept in version control
- [contracts.d.ts](../projects/backend/contracts.d.ts), [dashboard-contracts.d.ts](../projects/backend/dashboard-contracts.d.ts) and [verification-contracts.d.ts](../projects/backend/verification-contracts.d.ts) are types-only exports for the bot and website. They contain no runtime code or credentials
- `tests/` holds `convex-test` tests and `*-contract.test.ts` files that run the bot's backend adapters against an isolated backend fixture
- `scripts/` holds the [motion challenge screenshot evaluation](../projects/backend/scripts/motion-screenshot-eval.ts), described in [the challenge evaluation guide](CAPTCHA.md)

## Web package

- `src/routes/` holds TanStack Router file routes for the dashboard, verification page, session and verification APIs and Fluxer OAuth sign-in and sign-out
- `src/server/` holds OAuth, session and verification server handlers that run only on the web server
- [dashboard.tsx](../projects/web/src/dashboard.tsx) owns sign-in state, the server picker and the section layout. [dashboard-sections.tsx](../projects/web/src/dashboard-sections.tsx) lists the sections and loads each one's code on first use, and every section subscribes to its own live data. [drafts.ts](../projects/web/src/drafts.ts) keeps unsaved drafts in session storage, and [catalog.tsx](../projects/web/src/catalog.tsx) loads and refreshes a server's channels and roles
- Other `src/` files hold dashboard settings sections, the [overview](../projects/web/src/overview.tsx), the [audit log](../projects/web/src/audit-log.tsx), the [recovery inbox](../projects/web/src/recovery-inbox.tsx), the [backup preview](../projects/web/src/backup-preview.tsx), [private cases](../projects/web/src/private-cases.tsx), the [member role picker](../projects/web/src/role-picker-member.tsx), the [search picker](../projects/web/src/search-picker.tsx), the [message builder](../projects/web/src/message-builder.tsx), the [verification page](../projects/web/src/verification-page.tsx), the [motion canvas](../projects/web/src/motion-canvas.tsx) and the [Turnstile widget](../projects/web/src/turnstile.tsx)
- [onboarding-checklist.tsx](../projects/web/src/onboarding-checklist.tsx) holds the newcomer checklist section, while [onboarding-settings.tsx](../projects/web/src/onboarding-settings.tsx) holds the greetings and tickets sections
- [server-export.tsx](../projects/web/src/server-export.tsx) holds the owner's server export download, and [dashboard-tour.tsx](../projects/web/src/dashboard-tour.tsx) holds the first-visit dashboard tour
- [showcase-settings.tsx](../projects/web/src/showcase-settings.tsx) holds the showcase and profile sections, and [showcase-member.tsx](../projects/web/src/showcase-member.tsx) and [profile-member.tsx](../projects/web/src/profile-member.tsx) hold their member pages
- [structure-editor.tsx](../projects/web/src/structure-editor.tsx) holds the server structure editor, whose diff and merge run in the backend's [structureDomain.ts](../projects/backend/convex/structureDomain.ts)
- `src/routeTree.gen.ts` is generated by TanStack Router and kept in version control. Nitro builds `.output/`, which stays ignored
- `tests/` holds component and server handler tests

## Find a feature

Each feature uses the same file prefix in both packages.
In the bot, `<prefix>-command.ts` owns command grammar, `-management.ts` owns management replies, `-permissions.ts` owns native permission checks, which actions read fresh, `-store.ts` decodes backend answers and `-worker.ts` runs scoped background work.
In the backend, `<prefix>.ts` owns queries and mutations, `Domain.ts` owns validation, `Store.ts` owns state helpers and `Validators.ts` owns persisted shapes

| Feature | Bot `src/` prefix | Backend `convex/` prefix |
| --- | --- | --- |
| Bot foundation, AFK and responses | `bot`, `main`, `config`, `backend-http`, `backend-routes`, `convex-client`, `costs`, `message-revisions`, `protections`, `member-evidence`, `fluxerly-next`, `afk`, `response`, `responses` | `schema`, `botService`, `serviceKey`, `crons`, `retention`, `validation`, `protection`, `afk`, `response`, `responses` |
| Moderation, automod, security and appeals | `moderation`, `safety-permissions`, `action-executor` | `moderation`, `appeals` |
| Private cases on the website | `private-data` | `privateData` |
| Publishing and scheduled publishing | `publishing`, `schedule`, `civil-calendar` | `publishing`, `schedules`, `civilDomain` |
| Role panels, rules and autorole | `role`, `roles` | `role`, `roles` |
| Role picker and member access | `rolepicker` | `rolePicker`, `memberAccess` |
| Temporary roles | `temprole` | `temporaryRoles` |
| Newcomer checklist | `onboarding` | `onboarding` |
| Setup presets | `preset` | `presets` |
| Welcome and goodbye | `welcome` | `greeting`, `greetings` |
| Tickets | `ticket`, `tickets` | `ticket`, `tickets` |
| Forum help desk, saved answers and thread budget guard | `helpdesk` | `helpDesk` |
| Showcases and profiles | `showcase`, `profile` | `showcases`, `profiles`, `memberContent` |
| Message leveling | `level`, `leveling` | `leveling` |
| Events, birthdays and suggestions | `event`, `events`, `milestone`, `suggestion` | `events`, `milestones`, `suggestions` |
| Message cleanup and metadata logs | `cleanup`, `metadata-log` | `cleanup`, `metadataLogs` |
| Security alerts and invites | `alerts` | `alerts` |
| Selective backup | `backup` | `backup` |
| Readable server export | `server-export` | `serverExport` |
| Server structure editor on the website | `structure` | `structure` |
| Server analytics | `analytics` | `analytics` |
| Temporary voice rooms | `voice` | `voice` |
| Looking for group | `lfg` | `lfg` |
| Help, setup, health, recovery inbox and permission fixes | `help`, `setup-check`, `permission-fix` | `setupCheck`, `recovery` |
| YouTube upload alerts and the WebSub callback | `youtube` | `youtube`, `http` |
| Sticky messages, dashboard link and member list order | `sticky`, `sidebar`, `memberlist` | `sticky`, `sidebar`, `memberList` |
| Multi-server scope and installations | `server-scope`, `server-runtime`, `install-note` | `serverScope`, `installations` |
| Background work dispatch | `work-dispatcher` | `workDispatch`, `workSignal` |
| Optional work limits and the bill guard | `optional-work`, `usage` | `usage` |
| Dashboard | `dashboard`, `general-settings` | `dashboard`, `configuration`, `generalSettings` |
| Web verification | `verification` | `verification`, `motionCaptcha`, `captchaDomain`, `turnstile` |
| Audit log and member data rights | `member-data` | `auditLog`, `configurationChange`, `memberData` |

Keep one-consumer code in its owning package, and introduce a shared package only for a demonstrated shared responsibility.
Update this guide when ownership or navigation changes

## Prepare the toolchain

Install the Node version in `projects/.node-version` and a pnpm 12 bootstrap, then run the following from `projects/`

```sh
pnpm install --frozen-lockfile
pnpm run check
```

pnpm selects the exact version pinned in the workspace manifest.
The aggregate check runs the backend checks, then the bot typecheck, build and tests, then the web typecheck, tests and build.
Tests need no live credentials.
The opt-in live smoke runs separately through `pnpm run smoke:live` and is not part of the aggregate check

Use `pnpm run build` to compile the bot and website, `pnpm run start` to run the bot and `pnpm run dev:web` to run the website locally.
Each package has an `.env.example` file for its private `.env`.
See [the bot guide](BOT.md), [the backend guide](BACKEND.md) and [the dashboard guide](WEB.md) for environment setup.
There are no deployment or container commands yet

## Generated and local files

- Regenerate the lockfile through pnpm when dependency inputs change, review it and verify a frozen install
- Regenerate `convex/_generated/` against a configured deployment after changing the backend schema or function interfaces, as described in [the backend guide](BACKEND.md)
- Dependency installs, compiler output, build caches and private `.env` files stay ignored through the [workspace ignore rules](../projects/.gitignore) and each package's own `.gitignore`
- Keep ignore rules at workspace or package scope, not in a root `.gitignore`. Use Git's local `.git/info/exclude` for repository-root machine files
- The [workspace configuration](../projects/pnpm-workspace.yaml) allows build scripts only for the reviewed `esbuild` versions that Convex and the web build tools need, and exempts the pinned SDK release from the minimum release age. Review a changed script or version before updating these entries
