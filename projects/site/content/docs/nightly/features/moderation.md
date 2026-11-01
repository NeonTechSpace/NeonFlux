---
title: Moderation
description: Warnings, timeouts, bans and numbered cases for staff, with appeals and a server lockdown level
---

Every moderation action becomes a numbered case that staff can list, read and correct. Members get a DM about warnings, timeouts, kicks and bans, and can appeal in a DM with the bot. [Automod](./automod.md) uses the same cases for its own actions

## How it works

- Moderation needs the server owner, an Administrator or a configured staff role
- Changing configuration needs the owner or an Administrator
- NeonFlux also needs the matching permission and a role above the target's highest role
- It refuses actions against itself, the owner, Administrators and members with a higher role
- A reason is the rest of the command and needs no quotes. An action's reason is optional
- Durations use `s`, `m`, `h`, `d` and `w`, combined without spaces, such as `90s` or `1h30m`

Staff roles are set per area: `moderation`, `cases`, `automod`, `security` and `appeals`

## Set it up

1. Turn manual moderation on with `!mod module on`, or find it in the dashboard under **Moderation and safety**
2. Assign staff roles with `!mod staff moderation @Moderators`. Repeat for the other areas, or clear one with `none`
3. Set a staff log channel with `!logs channel #mod-log`. Use a channel only staff can read
4. Optionally set how long cases are kept with `!mod retention <days>`. By default they are kept until erased
5. Optionally turn on appeals with `!appeal module on`
6. Run `!health` to see whether NeonFlux has the permissions it needs

## Example

```text
Sam: !mod warn @Alex Posting invite links
NeonFlux: Case #12: Warning of @Alex succeeded. Member notified by DM

Sam: !mod timeout @Alex 10m Spamming after a warning
NeonFlux: Case #13: Timeout of @Alex for 10m succeeded. Member notified by DM

Sam: !mod show 13
```

Alex receives a DM titled with the action, the server and the case number. It names the reason and, while appeals are on, the appeal commands

## Commands

| Command                              | What it does                                                       |
| ------------------------------------ | ------------------------------------------------------------------ |
| `!mod warn @user [reason]`           | Warns a member and sends a DM                                      |
| `!mod timeout @user 10m [reason]`    | Times a member out, for up to one year                             |
| `!mod untimeout @user [reason]`      | Removes a timeout                                                  |
| `!mod kick @user [reason]`           | Kicks a member                                                     |
| `!mod ban @user [reason]`            | Bans a member until unbanned                                       |
| `!mod ban @user 1d [reason]`         | Bans a member for a set time, from one minute to two years         |
| `!mod unban @user [reason]`          | Lifts a ban                                                        |
| `!mod purge 20 @user [reason]`       | Deletes up to 100 recent messages of one member                    |
| `!mod slowmode #channel 10 [reason]` | Sets seconds between messages, 0 to clear                          |
| `!mod jail @user [length] [reason]`  | [Jails](./jail.md) a member, and keeps their roles for the release |
| `!mod unjail @user [reason]`         | Releases a jailed member                                           |
| `!mod rights status`                 | Shows [bot-only staff rights](./staff-rights.md)                   |
| `!mod list [@user] [next]`           | Lists cases, newest first                                          |
| `!mod show <case>`                   | Shows one case                                                     |
| `!mod reason <case> <new reason>`    | Corrects a case's reason                                           |
| `!mod void <case>`                   | Voids a warning. Only warnings can be voided                       |
| `!mod history <case>`                | Shows a case's reason changes and voiding                          |
| `!mod status`                        | Shows whether moderation is on and the staff roles                 |

A case with no reason shows `No reason given`. To link a sanction to an earlier case, put `case <number>` before the reason, as in `!mod unban @user case 12 Appeal approved`

### Where case details answer

Case lists and details answer in the channel only when it is a staff channel, meaning only staff can view it. In any other channel they go to the sender's DM, and the channel gets a note saying so

A staff channel is one the everyone role cannot view. NeonFlux itself needs its own member overwrite there, not one for its role

### Warning limit

The warning limit times a member out after repeated warnings. It is off by default

| Command                   | What it does                                                      |
| ------------------------- | ----------------------------------------------------------------- |
| `!mod warn-limit on`      | Turns it on, at first 3 warnings in 30 days with a 1 hour timeout |
| `!mod warn-limit 5 14 2h` | Sets 5 warnings in 14 days with a 2 hour timeout, and turns it on |
| `!mod warn-limit off`     | Turns it off                                                      |

- Warnings allowed are 2 to 20, days 1 to 365, and the timeout up to a year
- Warnings from automod count too. Voided warnings do not
- Only a new warning is checked, so turning it on acts on nobody at once
- Reaching the limit opens its own case, and the member starts again from zero
- No timeout happens for the owner, Administrators and staff, while automod is in dry run, or when NeonFlux cannot act. The case logs the reason instead

The dashboard has a **Warning limit** form with the same settings

### DEFCON

DEFCON is a lockdown level for the whole server. It does not change channel permissions. To stop posting in every channel, use the [server-wide lockdown](./lockdown.md)

| Level | What happens                                                         |
| ----- | -------------------------------------------------------------------- |
| 3     | Normal operation                                                     |
| 2     | Staff commands and private appeals only. Public commands are blocked |
| 1     | Only critical controls for the owner and Administrators              |

Use `!defcon status`, `!defcon diagnose` and `!defcon set 1|2|3`. At level 2 or below, scheduled posts, birthday posts and suggestion cards wait until the level returns to 3

### Appeals

Members send appeals in a DM with the bot. Banned members can appeal too, when Fluxer delivers the DM

| Command                                                   | What it does                                     |
| --------------------------------------------------------- | ------------------------------------------------ |
| `!appeal cases`                                           | Lists the member's own cases                     |
| `!appeal submit 12 Please review this case`               | Appeals case 12                                  |
| `!appeal list`, `!appeal show 3`                          | Lists appeals or shows one                       |
| `!appeal withdraw 3`                                      | Withdraws an appeal                              |
| `!appeal review open`                                     | Staff: Lists appeals still waiting, oldest first |
| `!appeal approve 3 <reason>`, `!appeal reject 3 <reason>` | Staff: Decides an appeal                         |

Approving an appeal does not reverse the sanction. Staff reverse it separately, and the approval card names the commands to use

## Limits

- A reason is at most 512 characters and appeal text at most 2000
- Each case takes one open appeal per member and at most 20 appeals per member over time
- `!mod purge` with no member only previews. Send the same message with `confirm` added within 2 minutes to delete up to that many messages from every author
- The owner can erase a case's text with `!mod erase <case>` and choose who may read cases on the website with `!mod private-role @role`
- If Fluxer does not confirm an action, NeonFlux never repeats it. Check it with `!mod recover <case>`
- Cases and closed appeals are kept until erased, unless a retention period is set

The owner and members with the private data role read cases, appeals and member history in the dashboard under **Private cases**. The website records every view in its audit log
