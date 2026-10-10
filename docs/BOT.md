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
- Commands and actions, such as moderation, role changes, channel permission changes and purges, read current server, role, member and channel data from Fluxer right before they act. A failed read denies the request
- Evaluating everyday activity, such as message protection, automod, custom responses, leveling, metadata logs and role panel reactions, uses copies of server, role, member and channel data that the bot keeps in memory, and reads Fluxer only for what it lacks. Gateway events keep the copies current. A server's first message after startup costs about five reads, and later ordinary messages cost none. The bot forgets a server's copies when its gateway connection drops, when the server becomes unavailable or available again, after a category or bulk channel change and when a limit is reached. It keeps up to 5,000 servers, 20,000 members, the role lists of 1,000 servers and 20,000 channels and threads
- A message in a thread or forum post counts as in its parent channel for channel rules: automod channels and exemptions, honeypot channels, custom response channels, leveling's excluded channels and metadata logs' message and excluded channels. A rule that lists the thread itself also matches. The bot learns a thread's parent from thread events and the channels it keeps, or otherwise from one channel read
- The bot never automatically repeats a native action whose outcome is unknown. Such work stays visible as uncertain, and status or reconcile commands read the exact known message or member without resending
- Durable worker state, such as greeting, schedule and cleanup queues, lives in the backend. Workers resume it after a restart
- Each gateway session asks Fluxer not to send event types the bot does not handle, such as typing notices and presence updates, so they cost no bandwidth or decoding
- A message update that only adds or changes link previews or other embeds is ignored. The bot remembers the edit time, pin status and flags of the last 10,000 messages it saw, and an update that changes any of them, or concerns an older message, still reaches automod, security and metadata logs
- Background workers for dashboard changes, web verification, events, scheduled posts, birthdays and anniversaries, suggestion cards, message cleanup, metadata logs and level rewards run only when the backend reports due work for their server, so a server without due work causes no backend requests. One dispatcher for the whole bot asks the backend at startup, at once when the website queues work or a web verification is solved, when work the bot's own requests created becomes due and at the next due time the backend names. Without any of these it still asks every two minutes. It asks at most once every three seconds, so new work usually starts within a few seconds. If the backend cannot answer, the dispatcher waits 10 seconds and then twice as long after each failure, up to five minutes

### Optional work limits and the bill guard

Some per-message work is optional, so one very busy server cannot take a large share of the backend calls every server shares. Each server has its own token buckets: It may spend a burst at once, then the refill rate. A message over the limit skips that work only

| Work | Backend calls per message | Burst | Refill |
| --- | --- | --- | --- |
| AFK: clearing the author's status and naming AFK members a message mentions | One | 30 | 60 a minute |
| Custom autoresponder and command evaluation | One, or two when a definition needs the member's roles | 30 | 60 a minute |
| Message XP credits | Up to two | 30 | 60 a minute |
| Analytics counting | None, counts leave in batches | No limit | No limit |

Moderation, automod, security, join protection, DEFCON, commands, including `!afk`, and background workers are never limited

The [bill guard](BACKEND.md#bill-guard) adds a monthly budget of backend calls, set in the Convex deployment. The bot reports its calls every five minutes, and the answer tells it the guard's state. At the warning share the bot logs one warning a month. At 90 percent of the budget the bot pauses all four kinds of optional work in every server until the month rolls over in UTC or the budget is raised, and logs when it pauses and resumes. Moderation and everything else listed above keeps running

## Help, setup and health

| Command | Behavior |
| --- | --- |
| `!help` | List the commands you can use, by feature |
| `!help <feature>` | Show one feature's commands and their forms, such as `!help moderation`. A command name, such as `!help mod`, opens its feature |
| `@NeonFlux help` | The same as `!help`, for members who do not know the prefix. Add a feature after `help` to open it |
| `!setup` | Show each feature as on, off or needing setup, with the next step for each one that is not on |
| `!health` | Check that the backend answers, the gateway state, the permissions NeonFlux lacks for each enabled feature and the roles it assigns that rank at or above its own role |

Help lists a command when your server permissions open it. Everyone sees member commands. Members with Kick Members, Ban Members, Moderate Members, Manage Messages or Manage Channels also see the staff commands, whose staff roles are still checked when they run. Manage Server opens `!setup`, `!health` and `!stats`, and the server owner and Administrators see every command. Help prints the server's prefix and splits long lists so each reply fits one message. `!setup` and `!health` are for the server owner and members with Manage Server or Administrator

A prefixed word that is not a command and is close to one gets one reply, such as `Did you mean !help?`. Close means one changed, added or removed letter for names of up to four letters and two for longer names, and two swapped neighboring letters count as one. Other text after the prefix gets no reply, and a custom command of that name is never treated as unknown

`!health` names the fix for each problem, such as `Moderation: Grant Kick Members and Ban Members to the NeonFlux role` or `Autorole: Move the NeonFlux role above @Member`. It checks the bot's server-wide permissions, so a channel override that denies NeonFlux in one channel is not reported. Roles it checks are those autorole, reservations, reaction and verification panels, the role picker and level rewards assign. The dashboard's overview shows the same check, see [the dashboard guide](WEB.md#dashboard)

When a moderation action, a role panel, autorole, verification or role picker change, a ticket creation or a temporary voice room change fails because of NeonFlux's permissions or role position, the reply names the fix the same way. A moderation action against a member whose highest role is not below yours says so too

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
| Inspect or list | `!custom show rules`, `!custom list 1` |
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

Reasons are limited to 512 code units and appeal text to 2000. Durations are a whole number followed by `s`, `m`, `h` or `d`

### Moderation and cases

| Task | Command |
| --- | --- |
| Warn and send a private notice | `!mod warn @user "reason"` |
| Kick, ban or unban | `!mod kick\|ban\|unban @user "reason"` |
| Ban temporarily | `!mod ban @user 1d "reason"` |
| Time out or remove a timeout | `!mod timeout @user 10m "reason"`, `!mod untimeout @user "reason"` |
| Delete up to 100 recent messages | `!mod purge 20 [@user] "reason"` |
| Set slowmode, 0 to clear | `!mod slowmode #channel 10 "reason"` |
| Turn manual sanctions on or off, or inspect | `!mod module on\|off`, `!mod status` |
| Erase one case's narratives (owner) | `!mod erase <case>` |
| List or show cases | `!case list [@user or user <ID>] [before-case]`, `!case show <case>` |
| Correct a reason or void a warning | `!case reason <case> "new reason"`, `!case void <case>` |
| Check an action with an unknown outcome | `!case recover <case>` |
| Set the staff log channel | `!logs channel #channel\|off` |
| Inspect staff log delivery | `!logs status`, `!logs list [before-case]`, `!logs show <case>`, `!logs recover <case>` |

Timeouts allow up to one year, temporary bans one minute to two years and slowmode 0 to 21600 seconds. Append `case <case-number>` to a sanction or reversal to link it to an earlier case. Case lists page with the `Next` command they print

Case details, watchlist reasons and appeal text are sent to the reader's DM after a fresh permission check. A server channel gets only an acknowledgement. Staff logs contain action, actor, target and outcome, without private reasons. A warning stands even if its private notice cannot be delivered

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
| List or show rules | `!automod list [page]`, `!automod show <name>` |
| Change a setting | `!automod update <name> action\|threshold\|window\|duration\|priority\|domain-mode <value>` |
| Replace patterns | `!automod update <name> patterns "first" "second"` or `patterns none` |
| Set scope or exemptions | `!automod update <name> channels\|exempt-channels\|exempt-roles <mentions or IDs>...\|all` |
| Enable, disable or delete a rule | `!automod enable\|disable\|delete <name>` |
| Change the module or mode | `!automod module on\|off`, `!automod mode dry-run\|enforce`, `!automod status` |

Rule types are `spam`, `repeat`, `mentions`, `words`, `domains` and `invites`. Actions are `log`, `delete`, `warn` and `timeout`. Spam defaults to 5 messages in 10 seconds, repeat to 3 in 30 seconds and mentions to 5. Thresholds allow 1 to 100, windows 1 to 300 seconds and priority -100 to 100. Each rule holds up to 20 patterns of up to 200 code units and 20 IDs per scope

Patterns are literal text, not scripts or regular expressions. Domain `block` mode matches listed hosts and their subdomains, and `allow` mode flags any other host. The bot never visits a URL. Staff and exempt roles and channels are never sanctioned. A message gets at most one automated sanction across automod and security

### Security

Security starts disabled in `dry-run` mode. Join-burst detection, honeypot channels and the watchlist each need their own switch as well as the security module. They use events seen on the server, not an outside reputation service

| Task | Command |
| --- | --- |
| Quarantine or release a member | `!security quarantine @user 10m "reason"`, `!security release @user "reason"` |
| Lock or unlock a channel | `!security lock\|unlock #channel "reason"` |
| Configure join bursts | `!security joins threshold <2-100>`, `window <1-300 seconds>`, `module on\|off`, `raid-mode off\|defcon2` |
| Manage the watchlist | `!security watchlist add\|update @user "reason"`, `show\|remove @user`, `list [page]`, `module on\|off` |
| Manage honeypot channels | `!security honeypot add\|remove #channel`, `list`, `module on\|off` |
| Inspect open recovery | `!security recovery list [page]`, `!security recover <case>` |
| Configure the module | `!security module on\|off`, `!security mode dry-run\|enforce`, `!security status` |

Join bursts, honeypot posts and watchlist joins create cases classified as `join-burst`, `honeypot` or `watchlist`. Review them with `!case`

Quarantine is a native timeout. A longer existing timeout is kept. Lock changes only the everyone role's Send Messages, Send Messages in Threads, Create Public Threads and Create Private Threads permissions in that channel, so members can neither post in the channel or its threads nor start new threads. Fluxer lets a bot stop denying only permissions it holds, so a lock denies only the thread permissions NeonFlux holds server-wide, and its reply names any that stay open. Unlock restores exactly the permissions its lock changed, as they were, and keeps unrelated later changes. A lock made before thread support covers Send Messages only, and its unlock restores only that. Other role or member grants can still let people speak. A thread has no permissions of its own, so locking or unlocking a thread replies with its parent channel to lock instead

### DEFCON

| Level | Behavior |
| --- | --- |
| 3 | Normal operation |
| 2 | Staff commands and private appeals only. Public commands are blocked |
| 1 | Only critical owner or Administrator controls |

Use `!defcon status`, `!defcon diagnose` and `!defcon set 1|2|3`. Critical controls include status, diagnosis, DEFCON changes, disabling protections, recovery checks, unlock, release, untimeout and unban. Join bursts can raise the level to 2 when `raid-mode defcon2` is set, never to 1. DEFCON does not change channel permissions. In single mode the bot shows the level in its presence and restores it at startup

### Appeals

Members send `!appeal` commands in a one-to-one DM with the bot. Server membership is not required, so banned users can appeal when Fluxer delivers the DM

```text
!appeal cases
!appeal submit 12 "Please review this case"
!appeal list
!appeal show 3
!appeal withdraw 3
```

Each case accepts one open appeal per user. Staff use `!appeals list [page]`, `show <appeal>` and `approve|reject <appeal> "reason"`. Details and decisions are sent privately. Owners and Administrators use `!appeals module on|off`. Approving an appeal does not reverse the sanction, so staff reverse it separately

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
| Create, show, delete or preview | `!publish create\|show\|delete\|preview <name>`, `!publish list [page]` |
| Copy a draft | `!publish clone <name> <new-name>` |
| Work with templates | Put `template` after `!publish`, for example `!publish template create welcome` |
| Copy a template into a draft | `!publish template clone <name> <new-name> draft` |
| Set text | `!publish set <name> content\|title\|description\|url\|timestamp "value"`, `color #RRGGBB` |
| Set author and footer | `!publish set <name> author "name" ["URL"\|none] ["icon URL"\|none]`, `footer "text" ["icon URL"]` |
| Set media | `!publish set <name> image\|thumbnail "URL" ["description"]` |
| Manage fields | `!publish field <name> add "name" "value" [on\|off]`, `set <1-25> ...`, `remove <1-25>` |
| Clear parts | `!publish clear <name> content\|embed\|title\|description\|url\|color\|timestamp\|author\|footer\|image\|thumbnail\|fields` |
| Inspect posts | `!publish posts [before-post]`, `!publish status <post-number>` |
| Check a post with an unknown outcome | `!publish reconcile <post-number>` |
| Record a post's outcome by hand | `!publish resolve <post-number> sent <message-id>`, `!publish resolve <post-number> failed` |
| Stop tracking a post | `!publish forget <post-number>` |
| Configure | `!publish module on\|off`, `!publish status` |

A message has up to 2000 code units of content and one embed with up to 25 fields and 6000 code units of embed text. URLs must use HTTP or HTTPS and fit in 2048 code units. The bot does not fetch media or upload files

When a send or edit has an unknown outcome, `reconcile` reads the known message, or staff use `resolve` to record what happened. Edit and forget work again once the outcome is known. Deleting a draft or forgetting a post never deletes the message. Attempt history is kept for 180 days. Publishing starts enabled. DEFCON 2 still allows Administrators to publish, and DEFCON 1 allows only disabling, status and reconcile

### Scheduled publishing

Owners and Administrators plan finite announcements with `!publish schedule`. Schedules and the scheduling module start disabled. A schedule copies the selected draft or template revision, so later edits to the source do not change it

```text
!publish show notice
!publish schedule create news draft notice 3 #announcements 2026-11-01T18:00 Europe/Berlin reject weekly 1 3
!publish schedule module on 1
!publish schedule enable 1 1
!publish schedule status 1
```

| Task | Command |
| --- | --- |
| Create | `!publish schedule create <name> draft\|template <source-name> <source-revision> #channel YYYY-MM-DDTHH:mm IANA/Zone reject\|earlier\|later [daily\|weekly <1-12 interval> <1-26 count>]` |
| Show or list | `!publish schedule show <schedule>`, `list [before-schedule-number]` |
| Inspect settings or deliveries | `!publish schedule status [schedule [after-occurrence-number]]` |
| Replace content | `!publish schedule update <schedule> <management-revision> content draft\|template <source-name> <source-revision>` |
| Replace time | `!publish schedule update <schedule> <management-revision> time YYYY-MM-DDTHH:mm IANA/Zone reject\|earlier\|later [daily\|weekly <interval> <count>]` |
| Change destination | `!publish schedule update <schedule> <management-revision> destination #channel` |
| Enable, pause or cancel | `!publish schedule enable\|disable\|cancel <schedule> <management-revision>` |
| Check a known post | `!publish schedule reconcile <schedule> <management-revision> <tracked-post-number>` |
| Forget settled deliveries | `!publish schedule forget <schedule> <management-revision> [occurrence-number ...] [confirm]` |
| Turn the module on or off | `!publish schedule module on\|off <settings-revision>` |

`show` and `status` print the current revisions. Dates must be in the future within 180 days, and a whole schedule spans at most 180 days. A local time that does not exist is rejected, and a repeated time needs `earlier` or `later`

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
| Show or list panels | `!roles show <name>`, `!roles list [page]` |
| Require or exclude roles | `!roles requires\|excludes <name> <emoji> @roles...\|none` |
| Change a mapping or mode | `!roles unmap <name> <emoji>`, `!roles mode <name> toggle\|exclusive` |
| Enable, disable or delete | `!roles enable\|disable\|delete <name>` |
| Retire a published panel | `!roles retire <name> [published-revision]`, then `!roles next <withdrawal-id>` |
| Inspect history | `!roles history <name> [cursor]` |
| Process a cleared reaction set | `!roles reactions <name>`, `!roles jobs`, `!roles resume <job-id>` |
| Check or withdraw a member's roles | `!roles reconcile\|withdraw <name> [@user] [cursor]` |
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

A member reacts to the rules panel or sends `!verify`. With advanced verification turned on in the dashboard, the bot instead sends a private link to the [web verification](WEB.md#web-verification) flow. `!verify status` shows whether the acknowledgement was saved and the role granted. Administrators use `!verify review <request-id>` to help a member who cannot complete the web challenge, and `!verify reconcile|withdraw [@user] [cursor]`, `retire` and `next` for recovery

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

A reservation gives an exact user ID extra roles when that user joins or rejoins, even before they are a member. Use `!autorole reserve <user-id> @roles...`, `!autorole unreserve <user-id>` and `!autorole reservations`, or the dashboard. Up to 100 users can have one to 20 reserved roles. Saving does not grant roles to current members, and removing a reservation does not take roles away. Recovery uses `!autorole retire [settings-revision]`, `next`, `history [cursor]` and `reconcile|withdraw @user [cursor]`

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

Each of `!welcome`, `!welcome dm` and `!goodbye` supports `configure`, `module on|off`, `clear`, `preview`, `show`, `status [delivery-number]`, `history [before-delivery]`, `member @user` and `help`. `!welcome rate <1-60>` sets the shared sending pace per minute, default 10, and `!welcome retention <30-3650>` sets how many days delivery history is kept, default 30

- Placeholders are `{user.name}`, `{user.mention}`, `{user.id}`, `{server.name}`, `{server.id}` and `{channel.id}`. `{user.mention}` can notify only the greeted member, and `{channel.id}` works only in channel routes
- Welcome and DM routes need `join` or `verified` timing. `verified` waits until the member completed rules verification and holds the access role
- Enabling a route does not greet existing members, and a join is greeted only within 15 minutes
- Goodbye is sent when a member leaves, including members who joined before the bot started tracking. The bot cannot tell whether a departure was voluntary, a kick or a ban
- Preview sends a sample for the invoking staff member in the current channel
- A delivery with an unknown outcome is never resent
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

Staff work in the ticket's own channel. Requesters can read their own tickets and ask to close or reopen them under the category policy

| Command | Who | Behavior |
| --- | --- | --- |
| `!ticket list [before-ticket]` | Staff, requester | List visible tickets with a continuation number |
| `!ticket status\|intake <ticket>` | Staff, requester | Show the state and last operation, or the private intake answers |
| `!ticket attempt <ticket> <attempt>` | Staff | Show metadata for one numbered operation attempt |
| `!ticket claim\|unclaim <ticket>` | Staff | Take or release the ticket |
| `!ticket priority <ticket> low\|normal\|high\|urgent` | Staff | Set priority |
| `!ticket reply <ticket> "text"` or `canned <name>` | Staff | Post a reply in the ticket channel |
| `!ticket note <ticket> add "text"` or `list [before-entry]` | Staff | Private staff notes, kept apart from intake and channel history |
| `!ticket close\|reopen <ticket>` | Staff, requester | Remove or restore send access |
| `!ticket reconcile <ticket>` | Staff | Recheck a partial close, reopen or create against the live channel |
| `!ticket transcript <ticket> capture [1..500]` | Staff | Store a transcript of up to 500 recent messages |
| `!ticket transcript <ticket> list [before-transcript]` | Staff | List stored transcripts |
| `!ticket transcript <ticket> show <transcript> [page]` | Staff | Read a transcript in 1500-character pages |
| `!ticket delete <ticket> confirm` | Owner, Administrator | Delete the closed ticket channel and release it |
| `!ticket erase <ticket> confirm` | Owner, Administrator | Erase stored intake, notes and transcripts |
| `!ticket abandon <ticket>` | Owner, Administrator | Release the requester's slot after a channel creation whose result stayed unknown |

Creation sets the full conversation audience in the first channel request, and the introduction contains metadata only with mentions disabled. Close removes send access for everyone and the requester, including sending in the ticket's threads and starting new ones, as far as NeonFlux holds those thread permissions server-wide. Reopen restores the recorded permissions and leaves unrelated ones untouched. A ticket closed before thread support reopens its send access only. Another role or member allowed to send or post in threads blocks closing until staff remove that grant. Staff keep send access, and Administrator permission still bypasses these overwrites. Renaming or moving a ticket channel does not block replies, close, reopen or delete

If close, reopen or creation is interrupted, the ticket stays unresolved until `!ticket reconcile` confirms the live state. NeonFlux never retries an operation with an unknown result or searches for a channel by name. After `!ticket abandon`, check the server for a leftover channel yourself. Erasing such a ticket also releases the slot but keeps protection for a channel that might exist

Private bodies require current server membership, the ticket's recorded requester and support-role access and native view and history permission. A requester who rejoins with the same account regains access. Deleting a channel needs explicit confirmation, a successful delete response and a fresh check that the channel is gone

Closed ticket bodies expire after 30 days by default, configurable from 1 through 365 days. Reopen is unavailable after expiry or erasure. Erasure removes stored copies only and never deletes messages already sent. Body retention never deletes native channels

Transcript capture is explicit and incomplete by design. Each stored message keeps at most 2000 characters of text with its author and timestamps. Attachment URLs and embed bodies are left out, and a capture that exceeds the storage budget is truncated with a notice. A failed capture stores nothing. Each ticket keeps at most 20 transcripts and 200 note entries. To share a public summary, write a separate publishing draft, because private content is never copied automatically

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
| `!level correct @user <0-100000000 XP> "reason"` | Set an absolute XP value with an audit entry |
| `!level reset member @user "reason" [confirm]` | Preview, then reset one member |
| `!level reset server "reason" [confirm]` | Preview, then start a new season for everyone |
| `!level status` | Show pending and blocked reward work |
| `!level reconcile [@user]` | Queue a reward check for the server or one member |
| `!level audit [before-audit-number]` | Read correction and reset audits |
| `!rank [@user or user ID]` | Show XP, level and rank |
| `!leaderboard [next-page cursor]` | Show 20 rows ordered by XP |

Corrections apply in the order their commands were sent, so an older correction that arrives late is rejected. Copy the next-page command from a leaderboard reply to continue. Rows can shift between pages while XP is awarded, and a server reset invalidates older cursors. Rank is exact for every member, except when more than 100 members of the same level have more XP, where the card shows the range of positions that level allows, such as `#3102 to #3400`. Right after an update, until the backend has counted a server's existing profiles, rank is exact within the top 1000 and reported as outside the top 1000 beyond it. Members with zero XP are unranked

XP comes only from human ordinary or reply messages in the configured server that pass existing protection and command gates. Bots, system messages, webhooks, DMs, edits, prefix commands and empty text earn nothing. Duplicate text within ten minutes earns nothing. Candidates wait in a memory queue of at most 1000 accounts, so a busy server or a restart can drop some awards. NeonFlux does not promise XP for every eligible message

Leveling never stores message text, display names or avatars. It keeps account and message IDs, timestamps and a keyed digest for duplicate detection, retained for ten minutes. Correction and reset audits keep actor, target, XP before and after, reason and time for 180 days

Reward roles are cumulative and use the shared safe-role checks, so NeonFlux needs Manage Roles and a role above each reward. Collection itself does not need Manage Roles. Awards, corrections, resets and mapping changes mark an account for a reward pass, and a failed role change keeps the account marked for a later pass without blocking other roles. Turning leveling off keeps existing rewards, while clearing mappings, resets and demotions still remove rewards NeonFlux granted. A server reset hides old scores at once. A rejoining member keeps XP but must earn role ownership again through a new message or `!level reconcile @user`. NeonFlux removes only roles it granted and confirmed, and preserves roles granted any other way

## Events and RSVPs

Events start disabled and use `!event`. Owners and Administrators manage definitions. Current members read published events and RSVP in the event's destination channel, and `!events` lists them. Replies and attendee lists suppress mentions and show account IDs. DMs cannot run event commands

Management commands take the current revision shown by `!event status` or `!event show <event>`. A new event follows this flow, with your own channel, date and zone

```text
!event create study #channel "Study group" "Bring your questions"
!event time 1 1 2026-11-01T18:00 Europe/Berlin 60 reject
!event repeat 1 2 weekly 1 4
!event dates 1
!event module on 1
!event publish 1 3
```

| Command | Behavior |
| --- | --- |
| `!event list [before-event-number]` | List events in this destination |
| `!event show <event>` | Read one event and its revision |
| `!event dates <event> [after-occurrence-number]` | List occurrences with zone, offset and UTC times |
| `!event attendees <event> <occurrence> [after-user-ID]` | List attendees and the waitlist |
| `!event rsvp <event> <occurrence> going\|maybe\|not-going\|none` | Set or clear your RSVP |
| `!event time <event> <revision> YYYY-MM-DDTHH:mm <IANA zone> <1-10080 minutes> [reject\|earlier\|later]` | Set the first occurrence |
| `!event repeat <event> <revision> off\|daily\|weekly <1-12 interval> <1-26 total>` | Set repetition |
| `!event title <event> <revision> "title" ["description"]` | Change the text |
| `!event template <event> <revision> <template> <template-revision>\|off` | Use a publishing template snapshot |
| `!event capacity <event> <revision> off\|1-500` | Limit Going seats |
| `!event reminders <event> <revision> off\|<minutes> [minutes]` | Set up to two reminder offsets, 1 to 10080 minutes |
| `!event publish\|cancel <event> <revision>` | Publish the card or cancel the event |
| `!event status [event [1-26 page]]` | Show module, card and reminder outcomes |
| `!event reconcile <event> <revision> [tracked-post-number]` | Recheck a known card or reminder message |
| `!event forget <event> <revision> [confirm]` | Remove settled event data in pages |
| `!event module on\|off <settings-revision>` | Turn the module on or off |

Going takes a seat or the next waitlist place. Repeating Going keeps your place, and withdrawing then choosing Going again joins the end of the waitlist. Maybe, Not going and None use no seat. RSVPs close at start or cancellation. Waitlisted members are promoted only while they are still members with access and pass verification, timeout and quarantine checks. Members who leave lose their seat

Times use an exact local minute and an IANA zone. Repeats allow at most 26 occurrences within 180 days, and wall-clock times hold across offset changes. Nonexistent local minutes are rejected, and repeated minutes are rejected unless you choose `earlier` or `later`. Once anyone has RSVPed, the calendar cannot change. Cancel the event and create a new one instead. Capacity cannot drop below confirmed Going attendance

Each event has one protected publishing card that follows publishing limits. Event changes edit the card, and RSVPs do not. `!publish` cannot edit or forget event cards. Reminders default to 1440 and 60 minutes before start, are skipped if already past due on activation and must send before the event starts. Automatic cards and reminders send as NeonFlux and need its channel permissions, the module and publishing switches and a DEFCON level that allows them. DEFCON 2 pauses automatic sends and public RSVPs. Cancellation and disable never delete posted messages. A send with an unknown result is never repeated, so use `!event status` and `!event reconcile` to recover it

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

Owners and Administrators configure each route from a publishing template revision. Templates can use `{user}` and `{server}`, plus `{years}` for anniversaries. Birthday posts never show the date or an age. All milestone replies and previews are private, and posts suppress mentions

| Command | Behavior |
| --- | --- |
| `!milestone status [birthday\|anniversary [quoted-cursor]]` | Show configuration and limits, or delivery history for one route |
| `!milestone configure birthday\|anniversary <route-revision> #channel <IANA zone> HH:mm earlier\|later\|reject template <name> <revision>` | Set a route. Use revision `0` the first time |
| `!milestone preview birthday\|anniversary` | Preview the post privately |
| `!milestone enable\|disable\|clear birthday\|anniversary <route-revision>` | Control one route |
| `!milestone module on\|off <settings-revision>` | Turn the module on or off |
| `!milestone reconcile birthday\|anniversary <post>` | Recheck one known post |
| `!milestone forget birthday\|anniversary <settled-post> [confirm]` | Drop settled tracking without deleting the post |

Posts go out at the configured local time in the server's zone. February 29 celebrates on February 28 in other years. Anniversaries count completed years from one. A late delivery still sends until local midnight, and a missed day does not use up that year's birthday. Enrolling skips a celebration already due. Automatic posts send as NeonFlux and need its channel permissions, the module and publishing switches and DEFCON allowance. Leaving the server ends consent. The bot checks consent when a member leaves or rejoins and again before each post, not on other member updates such as role or nickname changes

Removal deletes the enrollment and stored date. Posts already sent stay. A server allows at most 1000 enrolled accounts and 4000 retained deliveries. Settled tracking expires after 30 days, and a body-free record of each delivered year lasts 400 days so re-enrolling cannot repeat it

## Suggestions and voting

Owners and Administrators set up the disabled module with `!suggest configure <settings-revision> #channel`, enable it with `!suggest enable <settings-revision>` and inspect it with `!suggest settings`. Members use the other commands in the configured destination

| Command | Who | Behavior |
| --- | --- | --- |
| `!suggest submit "text"` | Member | Post a suggestion of at most 2000 characters |
| `!suggest show <number>` | Member | Read text, author, state, counts and card status |
| `!suggest list [state] [cursor]` | Member | List up to ten suggestions |
| `!suggest vote <number> up\|down\|clear` | Member | Set, change or clear your vote |
| `!suggest mine <number>` | Member | See your own vote |
| `!suggest withdraw <number> <revision> confirm` | Author | Withdraw permanently |
| `!suggest status <number> <revision> under-review\|planned\|completed\|declined "reason"` | Staff | Change state with a public reason of at most 500 characters |
| `!suggest publication <number>` | Staff | Show card delivery state |
| `!suggest reconcile\|replace <number> <revision> <card-generation> confirm` | Staff | Recheck a known card, or replace one confirmed missing |
| `!suggest forget <number> <revision> confirm` | Staff | Remove settled closed suggestion data in pages |
| `!suggest disable <settings-revision>` | Staff | Stop submissions, votes and cards and keep data |

Voting uses commands only, and reactions change nothing. Under-review and planned suggestions accept votes. Completed and declined ones close voting and can be reopened with a reason until they expire. Withdrawn suggestions stay closed. Only the latest status reason, actor and time are kept. Self-votes count, and votes stay after the voter leaves. Editing or deleting a command message does not change the recorded text or vote

Cards show author, state, vote totals and the latest reason with mentions suppressed. There is no public voter list, but database administrators can see voter IDs. Card updates are grouped for about five seconds and sent as NeonFlux, under its channel permissions, the module and publishing switches and DEFCON. A card can lag behind the recorded state. Check `!suggest publication` before recovery. A missing card needs explicit replacement, and `!publish` cannot edit or forget suggestion cards. Forgetting data never deletes posted cards

Limits are 1000 suggestions per server, 1000 voters per suggestion and 10000 vote records per server. Closed suggestions expire after 180 days

## Automatic message cleanup

Owners and Administrators use `!cleanup` to delete messages older than a chosen age in selected Text and Announcement channels. The module and every policy start disabled. Ages run from one hour through 365 days in whole minutes, hours or days, such as `60m`, `1h` or `30d`

| Command | Behavior |
| --- | --- |
| `!cleanup help` | Show syntax |
| `!cleanup configure #channel <revision, 0 for new> <age>` | Create or replace a channel policy |
| `!cleanup show\|preview #channel` | Show the policy, or check up to 50 older messages without deleting |
| `!cleanup list` | List up to 50 configured channels |
| `!cleanup status [#channel [before-target-number]]` | Show module status or up to 20 recent targets |
| `!cleanup enable #channel <revision> [confirm]` | Enable the policy, including existing old messages |
| `!cleanup disable #channel <revision>` | Stop new deletions and keep configuration |
| `!cleanup module on\|off <settings-revision>` | Turn the module on or off |
| `!cleanup exclude #channel <revision> author\|message add\|remove <id>` | Keep up to 50 authors and 100 messages |

Only human messages of ordinary or reply type that are unpinned, older than the cutoff and outside every exclusion and publishing or panel protection are deleted. Anything with unknown pin state, author, type or time is kept. Preview counts unknown messages as skipped. Replies contain metadata only and suppress mentions

Automatic deletion runs as NeonFlux under the server automation policy. It needs View Channel, Read Message History and Manage Messages, the module and policy switches and a DEFCON level that allows it. It does not depend on the Administrator who configured it. DEFCON 1 pauses new deletion. Each pass runs at startup and every 60 seconds and deletes at most five messages per channel and 20 overall. A deletion with an unknown result is never retried

Deletion has no server-side pin check, so a message pinned just before deletion can still be removed. Cleanup stores only IDs, authors, timestamps and outcomes, never message text or attachments. Settled records expire after 30 days

## Metadata logs

Owners and Administrators extend `!logs` with metadata logging. Existing moderation log commands keep their meaning. Configure in a server channel with the revisions from `!logs metadata status`. Status, counters, events and delivery reports arrive in a private DM, and these reads also work from a verified one-to-one DM

```text
!logs metadata help
!logs metadata status
!logs metadata module on|off <revision>
!logs metadata route <category> <revision> <channel> <owner> on|off
!logs metadata clear <category> <revision>
!logs metadata event <event> <configuration-revision> <channel> <owner> on
!logs metadata event <event> <configuration-revision> off
!logs metadata inherit <event> <configuration-revision>
!logs metadata channels <revision> <channel-IDs|none> <excluded-IDs|none>
!logs events list [before-record]
!logs events show <record>
!logs delivery show|reconcile <record>
!logs metadata forget <record> confirm
!logs counters
```

Categories are `membership`, `resources`, `messages`, `audit`, `settings` and `operations`. The module and every route start disabled. Message events also need channel opt-in, with at most 50 channels and 50 exclusions. DMs, private ticket channels, log channels and NeonFlux's own feedback are never logged. `!logs metadata status` also shows NeonFlux's current View, Send and Embed permissions in each enabled destination

The dashboard's Channel logs section configures the same settings, including per-event overrides for twenty-two event types and eighteen audit actions. An event without an override uses its category route. An audit-action override, such as `audit-entry:20` for kicks, wins over the audit category. An enabled override sends even when its category is off, a disabled one suppresses the event, and `inherit` removes the override

Each category has a color: Membership green, resources blue, messages cyan, audit purple, settings amber and operations coral red. Shade shows the kind of change, with the darkest tone for destructive actions. A member leaving is neutral and unattributed, while kicks and bans proven by the audit log use the darkest tone

Logged events cover member joins, updates and removals, role and channel changes, thread and forum post creation, changes and deletion, server updates, message edits and deletions and new audit log entries. Thread events use the resources category with their own event types `thread-create`, `thread-update` and `thread-delete`, and name the parent channel. A thread change names the changed fields `name`, `archived`, `locked` and `tags` when NeonFlux saw the thread before, since Fluxer sends only the new state. A thread NeonFlux merely joins is not logged as created. Deleting a channel deletes its threads without separate events, so one `thread-delete` record counts the threads NeonFlux knew in that channel. Records keep IDs, times, proven actors or unknown attribution, changed field names and counts. They never keep message text, attachments, reasons, raw audit changes or invite codes. Settings records cover moderation and log settings, security and DEFCON and metadata configuration only

Each server keeps at most 10000 records, and the oldest is evicted when a new one arrives. Delivery runs as NeonFlux under the server automation policy, and DEFCON 1 pauses it. Disabling keeps records, and re-enabling can deliver the backlog. A send with an unknown result is never repeated. Use `!logs delivery reconcile` to recheck it. Logs are append-only and settled records expire after 30 days

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

## Selective backup and additive restore

Only the current server Owner can use `!backup`, in a verified one-to-one DM with NeonFlux. Running it in the server returns only a private hint. Archives and reports stay private and suppress mentions

| Command | Behavior |
| --- | --- |
| `!backup help` | Show usage and key setup |
| `!backup export config xp structure` | Export only the categories you name |
| `!backup inspect` | Validate the attached encrypted `.nfb` archive and show its metadata |
| `!backup plan` | Preview creates, identical skips, conflicts and blocked items |
| `!backup confirm <planID> <planHash> <archiveDigest>` | Run up to 20 items of the reviewed plan |
| `!backup status [<planID> <planHash> <archiveDigest>]` | List plans or show one plan's items |
| `!backup reconcile <planID> <planHash> <archiveDigest>` | Recheck up to 20 created items with unknown results |
| `!backup forget <planID> <planHash> <archiveDigest>` | Drop a settled plan and keep what it created |

Repeat the same confirmation until the plan finishes, within its 15-minute expiry. Restore only adds. It never overwrites or deletes records, changes existing channels, recreates roles, assigns rewards, moves members or lowers DEFCON. Existing values that conflict stay untouched. Restored automation stays disabled until you turn it on. A partly finished restore is not rolled back

- `config`: Authored settings for moderation, automod, responses, publishing drafts and templates, roles and unpublished panels, greetings, tickets, leveling, milestones, suggestions, cleanup, metadata logs and the event and schedule switches. Event and schedule definitions are excluded
- `xp`: Current-season XP for at most 1000 members. Restore creates missing profiles, skips identical ones and leaves conflicts. It assigns no reward roles
- `structure`: At most 100 categories, text channels and voice channels with at most 500 permission overwrites. Names, parents, permissions, topic, NSFW, slowmode, bitrate and user limit are kept. Other channel types are skipped. Missing categories are created first, with full permissions in the creation request

Archives exclude credentials, AFK text, birthdays, votes, RSVPs, member data, ticket bodies, moderation notes, audit history and live state. This is not a full server, database or message backup. Export refuses an archive that would exceed restore limits, so every archive can be restored. Restore limits are 1 MiB per snapshot and 500 plan items

Set `NEONFLUX_BACKUP_KEY` in the bot environment to a base64 32-byte key that is independent of the bot and backend credentials. Without it, export, inspect and plan are disabled and other features keep working. NeonFlux never generates the key or sends it to Convex. Keep offline copies of the key and every archive, because a lost key makes its archives unreadable and a changed key makes older archives unreadable until the old key is restored. Archives use AES-256-GCM and are authenticated before parsing. Keys, URLs and file paths are never accepted in commands. Attachments stored on the platform are not durable backup storage

## Server analytics

NeonFlux counts server activity for the dashboard's Analytics section. It keeps counts only, never which member did what

| Command | Behavior |
| --- | --- |
| `!stats` | Show joins, leaves, messages, the top three channels and the three busiest UTC hours of the day for the last seven UTC days, including today |
| `!stats on` | Start counting for this server |
| `!stats off` | Stop counting for this server |
| `!stats help` | Show syntax |

Like `!prefix`, these commands work for the server owner and members with Administrator or Manage Server, and other members get a refusal. Analytics starts on. The dashboard has the same switch

- Member joins and leaves are counted per UTC day
- Messages are counted per channel and UTC hour. Only ordinary and reply messages from human members count, commands included. Bot, webhook and system messages are never counted
- Messages in a thread or forum post count under its parent channel. The bot learns parents from the channels it keeps and reads a channel it does not hold once, so an archived thread also counts under its parent. If that read fails, the thread's messages in that batch count under the thread itself, and the next batch reads it again

The bot adds counts in memory and sends them to the backend in one request per server at most every five minutes, or sooner once the counts fill one request of 500 hour and day buckets. A server with no activity causes no backend requests, and a server active all day sends about 288 requests a day. A larger batch is split. `!stats` sends the counts in memory before it reads the summary, so its reply is current. The dashboard receives new counts about every five minutes

Every request carries a batch number, and the backend applies each batch once. If the backend is unavailable or its reply is lost, the bot sends the same batch again every five minutes, and a batch the backend already saved is not counted twice. The bot drops a batch that could not be saved for a day, and a batch the backend refuses. On a normal shutdown the bot sends the open window. A crash or forced stop loses the counts not yet saved, which is at most the last five minutes while the backend is reachable

`!stats off` stops counting at once and drops counts not yet sent. When the dashboard turns analytics off, the backend stores nothing from the bot's next batch, and the bot then stops counting. While analytics is off, member activity makes the bot recheck the setting at most every ten minutes, so turning it on from the dashboard resumes counting within about ten minutes of activity. Turning analytics off keeps existing counts. Channel and hourly counts expire after 35 days and daily join and leave counts after 400 days

`!logs counters` is a separate metadata log report and is unchanged

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
| Manage Channels | Tickets, slowmode, unlock, channel structure restore and temporary voice rooms |
| Manage Roles | Role panels, autorole, verification roles, ticket access, lock and unlock overwrites and temporary voice room access |
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

Missing or repeated selectors and selectors for servers the bot does not serve are rejected before any private data is read. The selection applies to one message only. DM replies start with `[Server <serverId>]`, and follow-up commands written by the bot include `--server`

The bot's presence shows only `NEONFLUX_CUSTOM_STATUS`, or nothing when it is unset, so no single server's DEFCON level or backend outage changes it
