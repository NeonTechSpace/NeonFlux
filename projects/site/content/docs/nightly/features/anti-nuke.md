---
title: Anti-nuke
description: Spot one account destroying the server faster than a person works, and take away what it needs to go on
---

Anti-nuke watches the activity log for an account deleting channels, banning people or handing out dangerous roles in a burst. It starts off and in dry run, where it only records and alerts

It cannot stop everyone. The server owner, anyone ranked at or above NeonFlux and trusted accounts only raise an alert, and a slow burn by a person is reported, not stopped

## How it works

Each kind of action has a limit for one account in a short time. The limits start at 10 bans, 10 kicks, 5 channels deleted and 5 roles deleted, each within 30 seconds. It also fires on bursts of new channels or roles, webhooks, unbans, prunes and dangerous permissions, on destruction spread across kinds, and on accounts working together at that pace

These numbers come from labeled test cases, and no real server's history has tested them yet. Start in dry run and watch what it finds

### What enforce does

In enforce mode, one incident acts once:

| Response | What happens                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `strip`  | Removes every role NeonFlux outranks that has a dangerous permission or a bot-only right, and remembers which. The default |
| `kick`   | Kicks the account                                                                                                          |
| `ban`    | Bans the account                                                                                                           |

A bot with no such role is kicked when the response is strip. A call whose outcome is unknown is never repeated, and `!antinuke incident <number>` reads the member and settles it

`!antinuke restore @member` gives back only what the newest incident removed and the member lacks. The account is not told by DM

### Starting the lockdown

Anti-nuke can start the [server-wide lockdown](./lockdown.md) when stopping one account cannot contain it: Two accounts fired within five minutes, or an account ranked at or above NeonFlux fired. This needs `!antinuke lockdown on` and enforce mode. Lift it with `!lockdown off`

## Set it up

1. Give NeonFlux View activity log, plus Manage roles and Kick members for strip, Kick members for kick or Ban members for ban. Letting it start the lockdown also needs Manage roles
2. Keep NeonFlux's role above every role that holds dangerous permissions. Once anti-nuke is on, `!health safety` names the roles it cannot reach
3. Turn on the [security log](./logs.md) or a staff log channel, so an incident reaches staff. Once anti-nuke is on, `!setup antinuke` says when this step is missing
4. Send `!antinuke module on` and leave it in dry run for a while
5. Add bots and accounts that do large cleanups with `!antinuke trust add`
6. When its incidents look right, send `!antinuke mode enforce`

The dashboard has the same settings under **Anti-nuke** in Moderation. Only the server owner or an Administrator can use it. Incidents also appear under **Private cases** on the dashboard

## Example

```text
Sam: !antinuke module on
Sam: !antinuke limit channels 5 30
Sam: !antinuke trust add @CleanupBot
Sam: !antinuke incidents
Sam: !antinuke mode enforce
```

## Commands

| Command                                                          | What it does                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `!antinuke status`                                               | Show the settings                                                                |
| `!antinuke module on\|off`                                       | Turn it on or off                                                                |
| `!antinuke mode dry-run\|enforce`                                | Choose whether it acts                                                           |
| `!antinuke limit bans\|kicks\|channels\|roles <count> <seconds>` | Set how much one account may do that fast, 2 to 100 actions in 5 to 3600 seconds |
| `!antinuke response strip\|kick\|ban`                            | Choose what enforce does                                                         |
| `!antinuke lockdown on\|off`                                     | Let it start the lockdown. Off by default                                        |
| `!antinuke trust add\|remove @member`                            | Choose accounts it only alerts about                                             |
| `!antinuke trust list [next]`                                    | List the trusted accounts                                                        |
| `!antinuke incidents [next]`, `!antinuke incident <number>`      | See what it found                                                                |
| `!antinuke restore @member`                                      | Give roles back                                                                  |

Turning it down, reading incidents and restoring roles stay reachable at DEFCON 1

## Limits

- It never acts on NeonFlux or a trusted account, and NeonFlux's own automation never counts. Bans, kicks and unbans a moderator makes through NeonFlux count against that moderator, and so does everything done through a [bot-only right](./staff-rights.md)
- Slow burns only alert, at most once per account each half hour, since ordinary maintenance reaches the same pace
- A bot working faster than one action per 15 seconds at that count is stopped. A slower one, such as a voice bot closing rooms, is left alone
- A voice bot closing several rooms in a burst can still reach the channels limit, and `!antinuke trust add` is the way out
- Counts stay in memory, so a restart forgets them
- A server keeps its newest 200 incidents
- Tested against Fluxer: Real activity log entries firing the channels, roles, new channels and roles, dangerous permissions, webhooks, kicks, bans and unbans rules
- Not tested against Fluxer yet: Stripping, kicking or banning a real member, and a prune entry
