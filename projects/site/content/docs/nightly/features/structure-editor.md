---
title: Structure editor
description: Rename and reorder categories and channels from the dashboard
---

The structure editor shows a server's categories and channels as a tree. Staff rename them and change their order, review the result, then save everything at once. It exists only on the dashboard, with no chat command

## How it works

The **Server structure** section lists categories and the text, voice, announcement, forum, media and link channels the signed-in member can view. Active threads appear under their channel. Threads cannot be moved

Edits stay a draft until **Save changes**. The tree shows each changed row with a note such as `was Chat` or `moved from Chat, after general to Info, after rules`

- Rename a row, or drag it to move it
- **Up**, **Down** and a channel's category choice also move rows, and work from the keyboard
- **Changes only** hides unchanged rows
- **Review changes** shows what saving would do with each change
- **Discard draft** drops the draft
- **Show closed threads** loads a channel's 100 most recently closed threads

A draft is kept in the tab if the member leaves the section or the server

### Saving

**Review changes** marks each change as saved, skipped because it is already so, or left unsaved. A change is left unsaved when the channel changed elsewhere since the draft began, the channel or its new category is gone, or the member lacks Manage channels in it

**Save changes** reads the server again and checks every change against the member's current permissions. The bot then writes the changes with its own token. A change that conflicts with another is reported rather than overwritten

**Last save** lists the outcome of each change. A change Fluxer did not confirm shows as **Outcome unknown**, and the bot never repeats it, so check the server before saving it again

Each saved change appears in the audit log, as described in [logs](./logs.md)

## Set it up

1. Open the **Server structure** section of the dashboard for the server
2. Rename or move rows
3. Select **Review changes** to see what each change would do
4. Select **Save changes**
5. Check **Last save** for the outcomes

The bot needs View channel and Manage channels in each channel it changes. A change it cannot make names the fix

## Example

```text
Dashboard:  Rename "Chat" to "Community chat"
Dashboard:  Drag "voice-1" into the "Voice" category
Dashboard:  Review changes, then Save changes
```

**Last save** then lists the outcome of both changes. A moved channel keeps its own permissions and does not take on those of its new category

## Limits

- A save holds at most 100 changes
- Channels where the member lacks Manage channels cannot be changed
- Opening the section and **Check again** read the server at most once every 10 seconds
- Changing permissions, creating channels and deleting channels are not part of this section and stay in Fluxer
- Fluxer applies reordering in order and may refuse part of it, in which case the bot reports each move by where its channel ended up
- A write that times out, or whose answer is unusable, is reported with an unknown outcome and not repeated
- A save's writes stop 90 seconds after it starts
