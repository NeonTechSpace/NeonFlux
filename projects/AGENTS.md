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
- Root `.env` is the local application runtime source of truth. An ignored `.env.local` may contain Convex CLI deployment metadata, but application code and scripts must not treat it as configuration. Add environment variables through the typed `packages/config` boundary, `.env.example`, and every affected container/operator path. Use the guarded Convex configuration workflows for values owned by a remote deployment.
- Keep new or substantially rewritten handwritten production modules focused and generally below 555 LOC.
- Treat environment class as an authority decision, not a naming convention. Destructive tooling must fail closed for named, qualified, remote, or otherwise ambiguous targets. Require explicit target confirmation and a separate destructive confirmation unless the target is positively established as disposable development state. A dry run, target name substring, or convenient default is not authorization.

## Architecture and runtime

- Before cross-cutting feature work, establish a concrete ownership map: stable shell, leaf features, durable and transient state owners, async/data boundaries, client-code boundaries, failure containment, and validation evidence. Share code only for a cohesive invariant or genuinely cross-feature lifecycle. Do not create a coordinator, broad context, or catch-all property bag merely because several sibling features are nearby.
- Convex is the only durable application database. Do not add Postgres, Drizzle, SQLite, `node:sqlite`, local database files, or dual-store fallbacks.
- Runtime environments are development and production. There is no staging environment.
- Handle `INSTANCE_MODE` bootstrap and DB-effective mode behavior with explicit `switch` statements.
- Deployment behavior belongs in the dedicated `deployment_config` row, never copied into entity rows such as `bot_installations`.
- Keep authoritative shared domain and platform contracts in `packages/*`. Bot and web consume them through workspace imports. Keep one-consumer orchestration local, and do not create a shared package abstraction for hypothetical reuse.
- Use `neverthrow` for expected recoverable runtime failures. Every importing package declares it directly.
- Model durable data before changing schema: ownership, authority, lifecycle, cardinality, retention/deletion, access paths, concurrency, and recovery. Each table owns one durable concept.
- Use guild-scoped generic settings only for small configuration. Give workflows, records, logs, approvals, counters, leases, and user data dedicated tables.
- For external side effects, make partial failure, idempotency, retries, rate limits, concurrency, crash recovery, and reconciliation explicit. Do not claim cross-system atomicity.
- Long-lived or externally triggered schedulers and in-memory queues must bound queued and active work. When ordering is keyed, serialize before scarce global capacity is consumed so waiters do not occupy active slots. Apply per-item deadlines, propagate cancellation through boundaries that support it, fence non-cancellable continuations, observe late settlements, and stop within a finite grace period. Never automatically retry a mutation whose external outcome became ambiguous.
- Retention and deletion jobs must validate configuration before deleting, use one fixed cutoff per run, delete in bounded dependency-safe batches, protect active or unknown-outcome records, and use claims or fencing when concurrent runs are possible. Historical growth, audit, and completed Blueprint workflow data defaults to 90 days through `NEONFLUX_DATA_RETENTION_DAYS`, accepts only integer values from 1 through 730, and has no archive outside that window. Do not conflate this with the separate per-guild structure-backup retention policy.
- Workspace packages may expose source in development and built artifacts in production only through explicit resolver conditions and fallbacks. Production resolution must not depend on TypeScript source. Validate the actual consumer command with its real environment and production build rather than treating a manually invoked resolver in a different mode as evidence.
- Changes to Blueprint persisted action-ledger or normalization semantics, reference or ID-map transitions, provider outcome or replay classification, enqueue, claim, attempt, checkpoint, control, finalization, or progress semantics must bump the shared execution protocol in `convex/runtime_contract_model.ts`, `packages/db/src/runtime-contract.ts`, and `apps/web/src/dashboard-structure-execution-protocol.ts`. Persist the protocol on every execution and fence every execution boundary against it. Mixed backend, consumer, browser, or durable-row versions must fail closed. Do not add compatibility branches.
- Do not make application startup or Docker entrypoints depend on migrations, application Postgres bootstrap, source-only package resolution, or import/smoke helpers. Explicit operator and development verification scripts remain outside the runtime path.

## Product and interaction direction

- Organize user-facing workflows around the user's intent, current decision, and next safe action rather than internal services, persistence stages, or protocol terminology.
- Before implementing a user-facing feature with asynchronous work, define its stable identity and static chrome, smallest independently loading data islands, source and cache ownership, cold/cached/refreshing/empty/error/mutation states, retry behavior, and client-code boundary. Parent shells must not statically import leaf-only feature implementations or optional heavy tools merely to coordinate navigation or pending UI.
- Keep necessary safety gates, but present them as one ordered, understandable state model. Explain why progress is blocked, what remains safe, and the exact action that resolves each blocker.
- Use progressive disclosure. Put the common path and decision-relevant information first. Keep raw payloads, identifiers, logs, and protocol details available as secondary technical inspection rather than the primary interface.
- Match the representation to the problem. Use scoped navigation, hierarchy, diff views, filters, summaries, and contextual details for large or structured change sets instead of stacking unrelated domains or reducing them to flat lists and serialized data.
- Treat the selected tenant, guild, account, resource, or comparable authority scope as a hard state boundary. Reuse confirmed data only within the same scope, retain useful per-scope caches when safe, and reset transient selections, drafts, errors, pagination, and busy state when scope changes.
- When users reasonably expect external changes to appear live, reconcile them promptly and make freshness, reconnecting, degraded transport, and retained-last-confirmed behavior visible. A non-critical failure may remain non-blocking, but it must not become silent or make stale data look authoritative.

## Security and observability

- Re-check authorization at the authoritative boundary. Minimize scopes and keep guild/user ownership explicit.
- Treat every internal HTTP or service-to-service call as a trust boundary. Bind privately where practical, bound bodies/concurrency/deadlines, strictly validate request and response contracts, and version the wire protocol when independently deployed consumers can drift. For JWT-authenticated calls, verify the configured issuer and require an endpoint-specific audience plus explicit service subject/claims. Do not automatically retry mutations. Authenticate the end user and guild before the call. Service authentication does not replace resource authorization.
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

- Validate proportionately with focused tests, typechecks, lint, generators, builds, and `git diff --check`. Run `pnpm check` from this folder for material cross-cutting or release-affecting changes unless the environment prevents it, and report the exact gap when it cannot run.
- For meaningful UI changes, inspect the real application when possible and verify loading, error, empty, retry, destructive, and responsive states.
- Before finalizing material work, perform a hostile review of the complete working-copy diff and relevant surrounding code. Fix in-scope P1/P2 issues and report remaining risks or skipped live validation honestly.

## Releases and handoff

- Releases are tag-driven from `main`: `web-vX.Y.Z` for web outputs and `bot-vX.Y.Z` for bot. Images receive version, `latest`, and commit-SHA tags.
- Never create or move release tags unless explicitly requested. Suggested versions move forward and never reuse or undercut an existing component tag.
- Shared-package changes do not automatically release every image, but persistence/schema changes must be coordinated with all deployed consumers.
- When work changes deployable behavior, end the final response with an H1 `Release Impact`. Report `Current Commit` for the whole current JJ/Git diff and `Since Last Release Tag` after checking relevant tags. Outputs are `bot`, `web`, and `web-docs`. Use `both web variants` for both web outputs and `both` for bot plus any web output. If no relevant tag exists, write `Since Last Release Tag: no release tag exists yet`.
