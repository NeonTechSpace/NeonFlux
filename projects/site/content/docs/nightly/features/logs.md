---
title: Logs
description: Post a record of server changes to staff channels, and review every setting change in the audit log
---

Logs write what happens in the server to channels that staff pick. They cover joins, role and channel changes, message edits and deletions, and the actions Fluxer records in its own audit log. A separate audit log on the dashboard lists every change made to NeonFlux's settings

Moderation case logs are a different thing, set with `!logs channel`. See [moderation](./moderation.md)

## How it works

The logs are sorted into **categories**. Each category posts to a channel chosen by staff, and individual events can post somewhere else or be turned off

| Category     | Examples                                                |
| ------------ | ------------------------------------------------------- |
| `membership` | Member joins, updates and removals                      |
| `resources`  | Role, channel and thread changes                        |
| `messages`   | Message edits and deletions                             |
| `audit`      | Kicks, bans and other Fluxer audit entries              |
| `settings`   | Moderation, log and security setting changes            |
| `operations` | Bot operations                                          |
| `security`   | [Security alerts](./security-alerts.md) and invite logs |

The module and every route start off. A route's **owner** is the Owner or Administrator who receives its posts and must be able to view, send and read history in that channel

### What a post shows

- Members, roles and channels appear as mentions that notify nobody
- Times appear in each reader's own timezone
- A message edit shows the author, a link, and the earlier and new text
- A deletion shows the author, the text and the attachments the bot knew
- A change to a member, role, channel or server shows each value before and after
- Audit entries show their reason and the values Fluxer recorded
- Values whose names look like tokens, secrets or passwords are left out

Each category has its own color, and the darkest shade marks destructive actions

### Message logging and privacy

The bot can show a message's earlier text only if it kept the message. It keeps the most recent messages in memory and only for servers that log message events to a channel. A message sent before the bot started, or pushed out of that window, shows no earlier text

Direct messages, private ticket channels, log channels and the bot's own feedback are never logged. Message events come from every channel except excluded ones, or from only a listed set of channels, up to 500 in each list

### Delivery and retention

- A post that cannot be delivered is retried a minute later, up to three tries
- A send with an unknown result is never repeated, so staff check it with `!logs delivery reconcile <record>`
- If a log channel is deleted, its posts fail until the category or event is routed elsewhere
- A server keeps at most 10000 records, and settled records expire after 30 days
- A record with message text expires after 30 days even when its post was never confirmed
- Delivery pauses at DEFCON 1

### Audit log

The **Audit log** section on the dashboard, under Insights, lists every setting change, whether it came from the dashboard or a chat command, newest first. Each entry shows when, who, where it came from, the feature and a short summary such as `xpPerMessage: 15 → 25`. **Details** opens a table of every changed value before and after. **Feature** filters by one feature

It also records views of private cases, server structure saves, server exports, backup restores and when a member deletes their own data. The last two show only counts, never the data. Entries are kept for 180 days

## Set it up

1. Open the **Channel logs** section of the dashboard for the server, or use the chat commands below
2. Route a category to a channel, such as `!logs metadata route messages #message-log on`
3. Choose which channels log message events if the default of every channel does not fit
4. Turn the module on with `!logs metadata module on`
5. Send `!logs metadata status` to check that the bot can post in each log channel

The bot needs View channel, Send messages, Embed links and Read message history in each log channel. Configure from a server channel. Reports of events, records and delivery arrive in a DM, since records can hold text from channels the log channel's readers cannot see

## Example

```text
Mod:   !logs metadata route messages #message-log on
Mod:   !logs metadata route audit #mod-log on
Mod:   !logs metadata event member joined off
Mod:   !logs metadata module on
Mod:   !logs metadata status
```

Message edits and deletions now post to `#message-log`, and audit entries post to `#mod-log`. Joins are never logged because that one event is off

## Commands

All of these are for owners and Administrators. Send `!logs metadata help` for the short list

| Command                                                            | What it does                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------------- |
| `!logs metadata status`                                            | Show whether logs are on and any channel the bot cannot post in |
| `!logs metadata categories`                                        | Show where each category posts                                  |
| `!logs metadata module on\|off`                                    | Turn metadata logs on or off                                    |
| `!logs metadata route <category> <channel> [owner] on\|off`        | Send a category to a channel                                    |
| `!logs metadata clear <category>`                                  | Stop sending a category                                         |
| `!logs metadata event <event> <channel> [owner] on`                | Send one event to its own channel                               |
| `!logs metadata event <event> off`                                 | Never log one event                                             |
| `!logs metadata inherit <event>`                                   | Let an event follow its category again                          |
| `!logs metadata overrides [next]`                                  | List events that do not follow their category                   |
| `!logs metadata channels all [excluded-IDs]`                       | Log messages from every channel except the excluded ones        |
| `!logs metadata channels <channel-IDs\|none> <excluded-IDs\|none>` | Log messages from only these channels                           |
| `!logs metadata channels add\|remove <channel-IDs>`                | Change the listed channels                                      |
| `!logs metadata exclude add\|remove <channel-IDs>`                 | Change the excluded channels                                    |
| `!logs events list [next]`                                         | List recent logged events                                       |
| `!logs events show <record>`                                       | Show one logged event                                           |
| `!logs delivery show\|reconcile <record>`                          | Check a log post's delivery                                     |
| `!logs metadata forget <record> confirm`                           | Remove a stored record                                          |
| `!logs counters`                                                   | Show open tickets, stored records and waiting posts             |

An event is named in plain words in any letter case, such as `member joined`, or by its code, such as `member-add` or `audit-entry:20`. An override for an event beats its category, and an enabled override posts even when its category is off

## Limits

- Up to 10000 records per server, with the oldest removed first
- Up to 500 channels in each message channel list
- Message text up to 4000 characters per side and up to 10 attachment names and links per record
- A bot's or webhook's deleted messages are not logged, since a deletion does not say who wrote the message
- Edits made while the bot lost its connection to Fluxer can be missed
- A log post that would exceed one embed shortens its text blocks
- Server settings changes made from the dashboard appear under the `settings` category
