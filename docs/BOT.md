# Run and develop the bot

This guide is for operators running NeonFlux and contributors working on its bot. The bot uses Fluxerly's native Effect API, stores durable state in the Convex [backend](BACKEND.md) and shares its settings with the [dashboard](WEB.md). It ignores bot messages, webhooks, system notices and servers it does not serve

Examples use the default `!` prefix. Each server can choose its own prefix, and the bot's help text prints that prefix. Commands sent in a one-to-one DM always use `!`

## Set up and run

### Prepare the workspace

Use the Node version in [the version file](../projects/.node-version) and an installed pnpm 12 bootstrap. The workspace selects its pinned pnpm version. From `projects/`, run:

```sh
pnpm install --frozen-lockfile
pnpm run check
```

The check typechecks, builds and tests the backend, bot and website without a Fluxer token or network connection. After a bot change, `pnpm --filter @neonflux/bot run check` runs the bot's checks alone

### Configure a server

1. Create a Fluxer application with a bot account and invite it to the server it should manage
2. Give the bot permission to read messages and send replies in the channels it should serve
3. Copy [the environment example](../projects/bot/.env.example) to `projects/bot/.env`
4. Set `FLUXER_BOT_TOKEN` to the private bot token and `NEONFLUX_SERVER_ID` to the server's decimal ID
5. Set up the [backend](BACKEND.md) for the same server, then set `CONVEX_URL` and `NEONFLUX_BOT_API_SECRET`

| Variable | Value |
| --- | --- |
| `FLUXER_BOT_TOKEN` | Private bot token |
| `NEONFLUX_SERVER_ID` | Decimal server ID in single mode |
| `NEONFLUX_SERVER_MODE` | `single` by default, or `multi` to serve every server the bot joins, see [multiple servers](#multiple-servers) |
| `CONVEX_URL` | Convex deployment URL, such as `https://your-deployment.convex.cloud` |
| `NEONFLUX_BOT_API_SECRET` | The backend's bot credential, at least 32 characters |
| `NEONFLUX_CUSTOM_STATUS` | Optional presence text of at most 128 UTF-16 code units, shown at DEFCON 3 in single mode and always in multi mode |
| `NEONFLUX_WEBSITE_URL` | Optional website origin for verification links |
| `NEONFLUX_BACKUP_KEY` | Optional backup recovery key, see [backup and restore](#selective-backup-and-additive-restore) |

`CONVEX_URL` must use HTTPS, except `localhost`, `127.0.0.1` or `::1` during development, and cannot contain credentials, a path, a query or a fragment. It is the deployment URL, not the HTTP Actions URL ending in `.convex.site`. A configuration that still sets only `CONVEX_SITE_URL` to a Convex cloud HTTP Actions URL keeps working, because the bot uses the same deployment name under `.convex.cloud`. Other hosts need `CONVEX_URL`. Set both backend variables or neither. Without them only `!ping` works

The bot calls the backend's functions with the Convex client and never sends the secret itself. It sends a key derived from it, as [the backend guide](BACKEND.md#service-authentication-and-errors) describes

Process environment variables take precedence over the file. Missing or invalid configuration stops startup with an actionable message and exit code 1. Keep the token and backend credential private and separate

### Start and stop

From `projects/`, run:

```sh
pnpm run build
pnpm run start
```

Send `!ping` in the server and expect `Pong!`. Press Ctrl+C to stop. SIGINT and SIGTERM give running handlers the SDK's five-second drain window. Set the SDK's `FLUXERLY_DEBUG` variable for more diagnostics

Before connecting, the bot checks that the backend uses the same mode and, in single mode, the same server. A missing endpoint, unreachable backend or mismatch stops startup, so update the backend before the bot

Every ten minutes with activity, the bot logs one Info line with that interval's Fluxer requests, backend requests, handled events, rate-limit waits and dropped events, plus the three busiest Fluxer routes and backend paths. An interval without requests or events logs nothing

### Shared behavior

- Replies suppress user, role, everyone and reply-author notifications
- Management replies appear in the channel where the command was sent. Use a staff channel for configuration
- Commands never ask for revision numbers. A chat change applies to the current state, which the bot reads right before it writes, so when two staff members change the same thing, the later change wins. The dashboard keeps its own conflict check, as [the dashboard guide](WEB.md#saving-and-live-updates) describes
- Events and scheduled posts are named by their name, such as `!event show study`. Records that have no name, such as cases, tickets, suggestions and tracked posts, keep their numbers
- A reason at the end of a command needs no quotes, such as `!mod warn @user Spamming links`. An apostrophe inside a word, as in don't, counts as text and needs no escape
- A list with more pages ends with a `Next` line. Send the same command with `next` at the end, such as `!mod list next`, for the following page. The bot remembers each member's place in each list in memory, so after a restart a list starts again from its first page
- Commands and actions, such as moderation, role changes, channel permission changes and purges, read current server, role, member and channel data from Fluxer right before they act. A failed read denies the request
- Evaluating everyday activity, such as message protection, automod, custom responses, leveling, metadata logs and role panel reactions, uses copies of server, role, member and channel data that the bot keeps in memory, and reads Fluxer only for what it lacks. Gateway events keep the copies current. A server's first message after startup costs about five reads, and later ordinary messages cost none. The bot forgets a server's copies when its gateway connection drops, when the server becomes unavailable or available again, after a category or bulk channel change and when a limit is reached. It keeps up to 5,000 servers, 20,000 members, the role lists of 1,000 servers and 20,000 channels and threads
- A message in a thread or forum post counts as in its parent channel for channel rules: automod channels and exemptions, honeypot channels, custom response channels, leveling's excluded channels and metadata logs' message and excluded channels. A rule that lists the thread itself also matches. The bot learns a thread's parent from thread events and the channels it keeps, or otherwise from one channel read
- The bot never automatically repeats a native action whose outcome is unknown. Such work stays visible as uncertain, and status or reconcile commands read the exact known message or member without resending
- Durable worker state, such as greeting, schedule and cleanup queues, lives in the backend. Workers resume it after a restart
- Each gateway session asks Fluxer not to send event types the bot does not handle, such as typing notices and presence updates, so they cost no bandwidth or decoding
- A message update that only adds or changes link previews or other embeds is ignored. The bot remembers the edit time, pin status and flags of the last 10,000 messages it saw, and an update that changes any of them, or concerns an older message, still reaches automod, security and metadata logs
- Background workers for dashboard changes, web verification, events and their discussion threads, scheduled posts, birthdays and anniversaries, suggestion cards, message cleanup, metadata logs, level rewards, temporary roles and expired groups run only when the backend reports due work for their server, so a server without due work causes no backend requests. One dispatcher for the whole bot asks the backend at startup, at once when the website queues work or a web verification is solved, when work the bot's own requests created becomes due and at the next due time the backend names. Without any of these it still asks every two minutes. It asks at most once every three seconds, so new work usually starts within a few seconds. If the backend cannot answer, the dispatcher waits 10 seconds and then twice as long after each failure, up to five minutes

### Optional work limits and the bill guard

Some per-message work is optional, so one very busy server cannot take a large share of the backend calls every server shares. Each server has its own token buckets: It may spend a burst at once, then the refill rate. A message over the limit skips that work only

| Work | Backend calls per message | Burst | Refill |
| --- | --- | --- | --- |
| AFK: clearing the author's status and naming AFK members a message mentions | One | 30 | 60 a minute |
| Custom autoresponder and command evaluation | One, or two when a definition needs the member's roles | 30 | 60 a minute |
| Message XP credits | Up to two | 30 | 60 a minute |
| Analytics counting | None, counts leave in batches | No limit | No limit |
| Sticky message reposts | One per repost, at most once per interval in each of up to five channels | No limit | No limit |
| Help desk reply reminder records | One per new post in a help desk forum while reminders are on | No limit | No limit |

Moderation, automod, security, join protection, DEFCON, commands, including `!afk`, and background workers are never limited

The [bill guard](BACKEND.md#bill-guard) adds a monthly budget of backend calls, set in the Convex deployment. The bot reports its calls every five minutes, and the answer tells it the guard's state. At the warning share the bot logs one warning a month. At 90 percent of the budget the bot pauses all six kinds of optional work in every server until the month rolls over in UTC or the budget is raised, and logs when it pauses and resumes. Moderation and everything else listed above keeps running

## Help, setup and health

| Command | Behavior |
| --- | --- |
| `!help` | List the commands you can use, by feature |
| `!help <feature>` | Show one feature's commands and their forms, such as `!help moderation`. A command name, such as `!help mod`, opens its feature |
| `@NeonFlux help` | The same as `!help`, for members who do not know the prefix. Add a feature after `help` to open it |
| `!setup` | Show each feature as on, off or needing setup, with the next step for each one that is not on, and point to [setup presets](#setup-presets) |
| `!health` | Check that the backend answers, the gateway state, the permissions NeonFlux lacks for each enabled feature and the roles it assigns that rank at or above its own role, then audit the server's roles for safety |
| `!recovery [next]` | List failed, stuck or uncertain work, features that are on but cannot act and the permission problems of the latest check, each with when it happened and its next step |

Help lists a command when your server permissions open it. Everyone sees member commands. Members with Kick Members, Ban Members, Moderate Members, Manage Messages, Manage Channels, Manage Roles or Manage Threads also see the staff commands, whose staff roles are still checked when they run. Manage Server opens `!setup`, `!health`, `!recovery`, `!preset` and `!stats`, and the server owner and Administrators see every command. Help prints the server's prefix and splits long lists so each reply fits one message. `!setup`, `!health` and `!recovery` are for the server owner and members with Manage Server or Administrator

A prefixed word that is not a command and is close to one gets one reply, such as `Did you mean !help?`. Close means one changed, added or removed letter for names of up to four letters and two for longer names, and two swapped neighboring letters count as one. Other text after the prefix gets no reply, and a custom command of that name is never treated as unknown

`!health` names the fix for each problem, such as `Moderation: Grant Kick Members and Ban Members to the NeonFlux role` or `Autorole: Move the NeonFlux role above @Member`. It checks the bot's server-wide permissions, so a channel override that denies NeonFlux in one channel is not reported. Roles it checks are those autorole, reservations, reaction and verification panels, the role picker, temporary roles, the newcomer checklist and level rewards assign. The dashboard's overview shows the same check, see [the dashboard guide](WEB.md#dashboard)

The safety audit reports each finding with its fix:

- A role that gives a dangerous permission to every member through the everyone role, or to 20 or more members. Dangerous permissions are Administrator, Manage Server, Manage Roles, Manage Channels, Manage Webhooks, Ban Members, Kick Members, Moderate Members, Manage Messages and Mention Everyone. Member counts come from Fluxer's member search, one request per role for up to 10 roles, Administrator roles first and then from the lowest role up. The search needs a member management permission such as Manage Roles, and a role whose count cannot be read is left out
- While moderation is on, a staff role that lacks the permissions its staff area's commands check on the member who runs them. Moderation staff need Kick Members, Ban Members, Moderate Members, Manage Messages and Manage Channels, and security staff need Moderate Members, Manage Roles and Manage Channels. Case, automod and appeal staff need none. Permissions come from the role and the everyone role
- Autorole, reaction roles, rules verification or the role picker being on while the server has a Fluxer verification level. Fluxer skips its verification level for every member who has any role, so a role from these features lets a member past it. The fix is to turn them off when the verification level must hold, or to use rules verification with advanced verification, which gives its role only after a solved challenge and makes autorole wait for it

When a moderation action, a role panel, autorole, verification, role picker or temporary role change, a ticket creation, a temporary voice room change or a group card or room fails because of NeonFlux's permissions or role position, the reply names the fix the same way. A moderation action against a member whose highest role is not below yours says so too

### Recovery inbox

`!recovery` lists what needs attention in pages of 15, current state first and then newest first, and `!recovery next` shows the following page. Each entry says what happened, when in UTC, and the command or step that resolves it, such as `!publish reconcile 7` or `!temprole reconcile <member-ID>`. The dashboard's [recovery inbox](WEB.md#recovery-inbox) shows the same entries. It collects what features already record and adds no tracking of its own:

| Source | Shown |
| --- | --- |
| Posts | Posts with an unknown outcome until they are reconciled or resolved, including scheduled, event, birthday, anniversary and suggestion card posts, and failed posts of the last seven days |
| Role changes | Role changes with an unknown outcome that wait for a check from role panels, rules verification, autorole, temporary roles, level rewards, the role picker and the newcomer checklist, and role withdrawals that stopped |
| Temporary roles | Grants with a problem, such as missing Manage Roles or a role change NeonFlux could not confirm |
| Tickets | Tickets whose create, close or reopen has an unknown outcome |
| Message cleanup | Deletions that failed or have an unknown outcome, and enabled channels that are blocked |
| Greetings | Welcome, DM and goodbye greetings with an unknown outcome, and failed ones of the last seven days |
| Scheduled and birthday or anniversary posts | Deliveries waiting because NeonFlux cannot post in their channel |
| Metadata logs | The number of failed deliveries and deliveries with an unknown outcome, security alerts included |
| Help desk | A thread budget warning of the last seven days |
| DEFCON | A level below 3, which pauses automation |
| Features | Features that are on but need setup, such as a channel or a first entry. Custom commands and autoresponders start on, so having none is not listed |
| Permission check | The problems of the latest dashboard permission check, with the time it ran. `!health` checks again |

Each source reads at most 50 records and shows its newest 10, and the inbox shows at most 100 entries. Event reminder deliveries without a post, suggestion cards waiting for a channel, level rewards, moderation case and log recovery, backup restore items and dashboard requests are not included. Their own status commands and sections show them

### Setup presets

A preset sets several existing settings at once as a starting point. Community presets fit a kind of server, and security levels set automod and security together. `!setup` ends with a pointer to them

| Command | Behavior |
| --- | --- |
| `!preset list` | List the presets and how many settings each would change now |
| `!preset show <name>` | List exactly which settings the preset would change, from their current values, with the code that confirms them |
| `!preset apply <name>` | The same as `show` |
| `!preset apply <name> <code>` | Apply the preset whose changes you saw |
| `!preset help` | Show syntax |

| Preset | What it sets |
| --- | --- |
| `gaming` | Leveling on with 20 XP per message and a 60-second cooldown, and events on |
| `support` | Tickets on with 90 days of ticket history, and leveling off |
| `creator` | Events on, and leveling on with 10 XP per message and a 120-second cooldown |
| `relaxed` | Automod on and enforcing, rules that delete spam at 8 messages in 10 seconds and lookalike links, webhook and bot message checks off and join-burst detection off |
| `balanced` | Automod on and enforcing, rules that delete spam, repeated messages and mention floods and lookalike links, security on and enforcing and join-burst detection at 10 joins in 30 seconds |
| `strict` | Automod on and enforcing, with webhook and bot messages checked, 10-minute timeouts for spam and mention floods, deletion of repeats, link floods and lookalike links, security on and enforcing, join-burst detection at 5 joins in 30 seconds and DEFCON 2 on a join burst |

- A preset changes only the settings in its row and only values that differ. Its automod rules are named `preset-spam`, `preset-repeat`, `preset-mentions`, `preset-links` and `preset-lookalikes`. A missing one is added, and an existing one of the same type gets the preset's action and limits and keeps its channels and exemptions. A rule of that name with another type is left alone
- Presets never delete rules or other settings and never change channels or roles. A lower security level keeps rules a higher level added, so disable those with `!automod disable <name>` when they are not wanted
- The code confirms exactly the listed changes. If any of those settings changes first, applying refuses, and `!preset show` lists the new changes and code
- Previews need Manage Server. Applying needs the server owner or an Administrator, like the automod and security settings, and is refused at DEFCON 1
- Every changed feature gets its own entry in the dashboard's audit log, named `preset <name>`. The dashboard's Setup presets section shows and applies the same presets

## Ping, AFK, prefix, nickname and custom responses

### Prefix

Server owners and members with Manage Server change the prefix with `!prefix <value>`, or read it with `!prefix`. A prefix is one to five of these characters: `! $ % & * + , . ? ~ ^ | : / -`. `!prefix` always works, so a forgotten prefix can be recovered. The dashboard can also change it

The bot caches each server's prefix. A chat change applies at once and a dashboard change applies within 30 seconds. If the backend cannot be read, the bot keeps the last known prefix, or `!` when it has none

### Bot nickname

Server owners and members with Manage Server set the bot's display name in their server. Anyone can show it

| Task | Command |
| --- | --- |
| Show the nickname and the last apply result | `!nickname` |
| Set the nickname | `!nickname set Neon Helper` |
| Remove the nickname so the bot's username shows | `!nickname reset` |

A nickname has 1 to 32 characters, with no control characters and no spaces at the start or end. The bot applies it at once and replies with the result. The dashboard can also change it, and the bot applies a dashboard change when it next checks for dashboard work

The bot needs the Change Nickname permission. Without it, Fluxer accepts the request but keeps the old nickname. The bot compares the nickname Fluxer returns with the requested one and reports `Missing Change Nickname permission` when they differ

The nickname is applied only on an explicit set or reset. If someone renames the bot directly in Fluxer, NeonFlux leaves that name in place until the next change

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
| Inspect or list | `!custom show rules`, `!custom list` |
| Replace the response | `!custom update rules response text "..."` or `response embed "Title" "Description" "#3d66b8"` |
| Restrict channels or roles | `!custom update rules channels #general #help`, `roles @Member`, or `channels all` to clear |
| Set the cooldown | `!custom update rules cooldown 30` |
| Enable or disable one definition | `!custom enable rules`, `!custom disable rules` |
| Turn the module on or off | `!custom module on`, `!custom module off` |
| Delete | `!custom delete rules` |
| Change an autoresponder trigger or priority | `!auto update greeting trigger contains "hello"`, `!auto update greeting priority 10` |

Use `!auto` in place of `!custom` for autoresponders. Run `!custom help` for the full syntax

- Names use 1 to 32 lowercase letters, digits, underscores or hyphens. Built-in command names, including `help`, `health` and `setup`, are reserved. A custom command created before a built-in command took its name stops answering, because the built-in command runs first
- A server stores up to 100 definitions across both kinds
- Triggers are 1 to 200 code units and match literally with `exact` or `contains`, ignoring case. Messages starting with `!` never trigger autoresponders
- When several autoresponders match, higher priority wins (-100 to 100, default 0), then `exact` before `contains`, then name order. A message gets at most one response
- Scopes accept up to 20 channels and 20 roles. When both are set, the message must be in an allowed channel and its author must hold an allowed role
- Cooldowns default to 5 seconds per definition and user and accept 0 to 3600
- Text responses are 1 to 2000 code units. Embeds have a title of up to 256 and a description of up to 4000 code units, with an optional `#RRGGBB` color
- Placeholders are `{user.name}`, `{user.id}`, `{user.mention}`, `{channel.id}`, `{server.id}` and `{args}`. `{args}` is empty for autoresponders. Unknown placeholders are rejected

A response is reserved before it is sent. A failed or uncertain send still uses that message and cooldown, and nothing is resent. The bot looks up the author's membership and roles only when a definition could reply, from its member copy when it holds one, so a message that matches nothing needs no member lookup for responses

## Moderation, protections, DEFCON and appeals

Moderation needs the server owner, an Administrator or a configured staff role. Assign staff roles per area with `!mod staff moderation|cases|automod|security|appeals @role...`, or clear them with `none`. Changing configuration needs the owner or an Administrator. Native actions also need the bot's native permission and a higher role than the target. The bot refuses destructive actions against itself, other bots, the owner, Administrators and members with a higher role

A reason or appeal text is the rest of the command and needs no quotes, as in `!mod warn @user don't post invite links`. Reasons are limited to 512 code units and appeal text to 2000. Durations are a whole number followed by `s`, `m`, `h` or `d`

### Moderation and cases

| Task | Command |
| --- | --- |
| Warn and send a private notice | `!mod warn @user <reason>` |
| Kick, ban or unban | `!mod kick\|ban\|unban @user <reason>` |
| Ban temporarily | `!mod ban @user 1d <reason>` |
| Time out or remove a timeout | `!mod timeout @user 10m <reason>`, `!mod untimeout @user <reason>` |
| Delete up to 100 recent messages | `!mod purge 20 [@user] <reason>` |
| Set slowmode, 0 to clear | `!mod slowmode #channel 10 <reason>` |
| Turn manual sanctions on or off, or inspect | `!mod module on\|off`, `!mod status` |
| Erase one case's narratives (owner) | `!mod erase <case>` |
| Choose or clear the role whose members may view private cases on the website (owner) | `!mod private-role @role\|none` |
| List or show cases | `!mod list [@user or user ID] [next]`, `!mod show <case>` |
| Correct a reason or void a warning | `!mod reason <case> <new reason>`, `!mod void <case>` |
| Check an action with an unknown outcome | `!mod recover <case>` |
| Set the staff log channel | `!logs channel #channel\|off` |
| Inspect staff log delivery | `!logs status`, `!logs list [next]`, `!logs show <case>`, `!logs recover <case>` |

Timeouts allow up to one year, temporary bans one minute to two years and slowmode 0 to 21600 seconds. To link a sanction or reversal to an earlier case, put `case <case-number>` before the reason, as in `!mod unban @user case 12 Appeal approved`. In a purge, the word after the count names the member when it is a mention or user ID and a reason follows it

A list shows its first page, and the same command followed by `next` shows the page after the last one you saw in that channel, as each page's `Next` line says. This also holds when the pages arrive by DM, so send `next` where you sent the list

Case details, watchlist reasons and appeal text are sent to the reader's DM after a fresh permission check. A server channel gets only an acknowledgement. Staff logs contain action, actor, target and outcome, without private reasons. A warning stands even if its private notice cannot be delivered

The dashboard's [Private cases](WEB.md#private-cases) section shows cases, appeals and member history to the server owner and to members holding the private data role, which only the owner sets. Administrators also need the role, and staff roles do not grant it. Each view on the website waits for an access check that the bot answers with its own fresh read of the viewer's server membership, roles and the server's owner. A passed check serves views for two minutes. The website records every view in its audit log, and the chat rules above stay unchanged

Cases and closed appeals are kept for 180 days after they close. Records still in recovery stay until resolved. `!mod erase` replaces a case's narratives with an audit marker

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
| Replace patterns | `!automod update <name> patterns "first" "second"` or `patterns none` |
| Set scope or exemptions | `!automod update <name> channels\|exempt-channels\|exempt-roles <mentions or IDs>...\|all` |
| Enable, disable or delete a rule | `!automod enable\|disable\|delete <name>` |
| Change the module or mode | `!automod module on\|off`, `!automod mode dry-run\|enforce`, `!automod status` |
| Check webhook and other bots' messages | `!automod bots on\|off` |

Rule types are `spam`, `repeat`, `mentions`, `mention-rate`, `link-rate`, `words`, `domains`, `invites` and `deceptive-links`. Actions are `log`, `delete`, `warn` and `timeout`. Spam defaults to 5 messages in 10 seconds, repeat to 3 in 30 seconds and mentions to 5. Thresholds allow 1 to 100, windows 1 to 300 seconds and priority -100 to 100. Each rule holds up to 20 patterns of up to 200 code units and 20 IDs per scope

`mentions` limits the mentions in one message. `mention-rate` and `link-rate` add up a member's mentions or links across their messages in the window, so spreading them over several messages does not get around the limit. They default to 10 mentions and to 6 links in 30 seconds. Each mentioned user and role counts once, everyone counts as one mention and each web address counts as one link. Edits add nothing, and the counts are kept only while such a rule is enabled

Patterns are literal text, not scripts or regular expressions. Domain `block` mode matches listed hosts and their subdomains, and `allow` mode flags any other host. The bot never visits a URL. Staff and exempt roles and channels are never sanctioned. A message gets at most one automated sanction across automod and security

`deceptive-links` flags a masked link whose label names another address than the one it opens, such as `[discord.com](https://example.net)`, and a link to a host that imitates a protected domain. A host imitates one when a part of its name mixes Latin letters with Greek, Cyrillic or Armenian ones or consists only of lookalike letters, when it looks the same as a protected domain or is one changed, added, removed or swapped letter away from it, or when it puts a protected domain in front of another one, such as `paypal.com.example.net`. The protected domains are fluxer.app, fluxer.gg, discord.com, discord.gg, steamcommunity.com, steampowered.com, paypal.com, github.com, google.com, youtube.com and twitch.tv, plus the rule's patterns, such as `!automod create lookalikes deceptive-links delete "example.org"` for your own site. A protected domain and its subdomains always pass, a country ending such as google.com.au passes, and protected domains shorter than six characters only match an exact lookalike. A label without a scheme, `www.` or a protected or imitating domain, such as `file.txt`, is not read as an address. The lookalike letters come from a small built-in table, not an online lookup

Automod skips messages from webhooks and other bots until `!automod bots on`, so a leaked webhook could otherwise post freely. With it on, automod checks them like member messages, except that they have no member to warn or time out: `warn` only logs and `timeout` deletes the message. Role exemptions and honeypots do not apply to them, and NeonFlux never checks its own messages. While it is off, these messages cost no backend call. The bot learns the setting when the server starts and from each member message, so a change made on the dashboard applies from the server's next member message

### Security

Security starts disabled in `dry-run` mode. Join-burst detection, honeypot channels and the watchlist each need their own switch as well as the security module. They use events seen on the server, not an outside reputation service

| Task | Command |
| --- | --- |
| Quarantine or release a member | `!security quarantine @user 10m <reason>`, `!security release @user <reason>` |
| Lock or unlock a channel | `!security lock\|unlock #channel <reason>` |
| Configure join bursts | `!security joins threshold <2-100>`, `window <1-300 seconds>`, `module on\|off`, `raid-mode off\|defcon2` |
| Manage the watchlist | `!security watchlist add\|update @user <reason>`, `show\|remove @user`, `list [next]`, `module on\|off` |
| Manage honeypot channels | `!security honeypot add\|remove #channel`, `list`, `module on\|off` |
| Inspect open recovery | `!security recovery list [next]`, `!security recover <case>` |
| Configure the module | `!security module on\|off`, `!security mode dry-run\|enforce`, `!security status` |

Quarantine, release, lock and unlock link an earlier case with `case <case-number>` before the reason, like moderation sanctions. Join bursts, honeypot posts and watchlist joins create cases classified as `join-burst`, `honeypot` or `watchlist`. Review them with `!mod list` and `!mod show`

Quarantine is a native timeout. A longer existing timeout is kept. Lock changes only the everyone role's Send Messages, Send Messages in Threads, Create Public Threads and Create Private Threads permissions in that channel, so members can neither post in the channel or its threads nor start new threads. Fluxer lets a bot stop denying only permissions it holds, so a lock denies only the thread permissions NeonFlux holds server-wide, and its reply names any that stay open. Unlock restores exactly the permissions its lock changed, as they were, and keeps unrelated later changes. A lock made before thread support covers Send Messages only, and its unlock restores only that. Other role or member grants can still let people speak. A thread has no permissions of its own, so locking or unlocking a thread replies with its parent channel to lock instead

### DEFCON

| Level | Behavior |
| --- | --- |
| 3 | Normal operation |
| 2 | Staff commands and private appeals only. Public commands are blocked |
| 1 | Only critical owner or Administrator controls |

Use `!defcon status`, `!defcon diagnose` and `!defcon set 1|2|3`. Critical controls include status, diagnosis, DEFCON changes, disabling protections, recovery checks, unlock, release, untimeout and unban. Join bursts can raise the level to 2 when `raid-mode defcon2` is set, never to 1. DEFCON does not change channel permissions. In single mode the bot shows the level in its presence and restores it at startup

### Appeals

Members send their `!appeal` commands in a one-to-one DM with the bot. Server membership is not required, so banned users can appeal when Fluxer delivers the DM. `!appeal cases` and `!appeal list` page with `next`

```text
!appeal cases
!appeal submit 12 Please review this case
!appeal list
!appeal show 3
!appeal withdraw 3
```

Each case accepts one open appeal per user. Staff use `!appeal review [next]`, `!appeal review <appeal>` and `!appeal approve|reject <appeal> <reason>` in a server channel or a DM with the bot. Details and decisions are sent privately. Owners and Administrators use `!appeal module on|off`, and `!appeal status` shows the moderation settings. Approving an appeal does not reverse the sanction, so staff reverse it separately

### Live moderation check

`pnpm smoke:live` from `projects/` is an opt-in script that checks moderation against a real development server through REST, without a gateway connection. Copy [the example](../projects/bot/smoke-live.example.json) to the ignored `projects/bot/smoke-live.local.json` and fill in the server from `projects/bot/.env`, an owner or Administrator as operator, a willing member below the operator and bot as target, and a channel

Stop the gateway bot first. The script warns the target, quarantines them for 30 seconds, locks the channel and checks the DEFCON gates, then reverses each change and restores the original settings, also after a failure or Ctrl+C. It prints each check and exits with code 1 when one fails. Cases and notices remain as normal history

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

The send reply gives a tracked post number. To change the sent message, update the draft and run `!publish edit <post-number> announcement`. The bot first checks that the message still matches what it last sent

| Task | Command |
| --- | --- |
| Create, show, delete or preview | `!publish create\|show\|delete\|preview <name>`, `!publish list [next]` |
| Copy a draft | `!publish clone <name> <new-name>` |
| Work with templates | Put `template` after `!publish`, for example `!publish template create welcome` |
| Copy a template into a draft | `!publish template clone <name> <new-name> draft` |
| Set text | `!publish set <name> content\|title\|description\|url\|timestamp "value"`, `color #RRGGBB` |
| Set author and footer | `!publish set <name> author "name" ["URL"\|none] ["icon URL"\|none]`, `footer "text" ["icon URL"]` |
| Set media | `!publish set <name> image\|thumbnail "URL" ["description"]` |
| Manage fields | `!publish field <name> add "name" "value" [on\|off]`, `set <1-25> ...`, `remove <1-25>` |
| Clear parts | `!publish clear <name> content\|embed\|title\|description\|url\|color\|timestamp\|author\|footer\|image\|thumbnail\|fields` |
| Inspect posts | `!publish posts [next]`, `!publish status <post-number>` |
| Check a post with an unknown outcome | `!publish reconcile <post-number>` |
| Record a post's outcome by hand | `!publish resolve <post-number> sent <message-id>`, `!publish resolve <post-number> failed` |
| Stop tracking a post | `!publish forget <post-number>` |
| Configure | `!publish module on\|off`, `!publish status` |

A message has up to 2000 code units of content and one embed with up to 25 fields and 6000 code units of embed text. URLs must use HTTP or HTTPS and fit in 2048 code units. The bot does not fetch media or upload files

When a send or edit has an unknown outcome, `reconcile` reads the known message, or staff use `resolve` to record what happened. Edit and forget work again once the outcome is known. Deleting a draft or forgetting a post never deletes the message. Attempt history is kept for 180 days. Publishing starts enabled. DEFCON 2 still allows Administrators to publish, and DEFCON 1 allows only disabling, status and reconcile

### Scheduled publishing

Owners and Administrators plan finite announcements with `!publish schedule`. Schedules and the scheduling module start disabled. A schedule copies the draft or template as it is when the schedule is created or its content is replaced, so later edits to the source do not change it

```text
!publish schedule create news draft notice #announcements 2026-11-01T18:00 Europe/Berlin reject weekly 1 3
!publish schedule module on
!publish schedule enable news
!publish schedule status news
```

| Task | Command |
| --- | --- |
| Create | `!publish schedule create <name> draft\|template <source-name> #channel YYYY-MM-DDTHH:mm IANA/Zone reject\|earlier\|later [daily\|weekly <1-12 interval> <1-26 count>]` |
| Show or list | `!publish schedule show <name>`, `list [next]` |
| Inspect settings or deliveries | `!publish schedule status [<name> [next]]` |
| Replace content | `!publish schedule update <name> content draft\|template <source-name>` |
| Replace time | `!publish schedule update <name> time YYYY-MM-DDTHH:mm IANA/Zone reject\|earlier\|later [daily\|weekly <interval> <count>]` |
| Change destination | `!publish schedule update <name> destination #channel` |
| Enable, pause or cancel | `!publish schedule enable\|disable\|cancel <name>` |
| Check a known post | `!publish schedule reconcile <name> <tracked-post-number>` |
| Forget settled deliveries | `!publish schedule forget <name> [occurrence-number ...] [confirm]` |
| Turn the module on or off | `!publish schedule module on\|off` |

Each schedule has a unique name. Dates must be in the future within 180 days, and a whole schedule spans at most 180 days. A local time that does not exist is rejected, and a repeated time needs `earlier` or `later`

Enabling never catches up on missed dates. A delivery that comes due while the bot is down still sends until local midnight after its due time. Cancel closes remaining dates permanently. Scheduled posts are sent as the bot and need the bot's channel permissions, the scheduling and publishing modules and DEFCON 3. Forgetting removes tracking without deleting messages. Settled history is kept for 180 days

## Role panels, reaction verification, autorole and reservations

Reaction panels, rules verification, autorole and the role picker each start disabled. The owner or an Administrator configures them. The bot needs Manage Roles and a role above every role it assigns. It only assigns roles with ordinary permissions, never everyone, privileged roles or staff roles, and it does not create roles

The bot adds and removes roles one at a time and keeps unrelated roles. It removes a role only if it added it during the member's current stay and no other panel, verification or autorole still needs it

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

Toggle panels allow any combination, and exclusive panels allow one choice. Members react or use `!roles choose colors 🔵`, or `!roles choose colors none` to clear. Changing mappings, rules or mode requires publishing a fresh panel message. Old reactions keep their original meaning

The bot learns which messages are published role or verification panels from the panel list it reads for role work, and keeps that list for 10 minutes. While it holds a list, reactions on other messages cost no Fluxer or backend requests. Publishing or retiring a panel through `!roles`, `!verify` or the dashboard drops the list, so the next reaction reads it again

| Task | Command |
| --- | --- |
| Show or list panels | `!roles show <name>`, `!roles list [next]` |
| Require or exclude roles | `!roles requires\|excludes <name> <emoji> @roles...\|none` |
| Change a mapping or mode | `!roles unmap <name> <emoji>`, `!roles mode <name> toggle\|exclusive` |
| Enable, disable or delete | `!roles enable\|disable\|delete <name>` |
| Retire a published panel | `!roles retire <name>`, then `!roles next <withdrawal-id>` |
| Inspect history | `!roles history <name> [next]` |
| Process a cleared reaction set | `!roles reactions <name>`, `!roles jobs`, `!roles resume <job-id>` |
| Check or withdraw a member's roles | `!roles reconcile\|withdraw <name> [@user] [next]` |
| Status and module | `!roles status`, `!roles module on\|off`, `!roles help` |

Retire and delete withdraw the roles a panel granted, within the same command. If a role change has an unknown outcome, `!roles reconcile` checks that member once the attempt window closes, and `!roles next <withdrawal-id>` continues the withdrawal. Withdraw and reconcile are Administrator recovery commands. Settled role history is kept for 180 days

### Rules verification

```text
!publish create rules
!publish set rules content "Read and accept the current server rules"
!verify configure @Member ✅
!verify publish #rules rules
!verify module on
```

A member reacts to the rules panel or sends `!verify`. With advanced verification turned on in the dashboard, the bot instead sends a private link to the [web verification](WEB.md#web-verification) flow. `!verify status` shows whether the acknowledgement was saved and the role granted. Administrators use `!verify review <request-id>` to help a member who cannot complete the web challenge, and `!verify reconcile|withdraw [@user] [next]`, `retire` and `next` for recovery

Plain reaction verification is an acknowledgement, not a CAPTCHA

### Role picker

Members claim and drop roles on the [website](WEB.md#member-role-picker) from menus that the owner or an Administrator sets up in chat or in the dashboard. The role picker starts off

```text
!rolepicker menu add colors single "Pick one colour"
!rolepicker menu role add colors @Red @Blue
!rolepicker on
```

| Task | Command |
| --- | --- |
| Status, switch and help | `!rolepicker`, `!rolepicker on\|off`, `!rolepicker help` |
| List, add or remove menus | `!rolepicker menu list`, `!rolepicker menu add <name> single\|multi ["description"]`, `!rolepicker menu remove <name>` |
| Change a menu | `!rolepicker menu set <name> mode single\|multi`, `!rolepicker menu set <name> description "text"\|none` |
| Menu roles | `!rolepicker menu role add\|remove <name> @roles...` |
| Who may use it | `!rolepicker access`, `!rolepicker access allow\|block\|unallow\|unblock role\|user <mentions or IDs>` |

A server has up to 10 menus of up to 25 roles each, and a role belongs to one menu. Menu roles follow the reaction panel rules: Below the bot's top role and the sender's, not everyone, not a staff role and only ordinary member permissions. A block always wins over an allow, and with no allowed roles or users every member who is not blocked may use the role picker. Like other role commands, turning the role picker off and removing a menu still work at DEFCON 1. Removing a menu keeps the roles members already chose

The work dispatcher wakes the server's dashboard worker when website requests are queued, so the bot handles them within a few seconds and an idle server makes no role picker requests. It reads the member fresh, the backend checks the menus, the access lists, verification and the role rules, and the role change uses the same one-time claim as reaction panels. In a single-choice menu a claim first drops the member's other role of that menu, which works only when the role picker added that role and no other feature still needs it. A drop never removes a role the role picker did not add

### Autorole and reservations

Use `!autorole add|remove @role`, `!autorole list` and `!autorole module on|off`. Autorole applies to future joins only and to humans by default. `!autorole humans off` includes bots. When verification is configured, autorole waits for it

A reservation gives an exact user ID extra roles when that user joins or rejoins, even before they are a member. Use `!autorole reserve <user-id> @roles...`, `!autorole unreserve <user-id>` and `!autorole reservations`, or the dashboard. Up to 100 users can have one to 20 reserved roles. Saving does not grant roles to current members, and removing a reservation does not take roles away. Recovery uses `!autorole retire`, `next`, `history [next]` and `reconcile|withdraw @user [next]`

### Temporary roles

Staff give a member a role for a set time, and NeonFlux removes it when the time ends. Giving, renewing, shortening, ending and listing need Manage Roles, or the server owner or an Administrator, and giving or ending a role also needs a highest role above it. The role follows the rules of every role NeonFlux assigns: Below the NeonFlux role, not the everyone role, not a staff role and only ordinary member permissions. Like other role grants, a member who is timed out, quarantined or has not accepted configured rules verification cannot receive one

```text
!temprole add @member @Winner 7d
!temprole set @member @Winner 3d
!temprole remove @member @Winner
```

| Task | Command |
| --- | --- |
| Give a role for a set time | `!temprole add @member @role [duration]` |
| Renew or shorten a grant, counted from now | `!temprole set @member @role <duration>` |
| End a grant early and remove the role | `!temprole remove @member @role` |
| List grants, the earliest end first | `!temprole list [@member] [next]` |
| Show or change role defaults | `!temprole defaults`, `!temprole default @role <duration>\|none`, `!temprole max @role <duration>\|none` |
| Recover after an unconfirmed role change | `!temprole reconcile @member` |

Durations use m, h, d or w, such as 30m, 12h, 7d or 2w, from 1 minute to 365 days. Without a duration, `add` uses the role's default duration, and a role's longest duration limits `add` and `set`. Defaults need Manage Server and can also be set in [the dashboard](WEB.md#temporary-roles). A member holds at most 25 temporary roles, and at most 100 roles have defaults

NeonFlux removes only roles it adds, so a role the member already holds cannot become temporary. When the time ends, the bot reads the member and the server's roles fresh and removes the role through the same role ownership as panels and autorole:

- A role that staff already removed is left alone, and the grant ends
- A role another NeonFlux feature, such as a reaction panel or autorole, still gives stays, and the grant ends
- A member who leaves loses the role with the membership. Rejoining before the end time does not restore it, and the grant ends. Staff can give the role again for the new membership
- A deleted role ends the grant
- When NeonFlux lacks Manage Roles or ranks at or below the role, the grant stays with the problem shown in `!temprole list` and the dashboard, and NeonFlux tries again every 10 minutes. `!health` names the fix
- An end time that passes while the bot is offline is handled soon after the bot starts again

If Fluxer does not confirm a role change, NeonFlux never repeats it. The grant shows the problem until the server owner or an Administrator runs `!temprole reconcile @member`, which reads the member's roles, records what Fluxer shows and settles the member's grants. Giving and renewing need DEFCON 3. Ending, listing and recovery also work at DEFCON 1 and 2 for the server owner and Administrators

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

| Task | Command |
| --- | --- |
| Show your own checklist and what is left | `!onboarding` |
| Show the checklist as configured | `!onboarding status` |
| Add a step at the end | `!onboarding add rules`, `add panel <name>`, `add menu <name>`, `add link #channel "line"` |
| Remove a step | `!onboarding remove <position>` |
| Choose the greeting that carries it | `!onboarding delivery welcome\|dm` |
| Set or clear the completion role | `!onboarding role @role\|none` |
| Turn it on or off | `!onboarding on\|off` |

Members finish each step through the feature it names, and NeonFlux follows what those features already record:

- `rules`: Accept the current rules through [rules verification](#rules-verification), including the website challenge when advanced verification is on
- `panel <name>`: Hold a role from that published [reaction role panel](#reaction-role-panels)
- `menu <name>`: Hold a role from that [role picker](#role-picker) menu
- `link #channel "line"`: A channel to visit with a line of up to 100 characters. It needs no finishing

A step whose panel, menu or rules verification is not published or turned off is left out until it is back. The checklist goes at the end of the greeting of the chosen route, so that route must be configured and on, see [welcome and goodbye](#welcome-and-goodbye). The greeting copies the checklist when the member joins

NeonFlux checks a member's progress when their roles change, while it holds a role of every step, and when they send `!onboarding`. It keeps the checklist and the roles that finish each step in memory and reads them again after its own changes and every ten minutes, so ordinary role changes cost no backend request. A member finishes the checklist once per membership. A finished member is counted for [server analytics](#server-analytics), as a number only, and receives the completion role when one is set. The completion role follows the rules of every role NeonFlux assigns, and a member who is timed out, quarantined or has not accepted configured rules cannot receive it. If Fluxer refuses the role, `!onboarding` tries again. If Fluxer does not confirm it, NeonFlux never repeats it. NeonFlux does not remove the completion role, also not when it is changed or cleared later

At DEFCON 1 only turning the checklist off and `!onboarding status` work, for the owner and Administrators. Members use `!onboarding` like other member commands, so DEFCON 2 blocks it for them

## Welcome and goodbye

Owners and Administrators configure three routes: a channel welcome, a private DM greeting and a channel goodbye. All start off and apply to human members. Compose the message as a [publishing template](#drafts-templates-and-posts). Configuring a route copies the template's current revision, so later template edits do not change it

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

- Placeholders are `{user.name}`, `{user.mention}`, `{user.id}`, `{server.name}`, `{server.id}` and `{channel.id}`. `{user.mention}` can notify only the greeted member, and `{channel.id}` works only in channel routes
- Welcome and DM routes need `join` or `verified` timing. `verified` waits until the member completed rules verification and holds the access role
- Enabling a route does not greet existing members, and a join is greeted only within 15 minutes
- Goodbye is sent when a member leaves, including members who joined before the bot started tracking. The bot cannot tell whether a departure was voluntary, a kick or a ban
- Preview sends a sample for the invoking staff member in the current channel
- A delivery with an unknown outcome is never resent
- While the [newcomer checklist](#newcomer-checklist) is on, the welcome or DM route it names ends with the checklist and a line naming `!onboarding`. When the greeting is too long for both, only that line is added, and nothing when even that does not fit in 2,000 characters
- One delivery pass considers at most 20 members and reads at most ten pages of waiting greetings. Greetings beyond that continue a minute later

## Tickets

Tickets start disabled. Owners and Administrators configure categories, conversation visibility, an optional native parent category, dedicated support roles, up to five intake questions of at most 200 characters and canned replies copied from publishing templates. Ticket support roles are separate from moderation staff roles. A category with no support roles leaves staff access to Owners and Administrators

```text
!ticket help
!ticket module on|off
!ticket retention <1..365 days>
!ticket categories
!ticket settings
```

Category setup, canned replies, ticket lists, operation history, intake, notes and transcripts work only in a verified one-to-one DM with NeonFlux. Public category descriptions never show questions or canned content

```text
!ticket category create <name> private|public #parent|none @support-roles...|none
!ticket category show|delete <name>
!ticket category set <name> description "text"
!ticket category set <name> visibility private|public
!ticket category set <name> parent #category|none
!ticket category set <name> staff @roles...|none
!ticket category set <name> enabled on|off
!ticket question <category> add "question"
!ticket question <category> set <1..5> "question"
!ticket question <category> remove <1..5>
!ticket question <category> clear
!ticket canned <category> set <name> <publishing-template>
!ticket canned <category> remove <name>
!ticket canned <category> list
```

Members open a ticket from the DM. Intake shows who will see the conversation before any answer is entered and again before submission. Each answer allows 2000 characters and stays private even when the conversation channel is public. A category or template change after an intake starts makes submission fail instead of silently changing that intake

```text
!ticket open <category>
!ticket answer <intake-number> <1..5> "answer"
!ticket review|cancel <intake-number>
!ticket submit <intake-number> private|public
```

After `!ticket open`, the bot asks the first question. While a member has exactly one open intake, any DM from them that is not a command answers the current question, and the bot replies with the next one. Once every question is answered, it shows the answers and who will see the conversation, then waits for a plain-word reply:

| Reply | Effect |
| --- | --- |
| Any other text | Answers the current question |
| `back` | Clears the previous answer, or the last one at the confirmation step, shows it and asks that question again |
| `send` | Creates the ticket for the shown audience, once every question is answered |
| `cancel` | Cancels the intake |

The words match without regard to case. An answer with an attachment or sticker is refused, because answers keep text only, and an answer over 2000 characters gets a reply naming the limit. With more than one open intake, a plain DM gets the `!ticket answer` command for each intake, with its server in multi-server mode, instead of a guess. Without an open intake, plain DMs get no reply. Each plain DM costs one backend read to look for an open intake

Staff work in the ticket's own channel. Requesters can read their own tickets and ask to close or reopen them under the category policy. Staff can also open a ticket for a help post's author with `!escalate`, see [forum help desk](#forum-help-desk)

| Command | Who | Behavior |
| --- | --- | --- |
| `!ticket list [next]` | Staff, requester | List visible tickets |
| `!ticket status\|intake <ticket>` | Staff, requester | Show the state and last operation, or the private intake answers |
| `!ticket attempt <ticket> <attempt>` | Staff | Show metadata for one numbered operation attempt |
| `!ticket claim\|unclaim <ticket>` | Staff | Take or release the ticket |
| `!ticket priority <ticket> low\|normal\|high\|urgent` | Staff | Set priority |
| `!ticket reply <ticket> "text"` or `canned <name>` | Staff | Post a reply in the ticket channel |
| `!ticket note <ticket> add "text"` or `list [next]` | Staff | Private staff notes, kept apart from intake and channel history |
| `!ticket close\|reopen <ticket>` | Staff, requester | Remove or restore send access |
| `!ticket reconcile <ticket>` | Staff | Recheck a partial close, reopen or create against the live channel |
| `!ticket transcript <ticket> capture [1..500]` | Staff | Store a transcript of up to 500 recent messages |
| `!ticket transcript <ticket> list [next]` | Staff | List stored transcripts |
| `!ticket transcript <ticket> show <transcript> [next]` | Staff | Read a transcript in 1500-character pages |
| `!ticket delete <ticket> confirm` | Owner, Administrator | Delete the closed ticket channel and release it |
| `!ticket erase <ticket> confirm` | Owner, Administrator | Erase stored intake, notes and transcripts |
| `!ticket abandon <ticket>` | Owner, Administrator | Release the requester's slot after a channel creation whose result stayed unknown |

Creation sets the full conversation audience in the first channel request, and the introduction contains metadata only with mentions disabled. Close removes send access for everyone and the requester, including sending in the ticket's threads and starting new ones, as far as NeonFlux holds those thread permissions server-wide. Reopen restores the recorded permissions and leaves unrelated ones untouched. A ticket closed before thread support reopens its send access only. Another role or member allowed to send or post in threads blocks closing until staff remove that grant. Staff keep send access, and Administrator permission still bypasses these overwrites. Renaming or moving a ticket channel does not block replies, close, reopen or delete

If close, reopen or creation is interrupted, the ticket stays unresolved until `!ticket reconcile` confirms the live state. NeonFlux never retries an operation with an unknown result or searches for a channel by name. After `!ticket abandon`, check the server for a leftover channel yourself. Erasing such a ticket also releases the slot but keeps protection for a channel that might exist

Private bodies require current server membership, the ticket's recorded requester and support-role access and native view and history permission. A requester who rejoins with the same account regains access. Deleting a channel needs explicit confirmation, a successful delete response and a fresh check that the channel is gone

Closed ticket bodies expire after 30 days by default, configurable from 1 through 365 days. Reopen is unavailable after expiry or erasure. Erasure removes stored copies only and never deletes messages already sent. Body retention never deletes native channels

Transcript capture is explicit and incomplete by design. Each stored message keeps at most 2000 characters of text with its author and timestamps. Attachment URLs and embed bodies are left out, and a capture that exceeds the storage budget is truncated with a notice. A failed capture stores nothing. Each ticket keeps at most 20 transcripts and 200 note entries. To share a public summary, write a separate publishing draft, because private content is never copied automatically

A capture also includes the public threads of the ticket channel, active or archived, each under a line with its name after the channel's own messages. The channel is read first, and threads then share what it leaves of the 500 messages and the storage budget, oldest thread first. At most 10 threads are read, each with one read of its newest messages, and the 100 most recently archived threads are the ones found. Anything left out marks the capture truncated, and so does a thread list Fluxer refuses. Private threads are left out, because their members need not match who can read the transcript

## Message leveling

Owners and Administrators configure message XP with `!level`. Current members can read `!rank` and `!leaderboard`. Rank cards are native embeds, replies suppress mentions, and cards and leaderboards show account IDs without storing display names or avatars

Leveling starts disabled with 15 XP per eligible message and a 60-second cooldown. Level N needs `100 * N²` lifetime XP, up to level 1000. Scores belong to the account in this server and survive leaving and rejoining. Turning leveling on from the dashboard takes effect immediately

| Command | Behavior |
| --- | --- |
| `!level help` | Show copyable syntax |
| `!level config` | Show current settings and mappings |
| `!level module on\|off` | Start or pause XP and new reward grants |
| `!level rate <1-100 XP> <15-3600 seconds>` | Set XP per message and cooldown |
| `!level exclude channels\|roles <IDs...\|none>` | Replace the exclusion list, at most 50 each |
| `!level map <1-1000 level> @role` | Add a reward role, at most 20 mappings |
| `!level unmap <level>` | Remove one mapping |
| `!level clear [confirm]` | Preview, then clear all mappings |
| `!level correct @user <0-100000000 XP> <reason>` | Set an absolute XP value with an audit entry |
| `!level reset member @user <reason> [confirm]` | Preview, then reset one member |
| `!level reset server <reason> [confirm]` | Preview, then start a new season for everyone |
| `!level status` | Show pending and blocked reward work |
| `!level reconcile [@user]` | Queue a reward check for the server or one member |
| `!level audit [next]` | Read correction and reset audits |
| `!rank [@user or user ID]` | Show XP, level and rank |
| `!leaderboard [next]` | Show 20 rows ordered by XP |

Reasons need no quotes. A reset's final word `confirm` confirms it, and the words before it are the reason, so the preview prints the exact command to send. Corrections apply in the order their commands were sent, so an older correction that arrives late is rejected. `!leaderboard next` and `!level audit next` continue where your last page in that channel ended. Rows can shift between pages while XP is awarded. After a server reset, `!leaderboard next` reports the change and forgets its place, so start again with `!leaderboard`. Rank is exact for every member, except when more than 100 members of the same level have more XP, where the card shows the range of positions that level allows, such as `#3102 to #3400`. Right after an update, until the backend has counted a server's existing profiles, rank is exact within the top 1000 and reported as outside the top 1000 beyond it. Members with zero XP are unranked

XP comes only from human ordinary or reply messages in the configured server that pass existing protection and command gates. Bots, system messages, webhooks, DMs, edits, prefix commands and empty text earn nothing. Duplicate text within ten minutes earns nothing. Candidates wait in a memory queue of at most 1000 accounts, so a busy server or a restart can drop some awards. NeonFlux does not promise XP for every eligible message

Leveling never stores message text, display names or avatars. It keeps account and message IDs, timestamps and a keyed digest for duplicate detection, retained for ten minutes. Correction and reset audits keep actor, target, XP before and after, reason and time for 180 days

Reward roles are cumulative and use the shared safe-role checks, so NeonFlux needs Manage Roles and a role above each reward. Collection itself does not need Manage Roles. Awards, corrections, resets and mapping changes mark an account for a reward pass, and a failed role change keeps the account marked for a later pass without blocking other roles. Turning leveling off keeps existing rewards, while clearing mappings, resets and demotions still remove rewards NeonFlux granted. A server reset hides old scores at once. A rejoining member keeps XP but must earn role ownership again through a new message or `!level reconcile @user`. NeonFlux removes only roles it granted and confirmed, and preserves roles granted any other way

## Events and RSVPs

Events start disabled and use `!event`. Owners and Administrators manage definitions. Current members read published events and RSVP in the event's destination channel, and `!event list` lists them. Replies and attendee lists suppress mentions and show account IDs. DMs cannot run event commands

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
| `!event dates <name> [next]` | List occurrences with zone, offset and UTC times |
| `!event attendees <name> <occurrence> [next]` | List attendees and the waitlist |
| `!event rsvp <name> <occurrence> going\|maybe\|not-going\|none` | Set or clear your RSVP |
| `!event create <name> #channel "title" ["description"]` | Create a draft event with a name of up to 32 lowercase letters, numbers, underscores or hyphens that no other event of the server uses |
| `!event time <name> YYYY-MM-DDTHH:mm <IANA zone> <1-10080 minutes> [reject\|earlier\|later]` | Set the first occurrence |
| `!event repeat <name> off\|daily\|weekly <1-12 interval> <1-26 total>` | Set repetition |
| `!event title <name> "title" ["description"]` | Change the text |
| `!event template <name> <template>\|off` | Use a snapshot of the publishing template as it is now |
| `!event capacity <name> off\|1-500` | Limit Going seats |
| `!event reminders <name> off\|<minutes> [minutes]` | Set up to two reminder offsets, 1 to 10080 minutes |
| `!event publish\|cancel <name>` | Publish the card or cancel the event |
| `!event status [<name> [next]]` | Show the module, or one event's card and reminder outcomes |
| `!event reconcile <name> [tracked-post-number]` | Recheck a known card or reminder message |
| `!event forget <name> [confirm]` | Remove settled event data in pages |
| `!event module on\|off` | Turn the module on or off |
| `!event threads on\|off` | Turn discussion threads on or off for events published afterwards |

Going takes a seat or the next waitlist place. Repeating Going keeps your place, and withdrawing then choosing Going again joins the end of the waitlist. Maybe, Not going and None use no seat. RSVPs close at start or cancellation. Waitlisted members are promoted only while they are still members with access and pass verification, timeout and quarantine checks. Members who leave lose their seat

Times use an exact local minute and an IANA zone. Repeats allow at most 26 occurrences within 180 days, and wall-clock times hold across offset changes. Nonexistent local minutes are rejected, and repeated minutes are rejected unless you choose `earlier` or `later`. Once anyone has RSVPed, the calendar cannot change. Cancel the event and create a new one instead. Capacity cannot drop below confirmed Going attendance

Each event has one protected publishing card that follows publishing limits. Event changes edit the card, and RSVPs do not. `!publish` cannot edit or forget event cards. Reminders default to 1440 and 60 minutes before start, are skipped if already past due on activation and must send before the event starts. Automatic cards and reminders send as NeonFlux and need its channel permissions, the module and publishing switches and a DEFCON level that allows them. DEFCON 2 pauses automatic sends and public RSVPs. Cancellation and disable never delete posted messages. A send with an unknown result is never repeated, so use `!event status` and `!event reconcile` to recover it

An event's destination can be a forum or media channel. Its card then becomes the first message of a forum post named after the event, reminders go into that post, and members and staff run event commands in any post of the forum. In a text or announcement channel, commands stay in the channel itself

Discussion threads start off. With `!event threads on`, each event published afterwards gets a discussion thread on its card once the card is sent, named after the event and archived after a week without messages. In a forum the post is the discussion. Once the last occurrence ends or the event is cancelled, NeonFlux archives and locks the thread or post. It created both, so it needs only Create Public Threads, which `!health` checks while threads are on. A thread that cannot be started or closed is tried again every minute, and starting one twice is not possible, because a thread started on a message takes the message's ID. Threads that were open when the setting is turned off still close after their event

A server keeps at most 50 events, 200 occurrences, 1000 RSVPs per occurrence and 50000 RSVPs overall. RSVPs expire 30 days after an occurrence ends or is cancelled, and ended event history after 180 days. No message bodies, member names or avatars are stored

## Birthdays and membership anniversaries

Members opt into public birthday and membership-anniversary posts with `!milestone` in a verified one-to-one DM with NeonFlux. Birthdays take only `MM-DD`, including `02-29`, with no year or age. Anniversaries use the member's actual join time, never a supplied date. The module and both routes start disabled, and shared publishing must also be enabled

```text
!milestone help
!milestone me
!milestone birthday set 02-29 confirm #celebrations
!milestone anniversary on confirm #celebrations
!milestone remove [birthday|anniversary]
```

Consent names the configured public channel as a mention, ID or name. A personal command sent in a server channel gets private instructions and is not stored, but the message itself stays visible. `me` and `remove` work after leaving the server. Staff cannot enroll members or list birthday dates. If the destination changes, members must opt in again

Owners and Administrators configure each route from a publishing template. Configuring in chat uses the template's latest saved version, and later template edits change the route only when it is configured again. Templates can use `{user}` and `{server}`, plus `{years}` for anniversaries. Birthday posts never show the date or an age. All milestone replies and previews are private, and posts suppress mentions

| Command | Behavior |
| --- | --- |
| `!milestone status [birthday\|anniversary [next]]` | Show configuration and limits, or delivery history for one route. `next` shows the following page |
| `!milestone configure birthday\|anniversary #channel <IANA zone> HH:mm earlier\|later\|reject template <name>` | Set a route |
| `!milestone preview birthday\|anniversary` | Preview the post privately |
| `!milestone enable\|disable\|clear birthday\|anniversary` | Control one route |
| `!milestone module on\|off` | Turn the module on or off |
| `!milestone reconcile birthday\|anniversary <post>` | Recheck one known post |
| `!milestone forget birthday\|anniversary <settled-post> [confirm]` | Drop settled tracking without deleting the post |

Posts go out at the configured local time in the server's zone. February 29 celebrates on February 28 in other years. Anniversaries count completed years from one. A late delivery still sends until local midnight, and a missed day does not use up that year's birthday. Enrolling skips a celebration already due. Automatic posts send as NeonFlux and need its channel permissions, the module and publishing switches and DEFCON allowance. Leaving the server ends consent. The bot checks consent when a member leaves or rejoins and again before each post, not on other member updates such as role or nickname changes

Removal deletes the enrollment and stored date. Posts already sent stay. A server allows at most 1000 enrolled accounts and 4000 retained deliveries. Settled tracking expires after 30 days, and a body-free record of each delivered year lasts 400 days so re-enrolling cannot repeat it

## Suggestions and voting

Owners and Administrators set up the disabled module with `!suggest configure #channel`, enable it with `!suggest enable` and inspect it with `!suggest settings`. Members use the other commands in the configured destination

| Command | Who | Behavior |
| --- | --- | --- |
| `!suggest submit "text"` | Member | Post a suggestion of at most 2000 characters |
| `!suggest show <number>` | Member | Read text, author, state, counts and card status |
| `!suggest list [state] [next]` | Member | List up to ten suggestions. `next` shows the following page |
| `!suggest vote <number> up\|down\|clear` | Member | Set, change or clear your vote |
| `!suggest mine <number>` | Member | See your own vote |
| `!suggest withdraw <number> [confirm]` | Author | Withdraw permanently. Without `confirm` it asks first |
| `!suggest status <number> under-review\|planned\|completed\|declined <reason>` | Staff | Change state with a public reason of at most 500 characters. The reason runs to the end of the command and needs no quotes |
| `!suggest publication <number>` | Staff | Show card delivery state |
| `!suggest reconcile\|replace <number> [confirm]` | Staff | Recheck a known card, or replace one confirmed missing |
| `!suggest forget <number> [confirm]` | Staff | Remove settled closed suggestion data in pages |
| `!suggest disable` | Staff | Stop submissions, votes and cards and keep data |

Voting uses commands only, and reactions change nothing. Under-review and planned suggestions accept votes. Completed and declined ones close voting and can be reopened with a reason until they expire. Withdrawn suggestions stay closed. Only the latest status reason, actor and time are kept. Self-votes count, and votes stay after the voter leaves. Editing or deleting a command message does not change the recorded text or vote

Cards show author, state, vote totals and the latest reason with mentions suppressed. There is no public voter list, but database administrators can see voter IDs. Card updates are grouped for about five seconds and sent as NeonFlux, under its channel permissions, the module and publishing switches and DEFCON. A card can lag behind the recorded state. Check `!suggest publication` before recovery. A missing card needs explicit replacement, and `!publish` cannot edit or forget suggestion cards. Forgetting data never deletes posted cards

The destination can be a forum or media channel. Each suggestion then becomes its own forum post, named after its number and text, whose first message is the card, and the post is the place to discuss it. Members and staff run `!suggest` commands in any post of the forum. The post carries one status tag that follows the suggestion's state: Under review, Planned, Completed, Declined or Withdrawn. Other tags on the post stay. When the destination is configured, NeonFlux adds the status tags the forum lacks, which needs Manage Channels. When it cannot, because it lacks the permission or the forum would pass Fluxer's limit of 20 tags, the reply names the fix, such as removing some tags or adding the five yourself. Status tags must not be moderated, since NeonFlux applies them as the post's creator without Manage Threads. A card edit reopens an archived post first. A locked post needs a moderator to unlock it before its card can change

Voting in a forum still uses commands. A forum's default reaction counts every reaction, including those of departed or unverified members, and reactions removed while the bot is offline are not replayed, so its count could not match the recorded votes. Deny members Send Messages in the forum so only NeonFlux starts posts, allow Send Messages in Threads so members can discuss, and pin a post that explains how to suggest, where members can run `!suggest submit`

Limits are 1000 suggestions per server, 1000 voters per suggestion and 10000 vote records per server. Closed suggestions expire after 180 days

## Automatic message cleanup

Owners and Administrators use `!cleanup` to delete messages older than a chosen age in selected Text and Announcement channels. The module and every policy start disabled. Ages run from one hour through 365 days in whole minutes, hours or days, such as `60m`, `1h` or `30d`

| Command | Behavior |
| --- | --- |
| `!cleanup help` | Show syntax |
| `!cleanup configure #channel <age>` | Create or replace a channel policy |
| `!cleanup show\|preview #channel` | Show the policy, or check up to 50 older messages without deleting |
| `!cleanup list` | List up to 50 configured channels |
| `!cleanup status [#channel [next]]` | Show module status or up to 20 recent targets. `next` shows the following page |
| `!cleanup enable #channel [confirm]` | Enable the policy, including existing old messages |
| `!cleanup disable #channel` | Stop new deletions and keep configuration |
| `!cleanup module on\|off` | Turn the module on or off |
| `!cleanup exclude #channel author\|message add\|remove <id>` | Keep up to 50 authors and 100 messages |

Only human messages of ordinary or reply type that are unpinned, older than the cutoff and outside every exclusion and publishing or panel protection are deleted. Anything with unknown pin state, author, type or time is kept. Preview counts unknown messages as skipped. Replies contain metadata only and suppress mentions

Automatic deletion runs as NeonFlux under the server automation policy. It needs View Channel, Read Message History and Manage Messages, the module and policy switches and a DEFCON level that allows it. It does not depend on the Administrator who configured it. DEFCON 1 pauses new deletion. Each pass runs at startup and every 60 seconds and deletes at most five messages per channel and 20 overall. A deletion with an unknown result is never retried

A policy also covers the channel's active threads, under the same age, exclusions and permissions. Each sweep reads the channel's own history first. When it reaches the end, it moves on to the oldest active thread of the channel that was created before the cutoff, since a newer thread holds no message old enough, and so on in order of creation until none is left. Each step costs one read of the server's active threads. Archived threads are left alone until a new message makes them active again, because NeonFlux does not reopen them. Preview samples the channel itself only. The same pass budgets apply, so a channel with many threads takes more passes to finish a sweep

Deletion has no server-side pin check, so a message pinned just before deletion can still be removed. Cleanup stores only IDs, authors, timestamps and outcomes, never message text or attachments. Settled records expire after 30 days

## Metadata logs

Owners and Administrators extend `!logs` with metadata logging. Existing moderation log commands keep their meaning. Configure in a server channel. Status, counters, events and delivery reports arrive in a private DM, and these reads also work from a verified one-to-one DM. `!logs events list next` shows the following page

```text
!logs metadata help
!logs metadata status
!logs metadata module on|off
!logs metadata route <category> <channel> <owner> on|off
!logs metadata clear <category>
!logs metadata event <event> <channel> <owner> on
!logs metadata event <event> off
!logs metadata inherit <event>
!logs metadata channels <channel-IDs|none> <excluded-IDs|none>
!logs events list [next]
!logs events show <record>
!logs delivery show|reconcile <record>
!logs metadata forget <record> confirm
!logs counters
```

Categories are `membership`, `resources`, `messages`, `audit`, `settings`, `operations` and `security`. The `security` category carries the [security alerts and invite logs](#security-alerts-and-invites) that `!alerts` turns on. The module and every route start disabled. Message events also need channel opt-in, with at most 50 channels and 50 exclusions. DMs, private ticket channels, log channels and NeonFlux's own feedback are never logged. `!logs metadata status` also shows NeonFlux's current View, Send and Embed permissions in each enabled destination

The dashboard's Channel logs section configures the same settings, including per-event overrides for twenty-eight event types and eighteen audit actions. An event without an override uses its category route. An audit-action override, such as `audit-entry:20` for kicks, wins over the audit category. An enabled override sends even when its category is off, a disabled one suppresses the event, and `inherit` removes the override

Each category has a color: Membership green, resources blue, messages cyan, audit purple, settings amber, operations coral red and security pink. Shade shows the kind of change, with the darkest tone for destructive actions. A member leaving is neutral and unattributed, while kicks and bans proven by the audit log use the darkest tone

Logged events cover member joins, updates and removals, role and channel changes, thread and forum post creation, changes and deletion, server updates, message edits and deletions and new audit log entries. Thread events use the resources category with their own event types `thread-create`, `thread-update` and `thread-delete`, and name the parent channel. A thread change names the changed fields `name`, `archived`, `locked` and `tags` when NeonFlux saw the thread before, since Fluxer sends only the new state. A thread NeonFlux merely joins is not logged as created. Deleting a channel deletes its threads without separate events, so one `thread-delete` record counts the threads NeonFlux knew in that channel. Records keep IDs, times, proven actors or unknown attribution, changed field names and counts. They never keep message text, attachments, reasons, raw audit changes or invite codes. Settings records cover moderation and log settings, security and DEFCON and metadata configuration only

Each server keeps at most 10000 records, and the oldest is evicted when a new one arrives. Delivery runs as NeonFlux under the server automation policy, and DEFCON 1 pauses it. Disabling keeps records, and re-enabling can deliver the backlog. A send with an unknown result is never repeated. Use `!logs delivery reconcile` to recheck it. Logs are append-only and settled records expire after 30 days

## Security alerts and invites

Security alerts tell staff about changes that often come before a raid or a takeover. Every alert starts off, and NeonFlux only reports. It never kicks, bans, revokes or changes anything on its own. Alerts are records in the metadata log's `security` category, so they need metadata logs on and the category, or one of its events, routed to a staff channel, as `!setup` explains

| Alert | Event type | What it reports |
| --- | --- | --- |
| `invites` | `invite-create`, `invite-delete` | Each invite created or deleted, with its channel and creator. An invite that never expires or has unlimited uses is flagged with `never-expires` or `unlimited-uses` |
| `bots` | `bot-join` | A bot that joins and is not marked expected |
| `webhooks` | `webhook-change` | A webhook that is created or changed and is not marked expected, with who did it |
| `privileges` | `privilege-change` | A role created or changed to hold Administrator, Manage Server, Manage Roles, Manage Channels, Manage Webhooks, Ban Members, Kick Members or Moderate Members, or a member given a role with one of them. The record names the gained permissions and who made the change |
| `impersonation` | `impersonation` | A member whose username or server nickname looks like the owner's name or a staff member's username, display name or nickname |

| Task | Command |
| --- | --- |
| Show which alerts are on and what is expected | `!alerts status` |
| Turn an alert or all of them on or off | `!alerts on\|off invites\|bots\|webhooks\|privileges\|impersonation\|all` |
| Mark a bot or webhook as expected, or stop | `!alerts expect\|unexpect bot\|webhook <ID>` |
| List the server's invites, newest first | `!invites list [next]` |
| Revoke an invite | `!invites revoke <reference>` |

All commands need the server owner, an Administrator or Manage Server. The dashboard's [Security alerts section](WEB.md#security-alerts) changes the same settings

Webhook and privilege alerts come from new audit log entries, which name the webhook or role and the member who made the change, so they need View Audit Log. The actor is taken only from the entry that describes the change and is never guessed. A member role change counts when the entry lists the added role IDs, which has not been checked against live Fluxer. A bot join comes from the join itself, so its alert names no actor. Route the audit action `audit-entry:28` to see who added a bot. Invite lists and the staff names impersonation compares need Manage Server

Impersonation compares names after removing accents, case, spaces and punctuation and folding digits and letters from other scripts that look like Latin letters, such as `0` for `o` or a Cyrillic `а`. Names that then match, or differ by one character from five characters on and by two from ten on, raise one alert per member and name. Names shorter than three characters never match. Staff means the owner and up to 50 members of each of the five highest roles holding Administrator, Manage Server, Ban Members, Kick Members or Moderate Members. NeonFlux reads them at most every ten minutes

Invite codes grant access to the server, so NeonFlux never shows, logs or stores them. `!invites list` names each invite by a 16-character reference derived from its code, with its channel, creator, uses, maximum uses, expiry and flags. `!invites revoke` takes that reference, reads the current invites and deletes the matching one. Members who joined with it stay

Each server gets at most ten alerts at once and then one a minute. Skipped alerts are counted in `!alerts status` until NeonFlux restarts. The alert settings are read once when a server starts and kept in memory, so with every alert off an event costs no backend call. Up to 50 bots and 50 webhooks can be marked expected

## Temporary voice rooms

A member who joins a generator voice channel gets a room of their own, and NeonFlux moves them into it. Staff create and configure generators with `!voice generator`, and room owners manage their room with the other `!voice` commands. The dashboard's Temporary voice section configures the same generator settings

```text
!voice generator add "Join to create" <category-ID>
!voice generator set #generator template "{owner}'s room"
!voice generator set #generator limit 5
!voice rename "Study hall"
```

| Command | Who | Behavior |
| --- | --- | --- |
| `!voice generator add "name" [category-ID\|none]` | Staff | Create a generator voice channel in the category, which also receives its rooms |
| `!voice generator list` | Staff | Show each generator's settings and the live room count |
| `!voice generator set #generator name "name"` | Staff | Rename the generator channel |
| `!voice generator set #generator category <category-ID\|none>` | Staff | Choose where new rooms are created, or none for top-level rooms |
| `!voice generator set #generator template "text"` | Staff | Name new rooms. `{owner}` becomes the owner's server nickname or username |
| `!voice generator set #generator limit <1-99\|none>` | Staff | Set the default member limit of new rooms |
| `!voice generator set #generator region <region-ID\|auto>` | Staff | Give new rooms a fixed voice region, or use Fluxer's automatic routing |
| `!voice generator remove #generator` | Staff | Stop using the channel as a generator. The channel stays |
| `!voice rename "name"` | Owner, staff | Rename the room |
| `!voice hide`, `!voice show` | Owner, staff | Hide the room from everyone without explicit access, or show it again |
| `!voice allow @member`, `!voice block @member` | Owner, staff | Let a member see and join the room, or stop them from doing so |
| `!voice limit <0-99>` | Owner, staff | Set the member limit, with 0 for no limit |

Room commands act on the room you own. Put `#room` after the verb, such as `!voice limit #room 5`, to choose another room. Staff means the server owner, an Administrator or a member with a moderation staff role and Manage Channels, the same rule as `!mod slowmode`. Generator commands are staff commands, and room commands are member commands that DEFCON 2 pauses

- A member owns at most one room. Joining a generator again moves them back to their room
- Fluxer does not let bots move the server owner or members ranked at or above the bot. Their room is still created, and NeonFlux posts a link to it in the generator's text chat so they can join it directly
- A server has at most 10 generators and 50 live rooms. At the room limit NeonFlux creates no room and posts a notice in the generator's text chat
- Names and templates have 1 to 100 characters. Templates support only the `{owner}` placeholder
- Hiding keeps access for the owner and NeonFlux. The owner and NeonFlux cannot be blocked, and blocking does not disconnect a member who is already inside
- Room settings of a generator apply to rooms created after the change

| NeonFlux permission | Used for |
| --- | --- |
| View Channel and Connect where rooms are created | Seeing rooms and their voice activity, since Fluxer delivers voice events only for visible channels |
| Manage Channels | Creating generators and rooms, renaming, member limits and deleting empty rooms |
| Move Members | Moving members into their rooms |
| Manage Roles | Hide, show, allow and block |
| Update RTC Region | Fixed regions, which Fluxer applies with an edit right after the room is created |
| Send Messages in generators | Room limit notices |

Fluxer never lets a bot move the server owner or a member whose highest role is not below NeonFlux's highest role. Those members still get a room and can join it themselves

### Room deletion

NeonFlux deletes only rooms it created and recorded. Generators and all other channels are never deleted automatically. A room is deleted after it has been empty for 45 seconds, which covers a member whose join Fluxer has not reported yet. Right before deleting, NeonFlux reads the room again and checks that it is still empty. Deleting a room or generator channel by hand removes its record

NeonFlux counts each room's members from live voice events. After a restart, a gateway reconnect or resume, or a server outage, it deletes nothing until Fluxer sends a fresh voice list for the server. That list arrives with a new gateway session or when the server becomes available again. A resumed session sends no list, so deletion stays paused until the next one. In multi mode a reconnect or resume on any shard, or a change of the shard plan, pauses deletion on every server, since the SDK reports reconnects for the whole bot. Rooms, owners and generators are stored in the backend, so a restart keeps room ownership. Deletion timers stay in the bot, and a server without voice activity makes no backend calls after startup

These risks remain:

- If a Fluxer voice server fails, its voice list can report an occupied room as empty, and NeonFlux could delete that room. This is rare
- A member who joins in the last moment before a delete is disconnected. They can join the generator again to get a new room
- Deleting a room also deletes its text chat and disconnects anyone still inside
- A gateway connection that stops without closing is noticed at the next missed heartbeat, and voice events missed before that can make an occupied room look empty

## Looking for group

Members post a group for an activity, others join it, and once the group is full NeonFlux gives it a [temporary voice room](#temporary-voice-rooms) that only the group can see. Each group has one card in the group channel that NeonFlux keeps up to date. The feature starts off. Managers turn it on and choose the group channel and the voice generator whose category, member limit and region group rooms use

```text
!lfg config channel #looking-for-group
!lfg config generator #join-to-create
!lfg config on
!lfg "Deep Rock" 4 in 30m bring mics
!lfg join 1
```

| Command | Who | Behavior |
| --- | --- | --- |
| `!lfg "activity" <size> [in <time>] [note]` | Members | Post a group. The size counts you, from 2 to the server's largest size. A time such as `in 30m`, `in 2h` or `in 1d`, up to 7 days, shows when you plan to start |
| `!lfg join <group>`, `!lfg leave <group>` | Members | Join or leave a group. The host cancels instead of leaving |
| `!lfg start <group>` | Host, managers | Start a group before it is full |
| `!lfg cancel <group>` | Host, managers | Cancel a group |
| `!lfg list` | Members | Show the open groups |
| `!lfg config` | Managers | Show the settings |
| `!lfg config on\|off` | Managers | Turn the feature on or off |
| `!lfg config channel #channel`, `!lfg config generator #generator\|none` | Managers | Choose the group channel and the voice generator |
| `!lfg config expiry <10-1440>`, `size <2-25>`, `hosting <1-5>`, `open <1-50>` | Managers | Minutes a group stays open, the largest group size, open groups per host and open groups per server |

Managers are the server owner and members with Administrator or Manage Server, read fresh from Fluxer. Member commands pause at DEFCON 2 like other member commands. Activities have 1 to 50 characters and notes up to 200, each on one line. An activity with spaces needs quotes

| Setting | Default | Range |
| --- | --- | --- |
| Minutes a group stays open | 60 | 10 to 1440 |
| Largest group size, counting the host | 10 | 2 to 25 |
| Open groups one member hosts | 1 | 1 to 5 |
| Open groups per server | 20 | 1 to 50 |

- A group with a start time stays open that many minutes after it, otherwise after it was posted. When its time runs out, NeonFlux closes it and marks its card. Expiry runs through the work dispatcher, so open groups cost no backend calls until one is due
- When the last free place is taken, the group starts on its own. NeonFlux creates a voice room named after the activity in the generator's category, with its member limit and region, gives NeonFlux and every member View Channel and Connect like `!voice allow`, hides the room from everyone else like `!voice hide` and mentions the members once in the group channel. The card then links the room
- The room is the host's temporary voice room, so the host controls it with the `!voice` room commands, such as `!voice show` to open it to everyone. A host who already owns a room keeps it, and NeonFlux gives the group access to that room instead
- A group room waits 10 minutes for its first member, since the group is called in by a mention rather than moved in. After that it follows the [room deletion](#room-deletion) rules, so it is deleted once it has been empty for 45 seconds. A restart in those first 10 minutes shortens the wait to 45 seconds
- If the backend's answer to a start is lost, for example to a timeout, NeonFlux never sends the start again. It reads whether the backend recorded the new room. A recorded room stays, follows the rules above and the host is told that the group was not called in and the room was not limited to it. A room the backend did not record is deleted and the host is told to check `!lfg list` and start the group again if it is still open. If that read fails too, the room stays under the same deletion rules and the host is told the outcome is unknown. Only a start the backend refused deletes the new room at once
- Turning the feature off pauses posting, joining and starting. Leaving, cancelling and expiry continue
- Choosing a generator checks that it exists. If it is removed later, groups cannot start until a manager chooses another one. A group room counts toward the server's limit of 50 temporary voice rooms
- If NeonFlux cannot post a card, the group is cancelled and the reply names the fix. Cards and room access that NeonFlux cannot change are left as they are, and the reply names the fix for room access

| NeonFlux permission | Used for |
| --- | --- |
| View Channel and Send Messages in the group channel | Cards and the call to the room |
| Manage Channels | Creating group rooms |
| Manage Roles | Limiting group rooms to the group |

## Sticky messages, dashboard link and member list order

These commands work for the server owner and members with Administrator or Manage Server, read fresh from Fluxer like `!prefix`. DEFCON 2 treats them as staff commands. The dashboard has a section for each with the same settings, and chat and dashboard changes reach the dashboard's settings history

### Sticky messages

A sticky message keeps one bot message at the bottom of a channel. After members post, NeonFlux sends the text again and deletes the copy it sent before

| Command | Behavior |
| --- | --- |
| `!sticky add #channel "text"` | Add a sticky, or replace its text, and post it at once |
| `!sticky interval #channel <10-3600>` | Set the shortest time in seconds between reposts, 30 by default |
| `!sticky remove #channel` | Stop the sticky and delete its last copy |
| `!sticky list` | Show the stickies with their intervals |
| `!sticky help` | Show syntax |

- A server has at most five sticky channels. The channel must be a text or announcement channel where NeonFlux has View Channel and Send Messages. Text has 1 to 2000 characters, and mentions in it notify no one
- A member message reposts the sticky at once when its interval has passed since the last repost. Later messages within the interval lead to one more repost when the interval ends, so a busy channel gets at most one repost per interval. Messages from bots and webhooks, and messages in the channel's threads, cause none
- NeonFlux deletes only copies it posted. A copy already deleted by someone else counts as deleted
- Reposts of one channel run one at a time, and the backend records a new copy only while the sticky still names the copy it replaces. When two reposts race, or a change lands during a repost, the losing repost deletes its own new copy and the recorded one stays
- A send or record that fails may still leave a copy whose ID NeonFlux never learned, for example when Fluxer accepted the message but its answer timed out. Before the next repost, or when the sticky is removed, NeonFlux then reads the channel's 50 newest messages once and deletes its own messages whose text is exactly that sticky text. Members' messages and NeonFlux's other messages stay. A copy older than those 50 messages, or one left before a restart, can remain until someone deletes it
- The bot reads the server's stickies once when the server starts and keeps them in memory, and its own chat and dashboard changes update them, so messages cost no backend call. A repost costs one send, one delete and one backend call, plus one history read after a failed send or record. The bill guard pauses reposts like other optional work

### Dashboard link in the server sidebar

Fluxer link channels open an external address from the server sidebar. NeonFlux can keep one that opens the server's own dashboard page, `<website>/?server=<server ID>`, where `<website>` is `NEONFLUX_WEBSITE_URL`

| Command | Behavior |
| --- | --- |
| `!sidebar` | Show the link channel and the address it opens |
| `!sidebar add ["name"] [category-ID]` | Create the link channel, named `NeonFlux dashboard` unless you name it, at the top level or in the category |
| `!sidebar set "name"` | Rename the link and point it at the current website address |
| `!sidebar remove` | Delete the link channel |
| `!sidebar help` | Show syntax |

- Creating or changing the link needs `NEONFLUX_WEBSITE_URL` in the bot environment and Manage Channels for NeonFlux
- If the backend cannot record a new link, NeonFlux deletes the channel it just created
- Removal deletes the recorded channel only while it is still a link channel of the server. If someone deleted it by hand, `!sidebar` says so, and `!sidebar remove` clears the record
- The link is an ordinary channel, so everyone who can see it can open the address. The dashboard still checks each person's sign-in and permissions

### Member list order

Fluxer shows members grouped under their roles that are set to display separately, ordered by a display position kept apart from the role hierarchy. Changing it never changes permissions

| Command | Behavior |
| --- | --- |
| `!memberlist` | Show the roles shown separately, in member list order, top first |
| `!memberlist set @role @role...` | Set the whole order, top first, naming each of those roles once |
| `!memberlist move @role <position>` | Move one role, where 1 is the top |
| `!memberlist reset` | Clear every display position, so the member list follows the role hierarchy again |
| `!memberlist help` | Show syntax |

- Changing the order also needs Manage Roles or Administrator, and NeonFlux needs Manage Roles
- Fluxer lets NeonFlux move only roles below its own top role, and NeonFlux moves only roles below your top role too, unless you own the server. Roles that cannot move keep their display position, and NeonFlux places the others around them. When there is no room between two roles that cannot move, NeonFlux refuses and names them. Reset the order first, or change those roles in Fluxer
- Only roles whose place changes get a new display position, and roles already in order keep theirs
- Reset clears the positions of all roles, including roles above yours, so it needs the server owner or an Administrator
- The order is applied in Fluxer first and then recorded for the settings history. If the record fails, the reply says so and the new order stays. Fluxer applies an order role by role, so an interrupted change can leave part of it applied. Check `!memberlist` and set it again

## Server structure editor

The dashboard's [server structure](WEB.md#server-structure) section has no chat command. The bot answers its requests through the same dashboard worker as the permission check, with its own token and never the manager's sign-in:

- A read lists the categories and channels the manager can view, in Fluxer's order by position, with Manage Channels for each, and the server's active threads in those channels. Private threads are listed only where the manager has Manage Threads. It costs one read each of the server, its roles, the manager, the bot's member, the channel list and the active threads
- Closed threads of one channel come from one read of its closed public threads, and of its closed private threads when the channel is a text channel and both the bot and the manager have Manage Threads there. These reads need Read Message History
- A save reads the server again for the manager and sends that read to the backend, which merges the draft with it and claims the save. Only a claimed save is written, so a save is never written twice. The bot renames channels one at a time and then sends every move in one reorder, after the sibling each move follows. A moved channel keeps its permission overwrites. Fluxer applies the moves in order and may refuse part of them, so after a refused reorder the bot reads the channels again and reports each move by where its channel is. A write that times out or returns an unusable answer is reported as having an unknown outcome and is not repeated. Writes stop 90 seconds after the claim
- The bot needs View Channel and Manage Channels in each channel it changes. A change in a channel where it lacks them is not sent, and its outcome names the fix
- After the bot answers a read, the next channel created, changed, deleted or reordered in that server sends one request that tells every open editor of the server that its read is out of date. Further channel events send nothing until the next read. Channel events cost no backend request while no read is waiting for one, and a restart forgets the waiting read until the next one

## Forum help desk

The help desk serves forum or media channels that a manager picks. Each new post gets a short greeting, its author or staff close it with `!solved`, staff post saved answers with `!answer` and open a ticket for the author with `!escalate`, and an author whose post got no reply gets one reminder. A thread budget guard warns staff before the server reaches Fluxer's limit of 1,000 active threads. The dashboard's Help desk section under Community has the same settings and the saved answers, and chat and dashboard changes reach the settings history

| Command | Who | Behavior |
| --- | --- | --- |
| `!helpdesk` | Manager | Show the settings and the server's active thread count |
| `!helpdesk forum add\|remove #forum` | Manager | Choose the forum or media channels the help desk serves, up to 10 |
| `!helpdesk greeting "text"\|off` | Manager | The greeting on each new post, 1 to 500 characters |
| `!helpdesk tag "name"` | Manager | The forum tag `!solved` applies, `Solved` by default |
| `!helpdesk nudge <1-168>\|off` | Manager | Hours without a reply before the author gets one reminder, 24 by default |
| `!helpdesk guard #staff-channel\|off` | Manager | Warn staff in this channel near the thread limit |
| `!helpdesk archive on\|off` | Manager | Give threads their channel's default auto-archive time |
| `!solved` | Post author, staff | In a help post: Apply the solved tag and close the post |
| `!answer <name>` | Staff | Post a saved answer in this channel |
| `!answer list`, `!answer set <name> "title" "text"`, `!answer remove <name>` | Staff | Manage up to 50 saved answers |
| `!escalate <ticket-category>` | Ticket staff | In a help post: Open a ticket for the post's author |

Managers are the server owner and members with Administrator or Manage Server. Help desk staff also include members with Manage Threads, read in the command's channel. `!solved` is a member command, and DEFCON 2 treats the other commands as staff commands

- NeonFlux needs View Channel, Send Messages in Threads, Read Message History and Manage Threads in each help desk forum, and `!helpdesk forum add` names what is missing
- `!solved` needs a tag of the configured name in the post's forum, matched exactly or else without regard to case. Without one it names the fix: Add the tag in the forum's settings or choose another name. A post carries at most five tags, so a post that already has five keeps its first four beside the solved tag. NeonFlux replies first and then closes the post, because any message reopens a closed post, and a member reopens it the same way
- The greeting and the reminder record use the settings NeonFlux reads once when the server starts and keeps in memory, so posts and messages cost no backend read. Only a post just created in a help desk forum counts, not a thread NeonFlux merely joins. While reminders are on, each new post costs one backend call, which the bill guard pauses like other optional work
- When a post's wait has passed, NeonFlux reads the post and its 50 newest messages. It reminds the author, mentioning only them, unless the post is closed, locked or deleted or someone other than the author and bots wrote there, which includes staff commands. Each post gets at most one reminder, even when sending fails, and posts of a forum removed from the help desk get none
- Saved answer names use lowercase letters, digits, `-` and `_`, titles have 1 to 100 characters and text 1 to 2000. Mentions in answers notify no one
- `!escalate` creates the ticket through the same path as `!ticket submit`, in the category's channel setup and audience, with the post's author as the requester and no intake answers. The staff member must hold a support role of that category or be the owner or an Administrator, tickets must be on and the author can have at most three open tickets. NeonFlux checks the author's membership again right before it creates the channel, and the ticket's introduction links back to the post. The reply in the post mentions the author and links the ticket

### Thread budget guard

Fluxer allows 1,000 active threads per server, and forum posts are threads. While a warnings channel is set or auto-archive is on, NeonFlux reads the server's active threads once an hour. At 900 or more it warns the warnings channel, at most once a day. The count covers the threads NeonFlux can see

Fluxer stores a default auto-archive time on text, announcement, forum and media channels but does not apply it, so a new thread gets three days unless its creator chose another time. With `!helpdesk archive on`, each hourly pass gives up to 25 threads their channel's stored default, and passes run ten minutes apart while more remain. A changed thread starts its inactivity period again, pinned posts keep their time, channels without a stored default are left alone and NeonFlux needs Manage Threads. The pass stops when Fluxer refuses the permission, and `!health` names it

## Showcases and profiles

Members share what they made and describe themselves on the [website](WEB.md#member-showcases-and-profiles). Both start off, and the server owner and members with Manage Server set them up in chat or in the dashboard

```text
!showcase channel #showcase
!showcase limit 3
!showcase on
!profile on
```

### Showcases

A member posts a showcase on the website with a title of up to 100 characters, text of up to 1,000 and up to 3 links. NeonFlux posts it as itself in the showcase channel, as an embed with the member's server nickname or username. The first HTTPS link to a PNG, JPEG, GIF or WebP image becomes the embed image, and NeonFlux never fetches it or hosts files. Members edit and delete their own showcases on the website: an edit changes the posted message, and a deletion deletes it

| Task | Command |
| --- | --- |
| List showcases, for everyone | `!showcase list [@member]` |
| Status, switch and help | `!showcase`, `!showcase on\|off`, `!showcase help` |
| Choose the channel | `!showcase channel #channel\|none` |
| Limit showcases per member | `!showcase limit <1-50>\|none` |
| Set the time between a member's showcases | `!showcase interval <30m, 2h or 1d>\|none`, from 1 minute to 7 days |
| Who may post | `!showcase access`, `!showcase access allow\|block\|unallow\|unblock role\|user <mentions or IDs>` |

`!showcase channel` checks that NeonFlux has View Channel, Send Messages and Embed Links there and names what it lacks. The limit counts showcases that still exist, and the wait counts from the member's newest showcase that still exists. Showcases already posted stay in their channel when the channel changes. The access lists work like the role picker's: A block always wins, and with no allowed roles or users every member who is not blocked may post

Each post goes through publishing as a tracked post, which `!publish status <post>` shows with its showcase number. NeonFlux checks the member's current roles, the switch, the access lists, the limits and the server's automod rules right before it posts, and needs DEFCON 3 and publishing on. A post or edit whose outcome Fluxer does not confirm is never sent again, and the member's request says so. Staff check it with `!publish reconcile <post>` or record it with `!publish resolve`. `!publish edit` and `!publish forget` refuse a showcase's post, so only its author changes it

### Profiles

A member's profile has a short bio of up to 300 characters, up to 3 links and an optional accent color, edited on the website. `!profile` shows your own profile and `!profile @member` someone else's, as an embed in the accent color

| Task | Command |
| --- | --- |
| Show a profile, for everyone | `!profile [@member]` |
| Status, switch and help | `!profile status`, `!profile on\|off`, `!profile help` |
| Set the time between a member's `!profile` commands | `!profile cooldown <1-3600 seconds, or 30s, 5m or 1h>\|none` |
| Who may use profiles | `!profile access`, `!profile access allow\|block\|unallow\|unblock role\|user <mentions or IDs>` |

The access lists decide who may save a profile, who may run `!profile` and whose profile it shows. The cooldown is kept in NeonFlux's memory, so a restart clears it

### Content safety

Before NeonFlux posts or edits a showcase, saves a profile or shows one, the server's enabled automod `words`, `domains`, `invites` and `deceptive-links` rules read the text and the links while automod is on, in dry run too. A match blocks it and the reply or the member's request names the rule. Exempt roles pass as they do for messages, and channel scopes apply to the showcase channel and the channel of `!profile`. Posts and replies notify nobody: NeonFlux sends no mentions and breaks up mention syntax, such as `@everyone`, so it does not render as a mention either

## Selective backup and additive restore

Only the current server Owner can use `!backup`, in a verified one-to-one DM with NeonFlux. Running it in the server returns only a private hint. Archives and reports stay private and suppress mentions

| Command | Behavior |
| --- | --- |
| `!backup help` | Show usage and key setup |
| `!backup export config xp structure` | Export only the categories you name |
| `!backup inspect` | Validate the attached encrypted `.nfb` archive and show its metadata |
| `!backup preview` | With an attached archive, show what a restore would do to the server as it is now, without changing anything. Without one, show the first page of the latest preview, 25 items each |
| `!backup preview next` | Show the next page of the latest preview |
| `!backup plan` | Make a 15-minute restore plan of creates, identical skips, conflicts and blocked items |
| `!backup confirm <planID> <planHash> <archiveDigest>` | Run up to 20 items of the reviewed plan |
| `!backup status [<planID> <planHash> <archiveDigest>]` | List plans or show one plan's items |
| `!backup reconcile <planID> <planHash> <archiveDigest>` | Recheck up to 20 created items with unknown results |
| `!backup forget <planID> <planHash> <archiveDigest>` | Drop a settled plan and keep what it created |

A preview reads the archive and the server fresh from Fluxer and runs the same decisions a plan makes, so it lists each item as would be created, skipped as identical, skipped as conflicting or blocked, with the reason, such as a missing permission, a role or channel that no longer exists or a full limit. It makes no plan and reserves nothing, and a restore checks every item again when it runs. NeonFlux keeps only the latest preview of the server and the DM message that carries its archive, so the owner can page it here and on the [dashboard](WEB.md#backup-preview), which asks NeonFlux to read that message and the server again. Deleting the message ends that. A preview names the reason when the archive cannot be read, when the restore refuses the archive as a whole and when the key is missing

Repeat the same confirmation until the plan finishes, within its 15-minute expiry. Restore only adds. It never overwrites or deletes records, changes existing channels, recreates roles, assigns rewards, moves members or lowers DEFCON. Existing values that conflict stay untouched. Restored automation stays disabled until you turn it on. A partly finished restore is not rolled back

- `config`: Authored settings for moderation, automod, responses, publishing drafts and templates, roles and unpublished panels, greetings, tickets, leveling, milestones, suggestions, cleanup, metadata logs and the event and schedule switches. Event and schedule definitions are excluded
- `xp`: Current-season XP for at most 1000 members. Restore creates missing profiles, skips identical ones and leaves conflicts. It assigns no reward roles
- `structure`: At most 100 categories, text, voice, forum and media channels with at most 500 permission overwrites. Names, parents, permissions, topic, NSFW, slowmode, bitrate and user limit are kept. Forum and media channels also keep their tags with name, moderation and emoji, default reaction, default auto-archive time, sort order, the setting that requires a tag on each post and, for forums, the layout. Threads and forum posts are not backed up, and other channel types are skipped. Missing categories are created first, with full permissions in the creation request, and a forum or media channel is created with its tags in one request. Permission overwrites may grant starting and answering posts and threads, which forums commonly allow. Backups made before forum support restore as before

Archives exclude credentials, AFK text, birthdays, votes, RSVPs, member data, ticket bodies, moderation notes, audit history and live state. This is not a full server, database or message backup. Export refuses an archive that would exceed restore limits, so every archive can be restored. Restore limits are 1 MiB per snapshot and 500 plan items

Set `NEONFLUX_BACKUP_KEY` in the bot environment to a base64 32-byte key that is independent of the bot and backend credentials. Without it, export, inspect, plan and new previews are disabled and other features keep working. NeonFlux never generates the key or sends it to Convex. Keep offline copies of the key and every archive, because a lost key makes its archives unreadable and a changed key makes older archives unreadable until the old key is restored. Archives use AES-256-GCM and are authenticated before parsing. Keys, URLs and file paths are never accepted in commands. Attachments stored on the platform are not durable backup storage

## Server export

`!export` sends the server's NeonFlux data as readable JSON that other bots can load: Every feature's settings, leveling XP and levels, moderation cases with their corrections and appeals. Text the owner erased with `!mod erase` stays out. It is separate from the encrypted backup above, which only restores into NeonFlux. [The export guide](EXPORT.md) documents every field of format version 1

| Command | Behavior |
| --- | --- |
| `!export` | Send this server's data as a JSON file in the DM |
| `!export help` | Show what the export holds |

Only the current server Owner can export, in a verified one-to-one DM with NeonFlux, because the file holds private moderation data. Running it in the server returns only a private hint, and anyone else gets no answer. NeonFlux reads the owner and the DM from Fluxer before it starts, at least every 45 seconds while it reads and right before it sends each file. An export larger than about 4 MiB arrives as several numbered files, each a complete file of the same format. The dashboard's [Server export](WEB.md#server-export) section offers the same export as a download. The server's audit log records each export, never its content

## Server analytics

NeonFlux counts server activity for the dashboard's Analytics section. It keeps counts only, never which member did what

| Command | Behavior |
| --- | --- |
| `!stats` | Show joins, leaves, newcomer checklist completions when there are any, messages, the top three channels and the three busiest UTC hours of the day for the last seven UTC days, including today |
| `!stats on` | Start counting for this server |
| `!stats off` | Stop counting for this server |
| `!stats help` | Show syntax |

Like `!prefix`, these commands work for the server owner and members with Administrator or Manage Server, and other members get a refusal. Analytics starts on. The dashboard has the same switch

- Member joins and leaves are counted per UTC day, and so are members who finish the [newcomer checklist](#newcomer-checklist)
- Messages are counted per channel and UTC hour. Only ordinary and reply messages from human members count, commands included. Bot, webhook and system messages are never counted
- Messages in a thread or forum post count under its parent channel. The bot learns parents from the channels it keeps and reads a channel it does not hold once, so an archived thread also counts under its parent. If that read fails, the thread's messages in that batch count under the thread itself, and the next batch reads it again

The bot adds counts in memory and sends them to the backend in one request per server at most every five minutes, or sooner once the counts fill one request of 500 hour and day buckets. A server with no activity causes no backend requests, and a server active all day sends about 288 requests a day. A larger batch is split. `!stats` sends the counts in memory before it reads the summary, so its reply is current. The dashboard receives new counts about every five minutes

Every request carries a batch number, and the backend applies each batch once. If the backend is unavailable or its reply is lost, the bot sends the same batch again every five minutes, and a batch the backend already saved is not counted twice. The bot drops a batch that could not be saved for a day, and a batch the backend refuses. On a normal shutdown the bot sends the open window. A crash or forced stop loses the counts not yet saved, which is at most the last five minutes while the backend is reachable

`!stats off` stops counting at once and drops counts not yet sent. When the dashboard turns analytics off, the backend stores nothing from the bot's next batch, and the bot then stops counting. While analytics is off, member activity makes the bot recheck the setting at most every ten minutes, so turning it on from the dashboard resumes counting within about ten minutes of activity. Turning analytics off keeps existing counts. Channel and hourly counts expire after 35 days and daily join and leave counts after 400 days

`!logs counters` is a separate metadata log report and is unchanged

## Your data

Any member can see, export and delete what NeonFlux stores about them. These commands work only in a one-to-one DM with the bot. They cover every server at once and take no `--server` selector

| Command | Behavior |
| --- | --- |
| `!mydata` | List what NeonFlux stores under your user ID, per server and feature, and what deletion keeps and why |
| `!mydata export [server ID]` | Send that data as a JSON file, for every server or for one |
| `!mydata delete <server ID>` | Show what deleting your data in that server removes and what it keeps |
| `!mydata delete <server ID> confirm` | Delete it. This cannot be undone |
| `!mydata help` | Show syntax |

Deletion removes your AFK status, custom command cooldowns, leveling XP with its message receipts and staff corrections, greeting records, rules acknowledgment, newcomer checklist completion, role picker role checks, birthday and anniversary enrollment, ticket drafts, event RSVPs, suggestion votes, your places in open groups, your closed suggestions, your showcase records and your profile with any profile save from the website that the bot has not handled yet. A seat you held goes to the next member on the event's waitlist, and suggestion cards update their vote counts. After deleting your rules acknowledgment, acknowledge the rules again before features that require it work for you. Deletion does not remove messages NeonFlux already sent, such as greetings, event cards, showcases or log entries. Delete a showcase on the website first to remove its message too

Some data stays because a rule needs it, and the reply says why:

- Moderation cases and appeals protect the server. They are kept for 180 days, and the server owner can erase a case's text
- Tickets are a support record shared with staff. A closed ticket's private content expires after the server's ticket retention, 30 days by default, and staff can erase it sooner
- The roles NeonFlux gave you stay recorded while you may hold them, because NeonFlux removes only roles it can prove it gave
- Your temporary voice room stays recorded while it exists
- A group you host stays while it is open, at most until its time runs out. Cancel it with `!lfg cancel`
- Birthday and anniversary posts already sent stay recorded until 30 days after posting, and the years you were celebrated stay for 400 days, so no year is celebrated twice
- An open suggestion stays while staff review it. Withdraw it with `!suggest withdraw`, then delete again
- A greeting that is being sent stays until it finishes
- Security records, such as spam detection counts, watchlist entries and verification links, keep their own expiry and are not listed

One request reads or deletes a bounded amount. An export of every server first searches each kind of data for the servers that hold yours, in up to 20 bounded backend calls, so a server is not missed because the `!mydata` listing counts only the first 50 rows of a kind. If that search has not finished, the export holds the servers it found and says that others are missing, and `!mydata export <server ID>` exports one of them. An export stops at 5,000 records and asks you to export the rest one server at a time, and a deletion that leaves more asks you to send the same command again. The server's managers see in the dashboard's audit log that you deleted data and from which features, never the data itself

## Multiple servers

Single mode is the default. Set `NEONFLUX_SERVER_ID` and leave `NEONFLUX_SERVER_MODE` unset or `single`, and the bot serves only that server

Multi mode runs NeonFlux as a public bot that serves every server it is in, with no server list or server limit. Remove `NEONFLUX_SERVER_ID`, set `NEONFLUX_SERVER_MODE=multi` in the bot and the [backend](BACKEND.md#multi-server-scope) and set both backend variables, which multi mode requires. The bot refuses to start when `NEONFLUX_SERVER_ID` or `NEONFLUX_SERVER_IDS` is set in multi mode

One bot token, process and backend serve every server. Each server has its own settings, queues and DEFCON level. Membership or permissions in one server grant nothing in another

### Add the bot to a server

Server owners and managers add NeonFlux from the dashboard's **Add NeonFlux to a server** link, shown only in multi mode. It opens Fluxer's bot authorization with the permission mask `9008677076954326`:

| Permission | Used for |
| --- | --- |
| View Channel, Send Messages, Embed Links, Read Message History | Commands, replies, panels, logs and ticket transcripts |
| Add Reactions | Reaction role and verification panels |
| Manage Messages | Delete and purge actions and message cleanup |
| Manage Channels | Tickets, slowmode, unlock, channel structure restore, temporary voice rooms, the dashboard link channel and the server structure editor |
| Manage Roles | Role panels, autorole, verification roles, ticket access, lock and unlock overwrites, temporary voice room access and the member list order |
| Connect, Move Members | Moving members into their temporary voice rooms |
| Update RTC Region | Fixed regions for temporary voice rooms |
| Kick Members, Ban Members, Moderate Members | Kicks, bans, timeouts, warnings and quarantine |
| View Audit Log | Audit entries in metadata logs |
| Change Nickname | Changing the bot's own nickname in that server |
| Send Messages in Threads, Create Public Threads, Create Private Threads | Channel locks and ticket closes, which deny these too, because Fluxer lets a bot deny only permissions it holds |

An owner can untick permissions when adding the bot. Channel locks and ticket closes then cover threads only for those thread permissions NeonFlux still holds

### Server registration

At startup the bot reads the backend's scope, then compares the backend's active installations with the servers its token is in. It registers servers that are missing, records the removal of servers it left while offline and starts the server runtimes four at a time. Startup stops when either list cannot be read

When the bot joins a server, it registers the server with the backend and starts that server's runtime. Repeated join notifications after a reconnect change nothing. When the registration starts a new installation, NeonFlux posts one short note that says what it is and names `!help`, `!setup` and the dashboard link when `NEONFLUX_WEBSITE_URL` is set. It posts in the server's system channel when it may send there, otherwise in the first text channel it can send in, otherwise nowhere. A server added while the bot was offline gets the note at startup, and adding the bot again after a removal posts it again A server that becomes temporarily unavailable keeps its runtime. When the bot is removed from a server, it stops that runtime and records the removal. A removed server keeps its data for 30 days, and adding the bot again within that time restores it. After 30 days the backend deletes that server's data, as the [backend guide](BACKEND.md#server-data-after-removal) describes. A backend scope denial stops only that server's runtime

Events for a server whose runtime is still starting are held in arrival order and handled once it has started, so a restart with many servers neither stalls nor drops other servers' events. Holding an event does not occupy one of the eight event handler slots. Each server holds at most 100 events, and a fuller backlog drops that server's oldest held event, never another server's, and counts it among dropped events. Held events run under the same limit of eight at a time. Events from servers the bot does not serve are ignored

### Commands in DMs

Commands sent in a server apply to that server. In a one-to-one DM in multi mode, put `--server <serverId>` right after the command name:

```text
!backup --server 123 status
!ticket --server 123 help
```

Missing or repeated selectors and selectors for servers the bot does not serve are rejected before any private data is read. The selection applies to one message only. DM replies start with `[Server <serverId>]`, and follow-up commands written by the bot include `--server`. [`!mydata`](#your-data) covers every server and takes no selector

The bot's presence shows only `NEONFLUX_CUSTOM_STATUS`, or nothing when it is unset, so no single server's DEFCON level or backend outage changes it
