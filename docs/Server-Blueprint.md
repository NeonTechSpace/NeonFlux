# Server Blueprint

Server Blueprint plans and applies complete server-layout changes while keeping destructive actions reviewable and recoverable.

## Normal workflow

1. Capture or import a server layout.
2. Choose the target server and deployment mode.
3. Review the exact roles, categories, channels, permissions, and ordering changes.
4. Approve that exact plan.
5. Re-read the live server and block the run if it changed after review.
6. Save a restore point.
7. Let the bot apply the checked steps.
8. Read the live server again and verify the result.
9. Reconcile partial or uncertain results instead of replaying them blindly.

## Deployment modes

| Mode                    | What it does                                                           |
| ----------------------- | ---------------------------------------------------------------------- |
| Match blueprint         | Updates managed content and removes unmatched eligible target content. |
| Merge without deletions | Creates and updates while preserving unrelated target content.         |
| Reset and rebuild       | Removes eligible target structure and recreates the requested layout.  |

The review screen shows the real create, update, and delete counts. Destructive confirmation is tied to the approved plan and its latest live-server check.

## The records have different jobs

- A **plan** is the exact proposed change set.
- An **approval** records who approved a specific plan digest.
- A **safety check** records the current live-server fingerprint and any blockers.
- A **step** is one ordered provider change.
- An **attempt** records one try at a step, including uncertain outcomes.
- A **run** is one attempt to apply an approved plan.
- A **restore point** captures the target before changes begin.

These records remain separate so progress, history, retries, and recovery are explicit.

## When NeonFlux stops

NeonFlux refuses to start or continue when the approved plan is stale, the safety check expired, the target changed, authorization was lost, the lease is invalid, or a provider result is uncertain.

An uncertain mutation is not replayed automatically. The run is left visible for reconciliation.

## Other Blueprint tools

The dashboard also exposes manual and scheduled backups, retention controls, drift checks, comparison, run history, pause or cancel controls, and recovery plans.

For durable storage and guarded reset behavior, read [Convex](Convex.md). For process ownership, read [How NeonFlux works](How-NeonFlux-Works.md).
