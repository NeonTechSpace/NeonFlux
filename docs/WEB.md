# Run the dashboard

This guide is for operators running NeonFlux's website next to an existing bot and Convex deployment. The website is a dark-only dashboard for server settings and the browser side of advanced verification. Public documentation pages and hosting are planned

## Set up the website

1. Use the Node version in [the Node version file](../projects/.node-version) and the pnpm version in [the workspace manifest](../projects/package.json), then run `pnpm install --frozen-lockfile` from `projects/`
2. Copy [the web environment example](../projects/web/.env.example) to `projects/web/.env`. Set the Fluxer application's client secret, the Convex deployment URL, a random `WEB_SESSION_SECRET` of at least 32 bytes and your public `TURNSTILE_SITE_KEY`
3. Register `http://localhost:3000/auth/fluxer/callback` in the application's OAuth settings
4. In the Convex environment, set `FLUXER_CLIENT_ID` to the application ID, `NEONFLUX_WEBSITE_URL=http://localhost:3000` and `TURNSTILE_SECRET_KEY`. Then deploy the backend as described in [the backend guide](BACKEND.md). Local environment files do not set Convex variables
5. Restart the bot, which reads the website origin from the deployment
6. From `projects/`, run `pnpm run dev:web` and open [the local dashboard](http://localhost:3000)

The Convex deployment owns the website origin and the OAuth application ID. The web server reads both once from the deployment when it first needs them and keeps them, so restart it after changing either. Turnstile accepts tokens from the origin's host unless the deployment's `TURNSTILE_HOSTNAMES` lists others. When the server starts, it logs each of its own variables that is missing or invalid, without its value. Sign-in then answers that website authentication is not configured. A client secret that does not belong to the deployment's application shows that sign-in is not set up correctly and logs which setting to fix

Localhost links only work on the machine running the website. For members on other devices, use a reachable HTTPS origin, register its callback and set that origin as the deployment's `NEONFLUX_WEBSITE_URL`

The web server holds the OAuth client secret and the sign-in handshake. The browser gets only an opaque dashboard session, never the Fluxer access token, client secret or bot token. Keep private values out of `VITE_` variables and version control

Run `pnpm --filter @neonflux/web run check` from `projects/` for type checks, tests and the production build. Start the built site with `pnpm --filter @neonflux/web run start`

## Dashboard

Server owners and members with Manage Server, including Administrators, can configure the servers NeonFlux serves. Every save rechecks permissions with Fluxer. Read access expires after five minutes unless refreshed, and sessions last at most eight hours

In single-server mode the dashboard opens on the configured server and offers no invite link. In multi-server mode it opens on a server picker that shows each server's icon, or its initials, for the servers you manage that NeonFlux has joined. Switch server returns to the picker and discards unsaved changes for the current server

In multi-server mode the picker ends with **Add NeonFlux to a server**, which also appears when you have no servers yet. It opens Fluxer's bot authorization in a new tab with the permissions listed in [the bot guide](BOT.md#add-the-bot-to-a-server). The web server builds the link from the deployment's `FLUXER_CLIENT_ID`. A server you add appears after the next sign-in refresh, which runs when you return to the tab, when you reload and every three minutes, also while the tab is in the background. That keeps an open tab signed in for up to the eight hours, at the cost of one refresh per open tab every three minutes, each rechecking your servers with Fluxer. A refresh that fails, for example while Fluxer is unavailable, keeps your sign-in and pauses saving until the next refresh succeeds. A server NeonFlux leaves stops loading its settings at once and leaves the picker at that refresh

The dashboard covers the prefix, the bot nickname, custom commands and autoresponders, moderation and security, role panels, verification, autorole and reservations, publishing messages, greetings, tickets, leveling, milestones, suggestions, events, schedules, message cleanup and channel logs. Chat commands described in [the bot guide](BOT.md) remain available. Backup, private cases, appeals and member history stay in chat

Lists that load in pages, such as events or custom commands, keep their first page and up to four later pages loaded and live. Loading another page hides the earliest later page, and **Show … from the start** returns to the first pages. Drafts on hidden pages stay in the tab. Each event's forms open from its entry in the list, and an event with an unsaved draft starts open

### Saving and live updates

Forms update when Convex data changes. If a section you are editing changes elsewhere, the form keeps your draft and shows the difference so you can review it before saving. Each section has a revision, and a save based on an old revision is rejected

The bot applies each change after checking the manager's current permissions and its own. A saved form does not mean a message was sent or a role assigned. Role and message work shows its state as queued, sent, failed or uncertain, and work with an uncertain outcome is never resent

### General

The General section sets the command prefix and the bot nickname. Apply nickname sets a nickname of 1 to 32 characters, and Reset to username removes it so the bot's username shows. The bot applies the change as itself and needs the Change Nickname permission

Last result shows whether the bot is still working on the change, whether it was applied, or why it failed. Without Change Nickname, Fluxer keeps the old nickname and the result reads `Grant Change Nickname to the NeonFlux role`. A nickname changed directly in Fluxer stays until the next change here or in chat

### Pickers and message builder

Channel and role pickers search names or IDs as you type. Arrow keys move, Enter chooses and Escape closes. Role choices exclude `@everyone`. If the list cannot load, retry or enter an exact ID

The message builder edits text, one embed, fields, author, footer, thumbnail and image, with a live preview. Standalone messages, role panels, drafts and templates share it. Custom responses accept only text or a basic embed with title, description and color. Import and export use this JSON format, and unknown fields, invalid URLs and oversized content are rejected:

```json
{
  "content": "Welcome",
  "embed": {
    "title": "Server information",
    "description": "Read the rules before participating",
    "color": 6589644,
    "fields": [{ "name": "Help", "value": "Contact server staff", "inline": false }]
  }
}
```

Send queues the message for the bot. The bot needs access to the channel, Send Messages and, for embeds, Embed Links. Mentions are suppressed

### Templates and calendars

Greetings, ticket replies, milestones, events and schedules use a saved template revision. Editing the template does not change existing uses until you choose the newer revision

Events and schedules take a local date and time, a time zone, a choice for repeated times and a finite repeat. Times that do not exist are rejected. Dates must be within the next 180 days. New events start as drafts and new schedules start disabled

### Channel logs

Choose a destination and a responsible Owner or Administrator for each category. Events can use the category route, use their own channel and owner, or be turned off. Message events need explicit channel opt-in. Logs contain IDs, field names and counts, never message text or private ticket content

## Web verification

Advanced verification replaces the plain rules reaction with a browser challenge. Configure the access role, emoji and channel, then publish the panel. A member who reacts receives a private link, signs in with the same Fluxer account, passes a Cloudflare Turnstile check, presses Start and completes Guide the spark

Convex checks each Turnstile token with Cloudflare's [Siteverify API](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) before a challenge starts. It requires success, action `verification_start` and the host of `NEONFLUX_WEBSITE_URL`, or a hostname listed in `TURNSTILE_HOSTNAMES` when that is set. Missing configuration or a rejected token prevents the start. List exact lowercase hostnames without scheme, path or port, and a list with anything else stops verification starts until it is fixed. Turnstile loads Cloudflare's script and sends data to Cloudflare

Guide the spark shows particles streaming along a smooth current among particles with mixed directions. Drag the glowing spark with a mouse or touch, or focus the canvas and use the arrow keys, to follow the current from the start into the goal ring. The journey is designed to take about 5 to 10 seconds. A screenshot holds one frame with alike particles and no route line. Color vision is not required. Reaching the goal submits a bounded timed path, which the server checks against its private route

- A link expires after ten minutes, and each server issues at most 500 new links per hour
- Start sets one 90-second deadline with two attempts on the same route. A failed path returns the spark to the start without extending the deadline. Reloading does not restart it. A ring timer shows the time left, and Time's up explains how to get a new link
- Completion is bound to the member, server, membership, panel and dashboard session. Unrelated role settings do not invalidate links
- When a link can no longer be used, the page shows a final message without a retry button
- The bot grants the role only after the server confirms the answer. Staff can help a member with `!verify review <request-id>`

The challenge is experimental. It targets solving from a single screenshot. It does not stop screen recordings, browser automation or scripts that read the frame data. Following a current can exclude people with motion-perception differences, vestibular conditions or motion sensitivity, so keep staff assistance available. The animation is designed to stay below the WCAG 2.3.1 flash thresholds. [The challenge evaluation guide](CAPTCHA.md) describes the design, evaluation and limits
