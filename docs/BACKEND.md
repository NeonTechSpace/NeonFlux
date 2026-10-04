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

The key is the lowercase hex HMAC-SHA256 of the fixed label `neonflux/bot-service-key/v1` from the service contract, keyed by `NEONFLUX_BOT_API_SECRET`. The bot derives it and never sends the secret, so the secret does not appear in function arguments. Each function first checks the server scope and the secret, then compares the key in constant time, before it reads anything. Changing the label changes the key on both sides

The function then binds the request to one server, as described in [server scope](#server-scope), checks the path's body limit against the request's JSON text in UTF-16 code units and that the request is a JSON object, and checks the origin of native evidence. It runs the feature's own service function handler in the same transaction, and that handler checks the server scope first. A bot function never calls another function, so each bot request is billed as one function call. The feature functions stay internal. IDs are canonical positive decimal strings within the signed 64-bit range. Object field names in requests must be ASCII, as Convex values require

Every request and answer has a schema in the [contracts package](../projects/contracts/). Each function decodes its request with it before its own checks, refusing a mismatch or an unknown key with `400`, and the bot decodes every answer with it. The backend owns the domain rules. It trusts actor, permission and membership facts only because the bot's key vouches for them, so these fields never authenticate a browser user

Chat commands carry no revision numbers. Where a write needs the revision it changes, the bot reads it from the feature's query right before the write, so of two chat changes the later one wins

| Status | Meaning |
| --- | --- |
| `400` | Invalid input, or a request value JSON cannot carry |
| `401` | Missing or wrong key |
| `403` | Authorization denied, or a scope denial carrying `code: "NEONFLUX_SCOPE_DENIED"` |
| `404` | A missing record |
| `409` | Conflict, such as an existing name or a stale revision |
| `413` | Request over the path's limit |
| `429` | A remaining capacity bound was reached |
| `503` | Missing configuration or an unexpected backend failure |

Failures are Convex errors whose data holds the status, a fixed `error` message and, for scope denials, a code.
Unexpected failures answer `503` and are logged without request bodies or keys. Each path's body limit is set in
[botService.ts](../projects/backend/convex/botService.ts)

### Checks

Run these from `projects/` after configuring the deployment

```sh
pnpm --filter @neonflux/backend run codegen --typecheck disable
pnpm run check
pnpm run deploy:dev
```

Codegen uses the existing deployment and writes `convex/_generated/` without publishing functions. Keep those generated files in version control and regenerate them when the schema or function interface changes. `pnpm run check` checks formatting, then runs the contracts, backend and bot checks. `pnpm --filter @neonflux/backend run check` runs only the backend typecheck and its Node tests, which call the bot's public functions through `convex-test` with synthetic credentials and need no deployment credentials. `pnpm run deploy:dev` runs `convex dev --once --typecheck disable`, which publishes one development update and exits. Use `pnpm --filter @neonflux/backend run dev --typecheck disable` to keep watching files

Retention cleanup runs as one chain that a Convex cron starts every ten minutes, so an idle deployment runs it 144 times a day. Each run visits every feature's cleanup in bounded batches and repeats a feature while its batch is full. A run stops after about 2,048 documents or 4 MiB and schedules the next run at once, so a backlog drains in back-to-back runs. A feature whose full batch changed nothing waits for the next run instead of repeating. While a run is scheduled, the cron leaves it alone. Expired rows wait at most ten minutes, and nothing depends on an earlier run. A feature whose cleanup fails runs in its own sub-transaction on later runs until it succeeds, so other features keep their retention

## Bot foundation

### Threads and channel rules

For a message in a thread, the bot sends the thread's parent channel as `parentChannelId` with `/responses/evaluate`. It is validated like any other ID and must differ from the message's channel. Response channel restrictions then match the thread or its parent. Without `parentChannelId`, they match only the message's own channel

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

## Server scope

A deployment serves the server in `NEONFLUX_SERVER_ID`. The deployment owns the scope, so changing it means updating the deployment and restarting the bot, which adopts it. A bot environment that sets its own `NEONFLUX_SERVER_ID` must match

`/service/scope` checks the key and returns `{ serverIds }` with exactly one server. The bot adopts it before starting any server runtime

Every feature request selects its server with the `serverId` argument, which may be omitted. It must match `request.serverId` and name the configured server. Each bot service function checks the server in its own transaction before any domain work. Otherwise the function answers `403` with `code: "NEONFLUX_SCOPE_DENIED"`. Native evidence names the server it was read from in `originServerId`, which must match the selected server
