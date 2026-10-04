# Configure the backend

This guide is for operators deploying NeonFlux's Convex backend and contributors changing its contracts. The bot calls authenticated Convex HTTP actions for every persisted feature. See [the bot guide](BOT.md) for commands

## Shared setup

### Configure a cloud development deployment

NeonFlux uses a Convex cloud development deployment. Use a [deployment-specific development key](https://docs.convex.dev/cli/deploy-key-types), which lets the CLI target that deployment without an account login on this machine. Do not use a production key or a preview or project token for this setup

1. Select the development deployment in the Convex dashboard
2. Open its deployment settings and copy its HTTP Actions URL, which normally ends in `.convex.site`
3. Create a development deploy key with permission to deploy functions and configure environment variables
4. Copy [the backend environment example](../projects/backend/.env.example) to `projects/backend/.env.local` and fill `CONVEX_DEPLOY_KEY`
5. Set `NEONFLUX_SERVER_ID` and `NEONFLUX_BOT_API_SECRET` in the deployment's environment variables through the dashboard. Local `.env.local` values do not reach the deployed functions
6. Set the same server ID and secret in `projects/bot/.env`, with `CONVEX_SITE_URL` set to the copied HTTP Actions URL. See [the bot guide](BOT.md) for the bot token and the remaining bot settings

Keep the bot API secret separate from the Fluxer bot token and the Convex deploy key. The deploy key belongs only in the backend's local configuration. Never provision the whole backend `.env.local` with `convex env set --from-file`, because that would upload the deploy key into the application environment. Environment files are ignored, and only the examples belong in version control

The HTTP Actions URL differs from the `.convex.cloud` client URL. Copy the exact URL rather than deriving it when using a custom domain. The backend uses standard Convex functions and environment variables with no cloud-only identity dependency, but a self-hosted deployment procedure is not documented or verified

### Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `CONVEX_DEPLOY_KEY` | `projects/backend/.env.local` only | Lets the CLI deploy to the development deployment |
| `NEONFLUX_SERVER_ID` | Convex and bot | The one allowed server |
| `NEONFLUX_BOT_API_SECRET` | Convex and bot | Shared bot service credential of at least 32 characters |

A missing or invalid server ID fails closed with `503 Backend not configured`. Generate the bot API secret randomly and rotate it in Convex and the bot together

### Service authentication and errors

Every bot route requires `Authorization: Bearer <NEONFLUX_BOT_API_SECRET>`. Feature routes are JSON `POST` requests. Authentication is checked before the body is parsed, and every response carries `Cache-Control: no-store`. IDs are canonical positive decimal strings within the signed 64-bit range. Feature mutations are internal Convex functions and cannot be called as public functions

The bot imports the types-only [shared contracts](../projects/backend/contracts.d.ts) through `@neonflux/backend/contracts` and decodes every response at runtime. The backend owns validation and domain rules. It trusts actor, permission, membership and private-conversation facts only because the bot service credential vouches for them, so these fields never authenticate a browser user

| Status | Meaning |
| --- | --- |
| `400` | Invalid input or JSON |
| `401` | Missing or wrong service credential |
| `403` | Authorization denied, or a request for a server other than the configured one |
| `409` | Conflict, such as an existing name or a stale revision |
| `413` | Request body over the route's limit |
| `429` | A remaining capacity bound was reached |
| `503` | Missing configuration or an unexpected backend failure |

Error bodies contain a fixed `error` message. Request bodies and credentials are not logged. Body limits are counted in UTF-16 code units and are listed with each feature's routes

### Checks

Run these from `projects/` after configuring the deployment

```sh
pnpm --filter @neonflux/backend run codegen --typecheck disable
pnpm run check
pnpm --filter @neonflux/backend run dev --once --typecheck disable
```

Codegen uses the existing deployment and writes `convex/_generated/` without publishing functions. Keep those generated files in version control and regenerate them when the schema or function interface changes. `pnpm run check` runs the backend and bot checks. `pnpm --filter @neonflux/backend run check` runs only the backend typecheck and its Node tests, which use `convex-test` through the public HTTP entry points with synthetic credentials and need no deployment credentials. The last command publishes one development update and exits. Use `pnpm --filter @neonflux/backend run dev --typecheck disable` to keep watching files

Retention cleanup runs as Convex cron jobs every minute, one per feature, in bounded batches with scheduled continuations

### Opt-in live smoke runner

`pnpm smoke:live` runs [the smoke script](../projects/bot/scripts/smoke-live.ts) against a configured development server without a gateway connection. It reads the bot's `.env` and an ignored `projects/bot/smoke-live.local.json` created from `smoke-live.example.json`, which names the server, an operator, a target member and a channel. It sets the log channel, warns, quarantines, locks a channel and checks DEFCON gates through the production backend adapter and real REST calls. Every change registers its restoration, so restorations run in reverse order after success, failure or Ctrl+C. Its command sources are synthetic, so a pass does not prove gateway command dispatch, member DMs, visible presence or restart behavior. Tests never run it

## Bot foundation

### Prefix

`generalSettings` stores one row per server with the command prefix, a revision, and the update time and actor. The prefix is one to five punctuation characters and defaults to `!`. Changes require Manage Server evidence and the expected revision

### AFK

`afkStatuses` stores one active record per server and member: Member ID, trimmed reason of 1 to 200 UTF-16 code units, and a backend timestamp. Setting AFK replaces the reason and timestamp. The member's next ordinary message deletes the record, and the same mutation looks up at most five mentioned members, deduplicated and excluding the author. There is no automatic expiry or message history. Reasons are visible to anyone who mentions the member

### Custom commands and autoresponders

`responseDefinitions` stores content, matching rules, channel and role restrictions, cooldown, priority, enable state and timestamps. `responseSettings` stores separate module switches for custom commands and autoresponders, both enabled by default. New definitions are enabled, unrestricted and have a five-second per-user cooldown

- Names: 1 to 32 letters, numbers, underscores or hyphens, starting with a letter or number, lowercase and unique per kind. Every bot command namespace, such as `prefix`, `mod`, `publish` and `roles`, is reserved
- Limits: 100 definitions across both kinds, ten per list page, 2,000-unit text, 256-unit embed title, 4,000-unit embed description, 200-unit literal trigger, 20 channel and 20 role restrictions, cooldowns from 0 to 3,600 seconds and priorities from -100 to 100
- Matching: Custom commands compare the whole first token case-insensitively. Autoresponders compare trimmed content as exact or contains, never match prefixed messages, and pick by higher priority, then exact over contains, then name
- Rendering: Placeholders are `{user.name}`, `{user.id}`, `{user.mention}`, `{channel.id}`, `{server.id}` and `{args}`. Unknown placeholders are rejected, substitution runs once, limits are rechecked afterwards and all replies disable mentions

`responseReceipts` stores source message IDs and the reservation, without source content, usernames or rendered replies. `responseCooldowns` stores per-definition, per-user eligibility deadlines. Source events must be at most 15 minutes old or one minute in the future. Evaluation reserves the source message and cooldown atomically, so a redelivered event never gets a second reply. The bot does not retry an uncertain send. Receipts expire after 24 hours and expired cooldowns are removed by the cleanup cron

| Route | Body limit | Purpose |
| --- | --- | --- |
| `/general/get`, `/general/manage` | 4,096 | Read and change the prefix |
| `/afk/set`, `/afk/observe` | 4,096 | Set AFK, and clear it and resolve mentions on a message |
| `/responses/manage` | 32,768 | Definition and module management |
| `/responses/evaluate` | 32,768 | Match one message and reserve at most one reply |

## Moderation, protections, DEFCON and appeals

The backend owns settings, validation, permission policy, action reservations, numbered cases and appeals. The bot owns fresh native permission and hierarchy checks and the platform actions. Configuration requires the server owner or an administrator, and other staff need a configured role for each operation

Manual moderation covers warnings, timeout and clearing, kick, permanent and temporary ban, unban, bounded message deletion, slowmode, and channel lock and restore. It starts enabled. Automod and security detection start disabled and in dry-run mode. Each case records source, actor, target, reason, action outcome, correction history and separate staff-log and warning-notice outcomes. A grant belongs to one source and case and is never replayed after a lost response or uncertain write. Actions, logs and notices still pending when the bot starts are marked uncertain once

- Automod: Message frequency, repeated content, mass mentions, literal words, domain allow or block lists and invite patterns, with channel scopes and exemptions. Detection uses message text and metadata only. One source message reserves at most one action
- Protections: Join bursts, an opt-in honeypot channel that quarantines through a native timeout, and a local watchlist each create a classified case (`join-burst`, `honeypot` or `watchlist`) shown through the case commands. One join-burst case covers a burst window
- Recovery: Owned timeout release and channel restore link a new case to the original action. Channel lock changes only the everyone role's `SendMessages` overwrite bits
- DEFCON: Durable and restored after restart. Level 3 is normal, level 2 blocks public commands while staff work and private appeals continue, and level 1 allows only critical owner and administrator controls. Changing DEFCON does not lock channels

Member appeals use verified one-to-one DMs and reveal only the member's own cases and appeals, so banned users can appeal where Fluxer allows private messages. Staff review requires fresh authorization. A decision records the outcome, and any reversal is a separate explicit moderation action

Cases and closed appeals are retained for a fixed 180 days, and records needed for active recovery are excluded from expiry. Explicit owner erasure removes a case's private text, including corrections and appeal decisions, and keeps a minimal tombstone. Erasure does not remove messages already sent to staff channels, DMs or Fluxer's audit log. There are no capacity limits beyond source deduplication of messages, joins, commands and appeals

| Route | Body limit | Purpose |
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

| Route | Body limit | Purpose |
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

| Route | Body limit | Purpose |
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

| Route | Body limit | Purpose |
| --- | --- | --- |
| `/roles/manage` | 262,144 | Configuration, panel binding and withdrawal |
| `/roles/query`, `/roles/member-query`, `/roles/policy` | 262,144 | Staff reads, member context and module policy |
| `/roles/reaction-jobs` | 262,144 | Durable bulk reaction-removal pages |
| `/roles/evaluate` | 262,144 | Participation policy and role reservations |
| `/roles/dispatch`, `/roles/outcome` | 262,144 | One-time claim and native outcome |
| `/roles/reconcile`, `/roles/observe` | 262,144 | Read-only ownership recovery and aging without writes |
