---
title: Counter channels
description: Keep a channel named with a live count, such as your member count
---

NeonFlux can keep a channel named with a live count, such as `Members: 120`. A counter renames an existing voice, text or announcement channel or category. It creates no channels

## How it works

- `members` shows the member count Fluxer reports
- `role` shows how many members hold a role, read from Fluxer's member search

NeonFlux checks each server's counters every 10 minutes, and once right after a change, and renames a channel only when the name would change

A rename refused because NeonFlux lacks the permission, or because the channel is gone, turns that counter off, posts one note in the server and adds a `!recovery` entry. A rename whose outcome is unknown is not repeated blindly, and the next check reads the channel and renames it only if the name still differs

A counter's own rename stays out of the [logs](./logs.md) when the name is the only change. Counters keep renaming while DEFCON holds other automation, since a rename posts nothing

## Set it up

1. Make or pick a channel, and give NeonFlux Manage channels
2. Send `!counter add members #channel "Members: {count}"`

A role counter needs NeonFlux to hold a permission Fluxer's member search takes: Manage community, Manage roles, Manage nicknames, Ban members, Kick members or Time out members. It is refused at `!counter add` otherwise

The dashboard has the same settings under **Counter channels** in Community

## Example

```text
Sam: !counter add members #stats "Members: {count}"
Sam: !counter add role @Staff #team "Staff: {count}"
Sam: !counter list
```

## Commands

| Command                                             | What it does                                           |
| --------------------------------------------------- | ------------------------------------------------------ |
| `!counter add members #channel "Members: {count}"`  | Keep a channel named with the server's member count    |
| `!counter add role @role #channel "Staff: {count}"` | Keep a channel named with how many members hold a role |
| `!counter set #channel "New name: {count}"`         | Change a counter's name and turn it back on            |
| `!counter remove #channel`                          | Stop renaming a channel, which keeps its name          |
| `!counter list`                                     | List every counter and whether it is on                |
| `!counter module on\|off`                           | Turn every counter on or off                           |

These need the server owner, Administrator or Manage community. Adding to a channel that has a counter replaces it

## Limits

- Up to 5 counters per server
- A name holds `{count}` and at most 100 characters, and the count shows plainly, with no separators
- There is no boost counter, since Fluxer exposes no boost count, and no online counter, since NeonFlux asks Fluxer not to send presence
- While Fluxer builds its member index, a role counter renames nothing
- A count or channel that cannot be read skips that check
- A role counter that loses access later stays on with its name, and `!counter list`, the dashboard and `!recovery` say why
- Tested against Fluxer: The member count, a role count, a real rename and its audit entry
- Not tested against Fluxer yet: A refused rename and an unknown outcome
