# Configure the backend

This guide is for operators deploying NeonFlux's Convex backend and contributors changing its contracts. The bot calls public Convex functions for every persisted feature, each checked with a key derived from the bot secret. See [the bot guide](BOT.md) for commands

## Shared setup

### Configure a cloud development deployment

NeonFlux uses a Convex cloud development deployment. Use a [deployment-specific development key](https://docs.convex.dev/cli/deploy-key-types), which lets the CLI target that deployment without an account login on this machine. Do not use a production key or a preview or project token for this setup

1. Select the development deployment in the Convex dashboard
2. Open its deployment settings and copy its deployment URL, which normally ends in `.convex.cloud`
3. Create a development deploy key with permission to deploy functions and configure environment variables
4. Copy [the backend environment example](../projects/backend/.env.example), a template for the Convex CLI only, to `projects/backend/.env.local` and fill `CONVEX_DEPLOY_KEY`
5. Set the deployment's variables from [the table below](#environment-variables) through the dashboard: the server scope and `NEONFLUX_BOT_API_SECRET`. Local `.env.local` values do not reach the deployed functions
6. Set the same secret in `projects/bot/.env`, with `CONVEX_URL` set to the copied deployment URL. The bot adopts the scope from the deployment. See [the bot guide](BOT.md) for the bot token and the remaining bot settings

Keep the bot API secret separate from the Fluxer bot token and the Convex deploy key. The deploy key belongs only in the backend's local configuration. Never provision the whole backend `.env.local` with `convex env set --from-file`, because that would upload the deploy key into the application environment. Environment files are ignored, and only the examples belong in version control

The bot needs the deployment URL, not the HTTP Actions URL ending in `.convex.site`. The backend serves no HTTP actions. Copy the exact URL when using a custom domain. The backend uses standard Convex functions and environment variables with no cloud-only identity dependency, but a self-hosted deployment procedure is not documented or verified

### Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `CONVEX_DEPLOY_KEY` | `projects/backend/.env.local` only | Lets the CLI deploy to the development deployment |
| `NEONFLUX_SERVER_ID` | Convex | The one allowed server. The bot adopts it, and may set it too only as a check |
| `NEONFLUX_BOT_API_SECRET` | Convex and bot | Shared bot service secret of at least 32 characters, without surrounding spaces. The bot sends only a key derived from it |

Invalid scope configuration or a short or padded bot secret fails closed with `503 Backend not configured` and logs the variable to fix, never its value. Generate the bot API secret randomly and rotate it in Convex and the bot together

### Service authentication and errors

The bot reaches the backend through the public functions in [botService.ts](../projects/backend/convex/botService.ts), one for each path listed in this guide. The [service contract](../projects/contracts/src/service.ts) lists every function by name and whether it is a query or a mutation, and the bot maps each path to its name in [backend-routes.ts](../projects/bot/src/backend-routes.ts), so `/general/manage` is `botService:generalManage`. Each call carries `key`, the bound `serverId` and the `request`

The key is the lowercase hex HMAC-SHA256 of the fixed label `neonflux/bot-service-key/v1` from the service contract, keyed by `NEONFLUX_BOT_API_SECRET`. The bot derives it and never sends the secret, so the secret does not appear in function arguments and keeps its other uses, such as leveling digests. Each function first checks the server scope and the secret, then compares the key in constant time, before it reads anything. Changing the label changes the key on both sides

The function then binds the request to one server, as described in [server scope](#server-scope), checks the path's body limit against the request's JSON text in UTF-16 code units and that the request is a JSON object, and checks the origin of native evidence. It runs the feature's own service function handler in the same transaction, and that handler checks the server scope first. A bot function never calls another function, so each bot request is billed as one function call. The feature functions stay internal, and the scheduler still calls some of them directly. IDs are canonical positive decimal strings within the signed 64-bit range. Object field names in requests must be ASCII, as Convex values require

Mutations answer `{ value, dueIn }`. `dueIn` is present when the mutation's writes created background work, in milliseconds from now by the backend clock, so the bot's [work dispatcher](#background-work-dispatch) can run at that time

Every request and answer has a schema in the [contracts package](../projects/contracts/). Each function decodes its request with it before its own checks, refusing a mismatch or an unknown key with `400`, and the bot decodes every answer with it. The backend owns the domain rules. It trusts actor, permission, membership and private-conversation facts only because the bot's key vouches for them, so these fields never authenticate a browser user

Chat commands carry no revision numbers. Where a write needs the revision it changes, the bot reads it from the feature's query right before the write, so of two chat changes the later one wins

| Status | Meaning |
| --- | --- |
| `400` | Invalid input, or a request value JSON cannot carry |
| `401` | Missing or wrong key |
| `403` | Authorization denied, or a scope denial carrying `code: "NEONFLUX_SCOPE_DENIED"`. Some refusals carry a reason code, see below |
| `404` | A missing record |
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

Codegen uses the existing deployment and writes `convex/_generated/` without publishing functions. Keep those generated files in version control and regenerate them when the schema or function interface changes. `pnpm run check` checks formatting, then runs the contracts, backend and bot checks. `pnpm --filter @neonflux/backend run check` runs only the backend typecheck and its Node tests, which call the bot's public functions through `convex-test` with synthetic credentials and need no deployment credentials. `pnpm run deploy:dev` runs `convex dev --once --typecheck disable`, which publishes one development update and exits. Use `pnpm --filter @neonflux/backend run dev --typecheck disable` to keep watching files

Retention cleanup runs as one chain that a Convex cron starts every ten minutes, so an idle deployment runs it 144 times a day. Each run visits every feature's cleanup in bounded batches and repeats a feature while its batch is full. A run stops after about 2,048 documents or 4 MiB and schedules the next run at once, so a backlog drains in back-to-back runs. A feature whose full batch changed nothing waits for the next run instead of repeating. While a run is scheduled, the cron leaves it alone. Expired rows wait at most ten minutes, and nothing depends on an earlier run. A timeout or ban recovery whose known end has passed stops restricting its member at once, because role participation, leveling and tickets ignore it before retention deletes it. A feature whose cleanup fails runs in its own sub-transaction on later runs until it succeeds, so other features keep their retention

### Opt-in live smoke runner

The script is described in [the bot guide](BOT.md#live-moderation-check)

## Bot foundation

### Threads and channel rules

For a message in a thread, the bot sends the thread's parent channel as `parentChannelId` with `/moderation/evaluate`, `/responses/evaluate` and leveling candidates. It is validated like any other ID and must differ from the message's channel. Channel rules then match the thread or its parent: automod channels and exemptions, honeypot channels, response channel restrictions and leveling's excluded channels. `automodWindows` keeps the parent with each message, so a rule scoped to a channel counts its threads' messages too. Without `parentChannelId`, rules match only the message's own channel

### Prefix

`generalSettings` stores one row per server with the command prefix, a revision, and the update time and actor. The prefix is one to five punctuation characters and defaults to `!`. Changes require Manage community evidence and the expected revision

### AFK

`afkStatuses` stores one active record per server and member: Member ID, trimmed reason of 1 to 200 UTF-16 code units, and a backend timestamp. Setting AFK replaces the reason and timestamp. The member's next ordinary message deletes the record, and the same mutation looks up at most five mentioned members, deduplicated and excluding the author. There is no automatic expiry or message history. Reasons are visible to anyone who mentions the member

### Custom commands and autoresponders

`responseDefinitions` stores content, matching rules, channel and role restrictions, cooldown, priority, enable state and timestamps. `responseSettings` stores separate module switches for custom commands and autoresponders, both enabled by default. New definitions are enabled, unrestricted and have a five-second per-user cooldown

- Names: 1 to 32 letters, numbers, underscores or hyphens, starting with a letter or number, lowercase and unique per kind. Every bot command namespace, such as `prefix`, is reserved
- Cooldown: A stored wait ends early when its definition's cooldown is set to 0
- Limits: 100 definitions across both kinds, ten per list page, 2,000-unit text, 256-unit embed title, 4,000-unit embed description, 200-unit literal trigger, 20 channel and 20 role restrictions, cooldowns from 0 to 3,600 seconds and priorities from -100 to 100
- Matching: Custom commands compare the whole first token case-insensitively. Autoresponders compare trimmed content as exact or contains, never match prefixed messages, and pick by higher priority, then exact over contains, then name
- Rendering: Placeholders are `{user.name}`, `{user.id}`, `{user.mention}`, `{channel.id}`, `{server.id}` and `{args}`. Unknown placeholders are rejected, substitution runs once, limits are rechecked afterwards and all replies disable mentions

`responseReceipts` stores source message IDs and the reservation, without source content, usernames or rendered replies. `responseCooldowns` stores per-definition, per-user eligibility deadlines. Source events must be at most 15 minutes old or one minute in the future. Evaluation first reads the module switches and the prefix. A command then reads only the custom definition of its name and other text only the autoresponders, so most messages read few or no definitions and write nothing. Only a reply reserves the source message and cooldown, atomically, so a redelivered event that replied never gets a second reply, while one that matched nothing may reply after a matching definition appears. The bot sends `roleIds` only after it has read the author's member, from its member cache when it holds one, which member events keep current, and without them the backend answers `{ send: false, memberRequired: true }` when a definition could reply. The bot does not retry an uncertain send. Receipts expire after 24 hours and expired cooldowns are removed by the cleanup cron

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
and three active tickets. Private answers, staff notes and transcripts need fresh membership, role authority and a
verified DM. Creation sends the full permission set in the initial request. Close and reopen change only the everyone
and requester `SendMessages`, `SendMessagesInThreads`, `CreatePublicThreads` and `CreatePrivateThreads` bits. A close
owns `SendMessages` plus the thread bits the ticket context's `botPostingPermissions` reports, records them as the
ticket's `ownedPermissions` until reopen completes, and each close or reopen grant carries the bits it owns. Another
overwrite allowing an owned bit blocks the close, and deletion needs explicit confirmation on a closed channel. The bot
first allows itself the owned bits in the channel, because Fluxer lets it lift a denial only of bits it holds there. A
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

Owner and administrator corrections set absolute XP and apply in source command order. Resets need explicit confirmation, and a server reset hides old scores immediately. Credited receipts expire after a day and correction audits after 180 days. Profiles are capped at 50,000 per server. Leaderboards return 10 profiles per page. `levelingLevels` counts the profiles with XP at each level of the current score epoch, so a rank sums the counts of higher levels and reads at most 101 profiles of the member's own level. The rank is exact unless more than 100 of them score higher, when it is the range of positions the level allows. Awards and corrections move a profile's count only when its level changes, and a server reset drops the old epoch's counts. Up to 20 reward roles are applied through the shared role ledger. Awards, corrections, resets and mapping changes mark accounts, and the worker clears a mark only after a fully settled pass. An account whose pass did not settle is tried again a minute later. The bot's `done` operation carries `held` when the backend refused its role changes, which DEFCON does for additions, and nothing else was left unsettled, so not a removal that failed another way, not another target that is blocked and not retained references beyond one pass. While DEFCON is below 3, which refuses new reward grants, the backend waits an hour for such an account instead, and it checks DEFCON itself. A removal refused for another reason while DEFCON is below 3 also waits the hour, and any other failure is tried again after a minute. Returning to DEFCON 3 schedules a wake that makes the waiting accounts due again. It reads only accounts due more than a minute ahead, which leaves out the minute retries, since they come due on their own within a minute, makes 20 accounts due per transaction through `levelingProfiles.by_reward_due`, raises the work signal, schedules the next batch while a batch is full and stops if DEFCON falls below 3 again

## Events, birthdays, anniversaries and suggestions

These features share publishing's protected posts and claim lifecycle. Their automatic sends act as the bot and need the bot's channel permissions, the module and publishing switches, and an allowing DEFCON level. Administrators are checked when configuring

### Events and RSVPs

Events start disabled. A title has up to 256 code units and a description up to 1,000, the same bound in chat and the contracts, so the event detail reply fits one message. Each definition has a frozen calendar of at most 26 occurrences within 180 days, using the same civil rules as schedules, with durations from 1 to 10,080 minutes. RSVPs store one record per account and occurrence with the membership token, without names or message bodies. Capacity is off or 1 to 500 seats with a first-in waitlist. Reminders default to 1,440 and 60 minutes before start and are skipped once five minutes late or when the event starts. While events or publishing are off or DEFCON is below 3, `list` returns no reminder, so the bot reads nothing from Fluxer for one and the work dispatcher does not list it. A reminder stays due, and is listed again, with a work signal, when events or publishing are turned on or DEFCON returns to 3, if its five minutes have not passed. At the end of its window it is listed once more so that `list` closes it like any late reminder

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

## Server scope

A deployment serves the server in `NEONFLUX_SERVER_ID`. The deployment owns the scope, so changing it means updating the deployment and restarting the bot, which adopts it. A bot environment that sets its own `NEONFLUX_SERVER_ID` must match

`/service/scope` checks the key and returns `{ serverIds }` with exactly one server. The bot adopts it before starting any server runtime

Every feature request selects its server with the `serverId` argument, which may be omitted. It must match `request.serverId` and name the configured server. Each bot service function checks the server in its own transaction before any domain work. Otherwise the function answers `403` with `code: "NEONFLUX_SCOPE_DENIED"`. Native evidence names the server it was read from in `originServerId` or `memberOriginServerId`, which must match the selected server

## Background work dispatch

`/service/work` tells the bot's one work dispatcher which servers have due work for each background worker. It checks the key and binds no server. The body is `{ cursor, held, requestedAt }`, with a 4,096 body limit, and the answer is `{ kinds, cursor, nextDueIn }`. `kinds` lists for each worker the configured server when it has due work. The bot returns the opaque `cursor` with its next request. Due checks use the backend clock, and the bot's `requestedAt` only keeps each call distinct, so a cached query result never hides work that became due since. `nextDueIn` is the time until the earliest row of any timed source becomes due, or `null`. It reads one row per timed source and ignores servers and settings, so it can only be early

Each worker's rows are read from global indexes in due order, at most 100 rows per index range and request, so a server without due rows costs no reads. One request reads at most 12 MiB of rows in total, in chunks no larger than the remaining budget holds at Convex's 1 MiB document limit, and the sources it did not finish continue on the next request. Later requests of the same pass read only the sources the cursor names. The bot goes on with a cursor at once only after a pass that found work. When new work, a due time or the two-minute check starts a pass, its first request reads every source and sends the earlier cursor as `held`. Each source that request leaves unfinished goes on from the further of its new and held positions, so a cursor never hides new work. Due rows that no worker will act on, such as those of other servers or paused features, are still read on each request until they change. A range that filled its page continues after its last row on the next request, so such rows delay but never hide other servers' work. A server is listed only when the worker's own function would act, so settings that pause a worker, a held lease or work due later keep it off the list

| Worker | Listed when | Index |
| --- | --- | --- |
| `events` | A queued, blocked or unclaimed reserved reminder is due while events and publishing are on at DEFCON 3 or its window has ended, or a waitlist occurrence is due while events are on at DEFCON 3 | `eventDeliveries.by_global_due`, `eventOccurrences.by_global_work` |
| `schedules` | An active delivery's due time and check time have passed | `scheduleDeliveries.by_global_discovery` |
| `milestones` | An enrollment's check time has passed | `milestoneEnrollments.by_global_discovery` |
| `suggestions` | A changed card is due while suggestions and publishing are on at DEFCON 3 | `suggestions.by_global_work` |
| `levels` | A dirty level profile's reward time has passed, or a reward sweep is pending | `levelingProfiles.by_global_reward_due`, `levelingSettings.by_sweep` |

The bot learns about new work in three ways, so it needs no short poll. `workSignal` holds one row with a counter. Scheduled wake batches raise it when they make held work due: scheduled posts, birthday and anniversary posts and level rewards. So does returning to DEFCON 3, for the suggestion cards and event reminders it held, and turning events or publishing on, for the event reminders that came due while they were off. The bot subscribes to `/service/work-signal`, a key-checked query that returns only `{ version }`, and dispatches when it changes. A bot mutation reports `dueIn` for the rows it wrote to these tables that its sources would read, by the same prefix and due order, so the bot's own writes do not touch the shared row. Each dispatch reports `nextDueIn` for later work. The bot still dispatches every two minutes, which also picks up work that becomes actionable without a write, such as an expired lease or a reopened setting
