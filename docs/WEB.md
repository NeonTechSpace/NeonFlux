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

Server owners and members with Manage community, including Administrators, can configure the servers NeonFlux serves. Every save rechecks permissions with Fluxer. Read access expires after five minutes unless refreshed, and sessions last at most eight hours

In single-server mode the dashboard opens on the configured server and offers no invite link. In multi-server mode it opens on a server picker that shows each server's icon, or its initials, for the servers you manage that NeonFlux has joined. Switch server returns to the picker, and next to it the dashboard says how many sections of the open server have unsaved drafts, if any

A server opens on its **Overview**: Setup progress, every section by group, and whether each feature is on, on but needing setup, such as a channel or a first entry, or off. The sidebar and the overview link to each section. Every server and section has its own address, such as `/?server=123&section=tickets`, so the back button, reloading and shared links return to the same place. Signing in from such an address returns to it

Lists that load in pages, such as events or saved drafts, keep their first page and up to four later pages loaded and live. Loading another page hides the earliest later page, and **Show … from the start** returns to the first pages. Drafts on hidden pages stay in the tab. Each event's forms open from its entry in the list, and an event with an unsaved draft starts open

In multi-server mode the picker ends with **Add NeonFlux to a server**, which also appears when you have no servers yet.
It opens Fluxer's bot authorization in a new tab with the permissions listed in [the bot
guide](BOT.md#add-the-bot-to-a-server). The web server builds the link from the deployment's `FLUXER_CLIENT_ID`. A
server you add appears after the next sign-in refresh, which runs when you return to the tab, when you reload and every
three minutes, also while the tab is in the background. A refresh that fails, for example while Fluxer is unavailable,
keeps your sign-in and pauses saving until the next refresh succeeds. After you open the invitation, the picker also
offers **Check again** for a server that NeonFlux had not joined yet when you came back. A server NeonFlux leaves stops
loading its settings at once and leaves the picker at that refresh. With seven or more servers, the picker has a search
field that filters servers by name

The dashboard covers the prefix, custom commands and autoresponders, moderation and
security, role panels, verification, autorole and reservations, publishing messages, greetings, tickets, leveling,
milestones, suggestions, events, schedules, message cleanup and channel logs. Chat commands described in [the bot
guide](BOT.md) remain available. Backup, private cases, appeals and member history stay in chat

### Saving and live updates

Forms update when Convex data changes. Each section has one revision that all its forms share, and the backend rejects a save based on an old revision. A form shows **Changed elsewhere** only when something it edits changed: The stored values of its own fields, or for a removal, publication or other confirmation, the item it acts on. It then keeps your draft and shows the difference so you can review it before saving. A save elsewhere in the same section that leaves the form's fields alone keeps your draft without a warning, and your save is checked against the newest revision. Creating something new never conflicts with other saves, and a name that is already taken is rejected when you save

Chat commands take no revision numbers. A chat change applies to the current settings and moves the section's revision like a save here, so a form whose fields it changed shows **Changed elsewhere**

Unsaved changes are kept as drafts in this browser tab, per server and section, so they survive switching sections or
servers, reloading and signing in again. A restored form shows **Unsaved draft** with **Discard draft**, which loads the
current settings. The sidebar marks sections with drafts and the overview lists them. A draft ends when you save or
discard it, when you sign out or when the tab closes. A list item that someone removes while you have an unsaved draft
on one of its forms stays in the list with its saves disabled, so you can copy the draft, until you dismiss it or the
draft ends. Without such a draft it leaves the list at once. The confirmation forms for a removal keep no draft. Drafts
belong to the signed-in account, and a tab keeps at most 50, dropping the oldest first

The bot applies each change after checking the manager's current permissions and its own. A saved form does not mean a message was sent or a role assigned. Each section's recent requests show one of these states with what to do next:

- **Waiting for the bot**: The bot applies it within seconds while it is online. A request the bot does not pick up within two minutes fails, and nothing changes
- **Saved, publishing the panel** and **Sending**: The bot is publishing a role panel or sending a message
- **Applied** and **Sent**: Done
- **Failed**: Nothing was applied or sent. The reason is shown, such as a missing permission. Fix it and try again. A role panel is the exception, since its settings stay saved when only its publishing fails, and the panel then offers its own publish form
- **Not applied, changed elsewhere**: The settings changed before the bot applied the request. Review them and save again
- **Outcome unknown**: The bot could not confirm whether a message was sent. Check the channel before sending again. NeonFlux never resends it on its own

While a form waits for the bot, it keeps your draft, and a request that fails or conflicts says why next to the form. A message request keeps the draft on screen only while its section stays open. If the bot reports that a message was not sent, the draft is kept in the tab again, and the message can be requested again unchanged

### Pickers and message builder

Channel and role pickers search names or IDs as you type. Arrow keys move, Enter chooses and Escape closes. Role choices exclude `@everyone`. If the list cannot load, retry or enter an exact ID

The server's channels and roles load once when you open a server. **Refresh** next to a channel or role picker loads them again, for example after you create a role in Fluxer. The lists loaded earlier stay usable while it runs. Each refresh is one request, at most one runs every ten seconds, and a refresh asked for sooner runs once the wait ends. The lists never reload on a timer. They reload once by themselves when you come back to the tab after opening the bot invitation

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

Send queues the message for the bot. The bot needs access to the channel, Send messages and, for embeds, Embed links. Mentions are suppressed

### Templates and calendars

Greetings, ticket replies, milestones, events and schedules use a saved template version, and schedules can also use a saved draft. Editing the template does not change existing uses until you choose the newer version

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
- When a link can no longer be used, the page shows a final message without a retry button. A link opened while signed in as another Fluxer account says to sign out and sign in as the account that received it
- The bot grants the role only after the server confirms the answer. Staff can help a member with `!verify review <reference>`, using the reference from the member's link message

The challenge is experimental. It targets solving from a single screenshot. It does not stop screen recordings, browser automation or scripts that read the frame data. Following a current can exclude people with motion-perception differences, vestibular conditions or motion sensitivity, so keep staff assistance available. The animation is designed to stay below the WCAG 2.3.1 flash thresholds. [The challenge evaluation guide](CAPTCHA.md) describes the design, evaluation and limits
