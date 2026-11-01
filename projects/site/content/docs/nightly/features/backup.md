---
title: Backup
description: Save a server's NeonFlux settings to an encrypted file, restore them, or export readable data
---

Backup saves chosen parts of NeonFlux's setup, so the owner can restore it later or on another server. A separate export gives the same data as a readable file other bots can load. Both are for the current server Owner only

This is not a full backup of a server, its database or its messages

## How it works

### Backup and restore

An encrypted backup holds up to three categories:

| Category    | What it holds                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| `config`    | Settings of NeonFlux's features, such as moderation, automod, roles, tickets, leveling, events and logs |
| `xp`        | Current-season leveling XP of every member who has some                                                 |
| `structure` | Categories and text, announcement, voice, forum and media channels, with their permissions              |

Restoring is a two-step process, and nothing changes until the last step

1. **Preview** checks the backup against the server as it is now and makes a plan. Each item is a create, update, delete, identical or blocked, with a reason
2. **Confirm** runs the whole plan in the background, and the bot posts the outcome in the DM

A plan stays open for a day. A newer preview replaces a plan nobody confirmed

A restore creates what is missing and updates what differs. It never recreates roles, moves members or lowers DEFCON. It deletes channels and categories only with `match`, which also deletes those the backup does not hold, and the preview warns before confirmation because that cannot be undone

A restore that is partly done is not rolled back. A step that finds the server changed since the preview ends as a conflict and does not overwrite it. The restore stops writing if the member is no longer the owner or the DM is no longer private

Some things are never in a backup, such as credentials, birthdays, votes, RSVPs, ticket text, moderation notes, audit history and the dashboard link. Posted ticket panels are not in it either, so post them again with `!ticket panel`

The dashboard shows the owner's latest preview as a list of changes, and the owner can confirm there. It never receives the archive or its key

### Server export

`!export` sends the server's NeonFlux data as readable JSON: Every feature's settings, leveling XP and levels, member showcases and profiles, and moderation cases with their corrections and appeals. Text the owner erased stays out. The export is separate from the backup, which only restores into NeonFlux

A file over about 4 MiB arrives as several numbered files, each complete. The owner can also download it from the dashboard

## Set it up

1. Make sure the host has set `NEONFLUX_BACKUP_KEY`, as the [bot setup](../self-hosting/bot.md) describes. Without it, backup export, inspect and preview are off
2. Open a direct message with the bot as the server Owner
3. Send `!backup export config xp structure`, or name only the categories wanted
4. Keep the file or files safe, and keep a copy of the key
5. To restore, attach every part of the backup to one message and send `!backup preview`
6. Read the plan, then send `!backup confirm`

A lost key makes its backups unreadable, and a changed key does the same until the old one is back. Backups larger than 4 MiB are sent as numbered parts, each in its own DM message. Rename a copy such as `neonflux-backup-0123abcd-1of3 (1).nfb` before attaching it

In the dashboard, the **Backup restore** section shows the latest preview, and the **Server export** section offers the readable export as a download

## Example

```text
Owner:  !backup export config xp
Bot:    (sends neonflux-backup-0123abcd.nfb)

Owner:  (attaches the file) !backup preview
Bot:    (shows the plan, problems first, 10 items to a page)
Owner:  !backup confirm
Bot:    (posts the outcome in the DM when the restore ends)
```

## Commands

Send these in a direct message with the bot. In the server, they return only a private hint

| Command                              | What it does                                         |
| ------------------------------------ | ---------------------------------------------------- |
| `!backup export config xp structure` | Save the named categories to an encrypted file       |
| `!backup inspect`                    | Check an attached backup and show what it holds      |
| `!backup preview [next\|match]`      | Check what a restore would change, and make the plan |
| `!backup items [next]`               | List the plan's items with their reasons             |
| `!backup confirm`                    | Run the plan to the end                              |
| `!backup status`                     | Show the newest plan and how far it got              |
| `!backup reconcile`                  | Recheck created items with unknown results           |
| `!backup forget`                     | Drop a finished plan and keep what it created        |
| `!export`                            | Send the server's data as a readable JSON file       |

`!backup plan` does the same as `!backup preview`

## Limits

- Only the current server Owner can use these commands, in a verified direct message
- A backup holds at most 40 MiB, in at most 10 parts of 4 MiB
- A backup made by an older version of NeonFlux is refused and needs a new export
- A server has at most 10 restore plans that are not finished
- One restore runs at a time on a server
- A restore with no progress for 10 minutes stops, and `!backup confirm` continues it
- XP from a restore queues no reward roles, which follow at the member's next activity
- Threads and forum posts are not backed up
- A member who deleted their data with `!mydata delete` after the backup is left out of an XP restore
- Backups are encrypted with AES-256-GCM, and keys, links and file paths are never accepted in commands
