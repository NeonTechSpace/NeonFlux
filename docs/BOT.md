# Run and develop the bot

This guide is for operators running NeonFlux and contributors working on its bot. The bot uses Fluxerly's native Effect API and stores durable state in the Convex [backend](BACKEND.md). It ignores bot messages, webhooks, system notices and other servers

Examples use the default `!` prefix. The server can choose its own prefix, and the bot's help text prints that prefix

## Set up and run

### Prepare the workspace

Use the Node version in [the version file](../projects/.node-version) and an installed pnpm 12 bootstrap. The workspace selects its pinned pnpm version. From `projects/`, run:

```sh
pnpm install --frozen-lockfile
pnpm run check
```

The check typechecks, builds and tests the backend and bot without a Fluxer token or network connection. After a bot change, `pnpm --filter @neonflux/bot run check` runs the bot's checks alone

### Configure a server

1. Create a Fluxer application with a bot account and invite it to the server it should manage
2. Give the bot permission to read messages and send replies in the channels it should serve
3. Copy [the environment example](../projects/bot/.env.example) to `projects/bot/.env`
4. Set `FLUXER_BOT_TOKEN` to the private bot token and `NEONFLUX_SERVER_ID` to the server's decimal ID
5. Set up the [backend](BACKEND.md) for the same server, then set `CONVEX_SITE_URL` and `NEONFLUX_BOT_API_SECRET`

| Variable | Value |
| --- | --- |
| `FLUXER_BOT_TOKEN` | Private bot token |
| `NEONFLUX_SERVER_ID` | Decimal server ID |
| `CONVEX_SITE_URL` | Convex HTTP Actions origin, such as `https://your-deployment.convex.site` |
| `NEONFLUX_BOT_API_SECRET` | The backend's bot credential, at least 32 characters |

`CONVEX_SITE_URL` must use HTTPS, except `localhost`, `127.0.0.1` or `::1` during development, and cannot contain credentials, a path, a query or a fragment. Set both backend variables or neither. Without them only `!ping` works

Process environment variables take precedence over the file. Missing or invalid configuration stops startup with an actionable message and exit code 1. Keep the token and backend credential private and separate

### Start and stop

From `projects/`, run:

```sh
pnpm run build
pnpm run start
```

Send `!ping` in the server and expect `Pong!`. Press Ctrl+C to stop. SIGINT and SIGTERM give running handlers the SDK's five-second drain window. Set the SDK's `FLUXERLY_DEBUG` variable for more diagnostics

### Shared behavior

- Replies suppress user, role, everyone and reply-author notifications
- Management replies appear in the channel where the command was sent. Use a staff channel for configuration
- Permission checks read current server, role, member and channel data for each request. A failed read denies the request
- The bot never automatically repeats a native action whose outcome is unknown

## Ping, AFK, prefix and custom responses

### Prefix

Server owners and members with Manage Server change the prefix with `!prefix <value>`, or read it with `!prefix`. A prefix is one to five of these characters: `! $ % & * + , . ? ~ ^ | : / -`. `!prefix` always works, so a forgotten prefix can be recovered

The bot caches the server's prefix. A chat change applies at once. If the backend cannot be read, the bot keeps the last known prefix, or `!` when it has none

### AFK

Send `!afk` to set the reason `Away`, or `!afk Lunch` for a custom reason of up to 200 UTF-16 code units. Sending it again updates the reason. Your next normal message or reply in the server clears it

When a message mentions away users, the bot lists up to five of their reasons, excluding the author. The backend keeps only active statuses and no message history. If the backend is unavailable, setting reports that the status could not be confirmed

### Custom commands and autoresponders

The server owner and members with Administrator manage definitions with `!custom` and `!auto`. Quote text that contains spaces and escape a quote with a backslash

```text
!custom create rules text "Read the rules: {args}"
!auto create greeting exact "hello" embed "Welcome" "Hello {user.name}" "#3d66b8"
```

The first responds to `!rules` with optional arguments. The second responds to messages equal to `hello`, ignoring case

| Task | Command |
| --- | --- |
| Inspect or list | `!custom show rules`, `!custom list 1` |
| Replace the response | `!custom update rules response text "..."` or `response embed "Title" "Description" "#3d66b8"` |
| Restrict channels or roles | `!custom update rules channels #general #help`, `roles @Member`, or `channels all` to clear |
| Set the cooldown | `!custom update rules cooldown 30` |
| Enable or disable one definition | `!custom enable rules`, `!custom disable rules` |
| Turn the module on or off | `!custom module on`, `!custom module off` |
| Delete | `!custom delete rules` |
| Change an autoresponder trigger or priority | `!auto update greeting trigger contains "hello"`, `!auto update greeting priority 10` |

Use `!auto` in place of `!custom` for autoresponders. Run `!custom help` for the full syntax

- Names use 1 to 32 lowercase letters, digits, underscores or hyphens. Built-in command names are reserved
- A server stores up to 100 definitions across both kinds
- Triggers are 1 to 200 code units and match literally with `exact` or `contains`, ignoring case. Messages starting with `!` never trigger autoresponders
- When several autoresponders match, higher priority wins (-100 to 100, default 0), then `exact` before `contains`, then name order. A message gets at most one response
- Scopes accept up to 20 channels and 20 roles. When both are set, the message must be in an allowed channel and its author must hold an allowed role
- Cooldowns default to 5 seconds per definition and user and accept 0 to 3600
- Text responses are 1 to 2000 code units. Embeds have a title of up to 256 and a description of up to 4000 code units, with an optional `#RRGGBB` color
- Placeholders are `{user.name}`, `{user.id}`, `{user.mention}`, `{channel.id}`, `{server.id}` and `{args}`. `{args}` is empty for autoresponders. Unknown placeholders are rejected

A response is reserved before it is sent. A failed or uncertain send still uses that message and cooldown, and nothing is resent
