---
title: Bot
description: Create the Fluxer application, configure the bot, start it and read what its startup says
---

The bot is the process that stays connected to Fluxer. Set up [the backend](./backend.md) first, because the bot asks it for its settings at startup

## Create the Fluxer application

1. Create a Fluxer application with a bot account and copy its private bot token
2. Invite the bot to the server it should manage. This link asks for every permission NeonFlux's features use, with `<application ID>` replaced:

    ```text
    https://api.fluxer.app/v1/oauth2/authorize?client_id=<application ID>&scope=bot&permissions=9008694793694454
    ```

An owner can untick permissions when adding the bot. At the very least it needs to read messages and send replies in the channels it should serve. Once it runs, `!health permissions` names anything missing for the features that are on

In multi mode the dashboard shows the same link as **Add NeonFlux to a server**

## Configure the environment

```sh
cp bot/.env.example bot/.env
```

| Variable                  | Value                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `FLUXER_BOT_TOKEN`        | The private bot token                                                                                          |
| `CONVEX_URL`              | The deployment URL, such as `https://example-deployment.convex.cloud`                                          |
| `NEONFLUX_BOT_API_SECRET` | The same text as in the Convex deployment                                                                      |
| `NEONFLUX_CUSTOM_STATUS`  | Optional presence text of at most 128 characters. It shows at DEFCON 3 in single mode and always in multi mode |
| `NEONFLUX_BACKUP_KEY`     | Optional, see [the backup key](./optional-services.md#backup-key)                                              |

- Do not set `NEONFLUX_SERVER_ID`, `NEONFLUX_SERVER_MODE` or `NEONFLUX_WEBSITE_URL` here. They belong in the Convex deployment
- Real environment variables take precedence over this file
- `CONVEX_URL` must use HTTPS, except `localhost` during development, with no credentials, path, query or fragment

Without a backend, leave both backend variables out and set `NEONFLUX_SERVER_ID` to the one server. Commands that need no stored data still work, such as `!ping`, while features that store data are unavailable

## Build and start

```sh
pnpm run build
pnpm run start
```

`pnpm run build` compiles the bot, the website and the public site. `pnpm run start` runs the last build of the bot, so build again after any change

## Check it works

Send `!ping` in the server and expect the reply `Pong!`

No reply can mean the bot cannot read or send in that channel, or that it serves another server. The startup log warns about the second

## Stop it

Press Ctrl+C, or send SIGTERM. Running work gets five seconds to finish

## What the startup log says

| Log line                                                                                                                               | Meaning                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `NeonFlux started in single mode for server <id>, website origin set, backup key not set`                                              | Startup finished. In multi mode it names how many servers Fluxer lists. It says only whether the origin and key are set |
| `Backend budget: normal`                                                                                                               | The [bill guard](./optional-services.md#bill-guard-budget) answered. It can also read `warning`, `paused` or `not set`  |
| `NeonFlux is not in server <id>. Invite the bot to that server or set NEONFLUX_SERVER_ID in the Convex deployment to the right server` | The bot would connect and answer nothing. Fix it and restart                                                            |

Set `FLUXERLY_DEBUG` for more diagnostics

## Common startup failures

Each of these stops the bot with exit code 1. Messages name variables, never their values

| Message starts with                                                         | What to do                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Set FLUXER_BOT_TOKEN`                                                      | Add the token to `bot/.env`                                                                                        |
| `Set CONVEX_URL and NEONFLUX_BOT_API_SECRET`                                | Both are missing. Add them                                                                                         |
| `Set CONVEX_URL to the Convex deployment URL`                               | The value is missing or malformed, or it is the `.convex.site` address. Use the `.convex.cloud` one                |
| `Set NEONFLUX_BOT_API_SECRET`                                               | The secret is missing, under 32 characters or has surrounding spaces                                               |
| `Remove NEONFLUX_SERVER_ID` or `Remove NEONFLUX_SERVER_MODE`                | Delete it from the bot environment and set it in the Convex deployment                                             |
| `Set NEONFLUX_BACKUP_KEY`                                                   | The key is not the base64 encoding of exactly 32 bytes                                                             |
| `The backend refused the bot's key`                                         | The secret differs between the bot and Convex. Set the same text in both                                           |
| `The backend is not configured`                                             | The Convex deployment's logs name the variable to fix                                                              |
| `The backend could not be reached`                                          | Check `CONVEX_URL` and the connection                                                                              |
| `The backend refused the startup request` or `The backend's startup answer` | The backend and the bot are different versions. [Update the backend](./keeping-it-running.md#update), then the bot |

## Next step

Continue with [the dashboard](./dashboard.md), or see [First steps](../features/first-steps.md) to start setting up the server
