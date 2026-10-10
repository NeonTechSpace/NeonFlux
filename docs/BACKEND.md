# Configure the backend

This guide is for operators deploying NeonFlux's Convex backend and contributors changing its contracts. The bot calls public Convex functions for every persisted feature, each checked with a key derived from the bot secret, and the web dashboard and verification pages use their own public Convex functions. See [the bot guide](BOT.md) for commands and [the web guide](WEB.md) for dashboard and verification setup

## Shared setup

### Configure a cloud development deployment

NeonFlux uses a Convex cloud development deployment. Use a [deployment-specific development key](https://docs.convex.dev/cli/deploy-key-types), which lets the CLI target that deployment without an account login on this machine. Do not use a production key or a preview or project token for this setup

1. Select the development deployment in the Convex dashboard
2. Open its deployment settings and copy its deployment URL, which normally ends in `.convex.cloud`
3. Create a development deploy key with permission to deploy functions and configure environment variables
4. Copy [the backend environment example](../projects/backend/.env.example), a template for the Convex CLI only, to `projects/backend/.env.local` and fill `CONVEX_DEPLOY_KEY`
5. Set the deployment's variables from [the table below](#environment-variables) through the dashboard: the server scope, `NEONFLUX_BOT_API_SECRET`, the website origin, the OAuth application ID and the Turnstile secret for web verification. Local `.env.local` values do not reach the deployed functions
6. Set the same secret in `projects/bot/.env`, with `CONVEX_URL` set to the copied deployment URL. The bot adopts the scope and the website origin from the deployment. See [the bot guide](BOT.md) for the bot token and the remaining bot settings

Keep the bot API secret separate from the Fluxer bot token, OAuth credentials and the Convex deploy key. The deploy key belongs only in the backend's local configuration. Never provision the whole backend `.env.local` with `convex env set --from-file`, because that would upload the deploy key into the application environment. Environment files are ignored, and only the examples belong in version control

The bot needs the deployment URL, not the HTTP Actions URL ending in `.convex.site`. The backend serves no HTTP actions. Copy the exact URL when using a custom domain. The backend uses standard Convex functions and environment variables with no cloud-only identity dependency, but a self-hosted deployment procedure is not documented or verified

### Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `CONVEX_DEPLOY_KEY` | `projects/backend/.env.local` only | Lets the CLI deploy to the development deployment |
| `NEONFLUX_SERVER_MODE` | Convex | `single` (default) or `multi`. The bot adopts it, and may set it too only as a check |
| `NEONFLUX_SERVER_ID` | Convex | The one allowed server in single mode. Must be absent in multi mode. The bot adopts it, and may set it too only as a check |
| `NEONFLUX_BOT_API_SECRET` | Convex and bot | Shared bot service secret of at least 32 characters, without surrounding spaces. The bot sends only a key derived from it |
| `NEONFLUX_WEBSITE_URL` | Convex | Optional website origin, such as `https://dashboard.example.com`, using HTTPS or loopback HTTP and without a path. The bot reads it for verification links and the install note, and the web server reads it as its own origin. A loopback origin is used only when set explicitly |
| `FLUXER_CLIENT_ID` | Convex | Fluxer OAuth application ID that dashboard sign-in tokens must belong to. The web server reads it from the deployment |
| `TURNSTILE_SECRET_KEY` | Convex | Cloudflare Turnstile secret for verification starts |
| `TURNSTILE_HOSTNAMES` | Convex | Optional comma-separated exact lowercase hostnames without scheme, port or path. Defaults to the host of `NEONFLUX_WEBSITE_URL`. Set it only when Turnstile reports another hostname |
| `NEONFLUX_BACKUP_KEY` | Bot only | Optional base64 encoding of exactly 32 bytes. Leave it absent to disable backup archives |
| `NEONFLUX_MONTHLY_CALL_BUDGET` | Convex | Optional monthly budget in billed function calls for the [bill guard](#bill-guard). Leave it absent to turn the guard off |
| `NEONFLUX_BUDGET_WARNING_SHARE` | Convex | Optional share of the budget at which the bill guard warns, above 0 and below 0.9. Defaults to 0.65 |

Invalid or ambiguous scope configuration, an invalid `NEONFLUX_WEBSITE_URL` or a short or padded bot secret fails closed with `503 Backend not configured` and logs the variable to fix, never its value. Generate the bot API secret randomly and rotate it in Convex and the bot together

### Service authentication and errors

The bot reaches the backend through the public functions in [botService.ts](../projects/backend/convex/botService.ts), one for each path listed in this guide. The [service contract](../projects/contracts/src/service.ts) lists every function by name and whether it is a query or a mutation, and the bot maps each path to its name in [backend-routes.ts](../projects/bot/src/backend-routes.ts), so `/general/manage` is `botService:generalManage`. Each call carries `key`, the bound `serverId` and the `request`

The key is the lowercase hex HMAC-SHA256 of the fixed label `neonflux/bot-service-key/v1` from the service contract, keyed by `NEONFLUX_BOT_API_SECRET`. The bot derives it and never sends the secret, so the secret does not appear in function arguments and keeps its other uses, such as leveling digests. Each function first checks the server scope and the secret, then compares the key in constant time, before it reads anything. Changing the label changes the key on both sides

The function then binds the request to one server, as described in [multi-server scope](#multi-server-scope), checks the path's body limit against the request's JSON text in UTF-16 code units and that the request is a JSON object, and checks the origin of native evidence. It runs the feature's own service function handler in the same transaction, and that handler checks the installation first. A bot function never calls another function, so each bot request is billed as one function call. The feature functions stay internal, and the scheduler still calls some of them directly. IDs are canonical positive decimal strings within the signed 64-bit range. Object field names in requests must be ASCII, as Convex values require

Mutations answer `{ value, dueIn }`. `dueIn` is present when the mutation's writes created background work, in milliseconds from now by the backend clock, so the bot's [work dispatcher](#background-work-dispatch) can run at that time

Every request and answer has a schema in the [contracts package](../projects/contracts/). Each function decodes its request with it before its own checks, refusing a mismatch or an unknown key with `400`, and the bot decodes every answer with it. The backend owns the domain rules. It trusts actor, permission, membership and private-conversation facts only because the bot's key vouches for them, so these fields never authenticate a browser user

Chat commands carry no revision numbers. Where a write needs the revision it changes, the bot reads it from the feature's query right before the write, so of two chat changes the later one wins. Dashboard saves keep their revision checks, as [the dashboard guide](WEB.md#saving-and-live-updates) describes

| Status | Meaning |
| --- | --- |
| `400` | Invalid input, or a request value JSON cannot carry |
| `401` | Missing or wrong key |
| `403` | Authorization denied, or a scope denial carrying `code: "NEONFLUX_SCOPE_DENIED"`. Some refusals carry a reason code, see below |
| `404` | A missing record, or an installation function in single mode |
| `409` | Conflict, such as an existing name or a stale revision |
| `413` | Request over the path's limit |
| `429` | A remaining capacity bound was reached |
| `503` | Missing configuration or an unexpected backend failure |

Failures are Convex errors whose data holds the status, a fixed `error` message and, for scope denials and the refusals
below, a code. Unexpected failures answer `503` and are logged without request bodies or keys. Each path's body limit is
set in [botService.ts](../projects/backend/convex/botService.ts)

A refusal the bot can explain with a fix carries a stable reason `code`. For every code except `REFUSED` the bot reads
the code and never the message, and turns it into a reply that says what to change, using the native facts it read for
the request. A `REFUSED` message is already a sentence for members with its next step, so the bot shows it as it is

| Code | Meaning |
| --- | --- |
| `BOT_PERMISSION` | The bot lacks the native permission for a moderation action or a role change |
| `BOT_BELOW_TARGET` | The bot's highest role does not rank above the target member's |
| `ACTOR_BELOW_TARGET` | The actor's highest role does not rank above the target member's |
| `ACTOR_PERMISSION` | The actor lacks the native permission for the action |
| `TARGET_PROTECTED` | The target is the bot, the server owner, an Administrator or the actor |
| `ROLE_NOT_ELIGIBLE` | A role is not below the bot and the actor, carries more than ordinary member permissions or is a staff role |
| `REFUSED` | A refusal a member can act on, such as a name already taken, a feature that is off or a closed vote. The `error` message is the sentence the bot shows |

### Checks

Run these from `projects/` after configuring the deployment

```sh
pnpm --filter @neonflux/backend run codegen --typecheck disable
pnpm run check
pnpm run deploy:dev
```

Codegen uses the existing deployment and writes `convex/_generated/` without publishing functions. Keep those generated files in version control and regenerate them when the schema or function interface changes. `pnpm run check` checks formatting, then runs the contracts, backend, bot and web checks. `pnpm --filter @neonflux/backend run check` runs only the backend typecheck and its Node tests, which call the bot's public functions through `convex-test` with synthetic credentials and need no deployment credentials. `pnpm run deploy:dev` runs `convex dev --once --typecheck disable`, which publishes one development update and exits. Use `pnpm --filter @neonflux/backend run dev --typecheck disable` to keep watching files

Retention cleanup runs as one chain that a Convex cron starts every ten minutes, so an idle deployment runs it 144 times a day. Each run visits every feature's cleanup in bounded batches and repeats a feature while its batch is full. A run stops after about 2,048 documents or 4 MiB and schedules the next run at once, so a backlog drains in back-to-back runs. A feature whose full batch changed nothing waits for the next run instead of repeating. While a run is scheduled, the cron leaves it alone. Expired rows wait at most ten minutes, and nothing depends on an earlier run. A timeout or ban recovery whose known end has passed stops restricting its member at once, because role participation, leveling, tickets, message cleanup and backup restore ignore it before retention deletes it. A feature whose cleanup fails runs in its own sub-transaction on later runs until it succeeds, so other features keep their retention. Analytics keeps its own hourly prune, and the hourly purge of removed servers is described in [server data after removal](#server-data-after-removal)

### Opt-in live smoke runner

The script is described in [the bot guide](BOT.md#live-moderation-check)

## Bot foundation

### Threads and channel rules

For a message in a thread, the bot sends the thread's parent channel as `parentChannelId` with `/moderation/evaluate`, `/responses/evaluate`, leveling candidates and metadata message events. It is validated like any other ID and must differ from the message's channel. Channel rules then match the thread or its parent: automod channels and exemptions, honeypot channels, response channel restrictions, leveling's excluded channels, and metadata logs' message channels, excluded channels, log destinations and ticket channels. `automodWindows` keeps the parent with each message, so a rule scoped to a channel counts its threads' messages too. Without `parentChannelId`, rules match only the message's own channel

### Prefix

`generalSettings` stores one row per server with the command prefix, a revision, and the update time and actor. The prefix is one to five punctuation characters and defaults to `!`. Changes require Manage community evidence and the expected revision

The same row stores the desired bot nickname, absent when the bot's username should show, and the result of the last explicit change: pending, applied or failed with a reason. Nicknames have 1 to 32 UTF-16 code units, with no control characters and no surrounding spaces. Chat changes through `/general/nickname` and dashboard changes through the `nickname` configuration family share one family revision. The bot applies each change natively and reports the result through `/general/nickname-result`, which keeps only the result for the latest revision and nickname

### AFK

`afkStatuses` stores one active record per server and member: Member ID, trimmed reason of 1 to 200 UTF-16 code units, and a backend timestamp. Setting AFK replaces the reason and timestamp. The member's next ordinary message deletes the record, and the same mutation looks up at most five mentioned members, deduplicated and excluding the author. There is no automatic expiry or message history. Reasons are visible to anyone who mentions the member

### Custom commands and autoresponders

`responseDefinitions` stores content, matching rules, channel and role restrictions, cooldown, priority, enable state and timestamps. `responseSettings` stores separate module switches for custom commands and autoresponders, both enabled by default. New definitions are enabled, unrestricted and have a five-second per-user cooldown

- Names: 1 to 32 letters, numbers, underscores or hyphens, starting with a letter or number, lowercase and unique per kind. Every bot command namespace, such as `prefix`, is reserved
- Cooldown: A stored wait ends early when its definition's cooldown is set to 0
- Limits: 100 definitions across both kinds, ten per list page, 2,000-unit text, 256-unit embed title, 4,000-unit embed description, 200-unit literal trigger, 20 channel and 20 role restrictions, cooldowns from 0 to 3,600 seconds and priorities from -100 to 100
- Matching: Custom commands compare the whole first token case-insensitively. Autoresponders compare trimmed content as exact or contains, never match prefixed messages, and pick by higher priority, then exact over contains, then name
- Rendering: Placeholders are `{user.name}`, `{user.id}`, `{user.mention}`, `{channel.id}`, `{server.id}` and `{args}`. Unknown placeholders are rejected, substitution runs once, limits are rechecked afterwards and all replies disable mentions

`responseReceipts` stores source message IDs and the reservation, without source content, usernames or rendered replies. `responseCooldowns` stores per-definition, per-user eligibility deadlines. Source events must be at most 15 minutes old or one minute in the future. Evaluation first reads the module switches and the prefix. A command then reads only the custom definition of its name and other text only the autoresponders, so most messages read few or no definitions and write nothing. Only a reply reserves the source message and cooldown, atomically, so a redelivered event that replied never gets a second reply, while one that matched nothing may reply after a matching definition appears. The bot sends `roleIds` only after it has read the author's member, from its member cache when it holds one, which member events keep current, and without them the backend answers `{ send: false, memberRequired: true }` when a definition could reply. A custom command that exists but does not reply, for example during its cooldown, answers `{ send: false, defined: true }`, so the bot suggests no built-in command for it. The bot does not retry an uncertain send. Receipts expire after 24 hours and expired cooldowns are removed by the cleanup cron

## Moderation, protections, DEFCON and appeals

The backend owns settings, validation, permission policy, action reservations, numbered cases and appeals. The bot owns fresh native permission and hierarchy checks and the platform actions. Configuration requires the server owner or an administrator, and other staff need a configured role for each operation

Manual moderation covers warnings, timeout and clearing, kick, permanent and temporary ban, unban, bounded message deletion, slowmode, and channel lock and restore. It starts enabled. Automod and security detection start disabled and in dry-run mode. Each case records source, actor, target, reason, action outcome, correction history and separate staff-log and warning-notice outcomes. A grant belongs to one source and case and is never replayed after a lost response or uncertain write. Actions, logs and notices still pending when the bot starts are marked uncertain once

- Automod: Message frequency, repeated content, mass mentions, literal words, domain allow or block lists and invite patterns, with channel scopes and exemptions. Detection uses message text and metadata only. One source message reserves at most one action. Repeated-content checks read only the member's recent messages with the same content hash
- Gate with evaluation: A member message's `/moderation/evaluate` may carry `gate: { actor, command }`, the same fields `/moderation/gate` takes, and then answers the gate as `gate` too. While message protection is off, such a request returns at once and writes nothing. `/moderation/join` answers the settings, from which the bot derives the gate for a join
- Protections: Join bursts, an opt-in honeypot channel that quarantines through a native timeout, and a local watchlist each create a classified case (`join-burst`, `honeypot` or `watchlist`) shown through the case commands. One join-burst case covers a burst window
- Recovery: Owned timeout release and channel restore link a new case to the original action. Channel lock changes the
  everyone role's `SendMessages`, `SendMessagesInThreads`, `CreatePublicThreads` and `CreatePrivateThreads` overwrite
  bits, and the bot first allows itself in the channel the bits it is about to deny, unless it is an Administrator.
  Unlock leaves that allow in place. The bot reports the posting bits it holds server-wide as `botPostingPermissions` in
  the action context, and a lock owns `SendMessages` plus only those thread bits, because Fluxer lets a bot stop denying
  only permissions it holds. The lock's recovery record and the lock and unlock grants carry the owned bits as
  `ownedPermissions`, and unlock restores only them
- DEFCON: Durable and restored after restart. Level 3 is normal, level 2 blocks public commands while staff work and private appeals continue, and level 1 allows only critical owner and administrator controls. Changing DEFCON does not lock channels

Member appeals use verified one-to-one DMs and reveal only the member's own cases and appeals, so banned users can appeal where Fluxer allows private messages. Staff review requires fresh authorization. A decision records the outcome, and any reversal is a separate explicit moderation action

Cases and closed appeals are retained for a fixed 180 days, and records needed for active recovery are excluded from expiry. Explicit owner erasure removes a case's private text, including corrections and appeal decisions, and keeps a minimal tombstone. Erasure does not remove messages already sent to staff channels, DMs or Fluxer's audit log

## Publishing and scheduled publishing

### Publishing

Publishing stores named drafts and templates (`publishingDrafts`), tracked messages with their latest confirmed content (`publishingPosts`), immutable send and edit attempts (`publishingAttempts`) and management receipts. The module starts enabled. The destination must be a text or announcement channel in the server

Content is up to 2,000 UTF-16 code units of text and one rich embed with title, description, URL, color, timestamp, author, footer, image, thumbnail and up to 25 fields, within the 6,000-character embed total. URLs use HTTP or HTTPS without credentials, and mentions are disabled. An edit verifies the exact tracked message, bot author, channel and preceding confirmed content first. The provider has no conditional edit, so an external change can still race

A send or edit grant expires after 180 seconds and needs a one-time dispatch claim, followed by a native request bounded to five seconds. Only an explicit SDK `notDispatched` result proves a request was not sent. Other failures stay uncertain and are never replayed. Staff can resolve a post with an unknown outcome by stating that it was sent with a given message ID or that it failed

Drafts, templates and tracked posts persist until deleted or forgotten. Event, schedule and milestone posts are forgotten with their history once it expires, unless their outcome is unresolved or a role panel uses them. Lists hold 10 rows: Drafts and templates in name order, where `afterName` continues after the last name of a page, and posts newest first, where `beforePostNo` continues before the last post of a page. Terminal attempt history is retained for a fixed 180 days, and management receipts for 24 hours

### Scheduled publishing

Schedules copy the exact revision of a named draft or template and store a finite civil plan: Local time, IANA zone, fold policy for repeated minutes and daily or weekly recurrence with an interval of 1 to 12. Nonexistent local minutes are rejected. A plan has at most 26 occurrences within 180 days, and the saved UTC instants stay frozen. Schedules start disabled. Content and plan changes replace only future unclaimed occurrences

Automatic sends act as the bot. They need the bot's channel permissions, the schedule, scheduling module and publishing switches, and an allowing DEFCON level. Administrators are checked when configuring. A late occurrence still sends until local midnight after its due time. While DEFCON is below 3, or while the schedule, the scheduling module or publishing is off, `list` holds a due occurrence instead of returning it, so the bot reads nothing from Fluxer for it and nothing checks it every minute. The occurrence is checked again at that midnight, when it is skipped as late. Turning a switch back on cannot make a held occurrence sendable, since the activation skips occurrences due before it, so turning it on wakes nothing and the occurrence is skipped as before the activation at that check. An occurrence with an open reservation is checked again earlier, when the reservation's grant ends, so `list` can close the reservation. Setting DEFCON to 3 schedules a wake that makes the held occurrences due again. It reads 20 due active occurrences per transaction through `scheduleDeliveries.by_server_due`, schedules the next page and stops if DEFCON falls below 3 again. Delivery reuses the publishing claim, outcome and reconciliation routes with `scheduleContext`

Limits are 50 schedules, 200 retained occurrence rows and 1,000 management receipts per server. Terminal history is kept for 180 days. A content, time or destination update deletes the future occurrences it replaces that have no attempt or claim, and keeps the others as superseded

## Role panels, reaction verification, autorole and reservations

Role panels, rules verification and autorole start disabled, and configuration requires the server owner or an administrator. Enabling a module does not scan the roster or assign roles retroactively

- `roleSettings`: Module switches, humans-only autorole, default autoroles and up to 100 per-user autorole reservations, applied with default autoroles when that user joins
- `rolePanels`: At most 50 reaction panels and one verification panel per server, each bound to an exact published message with up to 20 mappings that may list prerequisite and exclusion roles
- `roleAcknowledgments`: Rules acknowledgment, kept separate from delivery of the access role
- `roleOwnership` and `roleReferences`: Which roles the bot added for each member and membership epoch and which features still need them
- `roleAttempts`, `roleWithdrawals`, `roleParticipationReceipts` and `roleReactionJobs`: Grants and outcomes, explicit withdrawals, source deduplication and bulk reaction-removal progress

Each command, reaction or join is evaluated as its own source, and a participation receipt only records that the source was applied, so a redelivered event grants nothing twice. The bot rechecks membership, role permissions and hierarchy before every assignment and never assigns the everyone role, privileged roles or roles above its own. Removal needs confirmed bot ownership in the same membership epoch and no other feature reference, so pre-existing roles are never removed. Grants use a one-time claim within 180 seconds and a five-second native request, and uncertain writes are not replayed

A reaction on the current verification panel acknowledges the rules. Configured verification gates autorole and
self-service roles, while native timeouts and unresolved quarantine block participation. Changing mappings or rules
requires a new published message. Withdrawal and history are available through chat commands only. Each revision of a
panel keeps its own configuration references and its own withdrawal, a `withdraw` or `autorole-withdraw` operation is
deduplicated by its message and revision so one command can withdraw several, no autorole revision is withdrawn while
the current autoroles or reservations still name a role, and an exclusive choice treats the grants of every revision of
the panel as its own. Settled role history is retained for a fixed 180 days, while active and unresolved ownership
stays. When a later membership epoch records its first acknowledgment or ownership, settled rows from the member's
earlier epochs are released, and unresolved ownership stays until it is reconciled, which also finds it after the member rejoined

## Role picker and member access

`memberAccessLists` keeps one row per server and feature name with allowed and blocked role and user IDs, up to 100 of each. The role picker uses the feature name `rolepicker`. A block always wins, and empty allow lists admit every member who is not blocked

`rolePickerSettings` keeps the switch and up to 10 menus per server, each with up to 25 roles, and a role belongs to one menu. Chat changes through `/rolepicker/manage` need the owner or an Administrator, like other role settings, and dashboard saves use the `rolepicker` configuration family. Both share one family revision. Every role placed in a menu passes the same self-service checks as reaction panel mappings against fresh native role snapshots

Website member requests are `dashboardConfigurationJobs` rows of the `member` family, so they expire and are retained like other dashboard jobs, and a queued request that has not expired lists its server under the `dashboard` work kind of `/service/work` and raises the work signal. The public `rolePicker:request` mutation rechecks the dashboard session, the installation and the switch, then queues a claim, a drop or a lookup. It allows 10 claims or drops and 10 lookups a minute per member and server, 3 pending requests per member and 50 queued requests per server, and answers with `429` above them. A request fails after two minutes without the bot, and its record keeps only IDs, the operation and the outcome for one day

The bot reads queued requests through `/rolepicker/ready` and sends a fresh native member read with the server's role names and colors to `/rolepicker/start`. A lookup ends there and stores the member's role IDs and the names and colors of menu roles only in `rolePickerSnapshots`, which are deleted ten minutes later. Menu saves from chat and the dashboard also send the bot's current role names, and each menu keeps the names of its own roles as a display fallback. The website never reads roles with the member's sign-in. A claim or drop continues through `/roles/evaluate` with a `pick` operation and the usual dispatch and outcome routes under the consumer key `picker:<menu>`, so role ownership and other features' references decide what may be removed. `/rolepicker/complete` records applied or failed from the member's roles after the change and the recorded attempts, and an uncertain outcome is never replayed

## Welcome and goodbye

Channel welcomes, optional DM welcomes and channel goodbyes are independent routes that start disabled and accept human members only. Each route copies an exact publishing template revision. Text fields accept `{user.name}`, `{user.id}`, `{user.mention}`, `{server.name}`, `{server.id}` and, for channel routes, `{channel.id}`, with display text escaped. Only the greeted member can be notified, through `{user.mention}`

Welcome timing is `join` or `verified`. A join must be a genuine event within 15 minutes whose native `joinedAt` matches fresh membership. Verified timing needs the current rules acknowledgment and fresh access-role presence. A goodbye needs a fresh typed member `404`, after either a retained presence observation or a removal event for a human account the bot had not recorded. Enabling a route never backfills earlier joins

While DEFCON is below 3, `pending` hands out no candidate, because every reservation would be refused, so the bot reads
nothing from Fluxer for a greeting. It sets `nextCheckAt` ten minutes ahead while any greeting waits, so the bot checks
once per ten minutes. The greeting is handed out at the first check after DEFCON is 3, up to ten minutes later, if its
24 hours have not passed. While rules verification is not usable, which means the setting is off or the verification
panel is disabled, being withdrawn, unpublished or edited but not republished, `discover` moves a waiting verified
greeting's check ten minutes ahead instead of one. It goes back to one minute at the first check after verification is
usable, up to ten minutes later. Pending work expires after 24 hours, grants after 180 seconds, and native requests are
bounded to five seconds. Claimed sends are never replayed. One server-wide budget spaces claims across the three routes,
ten per minute by default and configurable from 1 to 60. Workers read deliveries and members in bounded pages. A member
record expires 365 days after the join it records, or one day after the member leaves, and a later presence check does
not extend it. Terminal history defaults to 30 days, configurable from 30 to 3,650

## Tickets

Tickets start disabled. Owners and administrators configure up to 20 categories, each with visibility, an optional parent, disclosed support roles, up to five intake questions and up to 20 copied canned replies. Submitted tickets keep snapshots of their category and replies

Intake runs in a verified one-to-one DM. Drafts expire after 24 hours, and each requester can have at most three drafts
and three active tickets. A plain DM names no server, so `/service/ticket-intakes` takes `{ userId }`, binds no server
and answers up to 10 of that member's live drafts as `{ serverId, intakeNo }`, limited to the configured server in
single mode. The bot then reads and changes the draft through the server's own intake functions, which keep every
membership, DM and policy check. A `clear` intake operation empties one answer, so a plain reply can step back to that
question. Private answers, staff notes and transcripts need fresh membership, role authority and a verified DM. Creation
sends the full permission set in the initial request. Close and reopen change only the everyone and requester
`SendMessages`, `SendMessagesInThreads`, `CreatePublicThreads` and `CreatePrivateThreads` bits. A close owns
`SendMessages` plus the thread bits the ticket context's `botPostingPermissions` reports, records them as the ticket's
`ownedPermissions` until reopen completes, and each close or reopen grant carries the bits it owns. Another overwrite
allowing an owned bit blocks the close, and deletion needs explicit confirmation on a closed channel. The bot first
allows itself the owned bits in the channel, because Fluxer lets it lift a denial only of bits it holds there. A
reconcile that finds a first close or reopen step unchanged restores the ticket's state before the command (open or
closed, with its slot and body expiry), and one that finds an established channel gone retires the ticket, starting body
retention if none is running. It needs no attempt when retention already removed the last action, and an unconfirmed
creation or delete keeps its own rules. An unknown creation is never replayed or adopted. `!ticket abandon` releases the
requester's slot for such a ticket while native and support-role protection stay

Transcript capture stores each capture of up to 500 messages and 200,000 characters as `ticketTranscriptPages` rows of 1,500 characters, so lists read only small headers and a page read loads one page. Reads show a truncation notice. Erasure hides every capture at once and then deletes its pages in bounded batches. A capture keeps text, message, author and channel IDs and timestamps, without attachments, embeds, intake answers or staff notes. Each ticket has at most 200 authored entries and 20 transcripts, of which the requester can save 5, so staff can still capture. Failed captures store nothing

Closed-ticket private content expires after 30 days by default, configurable from 1 to 365. Explicit erasure hides private content immediately and then removes it, without deleting provider messages or the channel. Terminal attempt history and settled ticket tombstones expire after 30 days

## Message leveling

Leveling starts disabled with 15 XP per message and a 60-second cooldown, configurable from 1 to 100 XP and 15 to 3,600 seconds, with up to 50 excluded channels and 50 excluded roles. Level N begins at `100 * N²` XP, capped at 100 million XP and level 1,000

Profiles store account XP and survive rejoining. Leveling stores no message bodies, names or avatars. Duplicate content is detected with an HMAC digest keyed by the bot API secret, keeping up to 64 recent digests per account for ten minutes. Events older than ten minutes or before the current membership earn nothing. Chat commands take no revision numbers

Owner and administrator corrections set absolute XP and apply in source command order. Resets need explicit confirmation, and a server reset hides old scores immediately. Credited receipts expire after a day and correction audits after 180 days. Profiles are capped at 50,000 per server. Leaderboards return 10 profiles per page. `levelingLevels` counts the profiles with XP at each level of the current score epoch, so a rank sums the counts of higher levels and reads at most 101 profiles of the member's own level. The rank is exact unless more than 100 of them score higher, when it is the range of positions the level allows. Awards, corrections and imports move a profile's count only when its level changes, and a server reset drops the old epoch's counts. Up to 20 reward roles are applied through the shared role ledger. Awards, corrections, resets and mapping changes mark accounts, and the worker clears a mark only after a fully settled pass. An account whose pass did not settle is tried again a minute later. The bot's `done` operation carries `held` when the backend refused its role changes, which DEFCON does for additions, and nothing else was left unsettled, so not a removal that failed another way, not another target that is blocked and not retained references beyond one pass. While DEFCON is below 3, which refuses new reward grants, the backend waits an hour for such an account instead, and it checks DEFCON itself. A removal refused for another reason while DEFCON is below 3 also waits the hour, and any other failure is tried again after a minute. Returning to DEFCON 3 schedules a wake that makes the waiting accounts due again. It reads only accounts due more than a minute ahead, which leaves out the minute retries, since they come due on their own within a minute, makes 20 accounts due per transaction through `levelingProfiles.by_reward_due`, raises the work signal, schedules the next batch while a batch is full and stops if DEFCON falls below 3 again

## Events, birthdays, anniversaries and suggestions

These features share publishing's protected posts and claim lifecycle. Their automatic sends act as the bot and need the bot's channel permissions, the module and publishing switches, and an allowing DEFCON level. Administrators are checked when configuring

### Events and RSVPs

Events start disabled. A title has up to 256 code units and a description up to 1,000, the same bound in chat, the dashboard and the contracts, so the event detail reply fits one message. Each definition has a frozen calendar of at most 26 occurrences within 180 days, using the same civil rules as schedules, with durations from 1 to 10,080 minutes. RSVPs store one record per account and occurrence with the membership token, without names or message bodies. Capacity is off or 1 to 500 seats with a first-in waitlist. Reminders default to 1,440 and 60 minutes before start and are skipped once five minutes late or when the event starts. While events or publishing are off or DEFCON is below 3, `list` returns no reminder, so the bot reads nothing from Fluxer for one and the work dispatcher does not list it. A reminder stays due, and is listed again, with a work signal, when events or publishing are turned on or DEFCON returns to 3, if its five minutes have not passed. At the end of its window it is listed once more so that `list` closes it like any late reminder

Limits are 50 definitions, 200 retained occurrences, 1,000 RSVPs per occurrence and 50,000 overall. Source receipts are kept for 24 hours and terminal event history for 180 days

### Birthdays and membership anniversaries

Two annual routes are configured separately, each with a template snapshot, destination, IANA zone and local time. Members opt in privately through DMs. Birthdays store month and day only, never a year or age, and February 29 maps to February 28 in non-leap years. Anniversaries keep the exact native `joinedAt` and count complete years. Leaving the server or changing the destination revokes consent. A date that already passed when a member signs up waits for next year and records no skipped delivery. The staff `deliveries` query leaves out a birthday delivery's due, check and claim times, its offset and a clock-change skip reason, so staff cannot read birthdays from it

A late delivery still sends until local midnight, and a missed day does not consume that year's birthday. While DEFCON is below 3, or while the route, the milestones module or publishing is off, `list` holds a due delivery instead of returning it, so the bot reads nothing from Fluxer for it and nothing checks it every minute. The delivery and its enrollment are checked again at that midnight, when the delivery is skipped as late. Turning a switch back on cannot make a held delivery sendable, since the activation skips deliveries due before it, so turning it on wakes nothing and the delivery is skipped as before the activation at that check. Unlike schedules, an open reservation does not end the hold early, since the milestones `list` does not close reservations, so an earlier check would change nothing. Setting DEFCON to 3 schedules a wake that makes the held deliveries due again. It reads 20 due active deliveries per transaction through `milestoneDeliveries.by_server_due`, makes each one's enrollment due, schedules the next page and stops if DEFCON falls below 3 again. Removing enrollment deletes it immediately. Settled deliveries retire after 30 days, and body-free fences that prevent a second celebration in the same year stay for 400 days. Limits are 1,000 enrolled accounts, 4,000 retained deliveries, 1,000 staff receipts and 10,000 member receipts per server

### Suggestions

Each suggestion stores its text, status, vote counts and a protected card. Each account has at most one vote per suggestion, and votes take no revision numbers. Status keeps only the latest reason, actor and time. Voter IDs stay out of public projections but are visible to database administrators. Card updates coalesce for five seconds before an edit is queued

Limits are 1,000 retained suggestions, 1,000 voters per suggestion and 10,000 per server, 1,000 staff receipts and
10,000 member receipts. Terminal suggestions expire after 180 days. Forgetting removes backend data without deleting
posted cards. A `configure` with a null channel clears the destination and turns suggestions off, and its revision check
works as for any other configuration

While DEFCON is below 3, `list` returns no cards and the work dispatcher does not list the server for suggestions, as while suggestions or publishing are off. Cards keep their changes and stay due, and returning to DEFCON 3 raises the work signal, so the bot lists them at once

## Message cleanup and metadata logs

### Automatic message cleanup

Cleanup starts disabled at module and channel level. Each channel policy sets an age from one hour to 365 days and can
exclude up to 50 authors and 100 messages, with at most 50 policies per server. Enabling a policy needs explicit
confirmation because existing old messages may be deleted. Automatic work runs under the server automation policy: The
bot's permissions, the module and policy switches, and DEFCON. The atomic backend claim is the final check before each
delete. A claim of a queued target reserves it in the same mutation, so each deletion costs one claim and one outcome. Every target expires 30
days after it settles, also one whose deletion failed or has an unknown result, because a message delete is safe to
repeat once its record is gone. Retention keeps an expired target that is still active and checks it again a day later,
so kept targets never hold up later expired ones. A policy can be deleted once none of its targets is active. A sweep
that reached the end of a channel sets the policy's next check 15 minutes ahead instead of one minute

Pinned, system, webhook, bot and unclassifiable messages are skipped, as are protected publishing and panel messages. No message bodies or attachments are stored. Delete grants expire after 120 seconds with a five-second native request, and uncertain deletes are not retried. Settled audit expires after 30 days

### Metadata logs

Metadata logs record body-free server events, such as configuration, member, channel and role changes and 18 audit-log actions, into configured log channels. Settings hold module and category routes, per-event overrides, message opt-ins and channel exclusions. Records keep changed-field names and at most 20 resource IDs. Thread events are the resources types `thread-create`, `thread-update` and `thread-delete`, which require `parentChannelId`. A `thread-delete` record for a deleted parent carries the count of the threads the bot knew, with up to 20 of their IDs

Each server retains at most 10,000 records, and the oldest are evicted at capacity. There is no daily cap. While no
channel is listed for message logging, the admit answer for a message event is `messages-off` and writes nothing, and
the bot skips message events for a minute or until a `!logs` change. Settled records expire after 30 days. Delivery runs
as the bot under the automation policy with a 120-second grant and five-second request, and uncertain sends are not
replayed. `!logs metadata status` reports the bot's current permissions in each enabled destination

The bot reports a destination that Fluxer answered does not exist with the work operation `destination-missing`. It
settles an unclaimed queued, reserved or retried delivery as `failed` with `noDispatch` and `problem: "channel"`, which
is never discovered, reserved or deferred again and expires with its record. A repeated report returns the settled
record, and a claimed delivery is refused, so its unknown outcome stays open. Any other failed read of the destination
is deferred by a minute. A claimed delivery that a retryable failure such as a rate limit stopped before it ran is
reported as an `outcome` of `failed` with `unsent`, which settles it as `failed` with `noDispatch` and due a minute
later, without its claim, so a fresh generation may reserve it. Every other unsuccessful send stays uncertain and is not
replayed, and such a send that returned no message may be forgotten once its window has passed

`discover` returns a waiting delivery only while DEFCON is not 1 and the module and the delivery's category or event route are on. Otherwise it sets the record's `nextCheckAt` to its expiry, so neither `discover` nor the work dispatcher sees it again before then. Turning the module, a route or an event route on wakes the waiting deliveries whose module and route are now on. Changing DEFCON from 1 to 2 or 3 schedules the same wake. Nothing wakes while DEFCON is 1. Each transaction reads 100 records in number order and schedules the next batch. A delivery still waiting at expiry is cancelled like any other

The counters report reads three settings rows. Retained moderation cases are the cases numbered so far minus `casesRemoved`, which retention increments for each case it deletes. `ticketSettings.activeTickets` changes with every ticket that becomes active or inactive

## Temporary voice rooms

`voiceGenerators` stores each generator's channel, room category, room name template, default member limit, region and revision, with at most 10 per server. `voiceRooms` stores each live room's channel, owner, generator and creation time, with at most 50 per server and one per owner. Generator names are channel names, which the bot applies natively. The backend validates them but does not store them

Generator changes from chat follow the moderation staff rule for channel management: Owner, Administrator, or a moderation staff role together with a fresh native Manage channels read. DEFCON 1 leaves only Owners and Administrators. Dashboard changes use the shared configuration family `voice`. The bot records each room right after creating it and removes a record when its channel is deleted, so no retention job is needed. Occupancy, grace timers and voice state stay in the bot

## Selective backup and restore

Backups export selected authored configuration, effective XP and channel structure. Private history, participation, receipts and live ownership are never exported. The bot encrypts archives with AES-256-GCM using `NEONFLUX_BACKUP_KEY`. Recovery keys and archive bytes never reach the backend. Owner commands run in a verified DM

Structure export covers categories, text, announcement and voice channels, where an announcement channel keeps a text
channel's fields, and skips other channel types. An overwrite is archived exactly as the server has it, with any allow
and deny bits of up to 64 bits that do not overlap. A channel that a ticket or a temporary voice room made is archived
with `managed` set to `ticket` or `voiceRoom`, which the bot learns from the `backup:query` operation `managed` (at most
100 channel IDs, each looked up in the `by_channel` index of `tickets` and of `voiceRooms`), because NeonFlux forgets
those rows later. The label is not part of what a channel restores to. Configuration that names an announcement channel
counts it as a message channel reference. An export larger than the restore limits is refused, so every archive stays
restorable. Limits are a 1 MiB snapshot, 500 XP profiles, 100 structure items and 500 permission overwrites

A preview and a restore plan are one thing. `backup:preview` runs `createBackupPlan`, which decides every archive item
with `backupPlanItems` in [backup.ts](../projects/backend/convex/backup.ts) and stores the decisions as a plan.
`backupPlans` keeps the archive hash, the owner binding, the counts by decision, the permissions and switches the plan
grants and a 15-minute expiry, and `backupItems` keeps at most 500 items per plan with their decision, reason, changed
fields, a warning for an item that deletes or posts and the archived object.
`backupChanges` keeps one row per item with its complete list of changes, as leaf paths with the value before and after,
a mark on a setting that turns on and, for a new channel, each overwrite with the permissions it gives. Values are never
cut. An item whose changes would pass 512 KiB is blocked as too large to show. A server keeps at most ten plans,
forgotten ones included. A newer preview deletes the server's plan that was never confirmed before it makes its own. A
confirmed plan stays for seven days after its 15-minute expiry, its last step or `!backup forget`, whichever comes last,
and longer while one of its items is unresolved. Confirmation binds the exact owner, plan, archive and mode. Each item
is created, updated, deleted, skipped as identical or blocked, and a step that finds the server changed since the
preview ends as a conflict. The permissions an overwrite gives are highlighted by one rule, the bits it newly allows
plus the denies it lifts, which is Fluxer's own rule for overwrite edits. The preview route accepts a request whose
serialized JSON is at most 4,194,304 UTF-16 code units long, which carries the decrypted manifest of at most 512 KiB, up
to 100 channel snapshots, 1,000 references, the server's list of up to 500 channels and the owner's evidence

A channel is decided by `backupNativeDecision` in [backupStore.ts](../projects/backend/convex/backupStore.ts) from the
bot's fresh evidence: each observation carries the channel and the permissions NeonFlux has in it, and the proof lists
every channel of the server with its category, whether its permissions equal its category's (`synced`) and whether
NeonFlux manages it. The decision runs at the plan and again at the claim of a create or update and at the
`apply` of an identical archive channel, on fresh evidence, so a channel that changed or is gone since the preview is a
conflict. A channel that a match restore leaves alone needs no evidence. A missing channel is a create, one that differs
in any restored value is an update, one that matches is a skip, and one that tickets or voice rooms own, found by the
`by_channel` indexes of `tickets` and `voiceRooms` or by the archive's `managed` label, is a skip that is never written.
A role or member that is gone is dropped from the permissions by `backupEffectiveChannel`, which every comparison, grant
check and read-back uses, and it comes back as a dropped change row, so a channel whose only difference is dropped
overwrites is a skip. An overwrite for such a target that the server's channel already holds stays as it is and is no
change. What NeonFlux may write is Fluxer's own rule. A create needs Manage channels and Manage roles, since it always
sends a permission list, and no allow beyond NeonFlux's permissions in the category, or in the server without one. An
edit needs Manage channels, and for a changed permission list Manage roles and no gain beyond NeonFlux's permissions in
that channel over every old and new target. A blocked reason names the permission and the fix. Fluxer copies a
category's permission change to every channel whose permissions equal the category's, with no way to skip it, so
`backupCascade` allows that change only when each such channel ends with the new permissions anyway: an archived channel
that the archive gives the same permissions, or a channel of a type the archive does not hold, such as a link channel,
which the category's row names. Any other channel blocks the category with the move-out instruction, and a channel
that match mode deletes first asks for a second check. The category's `expectedHash` binds the IDs of those channels,
and a channel the cascade will reach accepts a second state, its permissions already replaced, which is stored as its
`cascadeHash`. Items run in this order: category creates, category updates, channel creates, channel updates, channel
deletes, category deletes, then configuration and XP. Creates run before deletes, so a full server fails safely, and a
category changes before its channels

Match mode adds one thing, the deletion of the channels and categories of the four archived types that the proof lists
and the archive does not hold. They are items with `extra` set, and the archive must have selected `structure`. A
channel that tickets or voice rooms own is a skip, one that NeonFlux cannot manage is blocked, and a category that would
still hold a channel after the plan is blocked. A plan of archive items and deletes over 500 is refused with 413. The
mode is part of `planHash`. An update or delete is claimed straight from planned, with no reservation and no origin.
The claim decides again, so a channel that already has the wanted values settles as updated with no write, one that
changed since the preview is a conflict, and one NeonFlux lost the permission for is blocked. The grant carries the
action and `from`, the channel as the claim read it, which the bot must still find right before it writes. The bot
answers `updated`, `deleted`, `failed` with what applied, or `uncertain`, judged by reading the channel back. An
update or delete that stays claimed too long ages to `uncertain` like a create does, but it is not an anchor: it never
keeps a plan from being forgotten, since a new check compares the server itself

A restore step writes a configuration item through the feature's own save, such as the moderation, response, role,
ticket, leveling, milestone, cleanup, greeting, metadata and publishing operations, so revisions, role ledgers, pending
deliveries, activation times and worker wakes happen as they do for a change from chat or the dashboard. Every on/off
switch is written as archived, and a role setting the archive leaves out is written as what absent means. A cleanup
policy that turns on, a log route that turns on or moves, and the module switch that resumes policies or routes that
stayed on are written too, since the verified owner's confirmation is the authority the feature's native step stands
for. What that step reads of live Fluxer state is checked from the bot's fresh permissions in the channel, at the plan
and again at the step: View channel, Read message history and Manage messages for cleanup, and View channel, Send
messages, Embed links and Read message history for logs. The cleanup module's confirmed plan also binds the policies it
resumes, so a policy that changes after the preview ends the module as a conflict. A channel the bot's fresh read does
not cover, such as a policy that stays on in a paused module and is not in the archive, is left to the worker, which
checks it again. The owner, DEFCON and quarantine checks run for every step, and a cleanup policy or log route that an
administrator set up restores as archived for the owner who confirms it. The plan carries a warning that says what the
item will delete or post. A published or withdrawing role panel is blocked until it is withdrawn. The step checks the
plan's hashes, the references, the capacity of a new item and the feature's rules again right before it writes and ends
as a conflict when the server changed, and a refusal from a feature's rules undoes the whole step. A member's XP is set
through the leveling correction, which orders by time, moves the rank counts and audits the change, and it queues no
reward roles. `backupOrigins` keeps up to 5,000 body-free mappings from an archive channel to the channel a restore
created for it, for channels only. A channel that a restore made and somebody deleted since is made again, and its
mapping and the settings that name it point at the new channel. `backupOriginCounts` counts the mappings per provider so
a capacity check reads one row. A restore step checks a plan's unresolved items through an index instead of reading
every item

`backupPreviewJobs` keeps one row per server with the plan the latest preview made. The archive must sit in the owner's
DM named by the request's context. A newer preview replaces the plan that was never confirmed, and a confirmed plan
stays until it expires. The row is purged with the server

## Server analytics

Analytics stores aggregated counts only, with no member IDs. `analyticsSettings` keeps one row per server with the switch, a revision and the last change. A server without a row counts as on

| Table | Row | Retention |
| --- | --- | --- |
| `analyticsChannelDays` | Server, channel, UTC day start, message count and 24 hourly message counts | 35 days |
| `analyticsMessageDays` | Server, UTC day start, message count, 24 hourly message counts and the message count of each channel, for at most 1,000 channels a day | 35 days |
| `analyticsDays` | Server, UTC day start, joins and leaves | 400 days |
| `analyticsFlushes` | Server, bot worker session and the highest batch number applied for it | Two days after its last batch |

`/analytics/record` takes a session, a batch number and 1 to 500 hour and day buckets in one mutation. It adds each hour bucket to its channel day row and its server message day row, adds each day bucket to its server day row and creates missing rows. Hours and days must be aligned to their bucket and inside their retention window. A server day lists at most 1,000 channels, and messages in further channels still count in the day's total and hours. When analytics is off, it stores nothing and returns `{ enabled: false, recorded: false }`

A session is one run of a server's bot worker, which numbers its batches from 1 and sends them in order. A batch at or below the session's highest applied number was saved before and only its reply was lost, so it returns `{ enabled: true, recorded: true }` without counting again. The bot resends a batch for at most a day, and session rows stay two days after their last batch, so a resent batch always finds its session

Reads take at most one row per UTC day, newest first, so a bound never drops recent days. `!stats` reads at most seven server day and seven message day rows. The dashboard reads at most 30 of each, plus 30 channel day rows when it shows one channel's hours

The hourly retention cron deletes at most 512 expired rows per table and 128 message day rows in one run, and schedules one immediate follow-up while a batch is full. A row is deleted once its whole bucket is older than its retention, and a session row two days after its last batch

The dashboard's `analytics:dashboard` query returns a zero-filled 30-day series of joins and leaves, a 14-day message series, the top ten channels for 7 or 30 days and the messages per UTC hour for each day of that range. Hours cover every channel, or the one channel named by the optional `channelId`. `analytics:save` rechecks provider permission and writes the switch directly with the expected revision, like the prefix

## Multi-server scope

A deployment runs in `single` mode, where it serves the server in `NEONFLUX_SERVER_ID`, or in `multi` mode, where it serves the servers the bot registers. Multi mode has no server list or server limit. The deployment owns the mode, so changing it means updating the deployment and restarting the bot, which adopts it. A bot environment that sets its own scope variables must match

`/service/scope` checks the key and returns `{ scope, websiteUrl }`. `scope` is `{ mode: "multi" }`, or `{ mode: "single", serverIds }` with exactly one server in single mode, and `websiteUrl` is the origin in `NEONFLUX_WEBSITE_URL` or `null`. The bot adopts both before starting any server runtime

`serverInstallations` keeps one row per server the bot has joined, with an `active` or `removed` status, `joinedAt` and, after removal, `removedAt` and the purge's `purgeLeaseUntil`. The bot calls these when it starts, joins a server or is removed from one. They bind no server, have a body limit of 4,096, return `404` in single mode and leave the same state when repeated. A join answers `dueIn: 0`, so the bot looks for work the server kept

| Path | Body | Purpose |
| --- | --- | --- |
| `/service/installations/list` | `{ cursor }`, optional | Lists active servers, 500 per page, with `nextCursor` or `null` |
| `/service/installations/join` | `{ serverId }` | Marks the server active. A removed server becomes active again with the data the purge has not deleted. The join that starts an installation, the first or one after a removal, also answers `welcome: true`, so the bot posts its install note once per install |
| `/service/installations/leave` | `{ serverId }` | Marks the server removed and records `removedAt`. Its data stays for 30 days |

Every feature request selects its server with the `serverId` argument, which single mode may omit. It must match `request.serverId` and name the configured server in single mode or an active installation in multi mode. Each bot service function checks the installation in its own transaction before any domain work, so a removed server is rejected with its data kept. Otherwise the function answers `403` with `code: "NEONFLUX_SCOPE_DENIED"`. Native evidence names the server it was read from in `originServerId` or `memberOriginServerId`, which must match the selected server. In multi mode, authority and membership facts without an origin are rejected

All servers share one service secret and so one key. Scope checks prevent accidental cross-server use but do not protect one server from a compromised holder of that secret or key. Server administrators cannot change credentials or registrations

### Server data after removal

In multi mode the backend deletes a removed server's data 30 days after `removedAt`. An hourly cron purges one server at a time, the oldest removal first. Each run deletes at most 256 rows per table, ends early after 2,048 rows or about 4 MiB, and schedules the next run until every per-server table is empty. The installation row goes last. Moderation corrections have no server ID and are deleted with their case. Dashboard sessions are shared by all servers and expire on their own, and the one-row work signal is shared by the whole bot. The purge makes no Fluxer requests, and single mode never purges

Every run first rechecks the installation, so a server that joins again stops its purge. Joining again after the purge finished starts with no data, and joining while it runs keeps the rows not yet deleted. Leaving again starts a new 30 days for what is left. Only one purge runs at a time, and a stopped purge resumes on a later cron run once its 10-minute lease ends

Every table with a `serverId` field needs an entry in `PURGE_INDEXES` in [installationsPurge.ts](../projects/backend/convex/installationsPurge.ts), which names an index that starts with `serverId`. Typechecking fails until a new table is listed, and the purge tests also fail for a table without a server ID that is neither purged through its parent nor listed as shared

## Background work dispatch

`/service/work` tells the bot's one work dispatcher which servers have due work for each background worker. It checks the key, binds no server and works in both modes. The body is `{ cursor, held, requestedAt }`, with a 4,096 body limit, and the answer is `{ kinds, dashboard, cursor, nextDueIn }`. `kinds` lists for each worker the servers with due work, oldest due first and at most 100 per worker. In multi mode only active installations appear, and in single mode only the configured server. The bot returns the opaque `cursor` with its next request. Due checks use the backend clock, and the bot's `requestedAt` only keeps each call distinct, so a cached query result never hides work that became due since. `nextDueIn` is the time until the earliest row of any timed source becomes due, or `null`. It reads one row per timed source and ignores servers and settings, so it can only be early

Each worker's rows are read from global indexes in due order, at most 100 rows per index range and request, so a server without due rows costs no reads. One request reads at most 12 MiB of rows in total, in chunks no larger than the remaining budget holds at Convex's 1 MiB document limit, and the sources it did not finish continue on the next request. Later requests of the same pass read only the sources the cursor names. The bot goes on with a cursor at once only after a pass that found work. When new work, a due time or the two-minute check starts a pass, its first request reads every source and sends the earlier cursor as `held`. Each source that request leaves unfinished goes on from the further of its new and held positions, so a cursor never hides new work. Due rows that no worker will act on, such as those of removed servers or paused features, are still read on each request until they change or are purged. A range that filled its page continues after its last row on the next request, so such rows delay but never hide other servers' work. A server is listed only when the worker's own function would act, so settings that pause a worker, a held lease or work due later keep it off the list

| Worker | Listed when | Index |
| --- | --- | --- |
| `dashboard` | A job waits for the bot and has not expired. Every dashboard job table is read by state. `dashboard` names for each listed server the worker passes its jobs need, such as `roles`, `messages` or `configuration`, so the bot reads only those job kinds, and a new job table needs its pass named | `by_state` on each dashboard job table |
| `verification` | A solved or redeemed proof has no outcome, while advanced verification is on at DEFCON 3 | `verificationLinks.by_global_ready` |
| `events` | A queued, blocked or unclaimed reserved reminder is due while events and publishing are on at DEFCON 3 or its window has ended, or a waitlist occurrence is due while events are on at DEFCON 3 | `eventDeliveries.by_global_due`, `eventOccurrences.by_global_work` |
| `schedules` | An active delivery's due time and check time have passed | `scheduleDeliveries.by_global_discovery` |
| `milestones` | An enrollment's check time has passed | `milestoneEnrollments.by_global_discovery` |
| `suggestions` | A changed card is due while suggestions and publishing are on at DEFCON 3 | `suggestions.by_global_work` |
| `cleanup` | An enabled policy is due while cleanup is on and DEFCON is not 1 | `cleanupPolicies.by_global_due` |
| `metadata` | A record with delivery work is due | `metadataLogRecords.by_global_work` |
| `levels` | A dirty level profile's reward time has passed, or a reward sweep is pending | `levelingProfiles.by_global_reward_due`, `levelingSettings.by_sweep` |

The bot learns about new work in three ways, so it needs no short poll. `workSignal` holds one row with a counter. Website writes that create bot work raise it in their own transaction: queued dashboard configuration, message, metadata and role jobs, role picker member requests, permission check requests, a solved web verification and a saved dashboard prefix, which leaves a settings log record. Scheduled wake batches raise it too when they make held work due: metadata log deliveries, scheduled posts, birthday and anniversary posts and level rewards. So does returning to DEFCON 3, for the suggestion cards and event reminders it held, and turning events or publishing on, for the event reminders that came due while they were off. The bot subscribes to `/service/work-signal`, a key-checked query that returns only `{ version }`, and dispatches when it changes. A bot mutation reports `dueIn` for the rows it wrote to these tables that its sources would read, by the same prefix and due order, so the bot's own writes do not touch the shared row. Each dispatch reports `nextDueIn` for later work. The bot still dispatches every two minutes, which also picks up work that becomes actionable without a write, such as an expired lease or a reopened setting

## Bill guard

Convex bills query, mutation, action, HTTP action and file storage calls as function calls, and counts explicit client calls, scheduled executions and subscription updates, as its [limits](https://docs.convex.dev/production/state/limits) and [usage limits](https://docs.convex.dev/production/usage-limits) pages describe. Convex documents no way for a deployment's own functions to read its billed usage, so NeonFlux counts the calls the bot causes itself. The Convex documentation does not say whether a query answered from its cache is billed, so the bot counts every call it makes

The bot counts each function it calls and each work signal update it receives. At startup, every five minutes and on a normal shutdown it reports the calls counted since its last accepted report to `/service/usage`, a key-checked mutation that binds no server and works in both modes. The body is `{ calls }`, a whole number of at most 100,000,000, with a 4,096 body limit. The backend adds it to the current UTC month's row in `usageMonths`, the window on which Convex monthly usage limits reset, and answers `{ month, calls, budget, state, warn }`. The report costs one call every five minutes, about 8,900 a month per bot process, and the bot counts it in its next report. A failed report keeps its calls for the next one. A report whose answer was lost is counted again, which errs toward pausing early. Each bot process reports its own calls, so the month's total covers all of them

`NEONFLUX_MONTHLY_CALL_BUDGET` sets the budget in function calls, not money, because NeonFlux does not hard-code plan prices or included amounts. Convert a spending budget with your plan's price per call. Without a budget the state is always `normal`, and reports still record the month's calls. With a budget the state is:

| State | From | Bot behavior |
| --- | --- | --- |
| `normal` | Below the warning share | Everything runs |
| `warning` | `NEONFLUX_BUDGET_WARNING_SHARE` of the budget, 0.65 by default | The month's first report at or past the warning share answers `warn: true`, and the bot logs one warning |
| `paused` | 90 percent of the budget | The bot pauses optional work, as [the bot guide](BOT.md#optional-work-limits-and-the-bill-guard) describes, until a report answers another state |

The state follows each report, so raising the budget resumes optional work at the next report, within five minutes, and a new UTC month starts at zero. A malformed setting answers `503 Usage budget not configured correctly` with the code `USAGE_BUDGET_INVALID` and logs the variable to fix. The report is not counted, so the bot keeps its calls for the next report and pauses optional work until a report succeeds

The count leaves out calls the bot does not cause: the website's dashboard and verification functions and their subscriptions, which grow with dashboard use, and scheduled functions. The scheduled jobs are the ten-minute retention chain, which continues itself while expired rows remain, and the hourly analytics cleanup and installation purge, so at least about 6,000 runs a month. Set the budget with room for these, and keep Convex's own warning and disable thresholds, set in the team's spending limits or the deployment's usage limits, well above the bill guard as a last resort. A disable threshold stops the whole deployment, moderation included

## Dashboard and web verification

The dashboard uses separate public Convex functions with its own Fluxer OAuth sign-in, checked against `FLUXER_CLIENT_ID`, and a revocable session that lasts at most eight hours. Sign-in lists the servers where the user is the owner or has Manage community or Administrator, limited to installed servers, and every dashboard request rechecks the installation. Writes recheck provider permission and queue a short-lived job bound to the session and the family revision. The bot then executes it with fresh native evidence through the `/dashboard-configuration`, `/dashboard-messages`, `/dashboard-metadata` and `/dashboard-roles` functions. Browser input never supplies native permission proof, and bot credentials never reach browser code. See [the web guide](WEB.md)

The bot claims each request whose native work comes before the backend records it, a voice generator change, through
`/dashboard-configuration/claim` before it touches Fluxer. The claim rechecks the grant, the family revision and the
DEFCON rules as the execution does, and turns an outdated, revoked or forbidden request into a conflict or failure before
any native work. A chat change that lands while the bot is applying a claimed request can still end it as a conflict

Reads are live queries, one per dashboard view, so the website subscribes only to what the open section shows. `dashboardViews` holds the general view with the prefix, the role view with role settings, panels and recent role jobs, the recent message jobs, the overview and the template choices. The overview reports each feature as on, needing setup, such as a missing channel or first entry, or off. [setupCheck.ts](../projects/backend/convex/setupCheck.ts) computes these states for both the overview and the bot. Template choices carry each saved template's and draft's kind, name and revision, never its content, in pages ordered by kind and then name. Each page holds up to 100 drafts and templates together, or fewer once it has read 4 MiB, with a cursor for the next page. Configuration families, logging and analytics keep their own queries

Every dashboard query reads the session row, so a write to it reruns all of that session's live queries. Read access lasts five minutes after it was last extended. A session refresh or a write extends it only once it has run down by at least a minute, and changed server lists and names are written at once, so routine saves and refreshes leave the session row and its queries alone

Sign-in also stores member servers: Servers the user joined without managing them, where NeonFlux is installed and the role picker is on. A session refresh recomputes them, and manager writes leave them unchanged. Member functions accept a managed or member server and recheck the installation and the switch on every request, while manager functions keep accepting managed servers only. See [role picker and member access](#role-picker-and-member-access)

Web verification needs advanced verification enabled and DEFCON 3. It issues a link that is valid for ten minutes, with at most 500 new links per server per hour and a 60-second reissue cooldown. Starting a challenge requires a Turnstile token, which Convex checks through Siteverify for the expected action and an exact configured hostname. It fails closed when configuration or the provider is unavailable. The challenge is a motion CAPTCHA with a 90-second deadline and two attempts. A solved proof reserves the verification role, and its grant never outlives the proof. See [the CAPTCHA notes](CAPTCHA.md)

### Setup and permission checks

The bot's `!setup` and `!health` and the dashboard's permission check read the same data through these functions, with a body limit of 4,096 for the reads and 65,536 for the answer

| Path | Body | Purpose |
| --- | --- | --- |
| `/setup/status` | `{ serverId }` | Each feature's state, as the overview reports it, and the roles each feature assigns: autorole roles and reservations, reaction and verification panel roles, role picker roles and level rewards, at most 100 per feature |
| `/setup/ready` | `{ serverId }` | `{ queued }`, whether the website waits for a check |
| `/setup/record` | `{ serverId, problems }` | The bot's answer to a waiting check. Returns `{ recorded: false }` when no check waits or it expired |

`setupCheck:request` is a dashboard mutation for a manager's session. It queues one check per server in `dashboardSetupJobs`, raises the work signal and gives the bot 60 seconds to answer, after which a scheduled function marks it failed. A request while a check waits, or within 10 seconds of the previous one, changes nothing, so the refresh button cannot keep the bot reading Fluxer. `setupCheck:view` returns the latest check. A problem is a missing set of permissions for a feature, roles a feature assigns that rank at or above the bot, or a gateway state other than connected, stored as permission keys, role IDs and names and the state. A check stores at most 50 problems. The bot reads Fluxer with its own token, so the check never uses the manager's sign-in
