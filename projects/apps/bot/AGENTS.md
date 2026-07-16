# NeonFlux Bot Instructions

Parent workspace instructions apply.

## Ownership and trust boundaries

- `apps/bot` is an I/O and orchestration layer. Canonical schemas, validation, planning, diffing, hashing, transition policy, and verification belong in their focused package.
- Use DB and core services instead of reading Convex tables directly when a service boundary exists.
- Keep Fluxer SDK and HTTP behavior plus provider translation in `packages/fluxer` unless it is truly bot-only lifecycle orchestration. Do not copy web authorization logic.
- Every guild event passes deployment-mode, guild-scope, installation, and DEFCON gates before feature logic or effects.
- Bootstrap durable deployment configuration before mode-dependent work. Single mode authorizes only the DB-effective configured guild; multi mode is one token serving multiple authorized guilds.
- The bot owns the Fluxer token, gateway lifecycle, provider mutation workers, and private Bot Internal API. Never send credentials, raw message bodies, or private provider responses to logs, Convex, web, or browser code.

## Workers and provider effects

- Long-running workers make leases, fencing, idempotency, rate limits, retry, partial effects, crash recovery, and reconciliation explicit. Persist enough intent to separate safe retry from ambiguous provider outcome.
- Never retry an aborted, timed-out, or transport-failed mutation automatically after provider work may have started.
- Admission control owns fairness and capacity. Serialize same-guild or resource work before acquiring a global active slot. Keep queue and scheduler state instance-owned.
- In-memory work still needs finite active and queue limits, per-item deadlines, propagated cancellation, fenced non-cancellable continuations, and observed late settlements.
- Shutdown stops intake, waits for a finite grace period, clears queued work, aborts active work where safe, observes late settlements, and emits one redacted aggregate warning.
- Every detached task and timer has instance-owned lifecycle, observed rejection, and explicit shutdown. Leave no module-global promise tail, unhandled `void` promise, or interval beyond the app instance.

## Blueprint mutation fence

- Convex permits one active Blueprint run per guild. Process a run only while its canonical protocol and fingerprint versions, lease ID, owner, expiry, and state remain valid.
- Read the protocol version from `@neonflux/blueprint`; never hard-code it here. The canonical protocol binds plan metadata, immutable full authority, compact execution authority, step and decision ledgers, and run cursors with domain-separated SHA-256 digests. Mixed or unsupported protocol, fingerprint, persisted-row, authority, ledger, cursor, or runtime contracts fail closed before provider access or mutation.
- Required order: claim under a fenced lease; validate persisted authority; read the restore observation; persist the restore point; read a separate authorization observation; obtain Convex authorization; then start provider step `0`.
- No mutation occurs after restore failure, preflight expiry, fingerprint disagreement, structure or capability change, divergent observations, or invalid lease.
- One provider observation uses one internally consistent representation of each collection. Do not combine independently fetched roles, channels, overwrites, or capabilities into one snapshot.
- Blueprint logs are structured and redacted. Never log snapshots, provider bodies, typed confirmations, credentials, cookies, tokens, or private environment data.

## Bot Internal API

- Start it after bot readiness and stop intake before provider-client teardown.
- Bind privately where practical. Bound bodies, response bytes, concurrency, and deadlines.
- Keep provider reads and posting-worker control in separate capability contracts with endpoint-specific JWT audiences; one capability token never authenticates the other.
- Require a short-lived JWT with configured issuer and explicit web-service subject and claims. Validate versioned request and response contracts strictly.
- The web caller authorizes user and guild before invoking it. Service authentication never grants resource access.
- Retry only when the read contract proves retry safe and capacity-bounded.

## Validation

- Test production handlers and workers through durable or externally visible outcomes.
- Protect applicable mode, guild, and DEFCON gates; routing; worker transitions; lease loss; retry; rate limits; partial effects; reconciliation; unknown outcomes; redaction; keyed ordering; fairness; overload; deadlines; cancellation; late settlement; and bounded shutdown.
- Mock Fluxer, DB, time, environment, and randomness boundaries, not the orchestration under test. Add no repetitive matrix, test-only seam, source-text check, or mock that merely confirms itself.
- Run focused bot tests and bot typecheck. Include affected feature, core, DB, and Fluxer package checks when orchestration crosses those boundaries.
