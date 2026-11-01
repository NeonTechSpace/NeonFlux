---
title: Forum help desk
navTitle: Help desk
description: Greets new help posts in a forum, closes them when solved, posts saved answers and warns staff before the thread limit
---

The help desk serves forum or media channels that a manager picks. Each new post gets a short greeting, the author or staff close it with `!solved`, and staff post saved answers. An author whose post got no reply gets one reminder

## How it works

- A new post in a help desk forum gets the greeting and, later, at most one reminder
- `!solved` applies the solved tag and closes the post. Any message reopens a closed post
- `!answer <name>` posts a saved answer in the current post
- `!escalate <ticket-category>` opens a [ticket](./tickets.md) for the post's author, with the post linked in the ticket
- A thread budget guard warns staff before the server reaches Fluxer's limit of 1,000 active threads
- Managers are the server owner and members with Administrator or Manage community. Help desk staff also include members with Manage threads

The reminder goes to the author, mentioning only them. It is skipped when the post is closed, locked or deleted, or when someone other than the author and bots has written there, including staff commands

## Set it up

1. Add a forum with `!helpdesk forum add #help`. The reply names any permission NeonFlux lacks there
2. Add a tag named `Solved` in the forum's settings, or choose another name with `!helpdesk tag "Answered"`
3. Set a greeting with `!helpdesk greeting "Thanks for posting, someone will reply soon"`
4. Optionally set the reminder wait with `!helpdesk nudge 24`
5. Optionally choose a staff channel for thread warnings with `!helpdesk guard #staff-alerts`
6. Save answers with `!answer set rules "Server rules" "Please read #rules first"`

The dashboard has the same settings and the saved answers under **Help desk** in the Community group

## Example

```text
Jo opens a new post in #help
NeonFlux (in the post): Thanks for posting, someone will reply soon

Sam (in the post): !answer rules
NeonFlux (in the post): Posts the saved answer titled "Server rules"

Jo (in the post): !solved
```

NeonFlux replies first, then closes the post with the solved tag

## Commands

| Command                                                                      | Who                | What it does                                                  |
| ---------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------- |
| `!helpdesk`                                                                  | Manager            | Shows the settings and the server's active thread count       |
| `!helpdesk forum add\|remove #forum`                                         | Manager            | Chooses the forums the help desk serves                       |
| `!helpdesk greeting "text"\|off`                                             | Manager            | Sets the greeting on each new post                            |
| `!helpdesk tag "name"`                                                       | Manager            | Sets the tag `!solved` applies                                |
| `!helpdesk nudge <1-168>\|off`                                               | Manager            | Sets hours without a reply before the reminder, 24 by default |
| `!helpdesk guard #staff-channel\|off`                                        | Manager            | Warns staff in this channel near the thread limit             |
| `!helpdesk archive on\|off`                                                  | Manager            | Gives threads their channel's default auto-archive time       |
| `!solved`                                                                    | Post author, staff | Applies the solved tag and closes the post                    |
| `!answer <name>`                                                             | Staff              | Posts a saved answer                                          |
| `!answer list`, `!answer set <name> "title" "text"`, `!answer remove <name>` | Staff              | Manages saved answers                                         |
| `!escalate <ticket-category>`                                                | Ticket staff       | Opens a ticket for the post's author                          |

## Limits

- Up to 10 forums, 50 saved answers and a greeting of 1 to 500 characters
- NeonFlux needs View channel, Send messages in threads, Read message history and Manage threads in each help desk forum
- `!solved` needs a tag of the configured name in the forum, matched exactly or else without regard to case. A post holds at most five tags
- Saved answer names use lowercase letters, digits, `-` and `_`. Titles are 1 to 100 characters and text 1 to 2000. Mentions in answers notify no one
- Only a post newly created in a help desk forum is greeted and reminded
- `!escalate` needs a staff member with a support role of that category or the owner or an Administrator, tickets turned on, and the author can have at most three open tickets
- The thread guard reads the active threads once an hour while a warnings channel is set or auto-archive is on. At 900 or more it warns, at most once a day
- Fluxer does not apply a channel's default auto-archive time to new threads, so `!helpdesk archive on` gives up to 25 threads that time each hour. It needs Manage threads
