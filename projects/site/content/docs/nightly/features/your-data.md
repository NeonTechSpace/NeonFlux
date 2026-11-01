---
title: Your data
description: Every member can see, export and delete what the bot stores about them
---

Any member can see what NeonFlux stores about them, download it, and delete it. These commands work only in a direct message with the bot, and they cover every server at once

## How it works

`!mydata` lists the servers where NeonFlux holds something under the member's account. Each server gets a number, which the other commands accept in place of the server ID

Deleting is a preview first, then a confirmation. The preview shows what would go and what stays and why. A confirmation deletes only in the server the member previewed last, and it cannot be undone

### What deletion removes

- AFK status, reminders and custom command cooldowns
- Board posts of the member's messages, which is best effort, and their ID from the winners of giveaways
- Leveling XP, with its message records and staff corrections
- Greeting records, the rules acknowledgment and newcomer checklist completion
- Role picker checks, birthday and anniversary sign-ups
- Ticket drafts, event RSVPs and suggestion votes
- Places in open groups and closed suggestions
- Showcase records and the member's profile
- Log records of the member's edited and deleted messages, joins, departures and changes, and audit log records about the member

A seat the member held in an event goes to the next person on the waitlist. After the rules acknowledgment is deleted, the member must acknowledge the rules again

Deleting does not remove messages the bot already sent, such as greetings, event cards, showcases or log posts. A showcase message goes only when the showcase is deleted on the website first

### What stays, and why

The reply explains each item. Typical reasons:

- Moderation cases, corrections and appeals protect the server, and stay for the period the server chose or until the owner erases their text
- Tickets are a shared support record, and a closed ticket's private content expires after the server's ticket retention, 30 days by default
- Roles the bot gave stay recorded while the member may still hold them
- A temporary voice room, or an open group the member hosts, stays while it exists
- A running [jail](./jail.md) keeps the roles the member gets back, and they end with the release
- A giveaway the member hosts keeps them as its host until it ends
- A board post with an unknown outcome stays until staff settle it
- Birthday and anniversary posts already sent stay for a while so no year is celebrated twice
- An open suggestion stays while staff review it, so withdraw it with `!suggest withdraw` and then delete again
- Security records keep their own expiry
- The bot keeps that the member deleted their data in the server, and when, so a restored backup cannot bring their XP back

The server's managers see in the audit log that a member deleted data and from which features, never the data itself

## Set it up

There is nothing for staff to set up. Each member sends the commands to the bot in a direct message

## Example

```text
Rin:   !mydata
Bot:   (a numbered list of servers with a record count for each)
Rin:   !mydata 1
Rin:   !mydata delete 1
Bot:   (shows what deleting removes and what stays, with the exact confirm command)
Rin:   !mydata delete 1 confirm
```

## Commands

| Command                                        | What it does                                               |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `!mydata [next]`                               | List the servers that hold the member's data, 10 to a page |
| `!mydata <number or server ID>`                | Show what is stored in that server, by feature             |
| `!mydata export [server ID]`                   | Send the data as a JSON file, for every server or one      |
| `!mydata delete <number or server ID>`         | Preview what deleting removes and what it keeps            |
| `!mydata delete <number or server ID> confirm` | Delete it                                                  |
| `!mydata help`                                 | Show the syntax                                            |

## Limits

- The commands work only in a one-to-one direct message, and take no `--server` selector
- A number means the server at that place in the last list the member was shown
- A list that hit its read limit says "or more" and a server can be missing, so use a server ID
- An export reads at most 5,000 records, marks any server it cut short and says if others are missing
- A deletion that leaves more behind asks for the same command to be sent again
- Moderation, ticket and security records may stay, as described above
