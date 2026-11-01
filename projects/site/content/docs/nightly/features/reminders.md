---
title: Personal reminders
description: Members ask NeonFlux to remind them of something later, by DM
---

A member asks NeonFlux to send them a reminder later, and it arrives by DM. The feature is on by default, since it needs no setup and posts nothing while the member's DMs are open

Staff see nothing about a member's reminders

## How it works

A duration is written like other durations, such as `30m`, `12h` or `1d12h`, from 1 minute to 1 year. Each member's reminders have numbers of their own, and `!remind list` goes by DM because the text is the member's

- A reminder goes out a few seconds after its time while the bot runs. One that comes due while the bot is down goes out once it is back
- A member who left is skipped and the reminder is deleted
- A reminder is claimed before it is sent and is never sent twice. An unknown outcome stays listed as not confirmed
- While reminders are off or DEFCON is below 3, delivery waits and resumes after. While off, members cannot set new ones and can still list and cancel theirs

### When the DM is refused

When Fluxer refuses the DM, NeonFlux posts one message in the channel the reminder was set in, naming the member with a mention that does not notify. It does so only when the channel still exists, it can post there and the [automod](./automod.md) content rules would let the text through. Otherwise the reminder stays listed as undelivered

A rate limit or a connection failure sends nothing to the channel, and the reminder is tried again a minute later

## Set it up

There is nothing to set up. The server owner, Administrators and members with Manage community can turn it off or change the limit, and the dashboard has the same settings under **Personal reminders** in Community

## Example

```text
Rin: !remind 2h take out the bins
Rin: !remind list
Rin: !remind cancel 1
```

## Commands

| Command                     | What it does                                           |
| --------------------------- | ------------------------------------------------------ |
| `!remind <duration> <text>` | Set a reminder                                         |
| `!remind list [next]`       | List your reminders on this server, by DM              |
| `!remind cancel <number>`   | Cancel one                                             |
| `!remind settings`          | See whether reminders are on and the limit             |
| `!remind module on\|off`    | Turn reminders on or off                               |
| `!remind limit <number>`    | Set how many reminders each member keeps, from 1 to 25 |

Commands work in a server channel, and a DM gets one line saying so

## Limits

- Text holds up to 500 characters, and is sent with no ping
- Up to 25 reminders per member on a server, and 5,000 per server. Uncertain and undelivered ones count until they go
- Delivered and cancelled reminders are deleted. Uncertain and undelivered ones expire after 30 days, and so does a reminder held for 30 days past its time
- A member can delete them with [`!mydata`](./your-data.md)
- Tested against Fluxer: Delivery by DM, the list by DM and cancelling
- Not tested against Fluxer yet: A refused DM's post in the channel
