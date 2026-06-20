# NeonFlux Workspace Instructions

- Use pnpm only for Node.js work.
- Target pnpm 11. Keep pnpm settings in `pnpm-workspace.yaml`, and pin Node with root `package.json` `devEngines.runtime`.
- Use Postgres only. Do not add SQLite, `node:sqlite`, or local DB-file runtime support. PGlite is only for tests and migration validation.
- There is no staging environment. Runtime environments are development and production.
- `INSTANCE_MODE` behavior must be handled with `switch` statements.
- Keep shared logic in `packages/*`; bot and web consume it through workspace package imports.
- Use `neverthrow` for expected recoverable runtime failures. Each importing package must declare it directly.
- Releases are tag-driven from `main`: use `web-vX.Y.Z` and/or `bot-vX.Y.Z` only for affected images. GHCR images get version, `latest`, and commit SHA tags.
- Do not create release tags unless the user explicitly asks. Suggested release tags must move forward per component and never reuse or go below the latest existing `web-vX.Y.Z` or `bot-vX.Y.Z`.
- Shared package changes do not force every image to release, but DB migrations must stay compatible with deployed bot and web versions.
- Keep startup migration behavior in application-owned bootstrap code, not Docker shell command chains, so Docker and local production-style starts share the same locked migration path.
- When work changes deployable behavior, end the final response with an H1 warning that tells the user which package update should be released: web, bot, or both.
- Never commit secrets, `.env`, generated `dist`, local DB data, or machine-specific absolute paths.
- Do not stage, commit, tag, push, squash, rebase, or run mutating VCS commands without explicit permission.
- Keep handwritten production files under 555 LOC unless a narrow exception is justified.
- Validate changes with `pnpm check` from this folder when practical.
