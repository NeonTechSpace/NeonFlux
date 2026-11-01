---
title: Overview
description: What running NeonFlux takes, how the parts fit together and the order to set them up
---

NeonFlux is a bot for Fluxer, a chat platform. Running it means running three parts and connecting them with a few shared settings

## What gets run

| Part              | What it does                                                                                                    | Needed                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Convex backend    | Stores settings and server data, runs scheduled cleanup and answers the bot and the website                     | Yes                                       |
| Bot               | Connects to Fluxer, answers commands and carries out actions in servers                                         | Yes                                       |
| Dashboard website | Lets managers change settings in a browser, and holds the member role picker and the advanced verification page | No, chat commands keep working without it |

The public homepage and this documentation site are not needed to run a bot

## How the parts fit together

- The bot talks to Fluxer with its own token and to the backend with a shared secret
- The website talks to the backend and signs people in through Fluxer. It never receives the bot token
- A dashboard save goes to the backend, and the bot then applies it after checking permissions
- The backend owns the server mode and the website address. The bot reads both at startup, so they are not set in the bot's own environment

## What is needed before starting

- Node.js 24 and pnpm 12, installed without Corepack. The exact Node version is in `projects/.node-version`, and the workspace selects its own pnpm version
- A Convex account with a cloud development deployment
- A Fluxer account and a server to manage
- For the dashboard on other devices: A public HTTPS address and a reverse proxy
- For advanced verification only: A Cloudflare Turnstile widget

## Get the code

Every command in these pages runs from `projects/`

```sh
git clone https://github.com/NeonTechSpace/NeonFlux
cd NeonFlux/projects
pnpm install --frozen-lockfile
```

To confirm the checkout is healthy, run `pnpm run check`. It needs no token or network connection

## Set it up in this order

1. [Backend](./backend.md): Create the deployment, set its variables and publish the functions
2. [Bot](./bot.md): Create the Fluxer application, configure the bot, start it and check it with `!ping`
3. [Dashboard](./dashboard.md): Connect the website to the same application and backend
4. [Optional services](./optional-services.md): Turn on only what the server will use

## One server or many

- **Single mode:** The bot serves one named server. This is the default
- **Multi mode:** The bot serves every server it is added to, as a public bot

[Server modes](./server-modes.md) explains how to choose and what differs

> **Planned:** Packaged hosting. Today everything runs from a source checkout, as [Keeping it running](./keeping-it-running.md#what-does-not-exist-yet) explains
