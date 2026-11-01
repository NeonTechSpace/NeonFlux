---
title: Optional services
description: Turn on web verification, stream alerts, X feeds, backup archives and a monthly budget
---

The bot runs without any of these. Each one stays off until its settings exist, and the rest of NeonFlux keeps working

| Service                                  | Set in             | Without it                                           |
| ---------------------------------------- | ------------------ | ---------------------------------------------------- |
| [Turnstile](#turnstile-for-verification) | Website and Convex | Advanced verification cannot start                   |
| [YouTube alerts](#youtube-alerts)        | Convex             | `!youtube add` answers that alerts are not available |
| [Twitch alerts](#twitch-alerts)          | Convex             | Adding a streamer is unavailable                     |
| [X feeds](#x-feeds)                      | Convex             | `!feed add x` answers that X feeds are not available |
| [Backup key](#backup-key)                | Bot                | Backup export, inspect and new previews are disabled |
| [Bill guard budget](#bill-guard-budget)  | Convex             | Calls are still counted, and nothing pauses          |

## Turnstile for verification

[Advanced verification](../features/verification.md) sends members to a browser page, where Cloudflare Turnstile checks them before the challenge starts. Turnstile loads Cloudflare's script and sends data to Cloudflare

1. Create a Turnstile widget in Cloudflare
2. Set `TURNSTILE_SITE_KEY` in `web/.env` and restart the website
3. Set `TURNSTILE_SECRET_KEY` in the Convex deployment

Turnstile accepts tokens from the host of `NEONFLUX_WEBSITE_URL`. Set `TURNSTILE_HOSTNAMES` in Convex only when Turnstile reports another hostname. It takes comma-separated exact lowercase hostnames without scheme, port or path, and anything else stops verification starts until fixed

## YouTube alerts

[YouTube alerts](../features/stream-alerts.md) use YouTube's own push notifications. No YouTube API key is needed

1. Set `NEONFLUX_WEBSUB_HUB_URL` in the Convex deployment, such as `https://pubsubhubbub.appspot.com/subscribe`
2. In a server, send `!youtube add <channel-ID> #channel`
3. Send `!youtube status <name>` to see whether it connected

The first alert can take a few minutes while YouTube confirms the subscription

## Twitch alerts

[Twitch alerts](../features/stream-alerts.md) use Twitch's webhook notifications

1. Create a Twitch application and copy its client ID and client secret
2. Set `NEONFLUX_TWITCH_CLIENT_ID` and `NEONFLUX_TWITCH_CLIENT_SECRET` in the Convex deployment. Both are required
3. In a server, send `!twitch add <login-or-link> #channel`

These credentials stay in the backend and never reach the bot or the browser

## Callback address

YouTube and Twitch call the deployment's own HTTP Actions address, which Convex provides. To use a custom domain instead, set `NEONFLUX_WEBSUB_CALLBACK_BASE` to its HTTPS origin, with no path. Twitch also requires port 443

## X feeds

[Bluesky feeds](../features/feeds.md) need nothing here. X needs your own paid key, and X bills per post read

> **Not tested against real X:** X feeds have only run against a local copy of X's published API description

1. Set `NEONFLUX_X_BEARER_TOKEN` in the Convex deployment
2. Optionally set `NEONFLUX_X_MONTHLY_POST_READS`, the monthly cap on X reads, 5,000 by default
3. Optionally set `NEONFLUX_X_POLL_MINUTES`, the minutes between reads of an X account, 30 by default and 5 at least

`NEONFLUX_FEED_SOURCE_LIMIT` optionally limits the accounts one deployment follows across all servers and both services, 1,000 by default

## Backup key

The key encrypts [backup archives](../features/backup.md). It stays with the bot and never reaches Convex

1. Generate 32 random bytes and encode them as base64. NeonFlux never generates this key
2. Set the result as `NEONFLUX_BACKUP_KEY` in `bot/.env`. Use a value independent of the other credentials
3. Restart the bot. The startup line then says `backup key set`

> **Warning:** A lost key makes its archives unreadable, and a changed key makes older archives unreadable until the old key is restored. Keep offline copies of the key and of every archive

## Bill guard budget

Convex bills by function calls. The bill guard counts the calls the bot causes and pauses optional work before a monthly budget runs out

1. Set `NEONFLUX_MONTHLY_CALL_BUDGET` in the Convex deployment to a whole number of calls. It counts calls, not money, so convert a spending budget with the Convex plan's price per call
2. Optionally set `NEONFLUX_BUDGET_WARNING_SHARE`, above 0 and below 0.9. It defaults to 0.65 and needs a budget set

| Share of the budget     | What happens                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| Below the warning share | Everything runs                                                                                        |
| At the warning share    | The bot logs one warning a month                                                                       |
| At 90 percent           | The bot pauses optional work in every server until the month rolls over in UTC or the budget is raised |

- Optional work means clearing AFK statuses and naming AFK members, custom commands, autoresponders, XP, analytics counting, sticky reposts, help desk reminders, logged webhook posts, edits and deletions, board reposts, and Bluesky and X polling
- Moderation, automod, built-in commands, DEFCON and background workers never pause
- Raising the budget resumes optional work within five minutes
- An invalid value also pauses optional work, and the deployment's logs name the variable to fix

Leave room in the budget, because the count leaves out website calls, scheduled jobs and YouTube's own callbacks. Keep Convex's own spending limits well above the bill guard as a last resort. A Convex disable threshold stops the whole deployment, moderation included
