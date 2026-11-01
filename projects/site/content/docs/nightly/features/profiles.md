---
title: Showcases and profiles
navTitle: Profiles
description: Members share what they made and describe themselves on the website, and NeonFlux posts and shows it in chat
---

Showcases let members post a project in a channel, and profiles let them keep a short bio. Members write both on the website, and NeonFlux posts the showcases itself. Both start off

## How it works

- A showcase has a title of up to 100 characters, text of up to 1,000 and up to 3 links
- NeonFlux posts it as an embed in the showcase channel with the member's server nickname or username
- The first HTTPS link to a PNG, JPEG, GIF or WebP image becomes the embed image. NeonFlux never fetches the image or hosts files
- Members edit and delete their own showcases on the website. An edit changes the posted message, and a deletion deletes it
- A profile has a bio of up to 300 characters, up to 3 links and an optional accent color
- `!profile` shows the member's own profile and `!profile @member` shows someone else's
- While leveling is on, a member with XP also shows their level and rank
- A member who signed up for a birthday post can choose to show its month and day on the profile. A profile never shows a year or an age

The server's automod rules for words, domains, invites and deceptive links read showcase and profile text before it is posted or saved, even in dry run. A match blocks it, and the member's request names the rule. See [Automod](./automod.md)

## Set it up

1. Choose the showcase channel with `!showcase channel #showcase`. NeonFlux needs View channel, Send messages and Embed links there
2. Optionally limit showcases a member may have with `!showcase limit 3`
3. Turn showcases on with `!showcase on`
4. Turn profiles on with `!profile on`
5. Tell members to open the dashboard for the server and use **Showcases** or **Your profile**

The dashboard has the same settings under **Showcases** and **Profiles** in the Community group. Setup needs the server owner or Manage community

## Example

```text
Sam: !showcase channel #showcase
Sam: !showcase limit 3
Sam: !showcase on
Sam: !profile on

Jo posts a showcase on the website
#showcase: NeonFlux posts an embed with Jo's title, text and image

Alex: !profile @Jo
NeonFlux: Shows Jo's bio, links and level in Jo's accent color
```

## Commands

| Command                                                                        | What it does                                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `!showcase list [@member]`                                                     | Lists showcases, or one member's. For everyone                      |
| `!showcase`, `!showcase help`                                                  | Shows the status or the help                                        |
| `!showcase on\|off`                                                            | Turns showcases on or off                                           |
| `!showcase channel #channel\|none`                                             | Chooses the channel                                                 |
| `!showcase limit <1-50>\|none`                                                 | Limits showcases per member                                         |
| `!showcase interval <30m, 2h or 1d>\|none`                                     | Sets the time between a member's showcases, from 1 minute to 7 days |
| `!showcase access allow\|block\|unallow\|unblock role\|user <mentions or IDs>` | Controls who may post                                               |
| `!profile [@member]`                                                           | Shows a profile. For everyone                                       |
| `!profile status`, `!profile help`                                             | Shows the status or the help                                        |
| `!profile on\|off`                                                             | Turns profiles on or off                                            |
| `!profile cooldown <seconds, or 30s, 5m or 1h>\|none`                          | Sets the time between a member's `!profile` commands                |
| `!profile access allow\|block\|unallow\|unblock role\|user <mentions or IDs>`  | Controls who may use profiles                                       |

## Limits

- A block always wins over an allow in the access lists. With no allowed roles or users, every member who is not blocked may use the feature
- The access lists decide who may save a profile, run `!profile` and whose profile it shows
- Members can send 5 requests a minute for each feature, with up to 2 pending at once. Requests expire after two minutes
- A showcase waits if Fluxer does not confirm it, and is never sent again. Staff check it with `!publish reconcile <post>`
- `!publish edit` and `!publish forget` refuse a showcase post, so only its author changes it
- Showcases already posted stay in their channel when the channel changes
- The profile cooldown is kept in memory, so a restart clears it
- Posting or editing a showcase needs DEFCON 3 and publishing on, which it is by default
