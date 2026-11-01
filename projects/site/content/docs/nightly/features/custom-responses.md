---
title: Custom responses
description: Custom commands and automatic replies, plus the prefix, reply style, nickname and AFK basics
---

Custom commands answer a command the server invents, such as `!rules`. Autoresponders answer when a message matches a word or phrase. This page also covers the basic settings that shape how the bot talks: Prefix, reply style, nickname, AFK and ping

## How it works

The server owner and members with Administrator manage definitions with `!custom` and `!auto`. A definition has a name, a response and optional limits on channels, roles and cooldown

- A **custom command** answers `!name`, with `{args}` standing for whatever follows the command
- An **autoresponder** answers any message equal to its trigger (`exact`) or containing it (`contains`), ignoring letter case
- Messages that start with the server's prefix never trigger autoresponders
- When several autoresponders match, the higher priority wins, then `exact` before `contains`, then name order, and a message gets one response at most

A response is text or a basic embed with a title, description and color. These placeholders fill in when it is sent:

| Placeholder      | Becomes                                               |
| ---------------- | ----------------------------------------------------- |
| `{user.name}`    | The member's name                                     |
| `{user.id}`      | The member's ID                                       |
| `{user.mention}` | A mention of the member                               |
| `{channel.id}`   | The channel's ID                                      |
| `{server.id}`    | The server's ID                                       |
| `{args}`         | The words after the command, empty for autoresponders |

A response is reserved before it is sent. A failed or uncertain send still uses that message and cooldown, and nothing is resent

### Basic settings

- **Prefix**: Owners and members with Manage community change it with `!prefix <value>`. It is one to five of `! $ % & * + , . ? ~ ^ | : / -`, and `!prefix` always works, so a forgotten prefix can be recovered
- **Reply style**: `!replies embed` or `!replies text` chooses whether status, detail and list replies are embeds, the default, or plain text. Short confirmations and errors are plain in both
- **Nickname**: `!nickname set <name>` changes the bot's display name in the server, and `!nickname reset` removes it. It needs the Change own nickname permission for the bot
- **AFK**: `!afk` sets the reason `Away`, and `!afk Lunch` sets a custom reason. The member's next message clears it, and the bot tells others who mention an away member
- **Ping**: `!ping` checks that the bot answers

A prefix change in chat applies at once, and one from the dashboard applies within 30 seconds

## Set it up

1. Open **Custom commands** or **Autoresponders** in the dashboard for the server, or use the chat commands below
2. Create a definition with a name and a response
3. Optionally limit it to channels or roles, and change the cooldown
4. Turn the module on with `!custom module on` or `!auto module on`
5. Check an autoresponder without posting using `!auto test <text>`

The prefix, reply style and nickname live in the **General** section of the dashboard

## Example

```text
Mod:   !custom create rules text "Read the rules: {args}"
Mod:   !custom module on
Rin:   !rules in #welcome
Bot:   Read the rules: in #welcome

Mod:   !auto create greeting exact "hello" text "Hello {user.name}"
Mod:   !auto module on
Sam:   hello
Bot:   Hello Sam
```

## Commands

Use `!auto` in place of `!custom` for autoresponders. Quote text that contains spaces

| Command                                                       | What it does                                            |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| `!custom create <name> text "reply"`                          | Make a custom command                                   |
| `!auto create <name> exact\|contains "trigger" text "reply"`  | Make an autoresponder                                   |
| `!custom create <name> embed "Title" "Description" "#3d66b8"` | Make one that answers with an embed                     |
| `!custom show <name>`, `!custom list [next]`                  | Inspect or list definitions                             |
| `!custom update <name> response text "..."`                   | Replace the response                                    |
| `!custom update <name> channels #general #help`               | Limit to channels, or `channels all` to clear           |
| `!custom update <name> roles @Member`                         | Limit to roles                                          |
| `!custom update <name> cooldown 30`                           | Set the cooldown in seconds                             |
| `!auto update <name> trigger contains "hello"`                | Change the trigger                                      |
| `!auto update <name> priority 10`                             | Change the priority                                     |
| `!custom enable\|disable <name>`                              | Turn one definition on or off                           |
| `!custom module on\|off`                                      | Turn the module on or off                               |
| `!custom delete <name>`                                       | Delete a definition                                     |
| `!auto test <text>`                                           | Show which autoresponder would answer, and send nothing |
| `!prefix [value]`                                             | Show or change the prefix                               |
| `!replies [embed\|text]`                                      | Show or change the reply style                          |
| `!nickname [set <name>\|reset]`                               | Show, set or remove the bot's nickname                  |
| `!afk [reason]`                                               | Set an away status                                      |
| `!ping`                                                       | Check that the bot answers                              |

`!custom help all` and `!auto help all` list the remaining forms

## Limits

- Names have 1 to 32 lowercase letters, digits, underscores or hyphens
- Built-in command names, such as `help`, `health` and `setup`, are reserved
- A server stores up to 100 definitions across both kinds
- Triggers have 1 to 200 characters
- Text responses have 1 to 2000 characters, and embed titles up to 256 and descriptions up to 4000
- Channel limits take up to 500 channels and role limits up to 250 roles
- Cooldowns default to 5 seconds for each definition and member, and take 0 to 3600
- Priority runs from -100 to 100, with 0 as the default
- A nickname has 1 to 32 characters
- An AFK reason has up to 200 characters
- Unknown placeholders are rejected
