---
title: Jail
description: Take a member's roles and leave them one channel, then give the same roles back on release
---

A jail takes a member's roles and leaves them only the jail role, which is denied every channel except the jail channel. A release gives back the roles they had. Jail is off until a server sets it up

## How it works

`!jail setup` makes a role and a channel, or uses ones you name. NeonFlux then denies the role on every other channel the everyone role can view, and opens the jail channel to the jail role, moderation staff and NeonFlux

`!mod jail` is a moderation action like the others: It makes a case, reaches the staff log, sends the member a DM and can be appealed. A length is optional and uses the same units as a timeout, from a minute to a year. When it ends, NeonFlux releases the member

- A first jail stores the member's roles, and one edit sets them to the jail role alone
- A later jail of the same member changes only its length or reason
- `!mod unjail` sets the stored roles back in one edit. A role deleted meanwhile, or now ranked above NeonFlux, stays out, and the reply names it
- With Move members, a jail also disconnects the member from voice once. Without it they stay until they leave
- If NeonFlux cannot tell whether a jail or release went through, it never repeats it. `!mod recover <case>` reads the member and settles it

### While jailed

- The jail holds if the member leaves, and a member who rejoins goes straight back to the jail role
- Role features such as autorole, role panels, the role picker and level rewards skip them
- A role someone adds by hand is taken away again
- They can run only `!help`, `!ping`, `!appeal`, `!mydata` and `!ticket`. `!ticket` opens only a private ticket category
- On the website they cannot post or change a showcase, change their profile or control a voice room. They can still delete their own showcase

## Set it up

1. Give NeonFlux Manage roles and Manage channels, and keep it above the roles members hold
2. Send `!jail setup`, or `!jail setup #channel` to use a channel you already have
3. Send `!jail status` until it shows the channels are done, and fix any it could not change
4. Check that moderators who should jail people hold a moderation staff role and Manage roles, or the [jail right](./staff-rights.md)

Changing jail needs the server owner or an Administrator. The dashboard has the same settings under **Jail** in Moderation

The jail role must rank below NeonFlux, carry no permissions and not be a staff role. It cannot change while members are jailed

## Example

```text
Sam:  !jail setup
Sam:  !mod jail @Alex 1d Posting scam links
Sam:  !jail list
Sam:  !mod unjail @Alex Appeal accepted
```

## Commands

| Command                               | What it does                                            |
| ------------------------------------- | ------------------------------------------------------- |
| `!jail setup [#channel]`              | Make the role and channel, and close the other channels |
| `!jail role @role`                    | Use a role the server already has                       |
| `!jail channel #channel`              | Use a channel the server already has                    |
| `!jail status`                        | See setup progress and the channels it could not change |
| `!jail list [next]`                   | See who is jailed, in a staff channel or by DM          |
| `!jail module on\|off`                | Turn new jails on or off                                |
| `!mod jail @member [length] [reason]` | Jail a member                                           |
| `!mod unjail @member [reason]`        | Release a member                                        |

Turning jail off stops new jails only, and members already jailed stay held

## Limits

- It refuses the owner, Administrators, higher-ranked members and NeonFlux, and any member holding a role that ranks above NeonFlux
- A moderator must outrank the stored roles to change or end a jail, so a low-ranked moderator cannot hand a senior member their roles back
- A channel created while the bot was down stays open until the next start
- A member who rejoins while the bot is down is held when they next change or rejoin
- A member overwrite added by hand beats the role's denial. That includes a voice room they hid or locked before the jail, until the room goes
- A public ticket already open lets them keep posting there until staff run `!ticket close <number>`
- A looking for group room they belong to stays open to them until the room goes
- A new or newly public channel gets the denial 15 seconds after its event, so it is visible to a jailed member until then
- A role removed from moderation staff keeps its access to the jail channel until someone removes it
- A backup restore can remove the jail role's denial from a channel. The channel's update event adds it back
- Deleting the jail role leaves its overwrites on each channel, where they do nothing
- Tested against Fluxer: Setup on real channels
- Not tested against Fluxer yet: Jailing and releasing a real member
