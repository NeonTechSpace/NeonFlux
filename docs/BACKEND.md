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

Missing or invalid configuration fails closed with `503 Backend not configured`. Generate the bot API secret randomly and rotate it in Convex and the bot together

### Service authentication and errors

Every bot route requires `Authorization: Bearer <NEONFLUX_BOT_API_SECRET>`. Feature routes are JSON `POST` requests. Authentication is checked before the body is parsed, and every response carries `Cache-Control: no-store`. IDs are canonical positive decimal strings within the signed 64-bit range. Feature mutations are internal Convex functions and cannot be called as public functions

The bot imports the types-only [shared contracts](../projects/backend/contracts.d.ts) through `@neonflux/backend/contracts` and decodes every response at runtime. The backend owns validation and domain rules. It trusts actor, permission and membership facts only because the bot service credential vouches for them

| Status | Meaning |
| --- | --- |
| `400` | Invalid input or JSON |
| `401` | Missing or wrong service credential |
| `403` | Authorization denied |
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

## Bot foundation

### Prefix

`generalSettings` stores one row per server with the command prefix, a revision, and the update time and actor. The prefix is one to five punctuation characters and defaults to `!`. Changes require Manage Server evidence and the expected revision

### AFK

`afkStatuses` stores one active record per server and member: Member ID, trimmed reason of 1 to 200 UTF-16 code units, and a backend timestamp. Setting AFK replaces the reason and timestamp. The member's next ordinary message deletes the record, and the same mutation looks up at most five mentioned members, deduplicated and excluding the author. There is no automatic expiry or message history. Reasons are visible to anyone who mentions the member

### Custom commands and autoresponders

`responseDefinitions` stores content, matching rules, channel and role restrictions, cooldown, priority, enable state and timestamps. `responseSettings` stores separate module switches for custom commands and autoresponders, both enabled by default. New definitions are enabled, unrestricted and have a five-second per-user cooldown

- Names: 1 to 32 letters, numbers, underscores or hyphens, starting with a letter or number, lowercase and unique per kind. Every bot command namespace, such as `prefix`, is reserved
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
