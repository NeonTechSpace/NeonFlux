---
title: Voice
description: Members get a private-by-choice voice room by joining a generator channel
---

A member who joins a generator voice channel gets a room of their own, and the bot moves them into it. The owner can rename the room, set a limit, hide it, and decide who can join. An empty room deletes itself

## How it works

Staff add one or more **generators**, which are voice channels that make rooms. Each member owns at most one room at a time. Joining a generator again moves them back to their room

A room is deleted after it has been empty for 45 seconds. The bot deletes only rooms it created. Generators and other channels are never deleted automatically

Settings of a generator apply to rooms created after the change

### Room names and limits

A generator has a name template for new rooms. `{owner}` becomes the owner's server nickname or username, so `{owner}'s room` gives names like `Rin's room`. A generator can also set a default member limit, a fixed voice region and the category where rooms appear

### When a move is not possible

Fluxer does not let bots move the server owner or members ranked at or above the bot. In that case the room is still created, and the bot posts a link to it in the generator's text chat

## Set it up

1. Open the **Temporary voice** section of the dashboard for the server, or use `!voice generator add`
2. Give the generator a name and optionally a category for its rooms
3. Set the name template, member limit and region if wanted
4. Give the bot the permissions in the table below

| Permission                        | Used for                                                              |
| --------------------------------- | --------------------------------------------------------------------- |
| View channel and Connect to voice | Seeing rooms and who is in them                                       |
| Manage channels                   | Creating generators and rooms, renaming, limits, deleting empty rooms |
| Move members                      | Moving members into their rooms                                       |
| Manage roles                      | Hide, show, allow and block                                           |
| Set voice region                  | Fixed regions                                                         |
| Send messages in generators       | Notices when no room can be made                                      |

## Example

```text
Mod:   !voice generator add "Join to create" 123456789012345678
Mod:   !voice generator set #join-to-create template "{owner}'s room"
Mod:   !voice generator set #join-to-create limit 5

Rin:   (joins "Join to create" and is moved into "Rin's room")
Rin:   !voice rename "Study hall"
Rin:   !voice hide
Rin:   !voice allow @Sam
```

Rin's room is now named Study hall and is hidden from everyone except Rin and Sam

## Commands

Room commands act on the room the member owns. Staff add `#room` after the verb, such as `!voice limit #room 5`, to act on another room

| Command                                                        | Who                | What it does                                                 |
| -------------------------------------------------------------- | ------------------ | ------------------------------------------------------------ |
| `!voice rename "name"`                                         | Owner, staff       | Rename the room                                              |
| `!voice hide`, `!voice show`                                   | Owner, staff       | Hide the room from everyone without access, or show it again |
| `!voice allow @member`, `!voice block @member`                 | Owner, staff       | Let a member see and join, or stop them                      |
| `!voice limit <0-99>`                                          | Owner, staff       | Set the member limit, 0 for none                             |
| `!voice claim`                                                 | Member in the room | Take over a room whose owner is not in it                    |
| `!voice transfer @member`                                      | Owner, staff       | Give the room to a member who is in it                       |
| `!voice generator add "name" [category-ID\|none]`              | Staff              | Create a generator                                           |
| `!voice generator list`                                        | Staff              | Show each generator and its live rooms                       |
| `!voice generator set #generator name "name"`                  | Staff              | Rename the generator                                         |
| `!voice generator set #generator category <category-ID\|none>` | Staff              | Choose where new rooms go                                    |
| `!voice generator set #generator template "text"`              | Staff              | Name new rooms                                               |
| `!voice generator set #generator limit <1-99\|none>`           | Staff              | Set the default member limit                                 |
| `!voice generator set #generator region <region-ID\|auto>`     | Staff              | Fix a voice region, or use automatic routing                 |
| `!voice generator remove #generator`                           | Staff              | Stop using the channel as a generator, the channel stays     |

Staff means the server owner, an Administrator, or a member with a moderation staff role and Manage channels

## Limits

- Up to 10 generators and 50 live rooms per server, and at the room limit the bot posts a notice instead
- Room names and templates have 1 to 100 characters, and `{owner}` is the only placeholder
- Hiding keeps access for the owner and the bot, and neither can be blocked
- Blocking does not disconnect a member who is already inside
- Right after a restart the bot waits for Fluxer's list of who is in voice, so claims and transfers ask to try again in a minute and an empty room can last a little longer
- A room made by [looking for group](./looking-for-group.md) can also be claimed and handed over
- Deleting a room also deletes its text chat and disconnects anyone still inside
- A fault on Fluxer's voice servers can make an occupied room look empty, and the bot could then delete it
- Room commands pause while the server is at DEFCON 2
