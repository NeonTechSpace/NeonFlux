# NeonFlux Web Instructions

- Re-check authorization server-side on every mutation.
- Single mode has no guild picker and checks only `SINGLE_GUILD_ID`.
- Multi mode lists guilds from OAuth only after Manage Server permission filtering.
- Keep OAuth and Fluxer permission translation in `packages/fluxer`.
- Keep shared dashboard access rules in `packages/core`.
- Use TanStack Query for UI-facing server state and dashboard mutations, not OAuth token exchange.
- Keep OAuth client secrets, bot tokens, session secrets, and token exchange logic out of browser code.
