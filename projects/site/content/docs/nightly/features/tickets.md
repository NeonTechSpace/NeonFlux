---
title: Tickets
description: Private support channels that members open with a few questions and staff answer, close and keep a transcript of
---

A member opens a ticket, answers a few questions in a DM and gets a channel where staff help them. Closing the ticket takes away the member's send access and saves a transcript. Tickets start off

## How it works

- Staff set up categories, such as `help` or `report`, each with its own support roles, questions and channel settings
- A member opens a ticket with `!ticket open` or by reacting 🎫 on a ticket panel
- The questions always go to the member's DM. The server channel only learns that the intake started
- When every question is answered, the member sends `send` to create the ticket
- The ticket gets its own channel. Staff see it and so does the requester
- Staff reply, set a priority, claim the ticket and keep private notes
- Closing removes send access for the requester. Reopening restores it
- Every close saves a transcript of the ticket channel and its public threads

Ticket support roles are separate from moderation staff roles. A category with no support roles leaves staff access to the owner and Administrators. A category is `private` or `public`, which decides who sees the conversation. The intake shows who will see it before submitting

## Set it up

1. Create a category with `!ticket category create help private #Support @Support`. The parent category and the support roles can be `none`
2. Add questions with `!ticket question help add "What is the problem?"`
3. Optionally add a canned reply that follows a publishing template with `!ticket canned help set greeting <template>`
4. Optionally post a panel members react to with `!ticket panel help #get-help`
5. Turn tickets on with `!ticket module on`
6. Check the setup with `!setup tickets`

The dashboard has the same settings under **Tickets** in the Community group. Setup needs the server owner or an Administrator

## Example

```text
Mara: !ticket open help
NeonFlux (DM): Asks the first question

Mara (DM): My role disappeared after I joined
NeonFlux (DM): Says every question is answered and who will see the conversation

Mara (DM): send
NeonFlux: Opens a private ticket channel for Mara and the Support role

Sam (in the ticket): !ticket claim
Sam (in the ticket): !ticket reply "Fixed, please check again"
Sam (in the ticket): !ticket close
```

During the intake, a DM that is not a command answers the current question. `back` clears the previous answer and asks it again, and `cancel` stops. The words match without regard to case

## Commands

For members:

| Command                                              | What it does                                           |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `!ticket open [category]`                            | Opens a ticket and starts the questions in a DM        |
| `!ticket list [next]`                                | Lists the tickets the member can see                   |
| `!ticket show [ticket]`                              | Shows a ticket's state, people, channel and transcript |
| `!ticket close [ticket]`, `!ticket reopen [ticket]`  | Closes a ticket or opens it again                      |
| `!ticket answer <intake> <1-25> "answer"`            | Answers a question, in a DM                            |
| `!ticket review <intake>`, `!ticket cancel <intake>` | Checks the answers or stops, in a DM                   |
| `!ticket submit <intake> private\|public`            | Creates the ticket, in a DM                            |

For staff, in the ticket's own channel the number may be left out:

| Command                                                 | What it does                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| `!ticket claim [ticket]`, `!ticket unclaim [ticket]`    | Takes or releases a ticket                                    |
| `!ticket priority [ticket] low\|normal\|high\|urgent`   | Sets the priority                                             |
| `!ticket reply [ticket] "text"` or `canned <name>`      | Posts a reply in the ticket channel                           |
| `!ticket note <ticket> add "text"`                      | Adds a private staff note. `list` and `show <note>` read them |
| `!ticket intake <ticket>`                               | Shows the private intake answers                              |
| `!ticket transcript <ticket> capture\|list\|show\|file` | Updates, lists, reads or downloads transcripts                |
| `!ticket reconcile <ticket>`                            | Rechecks a close, reopen or create against the real channel   |

For the owner and Administrators:

| Command                                                  | What it does                                  |
| -------------------------------------------------------- | --------------------------------------------- |
| `!ticket category show\|delete <name>`                   | Shows or deletes a category                   |
| `!ticket category set <name> description "text"`         | Sets the public description                   |
| `!ticket category set <name> visibility private\|public` | Sets who sees new tickets                     |
| `!ticket category set <name> parent #category\|none`     | Sets where its channels go                    |
| `!ticket category set <name> staff @roles...\|none`      | Sets its support roles                        |
| `!ticket category set <name> enabled on\|off`            | Turns a category on or off                    |
| `!ticket question <category> add\|set\|remove\|clear`    | Manages the opening questions                 |
| `!ticket panel <category> #channel`, `!ticket panels`    | Posts or lists panels                         |
| `!ticket retention <1-365>`                              | Sets how many days closed ticket text is kept |
| `!ticket delete <ticket> confirm`                        | Deletes a closed ticket's channel             |
| `!ticket erase <ticket> confirm`                         | Erases stored answers, notes and transcripts  |

Ticket commands work in server channels and in a DM. Staff notes and intake answers appear only in a DM or in a channel that only the ticket's support roles can see, never in the ticket channel, because the requester reads that

## Limits

- Up to 25 questions per category, each at most 200 characters. An answer is at most 2000 characters, as text only
- Up to 250 support roles per category
- Closed ticket text is kept 30 days by default, from 1 to 365. Reopening is unavailable after that or after an erase
- Erasing removes stored copies only and never deletes messages already sent
- A panel must let NeonFlux view, send, add reactions and read history in its channel. Each category has one panel
- The transcript keeps each message's author, time, text, attachment links, embed text and sticker names. Private threads are left out. Attachment links work while Fluxer keeps the files
- If a close, reopen or creation is interrupted, the ticket stays unresolved until `!ticket reconcile` confirms the real state. NeonFlux never repeats an operation whose result is unknown
- Close first allows NeonFlux the thread permissions it holds. Another role or member allowed to send or post in threads blocks closing until staff remove that grant
