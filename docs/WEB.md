# Run the dashboard

This guide is for operators running NeonFlux's website next to an existing bot and Convex deployment. The website is a dark-only dashboard for server settings, the member role picker and the browser side of advanced verification. Public documentation pages and hosting are planned

## Set up the website

1. Use the Node and pnpm versions selected by [the workspace](../projects/package.json), then run `pnpm install --frozen-lockfile` from `projects/`
2. Copy [the web environment example](../projects/web/.env.example) to `projects/web/.env`. Set the Fluxer application ID and secret, the Convex deployment URL, a random `WEB_SESSION_SECRET` of at least 32 bytes and your public `TURNSTILE_SITE_KEY`
3. Register `http://localhost:3000/auth/fluxer/callback` in the application's OAuth settings and keep `WEB_ORIGIN=http://localhost:3000` for local testing
4. In the Convex environment, set `FLUXER_CLIENT_ID` to the same application ID, plus `TURNSTILE_SECRET_KEY` and `TURNSTILE_HOSTNAMES=localhost`. Then deploy the backend as described in [the backend guide](BACKEND.md). Local environment files do not set Convex variables
5. Set `NEONFLUX_WEBSITE_URL=http://localhost:3000` in the bot environment and restart the bot
6. From `projects/`, run `pnpm --filter @neonflux/web run dev` and open [the local dashboard](http://localhost:3000)

Localhost links only work on the machine running the website. For members on other devices, use a reachable HTTPS origin, register its callback and set that origin in the bot

The web server holds the OAuth client secret and the sign-in handshake. The browser gets only an opaque dashboard session, never the Fluxer access token, client secret or bot token. Keep private values out of `VITE_` variables and version control

Run `pnpm --filter @neonflux/web run check` from `projects/` for type checks, tests and the production build. Start the built site with `pnpm --filter @neonflux/web run start`

## Dashboard

Server owners and members with Manage Server, including Administrators, can configure the servers NeonFlux serves. Every save rechecks permissions with Fluxer. Read access expires after five minutes unless refreshed, and sessions last at most eight hours

In single-server mode the dashboard opens on the configured server and offers no invite link. In multi-server mode it opens on a server picker that shows each server's icon, or its initials, for the servers you manage that NeonFlux has joined. Switch server returns to the picker and discards unsaved changes for the current server

In multi-server mode the picker ends with **Add NeonFlux to a server**, which also appears when you have no servers yet. It opens Fluxer's bot authorization in a new tab with the permissions listed in [the bot guide](BOT.md#add-the-bot-to-a-server). The web server builds the link from `FLUXER_CLIENT_ID`. A server you add appears after the next sign-in refresh, which runs when you return to the tab, when you reload and every four minutes. A server NeonFlux leaves stops loading its settings at once and leaves the picker at that refresh

Signed-in members also see the servers where they can choose their own roles: Servers they joined where NeonFlux is installed and the role picker is on. In multi-server mode these appear in the picker under **Choose your roles**. In single-server mode a member who does not manage the server opens straight on the member view. The member view shows only the [member role picker](#member-role-picker), never a settings section, and every member request rechecks the sign-in, the installation and the role picker switch

The dashboard covers the prefix, the bot nickname, custom commands and autoresponders, moderation and security, role panels, verification, autorole and reservations, the role picker, publishing messages, greetings, tickets, leveling, milestones, suggestions, events, schedules, message cleanup, channel logs, analytics and temporary voice generators. Chat commands described in [the bot guide](BOT.md) remain available. Backup, private cases, appeals and member history stay in chat

### Saving and live updates

Forms update when Convex data changes. If a section you are editing changes elsewhere, the form keeps your draft and shows the difference so you can review it before saving. Each section has a revision, and a save based on an old revision is rejected

The bot applies each change after checking the manager's current permissions and its own. A saved form does not mean a message was sent or a role assigned. Role and message work shows its state as queued, sent, failed or uncertain, and work with an uncertain outcome is never resent

### General

The General section sets the command prefix and the bot nickname. Apply nickname sets a nickname of 1 to 32 characters, and Reset to username removes it so the bot's username shows. The bot applies the change as itself and needs the Change Nickname permission

Last result shows whether the bot is still working on the change, whether it was applied, or why it failed. Without Change Nickname, Fluxer keeps the old nickname and the result reads `Missing Change Nickname permission`. A nickname changed directly in Fluxer stays until the next change here or in chat

### Role picker

The Role picker section under Roles turns the role picker on or off, edits its menus and sets who may use it. Each menu has a name, an optional description, single or multiple choice and up to 25 roles, and a server can have 10 menus. A role belongs to one menu. Before saving, the bot checks every menu role: It must sit below the bot's top role and yours, must not be the everyone role or a staff role, and must carry only ordinary member permissions. Saves share one revision with `!rolepicker` in chat, described in [the bot guide](BOT.md#role-picker)

Who may use the role picker is set with allowed and blocked roles and user IDs, up to 100 of each. A block always wins over an allow. With both allow lists empty, every member who is not blocked may use it

### Member role picker

A member opens a server under **Choose your roles**. The page asks the bot to read the member's current roles, which takes a few seconds, then shows each menu with **Claim** or **Drop** next to every role. In a single-choice menu, claiming a role drops the member's other role from that menu. Each request shows as pending until the bot applies it or it fails with a reason, such as missing rules acknowledgment or a role the bot may no longer assign

The bot drops only roles the role picker added that no other NeonFlux feature still needs, so a role given another way stays. A role change that Fluxer did not confirm fails and is never retried

Role names and colors come from the bot, never from the member's sign-in. Each role check reads the names of the menu roles with the member's roles, and every menu save stores the current names with the menu. The page shows the names from the latest role check, and the stored names until a check arrives

Members can send 10 claims or drops and 10 role checks a minute in each server, with up to 3 pending at once, and a server queues at most 50 member requests. The roles and role names read for a check are kept for ten minutes, and request records for one day

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

### Analytics

The Analytics section under Insights shows server activity as counts only, never per-member data. It has the analytics switch, a chart of daily member joins and leaves for the last 30 days, a chart of daily member messages for the last 14 days and the top ten channels by messages for the last 7 or 30 days. Days are UTC, and each chart can also be shown as a table

Busiest hours uses the same 7 or 30 day range as the top channels. It names the busiest UTC hour, charts messages for each hour of the day and shows a weekday and hour grid, where a brighter cell means more messages. Over 30 days a weekday occurs four or five times, so each grid cell is that weekday's average per day. Pick a channel to see only its hours, or leave the channel empty for every channel. Messages in threads count under their parent channel

When analytics is off, the section says the bot is not counting, and existing counts stay until they expire. The switch saves with the section revision like other forms, and `!stats on` and `!stats off` change the same setting. Channel names come from the server's channel list, and a deleted channel shows its ID. Counts arrive about every five minutes while the server is active. See [the bot guide](BOT.md#server-analytics) for what is counted

### Temporary voice

The Temporary voice section adds, configures and removes generators with the same settings as `!voice generator`: The generator name, the category for new rooms, the room name template, an optional default member limit and a fixed region or automatic routing. Leave the category, limit or region empty for top-level rooms, no limit or automatic routing. The section also shows how many generators and live rooms the server has

Adding a generator has the bot create its voice channel, and a new name renames the generator channel. If the backend rejects an add, the bot deletes the channel it just created. Removing a generator keeps its channel. Room owner controls, such as rename and hide, stay in chat. See [temporary voice rooms](BOT.md#temporary-voice-rooms)

## Web verification

Advanced verification replaces the plain rules reaction with a browser challenge. Configure the access role, emoji and channel, then publish the panel. A member who reacts receives a private link, signs in with the same Fluxer account, passes a Cloudflare Turnstile check, presses Start and identifies two symbols shown only through motion

Convex checks each Turnstile token with Cloudflare's [Siteverify API](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) before a challenge starts. It requires success, action `verification_start` and a hostname listed in `TURNSTILE_HOSTNAMES`. Missing configuration or a rejected token prevents the start. Use exact hostnames without scheme, path or port, and remove `localhost` and `127.0.0.1` in production. Turnstile loads Cloudflare's script and sends data to Cloudflare

Each round shows moving colored dots. Dots inside the hidden symbol move against the dots around them, so the symbol is visible only while they move. Choose the matching symbol from six options. A screenshot holds one frame and does not show the symbol. Color vision is not required. The first choice moves on to the second round without saying whether it was right, and the server checks both answers together

- A link expires after ten minutes, and each server issues at most 500 new links per hour
- Start sets one 90-second deadline for both rounds with two attempts. A failed attempt returns to the first round without extending the deadline. Reloading does not restart it
- Completion is bound to the member, server, membership, panel and dashboard session. Unrelated role settings do not invalidate links
- When a link can no longer be used, the page shows a final message without a retry button
- The bot grants the role only after the server confirms the answer. Staff can help a member with `!verify review <request-id>`

The challenge is experimental. It targets someone who pastes screenshots into a chat model. It does not stop screen recordings, browser automation or scripts that read the frame data. Motion-defined symbols can exclude people with motion-perception differences, vestibular conditions or motion sensitivity, so keep staff assistance available. The animation stays below the WCAG 2.3.1 flash thresholds. [The challenge evaluation guide](CAPTCHA.md) describes the design, evaluation and limits
