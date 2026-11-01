---
title: Welcome and goodbye
navTitle: Welcome
description: Greets new members in a channel or by DM, says goodbye when they leave and can add a newcomer checklist
---

NeonFlux offers a welcome in a channel, a private DM and a goodbye in a channel. Each one is written as a publishing template, so staff edit the text without touching the greeting settings. A newcomer checklist can ride along with the welcome or the DM

## How it works

- Every greeting starts off and applies only to human members
- Enabling one does not greet existing members
- The bot greets a join only when it sees the join within 15 minutes
- `join` timing greets at once. `verified` waits until the member accepted the rules and holds the access role, see [Verification](./verification.md)
- Goodbye is sent when a member leaves, and cannot tell a voluntary exit from a kick or a ban
- A join or departure while DEFCON is below 3, or while the member is quarantined, gets no greeting
- A greeting whose outcome Fluxer did not confirm is never sent again

Each greeting follows its template by name. An edit to the template reaches the next greeting. If the template is deleted or an edit makes it invalid for that greeting, NeonFlux sends the copy saved when the greeting was configured

### Placeholders

| Placeholder      | Fills in                                                   |
| ---------------- | ---------------------------------------------------------- |
| `{user.name}`    | The member's name                                          |
| `{user.mention}` | A mention of the member, which notifies only that member   |
| `{user.id}`      | The member's ID                                            |
| `{server.name}`  | The server's name                                          |
| `{server.id}`    | The server's ID                                            |
| `{channel.id}`   | The greeting channel's ID. Works only in channel greetings |

## Set it up

1. Write the message as a template, for example `!publish template create arrival` and `!publish template set arrival content "Welcome {user.mention} to {server.name}"`
2. Set the channel welcome with `!welcome configure arrival #welcome join`
3. Optionally write two more templates the same way, named `private_arrival` and `departure`. Then set a DM greeting with `!welcome dm configure private_arrival verified` and a goodbye with `!goodbye configure departure #departures`
4. Preview each one with `!welcome preview`, `!welcome dm preview` or `!goodbye preview`. Each posts a sample in the current channel with the sender's details, so use a staff channel
5. Turn each on with `!welcome module on`, `!welcome dm module on` and `!goodbye module on`

The dashboard has the same settings under **Greetings** in the Messaging group

## Example

```text
Sam: !welcome configure arrival #welcome join
Sam: !welcome module on

Jo joins the server
#welcome: Welcome @Jo to Pixel Camp
```

## Commands

Each of `!welcome`, `!welcome dm` and `!goodbye` takes the same forms

| Command                                                 | What it does                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `!welcome configure <template> #channel join\|verified` | Sets the channel welcome and when it goes out                       |
| `!welcome dm configure <template> join\|verified`       | Sets the DM greeting                                                |
| `!goodbye configure <template> #channel`                | Sets the goodbye                                                    |
| `!welcome module on\|off`                               | Turns a greeting on or off. Same form for `dm` and `!goodbye`       |
| `!welcome preview`                                      | Sends a sample in the current channel                               |
| `!welcome show`, `!welcome status <number>`             | Shows the settings, or one greeting from the history                |
| `!welcome history [next]`                               | Lists recent greetings of every route                               |
| `!welcome member @user`                                 | Shows when a member joined and whether they are still in the server |
| `!welcome clear`                                        | Removes the greeting's settings                                     |
| `!welcome rate <1-60>`                                  | Sets greetings sent a minute across all routes, 10 by default       |
| `!welcome retention <30-3650>`                          | Sets how many days history is kept, 30 by default                   |

Owners and Administrators configure greetings

### Newcomer checklist

A checklist of up to five steps guides new members through features the server already uses. It starts off and is added to the end of the greeting it is set to, so that greeting must be configured and on

Members finish each step through the feature it names:

| Step                   | How a member finishes it                                                    |
| ---------------------- | --------------------------------------------------------------------------- |
| `rules`                | Accepts the current rules, see [Verification](./verification.md)            |
| `panel <name>`         | Holds a role from that reaction role panel                                  |
| `menu <name>`          | Holds a role from that role picker menu                                     |
| `link #channel "line"` | Needs no finishing. Points to a channel with a line of up to 100 characters |

A step whose panel, menu or rules verification is not published or is off is left out until it is back. See [Roles](./roles.md) for panels and menus

Set the checklist up with these steps:

1. Add steps with `!onboarding add rules`, `!onboarding add panel colors`, `!onboarding add menu languages` or `!onboarding add link #introductions "Say hello and share a favorite game"`
2. Optionally set a role for finishers with `!onboarding role @Settled`
3. Choose the greeting that carries it with `!onboarding delivery welcome` or `!onboarding delivery dm`
4. Turn it on with `!onboarding on`

The dashboard has the same settings under **Newcomer checklist** in the Roles group

| Command                         | What it does                                      |
| ------------------------------- | ------------------------------------------------- |
| `!onboarding`                   | Shows the member's own checklist and what is left |
| `!onboarding status`            | Shows the checklist as configured                 |
| `!onboarding remove <position>` | Removes a step                                    |

A member finishes the checklist once per membership. The completion role follows the same rules as other roles NeonFlux gives, and it is never removed afterwards. A member who is timed out, quarantined or has not accepted configured rules cannot receive it

## Limits

- A greeting message is at most 2,000 characters. If filled-in placeholders make it longer, the parts that grew are cut back to their template length
- While DEFCON is below 3, a queued greeting waits and is checked again every ten minutes. It goes out once DEFCON is 3 again, if its 24 hours have not passed
- A greeting that waits for rules verification keeps the text rendered when the member joined
- At DEFCON 2, members cannot use `!onboarding`
