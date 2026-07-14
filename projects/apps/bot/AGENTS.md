# NeonFlux Bot Instructions

## Runtime boundaries

- Bot code uses DB/core services rather than accessing Convex tables directly when a service boundary exists.
- Every guild event passes through deployment-mode and guild-scope gating before feature logic or side effects.
- Bootstrap `deployment_config` from environment before mode-dependent behavior. Single mode compares only with the DB-effective configured guild. Multi mode is one bot token serving many guilds.
- Keep Fluxer SDK and HTTP behavior in `packages/fluxer` unless it is genuinely bot-only orchestration. Keep shared policy in `packages/core`. Do not copy web authorization logic.
- Long-running workers must make leases, fencing, idempotency, rate limits, retries, partial effects, crash recovery, and reconciliation explicit.
- Admission control owns both fairness and capacity. Serialize same-guild or same-resource work before acquiring a global active slot so waiting work cannot starve unrelated keys. Keep scheduler state instance-owned rather than in module-global promise tails.
- Best-effort in-memory workers still require finite active and queue limits, a per-item deadline, cancellation propagated through DB/provider boundaries that support it, fencing around continuations that do not, and bounded shutdown. On shutdown, stop intake, allow a finite grace period, then clear queued work, abort active work, observe late settlements, and emit one redacted aggregate warning rather than hanging or producing an error storm.
- Fence non-cancellable provider continuations before persistence, and never automatically retry an aborted or timed-out mutation when the provider outcome may be unknown.
- A bot-owned internal read service is a separate trust boundary: start it only after bot readiness, stop intake before client teardown, require a short-lived JWT with the configured issuer, endpoint-specific audience, and explicit service subject/claims, strictly validate versioned payloads, bind privately where practical, and cap concurrency, response bytes, and deadlines. The caller must still authorize the user and guild before invoking it. Do not automatically retry a provider-backed request unless its contract explicitly proves the retry safe and capacity-bounded.
- Every detached task and timer has an instance-owned lifecycle, an observed rejection path, and explicit shutdown behavior. Do not leave unhandled `void` promises, module-global tails, or intervals that outlive the app instance.
- Keep event routing and checkpoints observable without logging secrets, tokens, private payloads, or raw message content.

## Bot test standard

- Protect mode/guild gating, authorization and DEFCON decisions, event routing outcomes, worker state transitions, lease loss, retries, rate limits, partial effects, reconciliation, and provider failure handling.
- For schedulers and in-memory workers, cover per-key ordering, cross-key fairness, overload rejection, deadlines, bounded shutdown, abort propagation, and late settlement when those behaviors exist.
- Test bot orchestration through production handlers/workers and assert durable or externally visible outcomes.
- Mock Fluxer, DB, time, and randomness boundaries. Do not replace the orchestration under test with mocks of its own internal helpers.
- Do not test registry/catalog ID lists, help prose, exported constants, or one-line delegation wrappers merely to mirror their implementation.
- Logging tests should protect level, redaction, and decision context, not formatting trivia or exact decorative text.
- Prefer table-driven cases only when rows represent distinct policies or failure classes, not interchangeable examples.

## Validation

- Run focused bot tests and bot typecheck for bot changes. Include affected core, DB, or Fluxer package checks when orchestration crosses those boundaries.
