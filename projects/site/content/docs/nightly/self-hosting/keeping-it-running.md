---
title: Keeping it running
description: Update safely, watch the right logs, protect keys and secrets and know what a restart does
---

These steps run from the source checkout, because NeonFlux has no packaged release yet

## Update

Update the backend before the bot. When the two do not match, the bot can stop at startup and say to deploy both from the same version

1. Get the new code
2. From `projects/`, install and publish the backend:

    ```sh
    pnpm install --frozen-lockfile
    pnpm run deploy:dev
    ```

3. Stop the bot and the website, then build them with `pnpm run build`
4. Start the bot with `pnpm run start`, and the website with `pnpm --filter @neonflux/web run start`. Each keeps running, so give each its own terminal or process

## Logs worth watching

| Where   | What to look for                                                                                          | What it means                                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Bot     | `NeonFlux started in ...`                                                                                 | Startup finished, with the mode and whether the website origin and backup key are set            |
| Bot     | `NeonFlux is not in server <id>`                                                                          | Single mode points at a server the bot is not in                                                 |
| Bot     | `Backend budget: warning` or `paused`, and the bill guard's warnings                                      | The [budget](./optional-services.md#bill-guard-budget) is running out and optional work may stop |
| Bot     | A line every ten minutes with Fluxer requests, backend requests, dropped events and skipped optional jobs | Activity for that interval. An idle interval logs nothing                                        |
| Bot     | A warning with `cause.error`                                                                              | Background work failed. `cause.defect` says whether it was a bug rather than an expected failure |
| Convex  | A variable named in the deployment's logs                                                                 | The backend is not configured. Fix that variable                                                 |
| Website | A variable named at startup                                                                               | The website is missing that setting, and sign-in is not available                                |

These logs never hold secret values, and bot warnings hold no message text or names. In a server, `!health` and `!recovery` show permission problems and work that needs attention

## Keep keys and secrets

Keep a private copy of each of these outside the checkout. Environment files stay out of version control

| Secret                    | Lives in              | Worth knowing                                                     |
| ------------------------- | --------------------- | ----------------------------------------------------------------- |
| `FLUXER_BOT_TOKEN`        | `bot/.env`            | Keep it apart from the backend credential                         |
| `NEONFLUX_BOT_API_SECRET` | Convex and `bot/.env` | Change both together                                              |
| `CONVEX_DEPLOY_KEY`       | `backend/.env.local`  | Never upload it into the deployment's variables                   |
| `FLUXER_CLIENT_SECRET`    | `web/.env`            | Must belong to the application in `FLUXER_CLIENT_ID`              |
| `WEB_SESSION_SECRET`      | `web/.env`            | Changing it stops sign-in renewal                                 |
| `NEONFLUX_BACKUP_KEY`     | `bot/.env`            | A lost key makes its archives unreadable, so keep an offline copy |

Also save the variables set in the Convex dashboard, including `TURNSTILE_SECRET_KEY` and the Twitch credentials

[Backup archives](../features/backup.md) are made per server by its owner. They are not a full server, database or message backup, and Fluxer attachments are not durable storage for them

## What happens on a restart

- Greeting, schedule and cleanup queues live in the backend, and workers pick them up again
- DEFCON levels come back as they were
- A scheduled post that came due while the bot was down still sends, until local midnight after its due time
- Anything whose outcome is unknown is never resent. It stays visible as uncertain, and `!recovery` lists most such work
- Dashboard changes wait up to two minutes for the bot. After that they fail and nothing changes
- Lists sent with `next` start again from the first page
- A backup owner sends `!backup status` to pick up the newest plan again

Restart the bot after changing the server mode, server ID or website origin in Convex. Restart the website after changing the origin or the application ID

In multi mode, servers start a few at a time. Events wait until their server has started, and a command in a DM may get `This server is still starting. Try again in a moment`

## What does not exist yet

There are no production deployment or container commands. The setup in these pages is the only documented path, and it publishes to a Convex development deployment

> **Planned:** One bot Docker image on GitHub Container Registry, with build and release automation

> **Planned:** Website hosting and packaging, which are not selected yet
