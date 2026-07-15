# NeonFlux Workspace Instructions

## Scope and priorities

- This file applies to the whole `projects` workspace. Deeper `AGENTS.md` files add subsystem constraints without weakening it.
- Questions, reviews, diagnoses, and status requests are read-only. Change only what the user requests or the requested implementation requires.
- Keep work within the requested outcome. Ask before a material choice changes an interface, durable data, a security boundary, ownership, dependency, or deployment.
- NeonFlux is unreleased and may accept coordinated schema or API breaks. This does not authorize data deletion or a destructive reset. Prefer a clean authorized cutover over migrations, compatibility shims, dual reads, deprecated fields, or legacy branches unless compatibility is requested.
- Before material work, inspect the relevant production path, contracts, tests, schemas, generated contracts, applicable instructions, Git/JJ state, and working-copy changes. Existing changes belong to the user.

## Source-of-truth map

- `convex/` owns durable application state, transactions, queues, leases, and live APIs. Convex is the only application database.
- `packages/blueprint` owns canonical Blueprint schemas, deterministic planning and diffing, digests, validation, and pure verification.
- `packages/messaging` owns outgoing-message schemas, normalization, hashing, and delivery policy.
- `packages/fluxer` owns Fluxer authentication, SDK and REST calls, provider DTO projection, rate-limit interpretation, and domain/provider translation.
- `packages/db` owns typed Convex transport and repository mapping, not domain truth.
- `packages/core` owns genuinely cross-feature policy such as deployment mode and DEFCON.
- `apps/bot` owns gateway lifecycle, the private provider-read service, mutation workers, and provider I/O orchestration.
- `apps/web` owns OAuth and sessions, server-side dashboard authorization, UI orchestration, public pages, and documentation routes.
- Keep one-consumer orchestration local. Share only a cohesive invariant or proven cross-feature lifecycle. Do not build a generic workflow engine or catch-all domain package.

When instructions, implementation, schemas, generated contracts, and tests disagree, inspect the runtime path and resolve the contradiction deliberately. Runtime behavior alone does not override an explicit contract. If an approved change alters a durable contract, update the nearest applicable `AGENTS.md` in the same work; otherwise report the conflict.

## Toolchain and repository safety

- Use pnpm 11. Keep workspace settings in `pnpm-workspace.yaml` and the Node pin in root `package.json` `devEngines.runtime`.
- Do not edit generated files manually. Change the source, run the owning generator, and inspect its diff.
- Without explicit permission, do not stage, commit, describe, bookmark, tag, push, squash, rebase, or otherwise mutate VCS.
- Never commit secrets, `.env`, generated `dist`, local database data, or machine-specific absolute paths.
- Root `.env` is application runtime configuration. `.env.local` may hold ignored Convex CLI deployment metadata but must not become application configuration. Add values through typed config, `.env.example`, and each affected operator or container path.
- Treat environment class as authority. Destructive tooling must fail closed for qualified, remote, named, or ambiguous targets and require exact target plus separate destructive confirmation. A dry run or convenient name is not authorization.
- Keep production modules cohesive. Roughly 500 lines triggers an ownership review, not a mechanical split.
- Repository additions must support requested behavior, credible regression protection, or necessary maintenance. Add no filler, repetitive or coverage-only tests, speculative scaffolding, redundant helpers, or needless compatibility. Remove additions that cannot justify their maintenance cost.
- During approved implementation, temporary untracked files outside the repository may support manual testing. Keep secrets and private data out and remove them afterward.

## Architecture and durable behavior

- Before changing persistence, define owner, source of truth, lifecycle, cardinality, retention and deletion, access paths, concurrency, reset behavior, and recovery. Each table owns one durable concept.
- Use dedicated records for workflows, entities, logs, approvals, counters, leases, and user data. Generic guild settings are only for small configuration.
- Runtime environments are development and production; there is no staging. Bootstrap deployment configuration explicitly and read effective behavior from its durable record, not copied entity fields or browser-visible values.
- Use `neverthrow` for expected recoverable runtime failures. Each importing package declares it directly.
- For external effects, identify relevant partial failure, idempotency, concurrency, rate limits, retries, crash recovery, and reconciliation. Never imply cross-system atomicity or retry a non-idempotent mutation after its outcome becomes ambiguous. Persist intent before provider I/O when recovery needs proof an attempt started.
- Durable workers require bounded work, leases and fencing, idempotent claims, finite deadlines, monotonic checkpoints, graceful shutdown, and explicit terminal or unknown outcomes.
- In-memory schedulers and queues require finite active and queued capacity, per-item deadlines, supported cancellation, fenced non-cancellable continuations, observed late settlements, and bounded shutdown. Serialize keyed work before taking scarce global capacity.
- Retention jobs validate configuration before deletion, use one cutoff per run, process bounded dependency-safe batches, protect active, recoverable, and unknown records, and fence concurrent work. The owning feature defines retention with its durable schema and worker behavior.
- Workspace packages may expose source for development and built artifacts for production only through explicit resolver conditions. Validate the real production consumer command; production must not depend on TypeScript source.
- Persisted Blueprint plan or run semantics and protocol changes require one coordinated protocol bump and Convex, bot, and web cutover. Mixed backend, consumer, browser, durable-row, or fingerprint versions fail closed. Add no compatibility branch unless requested.
- Generic Convex JSON validators are storage envelopes, not domain validation. Successful Blueprint snapshots, persisted plan authority, plan steps, and preflight reports must pass the canonical `@neonflux/blueprint` parser at the Convex write boundary. Workers validate persisted authority again before provider access.
- Keep Blueprint plans, ordered steps, decisions, approvals, expiring preflights, runs, run attempts, observations, and structure backups as separate durable concepts. Successful backup rows own a canonical snapshot; failed capture rows may omit it. Do not collapse distinct lifecycles for naming or document-count convenience.
- Convex owns Blueprint durable state, transactions, queue admission, one-active-run-per-guild enforcement, leases, mutation authorization, and audit writes. The bot owns provider observations and mutations. The web owns authenticated orchestration and interaction, never mutation authority.
- Before provider step `0`, a Blueprint worker persists a restore point, makes a second fresh observation, and obtains lease-fenced Convex authorization. Structure, capability, observation, expiry, lease, or protocol disagreement stops before mutation.
- Never retry Blueprint provider work automatically when its outcome may be ambiguous. Successful backup summary counts come from the validated stored artifact, not caller counters.
- Application startup and container entrypoints must not depend on migrations, destructive resets, source-only package resolution, or smoke helpers.

## Security and observability

- Re-authorize every sensitive read and mutation at its authoritative server or Convex boundary. Browser state, routes, cached guild lists, previews, and visible controls are never authority.
- The Fluxer bot token belongs only to the bot runtime. Never expose it to browser, web server, Convex, logs, errors, fixtures, or reports.
- Treat internal HTTP and service calls as trust boundaries: bind privately where practical, bound bodies, concurrency, and deadlines, validate versioned contracts, verify issuer, endpoint audience, and service claims, and authorize the resource separately.
- Keep routing, policy, checkpoint, queue-age, worker-health, and failure signals useful and correlated. Never log credentials, private provider bodies, raw message content, or encrypted payloads.

## Test and validation standard

- Tests protect credible regressions in observable behavior or meaningful invariants: authorization, data integrity, lifecycle transitions, failure and recovery, idempotency and concurrency, provider contracts, and user-visible interaction.
- Test production APIs and outcomes. Mock runtime boundaries such as network, database, filesystem, environment, clock, randomness, browser APIs, and external services.
- Add no test-only production seam or test that merely restates types, constants, metadata, static arrays, source text, CSS classes, ordinary copy, or self-equal fixtures. Exact copy is appropriate only for security, destructive-action, protocol, or accessibility contracts.
- Prefer a few boundary-rich cases over equivalent matrices. Each test must fail for a plausible bug and survive harmless refactoring.
- Validate proportionately with focused tests, typechecks, lint, generators, production builds, and `git diff --check`. Run `pnpm check` for material cross-cutting or release work unless the environment prevents it, and report the gap.
- For meaningful UI work, inspect the rendered application when possible, including loading, error, empty, retry, destructive, unknown, responsive, and accessibility behavior. Mocked or static checks are not authenticated runtime validation.
- Before completion, review the full diff and affected data flow adversarially. Fix introduced P1/P2 issues and report skipped live or destructive validation.

## Documentation and releases

- Public documentation is frozen unless the task explicitly authorizes it. Do not infer authorization from implementation, UI, or release work.
- Releases are tag-driven from `main`: `web-vX.Y.Z` for both web outputs and `bot-vX.Y.Z` for bot. Images receive version, `latest`, and commit-SHA tags.
- Never create or move release tags without explicit permission. Suggested versions only move forward.
- Shared-package changes do not automatically release every image, but persistence or protocol changes require coordinated deployment of every affected consumer.
- When work changes deployable behavior, end with an H1 `Release Impact`. Report `Current Commit` for the working diff and `Since Last Release Tag` after checking relevant tags. Outputs are `bot`, `web`, and `web-docs`; use `both web variants` for both web outputs and `both` for bot plus any web output. State when no relevant tag exists.
