# NeonFlux Web Instructions

This file contains durable constraints for `apps/web`. Parent workspace instructions still apply.

## Product and visual behavior

- Build an operational dashboard with clear next actions, fast scanning, comfortable density, and stable, legible work surfaces.
- Show only state the system can establish. Never invent health, ranking, precision, recency, capacity, success, or availability.
- Use one shared route-header, spacing, semantic-color, and navigation language. Feature bodies may vary by task but must not invent independent chrome or raw hue systems.
- Scope dashboard tokens and ambient treatment to `.dashboard-theme`; do not leak them into public or documentation routes. Keep dense or safety-critical surfaces opaque, and use each border for one real containment owner.
- Put common actions and decision-relevant information first. Disclose identifiers, raw JSON, protocol data, and diagnostics deliberately.
- The shell owns persistent ambient work. Respect user and operating-system motion settings, pause or unmount expensive hidden work, exclude mobile particles, and do not remount it during ordinary navigation.
- Motion communicates continuity and state, never delays correctness. Permission loss, conflict, unknown outcome, and destructive-state changes remove stale actions immediately.

## Authorization and guild isolation

- Re-check every sensitive read and mutation server-side. Browser state, routes, cached guilds, previews, optimistic values, and visible controls are never authority.
- Read deployment behavior from durable `deployment_config`. Single mode authorizes only its effective configured guild; multi mode exposes only manageable guilds allowed by installation and DEFCON policy.
- Keep OAuth and Fluxer permission translation in `packages/fluxer` and shared access policy in `packages/core`.
- OAuth secrets, bot tokens, session secrets, signing or encryption keys, token exchange, private payloads, and provider bodies must not enter browser bundles or client-visible errors.
- Guild identity is a hard boundary for caches, queries, drafts, mutations, and persistent runtimes. Safe per-guild caches may survive a return; drafts, errors, selection, pagination, pending intent, conflict, response, and busy state reset on guild change.
- Catalog membership is server-authoritative. On transient failure retain the last confirmed catalog and mark it stale or errored. Redirect only after confirmed removal or failed authorization.

## Data, loading, and mutation state

- Use route loaders or server functions for protected identity, authorization, and shell facts. Use stable guild-scoped TanStack Query caches for UI-facing server state; direct reactive queries need a clearer scoped owner.
- Seed known route and guild facts once and render them immediately. Avoid waterfalls, duplicate authorization, broad invalidation, and placeholder flashes for known identity or chrome.
- Keep the stable shell, route identity, navigation, static feature chrome, and useful confirmed content mounted. Suspense, query, and error boundaries belong to the smallest independently useful island.
- Represent applicable cold, cached, refreshing, stale, empty, saving, success, retryable error, permission, conflict, partial-failure, unknown, reconciliation, reconnecting, and terminal states truthfully.
- Preserve confirmed data while refreshing. Retry becomes visibly busy, prevents duplicates, and settles to confirmed data or a new actionable error.
- Merge live and polled state monotonically. Older timestamps, decreasing counters, and terminal-to-active regressions must not replace newer confirmed state.
- Optimistic changes require reversible state, rollback, and focused authoritative revalidation. The cache is never durable truth.
- Do not retry an external mutation with unknown outcome automatically. Explain the uncertainty and use the feature's reconciliation or recovery path.
- Durable operations survive refresh or browser close only when canonical execution state is server-side. A spinner is not measured progress, a hidden row is not confirmed deletion, and a closed dialog is not completion.

## Route, bundle, and ownership boundaries

- Parent dashboard routes own only authorization, guild identity, stable shell and context, pending target identity, navigation, and genuinely cross-route runtime state.
- Each leaf route directly imports one focused feature entry. Do not re-export leaf implementations through a parent or broad barrel, switch siblings through one controller, or pass an all-surface property bag.
- Data isolation and client-code isolation are separate. A query key does not prove a separately bundled feature.
- Keep route files in the direct `createFileRoute(...)({...})` form required by the TanStack splitter. Never edit generated route output.
- Persistent runtimes own only state that survives sibling routes. Leaf mutations, pagination, editors, errors, and optional inspectors remain leaf-owned.
- Same-guild sibling navigation keeps the persistent owner mounted while the unresolved leaf changes. Pending identity is not authority. Cross-guild navigation removes stale content and unsafe transient state.
- Lazy-load charts, tree and diff explorers, syntax languages, and future animation runtimes at the interaction that needs them. Each lazy route or tool has local actionable code-load retry that preserves confirmed surrounding state.
- Navigation acknowledges intent synchronously, closes departing overlays safely, updates pending identity, and preserves correct focus for cancellation versus navigation.
- After route or import changes, regenerate routes, build production, and inspect the transitive graph. The bundle-boundary guard is the executable source for accepted imports and direct-entry ceilings. Parent shell and Blueprint runtime closures must exclude leaf-only implementations; explorers, deployment review, charts, and other heavy tools remain dynamic chunks. Raising a ceiling requires a measured production build and explicit justification.

## Styling, accessibility, and performance

- Tailwind utilities and shared dashboard recipes own ordinary layout, spacing, type, focus, and semantic-token styling. Use custom CSS only for genuinely cross-cutting or inexpressible behavior.
- Controls need intentional pointer and disabled cursors, visible keyboard focus, accessible names, and at least 44px touch targets where touch is expected.
- Critical actions are never hover-only. Dragging has a keyboard or direct-control alternative. Charts and visual state have text equivalents. Color and animation never carry meaning alone.
- Use effects only to synchronize external systems. Prefer server data, render-time derivation, event handlers, and stable query caches. Reserve layout effects for unavoidable pre-paint DOM measurement.
- Verify relevant responsive, zoom, short-height, keyboard, screen-reader, reduced-motion, empty and large data, and server-count states. Material navigation, sticky-action, or overlay work covers `1600x1000`, `1280x800`, `1024x768`, `768x1024`, `390x844`, short `800x300`, and `200%` zoom.
- Virtualize costly long collections when warranted, keep heavy work out of render, pause continuous hidden work, and avoid broad refetches.

## Blueprint Deploy contract

- Deploy has six user-facing stages: Source, Configure, Review, Safety, Confirm, and Deploy. Durable plan and run state owns the resumable stage; route search is only a navigation hint.
- The Deploy leaf owns the active journey and detailed run progress. History is retrospective and the cross-route Blueprint strip is suppressed on Deploy.
- Keep the stepper, reserved status region, summary, and primary-action owner stable while stage content changes. One visible primary action gives an actionable disabled reason.
- Browser state and confirmation inputs are never authority. Before enqueue, the server reloads and reauthorizes guild, plan, policy, delete set, preflight, fingerprints, and active-run state.
- Confirmation follows risk: none for non-destructive work; deletion acknowledgement for destructive synchronization; deletion and restore-point acknowledgements plus authoritative guild name for rebuild.
- Async stage changes replace content inside the stable Deploy shell rather than inserting progress, recovery, or safety cards above unrelated review content.

## Test and review standard

- Test behavior users, security, and data integrity depend on: authorization, redirects, cookie and token handling, secret non-disclosure, guild isolation, query lifecycle, stale and terminal ordering, rollback, retry, destructive confirmation, unknown outcomes, and accessible interaction.
- Drive components through accessible controls and assert semantic outcomes. Do not test classes, ordinary prose, static catalogs, generated route text, implementation-only DOM shape, or repeated behavior.
- Test navigation persistence through the real persistent owner and real navigation. Route and server tests call production loaders, functions, or rendered routes. Mock boundaries, not the behavior under test.
- Run focused web tests, lint, typecheck, route generation, and production build as applicable. Cross-cutting auth, routing, cache, shell, navigation, or ambient work requires the complete web suite.
- Inspect meaningful layout, hydration, interaction, overlays, responsiveness, loading, and motion in the real app when available. Observe first paint and delayed navigation, not only resolved screenshots. Report exactly what was and was not validated.
- Review the final diff for duplicated visual systems, copy, or separators; unjustified global CSS; width or hover regressions; cross-guild leakage; stale-state regressions; optional code in cold graphs; and ambient remounts.

## Documentation boundary

- Public Docs are frozen unless the task explicitly authorizes them. Preserve their visual system when documentation design is out of scope.
