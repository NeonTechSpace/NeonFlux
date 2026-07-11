# NeonFlux Bot Instructions

## Runtime boundaries

- Bot code uses DB/core services rather than accessing Convex tables directly when a service boundary exists.
- Every guild event passes through deployment-mode and guild-scope gating before feature logic or side effects.
- Bootstrap `deployment_config` from environment before mode-dependent behavior. Single mode compares only with the DB-effective configured guild. Multi mode is one bot token serving many guilds.
- Keep Fluxer SDK and HTTP behavior in `packages/fluxer` unless it is genuinely bot-only orchestration. Keep shared policy in `packages/core`. Do not copy web authorization logic.
- Long-running workers must make leases, fencing, idempotency, rate limits, retries, partial effects, crash recovery, and reconciliation explicit.
- Keep event routing and checkpoints observable without logging secrets, tokens, private payloads, or raw message content.

## Bot test standard

- Protect mode/guild gating, authorization and DEFCON decisions, event routing outcomes, worker state transitions, lease loss, retries, rate limits, partial effects, reconciliation, and provider failure handling.
- Test bot orchestration through production handlers/workers and assert durable or externally visible outcomes.
- Mock Fluxer, DB, time, and randomness boundaries. Do not replace the orchestration under test with mocks of its own internal helpers.
- Do not test registry/catalog ID lists, help prose, exported constants, or one-line delegation wrappers merely to mirror their implementation.
- Logging tests should protect level, redaction, and decision context, not formatting trivia or exact decorative text.
- Prefer table-driven cases only when rows represent distinct policies or failure classes, not interchangeable examples.

## Validation

- Run focused bot tests and bot typecheck for bot changes. Include affected core, DB, or Fluxer package checks when orchestration crosses those boundaries.
