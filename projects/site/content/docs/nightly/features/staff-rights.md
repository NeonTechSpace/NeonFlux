---
title: Bot-only staff rights
description: Let a staff role moderate only through NeonFlux, with a limit on how much each member can do
---

Staff roles normally need the real Fluxer permission for each action, so a hacked staff account can act in Fluxer directly. With bot-only rights, a staff role holds no real permission and can act only through NeonFlux, which limits how much it can do and records every action as a case

This moves a security boundary, so it is off by default, only the server owner turns it on and every default refuses

## How it works

A right covers one action and its reversal:

| Right        | Covers                          | One member, in 10 minutes | All members together |
| ------------ | ------------------------------- | ------------------------- | -------------------- |
| `ban`        | Ban and unban                   | 3                         | 9                    |
| `kick`       | Kick                            | 5                         | 15                   |
| `timeout`    | Timeout and removing it         | 10                        | 30                   |
| `purge`      | Deleting messages in bulk       | 5                         | 15                   |
| `slowmode`   | Slowmode                        | 10                        | 30                   |
| `lock`       | Locking and unlocking a channel | 5                         | 15                   |
| `quarantine` | Quarantine and release          | 5                         | 15                   |
| `jail`       | [Jail](./jail.md) and unjail    | 3                         | 9                    |

Going over a member's limit refuses the action, suspends that member's rights until `!mod rights clear` and sends a record to the security log. Reaching the server-wide ceiling refuses and records too, without suspending anyone

A member still needs the staff role for the area, DEFCON still applies, the target must rank below them and NeonFlux, and NeonFlux still needs its own permission. A right counts only through a role ranked below NeonFlux

The backend decides each action and counts it in the same step. An action with an unknown outcome is counted once and never repeated

Each action through a right feeds [anti-nuke](./anti-nuke.md), and the audit reason and staff log name the real member. When anti-nuke fires on a member their rights are suspended, in dry run as well

## Set it up

1. Send `!mod rights on`
2. Grant rights to a staff role with `!mod rights grant`
3. Remove that role's real Fluxer permissions, or the member just acts natively and no right is involved
4. Keep the role below NeonFlux
5. Check with `!mod rights status` and `!health safety`

The dashboard has the same settings under **Bot-only staff rights** in Moderation

## Example

```text
Owner: !mod rights on
Owner: !mod rights grant @Helpers timeout purge jail
Owner: !mod rights limit timeout 5 10
Owner: !mod rights status
Owner: !mod rights clear @Alex
```

## Commands

| Command                                       | Who                    | What it does                                                  |
| --------------------------------------------- | ---------------------- | ------------------------------------------------------------- |
| `!mod rights on`                              | Owner                  | Turn it on                                                    |
| `!mod rights off`                             | Owner or Administrator | Turn it off, also at DEFCON 1                                 |
| `!mod rights grant @role <right>...`          | Owner                  | Give a role rights                                            |
| `!mod rights revoke @role [right...]`         | Owner or Administrator | Take rights from a role, also at DEFCON 1                     |
| `!mod rights limit <right> <count> <minutes>` | Owner                  | Change a member's limit, 1 to 50 actions in 1 to 1440 minutes |
| `!mod rights status`                          | Staff                  | See who holds what and who is suspended                       |
| `!mod rights clear @member`                   | Owner                  | Lift a suspension and start the count again                   |

## Limits

- It cannot limit a hacked owner, who can turn it off, or a hacked Administrator, who has every real permission
- It cannot limit a member holding real permissions, who acts natively
- It cannot stop a hacked staff account within its limits. Three bans still happen before the limit stops the fourth
- NeonFlux's own token becomes the higher value target, since it holds the permissions these roles no longer need
- A timeout and a quarantine share one recovery type, so `timeout` can lift a quarantine and `quarantine` can lift a timeout
- A purge names no target, so `purge` can delete anyone's messages, including the owner's. It counts as one action however many messages it deletes
- A member who is timed out holds no right until the timeout ends, and a channel action needs a member who can view the channel
- `!mod recover` keeps needing the real permission, so someone else checks an unconfirmed action
- Rights stay out of backups, so the owner grants them again by hand after a restore. They are in the readable export
- Tested on a real member with no real permission: Slowmode, lock, unlock and purge through rights, refusals, the limit, suspension and clearing it, and the link to anti-nuke. A test script sent the commands
- Not tested against Fluxer yet: A right acting on another member, and a person typing the commands
