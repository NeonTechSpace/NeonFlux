---
title: Server modes
description: Choose between serving one server and running a public bot for many
---

A deployment runs in single mode or multi mode. The Convex deployment owns this choice, and the bot adopts it at startup

## How to choose

- **Single mode:** For one community running its own bot. The bot answers only in the named server. This is the default
- **Multi mode:** For a public bot that anyone can add. It serves every server it is in, with no server list and no server limit

## Set single mode

In the Convex deployment:

1. Set `NEONFLUX_SERVER_ID` to the server's decimal ID
2. Leave `NEONFLUX_SERVER_MODE` unset, or set it to `single`
3. Restart the bot

## Set multi mode

In the Convex deployment:

1. Remove `NEONFLUX_SERVER_ID`
2. Set `NEONFLUX_SERVER_MODE` to `multi`
3. Restart the bot

The bot refuses to start while its own environment sets either variable

## What differs

|                           | Single mode                                           | Multi mode                                                                               |
| ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Servers                   | The one in `NEONFLUX_SERVER_ID`                       | Every server the bot is in                                                               |
| Adding the bot            | [Invite link](./bot.md#create-the-fluxer-application) | The dashboard's **Add NeonFlux to a server**, or the same link                           |
| Dashboard opens on        | The configured server                                 | A server picker                                                                          |
| Note on joining           | None                                                  | One short note naming `!help`, `!setup` and the dashboard link                           |
| Bot presence              | DEFCON level, and the custom status at DEFCON 3       | Only the custom status                                                                   |
| Commands in a DM          | Sent as they are                                      | Add `--server <server ID>` after the command name, such as `!backup --server 123 status` |
| Bot removed from a server | Data is never purged                                  | Data stays for 30 days, then the backend deletes it                                      |

## What stays the same in multi mode

One bot token, one process and one backend serve every server. Each server still has its own settings, queues and DEFCON level, and membership or permissions in one server grant nothing in another

Adding the bot back within the 30 days restores the server's data. After that it starts with no data

All servers share one bot API secret, so anyone holding that secret can reach every server's data. Server administrators cannot change credentials or registrations
