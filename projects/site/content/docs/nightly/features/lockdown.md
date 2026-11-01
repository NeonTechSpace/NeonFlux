---
title: Server-wide lockdown
description: Stop posting across the whole server at once, then give every channel back what it had
---

`!lockdown on` stops members posting across the server. `!lockdown off` gives each channel back the permissions the lockdown changed. Nothing is locked until staff run it

This is different from [DEFCON](./moderation.md#defcon), which limits commands and changes no channel permissions, and from `!security lock`, which locks one channel

## How it works

A lockdown denies Send messages to the everyone role in each channel it covers. Where NeonFlux holds them server-wide, it also denies Send messages in threads, Create public threads and Create private threads

- It covers text, announcement, forum and voice channels. A voice channel's chat is locked, and members can still join
- It leaves out categories, exempt channels, channels only staff can view and channels that already deny all of these. The reply says how many channels it left out as staff-only, already denied or exempt
- Threads follow their parent channel, and a channel created during a lockdown is not touched
- It first allows NeonFlux those permissions in the channel, unless NeonFlux is an Administrator

A channel counts as staff only when the everyone role cannot view it and every role that can holds a staff permission. So a channel shown through a member role is locked, and a ticket shown through a member overwrite is not

### Lifting it

`!lockdown off` gives back only the permissions this lockdown changed and the everyone role is still denied. A change someone made during the lockdown stays. A channel `!security lock` already held keeps that lock

### If something fails

The work runs in the background, a few channels at a time, and carries on after a restart. A write known not to have gone through gets up to five tries. A write NeonFlux could not confirm is never repeated by itself. `!lockdown status` reads those channels and settles them as done or failed

While the last lockdown holds channels it could not restore, a new one is refused until `!lockdown off` restores them

## Set it up

1. Give NeonFlux Manage roles
2. Exempt any staff channel a role without staff permissions can view, since a lockdown counts it as public. Do this before a raid
3. Optionally let [anti-nuke](./anti-nuke.md) start the lockdown

The dashboard has the same controls under **Server-wide lockdown** in Moderation. Starting or lifting there needs its confirmation ticked

## Example

```text
Sam:  !lockdown exempt add #staff-chat
Sam:  !lockdown on Raid in progress
Sam:  !lockdown status
Sam:  !lockdown off Raid over
```

## Commands

| Command                                 | What it does                                                  |
| --------------------------------------- | ------------------------------------------------------------- |
| `!lockdown on [reason]`                 | Start it, or repeat the channels that failed                  |
| `!lockdown off [reason]`                | Lift it, or repeat the channels that failed                   |
| `!lockdown status`                      | Show its state and counts, and name up to 10 problem channels |
| `!lockdown exempt add\|remove #channel` | Leave a channel out of the next lockdown, or take it back in  |
| `!lockdown exempt list [next]`          | List the exempt channels                                      |

The server owner, Administrators and security staff with Manage roles can use these. `!lockdown off` and `!lockdown status` stay reachable for the owner and Administrators at DEFCON 1

## Limits

- It changes only the everyone role, so a role with its own Send messages allow in a channel can still post there. The reply counts those channels
- Changing the exempt list does not change a lockdown that is already on
- `!security lock` is refused on a channel the lockdown holds
- The start and end go to the security log and the staff log channel when there is one, and a lost note is not sent again
- Tested against Fluxer: Channels locked and restored to exactly what they had, also with the lift after a restart
- Not tested against Fluxer yet: A member really being stopped, and NeonFlux's own allow
