# NeonFlux Web Instructions

## Authority and data flow

- Re-check authorization server-side for every mutation and sensitive read. Browser state, route parameters, cached lists, and previews are never authority.
- Read deployment behavior from `deployment_config`, not `INSTANCE_MODE` or `SINGLE_GUILD_ID` environment variables.
- Single mode has no guild picker and authorizes only the DB-effective configured guild. Multi mode exposes only OAuth guilds for which the user has Manage Server permission.
- Keep OAuth and Fluxer permission translation in `packages/fluxer`. Keep shared dashboard access policy in `packages/core`.
- Keep OAuth client secrets, bot tokens, session secrets, encryption keys, and token exchange logic out of browser bundles and client-visible errors.
- Use TanStack Query for UI-facing server state. Server loaders/functions and direct authorized reactive queries remain authoritative.

## Rendering and interaction

- Treat guild identity as a hard client-state boundary across every dashboard feature and view. Query keys and retained server data must be guild-scoped: reuse cached data only for the currently targeted guild, keep each guild's cache available when returning to it, and remount or reset transient drafts, errors, pagination, selections, and busy state when the guild changes. Never render feature data retained from the previously selected guild.
- Prefer server data, render-time derivation, and stable query caches before client effects. Use `useEffect` only to synchronize an external system and `useLayoutEffect` only for unavoidable pre-paint DOM work.
- Protected initial data loads through route loaders or server functions. Known route/list data should render headers, names, icons, and IDs immediately.
- The router uses instant pending (`defaultPendingMs: 0`, `defaultPendingMinMs: 0`), but stable docs/dashboard shells remain mounted.
- Avoid page-wide skeletons when a useful shell or cached data exists. Put pending states in the panel or control doing the work.
- Async UI must remain responsive and honest: show progress, stale state, errors, retry/reconnect behavior, destructive confirmation, partial failure, and terminal outcomes.
- Optimistic updates require rollback and authoritative revalidation. Do not let older responses overwrite newer or terminal state.
- Keep expensive work out of render and avoid request waterfalls, repeated authorization calls, and broad refetches when a focused query is sufficient.

## Web test standard

- Exercise the behavior users and security boundaries depend on: server authorization, redirect/cookie/token handling, secret non-disclosure, query lifecycle, stale/terminal ordering, rollback, retry, destructive confirmation, and accessible interaction.
- Component tests should drive accessible controls and assert meaningful rendered outcomes. Prefer roles, labels, and state over DOM structure or CSS classes.
- Route and server tests should call exported loaders/functions or rendered routes. Do not scan source files, generated route text, package metadata, MDX prose, or static navigation arrays as a proxy for behavior.
- Do not assert ordinary product copy verbatim unless it is a destructive, security, protocol, or accessibility contract. Assert semantics and available actions instead.
- Mock network, DB, browser, and clock boundaries. Do not mock the internal function whose behavior the test is supposed to prove.
- Cover cold, cached, error, retry, empty, unauthorized, and terminal states when they materially differ.

## Validation

- Run focused web tests, web lint, and web typecheck for web changes. Run the full web suite for cross-cutting routing, authentication, query-cache, or shared dashboard changes.
- Visually inspect meaningful interaction/layout changes in the real app when services and authentication are available.
