# Feature Surface And Command Access Notes

## Decisions

- Dashboard access is still Manage Server by default. Command grants do not grant dashboard access.
- Dashboard-only configuration is the default for feature setup, especially logging destinations, posting, autorole, reaction roles, verification, tickets, VC generator setup, import/export, and command access.
- Bot commands should exist only for chat-native user actions. Planned dashboard configuration must not create fake hidden bot commands.
- Command access grants target either a command category or a specific bot command:
    - `target_type = category`, example `target_id = settings`
    - `target_type = command`, example `target_id = settings.prefix`
- Old category grants are preserved as category targets during migration. Prefix command authorization also checks the legacy `prefix` category target so existing grants keep working.
- Grants apply only to real implemented guarded bot commands. Public help/ping stay discoverable, are DEFCON-gated, and are not grantable.
- DEFCON 1/2 are stronger than grants. DEFCON 3 allows server owner, Manage Server, category grant, or command grant for guarded commands.
- Help output lists implemented visible commands regardless of whether the caller can execute them. Discovery does not bypass DEFCON.

## Feature Classification

- `general`: command prefix dashboard config plus `general.help`, `general.ping`, and `settings.prefix`.
- `logging`: dashboard-only destination/filter config plus server-event handlers. No bot command.
- `posting`: dashboard-only sender and future templates/embed builder. No bot command.
- `vc_generator`: dashboard-only setup plus a bot-managed panel embed in a configured channel. Until interactions exist, panel controls use reactions for rename, user limit, whitelist, blacklist, lock, and unlock.
- `xp`: message activity and VC activity both count as XP sources.
- `moderation`, `suggestions`, and `xp` are the only current planned bot command groups in the catalog. Their commands stay hidden until implemented.

## Audit Trail

- Dashboard command-access updates write `bot_action_events` with `feature = access`.
- Update action: `command_access.updated`.
- Delete action: `command_access.deleted`.
- Metadata records target type/id, user count, role count, source, and actor display metadata when Fluxer identity lookup succeeds.
