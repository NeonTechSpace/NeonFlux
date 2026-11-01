---
title: Analytics
description: See how active the server is, with counts only and never who did what
---

Analytics counts joins, leaves and messages so staff can see how active the server is. It keeps numbers only, never which member did what. It starts on

## How it works

The bot counts these, per UTC day or hour:

- Members who join and leave, per day
- Members who finish the [newcomer checklist](./welcome.md), per day
- Messages per channel and hour

Only ordinary messages and replies from human members count, commands included. Bot, webhook and system messages are never counted. A message in a thread or forum post counts under its parent channel

Counts reach the dashboard in batches about every five minutes, so the charts lag by that much. A crash can lose the last few minutes of counts

### On the dashboard

The **Analytics** section under Insights has these parts:

- A chart of daily joins and leaves for the last 30 days
- A chart of daily member messages for the last 14 days
- The top ten channels by messages, for the last 7 or 30 days
- **Busiest hours**, with the busiest UTC hour, a chart for each hour of the day and a weekday and hour grid
- A channel picker to see the hours of one channel

Each chart can also be shown as a table. When analytics is off, the section says the bot is not counting, and existing counts stay until they expire

## Set it up

1. Open the **Analytics** section of the dashboard for the server, or use `!stats on`
2. Wait a few minutes for the first counts to arrive
3. Read the charts, or send `!stats` in chat

`!stats off` and the dashboard switch both stop counting at once and drop counts not yet sent. Turning analytics off keeps what was already counted

## Example

```text
Mod:   !stats
Bot:   (a summary of the last seven UTC days: joins, leaves, messages,
        the top three channels and the three busiest hours)
```

The busiest hours show in each reader's own timezone

## Commands

The commands are for the server owner and members with Administrator or Manage community. Other members get a refusal

| Command       | What it does                 |
| ------------- | ---------------------------- |
| `!stats`      | Show the last seven UTC days |
| `!stats on`   | Start counting               |
| `!stats off`  | Stop counting                |
| `!stats help` | Show the syntax              |

## Limits

- Channel and hourly counts expire after 35 days
- Daily join and leave counts expire after 400 days
- Days and hours are in UTC
- Counts arrive about every five minutes
- A server with no activity sends nothing
