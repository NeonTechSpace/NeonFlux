---
title: Dashboard
description: Run the website that lets managers change settings in a browser and sign in with Fluxer
---

The dashboard runs next to an existing bot and backend. It needs its own address and runs at the root of it, such as `https://dashboard.example.com`

Try it on the local machine first, then move it to a public address

## Configure the website

```sh
cp web/.env.example web/.env
```

| Variable               | Value                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `CONVEX_URL`           | The deployment URL, the same one the bot uses                                      |
| `FLUXER_CLIENT_SECRET` | The Fluxer application's client secret, from the same application as the bot       |
| `WEB_SESSION_SECRET`   | At least 32 random bytes                                                           |
| `TURNSTILE_SITE_KEY`   | The public widget key, needed only for [advanced verification](#turn-on-turnstile) |

Keep private values out of `VITE_` variables and out of version control

## Register the OAuth callback

In the Fluxer application's OAuth settings, register the callback for the address the website will use:

| Website | Callback                                             |
| ------- | ---------------------------------------------------- |
| Local   | `http://localhost:3000/auth/fluxer/callback`         |
| Public  | `https://dashboard.example.com/auth/fluxer/callback` |

## Set the website origin in Convex

1. In the Convex deployment, set `FLUXER_CLIENT_ID` to the application ID
2. Set `NEONFLUX_WEBSITE_URL` to `http://localhost:3000` or to the public origin, with no path
3. Publish the backend with `pnpm run deploy:dev`
4. Restart the bot, which reads the website origin from the deployment

The bot uses this origin for verification links, the install note and the dashboard link

## Start it locally

```sh
pnpm run dev:web
```

Open `http://localhost:3000` and sign in with Fluxer. Localhost links only work on the machine running the website

## Deploy on Cloudflare Workers

The dashboard deploys separately from the static homepage and docs (`projects/site`), on its own subdomain such as `https://dashboard.example.com`

1. Build the Cloudflare Workers bundle from `projects/`:

    ```sh
    pnpm --filter @neonflux/web run build:cloudflare
    ```

2. Set the Worker secrets and variables: `CONVEX_URL`, `FLUXER_CLIENT_SECRET`, `WEB_SESSION_SECRET`, `TRUST_PROXY=cloudflare`, `NEONFLUX_WEBSITE_URL` (matching the dashboard HTTPS origin) and optionally `TURNSTILE_SITE_KEY`
3. Deploy the generated output from `projects/web/` with `npx wrangler deploy` (or `pnpm dlx wrangler deploy`), or configure Cloudflare Workers Git integration with `projects/` as the root directory, build command `pnpm --filter @neonflux/web run build:cloudflare` and deploy command `pnpm --dir web dlx wrangler deploy` (the generated config sets `keep_vars: true` so redeploys keep dashboard variables)
4. Keep the static homepage and docs (`projects/site`) deployed separately on Cloudflare Pages, with `PUBLIC_DASHBOARD_URL` pointing to the dashboard subdomain

In-memory rate limiting and concurrent token-refresh deduplication run per Worker isolate. Add a Cloudflare WAF rate-limiting rule on `/auth/*` and `/api/*` to share rate limits across isolates within each Cloudflare edge location

## Move it to a public address

1. Register the public callback and set the public origin as `NEONFLUX_WEBSITE_URL`
2. Restart the bot
3. Build the website and start the built server:

    ```sh
    pnpm run build
    pnpm --filter @neonflux/web run start
    ```

The built server listens on port 3000 unless `PORT` is set

Put a reverse proxy with HTTPS in front of it. The proxy must pass on the original `Host` header, because the website compares it with the origin and refuses sign-ins that do not match. Set `TRUST_PROXY=forwarded` (with the proxy forwarding `X-Forwarded-Proto: https`) or `NEONFLUX_WEBSITE_URL` in `web/.env` so HSTS applies from the very first response

The website reads the origin and the application ID once from the deployment, so restart it after changing either

> **Planned:** Packaged Node hosting and containers. Self-hosted Node builds run directly from a source checkout behind a reverse proxy, while Cloudflare Workers is supported through `build:cloudflare`

## Turn on Turnstile

Cloudflare Turnstile guards the start of advanced verification. Sign-in and the settings pages work without it

1. Create a Turnstile widget in Cloudflare for the website's hostname
2. Put its site key in `TURNSTILE_SITE_KEY` in `web/.env`, and restart the website
3. Set its secret as `TURNSTILE_SECRET_KEY` in the Convex deployment

[Optional services](./optional-services.md#turnstile-for-verification) has the details

## When sign-in fails

| What appears                               | What to do                                                                                                           |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `Website authentication is not configured` | Read the website's log. It names each missing or invalid variable. `NEONFLUX_WEBSITE_URL` must also be set in Convex |
| Sign-in is not set up correctly            | `FLUXER_CLIENT_SECRET` does not belong to the application in `FLUXER_CLIENT_ID`. The log says which setting to fix   |

## Changing the session secret

`WEB_SESSION_SECRET` encrypts the cookie that renews sign-ins. After changing it, renewals stop and each existing session ends when its Fluxer access token runs out. Members then sign in again
