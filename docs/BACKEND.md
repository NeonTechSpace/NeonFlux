# Configure the backend

This guide is for operators deploying NeonFlux's Convex backend and contributors changing its contracts. The bot calls public Convex functions for every persisted feature, each checked with a key derived from the bot secret, and the web dashboard and verification pages use their own public Convex functions. See [the bot guide](BOT.md) for commands and [the web guide](WEB.md) for dashboard and verification setup

## Shared setup

### Configure a cloud development deployment

NeonFlux uses a Convex cloud development deployment. Use a [deployment-specific development key](https://docs.convex.dev/cli/deploy-key-types), which lets the CLI target that deployment without an account login on this machine. Do not use a production key or a preview or project token for this setup

1. Select the development deployment in the Convex dashboard
2. Open its deployment settings and copy its deployment URL, which normally ends in `.convex.cloud`
3. Create a development deploy key with permission to deploy functions and configure environment variables
4. Copy [the backend environment example](../projects/backend/.env.example) to `projects/backend/.env.local` and fill `CONVEX_DEPLOY_KEY`
5. Set the server scope, `NEONFLUX_BOT_API_SECRET` and, for web verification, the Turnstile values in the deployment's environment variables through the dashboard. Local `.env.local` values do not reach the deployed functions
6. Set the same scope and secret in `projects/bot/.env`, with `CONVEX_URL` set to the copied deployment URL. See [the bot guide](BOT.md) for the bot token and the remaining bot settings

Keep the bot API secret separate from the Fluxer bot token, OAuth credentials and the Convex deploy key. The deploy key belongs only in the backend's local configuration. Never provision the whole backend `.env.local` with `convex env set --from-file`, because that would upload the deploy key into the application environment. Environment files are ignored, and only the examples belong in version control

The bot needs the deployment URL, not the HTTP Actions URL ending in `.convex.site`. The backend serves no HTTP actions. Copy the exact URL when using a custom domain. The backend uses standard Convex functions and environment variables with no cloud-only identity dependency, but a self-hosted deployment procedure is not documented or verified

### Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `CONVEX_DEPLOY_KEY` | `projects/backend/.env.local` only | Lets the CLI deploy to the development deployment |
| `NEONFLUX_SERVER_MODE` | Convex and bot | `single` (default) or `multi` |
| `NEONFLUX_SERVER_ID` | Convex and bot | The one allowed server in single mode. Must be absent in multi mode |
| `NEONFLUX_BOT_API_SECRET` | Convex and bot | Shared bot service secret of at least 32 characters. The bot sends only a key derived from it |
| `TURNSTILE_SECRET_KEY` | Convex | Cloudflare Turnstile secret for verification starts |
| `TURNSTILE_HOSTNAMES` | Convex | Comma-separated exact website hostnames without scheme, port or path. Production must exclude `localhost` and `127.0.0.1` |
| `FLUXER_CLIENT_ID` | Convex | Fluxer OAuth application ID that dashboard sign-in tokens must belong to |
| `NEONFLUX_BACKUP_KEY` | Bot only | Optional base64 encoding of exactly 32 bytes. Leave it absent to disable backup archives |
| `NEONFLUX_MONTHLY_CALL_BUDGET` | Convex | Optional monthly budget in billed function calls for the [bill guard](#bill-guard). Leave it absent to turn the guard off |
| `NEONFLUX_BUDGET_WARNING_SHARE` | Convex | Optional share of the budget at which the bill guard warns, above 0 and below 0.9. Defaults to 0.65 |

Multi mode reads no server list. Invalid or ambiguous scope configuration, including a leftover `NEONFLUX_SERVER_IDS`, fails closed with `503 Backend not configured`. Generate the bot API secret randomly and rotate it in Convex and the bot together

### Service authentication and errors

The bot reaches the backend through the public functions in [botService.ts](../projects/backend/convex/botService.ts), one for each path listed in this guide. A function's name joins the path's segments in camel case, so `/general/nickname-result` is `botService:generalNicknameResult`, and the bot keeps the same list in [backend-routes.ts](../projects/bot/src/backend-routes.ts). Paths that read stay queries and paths that write stay mutations. Each call carries `key`, the bound `serverId` and the `request`

The key is the lowercase hex HMAC-SHA256 of the fixed label `neonflux/bot-service-key/v1`, keyed by `NEONFLUX_BOT_API_SECRET`. The bot derives it and never sends the secret, so the secret does not appear in function arguments and keeps its other uses, such as leveling digests. Each function first checks the server scope and the secret, then compares the key in constant time, before it reads anything. Changing the label changes the key on both sides

The function then binds the request to one server, as described in [multi-server scope](#multi-server-scope), checks the path's body limit against the request's JSON text in UTF-16 code units and that the request is a JSON object, and checks the origin of native evidence. It runs the feature's own service function handler in the same transaction, and that handler checks the installation first. A bot function never calls another function, so each bot request is billed as one function call. The feature functions stay internal, and the scheduler still calls some of them directly. IDs are canonical positive decimal strings within the signed 64-bit range. Object field names in requests must be ASCII, as Convex values require

Mutations answer `{ value, dueIn }`. `dueIn` is present when the mutation's writes created background work, in milliseconds from now by the backend clock, so the bot's [work dispatcher](#background-work-dispatch) can run at that time

The bot imports the types-only [shared contracts](../projects/backend/contracts.d.ts) through `@neonflux/backend/contracts` and decodes every response at runtime. The backend owns validation and domain rules. It trusts actor, permission, membership and private-conversation facts only because the bot's key vouches for them, so these fields never authenticate a browser user

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

Failures are Convex errors whose data holds the status, a fixed `error` message and, for scope denials and the refusals below, a code. Unexpected failures answer `503` and are logged without request bodies or keys. Body limits are listed with each feature's paths

A refusal the bot can explain with a fix carries a stable reason `code`. The bot reads the code and never the message, and turns it into a reply that says what to change, using the native facts it read for the request

| Code | Meaning |
| --- | --- |
| `BOT_PERMISSION` | The bot lacks the native permission for a moderation action or a role change |
| `BOT_BELOW_TARGET` | The bot's highest role does not rank above the target member's |
| `ACTOR_BELOW_TARGET` | The actor's highest role does not rank above the target member's |
| `ACTOR_PERMISSION` | The actor lacks the native permission for the action |
| `TARGET_PROTECTED` | The target is the bot, the server owner, an Administrator or the actor |
| `ROLE_NOT_ELIGIBLE` | A role is not below the bot and the actor, carries more than ordinary member permissions or is a staff role |

### Checks

Run these from `projects/` after configuring the deployment

```sh
pnpm --filter @neonflux/backend run codegen --typecheck disable
pnpm run check
pnpm --filter @neonflux/backend run dev --once --typecheck disable
```

Codegen uses the existing deployment and writes `convex/_generated/` without publishing functions. Keep those generated files in version control and regenerate them when the schema or function interface changes. `pnpm run check` runs the backend, bot and web checks. `pnpm --filter @neonflux/backend run check` runs only the backend typecheck and its Node tests, which call the bot's public functions through `convex-test` with synthetic credentials and need no deployment credentials. The last command publishes one development update and exits. Use `pnpm --filter @neonflux/backend run dev --typecheck disable` to keep watching files

Retention cleanup runs as one chain that a Convex cron starts every ten minutes, so an idle deployment runs it 144 times a day. Each run visits every feature's cleanup in bounded batches and repeats a feature while its batch is full. A run stops after about 2,048 documents or 4 MiB and schedules the next run at once, so a backlog drains in back-to-back runs. A feature whose full batch changed nothing, such as expired open appeals, waits for the next run instead of repeating. While a run is scheduled, the cron leaves it alone. Expired rows wait at most ten minutes, and nothing depends on an earlier run. A timeout or ban recovery whose known end has passed stops restricting its member at once, because role participation, leveling, tickets, message cleanup and backup restore ignore it before retention deletes it. A feature whose cleanup fails runs in its own sub-transaction on later runs until it succeeds, so other features keep their retention. Analytics keeps its own hourly prune, and the hourly purge of removed servers is described in [server data after removal](#server-data-after-removal)

### Opt-in live smoke runner

`pnpm smoke:live` runs [the smoke script](../projects/bot/scripts/smoke-live.ts) against a configured development server without a gateway connection. It reads the bot's `.env` and an ignored `projects/bot/smoke-live.local.json` created from `smoke-live.example.json`, which names the server, an operator, a target member and a channel. It sets the log channel, warns, quarantines, locks a channel and checks DEFCON gates through the production backend adapter and real REST calls. Every change registers its restoration, so restorations run in reverse order after success, failure or Ctrl+C. Its command sources are synthetic, so a pass does not prove gateway command dispatch, member DMs, visible presence or restart behavior. Tests never run it

## Bot foundation

### Threads and channel rules

For a message in a thread, the bot sends the thread's parent channel as `parentChannelId` with `/moderation/evaluate`, `/responses/evaluate`, leveling candidates and metadata message events. It is validated like any other ID and must differ from the message's channel. Channel rules then match the thread or its parent: automod channels and exemptions, honeypot channels, response channel restrictions, leveling's excluded channels, and metadata logs' message channels, excluded channels, log destinations and ticket channels. `automodWindows` keeps the parent with each message, so a rule scoped to a channel counts its threads' messages too. Requests without `parentChannelId` behave as before

### Prefix

`generalSettings` stores one row per server with the command prefix, a revision, and the update time and actor. The prefix is one to five punctuation characters and defaults to `!`. Changes require Manage Server evidence and the expected revision

The same row stores the desired bot nickname, absent when the bot's username should show, and the result of the last explicit change: pending, applied or failed with a reason. Nicknames have 1 to 32 UTF-16 code units, with no control characters and no surrounding spaces. Chat changes through `/general/nickname` and dashboard changes through the `nickname` configuration family share one family revision. The bot applies each change natively and reports the result through `/general/nickname-result`, which keeps only the result for the latest revision and nickname

### AFK

`afkStatuses` stores one active record per server and member: Member ID, trimmed reason of 1 to 200 UTF-16 code units, and a backend timestamp. Setting AFK replaces the reason and timestamp. The member's next ordinary message deletes the record, and the same mutation looks up at most five mentioned members, deduplicated and excluding the author. There is no automatic expiry or message history. Reasons are visible to anyone who mentions the member

### Custom commands and autoresponders

`responseDefinitions` stores content, matching rules, channel and role restrictions, cooldown, priority, enable state and timestamps. `responseSettings` stores separate module switches for custom commands and autoresponders, both enabled by default. New definitions are enabled, unrestricted and have a five-second per-user cooldown

- Names: 1 to 32 letters, numbers, underscores or hyphens, starting with a letter or number, lowercase and unique per kind. Every bot command namespace, such as `prefix`, `mod`, `roles`, `ticket`, `event`, `backup`, `cleanup`, `milestone`, `suggest`, `help`, `health` and `setup`, is reserved
- Limits: 100 definitions across both kinds, ten per list page, 2,000-unit text, 256-unit embed title, 4,000-unit embed description, 200-unit literal trigger, 20 channel and 20 role restrictions, cooldowns from 0 to 3,600 seconds and priorities from -100 to 100
- Matching: Custom commands compare the whole first token case-insensitively. Autoresponders compare trimmed content as exact or contains, never match prefixed messages, and pick by higher priority, then exact over contains, then name
- Rendering: Placeholders are `{user.name}`, `{user.id}`, `{user.mention}`, `{channel.id}`, `{server.id}` and `{args}`. Unknown placeholders are rejected, substitution runs once, limits are rechecked afterwards and all replies disable mentions

`responseReceipts` stores source message IDs and the reservation, without source content, usernames or rendered replies. `responseCooldowns` stores per-definition, per-user eligibility deadlines. Source events must be at most 15 minutes old or one minute in the future. Evaluation first reads the module switches and the prefix. A command then reads only the custom definition of its name and other text only the autoresponders, so most messages read few or no definitions and write nothing. Only a reply reserves the source message and cooldown, atomically, so a redelivered event that replied never gets a second reply, while one that matched nothing may reply after a matching definition appears. The bot sends `roleIds` only after it has read the author's member, from its member cache when it holds one, which member events keep current, and without them the backend answers `{ send: false, memberRequired: true }` when a definition could reply. A custom command that exists but does not reply, for example during its cooldown, answers `{ send: false, defined: true }`, so the bot suggests no built-in command for it. The bot does not retry an uncertain send. Receipts expire after 24 hours and expired cooldowns are removed by the cleanup cron

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/general/get`, `/general/manage` | 4,096 | Read the prefix and nickname, and change the prefix |
| `/general/nickname`, `/general/nickname-result` | 4,096 | Record a chat nickname change, and record the bot's native result |
| `/afk/set`, `/afk/observe` | 4,096 | Set AFK, and clear it and resolve mentions on a message |
| `/responses/manage` | 32,768 | Definition and module management |
| `/responses/evaluate` | 32,768 | Match one message and reserve at most one reply |

## Moderation, protections, DEFCON and appeals

The backend owns settings, validation, permission policy, action reservations, numbered cases and appeals. The bot owns fresh native permission and hierarchy checks and the platform actions. Configuration requires the server owner or an administrator, and other staff need a configured role for each operation

Manual moderation covers warnings, timeout and clearing, kick, permanent and temporary ban, unban, bounded message deletion, slowmode, and channel lock and restore. It starts enabled. Automod and security detection start disabled and in dry-run mode. Each case records source, actor, target, reason, action outcome, correction history and separate staff-log and warning-notice outcomes. A grant belongs to one source and case and is never replayed after a lost response or uncertain write. Actions, logs and notices still pending when the bot starts are marked uncertain once

- Automod: Message frequency, repeated content, mass mentions, literal words, domain allow or block lists and invite patterns, with channel scopes and exemptions. Detection uses message text and metadata only. One source message reserves at most one action. Repeated-content checks read only the member's recent messages with the same content hash
- Protections: Join bursts, an opt-in honeypot channel that quarantines through a native timeout, and a local watchlist each create a classified case (`join-burst`, `honeypot` or `watchlist`) shown through the case commands. One join-burst case covers a burst window
- Recovery: Owned timeout release and channel restore link a new case to the original action. Channel lock changes only the everyone role's `SendMessages`, `SendMessagesInThreads`, `CreatePublicThreads` and `CreatePrivateThreads` overwrite bits. The bot reports the posting bits it holds server-wide as `botPostingPermissions` in the action context, and a lock owns `SendMessages` plus only those thread bits, because Fluxer lets a bot stop denying only permissions it holds. The lock's recovery record and the lock and unlock grants carry the owned bits as `ownedPermissions`, and unlock restores only them. A lock recorded before thread support has no `ownedPermissions`, so it owns and restores `SendMessages` only
- DEFCON: Durable and restored after restart. Level 3 is normal, level 2 blocks public commands while staff work and private appeals continue, and level 1 allows only critical owner and administrator controls. Changing DEFCON does not lock channels

Member appeals use verified one-to-one DMs and reveal only the member's own cases and appeals, so banned users can appeal where Fluxer allows private messages. Staff review requires fresh authorization. A decision records the outcome, and any reversal is a separate explicit moderation action

Cases and closed appeals are retained for a fixed 180 days, and records needed for active recovery are excluded from expiry. Explicit owner erasure removes a case's private text, including corrections and appeal decisions, and keeps a minimal tombstone. Erasure does not remove messages already sent to staff channels, DMs or Fluxer's audit log. There are no capacity limits beyond source deduplication of messages, joins, commands and appeals

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/moderation/manage`, `/moderation/query` | 65,536 | Configuration, action reservations, cases, rules and watchlist |
| `/moderation/evaluate`, `/moderation/join` | 65,536 | Message and join detection with source deduplication |
| `/moderation/outcome` | 65,536 | Record the action result and reserve staff-log and notice delivery |
| `/moderation/log-outcome`, `/moderation/notice-outcome` | 65,536 | Record each delivery result |
| `/moderation/reconcile`, `/moderation/observe` | 65,536 | Provider observations and startup handling of interrupted work |
| `/moderation/gate` | 65,536 | DEFCON command policy and enabled detection modules |
| `/appeals/member`, `/appeals/staff` | 65,536 | Private submission, withdrawal and staff review |

## Publishing and scheduled publishing

### Publishing

Publishing stores named drafts and templates (`publishingDrafts`), tracked messages with their latest confirmed content (`publishingPosts`), immutable send and edit attempts (`publishingAttempts`) and management receipts. The module starts enabled. The destination must be a text or announcement channel in the server

Content is up to 2,000 UTF-16 code units of text and one rich embed with title, description, URL, color, timestamp, author, footer, image, thumbnail and up to 25 fields, within the 6,000-character embed total. URLs use HTTP or HTTPS without credentials, and mentions are disabled. An edit verifies the exact tracked message, bot author, channel and preceding confirmed content first. The provider has no conditional edit, so an external change can still race

A send or edit grant expires after 180 seconds and needs a one-time dispatch claim, followed by a native request bounded to five seconds. Only an explicit SDK `notDispatched` result proves a request was not sent. Other failures stay uncertain and are never replayed. Staff can resolve a post with an unknown outcome by stating that it was sent with a given message ID or that it failed

Drafts, templates and tracked posts persist until deleted or forgotten. Terminal attempt history is retained for a fixed 180 days, and management receipts for 24 hours

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/publishing/manage`, `/publishing/query` | 65,536 | Drafts, templates, tracked posts, previews and send or edit reservations |
| `/publishing/dispatch` | 65,536 | Claim the current unexpired attempt once |
| `/publishing/outcome` | 65,536 | Record a delivery outcome or fail unclaimed work |
| `/publishing/reconcile` | 65,536 | Bind a fresh native observation to the current attempt |
| `/publishing/observe` | 65,536 | Age closed dispatch windows without replay |

### Scheduled publishing

Schedules copy the exact revision of a named draft or template and store a finite civil plan: Local time, IANA zone, fold policy for repeated minutes and daily or weekly recurrence with an interval of 1 to 12. Nonexistent local minutes are rejected. A plan has at most 26 occurrences within 180 days, and the saved UTC instants stay frozen. Schedules start disabled. Content and plan changes replace only future unclaimed occurrences

Automatic sends act as the bot. They need the bot's channel permissions, the schedule, scheduling module and publishing switches, and an allowing DEFCON level. Administrators are checked when configuring. A late occurrence still sends until local midnight after its due time. Delivery reuses the publishing claim, outcome and reconciliation routes with `scheduleContext`

Limits are 50 schedules, 200 retained occurrence rows and 1,000 management receipts per server. Terminal history is kept for 180 days

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/schedules/manage` | 65,536 | Configuration, cancellation and settled forgetting |
| `/schedules/query` | 65,536 | Definitions, occurrence pages and quota status |
| `/schedules/delivery` | 65,536 | Due discovery, reservation and deferral |

## Role panels, reaction verification, autorole and reservations

Role panels, rules verification and autorole start disabled, and configuration requires the server owner or an administrator. Enabling a module does not scan the roster or assign roles retroactively

- `roleSettings`: Module switches, humans-only autorole, default autoroles and up to 100 per-user autorole reservations, applied with default autoroles when that user joins
- `rolePanels`: At most 50 reaction panels and one verification panel per server, each bound to an exact published message with up to 20 mappings that may list prerequisite and exclusion roles
- `roleAcknowledgments`: Rules acknowledgment, kept separate from delivery of the access role
- `roleOwnership` and `roleReferences`: Which roles the bot added for each member and membership epoch and which features still need them
- `roleAttempts`, `roleWithdrawals`, `roleParticipationReceipts` and `roleReactionJobs`: Grants and outcomes, explicit withdrawals, source deduplication and bulk reaction-removal progress

Each command, reaction or join is evaluated as its own source, and a participation receipt only records that the source was applied, so a redelivered event grants nothing twice. The bot rechecks membership, role permissions and hierarchy before every assignment and never assigns the everyone role, privileged roles or roles above its own. Removal needs confirmed bot ownership in the same membership epoch and no other feature reference, so pre-existing roles are never removed. Grants use a one-time claim within 180 seconds and a five-second native request, and uncertain writes are not replayed

A reaction on the current verification panel acknowledges the rules. Configured verification gates autorole and self-service roles, while native timeouts and unresolved quarantine block participation. Changing mappings or rules requires a new published message. Withdrawal and history are available through chat commands only. Settled role history is retained for a fixed 180 days, while active and unresolved ownership stays. When a later membership epoch records its first acknowledgment or ownership, settled rows from the member's earlier epochs are released, and unresolved ownership stays until it is reconciled

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/roles/manage` | 262,144 | Configuration, panel binding and withdrawal |
| `/roles/query`, `/roles/member-query`, `/roles/policy` | 262,144 | Staff reads, member context and module policy |
| `/roles/reaction-jobs` | 262,144 | Durable bulk reaction-removal pages |
| `/roles/evaluate` | 262,144 | Participation policy and role reservations |
| `/roles/dispatch`, `/roles/outcome` | 262,144 | One-time claim and native outcome |
| `/roles/reconcile`, `/roles/observe` | 262,144 | Read-only ownership recovery and aging without writes |

## Role picker and member access

`memberAccessLists` keeps one row per server and feature name with allowed and blocked role and user IDs, up to 100 of each. The role picker uses the feature name `rolepicker`, and later member features can store their own lists the same way. A block always wins, and empty allow lists admit every member who is not blocked

`rolePickerSettings` keeps the switch and up to 10 menus per server, each with up to 25 roles, and a role belongs to one menu. Chat changes through `/rolepicker/manage` need the owner or an Administrator, like other role settings, and dashboard saves use the `rolepicker` configuration family. Both share one family revision. Every role placed in a menu passes the same self-service checks as reaction panel mappings against fresh native role snapshots

Website member requests are `dashboardConfigurationJobs` rows of the `member` family, so they expire and are retained like other dashboard jobs, and a queued request that has not expired lists its server under the `dashboard` work kind of `/service/work` and raises the work signal. The public `rolePicker:request` mutation rechecks the dashboard session, the installation and the switch, then queues a claim, a drop or a lookup. It allows 10 claims or drops and 10 lookups a minute per member and server, 3 pending requests per member and 50 queued requests per server, and answers with `429` above them. A request fails after two minutes without the bot, and its record keeps only IDs, the operation and the outcome for one day

The bot reads queued requests through `/rolepicker/ready` and sends a fresh native member read with the server's role names and colors to `/rolepicker/start`. A lookup ends there and stores the member's role IDs and the names and colors of menu roles only in `rolePickerSnapshots`, which are deleted ten minutes later. Menu saves from chat and the dashboard also send the bot's current role names, and each menu keeps the names of its own roles as a display fallback. The website never reads roles with the member's sign-in. A claim or drop continues through `/roles/evaluate` with a `pick` operation and the usual dispatch and outcome routes under the consumer key `picker:<menu>`, so role ownership and other features' references decide what may be removed. `/rolepicker/complete` records applied or failed from the member's roles after the change and the recorded attempts, and an uncertain outcome is never replayed

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/rolepicker/settings` | 4,096 | Administrator read of menus and access lists |
| `/rolepicker/manage` | 65,536 | Administrator changes with native role snapshots |
| `/rolepicker/ready`, `/rolepicker/fail` | 4,096 | Queued member requests and requests the bot could not finish |
| `/rolepicker/start`, `/rolepicker/complete` | 262,144 | Fresh member reads before and after a role change |

## Welcome and goodbye

Channel welcomes, optional DM welcomes and channel goodbyes are independent routes that start disabled and accept human members only. Each route copies an exact publishing template revision. Text fields accept `{user.name}`, `{user.id}`, `{server.name}`, `{server.id}` and, for channel routes, `{channel.id}`, with display text escaped and mentions disabled

Welcome timing is `join` or `verified`. A join must be a genuine event within 15 minutes whose native `joinedAt` matches fresh membership. Verified timing needs the current rules acknowledgment and fresh access-role presence. A goodbye needs a retained presence observation followed by a fresh typed member `404`. Enabling a route never backfills earlier joins

Pending work expires after 24 hours, grants after 180 seconds, and native requests are bounded to five seconds. Claimed sends are never replayed. One server-wide budget spaces claims across the three routes, ten per minute by default and configurable from 1 to 60. At most 1,000 deliveries can be pending or claimed within 50,000 retained deliveries. Member observations are capped at 50,000 and expire 365 days after the latest observation. Terminal history defaults to 30 days, configurable from 30 to 3,650

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/greetings/manage`, `/greetings/query` | 65,536 | Configuration, preview and numbered delivery history |
| `/greetings/member`, `/greetings/observe` | 65,536 | Member observations, joins and typed absence |
| `/greetings/discover`, `/greetings/pending` | 65,536 | Waiting eligibility hints and ready pages |
| `/greetings/reserve`, `/greetings/dispatch`, `/greetings/outcome`, `/greetings/defer` | 65,536 | Reservation, one-time claim, outcome and deferral |

## Tickets

Tickets start disabled. Owners and administrators configure up to 20 categories, each with visibility, an optional parent, disclosed support roles, up to five intake questions and up to 20 copied canned replies. Submitted tickets keep snapshots of their category and replies

Intake runs in a verified one-to-one DM. Drafts expire after 24 hours, and each requester can have at most three drafts and three active tickets. A plain DM names no server, so `/service/ticket-intakes` takes `{ userId }`, binds no server and answers up to 10 of that member's live drafts as `{ serverId, intakeNo }`, limited to the configured server in single mode. The bot then reads and changes the draft through the server's own intake functions, which keep every membership, DM and policy check. A `clear` intake operation empties one answer, so a plain reply can step back to that question. Private answers, staff notes and transcripts need fresh membership, role authority and a verified DM. Creation sends the full permission set in the initial request. Close and reopen change only the everyone and requester `SendMessages`, `SendMessagesInThreads`, `CreatePublicThreads` and `CreatePrivateThreads` bits. A new close owns `SendMessages` plus the thread bits the ticket context's `botPostingPermissions` reports, records them as the ticket's `ownedPermissions` until reopen completes, and each close or reopen grant carries the bits it owns. A ticket closed before thread support has no `ownedPermissions`, so its reopen restores `SendMessages` only. Another overwrite allowing an owned bit blocks the close, and deletion needs explicit confirmation on a closed channel. An unknown creation is never replayed or adopted. `!ticket abandon` releases the requester's slot for such a ticket while native and support-role protection stay

Transcript capture stores each capture of up to 500 messages and 200,000 characters as `ticketTranscriptPages` rows of 1,500 characters, so lists read only small headers and a page read loads one page. Reads show a truncation notice. Captures stored before page rows keep their whole body and read as before. Erasure hides every capture at once and then deletes its pages in bounded batches. A capture keeps text, message, author and channel IDs and timestamps, without attachments, embeds, intake answers or staff notes. Each ticket has at most 200 authored entries and 20 transcripts. Failed captures store nothing

Closed-ticket private content expires after 30 days by default, configurable from 1 to 365. Explicit erasure hides private content immediately and then removes it, without deleting provider messages or the channel. Terminal attempt history and settled ticket tombstones expire after 30 days

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/tickets/manage` | 262,144 | Configuration, staff actions, replies, close, reopen, deletion and erasure |
| `/tickets/query` | 262,144 | Category projections, private intake, queues, entries and transcripts |
| `/tickets/intake` | 262,144 | DM drafts, answers, cleared answers, cancellation and submission |
| `/service/ticket-intakes` | 4,096 | A member's live drafts, as server and intake numbers only |
| `/tickets/dispatch`, `/tickets/outcome` | 262,144 | One-time claim and native outcome |
| `/tickets/reconcile` | 262,144 | Channel observations without native writes |
| `/tickets/transcript` | 262,144 | Bounded transcript capture |

## Message leveling

Leveling starts disabled with 15 XP per message and a 60-second cooldown, configurable from 1 to 100 XP and 15 to 3,600 seconds, with up to 50 excluded channels and 50 excluded roles. Level N begins at `100 * N²` XP, capped at 100 million XP and level 1,000

Profiles store account XP and survive rejoining. Leveling stores no message bodies, names or avatars. Duplicate content is detected with an HMAC digest keyed by the bot API secret, keeping up to 64 recent digests per account for ten minutes. Events older than ten minutes or before the current membership earn nothing. Chat commands take no revision numbers

Owner and administrator corrections set absolute XP and apply in source command order. Resets need explicit confirmation, and a server reset hides old scores immediately. Correction audits expire after 180 days, and profiles, credited receipts and audits are each capped at 50,000 per server. Leaderboards return 20 profiles per page. `levelingLevels` counts the profiles with XP at each level of the current score epoch, so a rank sums the counts of higher levels and reads at most 101 profiles of the member's own level. The rank is exact unless more than 100 of them score higher, when it is the range of positions the level allows. Awards, corrections and imports move a profile's count only when its level changes, and a server reset drops the old epoch's counts. The retention chain counts the profiles of servers from before these counts, 256 per pass, and until it finishes a rank reads at most 1,000 profiles and is exact within the top 1,000. Up to 20 reward roles are applied through the shared role ledger. Awards, corrections, resets and mapping changes mark accounts, and the worker clears a mark only after a fully settled pass

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/levels/manage` | 262,144 | Settings, reward mappings, corrections and resets |
| `/levels/query` | 262,144 | Settings, rank, leaderboard and audits |
| `/levels/preflight`, `/levels/award` | 262,144 | Candidate admission and atomic award |
| `/levels/work` | 262,144 | Reward role work |

## Events, birthdays, anniversaries and suggestions

These features share publishing's protected posts and claim lifecycle. Their automatic sends act as the bot and need the bot's channel permissions, the module and publishing switches, and an allowing DEFCON level. Administrators are checked when configuring

### Events and RSVPs

Events start disabled. Each definition has a frozen calendar of at most 26 occurrences within 180 days, using the same civil rules as schedules, with durations from 1 to 10,080 minutes. RSVPs store one record per account and occurrence with the membership token, without names or message bodies. Capacity is off or 1 to 500 seats with a first-in waitlist. Reminders default to 1,440 and 60 minutes before start and are skipped once five minutes late or when the event starts

Limits are 50 definitions, 200 retained occurrences, 1,000 RSVPs per occurrence and 50,000 overall. Source receipts are kept for 24 hours and terminal event history for 180 days

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/events/manage`, `/events/query` | 65,536 | Configuration, cancellation, forgetting and status |
| `/events/rsvp` | 65,536 | Ordered RSVP changes and seat allocation |
| `/events/work` | 65,536 | Waitlist promotion and departed-member cleanup |
| `/events/delivery` | 65,536 | Card and reminder reservation |

### Birthdays and membership anniversaries

Two annual routes are configured separately, each with a template snapshot, destination, IANA zone and local time. Members opt in privately through DMs. Birthdays store month and day only, never a year or age, and February 29 maps to February 28 in non-leap years. Anniversaries keep the exact native `joinedAt` and count complete years. Leaving the server or changing the destination revokes consent

A late delivery still sends until local midnight, and a missed day does not consume that year's birthday. Removing enrollment deletes it immediately. Settled deliveries retire after 30 days, and body-free fences that prevent a second celebration in the same year stay for 400 days. Limits are 1,000 enrolled accounts, 4,000 retained deliveries, 1,000 staff receipts and 10,000 member receipts per server

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/milestones/manage`, `/milestones/query` | 65,536 | Staff configuration, preview and delivery pages |
| `/milestones/personal` | 65,536 | DM enrollment, own state and removal |
| `/milestones/delivery` | 65,536 | Due discovery, reservation and deferral |

### Suggestions

Each suggestion stores its text, status, vote counts and a protected card. Each account has at most one vote per suggestion, and votes take no revision numbers. Status keeps only the latest reason, actor and time. Voter IDs stay out of public projections but are visible to database administrators. Card updates coalesce for five seconds before an edit is queued

Limits are 1,000 retained suggestions, 1,000 voters per suggestion and 10,000 per server, 1,000 staff receipts and 10,000 member receipts. Terminal suggestions expire after 180 days. Forgetting removes backend data without deleting posted cards

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/suggestions/manage`, `/suggestions/query` | 65,536 | Staff status, configuration and reads |
| `/suggestions/member` | 65,536 | Submission, votes and withdrawal |
| `/suggestions/work` | 65,536 | Card send and edit work |

## Message cleanup and metadata logs

### Automatic message cleanup

Cleanup starts disabled at module and channel level. Each channel policy sets an age from one hour to 365 days and can exclude up to 50 authors and 100 messages, with at most 50 policies per server. Enabling a policy needs explicit confirmation because existing old messages may be deleted. Automatic work runs under the server automation policy: The bot's permissions, the module and policy switches, and DEFCON. The atomic backend claim is the final check before each delete

Pinned, system, webhook, bot and unclassifiable messages are skipped, as are protected publishing and panel messages. No message bodies or attachments are stored. Delete grants expire after 120 seconds with a five-second native request, and uncertain deletes are not retried. Settled audit expires after 30 days

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/cleanup/manage`, `/cleanup/query` | 65,536 | Policies, exclusions and status |
| `/cleanup/work` | 65,536 | Sweep pages, target reservation, claims and outcomes |

### Metadata logs

Metadata logs record body-free server events, such as configuration, member, channel and role changes and 18 audit-log actions, into configured log channels. Settings hold module and category routes, per-event overrides, message opt-ins and channel exclusions. Records keep changed-field names and at most 20 resource IDs. Thread events are the resources types `thread-create`, `thread-update` and `thread-delete`, which require `parentChannelId`. A `thread-delete` record for a deleted parent carries the count of the threads the bot knew, with up to 20 of their IDs

Each server retains at most 10,000 records, and the oldest are evicted at capacity. There is no daily cap. Settled records expire after 30 days. Delivery runs as the bot under the automation policy with a 120-second grant and five-second request, and uncertain sends are not replayed. `!logs metadata status` reports the bot's current permissions in each enabled destination

The counters report reads three settings rows. Retained moderation cases are the cases numbered so far minus `casesRemoved`, which retention increments for each case it deletes. `ticketSettings.activeTickets` changes with every ticket that becomes active or inactive. A server whose ticket settings predate the count is counted by reading up to 1,000 active tickets, as before, until its next active change counts them once

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/metadata-logs/admit` | 65,536 | Record one event |
| `/metadata-logs/manage`, `/metadata-logs/query` | 65,536 | Routes, overrides and record reads |
| `/metadata-logs/work` | 65,536 | Delivery reservation, claims and outcomes |

## Temporary voice rooms

`voiceGenerators` stores each generator's channel, room category, room name template, default member limit, region and revision, with at most 10 per server. `voiceRooms` stores each live room's channel, owner, generator and creation time, with at most 50 per server and one per owner. Generator names are channel names, which the bot applies natively. The backend validates them but does not store them

Generator changes from chat follow the moderation staff rule for channel management: Owner, Administrator, or a moderation staff role together with a fresh native Manage Channels read. DEFCON 1 leaves only Owners and Administrators. Dashboard changes use the shared configuration family `voice`. The bot records each room right after creating it and removes a record when its channel is deleted, so no retention job is needed. Occupancy, grace timers and voice state stay in the bot

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/voice/query` | 65,536 | Generators, rooms and staff and room-owner authority |
| `/voice/manage` | 65,536 | Generator creation, settings and removal |
| `/voice/rooms` | 65,536 | Room records and records of deleted channels |

## Selective backup and additive restore

Backups export selected authored configuration, effective XP and channel structure. Private history, participation, receipts and live ownership are never exported. The bot encrypts archives with AES-256-GCM using `NEONFLUX_BACKUP_KEY`. Recovery keys and archive bytes never reach the backend. Owner commands run in a verified DM

Structure export covers categories, text and voice channels and skips other channel types. An export larger than the restore limits is refused, so every archive stays restorable. Limits are a 1 MiB snapshot, 1,000 XP profiles, 100 structure items and 500 permission overwrites

Restore is additive. `backupPlans` keeps the archive hash, owner binding and preview counts with a 15-minute expiry, and `backupItems` keeps at most 500 operations per plan. A server keeps at most ten plans of up to 512 KiB of manifest each. Confirmation binds the exact owner, plan and archive. Imports create missing data, skip identical items and leave conflicts untouched. Restored automation stays disabled and imported XP grants no reward roles. `backupOrigins` keeps up to 5,000 body-free mappings so the same archive item is never imported twice, and `backupOriginCounts` counts them per provider so a capacity check reads one row. A restore step checks a plan's unresolved items through an index instead of reading every item. Settled plan details expire after seven days

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/backup/snapshot`, `/backup/query` | 262,144 | Export projection and plan reads |
| `/backup/manage` | 1,048,576 | Plan creation, confirmation and forgetting |
| `/backup/work` | 262,144 | Native structure creation and outcomes |

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

The dashboard's `analytics:dashboard` query returns zero-filled 30-day join and leave and 14-day message series, the top ten channels for 7 or 30 days and the messages per UTC hour for each day of that range. Hours cover every channel, or the one channel named by the optional `channelId`. `analytics:save` rechecks provider permission and writes the switch directly with the expected revision, like the prefix

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/analytics/record` | 65,536 | Add one numbered batch of count buckets |
| `/analytics/settings`, `/analytics/summary` | 4,096 | Read the switch and the seven-day summary with the busiest hours |
| `/analytics/manage` | 4,096 | Set the switch with Manage Server evidence |

## Multi-server scope

A deployment runs in `single` mode, where it serves the server in `NEONFLUX_SERVER_ID`, or in `multi` mode, where it serves the servers the bot registers. Multi mode has no server list or server limit. The bot and backend must use the same mode, so changing it means updating both and restarting the bot

`/service/scope` checks the key and returns `{ mode: "multi" }`, or `{ mode: "single", serverIds }` in single mode. The bot compares it with its own configuration before starting any server runtime

`serverInstallations` keeps one row per server the bot has joined, with an `active` or `removed` status, `joinedAt`, `lastSeenAt` and, after removal, `removedAt` and the purge's `purgeLeaseUntil`. The bot calls these when it starts, joins a server or is removed from one. They bind no server, have a body limit of 4,096, return `404` in single mode and leave the same state when repeated. A join answers `dueIn: 0`, so the bot looks for work the server kept

| Path | Body | Purpose |
| --- | --- | --- |
| `/service/installations/list` | `{ cursor }`, optional | Lists active servers, 500 per page, with `nextCursor` or `null` |
| `/service/installations/join` | `{ serverId }` | Marks the server active. A removed server becomes active again with the data the purge has not deleted. The join that starts an installation, the first or one after a removal, also answers `welcome: true`, so the bot posts its install note once per install |
| `/service/installations/leave` | `{ serverId }` | Marks the server removed and records `removedAt`. Its data stays for 30 days |

Every feature request selects its server with the `serverId` argument, which single mode may omit. It must match `request.serverId` and name the configured server in single mode or an active installation in multi mode. Each bot service function checks the installation in its own transaction before any domain work, so a removed server is rejected with its data kept. Otherwise the function answers `403` with `code: "NEONFLUX_SCOPE_DENIED"`. Native evidence names the server it was read from in `originServerId` or `memberOriginServerId`, which must match the selected server. In multi mode, authority and membership facts without an origin are rejected

`metadataLogAdmissions` and `responseCooldowns` have `by_server` indexes for per-server cleanup

All servers share one service secret and so one key. Scope checks prevent accidental cross-server use but do not protect one server from a compromised holder of that secret or key. Server administrators cannot change credentials or registrations

### Server data after removal

In multi mode the backend deletes a removed server's data 30 days after `removedAt`. An hourly cron purges one server at a time, the oldest removal first. Each run deletes at most 256 rows per table, ends early after 2,048 rows or about 4 MiB, and schedules the next run until every per-server table is empty. The installation row goes last. Moderation corrections have no server ID and are deleted with their case. Dashboard sessions are shared by all servers and expire on their own, and the one-row work signal is shared by the whole bot. The purge makes no Fluxer requests, and single mode never purges

Every run first rechecks the installation, so a server that joins again stops its purge. Joining again after the purge finished starts with no data, and joining while it runs keeps the rows not yet deleted. Leaving again starts a new 30 days for what is left. Only one purge runs at a time, and a stopped purge resumes on a later cron run once its 10-minute lease ends

Every table with a `serverId` field needs an entry in `PURGE_INDEXES` in [installationsPurge.ts](../projects/backend/convex/installationsPurge.ts), which names an index that starts with `serverId`. Typechecking fails until a new table is listed, and the purge tests also fail for a table without a server ID that is neither purged through its parent nor listed as shared

## Background work dispatch

`/service/work` tells the bot's one work dispatcher which servers have due work for each background worker. It checks the key, binds no server and works in both modes. The body is `{ cursor, requestedAt }`, with a 4,096 body limit, and the answer is `{ kinds, cursor, nextDueIn }`. `kinds` lists for each worker the servers with due work, oldest due first and at most 100 per worker. In multi mode only active installations appear, and in single mode only the configured server. The bot returns the opaque `cursor` with its next request. Due checks use the backend clock, and the bot's `requestedAt` only keeps each call distinct, so a cached query result never hides work that became due since. `nextDueIn` is the time until the earliest row of any timed source becomes due, or `null`. It reads one row per timed source and ignores servers and settings, so it can only be early

Each worker's rows are read from global indexes in due order, at most 100 rows per index range and request, so a server without due rows costs no reads. Due rows that no worker will act on, such as those of removed servers or paused features, are still read on each request until they change or are purged. A range that filled its page continues after its last row on the next request, so such rows delay but never hide other servers' work. A server is listed only when the worker's own function would act, so settings that pause a worker, a held lease or work due later keep it off the list

| Worker | Listed when | Index |
| --- | --- | --- |
| `dashboard` | A job waits for the bot and has not expired. Every dashboard job table is read by state, so new job families in those tables need no change | `by_state` on each dashboard job table |
| `verification` | A solved or redeemed proof has no outcome, while advanced verification is on at DEFCON 3 | `verificationLinks.by_global_ready` |
| `events` | A queued, blocked or unclaimed reserved reminder is due, or a waitlist occurrence is due while events are on at DEFCON 3 | `eventDeliveries.by_global_due`, `eventOccurrences.by_global_work` |
| `schedules` | An active delivery's due time and check time have passed | `scheduleDeliveries.by_global_due` |
| `milestones` | An enrollment's check time has passed | `milestoneEnrollments.by_global_discovery` |
| `suggestions` | A changed card is due while suggestions and publishing are on | `suggestions.by_global_work` |
| `cleanup` | An enabled policy is due while cleanup is on and DEFCON is not 1 | `cleanupPolicies.by_global_due` |
| `metadata` | A record with delivery work is due | `metadataLogRecords.by_global_work` |
| `levels` | A dirty level profile's reward time has passed, or a reward sweep is pending | `levelingProfiles.by_global_reward_due`, `levelingSettings.by_sweep` |

The bot learns about new work in three ways, so it needs no short poll. `workSignal` holds one row with a counter. Website writes that create bot work raise it in their own transaction: queued dashboard configuration, message, metadata and role jobs, role picker member requests, permission check requests, a solved web verification and a saved dashboard prefix, which leaves a settings log record. The bot subscribes to `/service/work-signal`, a key-checked query that returns only `{ version }`, and dispatches when it changes. A bot mutation reports `dueIn` for the rows it wrote to these tables that its sources would read, by the same prefix and due order, so the bot's own writes never touch the shared row. Each dispatch reports `nextDueIn` for later work. The bot still dispatches every two minutes, which also picks up work that becomes actionable without a write, such as an expired lease or a reopened setting

## Bill guard

Convex bills query, mutation, action, HTTP action and file storage calls as function calls, and counts explicit client calls, scheduled executions and subscription updates, as its [limits](https://docs.convex.dev/production/state/limits) and [usage limits](https://docs.convex.dev/production/usage-limits) pages describe. Convex documents no way for a deployment's own functions to read its billed usage, so NeonFlux counts the calls the bot causes itself. The Convex documentation does not say whether a query answered from its cache is billed, so the bot counts every call it makes

The bot counts each function it calls and each work signal update it receives. At startup, every five minutes and on a normal shutdown it reports the calls counted since its last accepted report to `/service/usage`, a key-checked mutation that binds no server and works in both modes. The body is `{ calls }`, a whole number of at most 100,000,000, with a 4,096 body limit. The backend adds it to the current UTC month's row in `usageMonths`, the window on which Convex monthly usage limits reset, and answers `{ month, calls, budget, state, warn }`. The report costs one call every five minutes, about 8,900 a month per bot process, and the bot counts it in its next report. A failed report keeps its calls for the next one. A report whose answer was lost is counted again, which errs toward pausing early. Each bot process reports its own calls, so the month's total covers all of them

`NEONFLUX_MONTHLY_CALL_BUDGET` sets the budget in function calls, not money, because NeonFlux does not hard-code plan prices or included amounts. Convert a spending budget with your plan's price per call. Without a budget the state is always `normal`, and reports still record the month's calls. With a budget the state is:

| State | From | Bot behavior |
| --- | --- | --- |
| `normal` | Below the warning share | Everything runs |
| `warning` | `NEONFLUX_BUDGET_WARNING_SHARE` of the budget, 0.65 by default | The month's first report at or past the warning share answers `warn: true`, and the bot logs one warning |
| `paused` | 90 percent of the budget | The bot pauses optional work, as [the bot guide](BOT.md#optional-work-limits-and-the-bill-guard) describes, until a report answers another state |

The state follows each report, so raising the budget resumes optional work at the next report, within five minutes, and a new UTC month starts at zero. A malformed setting answers `503 Usage budget not configured correctly`, and the bot keeps its last state

The count leaves out calls the bot does not cause: the website's dashboard and verification functions and their subscriptions, which grow with dashboard use, and scheduled functions. The scheduled jobs are the ten-minute retention chain, which continues itself while expired rows remain, and the hourly analytics cleanup and installation purge, so at least about 6,000 runs a month. Set the budget with room for these, and keep Convex's own warning and disable thresholds, set in the team's spending limits or the deployment's usage limits, well above the bill guard as a last resort. A disable threshold stops the whole deployment, moderation included

## Dashboard and web verification

The dashboard uses separate public Convex functions with its own Fluxer OAuth sign-in, checked against `FLUXER_CLIENT_ID`, and a revocable session that lasts at most eight hours. Sign-in lists the servers where the user is the owner or has Manage Server or Administrator, limited to installed servers, and every dashboard request rechecks the installation. Writes recheck provider permission and queue a short-lived job bound to the session and the family revision. The bot then executes it with fresh native evidence through the `/dashboard-configuration`, `/dashboard-messages`, `/dashboard-metadata` and `/dashboard-roles` functions. Browser input never supplies native permission proof, and bot credentials never reach browser code. See [the web guide](WEB.md)

Reads are live queries, one per dashboard view, so the website subscribes only to what the open section shows. `dashboardViews` holds the general view with the prefix, the role view with role settings, panels and recent role jobs, the recent message jobs, the overview and the template choices. The overview reports each feature as on, needing setup, such as a missing channel or first entry, or off. [setupCheck.ts](../projects/backend/convex/setupCheck.ts) computes these states for both the overview and the bot. Template choices carry each saved template's and draft's kind, name and revision, never its content, up to a requested limit of at most 500 of each kind. Configuration families, logging and analytics keep their own queries

Every dashboard query reads the session row, so a write to it reruns all of that session's live queries. Read access lasts five minutes after it was last extended. A session refresh or a write extends it only once it has run down by at least a minute, and changed server lists and names are written at once, so routine saves and refreshes leave the session row and its queries alone

Sign-in also stores member servers: Servers the user joined without managing them, where NeonFlux is installed and the role picker is on. A session refresh recomputes them, and manager writes leave them unchanged. Member functions accept a managed or member server and recheck the installation and the switch on every request, while manager functions keep accepting managed servers only. See [role picker and member access](#role-picker-and-member-access)

Web verification needs advanced verification enabled and DEFCON 3. It issues a link that is valid for ten minutes, with at most 500 new links per server per hour and a 60-second reissue cooldown. Starting a challenge requires a Turnstile token, which Convex checks through Siteverify for the expected action and an exact configured hostname. It fails closed when configuration or the provider is unavailable. The challenge is a motion CAPTCHA with a 90-second deadline and two attempts. A solved proof reserves the verification role, and its grant never outlives the proof. See [the CAPTCHA notes](CAPTCHA.md)

| Path | Body limit | Purpose |
| --- | --- | --- |
| `/verification/issue`, `/verification/request` | 65,536 | Link issuance and challenge reads for the bot |
| `/verification/ready`, `/verification/claim`, `/verification/delivery` | 65,536 | Proof discovery, role claim and outcome |
| `/verification/review` | 65,536 | Administrator review of a member who needs assistance |

### Setup and permission checks

The bot's `!setup` and `!health` and the dashboard's permission check read the same data through these functions, with a body limit of 4,096 for the reads and 65,536 for the answer

| Path | Body | Purpose |
| --- | --- | --- |
| `/setup/status` | `{ serverId }` | Each feature's state, as the overview reports it, and the roles each feature assigns: autorole roles and reservations, reaction and verification panel roles, role picker roles and level rewards, at most 100 per feature |
| `/setup/ready` | `{ serverId }` | `{ queued }`, whether the website waits for a check |
| `/setup/record` | `{ serverId, problems }` | The bot's answer to a waiting check. Returns `{ recorded: false }` when no check waits or it expired |

`setupCheck:request` is a dashboard mutation for a manager's session. It queues one check per server in `dashboardSetupJobs`, raises the work signal and gives the bot 60 seconds to answer, after which a scheduled function marks it failed. A request while a check waits, or within 10 seconds of the previous one, changes nothing, so the refresh button cannot keep the bot reading Fluxer. `setupCheck:view` returns the latest check. A problem is a missing set of permissions for a feature, roles a feature assigns that rank at or above the bot, or a gateway state other than connected, stored as permission keys, role IDs and names and the state. The bot reads Fluxer with its own token, so the check never uses the manager's sign-in
