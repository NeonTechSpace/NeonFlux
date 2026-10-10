# Run the dashboard

This guide is for operators running NeonFlux's website next to an existing bot and Convex deployment. The website is a dark-only dashboard for server settings, private moderation cases, the member role picker and the browser side of advanced verification. Public documentation pages and hosting are planned

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

In single-server mode the dashboard opens on the configured server and offers no invite link. In multi-server mode it opens on a server picker that shows each server's icon, or its initials, for the servers you manage that NeonFlux has joined. Switch server returns to the picker

A server opens on its **Overview**: Setup progress, every section by group, and whether each feature is on, on but needing setup, such as a channel or a first entry, or off. Its **Permission check** asks NeonFlux to check its own access when the overview opens and again on **Check again**: the permissions it lacks for each enabled feature, the roles it assigns that rank at or above its own role, a gateway that is not connected and a safety audit of the server's roles, each with its fix. The audit names roles that give dangerous permissions to everyone or to many members, staff roles that lack the permissions their commands need, and role features that let members past Fluxer's verification level, as [the bot guide](BOT.md#help-setup-and-health) describes. The bot reads Fluxer with its own token, so the check never uses your sign-in. A check waits at least 10 seconds after the previous one, and one the bot does not answer within a minute shows that the bot did not answer. The bot's `!health` command reports the same problems. The sidebar and the overview link to each section. Every server and section has its own address, such as `/?server=123&section=rolepicker`, so the back button, reloading and shared links return to the same place. Signing in from such an address returns to it

On your first visit the dashboard opens a short **Dashboard tour** above the section: What the Overview shows, how sections and their addresses work, how drafts and saving work, where the audit log is, and where `!setup`, `!health` and `!help` fit in chat. **Next step** and **Previous step** move through its five steps, and each step moves keyboard focus to its heading. **Finish tour**, **Skip tour** or Escape closes it, and it does not open on its own again for that account in this browser. The **Dashboard tour** button next to the server name starts it again. The tour remembers only that it was closed, in this browser's local storage per account, because it guards nothing and a lost mark only shows the dismissible tour again, so no server record is needed. Another browser or cleared site data shows it once more

Only the open section loads its live data, and a section's code loads the first time you open it. Leaving a section stops its live updates

In multi-server mode the picker ends with **Add NeonFlux to a server**, which also appears when you have no servers yet. It opens Fluxer's bot authorization in a new tab with the permissions listed in [the bot guide](BOT.md#add-the-bot-to-a-server). The web server builds the link from `FLUXER_CLIENT_ID`. A server you add appears after the next sign-in refresh, which runs when you return to the tab, when you reload and every four minutes. After you open the invitation, the picker also offers **Check again** for a server that NeonFlux had not joined yet when you came back. A server NeonFlux leaves stops loading its settings at once and leaves the picker at that refresh. With seven or more servers, the picker has a search field that filters servers by name

Signed-in members also see the servers they joined without managing them where NeonFlux is installed and offers a member feature: The role picker, showcases and profiles while they are on, and [private cases](#private-cases) when the server names a private data role. In multi-server mode these appear in the picker under **Your member features**. In single-server mode a member who does not manage the server opens straight on the member view. The member view shows only the [member role picker](#member-role-picker), [showcases and the profile](#member-showcases-and-profiles) and private cases, with links between them when the server offers more than one, never a settings section. Every member request rechecks the sign-in, the installation and the feature's switch or role

The dashboard covers the prefix, the bot nickname, custom commands and autoresponders, moderation and security, private cases, role panels, verification, autorole and reservations, the role picker, temporary role defaults and active grants, the newcomer checklist, setup presets, publishing messages, greetings, tickets, leveling, milestones, suggestions, events, schedules, message cleanup, channel logs, analytics, temporary voice generators, looking for group, sticky messages, the dashboard link in the server sidebar, the member list order, the forum help desk with its saved answers, showcases and profiles, and the names and order of the [server structure](#server-structure), and its audit log records every setting change, every view of private cases and every server export. The server owner can download a [server export](#server-export). A [recovery inbox](#recovery-inbox) collects what needs attention, and the server owner sees their latest [backup preview](#backup-preview). Chat commands described in [the bot guide](BOT.md) remain available. Backup export and restore stay in chat

### Saving and live updates

Forms update when Convex data changes. Each section has one revision that all its forms share, and the backend rejects a save based on an old revision. A form shows **Changed elsewhere** only when something it edits changed: The stored values of its own fields, or for a removal, publication or other confirmation, the item it acts on. It then keeps your draft and shows the difference so you can review it before saving. A save elsewhere in the same section that leaves the form's fields alone keeps your draft without a warning, and your save is checked against the newest revision. Creating something new never conflicts with other saves, and a name that is already taken is rejected when you save

Chat commands take no revision numbers. A chat change applies to the current settings and moves the section's revision like a save here, so a form whose fields it changed shows **Changed elsewhere**

Unsaved changes are kept as drafts in this browser tab, per server and section, so they survive switching sections or servers, reloading and signing in again. A restored form shows **Unsaved draft** with **Discard draft**, which loads the current settings. The sidebar marks sections with drafts and the overview lists them. A draft ends when you save or discard it, when you sign out or when the tab closes. Drafts belong to the signed-in account, and a tab keeps at most 50, dropping the oldest first

The bot applies each change after checking the manager's current permissions and its own. A saved form does not mean a message was sent or a role assigned. Each section's recent requests show one of these states with what to do next:

- **Waiting for the bot**: The bot applies it within seconds while it is online. A request the bot does not pick up within two minutes fails, and nothing changes
- **Saved, publishing the panel** and **Sending**: The bot is publishing a role panel or sending a message
- **Applied** and **Sent**: Done
- **Failed**: Nothing was applied or sent. The reason is shown, such as a missing permission. Fix it and try again
- **Not applied, changed elsewhere**: The settings changed before the bot applied the request. Review them and save again
- **Outcome unknown**: The bot could not confirm whether a message was sent. Check the channel before sending again. NeonFlux never resends it on its own

While a form waits for the bot, it keeps your draft, and a request that fails or conflicts says why next to the form

### General

The General section sets the command prefix and the bot nickname. Apply nickname sets a nickname of 1 to 32 characters, and Reset to username removes it so the bot's username shows. The bot applies the change as itself and needs the Change Nickname permission

Last result shows whether the bot is still working on the change, whether it was applied, or why it failed. Without Change Nickname, Fluxer keeps the old nickname and the result reads `Missing Change Nickname permission`. A nickname changed directly in Fluxer stays until the next change here or in chat

### Moderation and safety

**Automod policy** also has **Check webhook and other bots' messages**, the same switch as `!automod bots on|off`. New automod rules offer the types **Mentions over time**, **Links over time** and **Deceptive links** beside the others. The rule form starts every type at 5 in 10 seconds, so set the threshold and window you want. See [the bot guide](BOT.md#automod) for how each type counts. The bot learns a changed bot message switch from the server's next member message

### Role picker

The Role picker section under Roles turns the role picker on or off, edits its menus and sets who may use it. Each menu has a name, an optional description, single or multiple choice and up to 25 roles, and a server can have 10 menus. A role belongs to one menu. Before saving, the bot checks every menu role: It must sit below the bot's top role and yours, must not be the everyone role or a staff role, and must carry only ordinary member permissions. Saves share one revision with `!rolepicker` in chat, described in [the bot guide](BOT.md#role-picker)

Who may use the role picker is set with allowed and blocked roles and user IDs, up to 100 of each. A block always wins over an allow. With both allow lists empty, every member who is not blocked may use it

### Temporary roles

The Temporary roles section under Roles lists the active temporary roles that end first, up to 100, with the member's ID, the role and the end time in UTC. A grant whose time ended but whose role NeonFlux could not remove yet stays in the list with the reason, such as missing Manage Roles, and NeonFlux tries again. Use `!temprole list` in chat for the rest. Giving, renewing, shortening and ending grants is done in chat, as [the bot guide](BOT.md#temporary-roles) describes

Each role can have a default duration, used when staff give the role without one, and a longest duration. Durations use the chat form, such as 30m, 12h, 7d or 2w, from 1 minute to 365 days. Clearing both durations removes a role's defaults. Saves share one revision with `!temprole default` and `!temprole max` in chat

### Newcomer checklist

The Newcomer checklist section under Roles sets the same checklist as `!onboarding`: The switch, whether it goes with the channel welcome or the DM greeting, up to five ordered steps and the completion role. A step accepts the rules, picks roles from a reaction panel or a role picker menu by name, or names a channel to visit with a line of up to 100 characters. Saving the steps replaces the whole list, and a panel or menu name must exist. Choosing a completion role has the bot check it like other assigned roles, and clearing the picker removes it. The section also shows how many members finished the checklist in the last seven days while analytics counts. Changes need the server owner or an Administrator, and saves share one revision with chat. See [the bot guide](BOT.md#newcomer-checklist) for how members finish steps

### Setup presets

The Setup presets section under Basics lists the community presets and security levels of [`!preset`](BOT.md#setup-presets), each with exactly the settings it would change now, from their current values, or that the server already matches. **Apply preset** needs the confirmation box and applies exactly the listed changes. When a listed setting changes first, the request fails and the list shows the new changes, so you confirm again. Applying needs the server owner or an Administrator. Each changed feature appears in the audit log as `preset <name>`

### Member role picker

A member opens a server under **Choose your roles**. The page asks the bot to read the member's current roles, which takes a few seconds, then shows each menu with **Claim** or **Drop** next to every role. In a single-choice menu, claiming a role drops the member's other role from that menu. Each request shows as pending until the bot applies it or it fails with a reason, such as missing rules acknowledgment or a role the bot may no longer assign

The bot drops only roles the role picker added that no other NeonFlux feature still needs, so a role given another way stays. A role change that Fluxer did not confirm fails and is never retried

Role names and colors come from the bot, never from the member's sign-in. Each role check reads the names of the menu roles with the member's roles, and every menu save stores the current names with the menu. The page shows the names from the latest role check, and the stored names until a check arrives

Members can send 10 claims or drops and 10 role checks a minute in each server, with up to 3 pending at once, and a server queues at most 50 member requests. The roles and role names read for a check are kept for ten minutes, and request records for one day

### Pickers and message builder

Channel and role pickers search names or IDs as you type. Arrow keys move, Enter chooses and Escape closes. Role choices exclude `@everyone`. If the list cannot load, retry or enter an exact ID

The server's channels and roles load once when you open a server. **Refresh** next to a channel or role picker loads them again, for example after you create a role in Fluxer. The lists loaded earlier stay usable while it runs. Each refresh is one request, at most one runs every ten seconds, and a refresh asked for sooner runs once the wait ends. The lists never reload on a timer. They reload once by themselves when you come back to the tab after opening the bot invitation, and when a temporary voice generator's channel is missing from them

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

### Forum channels and discussion threads

The suggestion and event channel pickers also offer forum and media channels. There each suggestion or event card becomes its own forum post, as [the bot guide](BOT.md#suggestions-and-voting) describes. Saving a forum as the suggestion destination asks the bot to add the status tags the forum lacks. When it cannot, the request fails with the fix, such as granting Manage Channels or removing tags from the forum

The Events section has **Discussion threads**, the same switch as `!event threads on|off`. Events published while it is on get a discussion thread on their card, and the thread or forum post is archived and locked when the event ends or is cancelled

### Channel logs

Choose a destination and a responsible Owner or Administrator for each category. Events can use the category route, use their own channel and owner, or be turned off. Message events need explicit channel opt-in. Logs contain IDs, field names and counts, never message text or private ticket content. The Security alerts group carries the alerts the next section turns on

### Security alerts

The Security alerts section under Moderation has one switch for each alert: Invite logs, unexpected bots, unexpected webhooks, privilege changes and impersonation, all off at first, with the same rules as `!alerts`. Alerts reach staff only through the Security alerts group in Channel logs. Mark a bot or webhook as expected by its ID, and open the expected list to make one alert again

**Refresh invite list** has the bot read the server's invites with its own permissions, which needs Manage Server, and shows up to 100, newest first, with channel, creator ID, uses, expiry and flags for invites that never expire or have unlimited uses. Each invite has a reference instead of its code, which is never shown or stored. Tick the confirmation and choose **Revoke invite** to have the bot read the current invites and delete that one. A revoked invite cannot be restored. See [security alerts and invites](BOT.md#security-alerts-and-invites)

### Analytics

The Analytics section under Insights shows server activity as counts only, never per-member data. It has the analytics switch, a chart of daily member joins and leaves for the last 30 days with the number of members who finished the newcomer checklist, a chart of daily member messages for the last 14 days and the top ten channels by messages for the last 7 or 30 days. Days are UTC, and each chart can also be shown as a table

Busiest hours uses the same 7 or 30 day range as the top channels. It names the busiest UTC hour, charts messages for each hour of the day and shows a weekday and hour grid, where a brighter cell means more messages. Over 30 days a weekday occurs four or five times, so each grid cell is that weekday's average per day. Pick a channel to see only its hours, or leave the channel empty for every channel. Messages in threads count under their parent channel

When analytics is off, the section says the bot is not counting, and existing counts stay until they expire. The switch saves with the section revision like other forms, and `!stats on` and `!stats off` change the same setting. Channel names come from the server's channel list, and a deleted channel shows its ID. Counts arrive about every five minutes while the server is active. See [the bot guide](BOT.md#server-analytics) for what is counted

### Private cases

The Private cases section under Moderation shows moderation cases, appeals and member history on the website. Only the server owner and members holding the server's private data role can view them. Administrators also need the role, and without a private data role only the owner can view them. The owner chooses the role under **Private data role** in Moderation and safety or with [`!mod private-role`](BOT.md#moderation-and-cases). Other managers see the chosen role but cannot change it

- **Cases** lists cases newest first in pages of 25, with **Older cases** and **Back** to move between pages
- Opening a case shows its details, its corrections and its appeals
- A member's ID in a list, or **Member ID** with **Show history**, shows that member's cases newest first and their newest 25 appeals
- **Appeals** lists every appeal newest first in pages of 25

A case or appeal that the owner erased with `!mod erase` shows that it was erased, never its text

Every view asks NeonFlux to check your access. The bot reads your current roles and whether you own the server from Fluxer with its own token, so the check never uses your sign-in. A view waits while the check runs, which usually takes a few seconds. A passed check serves your views for two minutes, so paging and opening cases need no new check, and a role removed in Fluxer stops your access at the next check after those two minutes. A refused check stands for 10 seconds before **Check again** asks the bot once more, and a check the bot does not answer within a minute shows that NeonFlux could not check your access

Members without Manage Server reach this section only from the member view of a server that names a private data role, and the check still decides whether they see anything. Every view that shows data is recorded in the [audit log](#audit-log)

### Audit log

The Audit log section under Insights lists every setting change, whether it was saved here or made with a chat command, newest first in pages of 25. **Older** and **Newer** move between pages, and **Feature** shows one feature's changes. Each entry shows when it happened in UTC, who made it, whether it came from the website or a command, the feature, the setting or operation and a short summary of what changed, such as `xpPerMessage: 15 → 25`. Website entries show the signed-in name with the user ID, and command entries show the user ID only

Summaries name changed settings and list items such as rules or menus by name. They never show authored text, such as message content, descriptions or reasons. A restore from a backup lists each imported item. When a member deletes their own data with [`!mydata`](BOT.md#your-data), the log shows the features and counts they deleted, never the data. Each view of [private cases](#private-cases) shows as **Private data viewed** under the **Private cases** feature, with who viewed what kind of data, such as a cases list, one case, the appeals list or a member's history, and the member it concerns, never the cases or appeals themselves. Each change saved in [server structure](#server-structure) shows under **Server structure** with the channel names, such as `move news` with `Info, after rules → Chat, after general`. Each [server export](#server-export) shows as **Server exported** under **Server export**, with whether it came from the website or `!export` and whether it started or continued after a new access check. Entries are kept for 180 days. The [backend guide](BACKEND.md#audit-log) lists the few changes that are not recorded, such as DEFCON changes that security detection makes on its own

### Server export

The Server export section under Insights lets the server owner download a readable JSON file of the server's NeonFlux data that other bots can load: Every feature's settings, leveling XP and levels, moderation cases with their corrections and appeals, without text the owner erased. [The export guide](EXPORT.md) documents every field of format version 1. It is separate from the encrypted backup, which only restores into NeonFlux

**Export server data** first runs the same live access check as [private cases](#private-cases), and only a check that finds the server owner starts the export. Administrators and holders of the private data role are refused. The section then reads the export page by page, shows how many records it read and offers **Save** with the file. When the export outlasts the two minutes a passed check serves, the section asks for a new check and continues where it stopped. Each start and continuation appears in the audit log as **Server exported** under **Server export**, never with the content. The owner can also send `!export` in a DM, as [the bot guide](BOT.md#server-export) describes

### Recovery inbox

The Recovery inbox section under Insights lists work that failed, stalled or has an unknown outcome, features that are on but need setup and the problems of the latest permission check, current state first and then newest first. Each entry shows when it happened in UTC, what happened and the next step, such as the chat command that resolves it, and a feature that needs setup links to its section. It updates live and shows the same entries as [`!recovery`](BOT.md#recovery-inbox), which lists its sources and limits

### Backup preview

The Backup preview section under Insights shows the server owner's latest read-only restore preview: For each archive item, whether a restore would create it, skip it as identical, skip it as conflicting or block it, and why, 25 items per page. The owner makes a preview with [`!backup preview`](BOT.md#selective-backup-and-additive-restore) and an attached archive in a DM with NeonFlux. Only the owner who made it sees it here, and other managers see that no preview is available to them

Opening the section, and **Check again**, asks NeonFlux to read the archive message and the server again with its own token and to recheck that you still own the server. A check waits at least 10 seconds after the previous one, and one the bot does not answer within a minute says so. When the archive message is gone, the key changed or you no longer own the server, the section says so, and in the last case the preview is removed. Exporting, planning and restoring stay in the DM

### Temporary voice

The Temporary voice section adds, configures and removes generators with the same settings as `!voice generator`: The generator name, the category for new rooms, the room name template, an optional default member limit and a fixed region or automatic routing. Leave the category, limit or region empty for top-level rooms, no limit or automatic routing. The section also shows how many generators and live rooms the server has

Adding a generator has the bot create its voice channel, and a new name renames the generator channel. If the backend rejects an add, the bot deletes the channel it just created. Removing a generator keeps its channel. Room owner controls, such as rename and hide, stay in chat. See [temporary voice rooms](BOT.md#temporary-voice-rooms)

### Looking for group

The Looking for group section under Community turns the feature on or off and chooses the group channel and the voice generator whose category, member limit and region group rooms use. Only existing generators are offered, so add one in Temporary voice first. It also sets the minutes a group stays open, from 10 to 1440 and 60 by default, the largest group size, from 2 to 25 and 10 by default, the open groups one member hosts, from 1 to 5 and 1 by default, and the open groups per server, from 1 to 50 and 20 by default. Saves share one revision with `!lfg config` in chat, and the section shows how many groups are open. Posting, joining and starting groups happen in chat, as [the bot guide](BOT.md#looking-for-group) describes

### Sticky messages

The Sticky messages section under Messaging adds a sticky to a text or announcement channel, changes its text and repost interval, and removes it, with the same rules as `!sticky`: At most five channels, text of 1 to 2000 characters and an interval of 10 to 3600 seconds, 30 by default. A saved change posts the sticky at once and deletes the previous copy, and a removal deletes the last copy. See [sticky messages](BOT.md#sticky-messages)

### Dashboard link

The Dashboard link section under Basics creates, renames or removes the one link channel that opens this server's dashboard page from the server sidebar, like `!sidebar`. Tick the confirmation box to create it, optionally with another name or a category. The bot creates the channel and needs Manage Channels, and its `NEONFLUX_WEBSITE_URL` must be set, or the request fails. If the backend rejects an add, the bot deletes the channel it just created. See [the dashboard link](BOT.md#dashboard-link-in-the-server-sidebar)

### Server structure

The Server structure section under Basics shows the server's categories and its text, voice, announcement, forum, media and link channels, as NeonFlux reads them for you with its own token: The channels you can view, a category you cannot view only when it holds one you can, and each channel's active threads under it. Threads are fixed children of their channel and cannot be moved. A private thread is listed only when NeonFlux can see it and you can manage threads in its channel. **Show closed threads** asks NeonFlux for a channel's 100 most recently closed threads. Opening the section and **Check again** ask NeonFlux to read the server again, at most once every 10 seconds, and a read the bot does not answer within a minute says so

Rename categories and channels, and change their order by dragging a row or with **Up**, **Down** and each channel's category choice, which work from the keyboard too. A dragged category goes before the category it is dropped on, and a dragged channel goes into the category it is dropped on or before the channel. Channels where you lack Manage Channels cannot be changed. Changes are a draft in this tab, as [saving and live updates](#saving-and-live-updates) describes, together with the structure the draft started from. When a channel is created, changed, deleted or reordered after the read, the section says so while it is open, and **Load the current structure** reads the server again. A draft keeps the structure it started from

**Review changes** lists each rename and move and what saving would do with it against the latest read: Save it, skip it because it is already so, or leave it unsaved because the channel changed elsewhere since the draft started, the channel or its new category is gone, or you lack Manage Channels in the channel. **Save changes** sends the draft to NeonFlux, which reads the server again and checks every change with your current permissions. It compares the draft with the structure it started from and the current one, and reports a change that conflicts with another change instead of overwriting it. NeonFlux then saves the other changes with its own token, never your sign-in, and **Last save** shows each change's outcome. A change Fluxer did not confirm shows as **Outcome unknown**. NeonFlux never repeats it, so check the server before saving it again. A save holds at most 100 changes. Each saved change, and each with an unknown outcome, appears in the [audit log](#audit-log)

NeonFlux needs Manage Channels in each channel it changes, and a change it cannot make names that fix. A moved channel keeps its own permissions and does not take over those of its new category. Changing permissions, creating channels and deleting channels are not part of this section and stay in Fluxer. See [the bot guide](BOT.md#server-structure-editor)

### Member list order

The Member list order section under Roles lists the roles that Fluxer shows as their own member list groups, top first, from the server's role list. Move roles with **Up** and **Down**, then save the order, or reset it so the member list follows the role hierarchy again. The bot applies the order with the same rules as `!memberlist`: It moves only roles below its own top role and yours, keeps the other roles in place and refuses an order that does not fit around them. A refused order fails with a general reason, and `!memberlist` in chat names the roles in the way. Reset needs the server owner or an Administrator. After a change is applied, the section reloads the role list once to show the new order. See [member list order](BOT.md#member-list-order)

### Help desk

The Help desk section under Community adds and removes the forum or media channels the help desk serves, up to 10, and changes the greeting, the solved tag, the reply reminder wait, the thread warnings channel and the auto-archive setting with the same rules as `!helpdesk`. Leaving the greeting or the reminder wait empty turns it off. The section also adds, changes and removes saved answers, up to 50, which staff post with `!answer` in chat. Adding a forum has the bot prove the channel exists in the server, and `!helpdesk forum add` in chat also names the permissions NeonFlux lacks there. See [forum help desk](BOT.md#forum-help-desk)

### Showcases and profiles

The Showcases section under Community turns showcases on or off and sets the showcase channel, the showcases each member may have, from 1 to 50, and the minutes between a member's showcases, from 1 to 10,080. Leave a number empty for no limit. The Profiles section under Community turns profiles on or off and sets the seconds between a member's `!profile` commands, from 1 to 3,600. Each section also sets who may use the feature with allowed and blocked roles and user IDs, up to 100 of each, where a block always wins. Saves share one revision with `!showcase` and `!profile` in chat, described in [the bot guide](BOT.md#showcases-and-profiles). While a feature is on, its section also shows your own member page below the settings

### Member showcases and profiles

A member opens **Showcases** or **Your profile** in the member view of a server that offers them. Managers find the same pages in the Showcases and Profiles sections

- **Post a showcase** takes a title of up to 100 characters, text of up to 1,000 and up to three links, one per line. The first HTTPS link to a PNG, JPEG, GIF or WebP image becomes the picture. Files cannot be uploaded
- **Your showcases** lists your showcases, newest first, up to 50, with their status: Being posted, posted, not confirmed by Fluxer or not posted. **Edit** changes the posted message and **Delete** deletes it, both through the bot. A showcase that is being posted or not confirmed waits until it settles, and staff can check an unconfirmed one
- **Your profile** saves a bio of up to 300 characters, up to three links and an optional accent color, and **Delete profile** removes it at once, together with any of your saves the bot has not handled yet

The bot checks your current roles, the server's settings and its automod rules before it posts, edits or saves, so each request shows as pending until it is done or fails with its reason, such as an automod rule that blocked it or a limit. Members can send 5 requests a minute for each feature in each server, with up to 2 pending at once. Requests expire after two minutes, and their records are deleted after one day

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
