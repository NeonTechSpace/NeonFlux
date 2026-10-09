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
| `NEONFLUX_SERVER_ID` | Optional. With a backend, the bot refuses to start when the backend serves another server or multi mode. Without a backend, the one server the bot serves |
| `NEONFLUX_SERVER_MODE` | Optional. With a backend, the bot refuses to start when the backend serves another mode |
| `NEONFLUX_CUSTOM_STATUS` | Optional presence text of at most 128 UTF-16 code units, shown at DEFCON 3 in single mode and always in multi mode |
| `NEONFLUX_BACKUP_KEY` | Optional backup recovery key, see [backup and restore](#selective-backup-and-restore) |

The Convex deployment owns the server scope and the website origin. At startup the bot asks the backend for both and adopts them, so `NEONFLUX_SERVER_MODE`, `NEONFLUX_SERVER_ID` and `NEONFLUX_WEBSITE_URL` belong in the deployment, as [the backend guide](BACKEND.md#environment-variables) lists them. The bot's own scope variables only check the backend's scope, which catches a bot pointed at another deployment. Without a backend, the bot serves the one server `NEONFLUX_SERVER_ID` names. Commands that need no stored data still work, such as `!ping` and `!custom help`, while features that store data are unavailable

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

Before connecting, the bot adopts the backend's scope and website origin. A refused key, a backend that is not configured, an unreachable backend, an unknown answer and a scope that differs from the bot's own scope variables each stop startup with their own message. A backend that is not configured logs the variable to fix in the Convex deployment's logs. Update the backend before the bot

### Shared behavior

- Replies suppress user, role, everyone and reply-author notifications
- Status, detail and list replies, such as `!suggest show 1` or `!appeal status`, are embeds with a title and labelled fields. Short confirmations and errors are one plain sentence. A change to a single setting answers with one line that names the setting and its new value, and creating something shows its card. Members, channels and roles show as mentions that never notify anyone, and times show in each reader's own timezone
- Management replies appear in the channel where the command was sent. Use a staff channel for configuration
- Commands never ask for revision numbers. A chat change applies to the current state, which the bot reads right before it writes, so when two staff members change the same thing, the later change wins. The dashboard keeps its own conflict check, as [the dashboard guide](WEB.md#saving-and-live-updates) describes
- Events and scheduled posts are named by their name, such as `!event show study`. Records that have no name, such as cases, tickets, suggestions and posts, keep their numbers
- A reason at the end of a command needs no quotes, such as `!mod warn @user Spamming links`. An apostrophe inside a word, as in don't, counts as text and needs no escape
- A member, role or channel is given by its ID or by a mention of its own kind. A role mention where a member is expected is refused, and the same holds for each other pairing. Plain whole numbers such as case numbers and counts are written without leading zeros. The number inside a duration may keep them, as in `07d`
- A list with more pages ends with a `Next` line. Send the same command with `next` at the end, such as `!mod list next`, for the following page. The bot remembers each member's place in each list in memory, so after a restart a list starts again from its first page
- Commands and actions, such as moderation, role changes, channel permission changes and purges, read current server, role, member and channel data from Fluxer right before they act. A failed read denies the request
- Evaluating everyday activity, such as message protection, automod, custom responses, leveling, metadata logs and role panel reactions, uses copies of server, role, member and channel data that the bot keeps in memory, and reads Fluxer only for what it lacks. Gateway events keep the copies current
- A message in a thread or forum post counts as in its parent channel for channel rules: automod channels and exemptions, honeypot channels, custom response channels, leveling's excluded channels and metadata logs' message and excluded channels. A rule that lists the thread itself also matches. The bot learns a thread's parent from thread events and the channels it keeps, or otherwise from one channel read
- The bot never automatically repeats a native action whose outcome is unknown. Such work stays visible as uncertain, and status or reconcile commands read the exact known message or member without resending
- Durable worker state, such as greeting, schedule and cleanup queues, lives in the backend. Workers resume it after a restart
- Each gateway session asks Fluxer not to send event types the bot does not handle, such as typing notices and presence updates, so they cost no bandwidth or decoding
- A message update that only adds or changes link previews or other embeds is ignored. The bot remembers the edit time, pin status and flags of the last 10,000 messages it saw, and an update that changes any of them, or concerns an older message, still reaches automod, security and metadata logs
- Background workers for dashboard changes, web verification, events, scheduled posts, birthdays and anniversaries, suggestion cards, message cleanup, metadata logs and level rewards run only when the backend reports due work for their server, so a server without due work causes no backend requests. One dispatcher for the whole bot asks the backend at startup, at once when the backend signals new work, when work the bot's own requests created becomes due and at the next due time the backend names. Without any of these it still asks every two minutes. It asks at most once every three seconds, so new work usually starts within a few seconds. Work for a server that is still starting reaches it once it has started. If the backend cannot answer, the dispatcher waits 10 seconds and then twice as long after each failure, up to five minutes. When new work is signalled during such a wait, it tries once early, three seconds after its last try, at most once per wait

## Command help and permission fixes

| Command | Behavior |
| --- | --- |
| `!<command> help` | Show a command's most used forms, at most eight, such as `!custom help`. Help for a command with more forms ends with a line pointing to `help all` |
| `!<command> help all [next]` | List the forms that help leaves out, 10 at a time, such as `!custom help all` |

Help prints the server's prefix, except on lines about commands sent in a DM, which always use `!`

When a moderation action, a role panel, autorole, verification or role picker change, a ticket creation or a temporary voice room change fails because of NeonFlux's permissions or role position, the reply names the fix, such as granting a permission to the NeonFlux role or moving that role above another. A moderation action against a member whose highest role is not below yours says so too

## Ping, AFK, prefix, nickname and custom responses

### Prefix

Server owners and members with Manage community change the prefix with `!prefix <value>`, or read it with `!prefix`. A prefix is one to five of these characters: `! $ % & * + , . ? ~ ^ | : / -`. `!prefix` always works, so a forgotten prefix can be recovered. The dashboard can also change it

The bot caches each server's prefix. A chat change applies at once and a dashboard change applies within 30 seconds. If the backend cannot be read, the bot keeps the last known prefix, or `!` when it has none

### Bot nickname

Server owners and members with Manage community set the bot's display name in their server. Anyone can show it

| Task | Command |
| --- | --- |
| Show the nickname and the last apply result | `!nickname` |
| Set the nickname | `!nickname set Neon Helper` |
| Remove the nickname so the bot's username shows | `!nickname reset` |

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

## Moderation, protections, DEFCON and appeals

Moderation needs the server owner, an Administrator or a configured staff role. Assign staff roles per area with `!mod staff moderation|cases|automod|security|appeals @role...`, or clear them with `none`. Changing configuration needs the owner or an Administrator. Native actions also need the bot's native permission and a higher role than the target. The bot refuses destructive actions against itself, other bots, the owner, Administrators and members with a higher role

A reason or appeal text is the rest of the command and needs no quotes, as in `!mod warn @user don't post invite links`. Reasons are limited to 512 code units and appeal text to 2000. Durations are whole numbers with the units `s`, `m`, `h`, `d` or `w`, in any case, combined from largest to smallest without spaces, such as `90s` or `1h30m`. A fraction or a sign, as in `1.5h`, is refused, and milliseconds are accepted only when the total is whole seconds

### Moderation and cases

| Task | Command |
| --- | --- |
| Warn and send a private notice | `!mod warn @user <reason>` |
| Kick, ban or unban | `!mod kick\|ban\|unban @user <reason>` |
| Ban temporarily | `!mod ban @user 1d <reason>` |
| Time out or remove a timeout | `!mod timeout @user 10m <reason>`, `!mod untimeout @user <reason>` |
| Delete up to 100 recent messages of a member, or of everyone after you confirm | `!mod purge 20 @user <reason>`, or `!mod purge 20 <reason>` and then the same message with `confirm` added |
| Set slowmode, 0 to clear | `!mod slowmode #channel 10 <reason>` |
| Turn manual sanctions on or off, or inspect | `!mod module on\|off`, `!mod status` |
| Erase one case's narratives (owner) | `!mod erase <case>` |
| List or show cases | `!mod list [@user or user ID] [next]`, `!mod show <case>` |
| A case's reason changes and voiding, ten to a page | `!mod history <case> [next]` |
| Correct a reason or void a warning | `!mod reason <case> <new reason>`, `!mod void <case>`. Only a warning can be voided |
| Check an action with an unknown outcome | `!mod recover <case>` |
| Set the staff log channel | `!logs channel #channel\|off` |
| Inspect staff log delivery | `!logs status`, `!logs list [next]`, `!logs show <case>` |

Timeouts allow up to one year, temporary bans one minute to two years and slowmode 0 to 21600 seconds. When Fluxer does not confirm a slowmode change, NeonFlux reads the channel once and records the case as done if the new slowmode is there. Otherwise the case stays not confirmed, and the change is never sent again. To link a sanction or reversal to an earlier case, put `case <case-number>` before the reason, as in `!mod unban @user case 12 Appeal approved`. A purge names a member right after the count, as in `!mod purge 20 @user <reason>`, and then deletes at once. A member without a reason is refused. Without a member, NeonFlux only replies with what a purge of everyone would do and your message with `confirm` added. A final `confirm` is not part of the reason, and stays in the command when you typed it. Sending that within 2 minutes of its preview, from the same person in the same channel, deletes up to that many of the newest messages before it from every author. It skips the purges staff sent in the channel, member purges included: their commands, and the previews, results and errors NeonFlux answered with. A purge refused for NeonFlux's missing permission or by the backend, and its reply, are skipped too. A command NeonFlux could not read, or one from someone without Manage messages or whose permission check failed, counts like any other message, and so do the purge messages older than the last 20 or 10 minutes NeonFlux remembers. A confirm typed before NeonFlux showed its preview only previews. A purge of a member is not affected by any of this and deletes that member's newest messages. A confirm after a preview that could not be sent, or with no preview before it, only shows a new preview, and a purge works only in a server channel. A reason is always required. A ban is temporary when the word after the member is a length, written as the duration rule above describes. Otherwise the reason must start with a letter. Anything else, such as a number, a fraction, quotes or an emoji, is refused with the accepted form shown, instead of becoming a permanent ban, and a reason that begins with a number can start with a word, as in `after 3 strikes`. The reason after a `case <n>` link follows the same rule, and a length later in the reason, as in `spam for 7d`, is not read. The reply says whether a ban is permanent, and how long a ban, timeout or quarantine lasts

A list shows its first page, and the same command followed by `next` shows the page after the last one you saw in that channel, as each page's `Next` line says. This also holds when the pages arrive by DM, so send `next` where you sent the list

Case details, watchlist reasons and appeal text are sent to the reader's DM after a fresh permission check. A server channel gets only an acknowledgement. Staff logs contain action, actor, target and outcome, without private reasons. A log post that was not confirmed is never sent again and stays marked as not confirmed in `!logs show <case>`. `!logs recover <case>` is the same as `!mod recover <case>` and checks the case's action, not the post. A warning stands even if its private notice cannot be delivered

Cases are kept for 180 days from their creation and closed appeals for 180 days after they close. Records still in recovery stay until resolved. `!mod erase` replaces a case's narratives with an audit marker

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

Rule types are `spam`, `repeat`, `mentions`, `words`, `domains` and `invites`. Actions are `log`, `delete`, `warn` and `timeout`. Spam defaults to 5 messages in 10 seconds, repeat to 3 in 30 seconds and mentions to 5. Thresholds allow 1 to 100, windows 1 to 300 seconds and priority -100 to 100. Each rule holds up to 20 patterns of up to 200 code units and 20 IDs per scope

Patterns are literal text, not scripts or regular expressions. Domain `block` mode matches listed hosts and their subdomains, and `allow` mode flags any other host. The bot never visits a URL. Staff and exempt roles and channels are never sanctioned. A message gets at most one automated sanction across automod and security. When NeonFlux lacks the permission or role position to act on the author, an enforcing rule or honeypot logs the case instead

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

| Level | Behavior |
| --- | --- |
| 3 | Normal operation |
| 2 | Staff commands and private appeals only. Public commands are blocked |
| 1 | Only critical owner or Administrator controls |

Use `!defcon status`, `!defcon diagnose` and `!defcon set 1|2|3`. Critical controls include status, diagnosis, DEFCON
changes, disabling protections, recovery checks, unlock, release, untimeout and unban. Join bursts can raise the level
to 2 when `raid-mode defcon2` is set, never to 1. DEFCON does not change channel permissions. In single mode the bot
shows the level in its presence and restores it at startup

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

Members see only their own cases and appeals. Each case accepts one open appeal per user. Staff use `!appeal review [next]`, `!appeal review <appeal>` and `!appeal approve|reject <appeal> <reason>` in a server channel or a DM with the bot. Details and decisions are sent privately. The list shows every appeal with its status, newest first. Owners and Administrators use `!appeal module on|off`, and `!appeal status` shows whether appeals are on, how many wait for review and who reviews them. Approving an appeal does not reverse the sanction, so staff reverse it separately

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

When a send or edit has an unknown outcome, `reconcile` reads the known message, or staff use `resolve` to record what happened. Edit and forget work again once the outcome is known. Deleting a draft or forgetting a post never deletes the message. Attempt history is kept for 180 days. Publishing starts enabled. DEFCON 2 still allows Administrators to publish, and DEFCON 1 allows only disabling, status, the post list and reconcile

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
| See the planned dates or the post | `!publish schedule dates <name> [next]`, `!publish schedule preview <name>` |
| Inspect settings or deliveries | `!publish schedule status [<name> [next]]` |
| Replace content | `!publish schedule update <name> content draft\|template <source-name>` |
| Replace time | `!publish schedule update <name> time YYYY-MM-DDTHH:mm IANA/Zone reject\|earlier\|later [daily\|weekly <interval> <count>]` |
| Change destination | `!publish schedule update <name> destination #channel` |
| Enable, pause or cancel | `!publish schedule enable\|disable\|cancel <name>` |
| Check a known post | `!publish schedule reconcile <name> <post-number>` |
| Forget settled deliveries | `!publish schedule forget <name> [date-number ...] [confirm]` |
| Turn the module on or off | `!publish schedule module on\|off` |

Each schedule has a unique name. Dates must be in the future within 180 days, and a whole schedule spans at most 180 days. A local time that does not exist is rejected, and a repeated time needs `earlier` or `later`

Enabling never catches up on missed dates. A delivery that comes due while the bot is down still sends until local midnight after its due time. Cancel closes remaining dates permanently. Scheduled posts are sent as the bot and need the bot's channel permissions, the scheduling and publishing modules and DEFCON 3. A post that comes due at DEFCON 1 or 2 waits without requests and sends once DEFCON is set to 3, until local midnight after its due time. A post that comes due while its schedule, the scheduling module or publishing is off also waits without requests, and is skipped at local midnight or, if you turned the switch back on first, as before that activation, because enabling never catches up on missed dates. Forgetting removes tracking without deleting messages. Settled history is kept for 180 days. An update removes the future dates it replaces that never started sending, so updates do not use up schedule capacity

## Role panels, reaction verification, autorole and reservations

Reaction panels, rules verification, autorole and the role picker each start disabled. The owner or an Administrator configures them. The bot needs Manage roles and a role above every role it assigns. It only assigns roles with ordinary permissions, never everyone, privileged roles or staff roles, and it does not create roles

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

Toggle panels allow any combination, and exclusive panels allow one choice. Members react or use `!roles choose colors 🔵`, or `!roles choose colors none` to clear. Changing mappings, rules or mode requires publishing a fresh panel message, and publishing again before any of them changed is refused. Old reactions keep their original meaning

Reactions on messages that are not role or verification panels usually cost no Fluxer or backend requests

| Task | Command |
| --- | --- |
| Show or list panels | `!roles show <name>`, `!roles list [next]` |
| Require or exclude roles | `!roles requires\|excludes <name> <emoji> @roles...\|none` |
| Change a mapping or mode | `!roles unmap <name> <emoji>`, `!roles mode <name> toggle\|exclusive` |
| Enable, disable or delete | `!roles enable\|disable\|delete <name>` |
| Retire a published panel | `!roles retire <name>`, then `!roles next <name>` if it stopped |
| Inspect history | `!roles history <name> [next]` |
| Process a cleared reaction set | `!roles reactions <name>`, `!roles jobs`, `!roles resume <name>` |
| Check or withdraw a member's roles | `!roles reconcile\|withdraw <name> [@user] [next]` |
| Status and module | `!roles status`, `!roles module on\|off`, `!roles help` |

Retire and delete withdraw the roles a panel granted, within the same command. That covers every revision of the panel,
because editing and republishing it leaves the grants of the earlier revision behind, and a choice on the current panel
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
web challenge, and `!verify reconcile|withdraw [@user] [next]`, `retire` and `next` for recovery. A review that fails
says why, such as an unknown reference or a request that is already complete

Plain reaction verification is an acknowledgement, not a CAPTCHA

A rules panel that has a role or a published message holds back member features such as role grants, events and birthday and anniversary consent until a member accepts the rules, even while verification is off. Until members can accept it, with verification on and the current rules panel published and turned on, the dashboard overview shows rules verification as on but needing a step

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
| List, show, add or remove menus | `!rolepicker menu list`, `!rolepicker menu show <name> [next]`, `!rolepicker menu add <name> single\|multi ["description"]`, `!rolepicker menu remove <name>` |
| Change a menu | `!rolepicker menu set <name> mode single\|multi`, `!rolepicker menu set <name> description "text"\|none` |
| Menu roles | `!rolepicker menu role add\|remove <name> @roles...` |
| Who may use it | `!rolepicker access`, `!rolepicker access allowed\|blocked [next]`, `!rolepicker access allow\|block\|unallow\|unblock role\|user <mentions or IDs>` |
| Unconfirmed role change | `!rolepicker reconcile @user` |

A server has up to 10 menus of up to 25 roles each, and a role belongs to one menu. Menu roles follow the reaction panel rules: Below the bot's top role and the sender's, not everyone, not a staff role and only ordinary member permissions. A block always wins over an allow, and with no allowed roles or users every member who is not blocked may use the role picker. Like other role commands, turning the role picker off and removing a menu still work at DEFCON 1. Removing a menu keeps the roles members already chose

The work dispatcher wakes the server's dashboard worker when website requests are queued, so the bot handles them within a few seconds and an idle server makes no role picker requests. It reads the member fresh, the backend checks the menus, the access lists, verification and the role rules, and the role change uses the same one-time claim as reaction panels. In a single-choice menu a claim first drops the member's other role of that menu, which works only when the role picker added that role and no other feature still needs it. A drop never removes a role the role picker did not add

A role change NeonFlux could not confirm blocks that member's next choice of the role.
After its few-minute window has passed, an administrator sends `!rolepicker reconcile @user`.
It reads the member again and records whether the role is there, without repeating the change, and the member can then
choose again.
It records one role change per command and says when another is left, so send it again for that one

### Autorole and reservations

Use `!autorole add|remove @role`, `!autorole list` and `!autorole module on|off`. Autorole applies to future joins only and to humans by default. `!autorole humans off` includes bots. When verification is configured, autorole waits for it

A reservation gives an exact user ID extra roles when that user joins or rejoins, even before they are a member. Use `!autorole reserve <user-id> @roles...`, `!autorole unreserve <user-id>` and `!autorole reservations [next]`, which counts them and lists 10 at a time, or the dashboard. Up to 100 users can have one to 20 reserved roles. Saving does not grant roles to current members, and removing a reservation does not take roles away. Recovery uses `!autorole retire` once the list and reservations are empty, which withdraws every earlier revision of the list that granted roles first, `next`, `history [next]` and `reconcile|withdraw @user [next]`

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

- Placeholders are `{user.name}`, `{user.mention}`, `{user.id}`, `{server.name}`, `{server.id}` and `{channel.id}`. `{user.mention}` can notify only the greeted member, and `{channel.id}` works only in channel routes. Fluxer notifies only for mentions in the message text, so a channel greeting whose `{user.mention}` appears only in its embed also starts its text with the mention, unless the text is too long to take it
- Filled-in placeholders can make a greeting longer than its template. When the message text would pass 2,000 characters, or the embed would pass one of Fluxer's embed limits, every text in that part that grew is cut back to its length in the template, so a valid template always goes out
- Welcome and DM routes need `join` or `verified` timing. `verified` waits until the member completed rules verification and holds the access role
- Enabling a route does not greet existing members, and the bot greets a join only when it sees the join within 15 minutes
- Goodbye is sent when a member leaves, including members who joined before the bot started tracking. The bot cannot tell whether a departure was voluntary, a kick or a ban
- A join or departure while DEFCON is below 3 or while moderation restricts the member, such as a quarantine or, for a join, a timeout, gets no greeting, also not once that ends
- Preview sends a sample for the invoking staff member in the current channel
- A delivery with an unknown outcome is never resent
- One delivery pass considers at most 20 due greetings and reads at most ten pages of waiting greetings. Greetings beyond that continue a minute later. While DEFCON is below 3 a greeting queued before that waits without Fluxer requests and is checked again every ten minutes, so it is sent up to ten minutes after DEFCON is 3 again, if its 24 hours have not passed. A verified greeting is also checked every ten minutes instead of every minute while rules verification is off, or its panel is disabled, being withdrawn, unpublished or edited but not republished, so it can lag up to ten minutes after verification is usable again

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
!ticket canned <category> list [next]
```

Members open a ticket from the DM. Intake shows who will see the conversation before any answer is entered and again before submission. Each answer allows 2000 characters and stays private even when the conversation channel is public. A category change after an intake starts makes submission fail instead of silently changing that intake

```text
!ticket open <category>
!ticket answer <intake-number> <1..5> "answer"
!ticket review|cancel <intake-number>
!ticket submit <intake-number> private|public
```

Staff work in the ticket's own channel. Requesters can read their own tickets and close or reopen them

| Command | Who | Behavior |
| --- | --- | --- |
| `!ticket list [next]` | Staff, requester | List visible tickets, 10 per page. Each page looks through the 50 newest tickets before it, so a page can be empty with a `next` line |
| `!ticket show\|intake <ticket>` | Staff, requester | Show the ticket's state, people, category, priority and channel, or the private intake answers |
| `!ticket attempt <ticket> [attempt]` | Staff, requester | Show what the ticket's last action did, or one numbered attempt |
| `!ticket claim\|unclaim <ticket>` | Staff | Take or release the ticket |
| `!ticket priority <ticket> low\|normal\|high\|urgent` | Staff | Set priority |
| `!ticket reply <ticket> "text"` or `canned <name>` | Staff | Post a reply in the ticket channel |
| `!ticket note <ticket> add "text"`, `list [next]` or `show <note>` | Staff | Private staff notes, kept apart from intake and channel history. The list shows 5 notes per page as short snippets, and `show` reads one in full |
| `!ticket close\|reopen <ticket>` | Staff, requester | Remove or restore send access |
| `!ticket reconcile <ticket>` | Staff, requester | Recheck a partial close, reopen or create against the live channel |
| `!ticket transcript <ticket> capture [1..500]` | Staff, requester | Store a transcript of up to 500 recent messages |
| `!ticket transcript <ticket> list [next]` | Staff, requester | List stored transcripts, 10 per page |
| `!ticket transcript <ticket> show <transcript> [next]` | Staff, requester | Read a transcript in 1500-character pages |
| `!ticket delete <ticket> confirm` | Owner, Administrator | Delete the closed ticket channel and release it |
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

Transcript capture is explicit and incomplete by design. Each stored message keeps at most 2000 characters of text with its author and timestamps. Attachment URLs and embed bodies are left out, and a capture that exceeds the storage budget is truncated with a notice. A failed capture stores nothing. Each ticket keeps at most 20 transcripts and 200 staff notes and replies sent through NeonFlux together, after which both are refused. The requester can save 5 of those transcripts, so staff can still capture. To share a public summary, write a separate publishing draft, because private content is never copied automatically

## Message leveling

Owners and Administrators configure message XP with `!level`. Current members can read `!rank` and `!leaderboard`. Rank cards are native embeds, replies never notify anyone, and cards and leaderboards show members as mentions without storing display names or avatars

Leveling starts disabled with 15 XP per eligible message and a 60-second cooldown. Level N needs `100 * N²` lifetime XP, up to level 1000. Scores belong to the account in this server and survive leaving and rejoining. While leveling is off, messages cost no leveling backend call: after the backend answers that leveling is off, the bot sends no XP candidates for ten minutes, or until a `!level` command or a leveling change on the dashboard. Turning leveling on from either takes effect immediately, and a change by other means, such as a backup restore, within ten minutes

| Command | Behavior |
| --- | --- |
| `!level help` | Show the common forms. `!level help all` lists the rest |
| `!level config` | Show the status, the rate and how many excluded channels, excluded roles and role rewards are set |
| `!level config channels\|roles\|rewards [next]` | List the excluded channels, excluded roles or role rewards, 10 per page |
| `!level module on\|off` | Start or pause XP and new reward grants |
| `!level rate <1-100 XP> <15-3600 seconds>` | Set XP per message and cooldown |
| `!level exclude channels\|roles <IDs...\|none>` | Replace the exclusion list, at most 50 each |
| `!level map <1-1000 level> @role` | Add a reward role, at most 20 mappings |
| `!level unmap <level>` | Remove one mapping |
| `!level clear [confirm]` | Preview, then clear all mappings |
| `!level correct @user <0-100000000 XP> <reason>` | Set an absolute XP value with an audit entry |
| `!level reset member @user <reason> [confirm]` | Preview, then reset one member |
| `!level reset server <reason> [confirm]` | Preview, then start a new season for everyone |
| `!level status` | Show pending and blocked reward work, and how many member records exist, including members who now have no XP |
| `!level reconcile [@user]` | Queue a reward check for the server or one member. For a member it first records what Fluxer shows for a reward role change that was not confirmed, one change per command |
| `!level audit [next]` | Read correction and reset audits, 10 per page |
| `!rank [@user or user ID]` | Show XP, level and rank |
| `!leaderboard [next]` | Show 10 rows ordered by XP |

Reasons need no quotes. A reset's final word `confirm` confirms it, and the words before it are the reason, so the preview prints the exact command to send. Corrections apply in the order their commands were sent, so an older correction that arrives late is rejected. `!leaderboard next`, `!level audit next` and `!level config <list> next` continue where your last page in that channel ended. Rows can shift between pages while XP is awarded. After a server reset, `!leaderboard next` reports the change and forgets its place, so start again with `!leaderboard`. Rank is exact for every member, except when more than 100 members of the same level have more XP, where the card shows the range of positions that level allows, such as `#3102 to #3400`. Members with zero XP are unranked

XP comes only from human ordinary or reply messages in the configured server that pass existing protection and command gates. Bots, system messages, webhooks, DMs, edits, prefix commands and empty text earn nothing. Duplicate text within ten minutes earns nothing. Candidates wait in a memory queue of at most 1000 accounts, so a busy server or a restart can drop some awards. NeonFlux does not promise XP for every eligible message

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
| `!event dates <name> [next]` | List the dates with their numbers, 10 per page, shown in each reader's own timezone |
| `!event attendees <name> <date> [next]` | List attendees and the waitlist, 10 per page |
| `!event rsvp <name> <date> going\|maybe\|not-going\|none` | Set or clear your RSVP |
| `!event create <name> #channel "title" ["description"]` | Create a draft event with a name of up to 32 lowercase letters, numbers, underscores or hyphens that no other event of the server uses. The title has up to 256 characters and the description up to 1000, each on one line |
| `!event time <name> YYYY-MM-DDTHH:mm <IANA zone> <1-10080 minutes> [reject\|earlier\|later]` | Set the first occurrence |
| `!event repeat <name> off\|daily\|weekly <1-12 interval> <1-26 total>` | Set repetition |
| `!event title <name> "title" ["description"]` | Change the text |
| `!event template <name> <template>\|off` | Use a snapshot of the publishing template as it is now |
| `!event capacity <name> off\|1-500` | Limit Going seats |
| `!event reminders <name> off\|<minutes> [minutes]` | Set up to two reminder offsets, 1 to 10080 minutes |
| `!event publish\|cancel <name>` | Publish the card or cancel the event |
| `!event status [<name> [next]]` | Show the module, or one event's card and reminder outcomes |
| `!event reconcile <name> [post-number]` | Recheck a known card or reminder message |
| `!event forget <name> [confirm]` | Remove settled event data in pages |
| `!event module on\|off` | Turn the module on or off |

Going takes a seat or the next waitlist place. Repeating Going keeps your place, and withdrawing then choosing Going again counts as a new answer. Maybe, Not going and None use no seat. RSVPs close at start or cancellation. Waitlisted members are promoted only while they are still members with access and pass verification, timeout and quarantine checks. Members who leave lose their seat

Times use an exact local minute and an IANA zone. Repeats allow at most 26 occurrences within 180 days, and wall-clock
times hold across offset changes. Nonexistent local minutes are rejected, and repeated minutes are rejected unless you
choose `earlier` or `later`. Once anyone has RSVPed, the calendar cannot change. Cancel the event and create a new one
instead. Capacity cannot drop below the Going attendance of a date that has not started

Each event has one protected publishing card that follows publishing limits. The card shows the event's first date and
its number of dates, and `!event show` names the next date that has not ended, or says none are left. Event changes edit
the card, and RSVPs do not. `!publish` cannot edit or forget event cards. Reminders default to 1440 and 60 minutes
before start, are skipped if already past due on activation and must send before the event starts. Automatic cards and
reminders send as NeonFlux and need its channel permissions, the module and publishing switches and a DEFCON level that
allows them. DEFCON 2 pauses automatic sends and public RSVPs. A reminder that comes due while events or publishing are
off or DEFCON is below 3 waits without requests and goes out when they allow it again, if its five minutes have not
passed. Cancellation and disable never delete or edit posted messages, so a cancelled event's card keeps its text, and
the event's status shows it as cancelled. A send with an unknown result is never repeated, so use `!event status` and
`!event reconcile` to recover it

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

Owners and Administrators configure each route from a publishing template. Configuring in chat uses the template's latest saved version, and later template edits change the route only when it is configured again. Templates can use `{user}` and `{server}`, plus `{years}` for anniversaries. Birthday posts never show the date or an age. All milestone replies and previews are private, and posts suppress mentions. `!milestone status` sent in a server channel answers there with `Details sent by DM`

| Command | Behavior |
| --- | --- |
| `!milestone status [birthday\|anniversary [next]]` | Show configuration and limits, with the stored post records counted against their limit, or delivery history for one route. Birthday history leaves out due times and why a post skipped a clock change, so it never shows a date. `next` shows the following page |
| `!milestone configure birthday\|anniversary #channel <IANA zone> HH:mm earlier\|later\|reject template <name>` | Set a route |
| `!milestone preview birthday\|anniversary` | Preview the post privately |
| `!milestone enable\|disable\|clear birthday\|anniversary` | Control one route |
| `!milestone module on\|off` | Turn the module on or off |
| `!milestone reconcile birthday\|anniversary <post>` | Recheck one known post |
| `!milestone forget birthday\|anniversary <settled-post> [confirm]` | Drop settled tracking without deleting the post |

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
| `!suggest status <number> under-review\|planned\|completed\|declined <reason>` | Staff | Change state with a public reason of at most 500 characters. The reason runs to the end of the command and needs no quotes |
| `!suggest publication <number>` | Staff | Show card delivery state |
| `!suggest reconcile\|replace <number> [confirm]` | Staff | Recheck a known card, or replace one confirmed missing |
| `!suggest forget <number> [confirm]` | Staff | Remove settled closed suggestion data in pages |
| `!suggest disable` | Staff | Stop submissions, votes and cards and keep data |

Voting uses commands only, and reactions change nothing. Under-review and planned suggestions accept votes. Completed and declined ones close voting and can be reopened with a reason until they expire. Withdrawn suggestions stay closed. Only the latest status reason, actor and time are kept. Self-votes count, and votes stay after the voter leaves. Editing or deleting a command message does not change the recorded text or vote

Cards show author, state, vote totals and the latest reason with mentions suppressed. There is no public voter list, but database administrators can see voter IDs. Card updates are grouped for about five seconds and sent as NeonFlux, under its channel permissions, the module and publishing switches and DEFCON 3. At DEFCON 1 or 2 updates wait without requests and go out after DEFCON is set to 3. A card can lag behind the recorded state. Check `!suggest publication` before recovery. A missing card needs explicit replacement, and `!publish` cannot edit or forget suggestion cards. Forgetting data never deletes posted cards

Limits are 1000 suggestions per server, 1000 voters per suggestion, 10000 vote records per server, 1000 cards waiting for an update or unable to update, and 1000 staff and 10000 member commands a day. Closed suggestions expire after 180 days

## Automatic message cleanup

Owners and Administrators use `!cleanup` to delete messages older than a chosen age in selected Text and Announcement channels. Send a command that names no channel in a Text or Announcement channel, since a thread, forum post or voice channel is refused. The module and every policy start disabled. A server can have cleanup in at most 50 channels. Turning a channel's cleanup off keeps its slot. Ages run from one hour through 365 days and are written like other durations, in any case, such as `60m`, `1h30m`, `30d` or `2w`. A total that is not whole seconds is refused

| Command | Behavior |
| --- | --- |
| `!cleanup help` | Show the common forms. `!cleanup help all` lists the rest |
| `!cleanup configure #channel <age>` | Create or replace a channel policy |
| `!cleanup show\|preview #channel` | Show the policy, or check up to 50 older messages without deleting |
| `!cleanup list [next]` | List configured channels, 10 per page. `next` shows the following page |
| `!cleanup status [#channel]` | Show the module and channel count, or one channel's state and last run in a few lines |
| `!cleanup status #channel messages [next]` | List links to the channel's handled messages with their outcome, 10 per page and newest first. `next` shows the following page |
| `!cleanup enable #channel [confirm]` | Enable the policy, including existing old messages |
| `!cleanup disable #channel` | Stop new deletions and keep configuration |
| `!cleanup module on\|off` | Turn the module on or off |
| `!cleanup exclude #channel author\|message add\|remove <id>` | Keep up to 50 authors and 100 messages |

Only human messages of ordinary or reply type that are unpinned, older than the cutoff and outside every exclusion and publishing or panel protection are deleted. Anything with unknown pin state, author, type or time is kept. Preview counts unknown messages as skipped. Replies contain metadata only and suppress mentions

Automatic deletion runs as NeonFlux under the server automation policy. It needs View channel, Read message history and
Manage messages, the module and policy switches and a DEFCON level that allows it. It does not depend on the
Administrator who configured it. DEFCON 1 pauses new deletion. Each pass runs at startup and every 60 seconds and
deletes at most five messages per channel and 20 overall. A channel whose sweep has read all its messages rests 15
minutes before the next sweep starts, so a message that has just passed the age can wait that much longer. A deletion
with an unknown result is never retried

Deletion has no server-side pin check, so a message pinned just before deletion can still be removed. Cleanup stores
only IDs, authors, timestamps and outcomes, never message text or attachments. Records expire after 30 days, also those
of deletions that failed or have an unknown result. Such a deletion does not keep you from deleting the channel's policy
on the dashboard

## Metadata logs

Owners and Administrators extend `!logs` with metadata logging. Existing moderation log commands keep their meaning. Configure in a server channel. Status, category, override, counter, event and delivery reports arrive in a private DM, and these reads also work from a verified one-to-one DM. `!logs events list` and `!logs metadata overrides` show 10 entries a page, and `next` shows the following page

```text
!logs metadata help
!logs metadata status
!logs metadata categories
!logs metadata overrides [next]
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

Categories are `membership`, `resources`, `messages`, `audit`, `settings` and `operations`. The module and every route start disabled. Message events also need channel opt-in, with at most 50 channels and 50 exclusions. DMs, private ticket channels, log channels and NeonFlux's own feedback are never logged. Send a change that names no channel in a Text or Announcement channel, since a thread, forum post or voice channel is refused

`!logs metadata status` is a summary: Whether the module is on, how many categories post to a channel, the number of event overrides, the message channels, the log channels that no longer exist and the log channels where NeonFlux currently lacks View channel, Send messages, Embed links or Read message history. It shows the stored record count only once 8000 of the 10000 records are in use. `!logs metadata categories` shows each category's channel and whether NeonFlux can post there. Replies and log post titles name events in plain words, such as Member joined or Audit: Member kicked. `event` and `inherit` take that name, in any case and with or without the colon, as in `!logs metadata event member joined off`, or the event code, such as `member-add` or `audit-entry:20`. `!logs counters` shows open tickets, stored moderation cases, stored metadata records by category and the log posts that are waiting, failed or not confirmed

The dashboard's Channel logs section configures the same settings, including per-event overrides for twenty-two event types and eighteen audit actions. An event without an override uses its category route. An audit-action override, such as `audit-entry:20` for kicks, wins over the audit category. An enabled override sends even when its category is off, a disabled one suppresses the event, and `inherit` removes the override

Each category has a color: Membership green, resources blue, messages cyan, audit purple, settings amber and operations coral red. Shade shows the kind of change, with the darkest tone for destructive actions. A member leaving is neutral and unattributed, while kicks and bans proven by the audit log use the darkest tone

Each log post names the members, roles and channels of its record as mentions that notify no one and shows its time in each reader's timezone. Messages and webhooks appear by their IDs

Logged events cover member joins, updates and removals, role and channel changes, thread and forum post creation, changes and deletion, server updates, message edits and deletions and new audit log entries. Thread events use the resources category with their own event types `thread-create`, `thread-update` and `thread-delete`, and name the parent channel. A thread change names the changed fields `name`, `archived`, `locked` and `tags` when NeonFlux saw the thread before, since Fluxer sends only the new state. A thread NeonFlux merely joins is not logged as created. Deleting a channel deletes its threads without separate events, so one `thread-delete` record counts the threads NeonFlux knew in that channel. Records keep IDs, times, proven actors or unknown attribution, changed field names and counts. They never keep message text, attachments, reasons, raw audit changes or invite codes. Settings records cover moderation and log settings, security and DEFCON, metadata configuration and changes saved on the dashboard

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
for the record, `!logs metadata status` and `!logs metadata categories` name the channel, so route the category or event
to another channel. A post whose channel
could not be read for another reason, such as a timeout, a rate limit or a Fluxer server error, is tried again a minute
later. Logs are append-only and settled records expire after 30 days. While logs are off, the bot sends no gateway
events for a minute after the backend answers that they are off, or until a `!logs` command or a logs change on the
dashboard

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

Room commands act on the room you own. Put `#room` after the verb, such as `!voice limit #room 5`, to choose another room. Staff means the server owner, an Administrator or a member with a moderation staff role and Manage channels, the same rule as `!mod slowmode`. Generator commands are staff commands, and room commands are member commands that DEFCON 2 pauses

- A member owns at most one room. Joining a generator again moves them back to their room
- Fluxer does not let bots move the server owner or members ranked at or above the bot, and refuses a move into an occupied room whose members all use peer-to-peer voice. Their room is still created, and NeonFlux posts a link to it in the generator's text chat so they can join it directly
- A server has at most 10 generators and 50 live rooms. At the room limit NeonFlux creates no room and posts a notice in the generator's text chat
- Names and templates have 1 to 100 characters. Templates support only the `{owner}` placeholder
- Hiding keeps access for the owner and NeonFlux. The owner and NeonFlux cannot be blocked, and blocking does not disconnect a member who is already inside
- Room settings of a generator apply to rooms created after the change

| NeonFlux permission | Used for |
| --- | --- |
| View channel and Connect to voice where rooms are created | Seeing rooms and their voice activity, since Fluxer delivers voice events only for visible channels |
| Manage channels | Creating generators and rooms, renaming, member limits and deleting empty rooms |
| Move members | Moving members into their rooms |
| Manage roles | Hide, show, allow and block |
| Set voice region | Fixed regions, which Fluxer applies with an edit right after the room is created |
| Send messages in generators | Room limit notices |

### Room deletion

NeonFlux deletes only rooms it created and recorded. Generators and all other channels are never deleted automatically. A room is deleted after it has been empty for 45 seconds, which covers a member whose join Fluxer has not reported yet. Right before deleting, NeonFlux reads the room again and checks that it is still empty. Deleting a room or generator channel by hand removes its record

After a restart, a new connection for the server or a server outage, NeonFlux deletes nothing until Fluxer has sent a
fresh list of who is in voice, so an empty room can last a little longer. Rooms and owners are stored in the backend, so
a restart keeps room ownership. A server without voice activity makes no backend calls, not even at startup

These risks remain:

- If a Fluxer voice server fails, its voice list can report an occupied room as empty, and NeonFlux could delete that room. This is rare
- A member who joins in the last moment before a delete is disconnected. They can join the generator again to get a new room
- Deleting a room also deletes its text chat and disconnects anyone still inside

## Selective backup and restore

Only the current server Owner can use `!backup`, in a verified one-to-one DM with NeonFlux. Running it in the server returns only a private hint. Archives and reports stay private and suppress mentions

Attach an archive as NeonFlux sent it, with its name unchanged, such as `neonflux-backup-archive.nfb`. After `neonflux-backup-` a name may hold up to 128 letters, digits, `-` and `_`, so rename a copy such as `neonflux-backup-archive (1).nfb` first

| Command | Behavior |
| --- | --- |
| `!backup help` | Show the backup commands |
| `!backup export config xp structure` | Export only the categories you name |
| `!backup inspect` | Validate the attached encrypted `.nfb` archive and show its metadata |
| `!backup preview` | With an attached archive, check what a restore would change on the server as it is now and make the restore plan you can confirm for 15 minutes. It shows the first page of the plan, 10 items to a page, with blocked ones first. Without an archive, it shows the first page of the plan shown last. `!backup plan` does the same |
| `!backup preview match` | As preview, and the plan also deletes the channels and categories the archive does not hold. It needs the archive |
| `!backup preview next` | Show the next page of that plan |
| `!backup items [next]` | List the plan's items with their reasons, 10 to a page, problems first |
| `!backup confirm` | Run up to 20 items of the plan |
| `!backup status` | Show your newest plan that is not forgotten and how far it got |
| `!backup reconcile` | Recheck up to 20 created items with unknown results |
| `!backup forget` | Drop a settled plan and keep what it created |

Items, confirm, reconcile and forget work on the plan NeonFlux showed you last, through `!backup preview` or
`!backup status`, so a confirmation runs exactly the plan you saw. NeonFlux remembers that plan in memory. After a
restart, or once a plan expired, send `!backup status` to pick up your newest plan or attach the archive to
`!backup preview` again

A preview is the plan. NeonFlux reads the archive and the server fresh from Fluxer, decides each item and stores the
result as a plan that `!backup confirm` runs. Nothing changes until you confirm. Each item is one of these, with its
reason:

- Create: The server does not have it yet
- Update: The server has it with different values, and a restore changes it to match the archive. The preview names the
  changed fields
- Delete: Only with `match`. A channel or category on the server that the archive does not hold
- Identical: Nothing to do
- Blocked: A missing permission, a role or channel that no longer exists, a full limit or another reason keeps it out

The preview also says what a restore gives beyond the server as it is. It counts the items that give more permissions
than the server has now and names those permissions, and it counts the settings that turn on, because a restore copies
every on/off switch from the archive. It also counts the items that start to delete messages or post logs, but not a
channel delete, which has a line of its own. An item names its changed settings in words, such as cooldown seconds, and
a channel's parent as its category. A newer preview replaces the plan nobody confirmed, so the plan a confirmation runs
is always the one you saw last. A confirmed plan can run until it expires or is forgotten. A confirmation of a plan that
a newer preview replaced says so and points to `!backup status`, which picks up the newest plan, or to a new preview. A
preview names the reason when the archive cannot be read, when the restore refuses the archive as a whole and when the
key is missing. A server keeps at most 10 restore plans, and `!backup preview` past that names the limit. Every
confirmed plan counts toward the 10, forgotten or not, for at least seven days after it expires, and longer while a
created channel's outcome is unknown

Repeat the same confirmation until the plan finishes, within its 15-minute expiry. A restore stops writing as soon as
you are no longer the server Owner or the DM is no longer verified. An identical channel is checked
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
item runs. A published or withdrawing role panel is blocked until you withdraw it

- `config`: Authored settings for moderation, automod, responses, publishing drafts and templates, roles and unpublished
  panels, greetings, tickets, leveling, milestones, suggestions, cleanup, metadata logs and the event and schedule
  switches. Event and schedule definitions are excluded. A restore creates what is missing and updates what differs, so
  a setting you changed since the backup returns to its archived value. Settings that are not in the archive stay
- `xp`: Current-season XP for at most 500 members. A restore creates missing profiles and sets a differing profile to
  the archived XP, records the correction in the leveling audit and leaves members who are not in the archive alone. It
  queues no reward roles, so they follow at the member's next activity
- `structure`: At most 100 categories, text, announcement and voice channels with at most 500 permission overwrites.
  Names, parents, permissions, topic, NSFW, slowmode, bitrate and user limit are kept, and an announcement channel is
  restored as an announcement channel. Other channel types are skipped. Every overwrite is kept exactly as the server
  has it, with any permission it allows or denies, and a mask above 63 bits is archived but cannot be written back, so
  that channel is blocked. A restore creates a missing channel, with categories first and their permissions in the
  creation request. It updates a channel that exists with different values, which can be its name, category, topic, NSFW
  setting, slowmode, bitrate, user limit, text or announcement type and permissions. The position of a channel is not in
  an archive, so a restore leaves the order alone. A channel that a restore made and somebody deleted since is made
  again. A role or member that is gone is left out of a channel's permissions, and the preview marks each one it
  dropped. An overwrite for one that the server's channel already holds stays as it is
- Permissions: Fluxer decides what NeonFlux may write. A change that gives permissions needs NeonFlux to hold them in
  that channel itself, and the preview names the missing permission and the fix when it does not. The preview marks
  every channel that gives more permissions than it has now, with the others
- Categories: Fluxer copies a category's permission change to every channel whose permissions equal the category's, and
  offers no way to skip that. A restore therefore changes a category's permissions only when each of those channels ends
  with the same permissions anyway, because the archive gives it the same ones or because it is a channel of a type a
  restore does not archive, which the category's line names. Otherwise the category is
  blocked, and the reason names the channels and says to move them out of the category in Fluxer, check again and
  restore, then move them back. Moving a channel does not sync its permissions
- Tickets and voice rooms: NeonFlux labels the channels its tickets and temporary voice rooms made when it exports, and
  a restore skips them, so a backup taken during a call does not bring ended rooms back as permanent channels. A
  restore also never creates, changes or deletes a channel that has a ticket or a temporary voice room now, so an old
  archive cannot undo a closed ticket
- Match: `!backup preview match` also deletes the channels and categories of the archived types that the archive does
  not hold and that the bot can see. A channel goes with its messages, files, webhooks and invites, which cannot be
  undone, so the preview counts the deletions, lists each one first and warns before you confirm. NeonFlux does not
  delete a channel that tickets or voice rooms own, one it cannot manage, or a category that would still hold a channel.
  A category whose permissions change waits for a second run while it holds a channel that follows it and that match
  deletes, since the first run deletes the channel and the next check finds the category free. The plan, deletions
  included, holds at most 500 items. Channels and categories are the only things match
  deletes, and settings and XP converge in both modes
- Configuration that names an announcement channel restores like configuration that names a text channel

Archives exclude credentials, AFK text, birthdays, votes, RSVPs, member data, ticket bodies, moderation notes, audit history and live state. This is not a full server, database or message backup. Export refuses an archive that would exceed restore limits, so every archive can be restored. Restore limits are 1 MiB per snapshot, 512 KiB per archive and 500 plan items

Set `NEONFLUX_BACKUP_KEY` in the bot environment to a base64 32-byte key that is independent of the bot and backend
credentials. Without it, export, inspect and new previews are disabled and other features keep working. NeonFlux never
generates the key or sends it to Convex. Keep offline copies of the key and every archive, because a lost key makes its
archives unreadable and a changed key makes older archives unreadable until the old key is restored. Archives use
AES-256-GCM and are authenticated before parsing. Keys, URLs and file paths are never accepted in commands. Attachments
stored on the platform are not durable backup storage

## Server analytics

NeonFlux counts server activity for the dashboard's Analytics section. It keeps counts only, never which member did what

| Command | Behavior |
| --- | --- |
| `!stats` | Show joins, leaves, messages, the top three channels and the three busiest hours of the day, shown in each reader's time, for the last seven UTC days, including today |
| `!stats on` | Start counting for this server |
| `!stats off` | Stop counting for this server |
| `!stats help` | Show syntax |

Like `!prefix`, these commands work for the server owner and members with Administrator or Manage community, and other members get a refusal. Analytics starts on. The dashboard has the same switch

- Member joins and leaves are counted per UTC day
- Messages are counted per channel and UTC hour. Only ordinary and reply messages from human members count, commands included. Bot, webhook and system messages are never counted
- Messages in a thread or forum post count under its parent channel. The bot learns parents from the channels it keeps and reads a channel it does not hold once, so an archived thread also counts under its parent. If that read fails, the thread's messages in that batch count under the thread itself, and the next batch reads it again

The bot sends the counts in batches about every five minutes, so the dashboard lags by that much, and `!stats` sends the
open batch first so its reply is current. A server with no activity causes no backend requests. If the backend is
unavailable the same batch is sent again and never counted twice, and a batch not saved within a day is dropped. A crash
or forced stop loses the counts not yet saved, at most the last five minutes

`!stats off` stops counting at once and drops counts not yet sent. When the dashboard turns analytics off, the backend stores nothing from the bot's next batch, and the bot then stops counting. While analytics is off, member activity makes the bot recheck the setting at most every ten minutes, so turning it on from the dashboard resumes counting within about ten minutes of activity. Turning analytics off keeps existing counts. Channel and hourly counts expire after 35 days and daily join and leave counts after 400 days

## Multiple servers

Single mode is the default. The Convex deployment sets `NEONFLUX_SERVER_ID` and leaves `NEONFLUX_SERVER_MODE` unset or `single`, and the bot serves only that server

Multi mode runs NeonFlux as a public bot that serves every server it is in, with no server list or server limit. Remove `NEONFLUX_SERVER_ID` and set `NEONFLUX_SERVER_MODE=multi` in the [backend](BACKEND.md#multi-server-scope), then restart the bot, which adopts the mode. A bot environment that still names a server refuses to start until `NEONFLUX_SERVER_ID` is removed from it too

One bot token, process and backend serve every server. Each server has its own settings, queues and DEFCON level. Membership or permissions in one server grant nothing in another

### Add the bot to a server

Server owners and managers add NeonFlux from the dashboard's **Add NeonFlux to a server** link, shown only in multi
mode. It opens Fluxer's bot authorization with the permission mask `9008677076954326`:

| Permission | Used for |
| --- | --- |
| View channel, Send messages, Embed links, Read message history | Commands, replies, panels, logs and ticket transcripts |
| Add reactions | Reaction role and verification panels |
| Manage messages | Delete and purge actions and message cleanup |
| Manage channels | Tickets, slowmode, channel structure restore and temporary voice rooms |
| Manage roles | Role panels, autorole, verification roles, ticket access, lock and unlock overwrites and temporary voice room access |
| Connect to voice, Move members | Moving members into their temporary voice rooms |
| Set voice region | Fixed regions for temporary voice rooms |
| Kick members, Ban members, Time out members | Kicks, bans, timeouts, warnings and quarantine |
| View activity log | Audit entries in metadata logs |
| Change own nickname | Changing the bot's own nickname in that server |
| Send messages in threads, Create public threads, Create private threads | Channel locks and ticket closes, which deny these too, because Fluxer lets a bot deny only permissions it holds |

An owner can untick permissions when adding the bot. Channel locks and ticket closes then cover threads only for those thread permissions NeonFlux still holds

### Server registration

At startup the bot reads the backend's scope, then compares the backend's active installations with the servers its token is in. It registers servers that are missing, records the removal of servers it left while offline and starts the server runtimes four at a time. Servers the bot joins later share the same limit of four starts at once. Startup stops when either list cannot be read

When the bot joins a server, it registers the server with the backend and starts that server's runtime. Repeated join notifications after a reconnect change nothing. A join or a removal starts as soon as Fluxer announces it, whatever the state of the event queues and handler slots, and the joins and removals of one server are applied in the order Fluxer announced them, so a server removed and added again right away ends up served and registered. A server that becomes temporarily unavailable keeps its runtime. When the bot is removed from a server, it stops that runtime and records the removal. A removed server keeps its data for 30 days, and adding the bot again within that time restores it. After 30 days the backend deletes that server's data, as the [backend guide](BACKEND.md#server-data-after-removal) describes. A backend scope denial stops only that server's runtime. When a shard comes back with a new session instead of a resume, a server the bot was removed from meanwhile sends nothing, so the bot reads the same two lists as at startup once every local shard is connected again and records the removal of every server that Fluxer no longer lists, unless Fluxer announced that server again meanwhile. New sessions that overlap in time share one check. A resume replays what it missed and reads no list. In multi mode, a failed publishing recovery call or a failed role recovery call at a server's startup is logged and skipped, and the server's other features still start. The backend ages open attempts on its own. A failed first read of the role reaction jobs is logged as well, the reaction checks still run, and the jobs left from before a restart resume at the next restart, in both modes. Single mode stops on a failed publishing recovery call or role recovery call

Events for a server whose runtime is still starting wait and are handled once it has started, so a restart with many
servers does not stall other servers' handlers. A DM command for such a server does not wait, and gets
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
instead of printing it

The bot's presence shows only `NEONFLUX_CUSTOM_STATUS`, or nothing when it is unset, so no single server's DEFCON level or backend outage changes it
