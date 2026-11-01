---
title: Leveling
description: Members earn XP for chatting, level up, and can receive roles at set levels
---

Leveling gives every member XP for ordinary messages. XP adds up to a level, and members can check their rank or the server leaderboard. A server can also hand out a role when a member reaches a level

## How it works

Leveling starts off. Once on, each eligible message earns 15 XP by default, with a 60-second wait before the next message can earn again. Level N needs `100 * N²` XP in total, up to level 1000

These messages earn nothing:

- Messages from bots, webhooks and the system
- Direct messages and edits
- Commands, and messages with no text
- The same text sent again within ten minutes

Scores belong to the member's account in this server. They stay when a member leaves and rejoins

Members with the same XP share a rank, so ranks can run 1, 2, 2, 4. Members with zero XP have no rank

Leveling stores no message text, names or pictures

### Reward roles

A reward role is given at a chosen level. Rewards add up, so a member at level 10 keeps the roles from earlier levels

NeonFlux needs the Manage roles permission and a role above each reward role. It removes only roles it gave itself. Turning leveling off keeps existing rewards

A member who rejoins keeps their XP. The role comes back after their next message, or after `!level reconcile @member`

### Level-up messages

These start off. When on, the bot posts a message such as `@member reached level 5` that notifies nobody. It goes where the member leveled up or to one chosen channel, and can be limited to levels that have a reward role

## Set it up

1. Open the **Leveling** section of the dashboard for the server, or use the chat commands below
2. Turn leveling on with `!level module on`
3. Set the rate if the defaults do not fit, such as `!level rate 20 60`
4. Add reward roles with `!level map 5 @Regular`
5. Optionally limit XP to some channels, exclude channels or roles, and turn on level-up messages

The dashboard also takes long lists. Paste several channel or role IDs at once, up to 500 channels and 250 roles. Reward roles top out at 250

## Example

```text
Mod:   !level module on
Bot:   Leveling is on

Mod:   !level map 5 @Regular
Mod:   !level announce here

Rin:   !rank
Bot:   (a rank card with level, lifetime XP, rank and progress to the next level)
```

## Commands

Members use `!rank` and `!leaderboard`. The rest are for owners and Administrators

| Command                                               | What it does                                      |
| ----------------------------------------------------- | ------------------------------------------------- |
| `!rank [@member]`                                     | Show XP, level and rank                           |
| `!leaderboard [next]`                                 | Show members by XP, 10 per page                   |
| `!level config`                                       | Show the settings and reward roles                |
| `!level config only\|channels\|roles\|rewards [next]` | List one setting in full                          |
| `!level module on\|off`                               | Turn leveling on or off                           |
| `!level rate <1-100 XP> <15-3600 seconds>`            | Set XP per message and the wait between messages  |
| `!level only channels <IDs...\|none>`                 | Let only these channels and their threads earn XP |
| `!level exclude channels\|roles <IDs...\|none>`       | Set the channels or roles that earn no XP         |
| `!level announce off\|here\|#channel [rewards]`       | Choose where level-up messages go                 |
| `!level map <1-1000> @role`                           | Give a role at a level                            |
| `!level unmap <level>`                                | Stop giving the role for a level                  |
| `!level clear [confirm]`                              | Preview, then remove all reward mappings          |
| `!level correct @member <0-100000000> <reason>`       | Set a member's XP                                 |
| `!level reset member @member <reason> [confirm]`      | Preview, then reset one member                    |
| `!level reset server <reason> [confirm]`              | Preview, then start a new season for everyone     |
| `!level status`                                       | Show reward role changes still waiting or blocked |
| `!level reconcile [@member]`                          | Check reward roles again                          |
| `!level audit [next]`                                 | Show recent corrections and resets                |

## Limits

- XP per message is 1 to 100, and the wait is 15 to 3600 seconds
- Up to 500 channels earn XP when a list is set, and up to 500 excluded channels and 250 excluded roles
- Categories cannot go in a channel list, since they hold no messages
- A reset ends with the word `confirm`, and the words before it are the reason
- A server reset hides all old scores at once
- Correction and reset records are kept for 180 days
- A server with paused optional work earns no XP
- A restart can lose messages that were waiting to be counted
