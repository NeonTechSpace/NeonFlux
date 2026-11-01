---
title: First steps
description: What to do first on a server that has NeonFlux
---

NeonFlux answers commands that start with a prefix, `!` by default. Most features start off, so a new server needs a few minutes of setup before much happens. Analytics and publishing start on. The steps below show how to find out what is on, what is missing and where to change it

## How it works

- Commands start with the server's prefix. Examples on these pages use `!`
- Members who do not know the prefix can mention the bot, as in `@NeonFlux help`
- Replies appear in the channel where the command was sent, so use a staff channel for setup
- Replies do not notify anyone, except the `!escalate` reply, which notifies the post's author
- The same settings exist in the dashboard, and a change made in either place shows in the other

## Who can use what

`!help` lists only the commands the member can use. What shows depends on the member's server permissions:

| Member                                                                                                        | Sees                                                                      |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Everyone                                                                                                      | Member commands such as `!help`, `!ping`, `!afk` and `!ticket`            |
| Kick members, Ban members, Time out members, Manage messages, Manage channels, Manage roles or Manage threads | Staff commands as well. Staff roles are still checked when a command runs |
| Manage community                                                                                              | `!setup`, `!health`, `!recovery`, `!preset` and `!stats`                  |
| Server owner and Administrators                                                                               | Every command                                                             |

Changing configuration usually needs the server owner or an Administrator. Each feature page names the exception

## Set it up

1. Send `!help` to see the groups of commands. Send `!help moderation`, or any feature name such as `!help tickets`, to open one
2. Send `!setup` to see which features are on, which are on but need a step and which are off
3. Send `!setup tickets`, or another feature name, to see that feature's state and its next step
4. Send `!health` to check that NeonFlux reaches Fluxer and its data service
5. Grant the permissions `!health permissions` names to the NeonFlux role, and move that role above the roles it should give out
6. Send `!health safety` to see risky role settings, each with its fix
7. Open the dashboard for the server and look at the **Overview**. It shows the same check under **Permission check**, with every section grouped by feature

In multi mode, the note NeonFlux posts when it joins a server names `!help`, `!setup` and the dashboard link. It goes to the server's system channel, or the first channel the bot can send in

Presets set several settings at once as a starting point. `!preset list` shows them, and applying one needs the server owner or an Administrator. The dashboard has the same list under **Setup presets**

## Example

```text
Mara: !setup tickets
NeonFlux: Tickets
          On, but it needs a step before it works
          Next: Create a category with `!ticket category create`
```

`!health` answers with a Health check card that has a Connection, Permissions and Safety line. A note under it names `!health permissions` or `!health safety` when there is something to list

## Commands

| Command                    | What it does                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `!help`                    | Lists the groups with a command the member can use                                    |
| `!help <group or feature>` | Lists that group's commands, such as `!help support`                                  |
| `!<command> help`          | Shows a command's most used forms, such as `!custom help`                             |
| `!setup`                   | Shows which features are on, need a step or are off                                   |
| `!setup <feature>`         | Shows one feature's state and next step                                               |
| `!health`                  | Sums up the connection, missing permissions and safety warnings                       |
| `!health permissions`      | Lists each missing permission and each role that ranks too high                       |
| `!health safety`           | Lists each safety warning with its fix                                                |
| `!recovery`                | Counts work that failed or needs a step in each area                                  |
| `!prefix`                  | Shows the prefix. The owner and Manage community can change it with `!prefix <value>` |
| `!preset list`             | Lists the setup presets                                                               |

A prefix is one to five of these characters: `! $ % & * + , . ? ~ ^ | : / -`. `!prefix` always works, so a forgotten prefix can be recovered

A mistyped command gets one reply naming up to five close matches, such as `!halp` pointing to `!help`

## Limits

- `!setup`, `!health` and `!recovery` need the server owner, Administrator or Manage community
- A list with more pages ends with a `Next` line. Send the same command with `next` at the end for the following page
- After a restart, lists start again from their first page
