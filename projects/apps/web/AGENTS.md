# NeonFlux Web Instructions

- Re-check authorization server-side on every mutation.
- Web reads deployment behavior from `deployment_config`, not `INSTANCE_MODE` or `SINGLE_GUILD_ID` env.
- Single mode has no guild picker and checks only the DB-effective configured guild.
- Multi mode lists guilds from OAuth only after Manage Server permission filtering.
- Keep OAuth and Fluxer permission translation in `packages/fluxer`.
- Keep shared dashboard access rules in `packages/core`.
- Use TanStack Query for UI-facing server state and dashboard mutations, not OAuth token exchange.
- Keep OAuth client secrets, bot tokens, session secrets, and token exchange logic out of browser code.
- Prefer server data, route loaders/server functions, and render-time derivation before client effects.
- Dashboard pages load initial protected data through route loaders/server functions before rendering client components.
- Use `useEffect` only to sync with external systems, never for derived state or normal data loading.
- Use `useLayoutEffect` only for unavoidable pre-paint DOM measurement or mutation.
- Keep UI async-first: do not block input/render on network, show pending states, and use transitions/deferred work for expensive updates.
- Optimistic updates need rollback plus server revalidation.
- Keep this file in present tense as app patterns change.
