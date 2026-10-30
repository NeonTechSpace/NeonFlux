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
| [projects/evals/](../projects/evals/) | Labeled cases for the deceptive link judge and the lookalike name check, and the [baseline](../projects/evals/baseline.json) of cases they fail today, as [the contributing guide](CONTRIBUTING.md#detector-evals) describes |
| [projects/scripts/](../projects/scripts/) | The [heavy-task gate](../projects/scripts/heavy.mjs) that limits concurrent machine-heavy package scripts, with [its test](../projects/scripts/heavy.test.mjs), the [Effect typecheck runner](../projects/scripts/effect-tsc.mjs), the [lint runner](../projects/scripts/lint.mjs) and the repository scans it runs, each with a test that plants a violation |

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
  [signalled-worker.ts](../projects/bot/src/signalled-worker.ts) is the wake-driven loop workers can share with
  [contained.ts](../projects/bot/src/contained.ts), which logs a failed background effect without stopping its worker.
  Its warnings name their cause only with the values [cause-fields.ts](../projects/bot/src/cause-fields.ts) lists
- [costs.ts](../projects/bot/src/costs.ts) counts the process's Fluxer requests, backend requests and events. [usage.ts](../projects/bot/src/usage.ts) reports the backend calls to the bill guard and keeps its state, and [optional-work.ts](../projects/bot/src/optional-work.ts) holds the admission that the bill guard pauses, the one per-server bucket for autoresponder checks and the memory of members known to have no AFK status
- [channel-parents.ts](../projects/bot/src/channel-parents.ts) is the one source of thread parents, including the forum a command in a forum post counts as in, from Fluxerly's channel cache and one read for a channel it does not hold. [thread-memory.ts](../projects/bot/src/thread-memory.ts) keeps the last seen state of threads for metadata logs, [resource-memory.ts](../projects/bot/src/resource-memory.ts) that of roles, channels, members and servers, [message-revisions.ts](../projects/bot/src/message-revisions.ts) recent messages and [audit-changes.ts](../projects/bot/src/audit-changes.ts) reads audit entries' before and after values for logs and security alerts. Ticket transcripts read a ticket channel and its public threads forward in [ticket-transcripts.ts](../projects/bot/src/ticket-transcripts.ts), which [ticket-worker.ts](../projects/bot/src/ticket-worker.ts) runs whenever a save is due, and [ticket-panels.ts](../projects/bot/src/ticket-panels.ts) keeps a server's ticket panels and opens a ticket from a panel reaction, and message cleanup picks the next active thread of a policy channel in [cleanup-evidence.ts](../projects/bot/src/cleanup-evidence.ts), each with its own Fluxer read
- [suggestion-forum.ts](../projects/bot/src/suggestion-forum.ts) adds and applies the status tags of suggestion posts in a forum destination, and [events.ts](../projects/bot/src/events.ts) starts and closes event discussion threads
- [protections.ts](../projects/bot/src/protections.ts) sends messages and joins to automod and security, including webhook and other bots' messages for a server that checks them, and remembers whether each server does, so their messages cost nothing while it is off
- [reply-style.ts](../projects/bot/src/reply-style.ts) builds every status, detail and list reply once, from a title, labelled fields, an optional closing note that may hold commands, mentions and times and an optional plain footer, and renders it as an embed or as plain text in the style the server chose with its prefix in [general-settings.ts](../projects/bot/src/general-settings.ts)
- [command-arguments.ts](../projects/bot/src/command-arguments.ts) holds the argument forms commands share, [paging.ts](../projects/bot/src/paging.ts) remembers where each list sent with `next` stopped, and [runtime-reload.ts](../projects/bot/src/runtime-reload.ts) brings what running features keep in memory up to date after a dashboard change or a restored backup item. [effect-compat.d.ts](../projects/bot/src/effect-compat.d.ts) declares the browser types Effect's declarations need, as [technology choices](TECHNOLOGY.md#build-and-check-constraints) describes
- [help.ts](../projects/bot/src/help.ts) holds the one table of built-in commands that help pages and typo hints read,
  [setup-check.ts](../projects/bot/src/setup-check.ts) owns `!setup`, `!health` with its safety audit, `!recovery` and
  the dashboard's permission check, and [permission-fix.ts](../projects/bot/src/permission-fix.ts) turns a missing
  permission or role position into the sentence that names its fix, and
  [private-data.ts](../projects/bot/src/private-data.ts) answers the website's access checks for private cases with the
  bot's own reads
- `tests/` holds the bot tests, which use the SDK's in-memory transport and the in-memory backend in [backend-fake.ts](../projects/bot/tests/backend-fake.ts). [cost.test.ts](../projects/bot/tests/cost.test.ts) records how many Fluxer and backend requests one ordinary event costs with every feature configured, on a server's first message and on a warm server
- `scripts/` holds the opt-in [live smoke script](../projects/bot/scripts/smoke-live.ts). The test compiler checks it and Node runs it directly. [smoke-live.example.json](../projects/bot/smoke-live.example.json) shows its configuration, and the private local copy stays ignored
- [tsconfig.json](../projects/bot/tsconfig.json) compiles `src/` into `dist/`, and [tsconfig.test.json](../projects/bot/tsconfig.test.json) checks source, tests and scripts without emitting

## Backend package

- `convex/` holds the Convex functions. [schema.ts](../projects/backend/convex/schema.ts) owns every table, [botService.ts](../projects/backend/convex/botService.ts) owns the bot's key-checked public entry points, [serviceKey.ts](../projects/backend/convex/serviceKey.ts) checks the key, [crons.ts](../projects/backend/convex/crons.ts) starts scheduled jobs and [retention.ts](../projects/backend/convex/retention.ts) runs every feature's bounded retention cleanup as one chain
- [valueDiff.ts](../projects/backend/convex/valueDiff.ts) lists the values that differ between two reads of a setting, which backup restore checks and audit log details share
- [protection.ts](../projects/backend/convex/protection.ts) evaluates messages and joins for automod and security and checks text that NeonFlux posts for members against the content rules, and [moderationLinks.ts](../projects/backend/convex/moderationLinks.ts) judges deceptive links from the message text alone
- `convex/_generated/` is created by the Convex CLI and kept in version control
- [dashboard-contracts.d.ts](../projects/backend/dashboard-contracts.d.ts) and [verification-contracts.d.ts](../projects/backend/verification-contracts.d.ts) are types-only exports of the website's own contracts. They re-export the shared types the website also uses and the generated types of the public functions it calls, and contain no runtime code or credentials
- `tests/` holds `convex-test` tests and `*-contract.test.ts` files that run the bot's backend adapters against an isolated backend fixture
- `scripts/` holds the [motion challenge screenshot evaluation](../projects/backend/scripts/motion-screenshot-eval.ts), described in [the challenge evaluation guide](CAPTCHA.md)

## Contracts package

- `src/` holds one module per feature with an Effect Schema, and a type of the same name, for every request and answer between the bot and the backend. The bot imports them as `@neonflux/contracts/<module>`
- [common.ts](../projects/contracts/src/common.ts) holds IDs, limits and other building blocks, [shared.ts](../projects/contracts/src/shared.ts) the member and actor reads that many features send, and [publishing-base.ts](../projects/contracts/src/publishing-base.ts) message content and the publishing grants, attempts and posts every posting feature shares
- [motion-captcha.ts](../projects/contracts/src/motion-captcha.ts) holds the motion challenge's public frame format, palette, particle geometry and spark path bounds, which the backend and the website share. Seeds and route geometry stay in the backend
- [permission-names.ts](../projects/contracts/src/permission-names.ts) holds Fluxer's titles for each permission bit,
  which the backend and the website show because they cannot load the SDK. A bot test compares every entry with the SDK
- A module imports only these base modules and the modules of the features it builds on, never in a cycle
- The backend decodes requests with `decode` from [validation.ts](../projects/backend/convex/validation.ts), and each bot `-store.ts` decodes the answers

## Web package

- `src/routes/` holds TanStack Router file routes for the dashboard, verification page, the session API, which also signs out, the verification API and Fluxer OAuth sign-in
- `src/server/` holds OAuth, session and verification server handlers that run only on the web server
- [dashboard.tsx](../projects/web/src/dashboard.tsx) owns sign-in state and the section layout, and [server-picker.tsx](../projects/web/src/server-picker.tsx) holds the server picker. [dashboard-sections.tsx](../projects/web/src/dashboard-sections.tsx) lists the sections and loads each one's code on first use, and every section subscribes to its own live data. [drafts.ts](../projects/web/src/drafts.ts) keeps unsaved drafts in session storage, and [catalog.tsx](../projects/web/src/catalog.tsx) loads and refreshes a server's channels and roles
- Other `src/` files hold dashboard settings sections, the [overview](../projects/web/src/overview.tsx), the [audit
  log](../projects/web/src/audit-log.tsx), the [recovery inbox](../projects/web/src/recovery-inbox.tsx), the [backup
  restore](../projects/web/src/backup-restore.tsx), [private cases](../projects/web/src/private-cases.tsx), the [member
  role picker](../projects/web/src/role-picker-member.tsx), the [search picker](../projects/web/src/search-picker.tsx),
  the [message builder](../projects/web/src/message-builder.tsx), the [verification
  page](../projects/web/src/verification-page.tsx), the [motion canvas](../projects/web/src/motion-canvas.tsx) and the
  [Turnstile widget](../projects/web/src/turnstile.tsx)
- [onboarding-checklist.tsx](../projects/web/src/onboarding-checklist.tsx) holds the newcomer checklist section
- [change-table.tsx](../projects/web/src/change-table.tsx) shows changed settings with their before and after values, for the backup restore check and the audit log's Details
- [server-export.tsx](../projects/web/src/server-export.tsx) holds the owner's server export download, and [dashboard-tour.tsx](../projects/web/src/dashboard-tour.tsx) holds the first-visit dashboard tour
- [showcase-settings.tsx](../projects/web/src/showcase-settings.tsx) holds the showcase and profile sections, and [showcase-member.tsx](../projects/web/src/showcase-member.tsx) and [profile-member.tsx](../projects/web/src/profile-member.tsx) hold their member pages
- [structure-editor.tsx](../projects/web/src/structure-editor.tsx) holds the server structure editor, whose live diff [structure-diff.ts](../projects/web/src/structure-diff.ts) builds from the change functions in the [structure contracts](../projects/contracts/src/structure.ts) that the backend's [structureDomain.ts](../projects/backend/convex/structureDomain.ts) merge also uses
- `src/routeTree.gen.ts` is generated by TanStack Router and kept in version control. Nitro builds `.output/`, which stays ignored
- `tests/` holds component and server handler tests

## Find a feature

Each feature uses the same file prefix in both packages.
In the bot, `<prefix>-command.ts` owns command grammar, `-management.ts` owns management replies, `-permissions.ts` owns native permission checks, which actions read fresh, `-store.ts` decodes backend answers with the feature's shared schemas and `-worker.ts` runs scoped background work.
In the backend, `<prefix>.ts` owns queries and mutations, `Domain.ts` owns domain rules, `Store.ts` owns state helpers and `Validators.ts` owns persisted shapes.
The requests and answers between them live in the feature's module of the [contracts package](#contracts-package)

| Feature | Bot `src/` prefix | Backend `convex/` prefix | Contracts `src/` module |
| --- | --- | --- | --- |
| Bot foundation, AFK and responses | `bot`, `main`, `config`, `reply-style`, `backend-http`, `backend-routes`, `convex-client`, `costs`, `message-revisions`, `protections`, `member-evidence`, `channel-parents`, `thread-memory`, `resource-memory`, `audit-changes`, `afk`, `response`, `responses` | `schema`, `botService`, `serviceKey`, `crons`, `retention`, `validation`, `protection`, `afk`, `response`, `responses` | `common`, `shared`, `afk`, `responses` |
| Moderation, automod, security and appeals | `moderation`, `safety-permissions`, `action-executor` | `moderation`, `appeals` | `moderation`, `appeal` |
| Private cases on the website | `private-data` | `privateData` | `private-data` |
| Publishing and scheduled publishing | `publishing`, `schedule`, `civil-calendar` | `publishing`, `schedules`, `civilDomain` | `publishing-base`, `publishing`, `schedules`, `civil` |
| Role panels, rules and autorole | `role`, `roles` | `role`, `roles` | `roles` |
| Role picker and member access | `rolepicker` | `rolePicker`, `memberAccess` | `role-picker` |
| Temporary roles | `temprole` | `temporaryRoles` | `temporary-roles` |
| Newcomer checklist | `onboarding` | `onboarding` | `onboarding` |
| Setup presets | `preset` | `presets` | `presets` |
| Welcome and goodbye | `welcome` | `greeting`, `greetings` | `greetings` |
| Tickets | `ticket`, `tickets` | `ticket`, `tickets` | `tickets` |
| Forum help desk, saved answers and thread budget guard | `helpdesk` | `helpDesk` | `helpdesk` |
| Showcases and profiles | `showcase`, `profile` | `showcases`, `profiles`, `memberContent` | `showcases`, `profiles`, `member-content` |
| Message leveling | `level`, `leveling` | `leveling` | `leveling` |
| Events, birthdays and suggestions | `event`, `events`, `milestone`, `suggestion` | `events`, `milestones`, `suggestions` | `events`, `milestones`, `suggestions` |
| Message cleanup and metadata logs | `cleanup`, `metadata-log` | `cleanup`, `metadataLogs` | `cleanup`, `metadata-logs` |
| Security alerts and invites | `alerts` | `alerts` | `alerts` |
| Selective backup | `backup` | `backup` | `backup`, `permission-names` |
| Readable server export | `server-export` | `serverExport` | `server-export` |
| Server structure editor on the website | `structure` | `structure` | `structure` |
| Server analytics | `analytics` | `analytics` | `analytics` |
| Temporary voice rooms | `voice` | `voice` | `voice` |
| Looking for group | `lfg` | `lfg` | `lfg` |
| Help, setup, health, recovery inbox and permission fixes | `help`, `setup-check`, `permission-fix` | `setupCheck`, `recovery` | `setup` |
| Twitch live alerts and the EventSub callback | `twitch` | `twitch`, `http` | `twitch` |
| YouTube upload alerts and the WebSub callback | `youtube` | `youtube`, `http` | `youtube` |
| Sticky messages, dashboard link and member list order | `sticky`, `sidebar`, `memberlist` | `sticky`, `sidebar`, `memberList` | `sticky`, `sidebar`, `member-list` |
| Multi-server scope and installations | `server-scope`, `server-runtime`, `install-note` | `serverScope`, `serviceGuard`, `installations` | `service` |
| Background work dispatch | `work-dispatcher` | `workDispatch`, `workSignal` | `service` |
| Optional work limits and the bill guard | `optional-work`, `usage` | `usage` | `service` |
| Dashboard | `dashboard`, `general-settings` | `dashboard`, `configuration`, `generalSettings` | `dashboard`, `general` |
| Web verification | `verification` | `verification`, `motionCaptcha`, `captchaDomain`, `turnstile` | `verification` |
| Audit log and member data rights | `member-data` | `auditLog`, `configurationChange`, `memberData` | `member-data` |

Keep one-consumer code in its owning package, and introduce a shared package only for a demonstrated shared responsibility.
Update this guide when ownership or navigation changes

## Prepare the toolchain

Install the Node version in `projects/.node-version` and a pnpm 12 bootstrap, then run the following from `projects/`

```sh
pnpm install --frozen-lockfile
pnpm run check
```

pnpm selects the exact version pinned in the workspace manifest.
The aggregate check checks formatting with Prettier, then runs the lint, then the tests of the workspace scripts, then the contracts typecheck, then the backend checks, then the bot typecheck, build and tests, then the web build, which regenerates the route tree, and the web typecheck and tests.
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
