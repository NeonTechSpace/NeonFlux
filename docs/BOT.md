# Run and develop the bot

This guide is for operators running NeonFlux and contributors working on its bot. The bot uses Fluxerly's native Effect API and stores durable state in the Convex [backend](BACKEND.md). It ignores bot messages, webhooks, system notices and servers it does not serve

Examples use the default `!` prefix. Each server can choose its own prefix, and the bot's help text prints that prefix

## Set up and run

### Prepare the workspace

Use the Node version in [the version file](../projects/.node-version) and an installed pnpm 12 bootstrap. The workspace selects its pinned pnpm version. From `projects/`, run:

```sh
pnpm install --frozen-lockfile
pnpm run check
```

The check verifies formatting, then typechecks, builds and tests the contracts, backend and bot without a Fluxer token or network connection. After a bot change, `pnpm --filter @neonflux/bot run check` runs the bot's checks alone

### Configure a server

1. Create a Fluxer application with a bot account and invite it to the server it should manage
2. Give the bot permission to read messages and send replies in the channels it should serve
3. Copy [the environment example](../projects/bot/.env.example) to `projects/bot/.env`
4. Set `FLUXER_BOT_TOKEN` to the private bot token
5. Set up the [backend](BACKEND.md) for the server, then set `CONVEX_URL` and `NEONFLUX_BOT_API_SECRET`

| Variable | Value |
| --- | --- |
| `FLUXER_BOT_TOKEN` | Private bot token |
| `CONVEX_URL` | Convex deployment URL, such as `https://your-deployment.convex.cloud` |
| `NEONFLUX_BOT_API_SECRET` | The backend's bot credential, the same text as in the Convex deployment, at least 32 characters and without surrounding spaces |
| `NEONFLUX_SERVER_ID` | Optional. With a backend, the bot refuses to start when the backend serves another server. Without a backend, the one server the bot serves |

The Convex deployment owns the server scope. At startup the bot asks the backend for it and adopts it, so `NEONFLUX_SERVER_ID` belongs in the deployment, as [the backend guide](BACKEND.md#environment-variables) lists it. The bot's own `NEONFLUX_SERVER_ID` only checks the backend's scope, which catches a bot pointed at another deployment. Without a backend, the bot serves the one server `NEONFLUX_SERVER_ID` names. Commands that need no stored data still work, such as `!ping` and `!custom help`, while features that store data are unavailable

`CONVEX_URL` must use HTTPS, except `localhost`, `127.0.0.1` or `::1` during development, and cannot contain credentials, a path, a query or a fragment. It is the deployment URL, not the HTTP Actions URL ending in `.convex.site`. Set both backend variables or neither

The bot calls the backend's functions with the Convex client and never sends the secret itself. It sends a key derived from it, as [the backend guide](BACKEND.md#service-authentication-and-errors) describes

Process environment variables take precedence over the file. Missing or invalid configuration stops startup with an actionable message and exit code 1. Messages name variables, never their values. Keep the token and backend credential private and separate

### Start and stop

From `projects/`, run:

```sh
pnpm run build
pnpm run start
```

`pnpm run start` runs the last build in `bot/dist`, so build again after a change. During development, `pnpm run dev:bot` runs the bot from its source and restarts it when a file changes, without a build.
Send `!ping` in the server and expect `Pong!`. Press Ctrl+C to stop. SIGINT and SIGTERM give running handlers the SDK's five-second drain window. Set the SDK's `FLUXERLY_DEBUG` variable for more diagnostics

Before connecting, the bot adopts the backend's scope. A refused key, a backend that is not configured, an unreachable backend, an unknown answer and a server that differs from the bot's own `NEONFLUX_SERVER_ID` each stop startup with their own message. A backend that is not configured logs the variable to fix in the Convex deployment's logs. Update the backend before the bot

### Shared behavior

- Replies suppress user, role, everyone and reply-author notifications
- Status, detail and list replies, such as `!custom list`, are embeds with a title and labelled fields. Short confirmations and errors are one plain sentence. A change to a single setting answers with one line that names the setting and its new value, and creating something shows its card. Members, channels and roles show as mentions that never notify anyone, and times show in each reader's own timezone
- Management replies appear in the channel where the command was sent. Use a staff channel for configuration
- Commands never ask for revision numbers. A chat change applies to the current state, which the bot reads right before it writes, so when two staff members change the same thing, the later change wins
- An apostrophe inside a word, as in don't, counts as text and needs no escape
- A role or channel is given by its ID or by a mention of its own kind. A role mention where a channel is expected is refused, and the same holds the other way round. Plain whole numbers such as cooldowns and priorities are written without leading zeros
- A list with more pages ends with a `Next` line. Send the same command with `next` at the end, such as `!custom list next`, for the following page. The bot remembers each member's place in each list in memory, so after a restart a list starts again from its first page
- Commands, such as prefix changes and custom response management, read current server, role and member data from Fluxer right before they act. A failed read denies the request
- Evaluating everyday activity, such as custom responses, uses copies of server, role, member and channel data that the bot keeps in memory, and reads Fluxer only for what it lacks. Gateway events keep the copies current
- A message in a thread or forum post counts as in its parent channel for custom response channels. A rule that lists the thread itself also matches. The bot learns a thread's parent from thread events and the channels it keeps, or otherwise from one channel read
- The bot never automatically repeats a native action whose outcome is unknown
- Each gateway session asks Fluxer not to send event types the bot does not handle, such as typing notices and presence updates, so they cost no bandwidth or decoding

## Command help

| Command | Behavior |
| --- | --- |
| `!<command> help` | Show a command's most used forms, at most eight, such as `!custom help`. Help for a command with more forms ends with a line pointing to `help all` |
| `!<command> help all [next]` | List the forms that help leaves out, 10 at a time, such as `!custom help all` |

Help prints the server's prefix

## Ping, AFK, prefix and custom responses

### Prefix

Server owners and members with Manage community change the prefix with `!prefix <value>`, or read it with `!prefix`. A prefix is one to five of these characters: `! $ % & * + , . ? ~ ^ | : / -`. `!prefix` always works, so a forgotten prefix can be recovered

The bot caches each server's prefix. A chat change applies at once. If the backend cannot be read, the bot keeps the last known prefix, or `!` when it has none

### AFK

Send `!afk` to set the reason `Away`, or `!afk Lunch` for a custom reason of up to 200 UTF-16 code units. Sending it again updates the reason. Your next message or reply in the server, including any other command, clears it

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
| Inspect or list | `!custom show rules`, `!custom list` |
| Replace the response | `!custom update rules response text "..."` or `response embed "Title" "Description" "#3d66b8"` |
| Restrict channels or roles | `!custom update rules channels #general #help`, `roles @Member`, or `channels all` to clear |
| Set the cooldown | `!custom update rules cooldown 30` |
| Enable or disable one definition | `!custom enable rules`, `!custom disable rules` |
| Turn the module on or off | `!custom module on`, `!custom module off` |
| Delete | `!custom delete rules` |
| Change an autoresponder trigger or priority | `!auto update greeting trigger contains "hello"`, `!auto update greeting priority 10` |

Use `!auto` in place of `!custom` for autoresponders. `!custom help` shows the common forms and `!custom help all` the rest

- Names use 1 to 32 lowercase letters, digits, underscores or hyphens. Built-in command names are reserved
- A server stores up to 100 definitions across both kinds
- Triggers are 1 to 200 code units and match with `exact` or `contains`, ignoring case and the spaces around the
  message. Messages that start with the server's prefix never trigger autoresponders
- When several autoresponders match, higher priority wins (-100 to 100, default 0), then `exact` before `contains`, then name order. A message gets at most one response
- Scopes accept up to 20 channels and 20 roles. When both are set, the message must be in an allowed channel and its author must hold an allowed role
- Cooldowns default to 5 seconds per definition and user and accept 0 to 3600. Setting 0 also ends a wait that is
  already running
- Text responses are 1 to 2000 code units. Embeds have a title of up to 256 and a description of up to 4000 code units, with an optional `#RRGGBB` color
- Placeholders are `{user.name}`, `{user.id}`, `{user.mention}`, `{channel.id}`, `{server.id}` and `{args}`. `{args}` is empty for autoresponders. Unknown placeholders are rejected

A response is reserved before it is sent. A failed or uncertain send still uses that message and cooldown, and nothing is resent. The bot looks up the author's membership and roles only when a definition could reply, from its member copy when it holds one, so a message that matches nothing needs no member lookup for responses
