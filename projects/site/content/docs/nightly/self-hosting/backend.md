---
title: Backend
description: Create the Convex deployment NeonFlux stores its data in, set its variables and publish the functions
---

Convex is the hosted database and function platform NeonFlux runs on. The bot and the website both depend on it, so it comes first

This setup uses a Convex cloud development deployment, reached with a key made for that one deployment. Production keys, preview keys and project tokens are not part of it. Running Convex on a private server has no documented or tested procedure

## Create the deploy key

1. Select the development deployment in the Convex dashboard
2. Open its deployment settings and copy its deployment URL, which normally ends in `.convex.cloud`. The bot and the website both need it
3. Create a development deploy key with permission to deploy functions and configure environment variables
4. Copy the template and put the key in `CONVEX_DEPLOY_KEY`:

    ```sh
    cp backend/.env.example backend/.env.local
    ```

The deploy key belongs only in this file

## Set the deployment's variables

Set these in the Convex dashboard, on the deployment. Values in `.env.local` never reach the deployed functions

| Variable                  | Value                                                                                              | When                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `NEONFLUX_BOT_API_SECRET` | A random secret of at least 32 characters, without surrounding spaces. The bot needs the same text | Always                                     |
| `NEONFLUX_SERVER_ID`      | The decimal ID of the one server to serve                                                          | Single mode. Leave it absent in multi mode |
| `NEONFLUX_SERVER_MODE`    | `single` or `multi`. Unset means `single`                                                          | Multi mode                                 |
| `FLUXER_CLIENT_ID`        | The Fluxer application's ID                                                                        | With the [dashboard](./dashboard.md)       |
| `NEONFLUX_WEBSITE_URL`    | The website origin, such as `https://dashboard.example.com`                                        | With the [dashboard](./dashboard.md)       |

The [optional services](./optional-services.md) add a few more

Keep the bot API secret separate from the Fluxer bot token, the OAuth client secret and the deploy key

> **Warning:** Never load `.env.local` with `convex env set --from-file`. That uploads the deploy key into the application's environment

## Publish the functions

From `projects/`:

```sh
pnpm run deploy:dev
```

This publishes one update to the deployment and exits. Run it again after any update to the code

## Use the right URL

| URL ends in     | What it is       | Used by                                               |
| --------------- | ---------------- | ----------------------------------------------------- |
| `.convex.cloud` | Deployment URL   | The bot and the website, as `CONVEX_URL`              |
| `.convex.site`  | HTTP Actions URL | YouTube and Twitch callbacks only. The bot refuses it |

With a custom domain, copy the exact deployment URL

## When a setting is wrong

A bad server setting, an invalid `NEONFLUX_WEBSITE_URL` or a short or padded bot secret makes the backend answer `503 Backend not configured`. The deployment's logs name the variable to fix and never show its value

To change the bot API secret, set the new one in Convex and in the bot together

## Next step

Continue with [the bot](./bot.md)
