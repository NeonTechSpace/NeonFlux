# Run the dashboard

This guide is for operators running NeonFlux's website next to an existing bot and Convex deployment. The website is a dark-only dashboard for server settings, private moderation cases, the member role picker and the browser side of advanced verification. Public documentation pages and hosting are planned

## Set up the website

1. Use the Node version in [the Node version file](../projects/.node-version) and the pnpm version in [the workspace manifest](../projects/package.json), then run `pnpm install --frozen-lockfile` from `projects/`
2. Copy [the web environment example](../projects/web/.env.example) to `projects/web/.env`. Set the Fluxer application's client secret, the Convex deployment URL, a random `WEB_SESSION_SECRET` of at least 32 bytes and the public `TURNSTILE_SITE_KEY`
3. Register `http://localhost:3000/auth/fluxer/callback` in the application's OAuth settings
4. In the Convex environment, set `FLUXER_CLIENT_ID` to the application ID, `NEONFLUX_WEBSITE_URL=http://localhost:3000` and `TURNSTILE_SECRET_KEY`. Then deploy the backend as described in [the backend guide](BACKEND.md). Local environment files do not set Convex variables
5. Restart the bot, which reads the website origin from the deployment
6. From `projects/`, run `pnpm run dev:web` and open [the local dashboard](http://localhost:3000)

The Convex deployment owns the website origin and the OAuth application ID. The web server reads both once from the deployment when it first needs them and keeps them, so restart it after changing either. Turnstile accepts tokens from the origin's host unless the deployment's `TURNSTILE_HOSTNAMES` lists others. When the server starts, it logs each of its own variables that is missing or invalid, without its value. Sign-in then answers that website authentication is not configured. A client secret that does not belong to the deployment's application shows that sign-in is not set up correctly and logs which setting to fix

Localhost links only work on the machine running the website. For members on other devices, use a reachable HTTPS origin, register its callback and set that origin as the deployment's `NEONFLUX_WEBSITE_URL`. A reverse proxy in front of the website must pass on the original `Host` header

The web server holds the OAuth client secret and the sign-in handshake. The browser gets only an opaque dashboard session, never the Fluxer access token, client secret or bot token. The web server keeps the Fluxer refresh token in a second cookie that it encrypts with `WEB_SESSION_SECRET`, that browser scripts cannot read and that the browser sends only to the session refresh and sign-out. With it the web server renews the access token when less than an hour of it remains. Changing `WEB_SESSION_SECRET` therefore stops these renewals, and each session then ends when its access token runs out. A renewal whose answer from Fluxer is lost, or that ends in a gateway error or timeout, is never sent again, so that session also ends when its access token runs out. A refresh token is kept at any length its encrypted cookie fits in, within the 4096 bytes a browser keeps for one cookie. One that does not fit is not kept, and that session also ends when its access token runs out. Signing out asks Fluxer to revoke the refresh token. Keep private values out of `VITE_` variables and version control

Run `pnpm --filter @neonflux/web run check` from `projects/` for type checks, tests and the production build. Start the built site with `pnpm --filter @neonflux/web run start`

## Dashboard

Server owners and members with Manage community, including Administrators, can configure the servers NeonFlux serves. Changing moderation staff roles or ticket support roles needs the owner or an Administrator, as in chat, so a manager cannot make their own role staff. Every save rechecks permissions with Fluxer. Read access expires after five minutes unless refreshed, and an open tab refreshes it. A tab that is returned to rechecks the signed-in member's permissions with Fluxer before it shows anything. A sign-in lasts while it is used at least once every 30 days, for at most 90 days. Signing in on a sixth device signs out the one used longest ago, and signing out ends the session at once

In single-server mode the dashboard opens on the configured server and offers no invite link. In multi-server mode it opens on a server picker that shows each server's icon, or its initials, for the servers the member manages that NeonFlux has joined. Switch server returns to the picker, and next to it the dashboard says how many sections of the open server have unsaved drafts, if any

The section menu starts with **Find a section**. While it has text, the menu lists only the sections whose names match, Enter opens the first one and Escape clears the field and brings back the groups. Moving by search keeps unsaved drafts exactly as moving by the menu does, and the match count is announced to screen readers

A server opens on its **Overview**: Setup progress, every section by group, and whether each feature is on, on but needing setup, such as a channel or a first entry, or off. Its **Permission check** asks NeonFlux to check its own access when the overview opens and again on **Check again**: the permissions it lacks for each enabled feature, the roles it assigns that rank at or above its own role, a gateway that is not connected and a safety audit of the server's roles, each with its fix. The audit names roles that give dangerous permissions to everyone or to many members, staff roles that lack the permissions their commands need, and role features that let members past Fluxer's verification level, as [the bot guide](BOT.md#help-setup-and-health) describes. The bot reads Fluxer with its own token, so the check never uses the member's sign-in. A check waits at least 10 seconds after the previous one, and one the bot does not answer within a minute shows that the bot did not answer. The bot's `!health` command reports the same problems. The sidebar and the overview link to each section. Every server and section has its own address, such as `/?server=123&section=rolepicker`, so the back button, reloading and shared links return to the same place. Signing in from such an address returns to it

On an account's first visit the dashboard opens a short **Dashboard tour** above the section: What the Overview shows, how
sections and their addresses work, how drafts and saving work, where the audit log is, and where `!setup`, `!health` and
`!help` fit in chat. **Next step** and **Previous step** move through its five steps, and each step moves keyboard focus
to its heading. **Finish tour**, **Skip tour** or Escape closes it, and it does not open on its own again for that
account in this browser. The **Dashboard tour** button next to the server name starts it again. The tour remembers only
that it was closed, in this browser's local storage per account. Another browser or cleared site data shows it once more

Lists that load in pages, such as events or saved drafts, keep their first page and up to four later pages loaded and live. Loading another page hides the earliest later page, and **Show … from the start** returns to the first pages. Drafts on hidden pages stay in the tab. Each event's forms open from its entry in the list, and an event with an unsaved draft starts open

In multi-server mode the picker ends with **Add NeonFlux to a server**, which also appears when the member has no servers yet.
It opens Fluxer's bot authorization in a new tab with the permissions listed in [the bot
guide](BOT.md#add-the-bot-to-a-server). The web server builds the link from the deployment's `FLUXER_CLIENT_ID`. A
server that is added appears after the next sign-in refresh, which runs when the member returns to the tab, when the page reloads and every
three minutes, also while the tab is in the background. A refresh that fails, for example while Fluxer is unavailable,
keeps the sign-in and pauses saving until the next refresh succeeds. After the invitation is opened, the picker also
offers **Check again** for a server that NeonFlux had not joined yet when the member came back. A server NeonFlux leaves stops
loading its settings at once and leaves the picker at that refresh. With seven or more servers, the picker has a search
field that filters servers by name

Signed-in members also see the servers they joined without managing them where NeonFlux is installed and offers a member feature: The role picker, showcases and profiles while they are on, and [private cases](#private-cases) when the server names a private data role. In multi-server mode these appear in the picker under **Your member features**. In single-server mode a member who does not manage the server opens straight on the member view. The member view shows only the [member role picker](#member-role-picker), [showcases and the profile](#member-showcases-and-profiles) and private cases, with links between them when the server offers more than one, never a settings section. Every member request rechecks the sign-in, the installation and the feature's switch or role

The dashboard covers the prefix, the reply style, the bot nickname, custom commands and autoresponders, moderation and
security, private cases, role panels, verification, autorole and reservations, the role picker, temporary role defaults
and active grants, the newcomer checklist, setup presets, publishing messages, greetings, YouTube upload alerts,
tickets, leveling, milestones, suggestions, events, schedules, message cleanup, channel logs, analytics, temporary voice
generators, looking for group, sticky messages, the dashboard link in the server sidebar, the member list order, the
forum help desk with its saved answers, showcases and profiles, and the names and order of the [server
structure](#server-structure), and its audit log records every setting change, every view of private cases and every
server export. The server owner can download a [server export](#server-export). A [recovery inbox](#recovery-inbox)
collects what needs attention, and the server owner checks and runs a [backup restore](#backup-restore). Chat commands
described in [the bot guide](BOT.md) remain available. Backup export stays in chat, and so does the archive a restore
reads

### Saving and live updates

Forms update when Convex data changes. Each section has one revision that all its forms share, and the backend rejects a save based on an old revision. A form shows **Changed elsewhere** only when something it edits changed: The stored values of its own fields, or for an action with a confirmation box, the item that was confirmed. It then keeps the draft and shows the difference for review before saving. A removal or publication without a box acts on the item as it is when the button is pressed. A save elsewhere in the same section that leaves the form's fields alone keeps the draft without a warning, and the save is checked against the newest revision. Creating something new never conflicts with other saves, and a name that is already taken is rejected when the form is saved

Chat commands take no revision numbers. A chat change applies to the current settings and moves the section's revision like a save here, so a form whose fields it changed shows **Changed elsewhere**

Unsaved changes are kept as drafts in this browser tab, per server and section, so they survive switching sections or
servers, reloading and signing in again. A restored form shows **Unsaved draft** with **Discard draft**, which loads the
current settings. The sidebar marks sections with drafts and the overview lists them. A draft ends when it is saved or
discarded, when the member signs out or when the tab closes. A list item that someone removes while an unsaved draft exists
on one of its forms stays in the list with its saves disabled, so the draft can be copied, until it is dismissed or the
draft ends. It no longer counts toward the list's limit, and its name can be used again. Without such a draft it leaves
the list at once. The confirmation forms for a removal keep no draft. Drafts
belong to the signed-in account, and a tab keeps at most 50, dropping the oldest first

The bot applies each change after checking the manager's current permissions and its own. A saved form does not mean a message was sent or a role assigned. Each section's recent requests show one of these states with what to do next:

- **Waiting for the bot**: The bot applies it within seconds while it is online. A request the bot does not pick up within two minutes fails, and nothing changes
- **Saved, publishing the panel** and **Sending**: The bot is publishing a role panel or sending a message
- **Applied** and **Sent**: Done
- **Failed**: Nothing was applied or sent. The reason is shown, such as a missing permission. Fix it and try again. A role panel is the exception, since its settings stay saved when only its publishing fails, and the panel then offers its own publish form
- **Not applied, changed elsewhere**: The settings changed before the bot applied the request. Review them and save again
- **Outcome unknown**: The bot could not confirm whether a message was sent. Check the channel before sending again. NeonFlux never resends it on its own

A posted reaction panel's form offers three choices for its message. **Keep the posted message** applies the change to it, **Edit the posted message** also changes its text with the message builder, and **Post a new panel message** posts a fresh one, after which the earlier message no longer gives roles. A switch to one choice needs a new panel message. The form names the emojis whose reactions NeonFlux still has to update

While a form waits for the bot, it keeps the draft, and a request that fails or conflicts says why next to the form. A message request and a structure save keep the draft on screen only while their section stays open. If the bot reports that a message was not sent, or that a structure save failed before NeonFlux read the server, the draft is kept in the tab again, and the message can be requested again unchanged

### General

The General section sets the command prefix, the [reply style](BOT.md#reply-style) and the bot nickname. The reply style chooses embeds or plain text for status, detail and list replies, and saves with the prefix, so a save that meets a newer change keeps the draft for review. Apply nickname sets a nickname of 1 to 32 characters, and Reset to username removes it so the bot's username shows. The bot applies the change as itself and needs the Change own nickname permission

Last result shows whether the bot is still working on the change, whether it was applied, or why it failed. Without Change own nickname, Fluxer keeps the old nickname and the result reads `Grant Change own nickname to the NeonFlux role`. A nickname changed directly in Fluxer stays until the next change here or in chat

### Moderation and safety

**Automod policy** also has **Check webhook and other bots' messages**, the same switch as `!automod bots on|off`. New automod rules offer the types **Mentions over time**, **Links over time** and **Deceptive links** beside the others. The rule form starts every type at 5 in 10 seconds, so the wanted threshold and window must be set. See [the bot guide](BOT.md#automod) for how each type counts. The bot learns a changed bot message switch from the server's next member message

**Moderation and staff** has **Keep cases**, the same setting as `!mod retention`: **Until erased**, the default, or **For a number of days** from 1 to 3650. A rule holds up to 1000 patterns. Besides one field per pattern, the rule form takes a pasted list with one pattern per line and either adds the new ones at once or replaces the whole list with them, leaving lines that are too long or past the limit in the box. **Remove all rule patterns** clears the list in one click. For **Words** rules the form notes that patterns match whole words and that a `*` at the start or end matches part of a word, as [the bot guide](BOT.md#automod) describes

### Role picker

The Role picker section under Roles turns the role picker on or off, edits its menus and sets who may use it. Each menu has a name, an optional description, single or multiple choice and its roles. A server can have 100 menus, which hold up to 1,000 roles together, and a role belongs to one menu. Before saving, the bot checks every menu role: It must sit below the bot's top role and the saving member's, must not be the everyone role or a staff role, and must carry only ordinary member permissions. The chat command `!rolepicker` changes the same settings, as [the bot guide](BOT.md#role-picker) describes

Who may use the role picker is set with allowed and blocked roles, up to 500 of each, and user IDs, up to 5,000 of each. A user ID list also takes many IDs or mentions pasted at once, separated by spaces, commas or lines, and either adds the new ones or replaces the whole list with them, leaving entries that are not IDs or past the limit in the box. **Remove all allowed user IDs** and **Remove all blocked user IDs** clear a list in one click. A block always wins over an allow. With both allow lists empty, every member who is not blocked may use it

While the role picker is on, the section has a closed **Choose my roles** disclosure below the settings. Opening it shows the member page below for the manager's own roles, with the same access lists and role rules as every member. The bot reads the manager's roles only once it is opened

### Temporary roles

The Temporary roles section under Roles lists the active temporary roles that end first, up to 100, with the member's ID, the role and the end time in the viewer's local time. A grant whose time ended but whose role NeonFlux could not remove yet stays in the list with the reason, such as missing Manage roles, and NeonFlux tries again. A problem recorded before the end time shows as needing attention. A grant whose member cannot receive the role yet, for example before accepting the rules, says that it waits for the member, and NeonFlux tries again every 10 minutes. Use `!temprole list` in chat for the rest. Giving, renewing, shortening and ending grants is done in chat, as [the bot guide](BOT.md#temporary-roles) describes

Each role can have a default duration, used when staff give the role without one, and a longest duration. Durations use the chat form, such as 30m, 12h, 7d, 2w or 1d12h, from 1 minute to 100 years. Without a longest duration a grant lasts as long as staff choose. Clearing both durations removes a role's defaults. The chat commands `!temprole default` and `!temprole max` change the same settings

### Newcomer checklist

The Newcomer checklist section under Roles sets the same checklist as `!onboarding`: The switch, whether it goes with the channel welcome or the DM greeting, up to five ordered steps and the completion role. A step accepts the rules, picks roles from a reaction panel or a role picker menu by name, or names a channel to visit with a line of up to 100 characters. Saving the steps replaces the whole list, and a panel or menu name must exist. Choosing a completion role has the bot check it like other assigned roles, and clearing the picker removes it. The section also shows how many members finished the checklist in the last seven days while analytics counts. Changes need the server owner or an Administrator, and the chat command `!onboarding` changes the same settings. See [the bot guide](BOT.md#newcomer-checklist) for how members finish steps

### Setup presets

The Setup presets section under Basics lists the community presets and security levels of [`!preset`](BOT.md#setup-presets), each with exactly the settings it would change now, from their current values, or that the server already matches. **Apply preset** needs the confirmation box and applies exactly the listed changes. When a listed setting changes first, the request fails and the list shows the new changes, so the new changes need a new confirmation. Applying needs the server owner or an Administrator. Each changed feature appears in the audit log as `preset <name>`

### Member role picker

A member opens a server under **Choose your roles**, and managers find the same page under **Choose my roles** in the Role picker section. The page asks the bot to read the member's current roles, which takes a few seconds, then shows each menu with **Claim** or **Drop** next to every role. In a single-choice menu, claiming a role drops the member's other role from that menu. Each request shows as pending until the bot applies it or it fails with a reason, such as missing rules acknowledgment or a role the bot may no longer assign

The bot drops only roles the role picker added that no other NeonFlux feature still needs, so a role given another way stays. A role change that Fluxer did not confirm fails and is never retried

Role names and colors come from the bot, never from the member's sign-in. Each role check reads the names of the menu roles with the member's roles, and every menu save stores the current names with the menu. The page shows the names from the latest role check, and the stored names until a check arrives

Members can send 10 claims or drops and 10 role checks a minute in each server, with up to 3 pending at once, and a server queues at most 50 member requests. The roles and role names read for a check are kept for ten minutes, and request records for one day

### Pickers and message builder

Channel and role pickers search names or IDs as the text is typed. Arrow keys move, Enter chooses and Escape closes. A picker that takes several choices also takes several IDs or mentions pasted at once, separated by spaces, commas or lines, and IDs that match no choice stay in the field. While it holds choices, **Remove all** with the field's name, such as **Remove all blocked roles**, empties it in one click. Role choices exclude `@everyone`. If the list cannot load, retry or enter an exact ID

The server's channels and roles load once when a server is opened. **Refresh** next to a channel or role picker loads them again, for example after a role is created in Fluxer. The lists loaded earlier stay usable while it runs. Each refresh is one request, at most one runs every ten seconds, and a refresh asked for sooner runs once the wait ends. The lists never reload on a timer. They reload once by themselves when the tab is returned to after opening the bot invitation, and when a temporary voice generator's channel is missing from them

The message builder edits text, one embed, fields, author, footer, thumbnail and image, with a live preview. Standalone messages, role panels, drafts and templates share it. Custom responses accept only text or a basic embed with title, description and color. Import and export use this JSON format, and unknown fields, invalid URLs and oversized content are rejected:

```json
{
  "content": "Welcome",
  "embed": {
    "title": "Server information",
    "description": "Read the rules before participating",
    "color": 6589644,
    "fields": [
      { "name": "Help", "value": "Contact server staff", "inline": false }
    ]
  }
}
```

Send queues the message for the bot. The bot needs access to the channel, Send messages and, for embeds, Embed links. Mentions are suppressed

The Drafts and templates section has **Send a saved message** below the drafts. Pick a draft or template to see its saved content, pick a channel and press **Send**. The message sent is the saved version on screen at that moment, and the preview follows it if the version changes while the panel is open. A second send needs **Send it again** and a new click, and a version with no text or embed content cannot be sent. The send goes through the same queue and status as the Messages section, and chat sends it with `!publish send <name> #channel`, which also records the draft as the post's source. The website send does not

### Templates and calendars

Greetings, canned ticket replies and milestones follow their template by name, so an edit to the template applies to the next post right away. Their picker says so. When the template is deleted or an edit makes it invalid for the route, the copy saved when it was last chosen is sent. Events and schedules use a saved template version, and schedules can also use a saved draft. Editing the template does not change those until the newer version is chosen

Events and schedules take a local date and time, a time zone, a choice for repeated times and a repeat. **Ends** sets when a repeat stops: Never, after a number of dates or on a date. Times that do not exist are rejected, and the first date may be any time ahead. New events start as drafts and new schedules start disabled. A published event's calendar stays editable until the event is cancelled or completed: Dates that have started stay as they were, upcoming dates keep their numbers and replies, and members who replied Going or Maybe are told by DM. Once a repeat's first date has started, an event's or schedule's form starts at its next date and shows the dates a count has left from there. When every counted date has started, the form shows no count and asks for a new end. Moving one date stays in chat with `!event move`

Each saved schedule has a closed **What it posts and when** panel. It shows the message the schedule copied, which is not the source's latest version, how the schedule repeats, and a table of its stored upcoming dates with the time in the schedule's zone and its UTC offset and the same moment in the viewer's local time. It does not show whether a date was sent or skipped. Chat has `!publish schedule preview` and `!publish schedule dates` for the same copy

### Leveling

The Leveling section sets message XP, the cooldown, the channels that earn XP and the excluded channels and roles, as `!level` does. **Channels that earn XP** starts empty, which lets every channel earn XP. Once it lists channels, only messages in them and their threads earn XP, and the excluded channels and roles still apply. Paste several channel or role IDs or mentions into a picker to add them at once, up to 500 channels in each channel list and 250 roles, and **Remove all channels that earn XP**, **Remove all excluded XP channels** or **roles** empties a list. **Level-up messages** starts off. **Where the member levels up** posts in the channel or thread of the message that reached the new level, and **In one channel** posts in the text or announcement channel picked, which the bot checks is in this server. **Only levels with a reward role** limits the messages to levels that give a role. Each message mentions the member without notifying them. **Level reward roles** gives a role at a level, up to 250 rewards. Paste several rewards at once, a level and a role ID or mention each, split by commas or lines, to add them or replace the list, and **Remove all level rewards** empties it

### Forum channels and discussion threads

The channel filters of automod rules and exemptions, honeypots, custom responses, leveling and message logs offer forum and media channels, because a message in a forum post counts as in its forum. The suggestion and event channel pickers also offer forum and media channels. There each suggestion or event card becomes its own forum post, as [the bot guide](BOT.md#suggestions-and-voting) describes. Saving a forum as the suggestion destination asks the bot to add the status tags the forum lacks. When it cannot, the request fails with the fix, such as granting Manage channels or removing tags from the forum

The Events section has **Discussion threads**, the same switch as `!event threads on|off`. Events published while it is on get a discussion thread on their card, and the thread or forum post is archived and locked when the event ends or is cancelled

### Channel logs

Choose a destination and a responsible Owner or Administrator for each category. Events can use the category route, use their own channel and owner, or be turned off. Message events come from every channel except the excluded ones, or from only the listed channels, up to 500 in each list. Logs show message text, earlier values and audit reasons, never private ticket content. The Security alerts group carries the alerts the next section turns on

### Security alerts

The Security alerts section under Moderation has one switch for each alert: Invite logs, unexpected bots, unexpected webhooks, privilege changes and impersonation, all off at first, with the same rules as `!alerts`. Under the bots, webhooks and privileges alerts, a second switch turns on their action: kick unexpected bots, delete unexpected webhooks or remove gained permissions. Turning an action on needs the server owner or an Administrator, which the bot checks when it applies the change, and other managers see that note. Any manager can turn one off. Alerts reach staff only through the Security alerts group in Channel logs, which belongs in a channel only staff can read, since invite logs show invite codes. **Expected bots** and **Expected webhooks** each edit their whole list of up to 8,192 IDs in one save. Each takes many IDs pasted at once, separated by spaces, commas or lines, to add to the list or replace it, leaves entries that are not IDs in the box, and **Remove all expected bots** or **Remove all expected webhooks** clears it, so a removed ID raises alerts again

**Refresh invite list** has the bot read the server's invites with its own permissions, which needs Manage community, and shows the newest 100 with code, channel, creator ID, uses, expiry and flags for invites that never expire or have unlimited uses. **Show older invites** and **Show newer invites** have the bot read the next or the previous 100. Tick the confirmation and choose **Revoke invite** to have the bot read the current invites and delete that one, and the list stays on its page. A revoked invite cannot be restored. See [security alerts and invites](BOT.md#security-alerts-and-invites)

### Analytics

The Analytics section under Insights shows server activity as counts only, never per-member data. It has the analytics switch, a chart of daily member joins and leaves for the last 30 days with the number of members who finished the newcomer checklist, a chart of daily member messages for the last 14 days and the top ten channels by messages for the last 7 or 30 days. Days are UTC, and each chart can also be shown as a table

Busiest hours uses the same 7 or 30 day range as the top channels. It names the busiest UTC hour, charts messages for each hour of the day and shows a weekday and hour grid, where a brighter cell means more messages. Over 30 days a weekday occurs four or five times, so each grid cell is that weekday's average per day. Pick a channel to see only its hours, or leave the channel empty for every channel. Messages in threads count under their parent channel

When analytics is off, the section says the bot is not counting, and existing counts stay until they expire. The switch saves with the section revision like other forms, and `!stats on` and `!stats off` change the same setting. Channel names come from the server's channel list, and a deleted channel shows its ID. Counts arrive about every five minutes while the server is active. See [the bot guide](BOT.md#server-analytics) for what is counted

### Private cases

The Private cases section under Moderation shows moderation cases, appeals and member history on the website. Only the server owner and members holding the server's private data role can view them. Administrators also need the role, and without a private data role only the owner can view them. The owner chooses the role under **Private data role** in Moderation and safety or with [`!mod private-role`](BOT.md#moderation-and-cases). Other managers see the chosen role but cannot change it

- **Cases** lists cases newest first in pages of 25, with **Older cases** and **Back** to move between pages
- Opening a case shows its details, its first 25 corrections, oldest first, and its appeals. **Later corrections** shows the next 25. When one of its appeals was accepted and the case is not voided, a **Next step** block names the command that reverses the sanction, since accepting an appeal never reverses it
- A member's ID in a list, or **Member ID** with **Show history**, shows that member's cases newest first and their newest 25 appeals
- **Appeals** lists every appeal newest first in pages of 25
- **Waiting appeals** lists only the appeals that still wait for a decision, oldest first, with **More** for the next page

A case or appeal that the owner erased with `!mod erase` shows that it was erased, never its text

Every view asks NeonFlux to check the viewer's access. The bot reads the viewer's current roles and whether the viewer owns the server from Fluxer with its own token, so the check never uses the viewer's sign-in. A view waits while the check runs, which usually takes a few seconds. A passed check serves the views for two minutes, so paging and opening cases need no new check, and a role removed in Fluxer stops the viewer's access at the next check after those two minutes. A refused check stands for 10 seconds before **Check again** asks the bot once more, and a check the bot does not answer within a minute shows that NeonFlux could not check the viewer's access

Members without Manage community reach this section only from the member view of a server that names a private data role, and the check still decides whether they see anything. Every view that shows data is recorded in the [audit log](#audit-log)

### Audit log

The Audit log section under Insights lists every setting change, whether it was saved here or made with a chat command, newest first in pages of 25. **Older** and **Newer** move between pages, and **Feature** shows one feature's changes. Each entry shows when it happened in the viewer's local time, who made it, whether it came from the website or a command, the feature, the setting or operation and a short summary of what changed, such as `xpPerMessage: 15 → 25`. Website entries show the signed-in name with the user ID, and command entries show the user ID only

Summaries name changed settings and list items such as rules or menus by name, with values of up to 40 characters. **Details** on a setting change opens a table of every value it changed, before and after, with channels and roles named from the server's lists, the same table a backup restore check shows. Expected bots and webhooks show as one row per list, with the IDs it drops before and the IDs it adds after, so their order is no change. A value longer than 8,000 characters keeps its first 8,000, and the table says how long it was. When one change holds more than 512 KiB of values, the rest are counted below the table. A restore from a backup lists each imported item, and its Details show what the restore check compared. When a member deletes their own data with [`!mydata`](BOT.md#your-data), the log shows the features and counts they deleted, never the data. Each view of [private cases](#private-cases) shows as **Private data viewed** under the **Private cases** feature, with who viewed what kind of data, such as a cases list, one case, the appeals list or a member's history, and the member it concerns, never the cases or appeals themselves. Each change saved in [server structure](#server-structure) shows under **Server structure** with the channel names, such as `move news` with `Info, after rules → Chat, after general`. Each [server export](#server-export) shows as **Server exported** under **Server export**, with whether it came from the website or `!export` and whether it started or continued after a new access check. Entries are kept for 180 days. The [backend guide](BACKEND.md#audit-log) lists the few changes that are not recorded, such as DEFCON changes that security detection makes on its own

### Server export

The Server export section under Insights lets the server owner download a readable JSON file of the server's NeonFlux
data that other bots can load: Every feature's settings, leveling XP and levels, member showcases and profiles,
moderation cases with their corrections and appeals, without text the owner erased. [The export guide](EXPORT.md)
documents every field of format version 2. It is separate from the encrypted backup, which only restores into NeonFlux

The section prints the DM command `!export` for the same export. When the bot serves several servers, the command names the open server, such as `!export --server 123`

**Export server data** first runs the same live access check as [private cases](#private-cases), and only a check that finds the server owner starts the export. Administrators and holders of the private data role are refused. The section then reads the export page by page, shows how many records it read and offers **Save** with the file. When the export outlasts the two minutes a passed check serves, the section asks for a new check and continues where it stopped. Each start and continuation appears in the audit log as **Server exported** under **Server export**, never with the content. The owner can also send `!export` in a DM, as [the bot guide](BOT.md#server-export) describes

### Recovery inbox

The Recovery inbox section under Insights lists work that failed, stalled or has an unknown outcome, features that are on but need setup and the problems of the latest permission check, current state first and then newest first. Each entry shows when it happened in the viewer's local time, what happened and the next step, such as the chat command that resolves it, and a feature that needs setup links to its section. Channels and roles show by name from the server's channel and role lists, and members by their ID. It updates live and shows the same entries as [`!recovery`](BOT.md#recovery-inbox), which lists its sources and limits. When more than 10 role removals stopped, **Show more stopped role removals** lists the next 10 older ones below, as often as more exist

### Backup restore

The Backup restore section under Insights shows the server owner's latest restore check and restores from it. The check
is the plan that [`!backup preview`](BOT.md#selective-backup-and-restore) makes from an attached archive in a DM with
NeonFlux. Only the owner who made it sees it here, and other managers see that no check is available to them

The page leads with a summary: the archive, when it was checked and how many items it would create, update, delete, skip
as identical or block. Below it, **Look at these first** lists only what applies as a bulleted list, each line starting
with its name: **Blocked** items, **Deletes** of channels and categories with their messages, which cannot be undone,
**More permission** with the permission names when an overwrite would grant more than the server has now, **Turns on**
with the name of each setting a restore switches on, such as Leveling, and **Warnings** for items with a warning, such
as messages they delete or post. Then **Changes** lists each item, problems first, 25 to a page. A row says what it does with a
text mark, **+ Create**, **~ Update**, **- Delete**, **= Identical** or **! Blocked**, and a **More than now** or
**Turns on** badge when it applies. It shows why and how to fix a blocked item, a table of the settings that change with
**Before** and **After**, named in words such as Cooldown seconds with a channel's parent as Category, and an overwrite
of a role or member with the permissions before and after and the allows it adds or the denies it lifts. A delete shows
only its sentence, since the channel and its messages go. An overwrite whose role or member is gone says it is not
restored. A long value starts collapsed and keeps its full text. Identical items and items left alone, such as a ticket
channel, appear only after **Show identical or left alone**

Opening the section, and **Check again**, asks NeonFlux to read the archive message and the server again with its own
token and to recheck that the member still owns the server. A large archive is checked part by part, and the section says so
while it builds. A check of the same archive on an unchanged server keeps the plan and gives it another day. A restore
that already started keeps its outcome on screen instead.
**Match fully** also deletes the channels and categories the archive does not hold, and changing it makes a new check. A
check waits at least 10 seconds after the previous one, and the page says to wait when it does not take a request. One
the bot does not answer within a minute says so. When the archive message is gone, the key changed or the member no longer owns
the server, the section says so, and in the last case the check that was never confirmed is removed. A check forgotten
with `!backup forget`, or removed at least seven days after it expired, is gone from the section as it is from
`!backup status`, and a new `!backup preview` starts again. The first check comes from `!backup preview` in the DM, because the website never picks an archive. The page prints the exact DM commands to make an encrypted backup and to check an archive, and the commands in its failure messages. When the bot serves several servers, each command names the open server right after the command name, such as `!backup --server 123 preview`

The **Restore** panel is last. Its button counts what it does, such as **Restore 12 changes and delete 3 channels or
categories**, and confirms exactly the check shown, so a page that a newer check replaced cannot confirm it. The button
is off with its reason while the bot works or builds the check, after a failed check, once the check expired a day
after it was made and when nothing can be restored. The bot then runs the whole plan in the background, rechecking that
the member still owns the server and that the DM is private when a pass starts and again before each item that writes. The page shows how many items
have an outcome. It never says a restore is done while an item is waiting, in progress or not confirmed. When the
restore ends, the page counts the items by outcome and says to check again to compare with the server. A restore that
stops says why, such as 10 minutes without progress while the bot was not running. **Check again** and a new restore
continue it, and `!backup status` and `!backup confirm` in the DM continue one that stopped for DEFCON 1, an error or
lack of progress. The website never receives the
archive or its key

### Temporary voice

The Temporary voice section adds, configures and removes generators with the same settings as `!voice generator`: The generator name, the category for new rooms, the room name template, an optional default member limit and a fixed region or automatic routing. Leave the category, limit or region empty for top-level rooms, no limit or automatic routing. The section also shows how many generators and live rooms the server has

Adding a generator has the bot create its voice channel, and a new name renames the generator channel. If the backend rejects an add, the bot deletes the channel it just created. Removing a generator keeps its channel. Room owner controls, such as rename and hide, stay in chat. See [temporary voice rooms](BOT.md#temporary-voice-rooms)

### Looking for group

The Looking for group section under Community turns the feature on or off and chooses the group channel and the voice generator whose category, member limit and region group rooms use. Only existing generators are offered, so add one in Temporary voice first. It also sets the minutes a group stays open, from 10 to 1440 and 60 by default, the largest group size, from 2 to 25 and 10 by default, the open groups one member hosts, from 1 to 5 and 1 by default, and the open groups per server, from 1 to 50 and 20 by default. The chat command `!lfg config` changes the same settings, and the section shows how many groups are open. Posting, joining and starting groups happen in chat, as [the bot guide](BOT.md#looking-for-group) describes

### Sticky messages

The Sticky messages section under Messaging adds a sticky to a text or announcement channel, changes its text and repost interval, and removes it, with the same rules as `!sticky`: At most five channels, text of 1 to 2000 characters and an interval of 10 to 3600 seconds, 30 by default. A saved change posts the sticky at once and deletes the previous copy, and a removal deletes the last copy. See [sticky messages](BOT.md#sticky-messages)

### YouTube alerts

The YouTube alerts section under Messaging follows up to 10 YouTube channels, like `!youtube`. Enter a channel ID, which starts with `UC` and has 24 characters, or a link that contains `/channel/UC…`, and choose a text, announcement or forum channel for the alerts. An `@handle` is refused with how to find the channel ID, because NeonFlux uses no YouTube API key. Uploads arrive through YouTube's own notifications, so livestreams, premieres and Shorts show up as ordinary new videos, and videos published before a channel was added are not posted

Each followed channel shows whether its alerts are on, why NeonFlux turned them off, its subscription with YouTube or the latest error, its last notification, its last post and its newest video. Saving another alert channel moves the alerts and turns them back on. While alerts are off, saving the same channel turns them back on too. The chat command `!youtube` changes the same settings. When the deployment is not set up for YouTube alerts, the section says so and offers no add form. The section links [YouTube's Terms of Service](https://www.youtube.com/t/terms) and [Google's Privacy Policy](https://policies.google.com/privacy). See [YouTube upload alerts](BOT.md#youtube-upload-alerts)

### Dashboard link

The Dashboard link section under Basics creates, renames or removes the one link channel that opens this server's dashboard page from the server sidebar, like `!sidebar`. A new link can have another name or a category. The bot creates the channel and needs Manage channels, and its `NEONFLUX_WEBSITE_URL` must be set, or the request fails. If the backend rejects an add, the bot deletes the channel it just created. See [the dashboard link](BOT.md#dashboard-link-in-the-server-sidebar)

### Server structure

The Server structure section under Basics shows the server's categories and its text, voice, announcement, forum, media and link channels, as NeonFlux reads them for the member with its own token: The channels the member can view, a category the member cannot view only when it holds one the member can, and each channel's active threads under it. Threads are fixed children of their channel and cannot be moved. A private thread is listed only when NeonFlux can see it and the member can manage threads in its channel. **Show closed threads** asks NeonFlux for a channel's 100 most recently closed threads. Opening the section and **Check again** ask NeonFlux to read the server again, at most once every 10 seconds, and a read the bot does not answer within a minute says so

Rename categories and channels, and change their order by dragging a row or with **Up**, **Down** and each channel's
category choice, which work from the keyboard too. A dragged category goes before the category it is dropped on, and a
dragged channel goes into the category it is dropped on or before the channel. Channels where the member lacks Manage channels
cannot be changed. Changes are virtual until **Save changes**, so they stay a draft in this tab, as
[saving and live updates](#saving-and-live-updates) describes, together with the structure the draft started from.
Leaving the section or the server keeps the draft, except while a save waits for NeonFlux, and **Discard draft** clears
it together with the structure it started from. The tree shows the structure as the draft leaves it, and from the first edit each renamed or moved row
says what changed, such as `was Chat` or `moved from Chat, after general to Info, after rules`. **Changes only** hides
the unchanged rows and keeps a category that holds a change. A row it showed stays, even when its change is undone,
until **Changes only** is turned off or the draft ends. When a channel is created, changed, deleted or reordered after
the read, the section says so while it is open, and **Load the current structure** reads the server again. A draft
keeps the structure it started from

**Review changes** adds to each changed row what saving would do with it against the latest read: Save it, skip it
because it is already so, or leave it unsaved because the channel changed elsewhere since the draft started, the
channel or its new category is gone, or the member lacks Manage channels in the channel. A count of the outcomes sits above
**Save changes**. Any later edit removes these lines, and a review still loading at an edit is ignored, so review
again before saving. **Save changes** sends the draft to NeonFlux, which reads the server again and checks
every change with the member's current permissions. It compares the draft with the structure it started from and the current
one, and reports a change that conflicts with another change instead of overwriting it. NeonFlux then saves the other
changes with its own token, never the member's sign-in, and **Last save** shows each change's outcome. A change Fluxer did not
confirm shows as **Outcome unknown**. NeonFlux never repeats it, so check the server before saving it again. A save
holds at most 100 changes. Each saved change, and each with an unknown outcome, appears in the
[audit log](#audit-log)

NeonFlux needs Manage channels in each channel it changes, and a change it cannot make names that fix. A moved channel keeps its own permissions and does not take over those of its new category. Changing permissions, creating channels and deleting channels are not part of this section and stay in Fluxer. See [the bot guide](BOT.md#server-structure-editor)

### Member list order

The Member list order section under Roles lists the roles that Fluxer shows as their own member list groups, top first, from the server's role list. Move roles with **Up** and **Down**, then save the order, or reset it so the member list follows the role hierarchy again. The bot applies the order with the same rules as `!memberlist`: It moves only roles below its own top role and the member's, keeps the other roles in place and refuses an order that does not fit around them. A refused order fails with a general reason, and `!memberlist` in chat names the roles in the way. Reset needs the server owner or an Administrator. After a change is applied, the section reloads the role list once to show the new order. See [member list order](BOT.md#member-list-order)

### Help desk

The Help desk section under Community adds the forum or media channels the help desk serves, up to 10, removes one and changes the greeting, the solved tag, the reply reminder wait, the thread warnings channel and the auto-archive setting with the same rules as `!helpdesk`. Leaving the greeting or the reminder wait empty turns it off. The section also adds, changes and removes saved answers, up to 50, which staff post with `!answer` in chat. Adding a forum has the bot prove the channel exists in the server, and `!helpdesk forum add` in chat also names the permissions NeonFlux lacks there. See [forum help desk](BOT.md#forum-help-desk)

### Showcases and profiles

The Showcases section under Community turns showcases on or off and sets the showcase channel, the showcases each member may have, from 1 to 50, and the minutes between a member's showcases, from 1 to 10,080. Leave a number empty for no limit. The Profiles section under Community turns profiles on or off and sets the seconds between a member's `!profile` commands, from 1 to 3,600. Each section also sets who may use the feature with allowed and blocked roles and user IDs, with the same limits and pasted lists as the role picker, where a block always wins. The chat commands `!showcase` and `!profile` change the same settings, as [the bot guide](BOT.md#showcases-and-profiles) describes. While a feature is on, its section also shows the manager's own member page below the settings

### Member showcases and profiles

A member opens **Showcases** or **Your profile** in the member view of a server that offers them. Managers find the same pages in the Showcases and Profiles sections

- **Post a showcase** takes a title of up to 100 characters, text of up to 1,000 and up to three links, one per line. The first HTTPS link to a PNG, JPEG, GIF or WebP image becomes the picture. Files cannot be uploaded
- **Your showcases** lists the member's showcases, newest first, 50 per page with **Older** and **Newer** buttons, with their status: Being posted, posted, not confirmed by Fluxer or not posted. **Edit** changes the posted message and **Delete** deletes it, both through the bot. A showcase that is being posted or not confirmed waits until it settles, and staff can check an unconfirmed one
- **Your profile** saves a bio of up to 300 characters, up to three links and an optional accent color, and **Delete profile** removes it at once, together with any of the member's saves the bot has not handled yet. **Show my birthday (month and day) on my profile** appears once a birthday is saved in this server with `!milestone` in a DM with NeonFlux. It starts off, saves as soon as it is changed, shows the birthday once a profile is saved and turns off when the member changes or removes the birthday or leaves the server

The bot checks the member's current roles, the server's settings and its automod rules before it posts, edits or saves, so each request shows as pending until it is done or fails with its reason, such as an automod rule that blocked it or a limit. Members can send 5 requests a minute for each feature in each server, with up to 2 pending at once. Requests expire after two minutes, and their records are deleted after one day

## Web verification

Advanced verification replaces the plain rules reaction with a browser challenge. Configure the access role, emoji and channel, then publish the panel. A member who reacts receives a private link, signs in with the same Fluxer account, passes a Cloudflare Turnstile check, presses Start and completes Guide the spark

Convex checks each Turnstile token with Cloudflare's [Siteverify API](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) before a challenge starts. It requires success, action `verification_start` and the host of `NEONFLUX_WEBSITE_URL`, or a hostname listed in `TURNSTILE_HOSTNAMES` when that is set. Missing configuration or a rejected token prevents the start. List exact lowercase hostnames without scheme, path or port, and a list with anything else stops verification starts until it is fixed. Turnstile loads Cloudflare's script and sends data to Cloudflare

Guide the spark shows particles streaming along a smooth current among particles with mixed directions. Drag the glowing spark with a mouse or touch, or focus the canvas and use the arrow keys, to follow the current from the start into the goal ring. The journey is designed to take about 5 to 10 seconds. A screenshot holds one frame with alike particles and no route line. Color vision is not required. Reaching the goal submits a bounded timed path, which the server checks against its private route

- A link expires after ten minutes, and each server issues at most 500 new links per hour
- Start sets one 90-second deadline with two attempts on the same route. A failed path returns the spark to the start without extending the deadline. Reloading does not restart it. A ring timer shows the time left, and Time's up explains how to get a new link
- Completion is bound to the member, server, membership, panel and dashboard session. Unrelated role settings do not invalidate links
- When a link can no longer be used, the page shows a final message without a retry button. A link opened while signed in as another Fluxer account says to sign out and sign in as the account that received it
- The bot grants the role only after the server confirms the answer. Staff can help a member with `!verify review <reference>`, using the reference from the member's link message. The page's **Request staff assistance** block shows the same reference until the request is solved or the page shows a final message, so a member on another device can pass it to staff

The challenge is experimental. It targets solving from a single screenshot. It does not stop screen recordings, browser automation or scripts that read the frame data. Following a current can exclude people with motion-perception differences, vestibular conditions or motion sensitivity, so keep staff assistance available. The animation is designed to stay below the WCAG 2.3.1 flash thresholds. [The challenge evaluation guide](CAPTCHA.md) describes the design, evaluation and limits
