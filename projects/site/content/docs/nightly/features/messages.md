---
title: Messages
description: Write announcements as saved drafts, post them as the bot, and schedule them ahead of time
---

Publishing lets staff write a message once, keep it as a draft, and have the bot post it in a channel. A message can be plain text or one embed, which is a card with a title, fields and colors. Posts can also be scheduled once or on a repeat

## How it works

Owners and Administrators prepare **drafts** and reusable **templates**. A draft is a message waiting to be sent. A template is a draft meant for reuse, such as a welcome text

Sending a draft gives a post number. To change the sent message later, update the draft and run `!publish edit <post-number> <name>`. The bot checks that the message still matches what it last sent before it edits

A message has up to 2000 characters of text and one embed with up to 25 fields. Links must use HTTP or HTTPS. The bot does not upload files or fetch media

### Scheduled posts

`!publish schedule` plans a post for a future date, once or on a repeat. A schedule copies the draft or template when it is created, so later edits to the source do not change it. Schedules start paused

A repeat can be daily or weekly, for a number of dates, until a day, or with no end. A repeat date whose local time does not exist is skipped. Enabling a schedule never catches up on dates it missed

### When something goes wrong

If the bot cannot tell whether a post went out, it never sends it again by itself. Staff run `!publish reconcile <post-number>` to recheck it, or record what happened with `!publish resolve`. Deleting a draft or forgetting a post never deletes the posted message

## Set it up

1. Open the **Drafts and templates** section of the dashboard for the server, or start with `!publish create <name>`
2. Write the content, add an embed or fields if wanted, and preview it
3. Send it from chat with `!publish send <name> #channel`
4. Or open **Send a saved message** on the dashboard, pick a draft and a channel, and press **Send**
5. For a scheduled post, open **Schedules** on the dashboard or use `!publish schedule create`, then turn on the module and enable the schedule

The **Messages** section composes and sends a one-off message without saving a draft. The bot needs access to the channel, the Send messages permission and, for embeds, Embed links. Mentions in posts never notify anyone

## Example

```text
Mod:   !publish create announcement
Mod:   !publish set announcement title "New release"
Mod:   !publish set announcement content "Release notes are out"
Mod:   !publish preview announcement
Mod:   !publish send announcement #announcements

Mod:   !publish schedule create news draft announcement #announcements 2026-11-01T18:00 Europe/Berlin reject weekly 1 3
Mod:   !publish schedule module on
Mod:   !publish schedule enable news
```

The bot posts the announcement and replies with a post number. The schedule then posts the same text weekly, three times

## Commands

Everything here is for owners and Administrators. Send `!publish help` for the short list and `!publish help all` for the rest

| Command                                                                                                                                                                         | What it does                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `!publish create\|show\|delete\|preview <name>`                                                                                                                                 | Work with a draft                              |
| `!publish list [next]`                                                                                                                                                          | List drafts                                    |
| `!publish clone <name> <new-name>`                                                                                                                                              | Copy a draft                                   |
| `!publish set <name> content\|title\|description\|url\|timestamp "value"`                                                                                                       | Write the draft                                |
| `!publish set <name> color #RRGGBB`                                                                                                                                             | Set the embed color                            |
| `!publish field <name> add "name" "value" [on\|off]`                                                                                                                            | Add a field                                    |
| `!publish clear <name> content\|embed\|fields\|...`                                                                                                                             | Clear part of a draft                          |
| `!publish send <name> #channel`                                                                                                                                                 | Post the draft                                 |
| `!publish edit <post-number> <name>`                                                                                                                                            | Update a sent post from a draft                |
| `!publish posts [next]`                                                                                                                                                         | List sent posts and their numbers              |
| `!publish template create\|show\|delete\|preview\|clone\|list ...`                                                                                                              | The same commands for templates                |
| `!publish template clone <name> <new-name> draft`                                                                                                                               | Start a draft from a template                  |
| `!publish reconcile <post-number>`                                                                                                                                              | Recheck a post whose outcome was unknown       |
| `!publish forget <post-number>`                                                                                                                                                 | Stop following a post, the message stays       |
| `!publish module on\|off`                                                                                                                                                       | Turn publishing on or off                      |
| `!publish schedule create <name> draft\|template <source> #channel YYYY-MM-DDTHH:mm <zone> reject\|earlier\|later [daily\|weekly <every> [<dates>\|until YYYY-MM-DD\|ongoing]]` | Plan a post                                    |
| `!publish schedule list [next]`                                                                                                                                                 | List schedules                                 |
| `!publish schedule show\|dates\|preview <name>`                                                                                                                                 | See a schedule, its upcoming dates or its post |
| `!publish schedule enable\|disable\|cancel <name>`                                                                                                                              | Start, pause or end a schedule                 |
| `!publish schedule update <name> content\|time\|destination ...`                                                                                                                | Change a schedule                              |
| `!publish schedule module on\|off`                                                                                                                                              | Turn scheduled posts on or off                 |

## Limits

- Publishing starts on, and scheduled posts start off
- A schedule's first date must be in the future
- Up to 50 schedules that are not cancelled and still have a date to post
- Dates that come due while the bot is down still send until local midnight after their due time
- Scheduled posts need the scheduling and publishing modules on and DEFCON 3
- At DEFCON 2 only Administrators can publish, and at DEFCON 1 publishing can only be turned off or inspected
- Attempt history is kept for 180 days
