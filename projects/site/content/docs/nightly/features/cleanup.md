---
title: Cleanup
description: Delete messages older than a chosen age in selected channels
---

Cleanup deletes old messages in channels where they should not pile up, such as an announcement feed or a chat for passing questions. Staff pick the channels and an age for each. Everything starts off

## How it works

Each channel has its own **policy**, which is an age from one hour to 365 days. Ages are written like `60m`, `1h30m`, `30d` or `2w`

The bot deletes a message only when all of these hold:

- It was written by a person and is an ordinary message or a reply
- It is not pinned
- It is older than the age
- It is not on the exclusion list and is not a publishing or role panel message that the bot protects

Anything the bot cannot fully identify is kept. A policy also covers the channel's active threads. Archived threads are left alone until a new message makes them active again

Cleanup runs in passes, so a message that has only now passed the age can wait a while, up to about 15 minutes, before it goes. Deleting a pinned message is possible when the pin was added moments before the pass read the channel

### Excluding messages

`!cleanup exclude` keeps the messages of chosen authors or particular messages from ever being deleted

### What is stored

Cleanup stores only IDs, authors, timestamps and outcomes. It never stores message text or attachments. Records expire after 30 days

A deletion whose result is unknown is never retried. Those show in the **Recovery inbox** section of the dashboard for a week, so staff can check the messages themselves

## Set it up

1. Open the **Message cleanup** section of the dashboard for the server, or use the chat commands below
2. Choose a text or announcement channel and an age, such as `!cleanup configure #announcements 30d`
3. Check what would go with `!cleanup preview #announcements`, which deletes nothing
4. Turn the module on with `!cleanup module on`
5. Turn the channel on with `!cleanup enable #announcements`, and run the confirm command the bot prints

The bot needs View channel, Read message history and Manage messages in the channel. Enabling a policy deletes existing messages older than the age, which is why it asks for confirmation

## Example

```text
Mod:   !cleanup configure #questions 7d
Mod:   !cleanup preview #questions
Mod:   !cleanup exclude #questions author add @Helper
Mod:   !cleanup module on
Mod:   !cleanup enable #questions
Bot:   Turning cleanup on may delete existing messages older than the set age. ...
Mod:   !cleanup enable #questions confirm
```

After the confirm, messages in `#questions` older than seven days start to go, except Helper's

## Commands

These are for owners and Administrators. Run them in a text or announcement channel, since threads, forum posts and voice channels are refused when no channel is named

| Command                                                              | What it does                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------- |
| `!cleanup configure #channel <age>`                                  | Create or replace a channel's policy                  |
| `!cleanup preview #channel`                                          | Check up to 50 older messages without deleting        |
| `!cleanup show #channel`                                             | Show the policy                                       |
| `!cleanup enable #channel [confirm]`                                 | Start deleting there                                  |
| `!cleanup disable #channel`                                          | Stop deleting there and keep the settings             |
| `!cleanup list [next]`                                               | List channels with cleanup                            |
| `!cleanup status [#channel]`                                         | Show whether cleanup is on, or one channel's last run |
| `!cleanup status #channel messages [next]`                           | List messages it handled, newest first                |
| `!cleanup exclude #channel author\|message add\|remove <id> [id...]` | Keep these authors or messages                        |
| `!cleanup module on\|off`                                            | Turn the module on or off                             |

## Limits

- Up to 500 channels with cleanup, and turning one off keeps its slot
- Up to 8,192 excluded authors and 8,192 excluded messages per channel, and 20,000 across a server
- Cleanup pauses at DEFCON 1
