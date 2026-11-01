---
title: Giveaways
description: Post a giveaway card, let members enter by reacting and draw winners when the time ends
---

A giveaway is one card in a text or announcement channel. Members enter by reacting with 🎉, and NeonFlux draws winners when its time ends

## How it works

Entries live on Fluxer as reactions, so NeonFlux stores no entry and a reaction costs it nothing. At the draw NeonFlux:

1. Reads up to 5,000 entries
2. Leaves out bots, NeonFlux and earlier winners
3. Shuffles the rest with a cryptographic random source
4. Reads candidates fresh from Fluxer, in that order, and takes those who are still members and hold the required role

A candidate Fluxer does not answer for puts the whole draw off for a minute, so a failed read never costs anyone their entry

NeonFlux then edits the card to name the winners with mentions that do not notify, and tells each winner by DM what they won. A DM that fails stops nothing, and `!giveaway show` names the winners it did not reach

A reroll reads the reactions again, leaves out earlier winners and adds a line to the card. `cancel` edits the card and draws nothing

## Set it up

1. Give NeonFlux View channel, Send messages, Add reactions and Read message history in the channel
2. Optionally set a role winners must hold with `!giveaway role @role`
3. Start one with `!giveaway start`

The dashboard has the same settings and actions under **Giveaways** in Community

## Example

```text
Sam: !giveaway start 1d 2 #events Game key
Sam: !giveaway list
Sam: !giveaway end 1
Sam: !giveaway reroll 1
```

## Commands

| Command                                               | What it does                                       |
| ----------------------------------------------------- | -------------------------------------------------- |
| `!giveaway start <length> <winners> #channel <prize>` | Start one                                          |
| `!giveaway end <number>`                              | Draw the winners now                               |
| `!giveaway reroll <number> [count]`                   | Draw new winners, leaving out earlier ones         |
| `!giveaway cancel <number>`                           | Cancel a running giveaway                          |
| `!giveaway list [next]`                               | List them                                          |
| `!giveaway show <number>`                             | Show one with its winners and any problem          |
| `!giveaway settings`                                  | See whether giveaways are on and the required role |
| `!giveaway module on\|off`                            | Turn giveaways on or off                           |
| `!giveaway role @role\|none`                          | Set the role a member needs to win                 |

Every form except `help` needs the server owner, Administrator or Manage community. Settings changes and each start, end, reroll and cancel reach the audit log

## Limits

- Up to 25 running at once, each with 1 to 20 winners and a length of 1 minute to 60 days
- A prize holds up to 256 characters on one line, checked against the [automod](./automod.md) content rules
- Fluxer lists reactions by ascending account ID, so a giveaway past 5,000 entries counts the oldest accounts' entries. The card and `!giveaway show` say so
- A running giveaway keeps the required role it started with
- A giveaway records up to 50 winners
- A start is refused while giveaways or publishing are off or DEFCON is below 3. Draws of running giveaways wait and resume after
- A card post with an unknown outcome is never repeated, and `!recovery` shows the step that settles it
- A deleted card or channel ends the giveaway with a problem
- An ended or cancelled giveaway expires after 90 days
- Tested against Fluxer: The card and its entry emoji, a draw with no valid entry, a reroll and a cancel. From a simulated entry: A real member drawn as winner, the card edit and a real DM
- Not tested against Fluxer yet: A real member's reaction as an entry, and the 5,000 limit
