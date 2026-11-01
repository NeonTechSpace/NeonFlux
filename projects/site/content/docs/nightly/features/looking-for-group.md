---
title: Looking for group
description: Members post a group for a game or activity, and a full group gets its own voice room
---

Members post a group for an activity, and others join it. When the group is full, the bot creates a voice room that only the group can see. Each group has one card in the group channel that the bot keeps up to date

## How it works

The feature starts off. Managers turn it on and choose the group channel. They can also choose a [voice generator](./voice.md), whose category, member limit and region the group rooms then use

A group starts on its own when the last place is taken. The host can also start it earlier. The bot then creates a voice room named after the activity, gives the members access, hides the room from everyone else and mentions the members once. The card links the room

The room belongs to the host, who controls it with the `!voice` commands, such as `!voice show` to open it to everyone. It waits 10 minutes for its first member, then follows the usual rule and is deleted once empty for 45 seconds

A group that never fills closes after its time runs out, and the card is marked

## Set it up

1. Open the **Looking for group** section of the dashboard for the server, or use the chat commands below
2. Choose the group channel with `!lfg config channel #looking-for-group`
3. Optionally choose a generator with `!lfg config generator #join-to-create`, which must exist already
4. Turn it on with `!lfg config on`
5. Give the bot View channel and Send messages in the group channel, Manage channels and Manage roles

Manage channels creates the rooms, and Manage roles limits a room to the group. If a card cannot be posted, the group is cancelled and the reply names the fix

## Example

```text
Mod:   !lfg config channel #looking-for-group
Mod:   !lfg config generator #join-to-create
Mod:   !lfg config on

Rin:   !lfg "Deep Rock" 4 in 30m bring mics
Sam:   !lfg join 1
```

The bot posts a card for the group. When all four places are taken, it creates the room and mentions the members in the channel

## Commands

Managers are the server owner and members with Administrator or Manage community

| Command                                     | Who            | What it does                                  |
| ------------------------------------------- | -------------- | --------------------------------------------- |
| `!lfg "activity" <size> [in <time>] [note]` | Members        | Post a group, with the size counting the host |
| `!lfg join <group>`                         | Members        | Join a group                                  |
| `!lfg leave <group>`                        | Members        | Leave a group, the host cancels instead       |
| `!lfg start <group>`                        | Host, managers | Start a group before it is full               |
| `!lfg cancel <group>`                       | Host, managers | Cancel a group                                |
| `!lfg list [next]`                          | Members        | Show the open groups, 10 at a time            |
| `!lfg config`                               | Managers       | Show the settings                             |
| `!lfg config on\|off`                       | Managers       | Turn the feature on or off                    |
| `!lfg config channel #channel`              | Managers       | Choose the group channel                      |
| `!lfg config generator #generator\|none`    | Managers       | Choose the voice generator                    |
| `!lfg config expiry <10-1440>`              | Managers       | Minutes a group stays open                    |
| `!lfg config size <2-25>`                   | Managers       | Largest group size                            |
| `!lfg config hosting <1-5>`                 | Managers       | Open groups one member can host               |
| `!lfg config open <1-50>`                   | Managers       | Open groups the server allows                 |

## Limits

| Setting                               | Default | Range      |
| ------------------------------------- | ------- | ---------- |
| Minutes a group stays open            | 60      | 10 to 1440 |
| Largest group size, counting the host | 10      | 2 to 25    |
| Open groups one member hosts          | 1       | 1 to 5     |
| Open groups per server                | 20      | 1 to 50    |

- A start time such as `in 30m`, `in 2h` or `in 1d` can be up to 7 days ahead
- A group with a start time stays open for the configured minutes after that time
- Activities have 1 to 50 characters and notes up to 200, each on one line, and an activity with spaces needs quotes
- A group room counts toward the server's limit of 50 temporary voice rooms
- If the chosen generator is removed later, groups cannot start until a manager chooses another
- Turning the feature off pauses posting, joining and starting, while leaving, cancelling and expiry continue
- Member commands pause while the server is at DEFCON 2
