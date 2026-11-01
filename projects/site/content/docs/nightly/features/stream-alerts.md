---
title: Stream alerts
description: Post new YouTube uploads and Twitch live streams in a channel
---

Stream alerts post a card in a channel when a followed YouTube channel uploads a video or a followed Twitch streamer goes live. A server can follow up to 10 YouTube channels and up to 10 Twitch streamers

## How it works

Alerts come only from push notifications sent by YouTube and Twitch. The bot does not poll either site, and YouTube needs no API key. For Bluesky and X, see [feeds](./feeds.md)

### YouTube

- Livestreams, premieres and Shorts arrive as ordinary new videos, and upcoming streams are not announced
- Adding a channel posts nothing for older videos, only later uploads
- The first alert can take a few minutes while YouTube confirms the subscription
- A video that changes later, such as a new title, is not posted again
- A video published more than seven days before its notification is never announced

### Twitch

- Alerts arrive when the streamer starts their next live stream
- Adding a streamer who is already live posts nothing until the next stream
- The card shows the title, game and thumbnail when Twitch provides them in time
- A stream alert not posted within two hours is dropped, since the stream may be over

In a forum channel, each alert becomes its own post

### Turned-off alerts

The bot needs View channel, Send messages and Embed links in the alert channel. If the channel is gone or the permissions are missing, it turns that channel's alerts off and posts one note in the system channel. Adding the channel again with a working destination turns them back on

Alerts wait while publishing is off or DEFCON is below 3

## Set it up

1. Open **YouTube alerts** or **Twitch alerts** under Messaging in the dashboard for the server, or use the chat commands below
2. Enter the YouTube channel ID or the Twitch login, and pick the alert channel
3. Run the test command to check the card and permissions

A YouTube channel ID starts with `UC` and has 24 characters. On YouTube, open the channel, select the more link in its description, then Share channel and Copy channel ID. A link with `/channel/UC...` works too. An `@handle` does not

A Twitch login or a `twitch.tv/<login>` link names a streamer

The host of the bot must set up the YouTube and Twitch connections first. See [optional services](../self-hosting/optional-services.md). Without them, adding a channel answers that alerts are not available

## Example

```text
Mod:   !youtube add UCxxxxxxxxxxxxxxxxxxxxxx #uploads
Mod:   !youtube test Example Channel

Mod:   !twitch add examplestreamer #live
Mod:   !twitch status
```

The test posts a card marked as a test in the alert channel. `!twitch status` lists each followed streamer and whether alerts are on

## Commands

The commands are for the server owner and members with Administrator or Manage community. They count as staff commands at DEFCON 2

| Command                                | What it does                                                       |
| -------------------------------------- | ------------------------------------------------------------------ |
| `!youtube add <channel-ID> #channel`   | Follow a YouTube channel, or move its alerts and turn them back on |
| `!youtube remove <name>`               | Stop following the channel                                         |
| `!youtube status [name]`               | Show followed channels, or one channel in detail                   |
| `!youtube test <name>`                 | Post a test alert now                                              |
| `!twitch add <login-or-link> #channel` | Follow a streamer, or move and restart alerts                      |
| `!twitch remove <name>`                | Stop following a streamer                                          |
| `!twitch status [name]`                | Show followed streamers, or one streamer in detail                 |
| `!twitch test <name>`                  | Post a test alert now                                              |

A name is the name YouTube or Twitch gives the channel, in any letter case. The status commands show the last notification, the last post and any trouble reaching the site

## Limits

- Up to 10 YouTube channels and 10 Twitch streamers per server
- Each server gets at most one alert per video and one per stream
- Titles are posted with mentions broken up, so they notify nobody
- An alert whose outcome is unknown is never sent again by itself
- A YouTube alert not posted within a day is dropped
- Alert records are forgotten after 30 days
- Test alerts are sent directly and need the same permissions as real alerts

The dashboard section links to YouTube's [Terms of Service](https://www.youtube.com/t/terms) and Google's [Privacy Policy](https://policies.google.com/privacy)
