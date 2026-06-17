# NeonFlux Bot Instructions

- Bot code must not access DB tables directly when a core or DB service exists.
- There is no staging bot. Bot deployments are development and production only.
- Every guild event must pass through mode gating before feature logic runs.
- Single mode must compare only against `SINGLE_GUILD_ID`.
- Multi mode means one bot token handling many guilds, not multiple containers.
- Keep Fluxer SDK-specific code in `packages/fluxer` unless it is truly bot-only orchestration.
- Do not copy web authorization logic into the bot. Move shared policy into `packages/core`.
