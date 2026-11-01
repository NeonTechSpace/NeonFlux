---
title: Birthdays and anniversaries
navTitle: Birthdays
description: Members opt in to a public birthday or membership anniversary post in a celebrations channel
---

Members choose to have a public post on their birthday or on the day they joined the server. Birthdays use only the month and day, with no year and no age. Anniversaries use the member's real join time, never a date they supply

## How it works

- Members opt in with `!milestone` in a DM with NeonFlux. Staff cannot enroll members or list birthday dates
- Consent names the public channel the post goes to. If staff change the channel, members must opt in again
- Posts go out at a configured local time in a time zone chosen for the route
- A birthday on February 29 is celebrated on February 28 in other years
- Anniversaries count completed years from one
- Leaving the server ends consent
- A member can also show the month and day of their own birthday on their [profile](./profiles.md)

The module and both routes start off, and publishing must be on too

## Set it up

1. Write a template for each post with `!publish template create birthday` and `!publish template set birthday content "Happy birthday {user}"`. An anniversary template may also use `{years}`
2. Set up the route with `!milestone configure birthday #celebrations Europe/Berlin 09:00 reject template birthday`. The words `earlier` and `later` choose which one is used when a clock change makes that time happen twice, and `reject` skips the post that day. A time that does not exist on a clock change is skipped with any of the three
3. Preview it with `!milestone preview birthday`, which answers privately
4. Turn it on with `!milestone enable birthday` and `!milestone module on`
5. Repeat for `anniversary` if wanted
6. Tell members to send `!milestone help` in a DM with NeonFlux

The dashboard has the same settings under **Milestones** in the Community group. Setup needs the server owner or an Administrator

## Example

```text
Jo (in a DM with NeonFlux): !milestone birthday set 02-29 confirm #celebrations
Jo (in a DM with NeonFlux): !milestone anniversary on confirm #celebrations
Jo (in a DM with NeonFlux): !milestone me
```

On the day, NeonFlux posts the birthday template in #celebrations at the configured time. The post never shows a date or an age

## Commands

Members use these in a DM with NeonFlux:

| Command                                          | What it does                          |
| ------------------------------------------------ | ------------------------------------- |
| `!milestone me`                                  | Shows what the member signed up for   |
| `!milestone birthday set MM-DD confirm #channel` | Signs up for a birthday post          |
| `!milestone anniversary on confirm #channel`     | Signs up for an anniversary post      |
| `!milestone remove [birthday\|anniversary]`      | Removes a sign-up and the stored date |

Staff use these:

| Command                                                                                                   | What it does                                     |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `!milestone configure birthday\|anniversary #channel <zone> HH:mm earlier\|later\|reject template <name>` | Sets a route                                     |
| `!milestone enable\|disable\|clear birthday\|anniversary`                                                 | Controls one route                               |
| `!milestone module on\|off`                                                                               | Turns birthdays and anniversaries on or off      |
| `!milestone preview birthday\|anniversary`                                                                | Previews the post privately                      |
| `!milestone status [birthday\|anniversary]`                                                               | Shows the settings, or recent posts of one route |
| `!milestone reconcile birthday\|anniversary <post>`                                                       | Rechecks a post Fluxer did not confirm           |

## Limits

- A personal command sent in a server channel gets private instructions and is not stored, but the message itself stays visible
- Replies and previews are private, and posts suppress mentions
- Posts need NeonFlux's permissions in the channel, publishing on and DEFCON 3. A post due at DEFCON 1 or 2 waits and sends once DEFCON is 3 on its local day
- A late delivery still sends until local midnight, and a missed day does not use up that year's birthday
- Enrolling skips a celebration that is already due
- A server allows at most 1000 enrolled accounts
- Removal deletes the enrollment and stored date. Posts already sent stay
- If a template is deleted or becomes invalid, such as `{years}` in a birthday template, the route sends the copy saved when it was configured
