# NeonFlux Workspace Instructions

## Scope and judgment

- This file applies to the entire workspace. A deeper `AGENTS.md` adds subsystem-specific rules without weakening these ones.
- Optimize for correctness, security, durable behavior, maintainability, and future human time. Keep changes coherent and as small as the requested outcome allows.
- NeonFlux is an unreleased product under active development. Do not add migrations, compatibility shims, legacy branches, dual behavior, or preservation code unless the user explicitly requests them.
- Inspect relevant production code, tests, Research notes, and JJ state before material changes. Treat existing working-copy changes as user-owned.

## Toolchain and repository safety

- Use pnpm 11 only for Node.js work. Keep pnpm settings in `pnpm-workspace.yaml` and the Node pin in root `package.json` `devEngines.runtime`.
- Do not edit generated files manually. Run the owning generator and inspect its diff.
- Do not stage, commit, describe, bookmark, tag, push, squash, rebase, or otherwise mutate VCS state without explicit permission.
- Never commit secrets, `.env`, generated `dist`, local database data, or machine-specific absolute paths.
- Keep new or substantially rewritten handwritten production modules focused and generally below 555 LOC.

## Architecture and runtime

- Convex is the only durable application database. Do not add Postgres, Drizzle, SQLite, `node:sqlite`, local database files, or dual-store fallbacks.
- Runtime environments are development and production. There is no staging environment.
- Handle `INSTANCE_MODE` bootstrap and DB-effective mode behavior with explicit `switch` statements.
- Deployment behavior belongs in the dedicated `deployment_config` row, never copied into entity rows such as `bot_installations`.
- Keep reusable domain and platform logic in `packages/*`. Bot and web consume it through workspace imports.
- Use `neverthrow` for expected recoverable runtime failures. Every importing package declares it directly.
- Model durable data before changing schema: ownership, authority, lifecycle, cardinality, retention/deletion, access paths, concurrency, and recovery. Each table owns one durable concept.
- Use guild-scoped generic settings only for small configuration. Give workflows, records, logs, approvals, counters, leases, and user data dedicated tables.
- For external side effects, make partial failure, idempotency, retries, rate limits, concurrency, crash recovery, and reconciliation explicit. Do not claim cross-system atomicity.
- Changes to Blueprint persisted action-ledger or normalization semantics, reference or ID-map transitions, provider outcome or replay classification, enqueue, claim, attempt, checkpoint, control, finalization, or progress semantics must bump the shared execution protocol in `convex/runtime_contract_model.ts`, `packages/db/src/runtime-contract.ts`, and `apps/web/src/dashboard-structure-execution-protocol.ts`. Persist the protocol on every execution and fence every execution boundary against it. Mixed backend, consumer, browser, or durable-row versions must fail closed. Do not add compatibility branches.
- Do not reintroduce startup migrations, application Postgres bootstrap, source-export tooling, or import/smoke scripts in application or Docker paths.

## Product and interaction direction

- Organize user-facing workflows around the user's intent, current decision, and next safe action rather than internal services, persistence stages, or protocol terminology.
- Keep necessary safety gates, but present them as one ordered, understandable state model. Explain why progress is blocked, what remains safe, and the exact action that resolves each blocker.
- Use progressive disclosure. Put the common path and decision-relevant information first. Keep raw payloads, identifiers, logs, and protocol details available as secondary technical inspection rather than the primary interface.
- Match the representation to the problem. Use scoped navigation, hierarchy, diff views, filters, summaries, and contextual details for large or structured change sets instead of stacking unrelated domains or reducing them to flat lists and serialized data.
- Treat the selected tenant, guild, account, resource, or comparable authority scope as a hard state boundary. Reuse confirmed data only within the same scope, retain useful per-scope caches when safe, and reset transient selections, drafts, errors, pagination, and busy state when scope changes.
- When users reasonably expect external changes to appear live, reconcile them promptly and make freshness, reconnecting, degraded transport, and retained-last-confirmed behavior visible. A non-critical failure may remain non-blocking, but it must not become silent or make stale data look authoritative.

## Security and observability

- Re-check authorization at the authoritative boundary. Minimize scopes and keep guild/user ownership explicit.
- Development bot logs should expose useful routing, policy, ignored-reason, and runtime checkpoint information.
- Never log credentials or expose them through errors, diagnostics, or unintended response fields. Deliberately issuing a scoped token or session cookie from its authoritative authentication boundary is allowed. Keep it minimal, short-lived where possible, and out of unrelated payloads.

## Test quality

- Every test must protect a credible regression in observable behavior or a meaningful invariant. Prefer policy boundaries, authorization/security, durable data behavior, lifecycle transitions, failure/retry/recovery, idempotency/concurrency, provider contracts, and user-visible interactions.
- Test production APIs and outcomes. Mock only real runtime boundaries such as network, database, filesystem, environment, clock, randomness, browser APIs, and external services.
- Do not add production exports, parameters, branches, wrappers, or test-only hooks solely to make testing easier.
- Do not add or retain tests whose only purpose is to restate source text, package metadata, TypeScript types, export existence, enum or constant contents, static navigation/catalog arrays, CSS classes, prose copy, or fixtures that merely equal themselves.
- Exact copy assertions are justified only when the text is itself a safety, security, destructive-action, protocol, or accessibility contract.
- Source/config inspection tests are justified only for intentional repository guards that cannot be exercised through a production API, such as forbidden-pattern, generated-output, release-policy, or secret-exclusion checks. State the invariant and test the guard against controlled fixtures rather than mirroring current source.
- When a low-value test is the only coverage near risky behavior, replace it with a behavioral test instead of simply deleting it.
- Prefer a few boundary-rich cases over matrices of equivalent examples. A useful test should fail for a plausible bug, explain the impact, and remain stable through harmless refactors.
- Coverage counts are evidence, not a goal. Passing tests do not replace reviewing real data flow, authorization, side effects, and failure paths.

## Documentation and Research

- Public documentation is frozen until Neonsy explicitly authorizes documentation work. Do not infer permission from implementation, release, or repository instructions.
- Keep internal Research notes accurate when durable behavior, architecture, operations, data ownership, or known production limits change.

## Validation and completion

- Validate proportionately with focused tests, typechecks, lint, generators, builds, and `git diff --check`. Run `pnpm check` from this folder when practical.
- For meaningful UI changes, inspect the real application when possible and verify loading, error, empty, retry, destructive, and responsive states.
- Before finalizing material work, perform a hostile review of the complete working-copy diff and relevant surrounding code. Fix in-scope P1/P2 issues and report remaining risks or skipped live validation honestly.

## Releases and handoff

- Releases are tag-driven from `main`: `web-vX.Y.Z` for web outputs and `bot-vX.Y.Z` for bot. Images receive version, `latest`, and commit-SHA tags.
- Never create or move release tags unless explicitly requested. Suggested versions move forward and never reuse or undercut an existing component tag.
- Shared-package changes do not automatically release every image, but persistence/schema changes must be coordinated with all deployed consumers.
- When work changes deployable behavior, end the final response with an H1 `Release Impact`. Report `Current Commit` for the whole current JJ/Git diff and `Since Last Release Tag` after checking relevant tags. Outputs are `bot`, `web`, and `web-docs`. Use `both web variants` for both web outputs and `both` for bot plus any web output. If no relevant tag exists, write `Since Last Release Tag: no release tag exists yet`.
