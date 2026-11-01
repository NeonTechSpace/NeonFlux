---
title: Sticky messages
description: Keep a message at the bottom of a channel, add a dashboard link to the sidebar, and set the member list order
---

A sticky message keeps one bot message at the bottom of a channel. This page also covers two small tools that sit alongside it: A dashboard link in the server sidebar and the order of roles in the member list

All three are for the server owner and members with Administrator or Manage community. They count as staff commands at DEFCON 2

## How it works

### Sticky messages

After members post, the bot sends the sticky text again and deletes the copy it posted before

- A member message reposts the sticky once the interval has passed since the last repost
- A busy channel gets at most one repost per interval
- Messages from bots, webhooks and messages in threads cause no repost
- The bot deletes only its own copies, and mentions in the text notify nobody

### Dashboard link

Fluxer link channels open an external address from the server sidebar. The bot can keep one that opens the server's own dashboard page. Everyone who can see the channel can open the address, and the dashboard still checks each person's sign-in and permissions

### Member list order

Fluxer groups members under roles that are set to show separately. The order of those groups is kept apart from the role hierarchy, so changing it never changes permissions

The bot moves only roles below its own top role, and below the member's top role unless that member owns the server. Roles that cannot move keep their place. If there is no room around them, the bot refuses and names them

## Set it up

1. Open **Sticky messages**, **Dashboard link** or **Member list order** in the dashboard for the server, or use the chat commands below
2. For a sticky, pick a text or announcement channel and write the text, then set the interval if the default of 30 seconds does not fit
3. For the dashboard link, run `!sidebar add`
4. For the member list order, run `!memberlist set` with the roles top first

The bot needs View channel and Send messages for stickies, Manage channels for the dashboard link, and Manage roles for the member list order. The member changing the order needs Manage roles or Administrator as well. The dashboard link also needs the website address set on the host, as the self-hosting pages describe

## Example

```text
Mod:   !sticky add #questions "Read the pinned rules before asking"
Mod:   !sticky interval #questions 60
Mod:   !sidebar add "Dashboard"
Mod:   !memberlist set @Admin @Moderator @Helper
```

The sticky is posted at once and reposted at most once a minute while members chat. A link channel named Dashboard appears in the sidebar

## Commands

| Command                               | What it does                                                |
| ------------------------------------- | ----------------------------------------------------------- |
| `!sticky add #channel "text"`         | Add a sticky, or replace its text, and post it at once      |
| `!sticky interval #channel <10-3600>` | Set the shortest seconds between reposts                    |
| `!sticky remove #channel`             | Stop the sticky and delete its last copy                    |
| `!sticky list`                        | Show the stickies and their intervals                       |
| `!sidebar`                            | Show the link channel and its address                       |
| `!sidebar add ["name"] [category-ID]` | Create the link channel                                     |
| `!sidebar set "name"`                 | Rename the link and point it at the current website address |
| `!sidebar remove`                     | Delete the link channel                                     |
| `!memberlist`                         | Show the separate role groups, top first                    |
| `!memberlist set @role @role...`      | Set the whole order, naming each role once                  |
| `!memberlist move @role <position>`   | Move one role, where 1 is the top                           |
| `!memberlist reset`                   | Let the member list follow the role hierarchy again         |

Each has a `help` form, such as `!sticky help`. Reset clears the position of every role, so it needs the server owner or an Administrator

## Limits

- Up to five sticky channels per server, in text or announcement channels
- Sticky text has 1 to 2000 characters, and the interval is 10 to 3600 seconds, 30 by default
- A copy the bot could not delete is tried again before the next repost, and a restart forgets such copies, so an old copy may need deleting by hand
- Reposts count as optional work, which the bot's bill guard can pause
- The dashboard link needs the website address on the host, and the bot deletes a link channel it created if the backend refuses to record it
- Fluxer applies a member list order role by role, so an interrupted change can leave part of it applied, and `!memberlist` shows the result
