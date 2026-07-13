# NeonFlux Web Instructions

This file is the durable product, design, interaction, and client-state authority for `apps/web`. A contributor must be able to make a visually and behaviorally coherent dashboard change from this file without reconstructing taste from dashboard redesign history. Feature-specific Research remains authoritative for domain protocols, destructive workflows, and backend guarantees.

## Product direction

- Build an operational dashboard that feels alive, fluent, and lightly game-like without becoming noisy, toy-like, or theatrical. The target is confident software with atmosphere around the work and calm, legible surfaces where work happens.
- Reject sanitized sameness, stale black canvases, generic SaaS card grids, excessive glass, rainbow decoration, and animation added merely to prove that the interface moves.
- Optimize for obvious next actions, fast scanning, comfortable density, and low cognitive load. A user should not need to decode the layout or hunt for a server, feature, state, or recovery action.
- Remove low-value information. Do not repeat the page introduction inside its first panel, repeat the active server where the page header already identifies it, label every server card with the same action, expose raw ids as primary identity, or render empty metrics and placeholder destinations to make a page look populated.
- Use truthful copy and state. Never invent health scores, rankings, precision, recency, capacity, success, or availability that the product cannot establish authoritatively.
- Judge UI from the rendered composition, interaction, and state transitions, not from isolated component names or Tailwind classes. Before accepting a visual change, inspect how its spacing, borders, backgrounds, hierarchy, and motion combine with the surrounding page.
- Prefer one strong hierarchy over several competing systems. Route chrome, subnavigation, task surfaces, and ambient visuals must reinforce one another rather than each introducing a new layout or palette.

## Dashboard visual system

- Scope dashboard tokens and ambient treatment to `.dashboard-theme`. Do not leak the dashboard theme into public or documentation routes.
- Use the Living Flux palette as the semantic baseline:
    - canvas `#07090f`.
    - navigation `#0b1018`.
    - work surface `#0e1520`.
    - raised surface `#141d2b`.
    - primary text `#f6f8fb`.
    - muted text `#aab6c6`.
    - border `#29384b`.
    - live/interactive cyan `#5ad7ff`.
    - creative violet `#9d8cff`.
    - success emerald `#43d6a0`.
    - warning/waiting amber `#f5bd4f`.
    - danger rose `#ff718a`.
- Cyan means live connection or primary interaction. It is not generic success. Use semantic state colors consistently and never make a feature invent a second raw Tailwind-hue theme.
- Dense and safety-critical work surfaces must be opaque or nearly opaque. Tinted glass is appropriate for navigation, overlays, previews, and deliberately selected showcase surfaces. Atmosphere belongs around the work. Stable contrast belongs inside it.
- Borders communicate real containment, overlays, focus, or one semantic separation. Do not wrap every control or navigation row in a card. Do not create duplicate horizontal rules by placing adjacent `border-b`, `border-t`, or `border-y` treatments around the same boundary. One semantic separator has one owner.
- Preserve breathing room without wasting space. Use compact density for navigation, tables, lists, settings, and repeated controls. Use more space for builders, previews, first-use states, and high-risk confirmation.
- Avoid hover transforms that shift content or make neighboring geometry appear to jump. Cards, rows, and server entries should remain spatially stable. Use restrained color, opacity, border, wash, and glow feedback instead of lift, scale, or abrupt gradient repositioning.

## Shared feature-page contract

- Every dashboard feature uses one responsive frame: 16px mobile gutters, 24px intermediate gutters, 32px desktop gutters, and a bounded workspace up to 100rem.
- Use one route-header rhythm: icon crest, category eyebrow, one `h1`, concise description, then optional subnavigation or status. The task body starts below this invariant frame.
- Pending, cached, resolved, empty, and error views retain the same route identity, width, and header geometry. Async completion must not snap from a category shell or narrow placeholder into the real feature layout.
- Operational workspaces use the full available task column by default. Narrow only a genuinely focused reading, confirmation, or small-form flow. Do not make Command Prefix, Blueprint, or future substantial tools look arbitrarily half-width.
- Feature-specific composers, resource lists, forms, previews, timelines, trees, explorers, and builders may have distinct task bodies. They must not invent distinct page chrome, spacing systems, heading hierarchy, or color language.
- Subnavigation destinations use task-specific Lucide icons. Do not repeat the parent job icon for several children. The parent communicates the domain and each child icon identifies the concrete tool.
- Zero-signal workflows render one useful, truthful first-use state with a clear action. Do not stack an empty metric layer, repeated introduction, and another empty card.
- Blueprint remains one readable operational surface containing its shared route header, Current/Backups/Compare/Deploy/Runs navigation, operation status, and active subview. `Server Blueprint` is the only `h1`. Subviews begin with `h2`. Keep a restrained readable background so copy never floats directly on the noisy ambient field.

## Navigation and server switching

- Desktop uses one sleek 256px translucent navigation ribbon containing server context, command search, job navigation, appearance controls, and account actions. It must not look like a large panel filled with stacked bordered cards.
- Intermediate widths use the same navigation system as a 72px icon rail. Mobile uses a compact top bar and one modal navigation sheet. Do not create separate guild, category, appearance, and account strips.
- Category rows are borderless with calm hover feedback. The active route uses a narrow cyan edge and restrained horizontal wash. Child routes sit on a light hierarchy line. Keep disclosure controls within the row rhythm.
- Center appearance and account actions in the navigation footer at expanded, rail, and mobile-sheet widths.
- Capability metadata is the source of truth for navigation. Show only usable shipped guild capabilities. Hide jobs with no available children. One available child may become a direct destination. Two or more form an expandable group. Registered placeholders and future routes do not appear in ordinary navigation or command search.
- Keep account OAuth controls and platform/deployment/Convex administration out of guild settings. Guild, account, and platform are separate authority scopes and future shells.
- In single-instance mode, show honest inert server identity and no server picker. In multi-instance mode, always expose server switching because All Servers and Invite Bot remain useful even when only one manageable server exists.
- The dashboard server switcher is compact navigation, not a large showcase card. Use an anchored 24rem desktop popover and a short-height-safe mobile bottom sheet. Server rows are 56px with 36px avatars. Put All Servers and Invite Bot in a distinct footer.
- Keep current and pending server states explicit without repeated descriptions or hover lift. The current server remains authoritative until route data commits. A requested switch may show a trusted pending preview.
- The initial server launcher may use polished server tiles. Tiles must use their interior space purposefully, highlight the whole card on hover/focus, remain spatially stable, and avoid identical low-value action copy.
- Portaled server, appearance, command, sheet, and popover surfaces must escape navigation scroll containers, anchor to their trigger, own focus, close on Escape and outside viewport interaction, preserve usable internal scrolling, and return focus correctly.
- `Cmd/Ctrl+K` searches only shipped routes and manageable servers. Rank exact, prefix, word, substring, and token matches. Support Arrow keys, Home, End, Enter, Escape, pointer, and focus interaction. It may navigate or open safe surfaces but must not execute destructive or externally mutating actions.

## Living Flux ambient contract

- The ambient dashboard is a persistent shell-level system, not route content. Navigating between All Servers and a selected server, or among dashboard features, must not remount it, restart shader time, respawn particles, or visibly change the composition.
- Composite the background in this exact back-to-front order:
    1. visible deep navy/cyan/violet CSS gradient.
    2. transparent native WebGL fluid metaballs.
    3. restrained noise texture.
    4. desktop particle canvas and proximity links.
    5. vignette.
- The CSS gradient is always the visible foundation. Never replace it with black. Fluid blobs extend the same palette subtly and must read as integrated gel-like movement behind the particles, not as bright foreground balloons or detached glowing circles.
- The fluid renderer is purpose-built native WebGL: one full-screen quad, nine analytic low-alpha cyan/electric-blue/violet/magenta metaballs, a 320,000-pixel ceiling, and a 30fps ceiling. Do not introduce a general shader, canvas, or animation package for it without an approved architectural change supported by measured evidence.
- The desktop particle field sits above the fluid layer. It uses sharp native circles, crisp proximity links, density scaled from a 1600x900 reference, no retina scaling, and a 45fps ceiling. Pause it offscreen and when the page is hidden. Do not mount it on mobile, under operating-system reduced motion, or while Reduced Effects is active.
- Particle interaction is local and precise: nearby nodes grow visibly, visible proximity lines can be highlighted across their full segment, and temporary pointer-local connections may appear. Keep the focus threshold tight enough that distant lines do not glow, while ensuring every visible part of a line remains interactive.
- Dashboard appearance exposes exactly three independent controls: Reduced Effects, Fluid Blobs, and Particles. All are real buttons with pointer cursors, accessible names, focus treatment, and truthful pressed state. Do not restore particle blur or a blur toggle.
- Fluid Blobs mounts or removes only the WebGL layer. It must leave the gradient, particles, noise, and composition intact.
- Particles mounts or removes only the particle layer. It must not respawn or reconfigure the fluid field.
- Reduced Effects retains the rich static gradient, noise, and current color composition. Freezes the fluid renderer at its current elapsed time. Unmounts particles. Removes backdrop/dialog blur. And suppresses Motion transitions, CSS pulses, spinners, disclosure rotations, and press scaling. It must not reset the shader clock, rotate the background, substitute a different composition, or collapse to black.
- Operating-system reduced motion follows the same motion-safety principles while preserving all information, controls, focus states, and state semantics.

## Motion, GSAP, and Rive ownership

- Every visual change has one motion owner. Multiple layers must not animate the same geometry or semantic transition.
- CSS owns hover, focus, pressed, disabled, and short color/opacity feedback.
- Motion owns routine React state and layout continuity: route arrival, internal view changes, navigation indicators, the Server Dock, sheets, drawers, responsive panes, builders, list insertion/removal, confirmed-value changes, and optimistic settlement.
- Use these default timing budgets: route arrival 200ms, internal view change 180ms, selection gel 150ms, list insertion 160ms, confirmation 140ms. Deviate only when the interaction demonstrably needs it.
- Motion must preserve spatial continuity. Do not animate virtualized Audit geometry, create hover lift on repeated rows/cards, or let layout animation cause text and controls to shift suddenly.
- Safety, conflict, reconciliation, unknown-outcome, permission-loss, and destructive-confirmation changes remove stale or unsafe controls immediately. Do not wait for exit choreography when correctness changed.
- GSAP is not a replacement for Motion. Reserve it for a future route-lazy Blueprint execution replay only after a durable ordered replay ledger, approved storyboard, labelled/scrubbable timeline, canonical static representation, reduced-motion behavior, scoped cleanup, and explicit bundle budget exist.
- Rive is not generic decoration. Reserve it for a future project-owned installation/system-status state machine only after canonical states, editable `.riv` source, named inputs, documented mappings, DOM-owned labels/actions/live announcements, static and load-failure fallbacks, reduced-motion behavior, state-by-state QA, route-lazy loading, one-active-canvas enforcement, CSP compatibility, and an explicit runtime-plus-asset budget exist.

## Authority, guild boundaries, and live state

- Re-check authorization server-side for every mutation and sensitive read. Browser state, routes, cached guild lists, previews, optimistic values, and visible controls are never authority.
- Read deployment behavior from `deployment_config`, not `INSTANCE_MODE` or `SINGLE_GUILD_ID` environment variables.
- Single mode authorizes only the DB-effective configured guild. Multi mode exposes only OAuth guilds for which the user has Manage Server permission and the authoritative installation/DEFCON policy permits access.
- Keep OAuth and Fluxer permission translation in `packages/fluxer`. Keep shared dashboard access policy in `packages/core`. Keep OAuth client secrets, bot tokens, session secrets, encryption keys, token exchange logic, private payloads, and provider response bodies out of browser bundles and client-visible errors.
- Treat guild identity as a hard boundary across every feature and view. Every server-state query and cache key must be guild-scoped. Never display data retained from the previously selected guild.
- Preserve separate per-guild caches so returning to a guild can be fast, but remount or reset transient drafts, validation errors, pagination, selections, pending intents, local conflict state, and busy state when guild identity changes.
- Use route loaders or server functions for protected initial identity, authorization, and shell facts. Use TanStack Query for UI-facing server state. Use a direct authorized reactive query only when its ownership and lifecycle are clearer than query-cache invalidation.
- Seed known route/guild data into stable query caches once. Names, icons, ids, access facts, and initial catalogs must render immediately rather than being fetched again by each layer. Avoid request waterfalls, duplicate authorization, and broad invalidation when a focused query is sufficient.
- The full launcher and compact switcher share the `dashboard/guild-catalog` query. Either loader may seed it. Mounting the live layer must not cause a duplicate initial request.
- Catalog membership is server-authoritative. The browser may retain display state but never grants access or fabricates membership.
- While a dashboard page is visible, refresh the authoritative OAuth guild catalog every 15 seconds and immediately on focus or reconnect. Do not poll hidden pages. Provider limits must be stated honestly. The current catalog is bounded to the provider's first 200 guilds until pagination is implemented and validated.
- Installation and effective DEFCON changes use the durable Convex catalog-version signal to invalidate the shared catalog immediately. Treat the signal as a hint to re-read canonical data, not as the catalog itself.
- A transient OAuth, network, or database failure retains the last confirmed catalog and marks it stale/error with recovery. It must not manufacture an empty list, revoke client access, or redirect away from the active guild based on an unconfirmed failure.
- If a confirmed authoritative refresh removes the active guild, replace to `/dashboard`. Invalid or inaccessible guild routes also redirect to `/dashboard`. Unknown subroutes under a valid authorized guild redirect to that guild's dashboard root after authoritative access validation.
- A Fluxer guild-delete event marked `unavailable: true` is a temporary outage, not an uninstall. Do not delete installation state or increment catalog membership version for the temporary condition.

## Loading, refresh, and workflow state

- The router uses instant pending (`defaultPendingMs: 0`, `defaultPendingMinMs: 0`), but the stable dashboard/docs shell, route identity, navigation, and useful cached content remain mounted.
- Put loading state in the panel or control doing the work. Avoid page-wide skeletons when a useful shell, confirmed data, or stable task frame exists.
- Render already-known data immediately. Do not flash placeholders for names, icons, ids, headers, or selections that loaders or cache already know.
- Prefer stale-while-refresh behavior for confirmed data. Keep the last confirmed value visible, distinguish refreshing from initial loading, expose refresh failure or staleness honestly, and offer focused retry/reconnect where useful.
- Async UI must represent meaningful states explicitly: cold loading, cached, refreshing, stale, empty, saving, success, retryable error, permission change, conflict, partial failure, unknown outcome, reconciliation, reconnecting, and terminal completion when those states can occur.
- Never let an older response overwrite newer, confirmed, or terminal state. Merge live updates monotonically: reject older timestamps, decreasing counters, and terminal-to-active regressions. A genuinely newer execution for the same logical run may replace the earlier terminal execution only when its durable identity/order proves that it is newer.
- Optimistic updates require a reversible local change, rollback on failure, and authoritative invalidation/revalidation. The UI cache never becomes the source of truth.
- Do not automatically retry an external mutation with an unknown outcome. Preserve the last confirmed state, explain uncertainty, and require an explicit recovery or reconciliation path.
- Long-running user-facing operations must survive refresh and browser close when the feature contract promises durability. Store canonical execution state server-side. Use lightweight live signals for invalidation. And perform one canonical read when terminal state is indicated.
- Keep the UI responsive during non-abortable work, but do not stack retries or duplicate mutations. Model deadlines, reconnect behavior, idempotency, partial completion, and terminal transport failure explicitly.
- Loading feedback must not lie. A spinner is not evidence of progress, a locally hidden row is not successful deletion, and a closed dialog is not confirmed completion.

## Styling and component ownership

- Tailwind utilities and shared dashboard recipes own component layout, spacing, sizing, typography, state, focus, and semantic-token styling.
- Custom CSS is limited to genuinely cross-cutting or otherwise inexpressible needs: scoped theme variables, the ambient base gradient, glass pseudo-elements, media/preference overrides, and the short-height navigation scrollbar. Do not move ordinary component styling into a global CSS file for convenience.
- Prefer focused components with explicit ownership. Shared feature frames, buttons, fields, status treatments, and navigation recipes should converge visually. Do not copy a near-match and let each route drift.
- Avoid `!important`, broad selector remapping, raw hue families that bypass semantic tokens, and feature-local resets.
- Use effects only to synchronize external systems. Prefer server data, render-time derivation, event handlers, and stable query caches. Use `useLayoutEffect` only for unavoidable pre-paint DOM measurement or synchronization.

## Accessibility, responsiveness, and performance

- All functionality must work by keyboard with visible focus. Icon-only controls need accessible names. Critical actions must not be hover-only. Maintain at least 44px touch targets where touch is expected.
- Provide keyboard or direct-control alternatives to dragging. Charts and visual status need meaningful text equivalents. Announce live changes when they matter. Animation and color alone never carry state.
- Verify layout at 1600x1000, 1280x800, 1024x768, 768x1024, 390x844, 200% zoom, and short 800x300 geometry when overlays or navigation can be height-constrained.
- Verify no-server, one-server, two-server, and many-server behavior when server navigation changes. If a live fixture is unavailable, say so. Automated fixtures are useful but do not equal live multi-server validation.
- Virtualize long lists and trees where rendering cost warrants it. Keep expensive work out of render, pause continuous work when hidden/offscreen, route-lazy optional heavy visuals, and avoid broad refetches.
- The initial shell must not import GSAP or Rive. Mobile must not mount particles. The ambient renderer must respect its pixel and frame ceilings without weakening the intended visual effect.

## Web test standard

- Test behavior users, data integrity, and security boundaries depend on: server authorization, redirects, cookies/tokens, secret non-disclosure, guild isolation, query lifecycle, live invalidation, stale/terminal ordering, optimistic rollback, retry, destructive confirmation, unknown outcomes, and accessible interaction.
- Add or modify tests only for meaningful behavior or a real regression. Do not inflate coverage with class-name assertions, source scans, exact ordinary copy, package metadata, generated route text, static navigation arrays, or repetitions of behavior already proved at a more appropriate boundary.
- Component tests drive accessible controls and assert semantic rendered outcomes. Prefer roles, labels, actions, and state over DOM shape or CSS implementation.
- Route and server tests call exported loaders/functions or rendered routes. Test production APIs rather than test-only dispatch seams.
- Mock real runtime boundaries, network, database, filesystem, environment, clock, randomness, and browser APIs, not the internal function whose behavior is under test.
- Cover cold, cached, stale, error, retry, empty, unauthorized, permission-change, conflict, unknown, partial, reconciliation, and terminal states only where they materially differ.

## Validation and review

- Run focused web tests, web lint, and web typecheck for web changes. Run the complete web suite for cross-cutting routing, authentication, query-cache, ambient-shell, navigation, or shared dashboard changes.
- Inspect the final diff for unjustified custom CSS, duplicated visual systems, repeated copy, duplicated separators, width regressions, unstable hover geometry, cross-guild leakage, stale-state regressions, and ambient remounts.
- Visually inspect the real app for meaningful interaction, layout, hydration, responsive, ambient, overlay, or motion changes when services and authentication are available. Static source review and mocked component tests do not prove rendered composition or transition quality.
- Exercise the affected toggles and compare before/after state. For ambient work, verify layer order, persistence across routes, frame continuity, Reduced Effects, Fluid Blobs, Particles, operating-system reduced motion, hidden-tab behavior, and mobile behavior.
- State exactly what validation proves and report unavailable live fixtures or destructive smoke tests. Never present partial, mocked, or static validation as equivalent to authenticated runtime verification.

## Documentation boundary

- Dashboard redesign work must not casually alter public Docs. Preserve the existing Docs gradient and visual system unless the task explicitly includes documentation design.
- This file owns the default dashboard visual and interaction direction. Consult feature Research for current domain behavior, data ownership, destructive workflow, protocol, and migration requirements. Do not use old redesign history to override this contract.
