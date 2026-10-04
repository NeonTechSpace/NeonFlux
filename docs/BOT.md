# Run and develop the bot

This guide is for operators running NeonFlux and contributors working on its bot. The bot uses Fluxerly's native Effect API and stores durable state in the Convex [backend](BACKEND.md). It ignores bot messages, webhooks, system notices and servers other than its configured server

Examples use the default `!` prefix. Each server can choose its own prefix, and the bot's help text prints that prefix. Commands sent in a one-to-one DM always use `!`

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
| `NEONFLUX_CUSTOM_STATUS` | Optional presence text of at most 128 UTF-16 code units, shown at DEFCON 3 |

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
- The bot never automatically repeats a native action whose outcome is unknown. Such work stays visible as uncertain, and status or reconcile commands read the exact known message or member without resending
- Durable worker state, such as greeting and schedule queues, lives in the backend. Workers resume it after a restart

## Ping, AFK, prefix and custom responses

### Prefix

Server owners and members with Manage Server change the prefix with `!prefix <value>`, or read it with `!prefix`. A prefix is one to five of these characters: `! $ % & * + , . ? ~ ^ | : / -`. `!prefix` always works, so a forgotten prefix can be recovered

The bot caches each server's prefix. A chat change applies at once and other changes apply within 30 seconds. If the backend cannot be read, the bot keeps the last known prefix, or `!` when it has none

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

Quarantine is a native timeout. A longer existing timeout is kept. Lock changes only the everyone role's Send Messages permission in that channel, and unlock restores it while keeping unrelated later changes. Other role or member grants can still let people speak

### DEFCON

| Level | Behavior |
| --- | --- |
| 3 | Normal operation |
| 2 | Staff commands and private appeals only. Public commands are blocked |
| 1 | Only critical owner or Administrator controls |

Use `!defcon status`, `!defcon diagnose` and `!defcon set 1|2|3`. Critical controls include status, diagnosis, DEFCON changes, disabling protections, recovery checks, unlock, release, untimeout and unban. Join bursts can raise the level to 2 when `raid-mode defcon2` is set, never to 1. DEFCON does not change channel permissions. The bot shows the level in its presence and restores it at startup

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

Reaction panels, rules verification and autorole each start disabled. The owner or an Administrator configures them. The bot needs Manage Roles and a role above every role it assigns. It only assigns roles with ordinary permissions, never everyone, privileged roles or staff roles, and it does not create roles

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

A member reacts to the rules panel or sends `!verify`. `!verify status` shows whether the acknowledgement was saved and the role granted. Administrators use `!verify reconcile|withdraw [@user] [cursor]`, `retire` and `next` for recovery

Plain reaction verification is an acknowledgement, not a CAPTCHA

### Autorole and reservations

Use `!autorole add|remove @role`, `!autorole list` and `!autorole module on|off`. Autorole applies to future joins only and to humans by default. `!autorole humans off` includes bots. When verification is configured, autorole waits for it

A reservation gives an exact user ID extra roles when that user joins or rejoins, even before they are a member. Use `!autorole reserve <user-id> @roles...`, `!autorole unreserve <user-id>` and `!autorole reservations`. Up to 100 users can have one to 20 reserved roles. Saving does not grant roles to current members, and removing a reservation does not take roles away. Recovery uses `!autorole retire [settings-revision]`, `next`, `history [cursor]` and `reconcile|withdraw @user [cursor]`

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

Creation sets the full conversation audience in the first channel request, and the introduction contains metadata only with mentions disabled. Close removes send access for everyone and the requester. Reopen restores the recorded permissions and leaves unrelated ones untouched. Staff keep send access, and Administrator permission still bypasses these overwrites. Renaming or moving a ticket channel does not block replies, close, reopen or delete

If close, reopen or creation is interrupted, the ticket stays unresolved until `!ticket reconcile` confirms the live state. NeonFlux never retries an operation with an unknown result or searches for a channel by name. After `!ticket abandon`, check the server for a leftover channel yourself. Erasing such a ticket also releases the slot but keeps protection for a channel that might exist

Private bodies require current server membership, the ticket's recorded requester and support-role access and native view and history permission. A requester who rejoins with the same account regains access. Deleting a channel needs explicit confirmation, a successful delete response and a fresh check that the channel is gone

Closed ticket bodies expire after 30 days by default, configurable from 1 through 365 days. Reopen is unavailable after expiry or erasure. Erasure removes stored copies only and never deletes messages already sent. Body retention never deletes native channels

Transcript capture is explicit and incomplete by design. Each stored message keeps at most 2000 characters of text with its author and timestamps. Attachment URLs and embed bodies are left out, and a capture that exceeds the storage budget is truncated with a notice. A failed capture stores nothing. Each ticket keeps at most 20 transcripts and 200 note entries. To share a public summary, write a separate publishing draft, because private content is never copied automatically

## Message leveling

Owners and Administrators configure message XP with `!level`. Current members can read `!rank` and `!leaderboard`. Rank cards are native embeds, replies suppress mentions, and cards and leaderboards show account IDs without storing display names or avatars

Leveling starts disabled with 15 XP per eligible message and a 60-second cooldown. Level N needs `100 * N²` lifetime XP, up to level 1000. Scores belong to the account in this server and survive leaving and rejoining.

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

Corrections apply in the order their commands were sent, so an older correction that arrives late is rejected. Copy the next-page command from a leaderboard reply to continue. Rows can shift between pages while XP is awarded, and a server reset invalidates older cursors. Rank is exact within the top 1000 and reported as outside the top 1000 beyond it. Members with zero XP are unranked

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

Posts go out at the configured local time in the server's zone. February 29 celebrates on February 28 in other years. Anniversaries count completed years from one. A late delivery still sends until local midnight, and a missed day does not use up that year's birthday. Enrolling skips a celebration already due. Automatic posts send as NeonFlux and need its channel permissions, the module and publishing switches and DEFCON allowance. Leaving the server ends consent

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
