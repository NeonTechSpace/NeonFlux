---
title: Bluesky and X feeds
description: Post new posts from followed Bluesky accounts. X is untested against the real service and needs the host's paid key
---

NeonFlux posts new posts from followed accounts in a channel. Bluesky works with no key and has been tested against the real service

X is off unless the host adds their own paid key. It has only been tested against a local copy of X's published API description, never against real X

## How it works

Own posts and quote posts go out. Reposts, retweets, replies, other authors' posts, pinned posts and broken answers do not. Neither do Bluesky posts labelled `porn`, `sexual`, `nudity` or `graphic-media`, posts hidden by moderation, accounts that asked not to be shown to logged-out viewers, or X posts marked `possibly_sensitive`

- The first successful read of an account records its newest post and posts nothing. A server gets only posts newer than its own follow
- After an outage at most the 5 newest posts of an account go out per check, oldest first, and a post more than a day old never does
- An account no server wants right now is not read. When a follow comes back, nothing published in between is posted
- After three failures in a row the problem shows in `!feed status` and `!recovery`

Each post is one embed linking the post, with the author, an excerpt, the first image or video still and the service in the footer. Mentions in the text are broken up. In a forum, each post becomes its own forum post

Bluesky accounts are checked every 5 minutes and X accounts every 30 minutes, later when a deployment follows many accounts

## Set it up

1. Pick a text, announcement or forum channel where NeonFlux can post
2. Send `!feed add bluesky <handle-or-link> #channel`
3. Send `!feed test <name>` to see how a post looks

A host who wants X adds a key as [Optional services](../self-hosting/optional-services.md#x-feeds) describes. Without one, `!feed add x` answers that X feeds are not available

The dashboard has the same settings under **Bluesky and X feeds** in Messaging

## Example

```text
Sam: !feed add bluesky example.bsky.social #announcements
Sam: !feed status
Sam: !feed test example.bsky.social
Sam: !feed remove example.bsky.social
```

## Commands

| Command                                       | What it does                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| `!feed add bluesky <handle-or-link> #channel` | Follow a Bluesky account, or move and restart its posts                            |
| `!feed add x <username-or-link> #channel`     | The same for an X account, where the host has a key                                |
| `!feed remove <name>`                         | Stop following an account                                                          |
| `!feed status [name]`                         | Show all followed accounts, or one account's last check, last post and any problem |
| `!feed test <name>`                           | Post a labelled test, using the latest post NeonFlux holds or a placeholder        |
| `!feed help`                                  | Show syntax                                                                        |

These need the server owner, Administrator or Manage community. A name is a handle or a display name. When two accounts share one, the service goes first, such as `!feed remove x alice`. A Bluesky name without a dot means its `.bsky.social` handle

## Limits

- Up to 10 followed accounts per server
- A missing channel or permission stops the follow and posts a staff note
- Publishing off or DEFCON below 3 holds posts
- A post with an unknown outcome is never repeated. [`!publish reconcile`](./messages.md), or `!publish resolve` after a timeout, settles it
- Polling waits while the bill guard pauses optional work
- When a deployment has spent its monthly X reads, X accounts wait for the next month and `!feed status` says so
- For YouTube and Twitch, see [Stream alerts](./stream-alerts.md)
