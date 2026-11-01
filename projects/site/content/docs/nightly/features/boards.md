---
title: Boards
description: Repost a message once enough members react with an emoji, such as a starboard or a clownboard
---

A board reposts a message once enough members react to it with the board's emoji. A starboard for ⭐ and a clownboard for 🤡 are the same feature with different emoji, and a server can have several

## How it works

Each board has a name, an emoji, a channel and a threshold. The threshold is 3 reactions unless you choose another

- A member's own reaction does not count, and neither do messages of bots and webhooks, until a board's settings say so. Reactions by bots never count
- A channel holding any board is left out, and so is each channel a board ignores. A thread counts as its parent
- Each board posts a message once. The count updates at most once a minute, and a message that falls below the threshold stays posted

### Who can see the repost

A message stays off a board when someone who can read the board could not already read the message. NeonFlux judges this from the roles and overwrites on both channels when a reaction arrives, and again just before it posts

- An adult channel never reposts to a board that is not adult
- A private thread or a ticket channel never reposts
- A channel whose overwrites Fluxer did not send never reposts
- A private board works for a private channel with the same readers

A post that already stands is judged again only at the next reaction on its message, so changing permissions alone rechecks nothing

### What a post shows

A post is one embed with the author's name, the text, the first image, the reaction count and a link to the original. A spoiler image or one Fluxer marks as adult stays out. Mentions are broken up, so nothing pings. Text a [content rule](./automod.md) would catch for the author in the board's channel is left out with a note

### Removal

Deleting the source message, or its channel or thread, deletes its post, and so does `!mydata delete` by its author. A post NeonFlux may not delete stays

## Set it up

1. Make a text or announcement channel for the board, where NeonFlux has View channel, Send messages and Embed links
2. Send `!board add stars ⭐ #starboard`
3. Leave out any channel you want to keep off it with `!board ignore add`

The dashboard has the same settings under **Boards** in Community

## Example

```text
Sam: !board add stars ⭐ #starboard 5
Sam: !board add clowns 🤡 #clownboard
Sam: !board ignore add stars #staff-chat
Sam: !board set clowns self on
```

## Commands

| Command                                          | What it does                                                   |
| ------------------------------------------------ | -------------------------------------------------------------- |
| `!board add <name> <emoji> #channel [threshold]` | Add a board                                                    |
| `!board set <name> emoji <emoji>`                | Change its emoji, which also turns a stopped board back on     |
| `!board set <name> channel #channel`             | Change its channel, which also turns a stopped board back on   |
| `!board set <name> threshold <number>`           | Change its threshold, which also turns a stopped board back on |
| `!board set <name> self on\|off`                 | Let an author's own reaction count                             |
| `!board set <name> bots on\|off`                 | Let messages of bots and webhooks onto the board               |
| `!board ignore add\|remove <name> #channel`      | Leave a channel out, or take it back in                        |
| `!board remove <name>`                           | Remove a board. Its posts stay                                 |
| `!board list`, `!board show <name>`              | List the boards, or show one                                   |
| `!board module on\|off`                          | Turn every board on or off                                     |

These need the server owner, Administrator or Manage community

## Limits

- Up to 5 boards per server, and a threshold of 1 to 100
- The emoji is a Unicode emoji or a custom emoji
- Text on a post is cut to 2,000 characters
- A board keeps its record of the latest 1,000 posts. An older post stays on Fluxer, but its count and removal no longer apply
- A post with an unknown outcome shows as not confirmed in `!board show` and is never posted again. [`!publish reconcile`](./messages.md), or `!publish resolve` after a timeout, settles it
- A missing channel or permission stops the board, posts one note and adds a `!recovery` entry
- DEFCON below 3, publishing off and the module off hold new posts, and the bill guard can pause reaction checks
- Tested against Fluxer: The visibility check on real channels, and one card through the real publisher with no ping
- Not tested against Fluxer yet: A repost from real members' reactions, a count update and a removal
