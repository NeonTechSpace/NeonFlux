---
title: Security alerts
description: Tells staff about new invites, bots, webhooks, risky permission changes and lookalike names, and can act on some of them
---

Security alerts report changes that often come before a raid or a takeover. Every alert starts off, and NeonFlux only reports unless staff turn on an alert's action. Alerts arrive as records in the `security` category of the [channel logs](./logs.md)

## How it works

| Alert           | What it reports                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `invites`       | Each invite created or deleted, with its code, channel and creator. Invites that never expire or have unlimited uses are flagged |
| `bots`          | A bot that joins and is not marked expected                                                                                      |
| `webhooks`      | A webhook that is created or changed and is not marked expected, with who did it                                                 |
| `privileges`    | A role created or changed to hold a dangerous permission, or a member given such a role, with who made the change                |
| `impersonation` | A member whose name looks like the owner's name or a staff member's name                                                         |

The dangerous permissions are Administrator, Manage community, Manage roles, Manage channels, Manage webhooks, Ban members, Kick members and Time out members

Impersonation folds accents, case and lookalike letters before comparing, so `0` for `o` or a Cyrillic `а` still matches. Names that match, or are one or two edits apart on longer names, raise one alert per member and name

### Actions

Some alerts can also act. Every action starts off and runs only while its alert is on:

| Action                     | What NeonFlux does                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kick unexpected bots       | Kicks a bot that joins and is not marked expected. Needs Kick members and a role above the bot                                                                   |
| Delete unexpected webhooks | Deletes a newly created webhook that is not expected, unless the owner, NeonFlux or an expected bot made it. Needs Manage webhooks                               |
| Remove gained permissions  | Removes permissions an audit entry added to a role, unless the owner, NeonFlux or an expected bot made the change. Needs Manage roles and a role above that role |

A member given a role is only reported, never removed. A change with no known actor is only reported. NeonFlux tries each action once and never repeats an uncertain one, so when a result reads `uncertain`, check the server by hand

## Set it up

1. Turn on metadata logs with `!logs metadata module on`, then send the `security` category to a channel only staff can read with `!logs metadata route security #staff-alerts on`. Invite logs show invite codes, which let anyone join
2. Turn on the alerts wanted with `!alerts on invites`, or `!alerts on all`
3. Mark known bots and webhooks as expected with `!alerts expect bot <ID>` and `!alerts expect webhook <name>`
4. Optionally turn an action on with `!alerts action bots on`. This needs the server owner or an Administrator
5. Check `!alerts status`

The dashboard has the same settings under **Security alerts** in the Moderation group, with a second switch under bots, webhooks and privileges for the action. The permissions and the **Expected bots** and **Expected webhooks** lists are there as well

## Example

```text
Sam: !alerts on bots
Sam: !alerts expect bot 123456789012345678
Sam: !alerts action bots on
Sam: !invites list
```

A bot that is not on the expected list then joins. NeonFlux posts an alert in the security log channel and, because the action is on, kicks the bot

## Commands

| Command                                                                   | What it does                                                                      |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `!alerts status`                                                          | Shows which alerts and actions are on and how many bots and webhooks are expected |
| `!alerts on\|off invites\|bots\|webhooks\|privileges\|impersonation\|all` | Turns alerts on or off                                                            |
| `!alerts expect\|unexpect bot <ID>...`                                    | Marks bots as expected, or stops. Several IDs work at once                        |
| `!alerts expect\|unexpect webhook <name>\|<ID>...`                        | Marks webhooks as expected, or stops                                              |
| `!alerts expected [next]`                                                 | Lists the expected bots and webhooks                                              |
| `!alerts action bots\|webhooks\|privileges on\|off`                       | Turns an alert's action on or off                                                 |
| `!invites list [next]`                                                    | Lists invites with code, channel, creator, uses, expiry and flags                 |
| `!invites revoke <code>`                                                  | Deletes one invite. Members who joined with it stay                               |

## Limits

- All commands need the server owner, an Administrator or Manage community
- Turning an action on needs the owner or an Administrator. Any manager can turn one off
- Webhook and privilege alerts need View activity log, and invite lists need Manage community
- Reading webhooks by name needs Manage webhooks
- Up to 8,192 bots and 8,192 webhooks can be marked expected
- `!invites revoke` takes the code exactly as the list shows it, since codes differ by case
- An alert does nothing while metadata logs are off
