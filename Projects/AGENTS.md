# NeonFlux Workspace Instructions

- Use pnpm only for Node.js work.
- This workspace targets pnpm 11. Keep pnpm settings in `pnpm-workspace.yaml`, not a `pnpm` field in `package.json`.
- Pin the development Node runtime with root `package.json` `devEngines.runtime`.
- This workspace is Postgres only. Do not add SQLite, `node:sqlite`, or local DB-file support.
- PGlite is allowed only for local dev/test migration validation, not as a production/runtime database mode.
- There is no staging environment. Runtime environments are development and production.
- `INSTANCE_MODE` behavior must be handled with `switch` statements.
- Shared logic belongs in `packages/*`, not copied between bot and web.
- Bot and web packages should depend on shared packages through workspace package imports when those packages exist.
- Never commit secrets, `.env`, generated `dist`, local DB data, or machine-specific absolute paths.
- Treat uncommitted changes as user-owned. Do not stage, commit, push, squash, rebase, or run mutating VCS commands without explicit permission.
- Keep handwritten production files under 555 LOC unless a narrow exception is justified.
- Validate changes with `pnpm check` from this folder when practical.
