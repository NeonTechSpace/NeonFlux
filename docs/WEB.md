# Run the dashboard

This guide is for operators running NeonFlux's website next to an existing bot and Convex deployment. The website is a dark-only dashboard for server settings. Public documentation pages, analytics and hosting are planned

## Set up the website

1. Use the Node and pnpm versions selected by [the workspace](../projects/package.json), then run `pnpm install --frozen-lockfile` from `projects/`
2. Copy [the web environment example](../projects/web/.env.example) to `projects/web/.env`. Set the Fluxer application ID and secret, the Convex deployment URL and a random `WEB_SESSION_SECRET` of at least 32 bytes
3. Register `http://localhost:3000/auth/fluxer/callback` in the application's OAuth settings and keep `WEB_ORIGIN=http://localhost:3000` for local testing
4. In the Convex environment, set `FLUXER_CLIENT_ID` to the same application ID. Then deploy the backend as described in [the backend guide](BACKEND.md). Local environment files do not set Convex variables
5. From `projects/`, run `pnpm --filter @neonflux/web run dev` and open [the local dashboard](http://localhost:3000)

Localhost links only work on the machine running the website. For other devices, use a reachable HTTPS origin and register its callback

The web server holds the OAuth client secret and the sign-in handshake. The browser gets only an opaque dashboard session, never the Fluxer access token, client secret or bot token. Keep private values out of `VITE_` variables and version control

Run `pnpm --filter @neonflux/web run check` from `projects/` for type checks, tests and the production build. Start the built site with `pnpm --filter @neonflux/web run start`

## Dashboard

Server owners and members with Manage Server, including Administrators, can configure their allowed servers. Every save rechecks permissions with Fluxer. Read access expires after five minutes unless refreshed, and sessions last at most eight hours

In single-server mode the dashboard opens on the configured server. In multi-server mode it opens on a server picker that shows each allowed server's icon, or its initials. Switch server returns to the picker and discards unsaved changes for the current server

The dashboard covers the prefix, custom commands and autoresponders, moderation and security, role panels, verification, autorole and reservations, publishing messages, greetings, tickets, leveling, milestones, suggestions, events, schedules, message cleanup and channel logs. Chat commands described in [the bot guide](BOT.md) remain available. Backup, private cases, appeals and member history stay in chat

### Saving and live updates

Forms update when Convex data changes. If a section you are editing changes elsewhere, the form keeps your draft and shows the difference so you can review it before saving. Each section has a revision, and a save based on an old revision is rejected

The bot applies each change after checking the manager's current permissions and its own. A saved form does not mean a message was sent or a role assigned. Role and message work shows its state as queued, sent, failed or uncertain, and work with an uncertain outcome is never resent

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
