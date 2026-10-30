# Contributing

This guide is for contributors who change NeonFlux's code or documentation.
It covers the checks a change must pass, generated files, the documentation style and the places a new feature or table must be registered

## Prepare and check

Prepare the toolchain as [the repository guide](REPOSITORY.md#prepare-the-toolchain) describes, then run the aggregate check from `projects/` before a pull request is opened

```sh
pnpm run check
```

The check needs no credentials or network connection. `pnpm run format` fixes the formatting it reports

To run one test file, run its package's runner from that package's folder, such as `projects/bot/`

| Package | Command |
| --- | --- |
| Bot and backend | `node ../scripts/heavy.mjs node --test tests/<file>.test.ts` |
| Website | `node ../scripts/heavy.mjs pnpm exec tsx --test tests/<file>.test.ts` |

Add `--test-name-pattern="<part of the name>"` after `--test` to run one test of a file.
`bot/tests/main.test.ts` starts the built bot from `bot/dist/`, so run `pnpm run build` in `projects/bot/` first.
The [heavy-task gate](TECHNOLOGY.md#build-and-check-constraints) queues machine-heavy commands so parallel runs do not overload the machine

## Generated files

- `backend/convex/_generated/`: Regenerate it after changing the backend schema or a function interface, with `pnpm --filter @neonflux/backend run codegen --typecheck disable` against a configured development deployment, as [the backend guide](BACKEND.md#checks) describes. Adding a function to an existing module needs no codegen, while a new module does
- `web/src/routeTree.gen.ts`: The website build regenerates it, so run `pnpm --filter @neonflux/web run build` after adding, renaming or removing a route
- `pnpm-lock.yaml`: Change dependencies through pnpm and verify a frozen install, as [the repository guide](REPOSITORY.md#generated-and-local-files) describes

Commit generated files together with the change that needs them

## Documentation style

- Describe only behavior that works today, and mark unbuilt work as planned
- Use plain, concrete words and the names the code and the interface use
- Use impersonal wording that never addresses the reader, except in a tagline
- Use no em dashes, no semicolons in prose and no final period at the end of a paragraph, list item or table cell
- Link to other guides with repository-relative links instead of copying their content
- Never put tokens, keys, archives or member data in documentation, examples or tests. Use clearly synthetic values

## Detector evals

`pnpm run evals` scores the deceptive link judge and the lookalike name check against the labeled cases in [projects/evals/](../projects/evals/) and prints what each catches and wrongly flags, per family. The cases are synthesized from common phishing and impersonation patterns, not taken from real servers. `evals/baseline.json` lists the cases each detector fails today, and `pnpm run check` fails when a case outside that list starts to fail. After an improvement, `node scripts/evals.mjs --update` tightens the baseline

To tune a detector, work only from `train.json`. A false positive costs more than a miss, since a flagged link is usually deleted, so never trade a new false positive for a catch. The `holdout.json` sets scored the last tuning round and now only guard against regressions, so a new round needs new held-out cases, written by someone other than the person tuning and scored once at the end

## Adding a feature or a table

A new feature or backend table usually has to be registered in several places. Each line names what catches a missing entry, and a line without a check depends on review

| Registration | Where | What catches a missing entry |
| --- | --- | --- |
| Per-server rows removed when a server's data is purged | `PURGE_INDEXES` in `backend/convex/installationsPurge.ts` | The typecheck, through its `satisfies` clause, and `backend/tests/installations-purge.test.ts` |
| Member data for access and erasure requests | An entry in `MEMBER_DATA` in `backend/convex/memberData.ts` with a `by_member_data` index on the member field and `serverId`, or a stated exemption in `MEMBER_DATA_EXEMPT` | `backend/tests/member-data.test.ts` |
| Bot functions | `BOT_FUNCTIONS` in `contracts/src/service.ts` and the export in `backend/convex/botService.ts` | `backend/tests/bot-service.test.ts` |
| Bot request paths | `backendRoutes` in `bot/src/backend-routes.ts` | `bot/tests/backend-http.test.ts` |
| Request body limits | The limit argument of `botQuery` and `botMutation` in `backend/convex/botService.ts` | The typecheck requires a limit, and no test checks its value |
| Retention of expiring rows | `RETENTION_PASSES` in `backend/convex/retention.ts`, or a stated exemption in `RETENTION_EXEMPT` in `backend/tests/retention.test.ts` | `backend/tests/retention.test.ts`, which treats a table as expiring when an index is named for expiry, cleanup or history or a field holds an expiry time, and fails when no pass reads it |
| Background work | `WORK_SOURCES` in `backend/convex/workDispatch.ts` | `backend/tests/work-dispatch.test.ts`, whose tests check each worker kind and the dashboard passes |
| Help pages and reserved command names | The command table in `bot/src/help.ts` | `bot/tests/help.test.ts` |
| Setup and overview states | `backend/convex/setupCheck.ts` and `bot/src/setup-check.ts` | `backend/tests/setup-check.test.ts` and `bot/tests/setup-check.test.ts` |
| Recovery inbox sources | `RecoverySource` in `contracts/src/setup.ts` and `backend/convex/recovery.ts` | `backend/tests/recovery.test.ts`, which fails until its scenario shows every source, and the bot typecheck, through `areas` in `bot/src/setup-check.ts` |
| Backends in backend tests | `convexBackend` in `backend/tests/convex-backend.ts` | `backend/tests/document-limits.test.ts`, which refuses a test that imports `convex-test` directly. After each test the scan fails when a stored document is over 1 MiB or an array holds more than 8,192 values |
| Audit change summaries | `backend/convex/auditLog.ts` | `backend/tests/audit-log.test.ts`, which covers part of the summaries |
| Readable server export | `FAMILIES` in `backend/convex/serverExport.ts` | `backend/tests/server-export.test.ts` |
| Backup configuration families | The backup snapshot and restore in `backend/convex/backup.ts` | `backend/tests/backup.test.ts` |
| Feature navigation | The feature table in [the repository guide](REPOSITORY.md#find-a-feature), or a link from the guide for a file outside a feature | `pnpm run lint`, through [repository-guide.mjs](../projects/scripts/repository-guide.mjs) |

Document the feature's usable behavior and limits in [the bot guide](BOT.md), [the backend guide](BACKEND.md) or [the dashboard guide](WEB.md)
