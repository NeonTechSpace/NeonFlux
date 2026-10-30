# Run and develop the bot

This guide is for operators running NeonFlux and contributors working on its bot. The bot uses Fluxerly's native Effect API, stores durable state in the Convex [backend](BACKEND.md) and shares its settings with the [dashboard](WEB.md). It ignores system notices and servers it does not serve, and ignores bot and webhook messages unless `!automod bots on` has automod check them

Examples use the default `!` prefix. Each server can choose its own prefix, and the bot's help text prints that prefix. Commands sent in a one-to-one DM always use `!`

## Set up and run

### Prepare the workspace

Use the Node version in [the version file](../projects/.node-version) and an installed pnpm 12 bootstrap. The workspace selects its pinned pnpm version. From `projects/`, run:

```sh
pnpm install --frozen-lockfile
pnpm run check
```

The check verifies formatting, then typechecks, builds and tests the contracts, backend, bot and website without a Fluxer token or network connection. After a bot change, `pnpm --filter @neonflux/bot run check` runs the bot's checks alone

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
| `NEONFLUX_SERVER_ID` | Only without a backend, the one server the bot serves. With a backend it lives in the Convex deployment, and the bot refuses to start while its own environment sets it |
| `NEONFLUX_SERVER_MODE` | Only without a backend, where only `single` works. With a backend it lives in the Convex deployment, and the bot refuses to start while its own environment sets it |
| `NEONFLUX_CUSTOM_STATUS` | Optional presence text of at most 128 UTF-16 code units, shown at DEFCON 3 in single mode and always in multi mode |
| `NEONFLUX_BACKUP_KEY` | Optional backup recovery key, see [backup and restore](#selective-backup-and-restore) |

The Convex deployment owns the server scope and the website origin. At startup the bot asks the backend for both and adopts them, so `NEONFLUX_SERVER_MODE`, `NEONFLUX_SERVER_ID` and `NEONFLUX_WEBSITE_URL` belong in the deployment, as [the backend guide](BACKEND.md#environment-variables) lists them. With a backend, the bot refuses to start while its environment sets the server mode or ID, with a message naming the variable to remove, and the bot never reads a website origin from its environment. Without a backend, the bot serves the one server `NEONFLUX_SERVER_ID` names. Commands that need no stored data still work, such as `!ping` and `!custom help`, while features that store data are unavailable

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

Before connecting, the bot adopts the backend's scope and website origin. Scope variables in the bot environment stop startup before any backend request. A refused key, a backend that is not configured, an unreachable backend and an unknown answer each stop startup with their own message. A backend that is not configured logs the variable to fix in the Convex deployment's logs. Update the backend before the bot

Once its servers are starting, the bot logs one Info line, such as `NeonFlux started in single mode for server <id>, website origin set, backup key not set`. In multi mode it names how many servers Fluxer lists instead. The line says only whether the website origin and the backup key are set, never their values. With a backend, the first answer of the [bill guard](#optional-work-limits-and-the-bill-guard) adds `Backend budget: normal`, `warning`, `paused` or `not set`

In single mode the bot also reads the list of servers Fluxer shows it, without delaying startup. When the full list lacks the configured server, it warns `NeonFlux is not in server <id>. Invite the bot to that server or set NEONFLUX_SERVER_ID to the right server`, because the bot would otherwise connect and answer nothing. With a backend, the warning says `set NEONFLUX_SERVER_ID in the Convex deployment to the right server` instead. Invite the bot to that server, or correct `NEONFLUX_SERVER_ID` where the warning says, and restart. A list cut off at 100,000 servers or a failed read logs nothing

Every ten minutes with activity, the bot logs one Info line with that interval's Fluxer requests, backend requests, handled events, rate-limit waits, dropped events and skipped optional jobs, plus the three busiest Fluxer routes and backend paths. An interval without requests or events logs nothing

A warning about failed background work names its cause in log annotations. `cause.error` is the failure's error class, or `unknown` for a class NeonFlux does not list, and `cause.defect` says whether it was a bug rather than an expected failure. `cause.code`, `cause.stage`, `cause.operation`, `cause.route`, `cause.reason` and `cause.outcome` follow only when the value is one of the fixed names NeonFlux, its backend, the Fluxer SDK or Effect define for that field, and `cause.status` only as an HTTP status. Any other value, such as the sentence of a backend refusal or a raw path, is left out, so the annotations never hold message text, names, request or response bodies or secrets. A Fluxer SDK error carries no `cause.operation`

### Shared behavior

- Replies suppress user, role, everyone and reply-author notifications. The one exception is the `!escalate` reply, which notifies the post's author
- Management replies appear in the channel where the command was sent. Use a staff channel for configuration
- Commands never ask for revision numbers. A chat change applies to the current state, which the bot reads right before it writes, so when two staff members change the same thing, the later change wins. The dashboard keeps its own conflict check, as [the dashboard guide](WEB.md#saving-and-live-updates) describes
- Events and scheduled posts are named by their name, such as `!event show study`. Records that have no name, such as cases, tickets, suggestions and posts, keep their numbers
- A reason at the end of a command needs no quotes, such as `!mod warn @user Spamming links`. An apostrophe inside a word, as in don't, counts as text and needs no escape
- A member, role or channel is given by its ID or by a mention of its own kind. A role mention where a member is expected is refused, and the same holds for each other pairing. Plain whole numbers such as case numbers and counts are written without leading zeros. The number inside a duration may keep them, as in `07d`
- A list with more pages ends with a `Next` line. Send the same command with `next` at the end, such as `!mod list next`, for the following page. The bot remembers each member's place in each list in memory, so after a restart a list starts again from its first page
- Commands and actions, such as moderation, role changes, channel permission changes and purges, read current server, role, member and channel data from Fluxer right before they act. A failed read denies the request
- Evaluating everyday activity, such as message protection, automod, custom responses, leveling, metadata logs, role panel reactions and vote reactions on suggestion cards, uses copies of server, role, member and channel data that the bot keeps in memory, and reads Fluxer only for what it lacks. Gateway events keep the copies current
- A message in a thread or forum post counts as in its parent channel for channel rules: automod channels and exemptions, honeypot channels, custom response channels, leveling's channels that earn XP and excluded channels and metadata logs' message and excluded channels. A rule that lists the thread itself also matches. The bot learns a thread's parent from thread events and the channels it keeps, or otherwise from one channel read
- The bot never automatically repeats a native action whose outcome is unknown. Such work stays visible as uncertain, and status or reconcile commands read the exact known message or member without resending
- Durable worker state, such as greeting, schedule and cleanup queues, lives in the backend. Workers resume it after a restart
- Each gateway session asks Fluxer not to send event types the bot does not handle, such as typing notices and presence updates, so they cost no bandwidth or decoding
- A message update that only adds or changes link previews or other embeds is ignored. The bot remembers the edit time, pin status and flags of the last 10,000 messages it saw, and an update that changes any of them, or concerns an older message, still reaches automod, security and metadata logs
- Background workers for dashboard changes, web verification, events and their discussion threads, scheduled posts, birthdays and anniversaries, suggestion cards, message cleanup, metadata logs, level rewards, temporary roles and expired groups run only when the backend reports due work for their server, so a server without due work causes no backend requests. One dispatcher for the whole bot asks the backend at startup, at once when the backend signals new work, when work the bot's own requests created becomes due and at the next due time the backend names. Without any of these it still asks every two minutes. It asks at most once every three seconds, so new work usually starts within a few seconds. Work for a server that is still starting reaches it once it has started. If the backend cannot answer, the dispatcher waits 10 seconds and then twice as long after each failure, up to five minutes. When new work is signalled during such a wait, it tries once early, three seconds after its last try, at most once per wait

### Optional work limits and the bill guard

Some per-message work is optional, so the bill guard can pause it. Only the check of ordinary text for autoresponders has a limit of its own, so one very busy server cannot take a large share of the backend calls every server shares. Each server has its own token bucket for it: It may spend a burst at once, then the refill rate. A message over the limit skips that check only, and the ten-minute cost line counts it as a skipped optional job

| Work | Backend calls per message | Limit |
| --- | --- | --- |
| AFK: clearing the author's status and naming AFK members a message mentions | One, none when the author and every member mentioned are known to have no status | None |
| Custom commands | One, or two when a definition needs the member's roles | None |
| Autoresponder check of text that is not a command | One, or two when a definition needs the member's roles | 30 at once, then 60 a minute |
| Message XP credits | Up to two, none while the member is inside the cooldown | None |
| Analytics counting | None, counts leave in batches | None |
| Sticky message reposts | One per repost, at most once per interval in each of up to five channels | None |
| Help desk reply reminder records | One per new post in a help desk forum while reminders are on | None |

AFK remembers, for each server, up to 5,000 members it knows to have no status. A member leaves that memory when they set a status, and joins it only after a backend answer, so a failed call hides nothing. XP keeps one waiting message for each member, and the bot remembers up to 5,000 members' next earning time from the backend's last answer, so messages inside the cooldown cost no call. `!level` and `!preset` commands and a leveling or preset change on the website forget those times, and `!mydata delete` forgets the member's own. A full XP queue of 1,000 members skips a message and counts it as a skipped optional job

Moderation, automod, security, join protection, DEFCON, built-in commands, including `!afk`, and background workers are never limited or paused

The [bill guard](BACKEND.md#bill-guard) adds a monthly budget of backend calls, set in the Convex deployment. The bot reports its calls every five minutes, and the answer tells it the guard's state. At the warning share the bot logs one warning a month. At 90 percent of the budget the bot pauses all seven kinds of optional work in every server until the month rolls over in UTC or the budget is raised, and logs when it pauses and resumes. An invalid budget setting in the deployment pauses optional work the same way, with a warning that the deployment's logs name the variable to fix, until a report succeeds again. Moderation, built-in commands and the rest of the bot keep running

## Help, setup and health

| Command                              | Behavior                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `!help`                              | List the groups that hold a command you can use, each with one line on what it covers: Basics, setup, moderation, roles, messages, support, community and voice                                                                                                                 |
| `!help <group>`                      | List the group's commands you can use, one line each, such as `!help support`. A feature or command name, such as `!help tickets` or `!help mod`, opens the group that holds it, and an unknown name gets the closest match                                                     |
| `@NeonFlux help`                     | The same as `!help`, for members who do not know the prefix. Add a group after `help` to open it                                                                                                                                                                                |
| `!<command> help`                    | Show a command's most used forms, at most eight, such as `!custom help`. Help for a command with more forms ends with a line pointing to `help all`                                                                                                                             |
| `!<command> help all [next]`         | List the forms that help leaves out, 10 at a time, such as `!custom help all`                                                                                                                                                                                                   |
| `!setup`                             | Show how many features are on, counting those that need a step, then name the features that are on, those that are on but need a step, and those that are off                                                                                                                   |
| `!setup <feature>`                   | Show one feature's state and its next step, such as `!setup tickets`. The feature may be its name, with or without spaces and in singular or plural, or its command, such as `ticket` or `lfg`                                                                                  |
| `!health`                            | Sum up whether NeonFlux reaches its data service and Fluxer, how many permissions it lacks for the features that are on and which features need them, how many roles it gives rank at or above its own role, and how many safety warnings the audit of the server's roles found |
| `!health permissions\|safety [next]` | List each missing permission with the features that need it and each role that ranks too high, or each safety warning with its fix, 10 at a time                                                                                                                                |
| `!recovery`                          | Count what needs attention in each area, such as `Tickets 1, Publishing 2`: work that failed, got stuck or was not confirmed, features that are on but need a step and the permission problems of the latest check                                                              |
| `!recovery <area> [next]`            | List one area's entries with when each happened, 10 at a time, such as `!recovery tickets`. Entries that share a fix name it once                                                                                                                                               |
| `!recovery <area> <number>`          | Show one entry of that list with the step that resolves it, such as `!recovery tickets 1`                                                                                                                                                                                       |

Help lists a command when your server permissions open it. Everyone sees member commands. Members with Kick members, Ban members, Time out members, Manage messages, Manage channels, Manage roles or Manage threads also see the staff commands, whose staff roles are still checked when they run. Manage community opens `!setup`, `!health`, `!recovery`, `!preset` and `!stats`, and the server owner and Administrators see every command. Help prints the server's prefix, except on lines about commands sent in a DM, which always use `!`. `!setup`, `!health` and `!recovery` are for the server owner and members with Manage community or Administrator

A prefixed word that is not a command and is close to one gets one reply, such as `Did you mean !help?`. Close means one changed, added or removed letter for names of up to four letters and two for longer names, and two swapped neighboring letters count as one. Other text after the prefix gets no reply, and a custom command of that name is never treated as unknown. In a one-to-one DM, a command that works only in a server, such as `!help`, gets one line saying to send it in the server, and a name that is no command gets one line pointing to `!help`

`!health permissions` names each missing permission once with the features that need it, such as `Kick members: Moderation`, and each role NeonFlux gives that ranks at or above its own role, then says to grant the permissions to the NeonFlux role and move it above those roles. It checks the bot's server-wide permissions, so a channel override that denies NeonFlux in one channel is not reported. Roles it checks are all those autorole, reservations, reaction and verification panels, the role picker, temporary roles, the newcomer checklist and level rewards assign. The dashboard's overview shows the same check, see [the dashboard guide](WEB.md#dashboard)

`!health safety` reports each finding of the safety audit with its fix:

- A role that gives a dangerous permission to every member through the everyone role, or to 20 or more members. Dangerous permissions are Administrator, Manage community, Manage roles, Manage channels, Manage webhooks, Ban members, Kick members, Time out members, Manage messages and Use @everyone/@here and @roles. Member counts come from Fluxer's member search, one request per role for up to 10 roles, Administrator roles first and then from the lowest role up. The searches share Fluxer's 40 member requests per server every 10 seconds with the member reads every other feature makes, and a website check answers within a minute, so a check counts no more. The search needs a member management permission such as Manage roles, and a role whose count cannot be read is left out
- While moderation is on, a staff role that lacks the permissions its staff area's commands check on the member who runs them. Moderation staff need Kick members, Ban members, Time out members, Manage messages and Manage channels, and security staff need Time out members, Manage roles and Manage channels. Case, automod and appeal staff need none. Permissions come from the role and the everyone role
- Autorole, reaction roles, rules verification or the role picker being on while the server has a Fluxer verification level. Fluxer skips its verification level for every member who has any role, so a role from these features lets a member past it. The fix is to turn them off when the verification level must hold, or to use rules verification with advanced verification, which gives its role only after a solved challenge and makes autorole wait for it

When a moderation action, a role panel, autorole, verification, role picker or temporary role change, a ticket creation, a temporary voice room change or a group card or room fails because of NeonFlux's permissions or role position, the reply names the fix the same way. A moderation action against a member whose highest role is not below yours says so too

### Recovery inbox

`!recovery` counts what needs attention in each area, in the order of its entries, current state first and then newest first. `!recovery <area>` lists that area's entries 10 at a time with what happened and how long ago, and `next` shows the following page. The area is its name or a feature's word, such as `tickets`, `welcome` or `permissions`, and features that are on but need a step are under `setup`. `!recovery <area> <number>` shows the command or step that resolves one entry, such as `!publish reconcile 7`, `!temprole reconcile @member` or `!roles next colors`, and a list whose entries share one fix names it once. Commands name members by mention and role panels by name. The dashboard's [recovery inbox](WEB.md#recovery-inbox) shows the same entries. It collects what features already record and adds no tracking of its own:

| Source | Shown |
| --- | --- |
| Posts | Posts with an unknown outcome until they are reconciled or resolved, including scheduled, event, birthday, anniversary, suggestion card and YouTube alert posts, and failed posts of the last seven days |
| Role changes | Role changes with an unknown outcome that wait for a check from role panels, rules verification, autorole, temporary roles, level rewards, the role picker and the newcomer checklist |
| Role removals | Role withdrawals of a panel or autorole that stopped at a role change that needs a check, each with the command that continues it |
| Temporary roles | Grants with a problem, such as missing Manage roles or a role change NeonFlux could not confirm, except grants that wait for their member |
| Tickets | Tickets whose create, close or reopen has an unknown outcome |
| Message cleanup | Deletions of the last seven days that failed or have an unknown outcome, and enabled channels that are blocked |
| Greetings | Welcome, DM and goodbye greetings with an unknown outcome, and failed ones of the last seven days |
| Scheduled and birthday or anniversary posts | Deliveries waiting because NeonFlux cannot post in their channel |
| Metadata logs | The number of failed deliveries and deliveries with an unknown outcome, security alerts included |
| Help desk | A thread budget warning of the last seven days |
| YouTube alerts | Followed channels whose alerts NeonFlux turned off because their channel is gone or it cannot post there, with the fix, and channels whose subscription with YouTube keeps failing |
| DEFCON | A level below 3, which pauses automation |
| Features | Features that are on but need setup, such as a channel or a first entry. Custom commands and autoresponders start on, so having none is not listed |
| Permission check | The problems of the latest dashboard permission check, with the time it ran. `!health` checks again |

Each source reads at most 50 records and shows its newest 10, and the inbox shows at most 100 entries. Role removals list every stopped removal: `!recovery removals` shows 10 at a time with each one's command, and `next` goes on to older ones until the last. Event reminder deliveries without a post, suggestion cards waiting for a channel, level rewards, moderation case and log recovery, backup restore items and dashboard requests are not included. Their own status commands and sections show them

### Setup presets

A preset sets several existing settings at once as a starting point. Community presets fit a kind of server, and security levels set automod and security together

| Command                          | Behavior                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `!preset list`                   | List the presets and how many settings each would change now                                                                  |
| `!preset show <name>`            | Count the settings the preset would change and the automod rules it would add or update now, with the code that confirms them |
| `!preset show <name> all [next]` | List each change from its current value, ten to a page                                                                        |
| `!preset apply <name>`           | The same as `show`                                                                                                            |
| `!preset apply <name> <code>`    | Apply the preset whose changes you saw. The reply counts what changed                                                         |
| `!preset help`                   | Show syntax                                                                                                                   |

| Preset     | What it sets                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gaming`   | Leveling on with 20 XP per message and a 60-second cooldown, and events on                                                                                                                                                                                                                                                                                                             |
| `support`  | Tickets on with 90 days of ticket history, and leveling off                                                                                                                                                                                                                                                                                                                            |
| `creator`  | Events on, and leveling on with 10 XP per message and a 120-second cooldown                                                                                                                                                                                                                                                                                                            |
| `relaxed`  | Automod on and enforcing without checking webhook and bot messages, rules that delete spam at 8 messages in 10 seconds and lookalike links, and join-burst detection and DEFCON 2 on a join burst off                                                                                                                                                                                  |
| `balanced` | Automod on and enforcing without checking webhook and bot messages, rules that delete spam at 6 messages in 10 seconds, repeated messages at 4 in 30 seconds, mention floods at 15 in 30 seconds and lookalike links, security on and enforcing, and join-burst detection at 10 joins in 30 seconds without DEFCON 2                                                                   |
| `strict`   | Automod on and enforcing with webhook and bot messages checked, 10-minute timeouts for spam at 5 messages in 10 seconds and mention floods at 10 in 30 seconds, rules that delete repeated messages at 3 in 30 seconds, link floods at 6 in 30 seconds and lookalike links, security on and enforcing, and join-burst detection at 5 joins in 30 seconds with DEFCON 2 on a join burst |

- A preset changes only the settings in its row and only values that differ. Its automod rules are named `preset-spam`, `preset-repeat`, `preset-mentions`, `preset-links` and `preset-lookalikes`. A missing one is added, and an existing one of the same type gets the preset's action and limits and keeps its channels and exemptions. A rule of that name with another type is left alone
- Presets never delete rules or other settings and never change channels or roles. A lower security level keeps rules a higher level added, so disable those with `!automod disable <name>` when they are not wanted
- The code confirms exactly the listed changes. If any of those settings changes first, applying refuses, and `!preset show` lists the new changes and code
- Previews need Manage community. Applying needs the server owner or an Administrator, like the automod and security settings, and is refused at DEFCON 1
- Every changed feature gets its own entry in the dashboard's audit log, named `preset <name>`. The dashboard's Setup presets section shows and applies the same presets

## Ping, AFK, prefix, reply style, nickname and custom responses

### Prefix

Server owners and members with Manage community change the prefix with `!prefix <value>`, or read it with `!prefix`. A prefix is one to five of these characters: `! $ % & * + , . ? ~ ^ | : / -`. `!prefix` always works, so a forgotten prefix can be recovered. The dashboard can also change it

The bot caches each server's prefix. A chat change applies at once and a dashboard change applies within 30 seconds. If the backend cannot be read, the bot keeps the last known prefix, or `!` when it has none

### Reply style

Status, detail and list replies, such as `!suggest show 1` or `!appeal status`, have a title and labelled fields. Each server chooses whether they arrive as embeds, the default, or as plain text with a bold title and one bold label per line. Short confirmations and errors are one plain sentence in both styles. A change to a single setting answers with one line that names the setting and its new value, and creating something shows its card. Server owners and members with Manage community change the style with `!replies embed` or `!replies text`, and anyone can read it with `!replies`. The dashboard can also change it

The bot keeps the style with the prefix, so a chat change applies at once and a dashboard change applies within 30 seconds. A DM about a server uses that server's style. In both styles members, channels and roles show as mentions that never notify anyone, and times show in each reader's own timezone

### Bot nickname

Server owners and members with Manage community set the bot's display name in their server. Anyone can show it

| Task                                            | Command                     |
| ----------------------------------------------- | --------------------------- |
| Show the nickname and the last apply result     | `!nickname`                 |
| Set the nickname                                | `!nickname set Neon Helper` |
| Remove the nickname so the bot's username shows | `!nickname reset`           |

A nickname has 1 to 32 characters, with no control characters and no spaces at the start or end. The bot applies it at once and replies with the result. The dashboard can also change it, and the bot applies a dashboard change when it next checks for dashboard work

The bot needs the Change own nickname permission. Without it, Fluxer accepts the request but keeps the old nickname. The bot compares the nickname Fluxer returns with the requested one and reports `Grant Change own nickname to the NeonFlux role` when they differ

The nickname is applied only on an explicit set or reset. If someone renames the bot directly in Fluxer, NeonFlux leaves that name in place until the next change

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

| Task                                        | Command                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Inspect or list                             | `!custom show rules`, `!custom list`                                                           |
| Replace the response                        | `!custom update rules response text "..."` or `response embed "Title" "Description" "#3d66b8"` |
| Restrict channels or roles                  | `!custom update rules channels #general #help`, `roles @Member`, or `channels all` to clear    |
| Set the cooldown                            | `!custom update rules cooldown 30`                                                             |
| Enable or disable one definition            | `!custom enable rules`, `!custom disable rules`                                                |
| Turn the module on or off                   | `!custom module on`, `!custom module off`                                                      |
| Delete                                      | `!custom delete rules`                                                                         |
| Change an autoresponder trigger or priority | `!auto update greeting trigger contains "hello"`, `!auto update greeting priority 10`          |
| Try a text without posting it               | `!auto test hello there`                                                                       |

Use `!auto` in place of `!custom` for autoresponders. `!custom help` shows the common forms and `!custom help all` the rest

- Names use 1 to 32 lowercase letters, digits, underscores or hyphens. Built-in command names, including `help`, `health` and `setup`, are reserved, except the DM-only `mydata`
- A server stores up to 100 definitions across both kinds
- Triggers are 1 to 200 code units and match with `exact` or `contains`, ignoring case and the spaces around the
  message. Messages that start with the server's prefix never trigger autoresponders
- When several autoresponders match, higher priority wins (-100 to 100, default 0), then `exact` before `contains`, then name order. A message gets at most one response
- `!auto test <text>` checks the rest of the message as if you had sent it in this channel with your roles, and replies with the autoresponder that would answer, a better match that is cooling down for you, or that none answers. It sends nothing, starts no cooldown, stores no text and writes no audit entry. Its sample is read like other command words, so quotes group words and are not part of the text
- Scopes accept up to 500 channels and 250 roles, as many as a server can have, and replies name the first 20 of each and count the rest. When both are set, the message must be in an allowed channel and its author must hold an allowed role
- Cooldowns default to 5 seconds per definition and user and accept 0 to 3600. Setting 0 also ends a wait that is
  already running
- Text responses are 1 to 2000 code units. Embeds have a title of up to 256 and a description of up to 4000 code units, with an optional `#RRGGBB` color
- Placeholders are `{user.name}`, `{user.id}`, `{user.mention}`, `{channel.id}`, `{server.id}` and `{args}`. `{args}` is empty for autoresponders. Unknown placeholders are rejected

A response is reserved before it is sent. A failed or uncertain send still uses that message and cooldown, and nothing is resent. The bot looks up the author's membership and roles only when a definition could reply, from its member copy when it holds one, so a message that matches nothing needs no member lookup for responses

## Moderation, protections, DEFCON and appeals

Moderation needs the server owner, an Administrator or a configured staff role. Assign staff roles per area with `!mod staff moderation|cases|automod|security|appeals @role...`, or clear them with `none`. Changing configuration needs the owner or an Administrator. Native actions also need the bot's native permission and a higher role than the target. The bot refuses destructive actions against itself, the owner, Administrators and members with a higher role. Staff can act on another bot, such as a rogue one, within the same rules

A reason or appeal text is the rest of the command and needs no quotes, as in `!mod warn @user don't post invite links`. An action's reason is optional, and a case without one shows `No reason given`. Correcting a reason, watchlist entries and appeal decisions still need text. Reasons are limited to 512 code units and appeal text to 2000. Durations are whole numbers with the units `s`, `m`, `h`, `d` or `w`, in any case, combined from largest to smallest without spaces, such as `90s` or `1h30m`. A fraction or a sign, as in `1.5h`, is refused, and milliseconds are accepted only when the total is whole seconds

### Moderation and cases

| Task | Command |
| --- | --- |
| Warn, with a DM to the member | `!mod warn @user [reason]` |
| Kick, ban or unban, with a DM to the member on a kick or ban | `!mod kick\|ban\|unban @user [reason]` |
| Ban temporarily | `!mod ban @user 1d [reason]` |
| Time out, with a DM to the member, or remove a timeout | `!mod timeout @user 10m [reason]`, `!mod untimeout @user [reason]` |
| Delete up to 100 recent messages of a member, or of everyone after you confirm | `!mod purge 20 @user [reason]`, or `!mod purge 20 [reason]` and then the same message with `confirm` added |
| Set slowmode, 0 to clear | `!mod slowmode #channel 10 [reason]` |
| Turn manual sanctions on or off, or inspect | `!mod module on\|off`, `!mod status` |
| Erase one case's narratives (owner) | `!mod erase <case>` |
| Choose or clear the role whose members may view private cases on the website (owner) | `!mod private-role @role\|none` |
| Keep cases for 1 to 3650 days, or until erased (owner or Administrator) | `!mod retention <days>\|keep` |
| List or show cases | `!mod list [@user or user ID] [next]`, `!mod show <case>` |
| A case's reason changes and voiding, ten to a page | `!mod history <case> [next]` |
| Correct a reason or void a warning | `!mod reason <case> <new reason>`, `!mod void <case>`. Only a warning can be voided |
| Check an action with an unknown outcome | `!mod recover <case>` |
| Set the staff log channel | `!logs channel #channel\|off` |
| Inspect staff log delivery | `!logs status`, `!logs list [next]`, `!logs show <case>` |

Timeouts allow up to one year, temporary bans one minute to two years and slowmode 0 to 21600 seconds. When Fluxer does not confirm a slowmode change, NeonFlux reads the channel once and records the case as done if the new slowmode is there. Otherwise the case stays not confirmed, and the change is never sent again. To link a sanction or reversal to an earlier case, put `case <case-number>` before the reason, as in `!mod unban @user case 12 Appeal approved`. A purge names a member right after the count, as in `!mod purge 20 @user [reason]`, and then deletes at once. Without a member, NeonFlux only replies with what a purge of everyone would do and your message with `confirm` added. A final `confirm` is not part of the reason, and stays in the command when you typed it. Sending that within 2 minutes of its preview, from the same person in the same channel, deletes up to that many of the newest messages before it from every author. It skips the purges staff sent in the channel, member purges included: their commands, and the previews, results and errors NeonFlux answered with. A purge refused for NeonFlux's missing permission or by the backend, and its reply, are skipped too. A command NeonFlux could not read, or one from someone without Manage messages or whose permission check failed, counts like any other message, and so do the purge messages older than the last 20 or 10 minutes NeonFlux remembers. A confirm typed before NeonFlux showed its preview only previews. A purge of a member is not affected by any of this and deletes that member's newest messages among the channel's newest 500, which NeonFlux reads in five requests, so one command never reads a channel's whole history. A confirm after a preview that could not be sent, or with no preview before it, only shows a new preview, and a purge works only in a server channel. A ban is temporary when the word after the member is a length, written as the duration rule above describes. Otherwise any reason must start with a letter, and `!mod ban @user` alone is a permanent ban. Anything else, such as a number, a fraction, quotes or an emoji, is refused with the accepted form shown, instead of becoming a permanent ban, and a reason that begins with a number can start with a word, as in `after 3 strikes`. The reason after a `case <n>` link follows the same rule, and a length later in the reason, as in `spam for 7d`, is not read. The reply says whether a ban is permanent, and how long a ban, timeout or quarantine lasts

A list shows its first page, and the same command followed by `next` shows the page after the last one you saw in that channel, as each page's `Next` line says. This also holds when the pages arrive by DM, so send `next` where you sent the list

Case lists and details, case history, recovery checks and watchlist reasons answer in the channel where they were asked when it is a staff channel, after a fresh read of the channel and the reader's permissions. A staff channel is one only members allowed that answer can view: The everyone role cannot, no member overwrite other than NeonFlux's own shows it, and every role it shows holds Administrator or is a staff role for that answer, case readers for cases and security staff for the watchlist. Let NeonFlux into a staff channel with a member overwrite for NeonFlux itself, not for its role, since Fluxer does not mark a role as the bot's own and a role NeonFlux holds counts like any other role members may hold. A recovery check needs every such role to be staff for each area the check may read, since the bot cannot tell beforehand which one the case needs: Case readers, moderation staff and security staff for `!mod recover` and `!logs recover`, and moderation and security staff for `!security recover`. A thread counts as its parent channel. From any other server channel they go to the reader's DM, and the channel gets `Details sent by DM, since members who may not read them can see this channel`, since a reason posted to members cannot be taken back. Appeal text always goes to DM. Staff log posts show the action, member, actor, result, reason and, for a timed action, its duration. A log post that was not confirmed is never sent again and stays marked as not confirmed in `!logs show <case>`. `!logs recover <case>` is the same as `!mod recover <case>` and checks the case's action, not the post

A warning, timeout, kick or ban sends the member a DM titled with the action, the server and the case number, such as `Banned from <server> for 7 days, case #12`, with the reason or `No reason given`. It offers the appeal commands only while appeals are on. A kick or ban notice goes out right before the action, since a member who left may not be reachable, and a warning or timeout notice right after it succeeds. A quarantine sends no notice, since it targets suspected raiders, and bots get none. Each notice is sent at most once, and the staff reply says whether it arrived, could not be delivered or is not confirmed. Every sanction stands even when its notice cannot be delivered, and a DM that does not answer holds the action back for at most 5 seconds

The dashboard's [Private cases](WEB.md#private-cases) section shows cases, appeals and member history to the server owner and to members holding the private data role, which only the owner sets. Administrators also need the role, and staff roles do not grant it. Each view on the website waits for an access check that the bot answers with its own fresh read of the viewer's server membership, roles and the server's owner. A passed check serves views for two minutes. The website records every view in its audit log, and the chat rules above stay unchanged

Cases and closed appeals are kept until erased, unless the owner or an Administrator chooses a period with `!mod retention <days>` or on the dashboard. A period counts from a case's creation and from an appeal's closing, and a change applies to stored cases and appeals too. Records still in recovery or with an appeal stay until resolved. `!mod erase` replaces a case's narratives with an audit marker

### Automod

Automod starts disabled in `dry-run` mode, which records findings without acting. Create rules, check them, then switch to `enforce` and turn the module on

```text
!automod create repeated repeat log
!automod create prohibited words warn "literal phrase"
!automod create links domains delete "example.org"
!automod mode enforce
!automod module on
```

| Task | Command |
| --- | --- |
| List or show rules | `!automod list [next]`, `!automod show <name>` |
| Change a setting | `!automod update <name> action\|threshold\|window\|duration\|priority\|domain-mode <value>` |
| Replace, add or remove patterns | `!automod update <name> patterns "first" "second"` or `patterns none`, and `patterns add\|remove "first" "second"` |
| Set scope or exemptions | `!automod update <name> channels\|exempt-channels\|exempt-roles <mentions or IDs>...\|all` |
| Enable, disable or delete a rule | `!automod enable\|disable\|delete <name>` |
| Change the module or mode | `!automod module on\|off`, `!automod mode dry-run\|enforce`, `!automod status` |
| Check webhook and other bots' messages | `!automod bots on\|off` |

Rule types are `spam`, `repeat`, `mentions`, `mention-rate`, `link-rate`, `words`, `domains`, `invites` and `deceptive-links`. Actions are `log`, `delete`, `warn` and `timeout`. Spam defaults to 5 messages in 10 seconds, repeat to 3 in 30 seconds and mentions to 5. Thresholds allow 1 to 100, windows 1 to 300 seconds and priority -100 to 100. A server holds up to 100 rules, since every message is checked against all of them. Each rule holds up to 1000 patterns of up to 200 code units, and a server's rules hold up to 2000 patterns together, so long lists can be built across several `patterns add` commands. A rule's channels and exempt channels hold up to 500 channels each and its exempt roles up to 250 roles, Fluxer's channel and role limits per server, so no list is too short for a real server. Honeypot channels and each area's staff roles hold as many. Separate the mentions or IDs in a command with spaces or commas, and set a list longer than one message holds on the dashboard, where several can be pasted at once. `!automod show` and other replies name the first 20 patterns, channels or roles of a list and count the rest, and the dashboard lists them all

`mentions` limits the mentions in one message. `mention-rate` and `link-rate` add up a member's mentions or links across their messages in the window, so spreading them over several messages does not get around the limit. They default to 10 mentions and to 6 links in 30 seconds. Each mentioned user and role counts once, everyone counts as one mention and each web address counts as one link. Edits add nothing, and the counts are kept only while such a rule is enabled

Patterns are literal text, not scripts or regular expressions. A `words` pattern matches whole words, so `ass` catches `you ass!` but not `class`. A `*` at the start or end lifts that edge, so `cat*` also catches `cats`, `*cat` catches `bobcat` and `*ass*` matches inside any word. A `*` anywhere else is literal, and a pattern of only `*` marks is refused, since it has no text to match. Words in scripts written without spaces, such as Chinese, Japanese and Thai, match inside text. Matching ignores case and compatibility forms, so fullwidth `ＢＡＤ` matches `bad`. Domain `block` mode matches listed hosts and their subdomains, and `allow` mode flags any other host. The bot never visits a URL. Staff and exempt roles and channels are never sanctioned. A message gets at most one automated sanction across automod and security. When NeonFlux lacks the permission or role position to act on the author, an enforcing rule or honeypot logs the case instead

`deceptive-links` flags three things: A masked link whose label names another address than the one it opens, such as `[discord.com](https://example.net)`, a link whose user name or password reads as an address, such as `https://discord.com@example.net`, and a link to a host that imitates a protected domain. A host imitates one when any of these holds:

- A part of its name mixes Latin letters with Greek, Cyrillic or Armenian ones, or consists only of lookalike letters under a Latin ending, so a Russian word under `.рф` passes
- It looks the same as a protected domain or is one changed, added, removed or swapped letter away from it
- It writes a protected domain in front of more of the host, such as `paypal.com.example.net` or `login.paypal.com-example.net`
- Its registered name reads as a built-in brand under an ending the owner does not run, such as `discord.example`, `disc0rd.example` or `pay-pal.example`
- It joins a built-in brand with a lure word, such as `paypal-refund.example` or `discordnitro.example`. The lure words are login, signin, password, verify, verification, secure, security, account, recovery, support, appeal, copyright, refund, billing, payment, invoice, wallet, gift, giveaway, nitro, premium, reward, promo, claim, drop, trade, tradeoffer, staff, moderator, official and com. A name that also holds bot, bots, api, sdk, js, py, wiki or guide passes as a tool or guide about the brand. The word steam, beside the two Steam domains, counts only in a name with a hyphen, since real fan sites use it

The protected domains are fluxer.app, fluxer.gg, discord.com, discord.gg, steamcommunity.com, steampowered.com, paypal.com, github.com, google.com, youtube.com and twitch.tv, plus the rule's patterns, such as `!automod create lookalikes deceptive-links delete "example.org"` for a server's own site. The built-in brands are the names of these eleven, and the brand checks do not apply to a rule's patterns. A domain in the rule's patterns and its subdomains always pass, so a server can allow a site that uses a brand's name, such as `discord.st`. A protected domain and its subdomains always pass. So do other domains the owners run, such as discord.gift, discord.new, paypal.me, github.io, youtu.be and Google's country sites, and the fan sites discord.me, discord.bio and discords.com. Only the country sites in the owner table pass, so `paypal.nl` and `youtube.ca` are flagged unless the rule's patterns name them. A country ending passes on a rule's own pattern, such as `example.org.uk`, but not on a built-in domain. Names under `.local`, `.localhost`, `.internal` and `.lan` skip the brand checks, and protected domains shorter than six characters only match an exact lookalike. A label names an address when it has a scheme or `www.`, when its domain is protected, run by a protected domain's owner or imitates one, or when the whole label is a lowercase bare address with a common web ending and a subdomain or a path, so `file.txt`, `discord.js`, `socket.io` and `Battle.net` are not read as addresses. A code file ending without a path, as in `google.ts`, is not read as one either. A label and a link match when they name the same host, one is a subdomain of the other or both belong to one owner, and a bare label also matches another subdomain of its registered domain. On public hosting such as github.io, githubusercontent.com, discordapp.com, netlify.app and pages.dev anyone can publish, so a link there matches only a label naming that exact host or the hosting itself. A tenant of an owner's own hosting, such as github.io, passes without a label unless its name mixes scripts or puts a protected domain in front, and a tenant of other hosting gets every check, so `paypal-login.netlify.app` is flagged. The lookalike letters, lure words and owner domains come from small built-in tables, not an online lookup

Automod skips messages from webhooks and other bots until `!automod bots on`, so a leaked webhook could otherwise post freely. With it on, automod checks them like member messages, except that they have no member to warn or time out: `warn` only logs and `timeout` deletes the message. Role exemptions and honeypots do not apply to them, and NeonFlux never checks its own messages. While it is off, these messages cost no backend call. The bot learns the setting when the server starts and from each member message, so a change made on the dashboard applies from the server's next member message

### Security

Security starts disabled in `dry-run` mode. Join-burst detection, honeypot channels and the watchlist each need their own switch as well as the security module. They use events seen on the server, not an outside reputation service

| Task | Command |
| --- | --- |
| Quarantine or release a member | `!security quarantine @user 10m [reason]`, `!security release @user [reason]` |
| Lock or unlock a channel | `!security lock\|unlock #channel [reason]` |
| Configure join bursts | `!security joins threshold <2-100>`, `window <1-300 seconds>`, `module on\|off`, `raid-mode off\|defcon2` |
| Manage the watchlist | `!security watchlist add\|update @user <reason>`, `show\|remove @user`, `list [next]`, `module on\|off` |
| Manage honeypot channels | `!security honeypot add\|remove #channel`, `list`, `module on\|off` |
| Inspect open recovery | `!security recovery list [next]`, `!security recover <case>` |
| Configure the module | `!security module on\|off`, `!security mode dry-run\|enforce`, `!security status` |

Quarantine, release, lock and unlock link an earlier case with `case <case-number>` before the reason, like moderation sanctions. Join bursts, honeypot posts and watchlist joins create cases classified as `join-burst`, `honeypot` or `watchlist`. Review them with `!mod list` and `!mod show`

Quarantine is a native timeout. A longer existing timeout is kept. Lock changes only the everyone role's Send messages,
Send messages in threads, Create public threads and Create private threads permissions in that channel, so members can
neither post in the channel or its threads nor start new threads. Fluxer lets a bot lift a denial only of permissions it
holds in that channel, and a denial for everyone takes them from NeonFlux too. A lock therefore denies only the thread
permissions NeonFlux holds server-wide, its reply names any that stay open, and it first allows NeonFlux itself those
permissions in the channel unless NeonFlux is an Administrator. Unlock leaves that allow in place. Unlock restores
exactly the permissions its lock changed, as they were, and keeps unrelated later changes. Other role or member grants
can still let people speak. A thread has no permissions of its own, so locking or unlocking a thread replies with its
parent channel to lock instead

### DEFCON

| Level | Behavior                                                             |
| ----- | -------------------------------------------------------------------- |
| 3     | Normal operation                                                     |
| 2     | Staff commands and private appeals only. Public commands are blocked |
| 1     | Only critical owner or Administrator controls                        |

Use `!defcon status`, `!defcon diagnose` and `!defcon set 1|2|3`. Critical controls include status, diagnosis, DEFCON
changes, disabling protections, recovery checks, the recovery inbox, presets (applying one is still refused at DEFCON
1), unlock, release, untimeout and unban. Join bursts can raise the level to 2 when `raid-mode defcon2` is set,
never to 1. DEFCON does not change channel permissions. In single mode the bot shows the level in its presence and
restores it at startup

At level 3 every command passes the DEFCON check, so the bot reads the sender's roles and permissions for that check only while the last answer from the backend reported level 1 or 2, or when the check refuses a command the bot expected at level 3. Commands still read the sender fresh before they act. The check for each member message travels with its message protection while automod or honeypots are on, and the check for a join travels with join protection while it is on

### Appeals

Members send their `!appeal` commands in a one-to-one DM with the bot. Server membership is not required, so banned users can appeal when Fluxer delivers the DM. `!appeal cases` and `!appeal list` page with `next`

```text
!appeal cases
!appeal submit 12 Please review this case
!appeal list
!appeal show 3
!appeal withdraw 3
```

Members see only their own cases and appeals. Each case accepts one open appeal per user and 20 appeals per user in all, since closed and withdrawn appeals are kept and submitting and withdrawing again and again would otherwise store appeals without end. Staff use `!appeal review [next]`, `!appeal review open [next]`, `!appeal review <appeal>` and `!appeal approve|reject <appeal> <reason>` in a server channel or a DM with the bot. Details and decisions are sent privately. The list shows every appeal with its status, newest first, and `review open` lists only the appeals still waiting for a decision, oldest first, so a decided appeal leaves it and new ones join its end. Owners and Administrators use `!appeal module on|off`, and `!appeal status` shows whether appeals are on, how many wait for review and who reviews them. Approving an appeal does not reverse the sanction, so staff reverse it separately. The approval card names the command to check the case and the matching ones to reverse it

### Live moderation check

`pnpm smoke:live` from `projects/` is an opt-in script that checks moderation against a real development server through REST, without a gateway connection. Copy [the example](../projects/bot/smoke-live.example.json) to the ignored `projects/bot/smoke-live.local.json` and fill in the one server that the backend in `projects/bot/.env` serves, an owner or Administrator as operator, a willing member below the operator and bot as target, and a channel

Stop the gateway bot first. The script warns the target, quarantines them for 30 seconds, locks the channel and checks the DEFCON gates, then reverses each change and restores the original settings, also after a failure or Ctrl+C. It prints each check and exits with code 1 when one fails. Cases and notices remain as normal history. Its command sources are synthetic, so a pass does not prove gateway command dispatch, member DMs, visible presence or restart behavior

## Publishing and scheduled publishing

### Drafts, templates and posts

Server owners and Administrators prepare drafts and reusable templates with `!publish`

```text
!publish create announcement
!publish set announcement content "Release notes"
!publish set announcement title "New release"
!publish set announcement color #3d66b8
!publish field announcement add "Status" "Available" on
!publish preview announcement
!publish send announcement #announcements
```

The send reply gives a post number. To change the sent message, update the draft and run `!publish edit <post-number> announcement`. The bot first checks that the message still matches what it last sent

| Task                                 | Command                                                                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Create, show, delete or preview      | `!publish create\|show\|delete\|preview <name>`, `!publish list [next]`                                                     |
| Copy a draft                         | `!publish clone <name> <new-name>`                                                                                          |
| Work with templates                  | Put `template` after `!publish`, for example `!publish template create welcome`                                             |
| Copy a template into a draft         | `!publish template clone <name> <new-name> draft`                                                                           |
| Set text                             | `!publish set <name> content\|title\|description\|url\|timestamp "value"`, `color #RRGGBB`                                  |
| Set author and footer                | `!publish set <name> author "name" ["URL"\|none] ["icon URL"\|none]`, `footer "text" ["icon URL"]`                          |
| Set media                            | `!publish set <name> image\|thumbnail "URL" ["description"]`                                                                |
| Manage fields                        | `!publish field <name> add "name" "value" [on\|off]`, `set <1-25> ...`, `remove <1-25>`                                     |
| Clear parts                          | `!publish clear <name> content\|embed\|title\|description\|url\|color\|timestamp\|author\|footer\|image\|thumbnail\|fields` |
| Inspect posts                        | `!publish posts [next]`, `!publish status <post-number>`                                                                    |
| Check a post with an unknown outcome | `!publish reconcile <post-number>`                                                                                          |
| Record a post's outcome by hand      | `!publish resolve <post-number> sent <message-id>`, `!publish resolve <post-number> failed`                                 |
| Stop tracking a post                 | `!publish forget <post-number>`                                                                                             |
| Configure                            | `!publish module on\|off`, `!publish status`                                                                                |

A message has up to 2000 code units of content and one embed with up to 25 fields and 6000 code units of embed text. URLs must use HTTP or HTTPS and fit in 2048 code units. The bot does not fetch media or upload files

When a send or edit has an unknown outcome, `reconcile` reads the known message, or staff use `resolve` to record what happened. Edit and forget work again once the outcome is known. Deleting a draft or forgetting a post never deletes the message. Attempt history is kept for 180 days. Publishing starts enabled. DEFCON 2 still allows Administrators to publish, and DEFCON 1 allows only disabling, status, the post list and reconcile

### Scheduled publishing

Owners and Administrators plan one-off or repeating announcements with `!publish schedule`. Schedules and the scheduling module start disabled. A schedule copies the draft or template as it is when the schedule is created or its content is replaced, so later edits to the source do not change it

```text
!publish schedule create news draft notice #announcements 2026-11-01T18:00 Europe/Berlin reject weekly 1 3
!publish schedule module on
!publish schedule enable news
!publish schedule status news
```

| Task | Command |
| --- | --- |
| Create | `!publish schedule create <name> draft\|template <source-name> #channel YYYY-MM-DDTHH:mm IANA/Zone reject\|earlier\|later [daily\|weekly <interval> [<count>\|until YYYY-MM-DD\|ongoing]]` |
| Show or list | `!publish schedule show <name>`, `list [next]` |
| See the upcoming dates or the post | `!publish schedule dates <name> [next]`, `!publish schedule preview <name>` |
| Inspect settings or deliveries | `!publish schedule status [<name> [next]]` |
| Replace content | `!publish schedule update <name> content draft\|template <source-name>` |
| Replace time | `!publish schedule update <name> time YYYY-MM-DDTHH:mm IANA/Zone reject\|earlier\|later [daily\|weekly <interval> [<count>\|until YYYY-MM-DD\|ongoing]]` |
| Change destination | `!publish schedule update <name> destination #channel` |
| Enable, pause or cancel | `!publish schedule enable\|disable\|cancel <name>` |
| Check a known post | `!publish schedule reconcile <name> <post-number>` |
| Forget settled deliveries | `!publish schedule forget <name> [date-number ...] [confirm]` |
| Turn the module on or off | `!publish schedule module on\|off` |

Each schedule has a unique name. The first date must be in the future and may be any time ahead. A repeat ends after a number of dates, on a date (that day's post included) or never, which is the default when you give no end. A first date whose local time does not exist is rejected, and a repeated one needs `earlier` or `later`

A repeat stores up to its next 26 dates within 180 days, counted from the first date while that is further ahead, and adds the next one as each comes due. `!publish schedule show` shows the next date, and the dates list shows the stored upcoming dates. A later date whose local time does not exist, or repeats while the schedule uses `reject`, is skipped, never guessed, and `!publish schedule show` names it. A schedule counts toward the limit of 50 while it is not cancelled and has a date left to post

Enabling never catches up on missed dates. A delivery that comes due while the bot is down still sends until local midnight after its due time. Cancel closes remaining dates permanently. Scheduled posts are sent as the bot and need the bot's channel permissions, the scheduling and publishing modules and DEFCON 3. A post that comes due at DEFCON 1 or 2 waits without requests and sends once DEFCON is set to 3, until local midnight after its due time. A post that comes due while its schedule, the scheduling module or publishing is off also waits without requests, and is skipped at local midnight or, if you turned the switch back on first, as before that activation, because enabling never catches up on missed dates. Forgetting removes tracking without deleting messages. Settled history is kept for 180 days. An update removes the future dates it replaces that never started sending, and a content or channel update keeps the same times

## Role panels, reaction verification, autorole and reservations

Reaction panels, rules verification, autorole and the role picker each start disabled. The owner or an Administrator configures them. The bot needs Manage roles and a role above every role it assigns. It only assigns roles with ordinary permissions, never everyone, privileged roles or staff roles, and it does not create roles

The bot adds and removes roles one at a time and keeps unrelated roles. A panel maps up to 20 emojis, since each member reaction makes NeonFlux read every mapped emoji's reactions, and Fluxer allows 30 such reads per channel every 10 seconds and 30 different reactions on a message. It removes a role only if it added it during the member's current stay and no other panel, verification or autorole still needs it

### Reaction role panels

Compose the panel message with `!publish`, then publish it through `!roles` so the bot tracks that exact message

```text
!publish create colors
!publish set colors content "Choose your color"
!roles create colors exclusive
!roles map colors 🔵 @Blue
!roles map colors 🟢 @Green
!roles publish colors #roles colors
!roles module on
```

Toggle panels allow any combination, and exclusive panels allow one choice. Each emoji and each role appears once on a panel, so a role moves to another emoji once its old emoji is unmapped. A posted panel keeps at least one role, so to move its only role to another emoji, change the emoji on the dashboard. Members react or use `!roles choose colors 🔵`, or `!roles choose colors none` to clear. A posted panel changes under its posted message. Mapping and unmapping emojis, required and excluded roles, turning it on or off and a switch to toggle apply at once, and reactions whose role is unchanged keep counting. NeonFlux clears the reactions of an emoji whose role changed and adds its own reaction for each emoji, and a cleared emoji counts again once NeonFlux reported it, so a reaction left under the old meaning never gives the new role. Members react again for the new role. A role the panel no longer gives is taken back at the member's next reaction check, when NeonFlux gave it through the panel and nothing else needs it. A switch to exclusive waits for a new panel message, because members may hold several of the panel's roles

`!roles publish` on a posted panel posts a fresh message, and the earlier message stops giving roles. This also brings back a panel whose message was deleted. The text of the posted message can be changed with `!publish edit <post-number> <draft>`, and `!roles show` shows the post number and any emojis whose reactions are still to update. When NeonFlux could not clear them, it tries again at the next reaction on the panel, which also removes a reaction on such an emoji, and `!roles reactions <name>` finishes the update at once

Reactions on messages that are not role or verification panels or suggestion cards usually cost no Fluxer or backend requests

| Task | Command |
| --- | --- |
| Show or list panels | `!roles show <name>`, `!roles list [next]` |
| Require or exclude roles | `!roles requires\|excludes <name> <emoji> @roles...\|none` |
| Change a mapping or mode | `!roles unmap <name> <emoji>`, `!roles mode <name> toggle\|exclusive` |
| Enable, disable or delete | `!roles enable\|disable\|delete <name>` |
| Retire a published panel | `!roles retire <name>`, then `!roles next <name>` if it stopped |
| Inspect history | `!roles history <name> [next]` |
| Recheck or finish updating a panel's reactions | `!roles reactions <name>`, `!roles jobs`, `!roles resume <name>` |
| Check or withdraw a member's roles | `!roles reconcile <name> [@user] [next]`, `!roles withdraw <name> [@user]` |
| Status and module | `!roles status`, `!roles module on\|off`, `!roles help` |

Retire and delete withdraw the roles a panel granted, within the same command. That covers every revision of the panel,
because posting a fresh message leaves the grants of the earlier message behind, and a choice on the current panel
replaces those grants too. The panel stops taking choices as soon as its first revision starts to withdraw. If a role
change has an unknown outcome, `!roles reconcile` checks that member once the attempt window closes, also when the member rejoined since, and
`!roles next <name>` runs the panel's withdrawal again through every revision, so it continues from the revision that
stopped, and a stopped deletion is finished by sending `!roles delete <name>` again. `!roles jobs` counts the reaction
checks that run, wait or stopped and names the stopped panels. Withdraw and reconcile are Administrator recovery
commands. Settled role history is kept for 180 days

### Rules verification

```text
!publish create rules
!publish set rules content "Read and accept the current server rules"
!verify configure @Member ✅
!verify publish #rules rules
!verify module on
```

A member reacts to the rules panel or sends `!verify`. Chat verification uses the server's verification panel whatever
its name, and `!verify configure` creates it as `rules` and explains a name clash. With advanced verification turned on
in the dashboard, the bot instead sends a private link to the [web verification](WEB.md#web-verification) flow, where
the member guides a spark along a current visible only in motion. `!verify` always answers in the channel with the next
step, including when the link could not be sent to the member's direct messages, when the rules panel must be published
again and when the member is already verified.
`!verify status` shows whether the acknowledgement was saved and the role granted. Administrators use
`!verify review <reference>` with the reference from the member's link message to help a member who cannot complete the
web challenge, and `!verify reconcile [@user] [next]`, `withdraw [@user]`, `retire` and `next` for recovery. A review that fails
says why, such as an unknown reference or a request that is already complete

Plain reaction verification is an acknowledgement, not a CAPTCHA

A rules panel that has a role or a published message holds back member features such as role grants, temporary roles, events and birthday and anniversary consent until a member accepts the rules, even while verification is off. Until members can accept it, with verification on and the current rules panel published and turned on, the dashboard overview, `!setup` and `!recovery` show rules verification as on but needing a step, and `!health` checks its permissions

### Role picker

Members claim and drop roles on the [website](WEB.md#member-role-picker) from menus that the owner or an Administrator sets up in chat or in the dashboard. The role picker starts off

```text
!rolepicker menu add colors single "Pick one colour"
!rolepicker menu role add colors @Red @Blue
!rolepicker on
```

| Task                            | Command                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status, switch and help         | `!rolepicker`, `!rolepicker on\|off`, `!rolepicker help`                                                                                                      |
| List, show, add or remove menus | `!rolepicker menu list`, `!rolepicker menu show <name> [next]`, `!rolepicker menu add <name> single\|multi ["description"]`, `!rolepicker menu remove <name>` |
| Change a menu                   | `!rolepicker menu set <name> mode single\|multi`, `!rolepicker menu set <name> description "text"\|none`                                                      |
| Menu roles                      | `!rolepicker menu role add\|remove <name> @roles...`                                                                                                          |
| Who may use it                  | `!rolepicker access`, `!rolepicker access allowed\|blocked [next]`, `!rolepicker access allow\|block\|unallow\|unblock role\|user <mentions or IDs>`          |
| Unconfirmed role change         | `!rolepicker reconcile @user`                                                                                                                                 |

A server has up to 100 menus, which hold up to 1,000 roles together, and a role belongs to one menu. One menu may hold all of them. These bounds keep the role picker within one backend record and one backup segment. `!rolepicker menu list` shows 20 menus a page, and `!rolepicker menu list next` the following one. Menu roles follow the reaction panel rules: Below the bot's top role and the sender's, not everyone, not a staff role and only ordinary member permissions. A block always wins over an allow, and with no allowed roles or users every member who is not blocked may use the role picker. Like other role commands, turning the role picker off and removing a menu still work at DEFCON 1. Removing a menu keeps the roles members already chose

The work dispatcher wakes the server's dashboard worker when website requests are queued, so the bot handles them within a few seconds and an idle server makes no role picker requests. It reads the member fresh, the backend checks the menus, the access lists, verification and the role rules, and the role change uses the same one-time claim as reaction panels. In a single-choice menu a claim first drops the member's other role of that menu, which works only when the role picker added that role and no other feature still needs it. A drop never removes a role the role picker did not add

A role change NeonFlux could not confirm blocks that member's next choice of the role.
After its few-minute window has passed, an administrator sends `!rolepicker reconcile @user`.
It reads the member again and records whether the role is there, without repeating the change, and the member can then
choose again.
It records one role change per command and says when another is left, so send it again for that one

### Autorole and reservations

Use `!autorole add|remove @role`, `!autorole list` and `!autorole module on|off`. Autorole applies to future joins only and to humans by default. It gives any of the server's roles, up to the 250 Fluxer allows. NeonFlux gives a join's autoroles, and the ones a rules verification unlocks, beside its handling of the server's events, so joins, commands and reactions about other members never wait for them. It gives them in rounds of five, and the member's own reactions, `!roles choose`, `!verify` and `!onboarding`, and a staff `reconcile` of that member, run between two rounds, so they wait for at most five of those roles. A command that has to wait says so at once and replies when it is done. Retiring or deleting a panel or the autorole list, and `next`, answer at once too and take back each member's roles in the background, after the server's earlier role work, such as autorole passes, is done. Autorole passes, `withdraw`, retiring, deleting, `next` and `!temprole reconcile` run one at a time per server in the order they came. NeonFlux adds one role per request, and Fluxer allows 20 of them per server every 10 seconds, so a long list takes a while and goes on as soon as Fluxer allows more. A restart forgets the roles that were not given yet. `!autorole humans off` includes bots. When verification is configured, autorole waits for it

A reservation gives an exact user ID extra roles when that user joins or rejoins, even before they are a member. Use `!autorole reserve <user-id> @roles...`, `!autorole unreserve <user-id>` and `!autorole reservations [next]`, which counts them and lists 10 at a time, or the dashboard. Up to 200 users can have one to 20 reserved roles, which keeps a change with the whole list inside one bot request. Saving does not grant roles to current members, and removing a reservation does not take roles away. Recovery uses `!autorole retire` once the list and reservations are empty, which withdraws every earlier revision of the list that granted roles first, `next`, `history [next]`, `reconcile @user [next]` and `withdraw @user`. `withdraw` answers at once and takes back every autorole role of the member in the background, with a note when Fluxer's role limit holds back the rest. When it is done it replies with the roles it removed and the claims it released, and counts apart the roles that were already gone, the ones another feature still gives and the ones NeonFlux did not confirm it gave, which it never removes. It stops at a role whose last change is not confirmed and names `reconcile`. A restart stops a withdrawal that has not finished, and sending `withdraw` again continues it

### Temporary roles

Staff give a member a role for a set time, and NeonFlux removes it when the time ends. Giving, renewing, shortening, ending and listing need Manage roles, or the server owner or an Administrator, and giving or ending a role also needs a highest role above it. The role follows the rules of every role NeonFlux assigns: Below the NeonFlux role, not the everyone role, not a staff role and only ordinary member permissions. Like other role grants, a member who is timed out, quarantined or has not accepted configured rules verification cannot receive one

```text
!temprole add @member @Winner 7d
!temprole set @member @Winner 3d
!temprole remove @member @Winner
```

| Task                                              | Command                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Give a role for a set time                        | `!temprole add @member @role [duration]`                                                                        |
| Renew or shorten a grant, counted from now        | `!temprole set @member @role <duration>`                                                                        |
| End a grant early and remove the role             | `!temprole remove @member @role`                                                                                |
| List grants, the earliest end first               | `!temprole list [@member] [next]`                                                                               |
| Show or change role defaults, ten roles to a page | `!temprole defaults [next]`, `!temprole default @role <duration>\|none`, `!temprole max @role <duration>\|none` |
| Recover after an unconfirmed role change          | `!temprole reconcile @member`                                                                                   |

Durations are written like other durations, in any case, such as 30m, 12h, 7d, 2w or 1d12h, from 1 minute to 100 years, which keeps every end a calendar date. Without a duration, `add` uses the role's default duration, and a role's longest duration limits `add` and `set`. Defaults need Manage community and can also be set in [the dashboard](WEB.md#temporary-roles). A member holds one grant per role, so up to all of the server's roles, and up to 1,000 roles, as many as NeonFlux reads of a server, have defaults. `!temprole list @member` shows a member's grants ten to a page

NeonFlux removes only roles it adds, so a role the member already holds cannot become temporary. When the time ends, the bot reads the member and the server's roles fresh and removes the role through the same role ownership as panels and autorole:

- A role that staff already removed is left alone, and the grant ends
- A role another NeonFlux feature, such as a reaction panel or autorole, still gives stays, and the grant ends
- A member who leaves loses the role with the membership, and the grant waits until its end time. A member who rejoins before then gets the role back once join protection lets the join through, after the usual checks of DEFCON, timeout, quarantine, rules acceptance and the role's rank, with new role ownership for the new membership. The join moves the grants and NeonFlux gives the roles back right after, beside event handling, so a member's grants and autoroles never hold up the joins after them. A role the member already holds on rejoining is left alone. `!temprole remove @member @role` ends a waiting grant
- A member who cannot receive the role yet, because they still need to accept the rules or a timeout, quarantine or the DEFCON level blocks it, waits. `!temprole list` and the dashboard say so, and NeonFlux tries again every 10 minutes until the end time and at once when the member accepts the rules. The recovery inbox leaves these grants out, since they need no staff step
- A rejoin while the bot is offline moves the grant only when the member accepts the rules or staff run `!temprole reconcile @member`. Otherwise the grant ends at its end time
- A deleted role ends the grant
- Fluxer adds or removes 20 roles per server every 10 seconds. When its limit holds back the role change of a running, rejoined or ended grant, NeonFlux tries again as soon as the limit allows, without showing a problem. `!temprole add` that cannot give the role, for this or any other reason except an unconfirmed change, keeps no grant and says so, so send it again
- When NeonFlux lacks Manage roles or ranks at or below the role, the grant stays with the problem shown in `!temprole list` and the dashboard, and NeonFlux tries again every 10 minutes once the grant has ended. A problem recorded before the end time shows as needing attention in `!temprole list` and waits for the end time as well. `!health` names the fix
- An end time that passes while the bot is offline is handled soon after the bot starts again

If Fluxer does not confirm a role change, NeonFlux never repeats it. The grant shows the problem until the server owner or an Administrator runs `!temprole reconcile @member`, which reads the member's roles, records what Fluxer shows and settles the member's grants. For a member who left, it settles their grants without a role read. It answers at once and settles the grants in the background, so later commands never wait for it, and it replies with the result when it is done. A restart stops a check that has not finished, so send it again. Giving and renewing need DEFCON 3. Ending, listing and recovery also work at DEFCON 1 and 2 for the server owner and Administrators

Each role change is kept in the role history for 180 days like other managed role changes, and the Fluxer audit log shows `Temporary role` or `Temporary role ended` as its reason. A renewal changes only the end time, so it adds no role history entry

### Newcomer checklist

A checklist of up to five steps guides new members through features the server already uses. New members see it with their welcome or DM greeting, and anyone checks what is left with `!onboarding`. The checklist starts off. The server owner or an Administrator sets it up in chat or in [the dashboard](WEB.md#newcomer-checklist)

```text
!onboarding add rules
!onboarding add panel colors
!onboarding add menu languages
!onboarding add link #introductions "Say hello and tell us what you play"
!onboarding role @Settled
!onboarding on
```

| Task                                     | Command                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| Show your own checklist and what is left | `!onboarding`                                                                              |
| Show the checklist as configured         | `!onboarding status`                                                                       |
| Add a step at the end                    | `!onboarding add rules`, `add panel <name>`, `add menu <name>`, `add link #channel "line"` |
| Remove a step                            | `!onboarding remove <position>`                                                            |
| Choose the greeting that carries it      | `!onboarding delivery welcome\|dm`                                                         |
| Set or clear the completion role         | `!onboarding role @role\|none`                                                             |
| Turn it on or off                        | `!onboarding on\|off`                                                                      |

Members finish each step through the feature it names, and NeonFlux follows what those features already record:

- `rules`: Accept the current rules through [rules verification](#rules-verification), including the website challenge when advanced verification is on
- `panel <name>`: Hold a role from that published [reaction role panel](#reaction-role-panels)
- `menu <name>`: Hold a role from that [role picker](#role-picker) menu
- `link #channel "line"`: A channel to visit with a line of up to 100 characters. It needs no finishing

A step whose panel, menu or rules verification is not published or turned off is left out until it is back. The checklist goes at the end of the greeting of the chosen route, so that route must be configured and on, see [welcome and goodbye](#welcome-and-goodbye). The greeting copies the checklist when the member joins

NeonFlux checks a member's progress when their roles change, while it holds a role of every step, and when they send `!onboarding`. It keeps the checklist and the roles that finish each step in memory and reads them again after its own changes and every ten minutes, so ordinary role changes cost no backend request. A member finishes the checklist once per membership. A finished member is counted for [server analytics](#server-analytics), as a number only, and receives the completion role when one is set. The completion role follows the rules of every role NeonFlux assigns, and a member who is timed out, quarantined or has not accepted configured rules cannot receive it. If Fluxer refuses the role, `!onboarding` tries again. If Fluxer does not confirm it, NeonFlux never repeats it. NeonFlux does not remove the completion role, also not when it is changed or cleared later

At DEFCON 1 only turning the checklist off and `!onboarding status` work, for the owner and Administrators. Members use `!onboarding` like other member commands, so DEFCON 2 blocks it for them

## Welcome and goodbye

Owners and Administrators configure three routes: a channel welcome, a private DM greeting and a channel goodbye. All start off and apply to human members. Compose the message as a [publishing template](#drafts-templates-and-posts). A route follows its template by name, so an edit to the template reaches the next greeting right away. When the template is deleted or an edit makes it invalid for the route, such as a placeholder the route cannot fill, the route sends the copy saved when it was last configured. A greeting that waits for rules verification keeps the text rendered when the member joined

```text
!welcome configure arrival #welcome join
!welcome dm configure private_arrival verified
!goodbye configure departure #departures
!welcome module on
!welcome dm module on
!goodbye module on
!welcome preview
```

Each of `!welcome`, `!welcome dm` and `!goodbye` supports `configure`, `module on|off`, `clear`, `preview`, `show`, `status [delivery-number]`, `history [next]`, `member @user` and `help`. `!welcome rate <1-60>` sets the shared sending pace per minute, default 10, and `!welcome retention <30-3650>` sets how many days delivery history is kept, default 30

- Placeholders are `{user.name}`, `{user.mention}`, `{user.id}`, `{server.name}`, `{server.id}` and `{channel.id}`. `{user.mention}` can notify only the greeted member, and `{channel.id}` works only in channel routes. Fluxer notifies only for mentions in the message text, so a channel greeting whose `{user.mention}` appears only in its embed also starts its text with the mention, unless the text is too long to take it
- Filled-in placeholders can make a greeting longer than its template. When the message text would pass 2,000 characters, or the embed would pass one of Fluxer's embed limits, every text in that part that grew is cut back to its length in the template, so a valid template always goes out
- Welcome and DM routes need `join` or `verified` timing. `verified` waits until the member completed rules verification and holds the access role
- Enabling a route does not greet existing members, and the bot greets a join only when it sees the join within 15 minutes
- Goodbye is sent when a member leaves, including members who joined before the bot started tracking. The bot cannot tell whether a departure was voluntary, a kick or a ban
- A join or departure while DEFCON is below 3 or while moderation restricts the member, such as a quarantine or, for a join, a timeout, gets no greeting, also not once that ends
- Preview sends a sample for the invoking staff member in the current channel
- A delivery with an unknown outcome is never resent
- While the [newcomer checklist](#newcomer-checklist) is on, the welcome or DM route it names ends with the checklist and a line naming `!onboarding`. When the greeting is too long for both, only that line is added, and nothing when even that does not fit in 2,000 characters
- One delivery pass considers at most 20 due greetings and reads at most ten pages of waiting greetings. Greetings beyond that continue a minute later. While DEFCON is below 3 a greeting queued before that waits without Fluxer requests and is checked again every ten minutes, so it is sent up to ten minutes after DEFCON is 3 again, if its 24 hours have not passed. A verified greeting is also checked every ten minutes instead of every minute while rules verification is off, or its panel is disabled, being withdrawn, unpublished or edited but not republished, so it can lag up to ten minutes after verification is usable again

## Tickets

Tickets start disabled. Owners and Administrators configure categories, conversation visibility, an optional native parent category, up to 250 dedicated support roles, as many as Fluxer allows in a server, up to 25 intake questions of at most 200 characters and canned replies that follow publishing templates. A canned reply sends its template's latest content, or the copy saved when it was set once the template is deleted or no longer valid. A category takes any number of canned replies, up to 256 KiB of them together because they are stored with the category, and a ticket sends the ones its category has at that moment. When a category is deleted, its open tickets keep the canned replies it had until a new category of that name replaces them. Ticket support roles are separate from moderation staff roles. A category with no support roles leaves staff access to Owners and Administrators

```text
!ticket help
!ticket module on|off
!ticket retention <1..365 days>
!ticket categories [next]
!ticket settings
```

Ticket commands work in server channels and in a DM with NeonFlux. Text that only part of the server may read answers outside a DM only in a channel that keeps everyone else out. Public category descriptions never show questions or canned content

| Answer | Where it answers |
| --- | --- |
| Staff notes and `!ticket intake` | A DM, or a server channel only the ticket's support roles and NeonFlux can see. Never a ticket channel, because the requester reads it |
| Transcripts | A DM, the private ticket channel, or a server channel only the ticket's support roles, its requester and NeonFlux can see |
| `!ticket list` | A DM lists every ticket you can see. A server text channel lists only the tickets whose readers include everyone who can read that channel, and says when it left some out |
| `!ticket answer`, `review`, `submit` and `cancel` | A DM only, because they carry intake answers |

A server channel counts when the everyone role is denied View channel there and every role or member allowed to view it belongs to that audience. Administrators see every channel. Threads and forum posts never count

```text
!ticket category create <name> private|public #parent|none @support-roles...|none
!ticket category show|delete <name>
!ticket category set <name> description "text"
!ticket category set <name> visibility private|public
!ticket category set <name> parent #category|none
!ticket category set <name> staff @roles...|none
!ticket category set <name> enabled on|off
!ticket question <category> add "question"
!ticket question <category> set <1..25> "question"
!ticket question <category> remove <1..25>
!ticket question <category> clear
!ticket canned <category> set <name> <publishing-template>
!ticket canned <category> remove <name>
!ticket canned <category> list [next]
```

Members open a ticket with `!ticket open` in a server channel or a DM, or by reacting to a ticket panel. The questions always go to the member's DM, and a server channel gets only a line that the intake started there. When NeonFlux cannot open the DM, no intake is made and the reply asks the member to allow direct messages from the server. Without a category name the one category that is on opens, and otherwise the categories are listed. Intake shows who will see the conversation before any answer is entered and again before submission. Each answer allows 2000 characters and stays private even when the conversation channel is public. A category change after an intake starts makes submission fail instead of silently changing that intake

```text
!ticket open [category]
!ticket answer <intake-number> <1..25> "answer"
!ticket review|cancel <intake-number>
!ticket submit <intake-number> private|public
```

After `!ticket open`, the bot asks the first question. While a member has exactly one open intake, any DM from them that is not a command answers the current question, and the bot replies with the next one. Once every question is answered, it says how many are answered and who will see the conversation, then waits for a plain-word reply. `!ticket review <intake-number>` shows the answers:

| Reply          | Effect                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| Any other text | Answers the current question                                                                                |
| `back`         | Clears the previous answer, or the last one at the confirmation step, shows it and asks that question again |
| `send`         | Creates the ticket for the shown audience, once every question is answered                                  |
| `cancel`       | Cancels the intake                                                                                          |

The words match without regard to case. An answer with an attachment or sticker is refused, because answers keep text only, and an answer over 2000 characters gets a reply naming the limit. With more than one open intake, a plain DM gets one reply that names each intake, with its server in multi-server mode, and the `!ticket answer` and `!ticket cancel` commands, instead of a guess. Without an open intake, plain DMs get no reply. Each plain DM costs one backend read to look for an open intake

Owners and Administrators can post a ticket panel for a category in a text channel

```text
!ticket panel <category> #channel
!ticket panel <category> remove
!ticket panels [next]
```

A panel shows the category's name and description and asks members to react with 🎫. NeonFlux checks that it can view, send, add reactions and read history in the channel, posts the panel once, reacts with 🎫 and saves it. A post whose result is unknown is never repeated, and the reply asks staff to check the channel. Each category has one panel, so a new panel replaces the old one and NeonFlux deletes the old message once. Removing a panel, or deleting its category with `!ticket category delete` or on the dashboard, deletes the panel message once. A member's 🎫 sends them a DM that names the category and server, opens the intake there with its first question and removes the member's reaction once. Refusals, such as a full intake limit, go to the DM. Without a DM nothing is posted and the reaction is still removed, so the member can react again once they allow DMs. NeonFlux reads a server's panels on the first reaction after it starts and then keeps them in memory, so reactions on other messages cost nothing

Staff work in the ticket's own channel, where the ticket number may be left out of `show`, `claim`, `unclaim`, `priority`, `reply`, `close` and `reopen`. Requesters can read their own tickets and close or reopen them. Staff can also open a ticket for a help post's author with `!escalate`, see [forum help desk](#forum-help-desk)

| Command | Who | Behavior |
| --- | --- | --- |
| `!ticket list [next]` | Staff, requester | List visible tickets, 10 per page. Each page looks through the 25 newest tickets before it, so a page can be empty with a `next` line. Outside a DM it lists only the tickets whose readers cover the channel |
| `!ticket show [ticket]` | Staff, requester | Show the ticket's state, people, category, priority, channel and transcript |
| `!ticket intake <ticket>` | Staff, requester | Show the private intake answers |
| `!ticket attempt <ticket> [attempt]` | Staff, requester | Show what the ticket's last action did, or one numbered attempt |
| `!ticket claim\|unclaim [ticket]` | Staff | Take or release the ticket |
| `!ticket priority [ticket] low\|normal\|high\|urgent` | Staff | Set priority |
| `!ticket reply [ticket] "text"` or `canned <name>` | Staff | Post a reply in the ticket channel |
| `!ticket note <ticket> add "text"`, `list [next]` or `show <note>` | Staff | Private staff notes, kept apart from intake and channel history. The list shows 5 notes per page as short snippets, and `show` reads one in full |
| `!ticket close\|reopen [ticket]` | Staff, requester | Remove or restore send access |
| `!ticket reconcile <ticket>` | Staff, requester | Recheck a partial close, reopen or create against the live channel |
| `!ticket transcript <ticket> capture` | Staff, requester | Bring the ticket's transcript up to date in the background |
| `!ticket transcript <ticket> list [next]` | Staff, requester | List stored transcripts, 10 per page |
| `!ticket transcript <ticket> show <transcript> [next]` | Staff, requester | Read a transcript in 1500-character pages |
| `!ticket transcript <ticket> file [transcript]` | Staff, requester | Send a whole transcript as text files of at most 4 MiB each, the ticket's own transcript when no number is given. In a server channel NeonFlux needs Attach files there |
| `!ticket delete <ticket> confirm` | Owner, Administrator | Delete the closed ticket channel and release it. It waits while the closing transcript is being saved |
| `!ticket erase <ticket> confirm` | Owner, Administrator | Erase stored intake, notes and transcripts |
| `!ticket abandon <ticket>` | Owner, Administrator | Release the requester's slot after a channel creation whose result stayed unknown |

Creation sets the full conversation audience in the first channel request, and the introduction contains metadata only
with mentions disabled. Close removes send access for everyone and the requester, including sending in the ticket's
threads and starting new ones, as far as NeonFlux holds those thread permissions server-wide. Reopen restores the
recorded permissions and leaves unrelated ones untouched. Fluxer lets NeonFlux lift a denial only of permissions it
holds in the channel, so a close first allows NeonFlux itself the thread permissions it holds there, unless it is an
Administrator. Another role or member allowed to send or post in threads blocks closing until staff remove that grant.
Staff keep send access, and Administrator permission still bypasses these overwrites. Renaming or moving a ticket
channel does not block replies, close, reopen or delete

If close, reopen or creation is interrupted, the ticket stays unresolved until `!ticket reconcile` confirms the live
state. NeonFlux never retries an operation with an unknown result or searches for a channel by name. When reconcile
finds a first close or reopen step unchanged, the ticket returns to the state it had, open or closed, while an unchanged
second step keeps the first step's progress. When an established ticket's channel is confirmed gone, for example deleted
by hand, reconcile retires the ticket and frees the requester's slot, even after retention removed its last action, and
the stored bodies start their retention period. A creation or delete that was never confirmed keeps its own rules. A
ticket closed before NeonFlux allowed itself the thread permissions may still fail to reopen with a permission error.
Give NeonFlux the missing permission, or delete the channel and reconcile the ticket. After `!ticket abandon`, check the
server for a leftover channel yourself. Erasing such a ticket also releases the slot but keeps protection for a channel
that might exist

Private bodies require current server membership, the ticket's recorded requester and support-role access and native view and history permission. A requester who rejoins with the same account regains access. Deleting a channel needs explicit confirmation, a successful delete response and a fresh check that the channel is gone

Closed ticket bodies expire after 30 days by default, configurable from 1 through 365 days. Reopen is unavailable after expiry or erasure. Erasure removes stored copies only and never deletes messages already sent. Body retention never deletes native channels

Every close brings the ticket's transcript up to date in the background, and so does `!ticket transcript <ticket> capture`. NeonFlux reads the ticket channel and each of its public threads, active or archived, from where the transcript left off, so closing again after a reopen adds only the new messages. Each message keeps its author's name and ID, its time, its text, the name, size and link of each attachment, the text of each embed and the names of its stickers. Attachment links work while Fluxer keeps the files. Private threads are left out, because their members need not match who can read the transcript. The ticket channel's introduction says that a transcript is saved when the ticket closes

Saving reads only and never posts. A save that fails, usually for a missing View channel or Read message history permission or because someone outside a private ticket's readers was given access to its channel, is tried again every 10 minutes, and after 6 tries `!ticket show` names the fix and the capture command. A ticket channel that is gone ends the save with what it holds. Transcripts saved by earlier captures stay readable. To share a public summary, write a separate publishing draft, because private content is never copied automatically

## Message leveling

Owners and Administrators configure message XP with `!level`. Current members can read `!rank` and `!leaderboard`. Rank cards are native embeds, replies never notify anyone, and cards and leaderboards show members as mentions without storing display names or avatars

Leveling starts disabled with 15 XP per eligible message and a 60-second cooldown. Level N needs `100 * N²` lifetime XP, up to level 1000. Scores belong to the account in this server and survive leaving and rejoining. While leveling is off, messages cost no leveling backend call: after the backend answers that leveling is off, the bot sends no XP candidates for ten minutes, or until a `!level` or `!preset` command or a leveling or preset change on the dashboard. Turning leveling on from either, or by restoring a backup, takes effect immediately

| Command                                               | Behavior                                                                                                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `!level help`                                         | Show the common forms. `!level help all` lists the rest                                                                                                                           |
| `!level config`                                       | Show the status, the rate, which channels earn XP, how many excluded channels, excluded roles and role rewards are set, and where level-up messages go                            |
| `!level config only\|channels\|roles\|rewards [next]` | List the channels that earn XP, the excluded channels, excluded roles or role rewards, 10 per page                                                                                |
| `!level module on\|off`                               | Start or pause XP and new reward grants                                                                                                                                           |
| `!level rate <1-100 XP> <15-3600 seconds>`            | Set XP per message and cooldown                                                                                                                                                   |
| `!level only channels <IDs...\|none>`                 | Let only these channels and their threads earn XP, up to 500, Fluxer's channel limit per server. `none` lets every channel earn XP again. Excluded channels and roles still apply. A category is refused, since it holds no messages. Set a list longer than one message holds on the dashboard |
| `!level exclude channels\|roles <IDs...\|none>`       | Replace the exclusion list, up to 500 channels or 250 roles, Fluxer's limits per server. A category is refused, since it holds no messages. Set a list longer than one message holds on the dashboard |
| `!level announce off\|here\|#channel [rewards]`       | Turn level-up messages off, post them where the member leveled up or in one text or announcement channel of this server. `rewards` posts only for levels with a reward role       |
| `!level map <1-1000 level> @role`                     | Add a reward role, up to 250 mappings, as many as a server has roles                                                                                                              |
| `!level unmap <level>`                                | Remove one mapping                                                                                                                                                                |
| `!level clear [confirm]`                              | Preview, then clear all mappings                                                                                                                                                  |
| `!level correct @user <0-100000000 XP> <reason>`      | Set an absolute XP value with an audit entry                                                                                                                                      |
| `!level reset member @user <reason> [confirm]`        | Preview, then reset one member                                                                                                                                                    |
| `!level reset server <reason> [confirm]`              | Preview, then start a new season for everyone                                                                                                                                     |
| `!level status`                                       | Show pending and blocked reward work, and how many member records exist, including members who now have no XP                                                                     |
| `!level reconcile [@user]`                            | Queue a reward check for the server or one member. For a member it first records what Fluxer shows for a reward role change that was not confirmed, one change per command        |
| `!level audit [next]`                                 | Read correction and reset audits, 10 per page                                                                                                                                     |
| `!rank [@user or user ID]`                            | Show XP, level and rank                                                                                                                                                           |
| `!leaderboard [next]`                                 | Show 10 rows ordered by XP                                                                                                                                                        |

Reasons need no quotes. A reset's final word `confirm` confirms it, and the words before it are the reason, so the preview prints the exact command to send. Corrections apply in the order their commands were sent, so an older correction that arrives late is rejected. `!leaderboard next`, `!level audit next` and `!level config <list> next` continue where your last page in that channel ended. Rows can shift between pages while XP is awarded. After a server reset, `!leaderboard next` reports the change and forgets its place, so start again with `!leaderboard`. Rank is exact for every member: One plus the members with more XP this season. Members with the same XP share a rank, so the ranks run 1, 2, 2, 4, and the card shows `#26` or, for a member who shares it, `#26, tied with 996 others`. Members with zero XP are unranked. A server that used leveling before exact ranks existed counts its members in the background, 200 at a time, and until then `!rank` answers `Counting, try again in a minute` and `!profile` shows only the level

XP comes only from human ordinary or reply messages in the configured server that pass existing protection and command gates. Bots, system messages, webhooks, DMs, edits, prefix commands and empty text earn nothing. Duplicate text within ten minutes earns nothing. Candidates wait in a memory queue of at most 1,000 accounts with one waiting message for each member. A restart loses the messages waiting at that moment, and a full queue skips a message and counts it in the ten-minute cost line. A message inside a member's cooldown is skipped without a backend call, because it could not earn

Level-up messages start off. When on, a member who reaches a new level gets one plain message such as `@member reached level 5`, whose mention notifies nobody, in the channel or thread of the message that earned it or in the chosen channel. They are best effort: a dropped award or a message NeonFlux cannot send means no message and is never tried again. A server whose optional work is paused earns no XP, so it sends none

Leveling never stores message text, display names or avatars. It keeps account and message IDs, timestamps and a keyed digest for duplicate detection, retained for ten minutes. Correction and reset audits keep actor, target, XP before and after, reason and time for 180 days

Reward roles are cumulative and use the shared safe-role checks, so NeonFlux needs Manage roles and a role above each reward. Collection itself does not need Manage roles. Awards, corrections, resets and mapping changes mark an account for a reward pass, and a failed role change keeps the account marked for a later pass without blocking other roles. While DEFCON is below 3, which refuses new reward grants, an account that is left unsettled only because the backend refused its role changes, which DEFCON does for additions, is tried again after an hour instead of a minute, and setting DEFCON to 3 makes it due at once or within a minute. A removal refused for another reason while DEFCON is below 3 also waits the hour. Any other failure is tried again after a minute. Turning leveling off keeps existing rewards, while clearing mappings, resets and demotions still remove rewards NeonFlux granted. A server reset hides old scores at once. A rejoining member keeps XP but must earn role ownership again through a new message or `!level reconcile @user`. NeonFlux removes only roles it granted and confirmed, and preserves roles granted any other way

## Events and RSVPs

Events start disabled and use `!event`. Owners and Administrators manage definitions. Current members read published events and RSVP in the event's destination channel, and `!event list` lists them. Attendee lists show members as mentions, and replies never notify anyone. DMs cannot run event commands

Commands name an event by its name, in any letter case. A new event follows this flow, with your own channel, date and zone

```text
!event create study #channel "Study group" "Bring your questions"
!event time study 2026-11-01T18:00 Europe/Berlin 60 reject
!event repeat study weekly 1 4
!event dates study
!event module on
!event publish study
```

| Command | Behavior |
| --- | --- |
| `!event list [next]` | List events in this destination |
| `!event show <name>` | Read one event |
| `!event dates <name> [next]` | List the dates with their numbers from the earliest date that has not ended, 10 per page, shown in each reader's own timezone |
| `!event attendees <name> <date> [next]` | List attendees and the waitlist, 10 per page |
| `!event rsvp <name> [date] going\|maybe\|not-going\|none` | Set or clear your RSVP for the date with that number, or without a number for the event's next date that has not started and is not cancelled. The reply names the date |
| `!event mine` | List your Going and Maybe RSVPs for this destination's events whose date has not ended, soonest first, at most 20, each with the event's name |
| `!event create <name> #channel "title" ["description"]` | Create a draft event with a name of up to 32 lowercase letters, numbers, underscores or hyphens that no other event of the server uses. The title has up to 256 characters and the description up to 1000, each on one line |
| `!event time <name> YYYY-MM-DDTHH:mm <IANA zone> <minutes> [reject\|earlier\|later]` | Set the first occurrence. A single date lasts any number of minutes from 1 and ends by 9999-12-31, and a date of a repeat lasts up to 259200 minutes (180 days), the window repeats store dates in. `!event repeat` checks this again |
| `!event repeat <name> off\|daily\|weekly <interval> [<count>\|until YYYY-MM-DD\|ongoing]` | Set repetition. Without an end the event repeats until it is cancelled |
| `!event move <name> <date> YYYY-MM-DDTHH:mm [reject\|earlier\|later]` | Move one date that has not started to a new start in the event's zone. It keeps its number, length, replies, seats and waitlist |
| `!event title <name> "title" ["description"]` | Change the text |
| `!event template <name> <template>\|off` | Use a snapshot of the publishing template as it is now |
| `!event capacity <name> off\|<seats>` | Limit Going seats |
| `!event reminders <name> off\|<minutes> [minutes …]` | Set up to 20 reminder offsets in minutes before the start. A single date is stored when it is set, so its reminder can come any time before it, and a reminder whose time has already passed is skipped, never sent late. A repeat's reminders are 1 to 257760 minutes (179 days), since its later date is stored once it is 180 days ahead. A repeat with more than 26 dates stores its next 26 and adds each later date with its reminders as an earlier one starts, so its reminders reach at most 26 dates ahead less one day, such as 36000 minutes (25 days) for a daily repeat. A longer reminder, or a repeat change that would need one, is refused with that reason |
| `!event publish\|cancel <name>` | Publish the card or cancel the event |
| `!event status [<name> [next]]` | Show the module, or one event's card and reminder outcomes |
| `!event reconcile <name> [post-number]` | Recheck a known card or reminder message |
| `!event forget <name> [confirm]` | Remove settled event data in pages |
| `!event module on\|off` | Turn the module on or off |
| `!event threads on\|off` | Turn discussion threads on or off for events published afterwards |

Date numbers count across the whole server, so `!event dates` shows the number of each date. A date keeps its number when its time changes. Without a number, an RSVP answers for the event's next date that still takes RSVPs. When no date does, NeonFlux says so and names `!event dates`. Going takes a seat or the next waitlist place. Repeating Going keeps your place, and withdrawing then choosing Going again counts as a new answer. Maybe, Not going and None use no seat. RSVPs close at start or cancellation. Waitlisted members are promoted only while they are still members with access and pass verification, timeout and quarantine checks. Members who leave lose their seat

Times use an exact local minute and an IANA zone, and wall-clock times hold across offset changes. The first date may be
any time ahead. A repeat ends after a number of dates, on a date (that day's date included) or never. It stores up to
its next 26 dates within 180 days, counted from the first date while that is further ahead, and adds the next date with
its reminders as each starts. A first date whose local minute does not exist is rejected, and a repeated one is rejected
unless you choose `earlier` or `later`. A later date whose local
time does not exist, or repeats while the event uses `reject`, is skipped, never guessed, and `!event show` names it.
Capacity cannot drop below the Going attendance of a date that has not started

A published event's time can change until it is cancelled or completed, also after members replied. `!event time` and
`!event repeat` give the dates that have not started the new times in order, and each keeps its number, replies, seats
and waitlist order. New dates are added, and open dates past a shorter end are cancelled with their replies kept for 30
days. Started and completed dates never change, and a draft simply takes the new dates. Once a repeat's first date has
started, `!event repeat` continues from its next date that has not started, with a count counted from there, and
`!event time` keeps the dates a count has left. Once every date of a counted repeat has started, no date is left to
move, so `!event time` is refused and `!event repeat` sets a new repeat from the date the series would come to next.
Reminders follow the new times and the card is edited. Members who replied Going or Maybe to a date a change moved or
cancelled get one DM per change that lists
their dates, up to 5 and then a count with a pointer to `!event mine`. A member who left or joined again since replying is
not told. The DM has mentions off. NeonFlux counts each
member as told before it sends, so a DM is never sent twice, and one that fails is counted and not retried. A change
before a notice began going out joins it, and a later one gets its own notice once that one is done, so no member hears of
one change twice. Notices wait while events are off or DEFCON is below 3, and a date that starts
before its notice goes out is left out. Cancelling the whole event with `!event cancel` sends no DM and drops a notice that
has not gone out. `!event status <name>` shows how many members were told and how many could not be reached

Each event has one protected publishing card that follows publishing limits. The card shows the event's earliest date
that has not ended and how it repeats, and ends with an RSVP line, such as ``Send `!event rsvp study going` or `maybe` here``. A reminder's
RSVP line names its date's number. A card whose template leaves no room within the embed limits is posted without the
line. The line uses the server's prefix when the card is posted or edited, so after a prefix change an existing card
shows the old prefix until the event changes. `!event show` names the next date that has not ended, or says none are left. Event changes edit
the card, and RSVPs do not. `!publish` cannot edit or forget event cards. Reminders default to 1440 and 60 minutes
before start, are skipped if already past due on activation and must send before the event starts. Automatic cards and
reminders send as NeonFlux and need its channel permissions, the module and publishing switches and a DEFCON level that
allows them. DEFCON 2 pauses automatic sends and public RSVPs. A reminder that comes due while events or publishing are
off or DEFCON is below 3 waits without requests and goes out when they allow it again, if its five minutes have not
passed. Cancellation and disable never delete or edit posted messages, so a cancelled event's card keeps its text, and
the event's status shows it as cancelled. A send with an unknown result is never repeated, so use `!event status` and
`!event reconcile` to recover it

An event's destination can be a forum or media channel. Its card then becomes the first message of a forum post named after the event, reminders go into that post, and members and staff run event commands in any post of the forum. In a text or announcement channel, commands stay in the channel itself

Discussion threads start off. With `!event threads on`, each event published afterwards gets a discussion thread on its card once the card is sent, named after the event and archived after a week without messages. In a forum the post is the discussion. Once the last occurrence ends or the event is cancelled, NeonFlux archives and locks the thread or post, so a repeat with no end keeps its discussion open until it is cancelled. It created both, so it needs only Create public threads, which `!health` checks while threads are on. A thread that cannot be started or closed is tried again every minute, and starting one twice is not possible, because a thread started on a message takes the message's ID. Threads that were open when the setting is turned off still close after their event

A server keeps at most 50 events that are not cancelled or completed. RSVPs expire 30 days after an occurrence ends or is cancelled, the record of each ended or cancelled date with its reminders after 180 days, and ended event history after 180 days. No message bodies, member names or avatars are stored

## Birthdays and membership anniversaries

Members opt into public birthday and membership-anniversary posts with `!milestone` in a verified one-to-one DM with NeonFlux. Birthdays take only `MM-DD`, including `02-29`, with no year or age. Anniversaries use the member's actual join time, never a supplied date. The module and both routes start disabled, and shared publishing must also be enabled

```text
!milestone help
!milestone me
!milestone birthday set 02-29 confirm #celebrations
!milestone anniversary on confirm #celebrations
!milestone remove [birthday|anniversary]
```

Consent names the configured public channel as a mention, ID or name. A personal command sent in a server channel gets private instructions and is not stored, but the message itself stays visible. `me` and `remove` work after leaving the server. Staff cannot enroll members or list birthday dates. If the destination changes, members must opt in again. A member can choose to show the month and day of their own birthday on their profile, as [Profiles](#profiles) describes

Owners and Administrators configure each route from a publishing template. A route follows its template by name, so an edit to the template reaches the next celebration right away. When the template is deleted or an edit makes it invalid for the kind, such as `{years}` in a birthday template, the route sends the copy saved when it was last configured. Templates can use `{user}` and `{server}`, plus `{years}` for anniversaries. Birthday posts never show the date or an age. All milestone replies and previews are private, and posts suppress mentions. `!milestone status` sent in a server channel answers there with `Details sent by DM`

| Command                                                                                                        | Behavior                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `!milestone status [birthday\|anniversary [next]]`                                                             | Show configuration and limits, with the stored post records counted against their limit, or delivery history for one route. Birthday history leaves out due times and why a post skipped a clock change, so it never shows a date. `next` shows the following page |
| `!milestone configure birthday\|anniversary #channel <IANA zone> HH:mm earlier\|later\|reject template <name>` | Set a route                                                                                                                                                                                                                                                        |
| `!milestone preview birthday\|anniversary`                                                                     | Preview the post privately                                                                                                                                                                                                                                         |
| `!milestone enable\|disable\|clear birthday\|anniversary`                                                      | Control one route                                                                                                                                                                                                                                                  |
| `!milestone module on\|off`                                                                                    | Turn the module on or off                                                                                                                                                                                                                                          |
| `!milestone reconcile birthday\|anniversary <post>`                                                            | Recheck one known post                                                                                                                                                                                                                                             |
| `!milestone forget birthday\|anniversary <settled-post> [confirm]`                                             | Drop settled tracking without deleting the post                                                                                                                                                                                                                    |

Posts go out at the configured local time in the route's zone. February 29 celebrates on February 28 in other years.
Anniversaries count completed years from one. A late delivery still sends until local midnight, and a missed day does
not use up that year's birthday. Enrolling skips a celebration already due. Automatic posts send as NeonFlux and need
its channel permissions, the module and publishing switches and DEFCON 3. A post that comes due at DEFCON 1 or 2 waits
without requests and sends once DEFCON is set to 3 on its local day. A post that comes due while its route, the module
or publishing is off also waits without requests, and is skipped at local midnight or, if you turned the switch back on
first, as before that activation. Leaving the server ends consent. The bot checks consent when a member leaves or
rejoins, one member after the other without waiting. A check that failed is tried again at the next minute, and the
members behind it wait until then. It checks again before each post, not on other member updates such as role or
nickname changes

Removal deletes the enrollment and stored date. Posts already sent stay. A server allows at most 1000 enrolled accounts and 4000 retained deliveries. Settled tracking expires after 30 days, and a body-free record of each delivered year lasts 400 days so re-enrolling cannot repeat it

## Suggestions and voting

Owners and Administrators set up the disabled module with `!suggest configure #channel`, enable it with
`!suggest enable` and inspect it with `!suggest settings`. `!suggest configure none` clears the channel and turns
suggestions off. Members use the other commands in the configured destination

| Command | Who | Behavior |
| --- | --- | --- |
| `!suggest submit "text"` | Member | Post a suggestion of at most 2000 characters |
| `!suggest show <number>` | Member | Read text, author, state, counts and card status |
| `!suggest list [state] [next]` | Member | List up to ten suggestions. `next` shows the following page |
| `!suggest vote <number> up\|down\|clear` | Member | Set, change or clear your vote |
| `!suggest mine <number>` | Member | See your own vote |
| `!suggest withdraw <number> [confirm]` | Author | Withdraw permanently. Without `confirm` it asks first |
| `!suggest status <number> under-review\|planned\|completed\|declined <reason>` | Staff | Change state with a public reason of at most 500 characters. The reason runs to the end of the command and needs no quotes. When someone other than the author changes it, NeonFlux sends the author a DM with the new state and the reason |
| `!suggest publication <number>` | Staff | Show card delivery state |
| `!suggest reconcile\|replace <number> [confirm]` | Staff | Recheck a known card, or replace one confirmed missing |
| `!suggest forget <number> [confirm]` | Staff | Remove settled closed suggestion data in pages |
| `!suggest recount <number> [next]` | Staff | Count the card's 👍 and 👎 again, such as after NeonFlux was offline. It clears votes whose reaction is gone and counts up to 100 reactors a run, and `next` continues |
| `!suggest disable` | Staff | Stop submissions, votes and cards and keep data |

A status change by someone other than the suggestion's author sends the author one DM, such as `Your suggestion #12 in My Server is now planned. Reason: Ships next week`. The reply to staff notifies nobody, and when the DM cannot be sent, for example because the author does not accept DMs from NeonFlux, the reply says so. Members vote by reacting 👍 or 👎 on the card or with `!suggest vote`, and NeonFlux adds both reactions to each new card. A vote follows the reaction the member holds. Adding 👎 while holding 👍 switches the vote and NeonFlux removes the 👍, and taking the last reaction away clears a vote a reaction set. A vote sent as a command stays until the member clears it or reacts again, so taking a reaction away never undoes it. Reactions pass the same checks as the command, and NeonFlux removes an added reaction it may not count, for example from a timed-out member. When a moderator clears a card's reactions, the votes they set are cleared and NeonFlux adds its two reactions again. A reaction changed while NeonFlux is offline counts at the member's next reaction change or when staff run `!suggest recount`. `!suggest mine` says when a vote came from a reaction. Under-review and planned suggestions accept votes. Completed and declined ones close voting and can be reopened with a reason until they expire. Withdrawn suggestions stay closed. Only the latest status reason, actor and time are kept. Self-votes count, and votes stay after the voter leaves. Editing or deleting a command message does not change the recorded text or vote

Cards show author, state, vote totals and the latest reason with mentions suppressed. While a suggestion takes votes, its card ends with a Vote line, such as ``React 👍 or 👎, or send `!suggest vote 12 up` or `down` here``, in the server's prefix. There is no public voter list, but database administrators can see voter IDs. Card updates are grouped for about five seconds and sent as NeonFlux, under its channel permissions, the module and publishing switches and DEFCON 3. At DEFCON 1 or 2 updates wait without requests and go out after DEFCON is set to 3. A card can lag behind the recorded state. Check `!suggest publication` before recovery. A missing card needs explicit replacement, and `!publish` cannot edit or forget suggestion cards. Forgetting data never deletes posted cards

The destination can be a forum or media channel. Each suggestion then becomes its own forum post, named after its number and text, whose first message is the card, and the post is the place to discuss it. Members and staff run `!suggest` commands in any post of the forum. The post carries one status tag that follows the suggestion's state: Under review, Planned, Completed, Declined or Withdrawn. Other tags on the post stay. When the destination is configured, NeonFlux adds the status tags the forum lacks, which needs Manage channels. When it cannot, because it lacks the permission or the forum would pass Fluxer's limit of 20 tags, the reply names the fix, such as removing some tags or adding the five yourself. Status tags must not be moderated, since NeonFlux applies them as the post's creator without Manage threads. A card edit reopens an archived post first. A locked post needs a moderator to unlock it before its card can change

Voting in a forum works the same way, with 👍 and 👎 on the card that starts each post. A forum's default reaction is no vote. Deny members Send messages in the forum so only NeonFlux starts posts, allow Send messages in threads so members can discuss, and pin a post that explains how to suggest, where members can run `!suggest submit`

Limits are 1000 staff and 10000 member commands a day, which keeps one server from flooding the shared backend. A server keeps any number of suggestions, and a suggestion takes any number of voters, by reaction or command. Closed suggestions expire after 180 days. A recount reads each emoji's reactors 100 at a time and counts at most 100 reactors whose vote differs a run, so one command stays short, and `next` goes on where it stopped

## Automatic message cleanup

Owners and Administrators use `!cleanup` to delete messages older than a chosen age in selected Text and Announcement channels. Send a command that names no channel in a Text or Announcement channel, since a thread, forum post or voice channel is refused. The module and every policy start disabled. A server can have cleanup in up to 500 channels, Fluxer's limit of channels in a server. Turning a channel's cleanup off keeps its slot. A channel keeps up to 8,192 excluded authors and 8,192 excluded messages, and a server up to 20,000 across its cleanup channels, since a backup and every cleanup change read all of them at once. Ages run from one hour through 365 days and are written like other durations, in any case, such as `60m`, `1h30m`, `30d` or `2w`. A total that is not whole seconds is refused

| Command                                                      | Behavior                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `!cleanup help`                                              | Show the common forms. `!cleanup help all` lists the rest                                                                      |
| `!cleanup configure #channel <age>`                          | Create or replace a channel policy                                                                                             |
| `!cleanup show\|preview #channel`                            | Show the policy, or check up to 50 older messages without deleting                                                             |
| `!cleanup list [next]`                                       | List configured channels, 10 per page. `next` shows the following page                                                         |
| `!cleanup status [#channel]`                                 | Show the module and channel count, or one channel's state and last run in a few lines                                          |
| `!cleanup status #channel messages [next]`                   | List links to the channel's handled messages with their outcome, 10 per page and newest first. `next` shows the following page |
| `!cleanup enable #channel [confirm]`                         | Enable the policy, including existing old messages                                                                             |
| `!cleanup disable #channel`                                  | Stop new deletions and keep configuration                                                                                      |
| `!cleanup module on\|off`                                    | Turn the module on or off                                                                                                      |
| `!cleanup exclude #channel author\|message add\|remove <id> [id...]` | Keep the messages of these authors or these messages. Several IDs or mentions, apart or split by commas, change at once |

Only human messages of ordinary or reply type that are unpinned, older than the cutoff and outside every exclusion and publishing or panel protection are deleted. Anything with unknown pin state, author, type or time is kept. Preview counts unknown messages as skipped. Replies contain metadata only and suppress mentions

Automatic deletion runs as NeonFlux under the server automation policy. It needs View channel, Read message history and
Manage messages, the module and policy switches and a DEFCON level that allows it. It does not depend on the
Administrator who configured it. DEFCON 1 pauses new deletion. A pass runs at startup and whenever a policy is due. It
reads a channel's history 50 messages at a time and deletes each page's eligible messages with one bulk request, for up
to 10 pages per channel and 20 pages overall. A channel with history left is due again at once, which starts the next
pass about three seconds later, and other channels take their turn first. A page whose deletion failed or has an unknown
result ends the channel's turn, and the channel waits a minute before its next page. A channel whose sweep has read all
its messages rests 15 minutes before the next sweep starts, so a message that has just passed the age can wait that much
longer. A page saved more than 50 seconds before it is deleted, for example when NeonFlux restarted, is read again and
deleted message by message. A deletion with an unknown result is never retried

A policy also covers the channel's active threads, under the same age, exclusions and permissions. Each sweep reads the channel's own history first. When it reaches the end, it moves on to the oldest active thread of the channel that was created before the cutoff, since a newer thread holds no message old enough, and so on in order of creation until none is left. Each step costs one read of the server's active threads. Archived threads are left alone until a new message makes them active again, because NeonFlux does not reopen them. Preview samples the channel itself only. The same page budgets apply, so a channel with many threads takes more passes to finish a sweep

Deletion has no server-side pin check, so a message pinned just before deletion can still be removed. Cleanup stores
only IDs, authors, timestamps and outcomes, never message text or attachments. Records expire after 30 days, also those
of deletions that failed or have an unknown result. Such a deletion shows in the recovery list for a week and does not
keep you from deleting the channel's policy on the dashboard

## Metadata logs

Owners and Administrators extend `!logs` with metadata logging. Existing moderation log commands keep their meaning. Configure in a server channel. Status, category, override and counter reports sent in a Text or Announcement channel answer there. Event lists, records and delivery reports arrive in a private DM, since records hold message text from channels the channel's readers may not see. All these reads also work from a verified one-to-one DM. `!logs events list` and `!logs metadata overrides` show 10 entries a page, and `next` shows the following page

```text
!logs metadata help
!logs metadata status
!logs metadata categories
!logs metadata overrides [next]
!logs metadata module on|off
!logs metadata route <category> <channel> [owner] on|off
!logs metadata clear <category>
!logs metadata event <event> <channel> [owner] on
!logs metadata event <event> off
!logs metadata inherit <event>
!logs metadata channels all [excluded-IDs]
!logs metadata channels <channel-IDs|none> <excluded-IDs|none>
!logs metadata channels add|remove <channel-IDs>
!logs metadata exclude add|remove <channel-IDs>
!logs events list [next]
!logs events show <record>
!logs delivery show|reconcile <record>
!logs metadata forget <record> confirm
!logs counters
```

Categories are `membership`, `resources`, `messages`, `audit`, `settings`, `operations` and `security`. The `security` category carries the [security alerts and invite logs](#security-alerts-and-invites) that `!alerts` turns on. The module and every route start disabled. A route's owner is the Owner or Administrator who receives its posts and must be able to view, send and read history in its channel. Without a named owner it is you. Message events come from every channel except the excluded ones with `channels all`, or from only the listed channels, with up to 500 channels in each list. `channels add|remove` and `exclude add|remove` change one list without retyping it, and `channels add` needs listed mode. They and `channels all` take channels split by commas or spaces, and `channels all` without channels excludes none. A new server starts with every channel, and a server set up before this choice keeps its list. Message events are recorded only while the messages category or a message event override posts to a channel. DMs, private ticket channels, log channels and NeonFlux's own feedback are never logged. Send a change that names no channel in a Text or Announcement channel, since a thread, forum post or voice channel is refused

`!logs metadata status` is a summary: Whether the module is on, how many categories post to a channel, the number of event overrides, the message channels, the log channels that no longer exist and the log channels where NeonFlux currently lacks View channel, Send messages, Embed links or Read message history. It shows the stored record count only once 8000 of the 10000 records are in use. `!logs metadata categories` shows each category's channel and whether NeonFlux can post there. Replies and log post titles name events in plain words, such as Member joined or Audit: Member kicked. `event` and `inherit` take that name, in any case and with or without the colon, as in `!logs metadata event member joined off`, or the event code, such as `member-add` or `audit-entry:20`. `!logs counters` shows open tickets, stored moderation cases, stored metadata records by category and the log posts that are waiting, failed or not confirmed

The dashboard's Channel logs section configures the same settings, including per-event overrides for twenty-nine event types and thirty-eight audit actions. An event without an override uses its category route. An audit-action override, such as `audit-entry:20` for kicks, wins over the audit category. An enabled override sends even when its category is off, a disabled one suppresses the event, and `inherit` removes the override

Each category has a color: Membership green, resources blue, messages cyan, audit purple, settings amber, operations coral red and security pink. Shade shows the kind of change, with the darkest tone for destructive actions. A member leaving is neutral and unattributed, while kicks and bans proven by the audit log use the darkest tone

Each log post names the members, roles and channels of its record as mentions that notify no one and shows its time in each reader's timezone. Webhooks, emoji, stickers and messages an audit entry names appear by their IDs. A message edit shows the author, the channel, a link to the message, the earlier and the new text in code blocks and the attachments. A deletion shows the author, the text and the attachments NeonFlux knew. A bulk deletion shows the count and the authors NeonFlux knew with how many messages each wrote, without text. Member, role, channel, server and thread changes show each changed value before and after, such as a nickname, the roles added and removed or the permissions a role gained and lost. Audit log entries show their reason and every value Fluxer recorded before and after. Names and values are escaped, so text in them cannot fake a line or a mention, and a post that would exceed one embed shortens its text blocks with … and counts the change and attachment lines left out

Logged events cover member joins, updates and removals, role and channel changes, thread and forum post creation, changes and deletion, server updates, message edits and deletions and every action Fluxer records in its audit log, such as kicks, bans, role and member changes, invites, webhooks, emoji, stickers, pins, prunes and message deletions with the member who deleted them. An audit entry without a target, such as a prune, is logged without one. Thread events use the resources category with their own event types `thread-create`, `thread-update` and `thread-delete`, and name the parent channel. A thread change names the changed fields `name`, `archived`, `locked` and `tags` when NeonFlux saw the thread before, since Fluxer sends only the new state. A thread NeonFlux merely joins is not logged as created. Deleting a channel deletes its threads without separate events, so one `thread-delete` record counts the threads NeonFlux knew in that channel. Records keep IDs, times, proven actors or unknown attribution, the changed values above, message text up to 4000 characters per side, Fluxer's longest message, up to 10 attachment names and links, audit reasons and invite codes. Audit values whose names look like tokens, secrets or passwords are left out. Fluxer sends a deleted message's text but not an edited message's earlier text or the earlier state of a changed member, role, channel or server, so NeonFlux compares with what it saw last. It keeps the last 10000 messages and up to 8 MiB of their text for all servers together, and keeps a server's message text, never a DM's, while its message events reach a log channel. It also keeps the IDs of the last 10000 messages of other bots, webhooks and the system, never their text, since a deletion does not say whether a bot wrote it, so those deletions stay out of logs. It asks the backend about that when the server starts and after each logs change made in chat, on the dashboard or by a restore, and forgets the server's text only when the answer says its message events no longer reach a log channel. Reading logs, help and forgetting a record keep it. So an edit has no earlier text only for a message NeonFlux did not keep: One sent before NeonFlux started or while message events were not logged, one pushed out of the last 10000 messages or 8 MiB of text, or one sent before a lost connection to Fluxer or before its server became available or unavailable, since NeonFlux then forgets that server's messages because it may have missed their edits. It keeps up to 50000 roles, 20000 channels, 20000 members and 5000 servers, learns channels and members from their events and forgets a server's copies when the server becomes available or unavailable. A change NeonFlux has no earlier copy of says that earlier values are unavailable. Settings records cover moderation and log settings, security and DEFCON, metadata configuration and changes saved on the dashboard

Each server keeps at most 10000 records, and the oldest is evicted when a new one arrives. Delivery runs as NeonFlux
under the server automation policy, and DEFCON 1 pauses it. Disabling keeps records, and re-enabling can deliver the
backlog. A post that waits while logs or its category or event route are off, or while DEFCON 1 pauses delivery, costs
no requests until they are turned back on or DEFCON is set to 2 or 3, and it is dropped if its record expires first. A
send with an unknown result is never repeated. Use `!logs delivery reconcile` to recheck it. A send that a rate limit or
another retryable failure stopped before it ran is known to be unsent, so it is tried again a minute later, up to three
tries in all. A post whose send never returned a message has nothing to recheck. The reply says to look in the log channel, and
once its window has passed `!logs metadata forget <record> confirm` removes the record, which no retention removes.
Metadata settings change only in a server channel, and a change sent in a DM says so. When Fluxer answers that a log
channel no longer exists, each post for it fails without being sent and is not tried again. `!logs events show` says so
for the record, `!logs metadata status` and `!logs metadata categories` name the channel and the [recovery
inbox](#recovery-inbox) counts the failed posts, so route the category or event to another channel. A post whose channel
could not be read for another reason, such as a timeout, a rate limit or a Fluxer server error, is tried again a minute
later. Logs are append-only and settled records expire after 30 days. A record that holds message text, earlier text
or attachments also expires after 30 days while its post is not confirmed, so member text is never kept longer. While logs are off, the bot sends no gateway
events for a minute after the backend answers that they are off, or until a logs change in chat, on the dashboard or by a
restore

## Security alerts and invites

Security alerts tell staff about changes that often come before a raid or a takeover. Every alert starts off. NeonFlux only reports, unless staff turn on an alert's action as described below. Alerts are records in the metadata log's `security` category, so they need metadata logs on and the category, or one of its events, routed to a channel, as `!setup alerts` explains. Invite logs show invite codes, which let anyone join, so route the category to a channel only staff can read

| Alert | Event type | What it reports |
| --- | --- | --- |
| `invites` | `invite-create`, `invite-delete` | Each invite created or deleted, with its code, channel and creator. An invite that never expires or has unlimited uses is flagged with `never-expires` or `unlimited-uses` |
| `bots` | `bot-join` | A bot that joins and is not marked expected |
| `webhooks` | `webhook-change` | A webhook that is created or changed and is not marked expected, with who did it |
| `privileges` | `privilege-change` | A role created or changed to hold Administrator, Manage community, Manage roles, Manage channels, Manage webhooks, Ban members, Kick members or Time out members, or a member given a role with one of them. Both are read from the audit entry alone, which lists a role's permissions or a member's roles before and after. The record names the gained permissions and who made the change |
| `impersonation` | `impersonation` | A member whose username or server nickname looks like the owner's name or a staff member's username, display name or nickname |

| Task | Command |
| --- | --- |
| Show which alerts and actions are on and how many bots and webhooks are expected | `!alerts status` |
| List the expected bots and webhooks, ten at a time | `!alerts expected [next]` |
| Turn an alert or all of them on or off | `!alerts on\|off invites\|bots\|webhooks\|privileges\|impersonation\|all` |
| Mark bots or webhooks as expected, or stop. Several IDs or mentions, apart or split by commas, change at once, and a webhook's name works too | `!alerts expect\|unexpect bot <ID>...\|webhook <name>\|<ID>...` |
| Turn an alert's action on or off | `!alerts action bots\|webhooks\|privileges on\|off` |
| List the server's invites with their codes, newest first | `!invites list [next]` |
| Revoke an invite | `!invites revoke <code>` |

All commands need the server owner, an Administrator or Manage community. Turning an action on needs the server owner or an Administrator, since the action spends NeonFlux's own permissions. The reply says when NeonFlux lacks the action's permission, and while the action and its alert are on, `!setup`, `!health` and the dashboard's permission check name it too. The dashboard's [Security alerts section](WEB.md#security-alerts) changes the same settings

Every action starts off and runs only while its alert is on, at every DEFCON level. It runs only once its alert is on record, so nothing acts while metadata logs are off. Any alerts manager can turn an action off, also at DEFCON 1

| Action | `!alerts action` | What NeonFlux does |
| --- | --- | --- |
| Kick unexpected bots | `bots` | Kicks a bot that joins and is not marked expected, once a fresh read shows a bot account that is not NeonFlux or the owner. It needs Kick members and a higher role than the bot, also when the bot holds Administrator |
| Delete unexpected webhooks | `webhooks` | Deletes a newly created webhook that is not marked expected, unless the server owner, NeonFlux or an expected bot created it. It needs Manage webhooks. A changed webhook is only reported |
| Remove gained permissions | `privileges` | Removes from a role the permissions its audit entry added that the alert names and the role still holds, unless the server owner, NeonFlux or an expected bot made the change. It needs Manage roles and a higher role than that role. A member given a role is only reported, since NeonFlux removes only roles it granted |

A webhook or role change whose audit entry names no actor is only reported. NeonFlux tries each action once, after its alert, and a short `alert-action` record names the action and its outcome. The outcome is `succeeded`, `failed` when NeonFlux lacked the permission or the rank, the request was never sent or Fluxer refused it, or `uncertain` otherwise, such as when Fluxer did not answer within five seconds or NeonFlux stopped before it learned the result. NeonFlux never repeats an uncertain action, so check the server yourself. An event Fluxer delivers twice acts once

Webhook and privilege alerts come from new audit log entries, which name the webhook or role and the member who made the change, so they need View activity log. The actor is taken only from the entry that describes the change and is never guessed. A member role change counts when the entry lists the member's roles before and after, which has not been checked against live Fluxer. A bot join comes from the join itself, so its alert names no actor. Route the audit action `audit-entry:28` to see who added a bot. Invite lists and the staff names impersonation compares need Manage community

Impersonation compares names after folding accents, case, lookalike digits, Latin small capitals and letters from other scripts, such as `0` for `o` or a Cyrillic `а`, then keeping only letters and digits. The letter pairs `rn` and `vv` fold to `m` and `w`. Names that then match, or differ by one edit from five characters on and by two from ten on, raise one alert per member and name. An edit adds, removes or changes a character or swaps two neighboring characters. The shorter folded name sets these limits, and names shorter than three characters never match. A folded name of at least five characters also matches a whole part of the other name separated by spaces, punctuation or symbols. Staff means the owner and every member of each role holding Administrator, Manage community, Ban members, Kick members or Time out members. NeonFlux reads them at most every ten minutes, up to 2,000 role members in one read, so a larger staff is read over the next refreshes, highest roles first

`!invites list` starts each line with the invite's code, then its channel, creator, uses, maximum uses, expiry and flags. `!invites revoke` takes the code exactly as the list shows it, since codes differ by case, reads the current invites and deletes that one. Members who joined with it stay. A code grants access to the server, and invite logs and the dashboard's invite list show codes as well, so only staff should read them

Every alert becomes its own record, and Fluxer's rate limits pace their delivery. `!alerts expected` and a webhook named in `!alerts expect` read the server's webhooks fresh, which needs Manage webhooks. A webhook NeonFlux cannot read shows its ID, which `!alerts unexpect webhook` takes. The alert settings are read once when a server starts and kept in memory, so with every alert off an event costs no backend call. Up to 8,192 bots and 8,192 webhooks can be marked expected, the most one stored list holds

## Temporary voice rooms

A member who joins a generator voice channel gets a room of their own, and NeonFlux moves them into it. Staff create and configure generators with `!voice generator`, and room owners manage their room with the other `!voice` commands. The dashboard's Temporary voice section configures the same generator settings

```text
!voice generator add "Join to create" <category-ID>
!voice generator set #generator template "{owner}'s room"
!voice generator set #generator limit 5
!voice rename "Study hall"
```

| Command                                                        | Who                | Behavior                                                                               |
| -------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| `!voice generator add "name" [category-ID\|none]`              | Staff              | Create a generator voice channel in the category, which also receives its rooms        |
| `!voice generator list`                                        | Staff              | Show each generator's settings and the live room count                                 |
| `!voice generator set #generator name "name"`                  | Staff              | Rename the generator channel                                                           |
| `!voice generator set #generator category <category-ID\|none>` | Staff              | Choose where new rooms are created, or none for top-level rooms                        |
| `!voice generator set #generator template "text"`              | Staff              | Name new rooms. `{owner}` becomes the owner's server nickname or username              |
| `!voice generator set #generator limit <1-99\|none>`           | Staff              | Set the default member limit of new rooms                                              |
| `!voice generator set #generator region <region-ID\|auto>`     | Staff              | Give new rooms a fixed voice region, or use Fluxer's automatic routing                 |
| `!voice generator remove #generator`                           | Staff              | Stop using the channel as a generator. The channel stays                               |
| `!voice rename "name"`                                         | Owner, staff       | Rename the room                                                                        |
| `!voice hide`, `!voice show`                                   | Owner, staff       | Hide the room from everyone without explicit access, or show it again                  |
| `!voice allow @member`, `!voice block @member`                 | Owner, staff       | Let a member see and join the room, or stop them from doing so                         |
| `!voice limit <0-99>`                                          | Owner, staff       | Set the member limit, with 0 for no limit                                              |
| `!voice claim`                                                 | Member in the room | Take over the room you are in when its owner is not in it, unless you own another room |
| `!voice transfer @member`                                      | Owner, staff       | Give the room to a member who is in it, is not a bot and owns no other room            |

Room commands act on the room you own. Put `#room` after the verb, such as `!voice limit #room 5`, to choose another room. Staff means the server owner, an Administrator or a member with a moderation staff role and Manage channels, the same rule as `!mod slowmode`. Generator commands are staff commands, and room commands are member commands that DEFCON 2 pauses

- A member owns at most one room. Joining a generator again moves them back to their room
- Fluxer does not let bots move the server owner or members ranked at or above the bot, and refuses a move into an occupied room whose members all use peer-to-peer voice. Their room is still created, and NeonFlux posts a link to it in the generator's text chat so they can join it directly
- A server has at most 10 generators and 50 live rooms. At the room limit NeonFlux creates no room and posts a notice in the generator's text chat
- Names and templates have 1 to 100 characters. Templates support only the `{owner}` placeholder
- Hiding keeps access for the owner and NeonFlux. The owner and NeonFlux cannot be blocked, and blocking does not disconnect a member who is already inside
- `!voice claim` and `!voice transfer` read who is in the room from the voice activity NeonFlux tracks. Until Fluxer has sent its list of who is in voice, after a restart or a new connection, both ask you to try again in a minute. A new owner of a hidden room gets the same access hiding gives the owner, and the old owner keeps theirs. A room keeps its name, even one made from `{owner}`. Group rooms from `!lfg` can be claimed and handed over too. A failing Fluxer voice server can report a member as gone, so a claim could then take a room whose owner is still in it
- Room settings of a generator apply to rooms created after the change

| NeonFlux permission                                       | Used for                                                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| View channel and Connect to voice where rooms are created | Seeing rooms and their voice activity, since Fluxer delivers voice events only for visible channels |
| Manage channels                                           | Creating generators and rooms, renaming, member limits and deleting empty rooms                     |
| Move members                                              | Moving members into their rooms                                                                     |
| Manage roles                                              | Hide, show, allow and block                                                                         |
| Set voice region                                          | Fixed regions, which Fluxer applies with an edit right after the room is created                    |
| Send messages in generators                               | Room limit notices                                                                                  |

### Room deletion

NeonFlux deletes only rooms it created and recorded. Generators and all other channels are never deleted automatically. A room is deleted after it has been empty for 45 seconds, which covers a member whose join Fluxer has not reported yet. Right before deleting, NeonFlux reads the room again and checks that it is still empty. Deleting a room or generator channel by hand removes its record

After a restart, a new connection for the server or a server outage, NeonFlux deletes nothing until Fluxer has sent a
fresh list of who is in voice, so an empty room can last a little longer. Rooms and owners are stored in the backend, so
a restart keeps room ownership. A server without voice activity makes no backend calls, not even at startup

These risks remain:

- If a Fluxer voice server fails, its voice list can report an occupied room as empty, and NeonFlux could delete that room. This is rare
- A member who joins in the last moment before a delete is disconnected. They can join the generator again to get a new room
- Deleting a room also deletes its text chat and disconnects anyone still inside

## Looking for group

Members post a group for an activity, others join it, and once the group is full NeonFlux gives it a [temporary voice room](#temporary-voice-rooms) that only the group can see. Each group has one card in the group channel that NeonFlux keeps up to date. The feature starts off. Managers turn it on and choose the group channel and the voice generator whose category, member limit and region group rooms use

```text
!lfg config channel #looking-for-group
!lfg config generator #join-to-create
!lfg config on
!lfg "Deep Rock" 4 in 30m bring mics
!lfg join 1
```

| Command                                                                       | Who            | Behavior                                                                                                                                                        |
| ----------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `!lfg "activity" <size> [in <time>] [note]`                                   | Members        | Post a group. The size counts you, from 2 to the server's largest size. A time such as `in 30m`, `in 2h` or `in 1d`, up to 7 days, shows when you plan to start |
| `!lfg join <group>`, `!lfg leave <group>`                                     | Members        | Join or leave a group. The host cancels instead of leaving                                                                                                      |
| `!lfg start <group>`                                                          | Host, managers | Start a group before it is full                                                                                                                                 |
| `!lfg cancel <group>`                                                         | Host, managers | Cancel a group                                                                                                                                                  |
| `!lfg list [next]`                                                            | Members        | Show the open groups, 10 at a time                                                                                                                              |
| `!lfg config`                                                                 | Managers       | Show the settings                                                                                                                                               |
| `!lfg config on\|off`                                                         | Managers       | Turn the feature on or off                                                                                                                                      |
| `!lfg config channel #channel`, `!lfg config generator #generator\|none`      | Managers       | Choose the group channel and the voice generator                                                                                                                |
| `!lfg config expiry <10-1440>`, `size <2-25>`, `hosting <1-5>`, `open <1-50>` | Managers       | Minutes a group stays open, the largest group size, open groups per host and open groups per server                                                             |

Managers are the server owner and members with Administrator or Manage community, read fresh from Fluxer. Member commands pause at DEFCON 2 like other member commands. Activities have 1 to 50 characters and notes up to 200, each on one line. An activity with spaces needs quotes

| Setting                               | Default | Range      |
| ------------------------------------- | ------- | ---------- |
| Minutes a group stays open            | 60      | 10 to 1440 |
| Largest group size, counting the host | 10      | 2 to 25    |
| Open groups one member hosts          | 1       | 1 to 5     |
| Open groups per server                | 20      | 1 to 50    |

- A group with a start time stays open that many minutes after it, otherwise after it was posted. When its time runs out, NeonFlux closes it and marks its card. Expiry runs through the work dispatcher, so open groups cost no backend calls until one is due
- When the last free place is taken, the group starts on its own. NeonFlux creates a voice room named after the activity
  in the generator's category and with its region. The room holds the generator's member limit, or the whole group when
  that is larger, and NeonFlux gives NeonFlux and every member View channel and Connect to voice like `!voice allow`,
  hides the room from everyone else, including roles and members its category lets in, and mentions the members once
  in the group channel. The card then links the room
- The room is the host's temporary voice room, so the host controls it with the `!voice` room commands, such as
  `!voice show` to open it to everyone. A host who already owns a room keeps it, and NeonFlux gives the group access to
  that room instead, changing only each member's View channel and Connect on the room's current permissions, so existing
  denies stay
- A group room waits 10 minutes for its first member, since the group is called in by a mention rather than moved in. After that it follows the [room deletion](#room-deletion) rules, so it is deleted once it has been empty for 45 seconds. A restart in those first 10 minutes shortens the wait to 45 seconds
- If the answer to a start is lost, NeonFlux does not send it again. The host is told when the group may not have
  started, and to check `!lfg list` and start it again if it is still open
- Turning the feature off pauses posting, joining and starting. Leaving, cancelling and expiry continue
- Choosing a generator checks that it exists. If it is removed later, groups cannot start until a manager chooses another one. A group room counts toward the server's limit of 50 temporary voice rooms
- If NeonFlux cannot post a card, the group is cancelled and the reply names the fix. Cards and room access that NeonFlux cannot change are left as they are, and the reply names the fix for room access

| NeonFlux permission                                 | Used for                          |
| --------------------------------------------------- | --------------------------------- |
| View channel and Send messages in the group channel | Cards and the call to the room    |
| Manage channels                                     | Creating group rooms              |
| Manage roles                                        | Limiting group rooms to the group |

## Sticky messages, dashboard link and member list order

These commands work for the server owner and members with Administrator or Manage community, read fresh from Fluxer like `!prefix`. DEFCON 2 treats them as staff commands. The dashboard has a section for each with the same settings, and chat and dashboard changes reach the dashboard's settings history

### Sticky messages

A sticky message keeps one bot message at the bottom of a channel. After members post, NeonFlux sends the text again and deletes the copy it sent before

| Command                               | Behavior                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `!sticky add #channel "text"`         | Add a sticky, or replace its text, and post it at once                           |
| `!sticky interval #channel <10-3600>` | Set the shortest time in seconds between reposts, 30 by default                  |
| `!sticky remove #channel`             | Stop the sticky and delete its last copy. Also works once the channel is deleted |
| `!sticky list`                        | Show the stickies with their intervals                                           |
| `!sticky help`                        | Show syntax                                                                      |

- A server has at most five sticky channels. The channel must be a text or announcement channel where NeonFlux has View channel and Send messages. Text has 1 to 2000 characters, and mentions in it notify no one
- A member message reposts the sticky at once when its interval has passed since the last repost. Later messages within the interval lead to one more repost when the interval ends, so a busy channel gets at most one repost per interval. Messages from bots and webhooks, and messages in the channel's threads, cause none
- NeonFlux deletes only copies it posted. A copy already deleted by someone else counts as deleted
- A copy NeonFlux could not delete, for example after a temporary access refusal or network failure, is kept in memory
  and deleted again before the channel's next repost and when the sticky is removed, until Fluxer deletes it or says it
  is gone. A channel keeps at most the ten newest such copies, and a restart forgets them. If a copy is still there when
  the sticky is removed, `!sticky remove` says so, and the message can be deleted by hand
- A send that fails may still leave a copy NeonFlux never learned of. Before the next repost, or when the sticky is
  removed, NeonFlux looks for its own copies of the sticky text among the channel's 50 newest messages and deletes them.
  An older copy, or one left before a restart, stays until someone deletes it
- A repost costs one send, one delete and one backend call, and the bill guard pauses reposts like other optional work

### Dashboard link in the server sidebar

Fluxer link channels open an external address from the server sidebar. NeonFlux can keep one that opens the server's own dashboard page, `<website>/?server=<server ID>`, where `<website>` is `NEONFLUX_WEBSITE_URL`

| Command                               | Behavior                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `!sidebar`                            | Show the link channel and the address it opens                                                              |
| `!sidebar add ["name"] [category-ID]` | Create the link channel, named `NeonFlux dashboard` unless you name it, at the top level or in the category |
| `!sidebar set "name"`                 | Rename the link and point it at the current website address                                                 |
| `!sidebar remove`                     | Delete the link channel                                                                                     |
| `!sidebar help`                       | Show syntax                                                                                                 |

- Creating or changing the link needs `NEONFLUX_WEBSITE_URL` in the Convex deployment and Manage channels for NeonFlux
- If the backend cannot record a new link, NeonFlux deletes the channel it just created
- Removal deletes the recorded channel only while it is still a link channel of the server. If someone deleted it by hand, `!sidebar` says so, and `!sidebar remove` clears the record
- A dashboard rename or removal that a chat change overtook ends as a conflict without touching the channel. A chat
  change that lands while the bot is applying a request can still end it as a conflict after the channel changed
- The link is an ordinary channel, so everyone who can see it can open the address. The dashboard still checks each person's sign-in and permissions

### Member list order

Fluxer shows members grouped under their roles that are set to display separately, ordered by a display position kept apart from the role hierarchy. Changing it never changes permissions

| Command                             | Behavior                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `!memberlist`                       | Show the roles shown separately, in member list order, top first                  |
| `!memberlist set @role @role...`    | Set the whole order, top first, naming each of those roles once                   |
| `!memberlist move @role <position>` | Move one role, where 1 is the top                                                 |
| `!memberlist reset`                 | Clear every display position, so the member list follows the role hierarchy again |
| `!memberlist help`                  | Show syntax                                                                       |

- Changing the order also needs Manage roles or Administrator, and NeonFlux needs Manage roles
- Fluxer lets NeonFlux move only roles below its own top role, and NeonFlux moves only roles below your top role too, unless you own the server. Roles that cannot move keep their display position, and NeonFlux places the others around them. When there is no room between two roles that cannot move, NeonFlux refuses and names them. Reset the order first, or change those roles in Fluxer
- Only roles whose place changes get a new display position, and roles already in order keep theirs
- Reset clears the positions of all roles, including roles above yours, so it needs the server owner or an Administrator
- The order is applied in Fluxer first and then recorded for the settings history. If the record fails, the reply says so and the new order stays. Fluxer applies an order role by role, so an interrupted change can leave part of it applied. Check `!memberlist` and set it again

## YouTube upload alerts

NeonFlux posts the new uploads of up to 10 YouTube channels per server. It learns about uploads only from YouTube's own push notifications, which arrive through YouTube's public WebSub hub, and uses no YouTube API key. Those notifications look the same for every kind of upload, so livestreams, premieres and Shorts arrive as ordinary new videos, and upcoming streams are not announced. Alerts still come only from push notifications, so an upload YouTube sends no notification for is not posted. NeonFlux reads a channel's public feed once when the channel is added, to learn its name and a recent video for `!youtube test`, and never polls the feed or reads YouTube's pages

The commands work for the server owner and members with Administrator or Manage community, read fresh from Fluxer like `!prefix`. DEFCON 2 treats them as staff commands. The dashboard's [YouTube alerts](WEB.md#youtube-alerts) section has the same settings, and chat and dashboard changes reach the dashboard's settings history

| Command                              | Behavior                                                                                                                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `!youtube add <channel-ID> #channel` | Follow a YouTube channel and post its new uploads in a text, announcement or forum channel. For a channel the server already follows, which can also be given by name, move its alerts to that channel and turn them back on |
| `!youtube remove <name>`             | Stop following the channel                                                                                                                                                                                                   |
| `!youtube status`                    | Show each followed channel on one line with where its alerts go and whether they are on, and one hint for turning alerts that are off back on. `!youtube` alone does the same                                                |
| `!youtube status <name>`             | Show one channel: Where its alerts go and the fix when they are off, its last notification, its last post, its newest video and any trouble reaching YouTube                                                                 |
| `!youtube test <name>`               | Post a test alert for the channel in its alert channel now, built from the newest video its feed or a notification named, with a line that says it is a test. Without one it posts a placeholder that links the channel      |
| `!youtube help`                      | Show syntax                                                                                                                                                                                                                  |

- A channel ID starts with `UC` and has 24 characters. On YouTube, open the channel, select the more link in its description, then Share channel and Copy channel ID. A link that contains `/channel/UC…` works too. An `@handle` or a custom channel address does not, because looking it up needs YouTube's API
- `<name>` is the name YouTube gives a followed channel, in any case, or its channel ID or a link with it. NeonFlux learns the name from the channel's public feed when it is added, or from its first notification if that read fails. Until then the channel shows and takes its ID
- Adding a channel posts nothing for videos published before it was added, so only later uploads are announced. A video published more than seven days before its notification is never announced. The first alert can take a few minutes while YouTube confirms the subscription
- Each alert is one embed whose title links to the video's `watch?v=` page, with the video's thumbnail, the channel's name and YouTube named in the footer. Mentions in titles are broken up, so they notify no one. In a forum each alert becomes its own post, named after the video
- A video that changes, such as a new title, posts nothing again, and a deleted video changes nothing. Each server gets at most one alert per video
- NeonFlux needs View channel, Send messages and Embed links in the alert channel and reads them fresh before each alert. When the channel is gone or cannot hold alerts, or NeonFlux lacks those permissions, it turns that channel's alerts off and posts one note in the server's system channel, or else in the first text channel it can write in. The [recovery inbox](#recovery-inbox) shows it too. `!youtube add` with a working channel turns the alerts back on
- Alerts go through the [publisher](#drafts-templates-and-posts), so each is sent at most once. They wait while publishing is off or DEFCON is below 3, and an alert that could not be posted within a day is dropped. For an alert with an unknown outcome, `!publish reconcile <post-number>` checks it and `!publish resolve` records it. Both read the message from the alert channel itself, so an alert in a forum can only be recorded with `!publish resolve <post-number> failed`. Alerts cannot be edited or forgotten by hand, and NeonFlux forgets them 30 days after the video's notification
- Every server that follows a channel shares one subscription with YouTube. NeonFlux renews it before it ends and cancels it once no server follows the channel. A failed request to YouTube is tried again on its own, waiting longer after each failure, and `!youtube status <name>` and the recovery inbox show the latest error
- A test alert is sent directly and is not tracked. It needs the same permissions as an alert
- YouTube alerts need the hub address in the backend deployment's settings, described in [the backend guide](BACKEND.md#youtube-upload-alerts). Without it `!youtube add` answers that YouTube alerts are not available

## Server structure editor

The dashboard's [server structure](WEB.md#server-structure) section has no chat command. The bot answers its requests through the same dashboard worker as the permission check, with its own token and never the manager's sign-in:

- A read lists the categories and channels the manager can view, in Fluxer's order by position, with Manage channels for each, and the server's active threads in those channels. Private threads are listed only where the manager has Manage threads. It costs one read each of the server, its roles, the manager, the bot's member, the channel list and the active threads
- Closed threads of one channel come from one read of its closed public threads, and of its closed private threads when the channel is a text channel and both the bot and the manager have Manage threads there. These reads need Read message history
- A save reads the server again for the manager and sends that read to the backend, which merges the draft with it and claims the save. Only a claimed save is written, so a save is never written twice. The bot renames channels one at a time and then sends every move in one reorder, after the sibling each move follows. A moved channel keeps its permission overwrites. Fluxer applies the moves in order and may refuse part of them, so after a refused reorder the bot reads the channels again and reports each move by where its channel is. A write that times out or returns an unusable answer is reported as having an unknown outcome and is not repeated. Writes stop 90 seconds after the claim
- The bot needs View channel and Manage channels in each channel it changes. A change in a channel where it lacks them is not sent, and its outcome names the fix
- After the bot starts or answers a read, the next channel created, changed, deleted or reordered in that server sends one request that tells every open editor of the server that its read is out of date. Starting counts because reads from before a restart may still be open. Further channel events send nothing until the next read

## Forum help desk

The help desk serves forum or media channels that a manager picks. Each new post gets a short greeting, its author or staff close it with `!solved`, staff post saved answers with `!answer` and open a ticket for the author with `!escalate`, and an author whose post got no reply gets one reminder. A thread budget guard warns staff before the server reaches Fluxer's limit of 1,000 active threads. The dashboard's Help desk section under Community has the same settings and the saved answers, and chat and dashboard changes reach the settings history

| Command                                                                             | Who                | Behavior                                                                                                   |
| ----------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `!helpdesk`                                                                         | Manager            | Show the settings and the server's active thread count                                                     |
| `!helpdesk forum add\|remove #forum`                                                | Manager            | Choose the forum or media channels the help desk serves, up to 10. `remove` also works for a deleted forum |
| `!helpdesk greeting "text"\|off`                                                    | Manager            | The greeting on each new post, 1 to 500 characters                                                         |
| `!helpdesk tag "name"`                                                              | Manager            | The forum tag `!solved` applies, `Solved` by default                                                       |
| `!helpdesk nudge <1-168>\|off`                                                      | Manager            | Hours without a reply before the author gets one reminder, 24 by default                                   |
| `!helpdesk guard #staff-channel\|off`                                               | Manager            | Warn staff in this channel near the thread limit                                                           |
| `!helpdesk archive on\|off`                                                         | Manager            | Give threads their channel's default auto-archive time                                                     |
| `!solved`                                                                           | Post author, staff | In a help post: Apply the solved tag and close the post                                                    |
| `!answer <name>`                                                                    | Staff              | Post a saved answer in this channel                                                                        |
| `!answer list [next]`, `!answer set <name> "title" "text"`, `!answer remove <name>` | Staff              | Manage up to 50 saved answers. The list shows 10 at a time                                                 |
| `!escalate <ticket-category>`                                                       | Ticket staff       | In a help post: Open a ticket for the post's author                                                        |

Managers are the server owner and members with Administrator or Manage community. Help desk staff also include members with Manage threads, read in the command's channel. `!solved` is a member command, and DEFCON 2 treats the other commands as staff commands

- NeonFlux needs View channel, Send messages in threads, Read message history and Manage threads in each help desk forum, and `!helpdesk forum add` names what is missing
- `!solved` needs a tag of the configured name in the post's forum, matched exactly or else without regard to case. Without one it names the fix: Add the tag in the forum's settings or choose another name. A post carries at most five tags, so a post that already has five keeps its first four beside the solved tag. NeonFlux replies first and then closes the post, because any message reopens a closed post, and a member reopens it the same way
- Only a post just created in a help desk forum is greeted and reminded, not a thread NeonFlux merely joins. While
  reminders are on, each new post costs one backend call, which the bill guard pauses like other optional work
- When a post's wait has passed, NeonFlux reads the post and its 50 newest messages. It reminds the author, mentioning only them, unless the post is closed, locked or deleted or someone other than the author and bots wrote there, which includes staff commands. Each post gets at most one reminder, even when sending fails, and posts of a forum removed from the help desk get none
- Saved answer names use lowercase letters, digits, `-` and `_`, titles have 1 to 100 characters and text 1 to 2000. Mentions in answers notify no one
- `!escalate` creates the ticket through the same path as `!ticket submit`, in the category's channel setup and audience, with the post's author as the requester and no intake answers. The staff member must hold a support role of that category or be the owner or an Administrator, tickets must be on and the author can have at most three open tickets. NeonFlux checks the author's membership again right before it creates the channel, and the ticket's introduction links back to the post. The reply in the post links the ticket and notifies only the author

### Thread budget guard

Fluxer allows 1,000 active threads per server, and forum posts are threads. While a warnings channel is set or auto-archive is on, NeonFlux reads the server's active threads once an hour. At 900 or more it warns the warnings channel, at most once a day. The count covers the threads NeonFlux can see

Fluxer stores a default auto-archive time on text, announcement, forum and media channels but does not apply it, so a new thread gets three days unless its creator chose another time. With `!helpdesk archive on`, each hourly pass gives up to 25 threads their channel's stored default, and passes run ten minutes apart while more remain. A changed thread starts its inactivity period again, pinned posts keep their time, channels without a stored default are left alone and NeonFlux needs Manage threads. The pass stops when Fluxer refuses an edit, and only a refusal for a missing permission is answered with Manage threads, which `!health` names

## Showcases and profiles

Members share what they made and describe themselves on the [website](WEB.md#member-showcases-and-profiles). Both start off, and the server owner and members with Manage community set them up in chat or in the dashboard

```text
!showcase channel #showcase
!showcase limit 3
!showcase on
!profile on
```

### Showcases

A member posts a showcase on the website with a title of up to 100 characters, text of up to 1,000 and up to 3 links. NeonFlux posts it as itself in the showcase channel, as an embed with the member's server nickname or username. The first HTTPS link to a PNG, JPEG, GIF or WebP image becomes the embed image, and NeonFlux never fetches it or hosts files. Members edit and delete their own showcases on the website: an edit changes the posted message, and a deletion deletes it

| Task                                      | Command                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| List showcases, for everyone              | `!showcase list [@member]`                                                                                                                     |
| Status, switch and help                   | `!showcase`, `!showcase on\|off`, `!showcase help`                                                                                             |
| Choose the channel                        | `!showcase channel #channel\|none`                                                                                                             |
| Limit showcases per member                | `!showcase limit <1-50>\|none`                                                                                                                 |
| Set the time between a member's showcases | `!showcase interval <30m, 2h or 1d>\|none`, from 1 minute to 7 days                                                                            |
| Who may post                              | `!showcase access`, `!showcase access allowed\|blocked [next]`, `!showcase access allow\|block\|unallow\|unblock role\|user <mentions or IDs>` |

`!showcase channel` checks that NeonFlux has View channel, Send messages and Embed links there and names what it lacks. The limit counts showcases that still exist, and the wait counts from the member's newest showcase that still exists. Showcases already posted stay in their channel when the channel changes. The access lists work like the role picker's: A block always wins, and with no allowed roles or users every member who is not blocked may post

Each post goes through publishing as a tracked post, which `!publish status <post>` shows with its showcase number. NeonFlux checks the member's current roles, the switch, the access lists, the limits and the server's automod rules right before it posts, and needs DEFCON 3 and publishing on. A post or edit whose outcome Fluxer does not confirm is never sent again, and the member's request says so. Staff check it with `!publish reconcile <post>` or record it with `!publish resolve`. `!publish edit` and `!publish forget` refuse a showcase's post, so only its author changes it

### Profiles

A member's profile has a short bio of up to 300 characters, up to 3 links and an optional accent color, edited on the website. `!profile` shows your own profile and `!profile @member` someone else's, as an embed in the accent color. While leveling is on, a member with XP also shows their level and rank, such as `Level 12, rank #40`, the same numbers as `!rank`

A member with a birthday sign-up from `!milestone` in this server can choose on the website to show its month and day on their profile, such as `March 3`. The choice belongs to the sign-up and starts off with every new one, so it turns off when the member removes or changes the birthday, gives consent again, leaves the server or deletes their data. A profile never shows a year or an age

| Task                                                | Command                                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Show a profile, for everyone                        | `!profile [@member]`                                                                                                                        |
| Status, switch and help                             | `!profile status`, `!profile on\|off`, `!profile help`                                                                                      |
| Set the time between a member's `!profile` commands | `!profile cooldown <1-3600 seconds, or 30s, 5m or 1h>\|none`                                                                                |
| Who may use profiles                                | `!profile access`, `!profile access allowed\|blocked [next]`, `!profile access allow\|block\|unallow\|unblock role\|user <mentions or IDs>` |

The access lists decide who may save a profile, who may run `!profile` and whose profile it shows. The cooldown is kept in NeonFlux's memory, so a restart clears it. A shorter or removed cooldown, set in chat or on the dashboard, also ends a wait that is already running

### Content safety

Before NeonFlux posts or edits a showcase, saves a profile or shows one, the server's enabled automod `words`, `domains`, `invites` and `deceptive-links` rules read the text and the links while automod is on, in dry run too. A match blocks it and the reply or the member's request names the rule. Exempt roles pass as they do for messages, and channel scopes apply to the showcase channel and the channel of `!profile`, where a thread or forum post counts as its parent channel too. Posts and replies notify nobody: NeonFlux sends no mentions and breaks up mention syntax, such as `@everyone`, so it does not render as a mention either

## Selective backup and restore

Only the current server Owner can use `!backup`, in a verified one-to-one DM with NeonFlux. Running it in the server returns only a private hint. Archives and reports stay private and suppress mentions

An export sends the archive as one file, or as numbered parts such as `neonflux-backup-0123abcd-1of3.nfb` when it holds more than 4 MiB, one DM message per part. To inspect or preview it, attach every part to one message, in any order, with the names unchanged. After `neonflux-backup-` a name may hold up to 128 letters, digits, `-` and `_`, so rename a copy such as `neonflux-backup-0123abcd-1of3 (1).nfb` first. A message that lacks a part, or holds a part of another archive, gets a reply that names how many parts the archive has

| Command                              | Behavior                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `!backup help`                       | Show the backup commands                                                                                                                                                                                                                                                                                              |
| `!backup export config xp structure` | Export only the categories you name                                                                                                                                                                                                                                                                                   |
| `!backup inspect`                    | Validate the attached encrypted `.nfb` archive, every part of it, and show its metadata                                                                                                                                                                                                                               |
| `!backup preview`                    | With an attached archive, check what a restore would change on the server as it is now and make the restore plan you can confirm for a day. It shows the first page of the plan, 10 items to a page, problems first. Without an archive, it shows the first page of the plan shown last. `!backup plan` does the same |
| `!backup preview match`              | As preview, and the plan also deletes the channels and categories the archive does not hold. It needs the archive                                                                                                                                                                                                     |
| `!backup preview next`               | Show the next page of that plan                                                                                                                                                                                                                                                                                       |
| `!backup items [next]`               | List the plan's items with their reasons, 10 to a page, problems first                                                                                                                                                                                                                                                |
| `!backup confirm`                    | Run the plan to the end in the background, and post the outcome in the DM                                                                                                                                                                                                                                             |
| `!backup status`                     | Show your newest plan that is not forgotten and how far it got                                                                                                                                                                                                                                                        |
| `!backup reconcile`                  | Recheck up to 20 created items with unknown results                                                                                                                                                                                                                                                                   |
| `!backup forget`                     | Drop a settled plan and keep what it created                                                                                                                                                                                                                                                                          |

Items, confirm, reconcile and forget work on the plan NeonFlux showed you last, through `!backup preview` or
`!backup status`, so a confirmation runs exactly the plan you saw. NeonFlux remembers that plan in memory. After a
restart, or once a plan expired, send `!backup status` to pick up your newest plan or attach the archive to
`!backup preview` again

A preview is the plan. NeonFlux reads the archive and the server fresh from Fluxer, decides each item and stores the
result as a plan that `!backup confirm` runs. Nothing changes until you confirm. The channels settings name come from one read of the server's channel list, and a check and a restore read every role, member and channel one setting may name, up to the 4,020 roles of a role panel with every required and excluded role, so a setting is never too large to check. Each item is one of these, with its
reason:

- Create: The server does not have it yet
- Update: The server has it with different values, and a restore changes it to match the archive. The preview names the
  changed fields
- Delete: Only with `match`. A channel or category on the server that the archive does not hold
- Identical: Nothing to do
- Blocked: A missing permission, a role or channel that no longer exists, a full limit or another reason keeps it out

The preview also says what a restore gives beyond the server as it is. It counts the items that give more permissions
than the server has now and names those permissions, and it counts the settings that turn on, because a restore copies
every on/off switch from the archive. It also counts the items with a warning, such as messages they delete or post,
but not a channel delete, which has a line of its own. An item names its changed settings in words, such as cooldown seconds, and
a channel's parent as its category. A newer preview replaces the plan nobody confirmed, so the plan a confirmation runs
is always the one you saw last. A preview of the same archive on an unchanged server keeps the plan and gives it another
day. A confirmed plan runs until every item is done, however long that takes. A confirmation of a plan that
a newer preview replaced, such as one made by **Check again** on the dashboard, says so and points to `!backup status`,
which picks up the newest plan, or to a new preview. The [dashboard](WEB.md#backup-restore) also shows the preview as a
diff, asks NeonFlux to read the archive message and the server again and, for the owner, confirms and runs the plan
there. A preview names the reason when the archive cannot be read, when it was made by an older NeonFlux, when the restore
refuses the archive as a whole and when the key is missing. A large archive is checked in parts, and
`!backup status` says so while the check is still being built. A server has at most 10 restore plans that are not
finished, so old checks cannot pile up, and `!backup preview` past that names the limit. **Check again** on the
dashboard shows its general error then. A plan frees its place when its restore finishes or you forget it

One confirmation runs the whole plan in the background. The reply says how many items it holds, `!backup status` shows
how far it got and NeonFlux posts the outcome in the DM when it ends. One restore runs at a time on a server, so a
confirmation while another runs says so. A restore that makes no progress for 10 minutes, such as while the bot is not
running, stops, NeonFlux posts that outcome in the DM once it runs again, and `!backup confirm` on that plan continues
it. A restore stops writing as soon as you are no longer
the server Owner or the DM is no longer verified. An identical channel is checked
again against the server, so one that changed or is gone ends as a conflict. A restore never recreates roles, moves
members or lowers DEFCON, and it deletes only with `match`. A partly finished restore is not rolled back, and a step
that finds the server changed since the preview ends as a conflict instead of overwriting it. Each restored setting goes
through its feature's own save, so revisions, role ledgers, pending deliveries and activation times follow as they do
when you change the setting yourself. A switch that turns on is applied through that feature's own path. A message
cleanup policy that turns on or deletes more, a log destination that turns on or moves, and the cleanup or logging
module switch that resumes policies or routes that stayed on, are restored too, because your confirmation is the
authority. One made by an administrator restores as archived. The preview marks it in words first, sorts it with the
gains and counts it in the header, such as "Turns on message cleanup: messages older than 30 days in #general will be
deleted" or "Turns on logs: membership logs go to #logs". It blocks the item only when the bot cannot use that channel:
cleanup needs View channel, Read message history and Manage messages there, and logs need View channel, Send messages,
Embed links and Read message history, and the reason names the missing permissions. The same check runs again when the
item runs. A role panel that is missing returns unposted, and the preview warns that staff post it with `!roles publish <name> #channel <draft-name>`. A posted panel whose archived roles differ changes under its posted message as a staff edit does, so NeonFlux clears the reactions whose role changed as the item runs, and the preview warns about it. When it could not clear them, the next reaction on the panel or `!roles reactions <name>` finishes it. A posted panel is blocked when that edit is not possible, such as a switch to one choice, and a panel being withdrawn is blocked until that finishes

- `config`: Authored settings for moderation with how long cases are kept and the role that may view private cases,
  automod, responses, publishing drafts and templates, roles and role panels without their posted messages, greetings, tickets, leveling,
  milestones, suggestions, cleanup, metadata logs, events and their discussion thread switch, each event, schedules and
  each scheduled post, the prefix, reply style and bot nickname, analytics, voice generators, looking for group, the
  role picker, the access lists of the role picker, showcases and profiles, temporary role defaults, the newcomer
  checklist, sticky messages, security alerts and their actions, the help desk and its saved answers, showcases,
  profiles and followed YouTube channels. A restore creates what is missing and updates what differs, so a setting you
  changed since the backup returns to its archived value. Settings that are not in the archive stay. A setting past its
  feature's own limit, such as an automod rule that would take the server's rules past 2000 patterns together, is
  blocked with that reason, at the preview or when its step runs, and the rest of the restore goes on
- Events and schedules: An event always returns as a draft, with no card, responses or discussion thread. A schedule
  that was on returns on, and the preview warns that it posts in its channel. A date that passed never returns and
  nothing is posted for it: A repeat whose first dates passed starts again from its next date ahead, with the dates its
  count has left, and the preview names that date. An event with no date left returns as a draft without a date, a
  schedule with no date left returns paused, and the preview says so. A repeating event leaves out a reminder further
  ahead than its stored dates reach, which `!event` and the dashboard refuse, and the preview says so. An event with the same name that is published, cancelled or
  being forgotten, and a cancelled schedule with the same name, are blocked when the restore would change them, and a
  cancelled event or schedule is not in an archive
- Other settings: The bot applies a restored nickname as itself after the step and records what Fluxer kept, as a change
  on the dashboard does. Features that keep their settings in the bot's memory, such as sticky messages, the help desk,
  voice generators, security alerts, leveling, the newcomer checklist, suggestion votes, metadata logs, analytics and the prefix, use
  each restored item at once, without a restart. A sticky message posts in its channel again, and the preview warns about
  it. Setting the role
  that may view private cases is a warning the preview counts. A followed YouTube channel is followed again with a new
  subscription secret, which an archive never holds. The dashboard link, the member list order and presets are not in an
  archive, because `!sidebar` makes the link again, Fluxer keeps the role order and presets store nothing of their own.
  Ticket panels are not in an archive either, since each belongs to its posted message, so post them again with `!ticket
  panel`
- `xp`: Current-season XP of every member who has some. The plan holds the members in items of up to 100. A restore
  creates missing profiles and sets a differing profile to the archived XP, records the correction in the leveling audit
  and leaves members who are not in the archive alone. A member whose XP changed after the check is left alone too, and
  the item's reason counts them. A member who deleted their data with `!mydata delete` after the backup was made is left
  out, at the check and again at the restore, and the item's reason counts them without naming them. A new XP season
  since the check leaves the whole item alone. It queues no reward roles, so they follow at the member's next activity
- `structure`: Every category, text, announcement, voice, forum and media channel with all its permission overwrites,
  up to the 500 channels Fluxer allows in a server. A channel keeps up to 4,019 overwrites, as many as one restore check
  reads beside its category. A check reads the members that overwrites name a hundred to a request, and one by one only
  the members Fluxer leaves out, such as members who left. It checks channels in groups that name at most 100 members,
  unless one channel alone names more, and its member reads for a group, with their waits for Fluxer's limits, end 40
  seconds after the first answer, so they reach the backend within its 60 seconds. Fluxer answers 12 such requests every
  10 seconds for the whole bot and 40 reads by ID every 10 seconds for the server, both shared with the bot's other
  work, so a member left out that the check could not read in that time is not taken as gone and blocks only the
  channel that names it, with a reason. A check takes the channels from one read of the server's channel list, while a
  restore reads each channel again before it changes it. Fluxer lists only the channels NeonFlux can view, so a check reads
  each archived channel the list leaves out by its ID. Only one Fluxer says is gone counts as missing, and one NeonFlux
  cannot read, such as a channel it cannot view, is blocked with a reason instead of created again. Anything a check read that got too old for the backend before
  it was sent, such as during the Owner and DM check, is left out, so only what names it is blocked, with a reason. Names, parents, permissions, topic, NSFW, slowmode, bitrate and user limit are kept, and an announcement
  channel is restored as an announcement channel. Forum and media channels also keep their tags with name, moderation
  and emoji, default reaction, default auto-archive time, sort order, the setting that requires a tag on each post and,
  for forums, the layout. Threads and forum posts are not backed up, and other channel types are skipped. Every
  overwrite is kept exactly as the server has it, with any permission it allows or denies, and a mask above 63 bits is
  archived but cannot be written back, so that channel is blocked. A restore creates a missing channel, with categories
  first and their permissions in the creation request, and a forum or media channel with its tags in one request. It
  updates a channel that exists with different values, which can be its name, category, topic, NSFW setting, slowmode,
  bitrate, user limit, tags, forum settings, text or announcement type and permissions. An archive also keeps each
  channel's place among its siblings, and one order item after every other channel item puts the channels back in that
  order with the fewest moves and one request, as the structure editor does. A channel the archive does not hold, and a
  channel NeonFlux cannot manage, keep their places. A channel that a restore made and somebody deleted since is made
  again. A role or member that is gone is left out of a channel's permissions, and the preview marks each one it
  dropped. An overwrite for one that the server's channel already holds stays as it is
- Permissions: Fluxer decides what NeonFlux may write. A change that gives permissions needs NeonFlux to hold them in
  that channel itself, and the preview names the missing permission and the fix when it does not. The preview marks
  every channel that gives more permissions than it has now, with the others
- Categories: Fluxer copies a category's permission change to every channel whose permissions equal the category's, and
  offers no way to skip that. A restore therefore changes a category's permissions only when each of those channels ends
  with the same permissions anyway, because the archive gives it the same ones or because it is a channel such as the
  dashboard link that follows its category on purpose, which the category's line names. Otherwise the category is
  blocked, and the reason names the channels and says to move them out of the category in Server structure on the
  dashboard, check again and restore, then move them back. Moving a channel does not sync its permissions
- Tickets and voice rooms: NeonFlux labels the channels its tickets and temporary voice rooms made when it exports, and
  a restore skips them, so a backup taken during a call does not bring ended rooms back as permanent channels. A
  restore also never creates, changes or deletes a channel that has a ticket or a temporary voice room now, so an old
  archive cannot undo a closed ticket
- Match: `!backup preview match` also deletes the channels and categories of the archived types that the archive does
  not hold and that the bot can see. A channel goes with its messages, files, webhooks and invites, which cannot be
  undone, so the preview counts the deletions, lists each one first and warns before you confirm. NeonFlux does not
  delete a channel that tickets or voice rooms own, one it cannot manage, or a category that would still hold a channel.
  A category whose permissions change waits for a second run while it holds a channel that follows it and that match
  deletes, since the first run deletes the channel and the next check finds the category free. Channels and categories are
  the only things match deletes, and settings and XP converge in both modes
- Configuration that names an announcement, forum or media channel restores like configuration that names a text
  channel

Archives exclude credentials, AFK text, birthdays, votes, RSVPs, member data, ticket bodies, moderation notes, audit history and live state. This is not a full server, database or message backup. An archive holds at most 40 MiB, in at most 10 parts of 4 MiB, since a restore reads every part from one message, and export refuses a larger one, so every archive can be restored. Archives from an older NeonFlux are refused by name and need a new export

Set `NEONFLUX_BACKUP_KEY` in the bot environment to a base64 32-byte key that is independent of the bot and backend
credentials. Without it, export, inspect and new previews are disabled and other features keep working. NeonFlux never
generates the key or sends it to Convex. Keep offline copies of the key and every archive, because a lost key makes its
archives unreadable and a changed key makes older archives unreadable until the old key is restored. Archives use
AES-256-GCM and are authenticated before parsing. Keys, URLs and file paths are never accepted in commands. Attachments
stored on the platform are not durable backup storage

## Server export

`!export` sends the server's NeonFlux data as readable JSON that other bots can load: Every feature's settings, leveling XP and levels, member showcases and profiles, moderation cases with their corrections and appeals. Text the owner erased with `!mod erase` stays out. It is separate from the encrypted backup above, which only restores into NeonFlux. [The export guide](EXPORT.md) documents every field of format version 2

| Command        | Behavior                                         |
| -------------- | ------------------------------------------------ |
| `!export`      | Send this server's data as a JSON file in the DM |
| `!export help` | Show what the export holds                       |

Only the current server Owner can export, in a verified one-to-one DM with NeonFlux, because the file holds private moderation data. Running it in the server returns only a private hint, and anyone else gets no answer. NeonFlux reads the owner and the DM from Fluxer before it starts, at least every 45 seconds while it reads and right before it sends each file. An export larger than about 4 MiB arrives as several numbered files, each a complete file of the same format. The dashboard's [Server export](WEB.md#server-export) section offers the same export as a download. The server's audit log records each export, never its content

## Server analytics

NeonFlux counts server activity for the dashboard's Analytics section. It keeps counts only, never which member did what

| Command       | Behavior                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `!stats`      | Show joins, leaves, newcomer checklist completions when there are any, messages, the top three channels and the three busiest hours of the day, shown in each reader's time, for the last seven UTC days, including today |
| `!stats on`   | Start counting for this server                                                                                                                                                                                            |
| `!stats off`  | Stop counting for this server                                                                                                                                                                                             |
| `!stats help` | Show syntax                                                                                                                                                                                                               |

Like `!prefix`, these commands work for the server owner and members with Administrator or Manage community, and other members get a refusal. Analytics starts on. The dashboard has the same switch

- Member joins and leaves are counted per UTC day, and so are members who finish the [newcomer checklist](#newcomer-checklist)
- Messages are counted per channel and UTC hour. Only ordinary and reply messages from human members count, commands included. Bot, webhook and system messages are never counted
- Messages in a thread or forum post count under its parent channel. The bot learns parents from the channels it keeps and reads a channel it does not hold once, so an archived thread also counts under its parent. If that read fails, the thread's messages in that batch count under the thread itself, and the next batch reads it again

The bot sends the counts in batches about every five minutes, so the dashboard lags by that much, and `!stats` sends the
open batch first so its reply is current. A server with no activity causes no backend requests. If the backend is
unavailable the same batch is sent again and never counted twice, and a batch not saved within a day is dropped. A crash
or forced stop loses the counts not yet saved, at most the last five minutes

`!stats off` stops counting at once and drops counts not yet sent. A change on the dashboard reaches the running bot at once too: Turning analytics off stops counting and drops counts not yet sent, and turning it on resumes counting. If the bot misses that change while analytics is off, member activity makes it recheck the setting at most every ten minutes. Turning analytics off keeps existing counts. Channel and hourly counts expire after 35 days and daily join and leave counts after 400 days

## Your data

Any member can see, export and delete what NeonFlux stores about them. These commands work only in a one-to-one DM with the bot. They cover every server at once and take no `--server` selector

| Command                                        | Behavior                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `!mydata [next]`                               | List the servers where NeonFlux stores something under your user ID, numbered, 10 to a page, with a record count for each |
| `!mydata <number or server ID>`                | Show what it stores in that server per feature, and what deletion keeps and why                                           |
| `!mydata export [server ID]`                   | Send that data as a JSON file, for every server or for one                                                                |
| `!mydata delete <number or server ID>`         | Show what deleting your data in that server removes and what it keeps                                                     |
| `!mydata delete <number or server ID> confirm` | Delete it. This cannot be undone                                                                                          |
| `!mydata help`                                 | Show syntax                                                                                                               |

A number means the server at that place in the last `!mydata` list shown to you. A server ID names a server the list did
not reach, and its records are counted for that server alone. When the list reached its read limit, every count says "or more" and a note says that a server can be missing. A confirmation deletes only in the server whose deletion
you previewed last, and a newer list asks you to preview again

Deletion removes your AFK status, custom command cooldowns, leveling XP with its message receipts and staff corrections, greeting records, rules acknowledgment, newcomer checklist completion, role picker role checks, birthday and anniversary enrollment with the receipts of those commands, ticket drafts, event RSVPs, suggestion votes, your places in open groups, your closed suggestions, your showcase records, the message log records of your edited and deleted messages, the log records of your joins, departures and member changes, the audit log records about you, such as a kick, a ban or a nickname or role change, with their reasons, your place in a bulk deletion's log record, which keeps the other authors, and your profile with any profile save from the website that the bot has not handled yet. A seat you held goes to the next member on the event's waitlist, and suggestion cards update their vote counts. After deleting your rules acknowledgment, acknowledge the rules again before features that require it work for you. Deletion does not remove messages NeonFlux already sent, such as greetings, event cards, showcases or log entries. Delete a showcase on the website first to remove its message too

Some data stays because a rule needs it, and the reply says why:

- Moderation cases with their corrections and appeals protect the server. They are kept for the period the server chose, or until erased, and the server owner can erase a case's text
- Tickets are a support record shared with staff. A closed ticket's private content expires after the server's ticket retention, 30 days by default, and staff can erase it sooner
- The roles NeonFlux gave you stay recorded while you may hold them, because NeonFlux removes only roles it can prove it gave
- Your temporary voice room stays recorded while it exists
- A group you host stays while it is open, at most until its time runs out. Cancel it with `!lfg cancel`
- Birthday and anniversary posts already sent stay recorded until 30 days after posting, and the years you were celebrated stay for 400 days, so no year is celebrated twice
- An open suggestion stays while staff review it. Withdraw it with `!suggest withdraw`, then delete again
- A greeting that is being sent stays until it finishes
- A message log record whose post is being sent stays until it finishes, and the log post itself stays in the log channel
- Security records are not listed: Spam detection counts and verification links keep their own expiry, watchlist entries stay until staff remove them, and security alert records expire after 30 days
- NeonFlux keeps that you deleted your data in the server and when, nothing else, so restoring a backup made before cannot bring your XP back. A backup can be restored at any time, so this record stays while NeonFlux keeps the server's data

One request reads or deletes a bounded amount. An export of every server first searches each kind of data for the
servers that hold yours, in up to 20 bounded backend calls, so a server is not missed because the `!mydata` listing
counts only the first 50 rows of a kind. If that search has not finished, the export holds the servers it found and says
that others are missing, and `!mydata export <server ID>` exports one of them. `!mydata delete <server ID>` deletes in
one the list left out. An export reads at most 50 backend pages, which is up to 5,000 records and fewer when your data
spans many servers. It says how many records it read, marks a server it cut short and lists the servers it did not reach in
the file. `!mydata export <server ID>` exports a server it did not reach. A deletion that leaves more asks you to send the
same command again. The server's managers see in the dashboard's audit log that you deleted data and from which features, never the data itself

## Multiple servers

Single mode is the default. The Convex deployment sets `NEONFLUX_SERVER_ID` and leaves `NEONFLUX_SERVER_MODE` unset or `single`, and the bot serves only that server

Multi mode runs NeonFlux as a public bot that serves every server it is in, with no server list or server limit. Remove `NEONFLUX_SERVER_ID` and set `NEONFLUX_SERVER_MODE=multi` in the [backend](BACKEND.md#multi-server-scope), then restart the bot, which adopts the mode. The bot refuses to start while its own environment still sets either variable

One bot token, process and backend serve every server. Each server has its own settings, queues and DEFCON level. Membership or permissions in one server grant nothing in another

### Add the bot to a server

Server owners and managers add NeonFlux from the dashboard's **Add NeonFlux to a server** link, shown only in multi
mode. It opens Fluxer's bot authorization with the permission mask `9008694793694454`:

| Permission | Used for |
| --- | --- |
| View channel, Send messages, Embed links, Read message history | Commands, replies, panels, logs and ticket transcripts |
| Add reactions | Reaction role and verification panels, and the vote reactions on suggestion cards |
| Manage messages | Delete and purge actions and message cleanup |
| Manage channels | Tickets, slowmode, channel structure restore, temporary voice rooms, the dashboard link channel and the server structure editor |
| Manage roles | Role panels, autorole, verification roles, ticket access, lock and unlock overwrites, temporary voice room access and the member list order |
| Connect to voice, Move members | Moving members into their temporary voice rooms |
| Set voice region | Fixed regions for temporary voice rooms |
| Kick members, Ban members, Time out members | Kicks, bans, timeouts, warnings and quarantine |
| View activity log | Audit entries in metadata logs |
| Manage community | Invite lists and staff names for security alerts |
| Manage webhooks | Webhook names in alert lists and deleting unexpected webhooks when that security alert action is on |
| Manage threads | Help desk forums |
| Change own nickname | Changing the bot's own nickname in that server |
| Send messages in threads, Create public threads, Create private threads | Channel locks and ticket closes, which deny these too, because Fluxer lets a bot deny only permissions it holds |

An owner can untick permissions when adding the bot. Channel locks and ticket closes then cover threads only for those thread permissions NeonFlux still holds

### Server registration

At startup the bot reads the backend's scope, then compares the backend's active installations with the servers its token is in. It registers servers that are missing, records the removal of servers it left while offline and starts the server runtimes four at a time. Servers the bot joins later share the same limit of four starts at once. Startup stops when either list cannot be read

When the bot joins a server, it registers the server with the backend and starts that server's runtime. Repeated join notifications after a reconnect change nothing. A join or a removal starts as soon as Fluxer announces it, whatever the state of the event queues and handler slots, and the joins and removals of one server are applied in the order Fluxer announced them, so a server removed and added again right away ends up served and registered. When the registration starts a new installation, NeonFlux posts one short note that says what it is and names `!help`, `!setup` and the dashboard link when `NEONFLUX_WEBSITE_URL` is set. It posts in the server's system channel when it may send there, otherwise in the first text channel it can send in, otherwise nowhere. A server added while the bot was offline gets the note at startup, and adding the bot again after a removal posts it again. A server that becomes temporarily unavailable keeps its runtime. When the bot is removed from a server, it stops that runtime and records the removal. A removed server keeps its data for 30 days, and adding the bot again within that time restores it. After 30 days the backend deletes that server's data, as the [backend guide](BACKEND.md#server-data-after-removal) describes. A backend scope denial stops only that server's runtime. When a shard comes back with a new session instead of a resume, a server the bot was removed from meanwhile sends nothing, so the bot reads the same two lists as at startup once every local shard is connected again and records the removal of every server that Fluxer no longer lists, unless Fluxer announced that server again meanwhile. New sessions that overlap in time share one check. A resume replays what it missed and reads no list. In multi mode, a failed publishing recovery call or a failed role recovery call at a server's startup is logged and skipped, and the server's other features still start. The backend ages open attempts on its own. A failed first read of the role reaction jobs is logged as well, the reaction checks still run, and the jobs left from before a restart resume at the next restart, in both modes. Single mode stops on a failed publishing recovery call or role recovery call

Events for a server whose runtime is still starting wait and are handled once it has started, so a restart with many
servers does not stall other servers' handlers. A DM command or intake answer for such a server does not wait, and gets
the reply "This server is still starting. Try again in a moment". Each event type queues up to 2,000 waiting events
across servers, and a full queue drops the busiest server's oldest event, which metadata logs report as an interruption
of the connection to Fluxer

### Commands in DMs

Commands sent in a server apply to that server. In a one-to-one DM in multi mode, put `--server <serverId>` right after the command name:

```text
!backup --server 123 status
!ticket --server 123 help
```

Missing or repeated selectors and selectors for servers the bot does not serve are rejected before any private data is
read. The selection applies to one message only. DM replies name their server, by its name when the bot has it and
otherwise by ID: Plain text starts with it and an embed shows it in its footer. Follow-up commands the bot writes into a
DM include `--server`, and so does the help command a syntax hint names. Replies in a server leave it out, since
commands typed there select that server, and a reply that sends you to a DM says to add `--server` with the server's ID
instead of printing it. [`!mydata`](#your-data) covers every server and takes no selector

The bot's presence shows only `NEONFLUX_CUSTOM_STATUS`, or nothing when it is unset, so no single server's DEFCON level or backend outage changes it
