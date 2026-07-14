# NeonFlux Bot Instructions

Parent workspace instructions apply.

## Ownership and trust boundaries

- `apps/bot` is an I/O and orchestration layer. Canonical schemas, validation, planning, diffing, hashing, transition policy, and verification belong in their focused package.
- Use DB and core services instead of reading Convex tables directly when a service boundary exists.
- Keep Fluxer SDK and HTTP behavior plus provider translation in `packages/fluxer` unless it is truly bot-only lifecycle orchestration. Do not copy web authorization logic.
- Every guild event passes deployment-mode, guild-scope, installation, and DEFCON gates before feature logic or effects.
- Bootstrap durable deployment configuration before mode-dependent work. Single mode authorizes only the DB-effective configured guild; multi mode is one token serving multiple authorized guilds.
- The bot owns the Fluxer token, gateway lifecycle, provider mutation workers, and private provider-read service. Never send credentials, raw message bodies, or private provider responses to logs, Convex, web, or browser code.

## Workers and provider effects

- Long-running workers make leases, fencing, idempotency, rate limits, retry, partial effects, crash recovery, and reconciliation explicit. Persist enough intent to separate safe retry from ambiguous provider outcome.
- Never retry an aborted, timed-out, or transport-failed mutation automatically after provider work may have started.
- Admission control owns fairness and capacity. Serialize same-guild or resource work before acquiring a global active slot. Keep queue and scheduler state instance-owned.
- In-memory work still needs finite active and queue limits, per-item deadlines, propagated cancellation, fenced non-cancellable continuations, and observed late settlements.
- Shutdown stops intake, waits for a finite grace period, clears queued work, aborts active work where safe, observes late settlements, and emits one redacted aggregate warning.
- Every detached task and timer has instance-owned lifecycle, observed rejection, and explicit shutdown. Leave no module-global promise tail, unhandled `void` promise, or interval beyond the app instance.

## Internal provider-read service

- Start it after bot readiness and stop intake before provider-client teardown.
- Bind privately where practical. Bound bodies, response bytes, concurrency, and deadlines.
- Require a short-lived JWT with configured issuer, endpoint-specific audience, and explicit web-service subject and claims. Validate versioned request and response contracts strictly.
- The web caller authorizes user and guild before invoking it. Service authentication never grants resource access.
- Retry only when the read contract proves retry safe and capacity-bounded.

## Validation

- Test production handlers and workers through durable or externally visible outcomes.
- Protect applicable mode, guild, and DEFCON gates; routing; worker transitions; lease loss; retry; rate limits; partial effects; reconciliation; unknown outcomes; redaction; keyed ordering; fairness; overload; deadlines; cancellation; late settlement; and bounded shutdown.
- Mock Fluxer, DB, time, environment, and randomness boundaries, not the orchestration under test. Add no repetitive matrix, test-only seam, source-text check, or mock that merely confirms itself.
- Run focused bot tests and bot typecheck. Include affected feature, core, DB, and Fluxer package checks when orchestration crosses those boundaries.
