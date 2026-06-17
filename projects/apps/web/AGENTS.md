# NeonFlux Web Instructions

- Re-check authorization server-side on every mutation.
- Single mode has no guild picker and checks only `SINGLE_GUILD_ID`.
- Multi mode lists guilds from OAuth only after Manage Server permission filtering.
- OAuth secrets, client secrets, bot tokens, and session secrets remain server-only.
- Keep OAuth and Fluxer permission translation in `packages/fluxer`.
- Keep shared dashboard access rules in `packages/core`.
