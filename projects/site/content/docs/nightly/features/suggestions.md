---
title: Suggestions
description: Members post ideas as numbered cards that others vote on and staff move through states with a public reason
---

Members submit suggestions, NeonFlux posts each one as a card in a channel and members vote with 👍 or 👎. Staff set a state such as planned or declined and give a public reason. The module starts off

## How it works

- Each suggestion gets a number and a card showing the author, state, vote totals and the latest reason
- NeonFlux adds 👍 and 👎 to each new card. Members vote by reacting or with `!suggest vote`
- Adding 👎 while holding 👍 switches the vote. Taking the last reaction away clears a vote a reaction set
- A vote sent as a command stays until the member clears it or reacts again
- States are `under-review`, `planned`, `completed` and `declined`. Under review and planned suggestions take votes. Completed and declined ones close voting and can be reopened with a reason
- When someone other than the author changes the state, NeonFlux sends the author a DM with the new state and the reason
- Authors can withdraw a suggestion for good. Withdrawn suggestions stay closed

The destination can be a forum or media channel. Each suggestion then becomes its own forum post whose first message is the card, and the post is the place to discuss it

## Set it up

1. Choose the channel with `!suggest configure #suggestions`
2. Turn it on with `!suggest enable`
3. Check the settings with `!suggest settings`

The dashboard has the same settings under **Suggestions** in the Community group. Setup needs the server owner or an Administrator

For a forum destination:

- Deny members Send messages in the forum, so only NeonFlux starts posts
- Allow Send messages in threads, so members can discuss
- Pin a post that explains how to suggest. Members can run `!suggest submit` in any post
- NeonFlux adds the status tags the forum lacks, which needs Manage channels. A forum holds at most 20 tags
- Status tags must not be moderated

## Example

```text
Jo: !suggest submit "Add a movie night voice channel"
NeonFlux: Posts card #12 in #suggestions with 👍 and 👎

Alex reacts with 👍
Mara: !suggest vote 12 up

Sam: !suggest status 12 planned Ships next week
```

Jo gets a DM that reads `Your suggestion #12 in My Server is now planned. Reason: Ships next week`

## Commands

For members:

| Command                                  | What it does                                                      |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `!suggest submit "text"`                 | Posts a suggestion of up to 2000 characters                       |
| `!suggest show <number>`                 | Shows the text, author, state, counts and card status             |
| `!suggest list [state] [next]`           | Lists up to ten suggestions                                       |
| `!suggest vote <number> up\|down\|clear` | Sets, changes or clears the member's vote                         |
| `!suggest mine <number>`                 | Shows the member's own vote                                       |
| `!suggest withdraw <number> [confirm]`   | Withdraws a suggestion. Author only. Asks first without `confirm` |

For staff:

| Command                                                                        | What it does                                                      |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `!suggest status <number> under-review\|planned\|completed\|declined <reason>` | Changes the state with a public reason of up to 500 characters    |
| `!suggest publication <number>`                                                | Shows whether the card was posted                                 |
| `!suggest reconcile\|replace <number> [confirm]`                               | Rechecks a card, or replaces one confirmed missing                |
| `!suggest recount <number> [next]`                                             | Counts the card's votes again, such as after NeonFlux was offline |
| `!suggest forget <number> [confirm]`                                           | Removes settled closed suggestion data. Posted cards stay         |
| `!suggest disable`                                                             | Stops submissions, votes and cards and keeps the data             |

For the owner and Administrators:

| Command                                | What it does                                                 |
| -------------------------------------- | ------------------------------------------------------------ |
| `!suggest configure #channel\|none`    | Sets the channel. `none` clears it and turns suggestions off |
| `!suggest enable`, `!suggest settings` | Turns suggestions on, or shows the settings                  |

## Limits

- Cards update in groups about every five seconds. A card can lag behind the recorded state, so check `!suggest publication` before recovery
- At DEFCON 1 or 2 card updates wait and go out once DEFCON is 3
- A reaction changed while NeonFlux is offline counts at the member's next reaction change, or when staff run `!suggest recount`
- Self-votes count, and votes stay after the voter leaves. There is no public voter list
- Closed suggestions expire after 180 days
- The limits are 1000 staff commands and 10000 member commands a day per server
- Only the latest status reason, actor and time are kept
- Editing or deleting a command message does not change the recorded text or vote
