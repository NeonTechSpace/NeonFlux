---
title: Command rules
description: Limit a built-in command to certain channels or roles
---

A rule limits where a built-in command works and who can use it, such as `!rank` only in #bot-commands. Server owners and members with Administrator or Manage community manage rules

## How it works

A rule names a command as members type it, such as `rank`, `leaderboard` or `level`. A rule on a command covers all its forms, so one on `voice` covers `!voice lock` too. `!rank` and `!level` are separate commands, each with its own rule

- Rules never apply to the server owner or Administrators, or to commands in a DM
- A thread or forum post counts as its parent channel
- A refused command answers one line, such as `!rank works in #bot-commands`, at most once per member and command per minute
- Help and typo hints still list a limited command
- Website pages and voice room controls cards are not commands, so rules do not limit them

### Commands a rule cannot limit

These always work, so a rule cannot lock staff out of safety and setup:

`!commands`, `!help`, `!prefix`, `!defcon`, `!security`, `!mod`, `!automod`, `!lockdown`, `!antinuke`, `!jail`, `!appeal`, `!logs`, `!alerts`, `!invites`, `!recovery`, `!setup`, `!health`, `!preset`, `!backup`, `!export`, `!ticket`, `!verify`, `!milestone`, `!cleanup` and `!mydata`

A form DEFCON treats as critical, such as turning a feature off, ignores the rule too

## Set it up

1. Pick the command as members type it
2. Send `!commands rule <command> channels #a #b`, `!commands rule <command> roles @a @b`, or both
3. Check with `!commands show <command>`

The dashboard has the same rules under **Command rules** in Community. A chat change applies at once, and a dashboard change with the next command after the bot applies it, or within 30 seconds if that fails

## Example

```text
Sam:  !commands rule rank channels #bot-commands
Sam:  !commands rule giveaway roles @Events
Rin:  !rank
NeonFlux: !rank works in #bot-commands
```

## Commands

| Command                                   | What it does                                                 |
| ----------------------------------------- | ------------------------------------------------------------ |
| `!commands rule <command> channels #a #b` | The command works only in these channels, replacing the list |
| `!commands rule <command> roles @a @b`    | Only these roles can use it, replacing the list              |
| `!commands rule <command> channels all`   | Remove the channel limit                                     |
| `!commands rule <command> roles all`      | Remove the role limit                                        |
| `!commands rule <command> clear`          | Remove the rule                                              |
| `!commands rules [next]`                  | The server's rules, eight to a page                          |
| `!commands show <command>`                | One command's rule                                           |

## Limits

- Up to 25 rules per server, each with up to 500 channels and 250 roles
- `commands` is a reserved name, so a [custom command](./custom-responses.md) with that name no longer runs
- A role rule reads the copy of the member the bot holds
- A rule naming a category never matches, and a rule naming a deleted channel refuses until it is changed
- Tested on a real member at the real command check: Channel and role rules, the owner's exemption and refusing a rule on `!mod`. A test script sent the commands
- Not tested against Fluxer yet: A person typing a command that a rule refuses
