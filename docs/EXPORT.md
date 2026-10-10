# Server export format

This guide is for server owners who move a server's NeonFlux data to another bot and for developers who write an importer. The server export is a readable JSON copy of a server's NeonFlux settings, leveling profiles, member showcases and profiles, moderation cases and appeals. It is separate from the [encrypted backup](BOT.md#selective-backup-and-additive-restore), which only restores into NeonFlux. NeonFlux does not import data from other bots

## Get an export

Only the current server owner can export, because the file holds private moderation data

- On the dashboard, open **Server export** under Insights and choose **Export server data**. NeonFlux checks with Fluxer that you own the server, the same live check [private cases](WEB.md#private-cases) use, then reads the export and offers the file to save
- In chat, send `!export` to NeonFlux in a one-to-one DM, with `--server <serverId>` in multi-server mode. NeonFlux checks that you own the server and sends the file in the DM, as [the bot guide](BOT.md#server-export) describes

The server's [audit log](WEB.md#audit-log) records each export with who started it and from where, never its content

## File

The file is UTF-8 JSON printed with two spaces of indentation. Its name is `neonflux-server-export-<serverId>.json`. Times are Unix milliseconds in UTC, and user, role and channel IDs are decimal strings

| Field | Value |
| --- | --- |
| `format` | Always `neonflux-server-export` |
| `version` | The format version, `1` for this format. A new version changes this guide first |
| `serverId` | The server the data belongs to |
| `exportedAt` | When the export started |
| `part` | The part number, starting at 1 |
| `lastPart` | `true` on the last part |
| `settings` | Each feature's settings by family name, see [settings](#settings) |
| `levels` | Leveling profiles, see [levels](#levels) |
| `showcases` | Member showcases, oldest first, see [showcases](#showcases) |
| `profiles` | Member profiles, see [profiles](#profiles) |
| `cases` | Moderation cases, oldest first, see [cases](#cases) |
| `appeals` | Appeals, oldest first, see [appeals](#appeals) |

An export from the dashboard is always one file. A chat export larger than about 4 MiB arrives as several files named `neonflux-server-export-<serverId>-part-<n>.json`, each sent as its own DM message. Every part is a complete file of the same shape with its own share of the data. To load a split export, read every part from 1 to the one with `lastPart: true`, concatenate the `levels`, `showcases`, `profiles`, `cases` and `appeals` arrays and merge `settings`, where a family that appears in more than one part continues its lists

## Settings

`settings` holds one object per family, with the settings as the dashboard shows them. Field names and values follow the [shared contracts](../projects/backend/contracts.d.ts), and each family's section in [the bot guide](BOT.md) explains what a setting does

| Family | Contents |
| --- | --- |
| `general` | `prefix`, `replyStyle` (`embed` or `text`) and the bot's `nickname`, or `null` when it has none |
| `analytics` | `enabled`, whether NeonFlux counts server activity |
| `roles` | `settings` for reaction roles, rules verification and autorole, and `panels` with their role mappings |
| `logs` | Channel log `enabled`, category `routes`, per-event `eventRoutes`, `messageChannelIds` and `excludedChannelIds` |
| `responses` | `settings` and the custom command and autoresponder `definitions` |
| `moderation` | `settings`, the `privateDataRoleId`, automod `rules` and the security `watchlist` with its reasons |
| `publishing` | `settings` and saved `drafts` and templates with their message content |
| `greetings`, `leveling`, `suggestions` | `settings` |
| `tickets` | `settings` and `categories` with their questions and canned replies |
| `milestones` | `settings` and the birthday and anniversary `routes` |
| `cleanup` | `settings` and the per-channel `policies` |
| `events`, `schedules` | `settings` and the `events` or `schedules` with their dates |
| `voice` | Temporary voice `generators` |
| `rolepicker` | `settings` with its menus and the `access` lists |
| `temproles` | `settings` with each role's default and longest duration |
| `sticky` | `stickies` with their channel, text and interval |
| `sidebar` | The dashboard `link` channel, or `null` |
| `alerts` | Security alert `settings` |
| `helpdesk` | `settings` and saved `answers` |
| `onboarding` | Newcomer checklist `settings` |
| `lfg` | Looking for group `settings` |
| `showcase`, `profile` | `settings` and the `access` lists |
| `youtube` | Followed YouTube channel `subscriptions`, each with its YouTube channel ID, alert channel, whether alerts are on, the problem that turned them off and when it was added |

Live state, such as active temporary role grants, open voice rooms and groups, the invite list, checklist completion counts and each YouTube channel's subscription status and latest activity, is not part of the settings

## Levels

Each entry is a member with current-season XP. Members without XP, including those whose XP belongs to an earlier season, are left out

| Field | Value |
| --- | --- |
| `userId` | The member |
| `xp` | Current-season XP |
| `level` | The level that XP reaches. Level N needs `100 * N²` XP, up to level 1000 |

## Showcases

Each entry is a showcase that still exists, with the text as the member wrote it, including any mention syntax. The posted message neutralizes mentions, the export does not

| Field | Value |
| --- | --- |
| `showcaseNo` | The showcase number in this server |
| `authorId` | The member who posted it |
| `title` | The title, up to 100 characters |
| `text` | The text, up to 1,000 characters |
| `links` | Up to 3 web addresses in their normalized form |
| `channelId` | The channel NeonFlux posted it in |
| `messageId` | NeonFlux's message, present once Fluxer confirmed it |
| `createdAt` | When the member posted it |
| `updatedAt` | When the member last changed it |

## Profiles

| Field | Value |
| --- | --- |
| `userId` | The member |
| `bio` | The bio as the member wrote it, up to 300 characters, possibly empty |
| `links` | Up to 3 web addresses in their normalized form |
| `color` | The accent color as an RGB number, or `null` for the default |
| `updatedAt` | When the member last saved it |

## Cases

| Field | Value |
| --- | --- |
| `caseNo` | The case number in this server |
| `action` | The action, such as `warn`, `timeout`, `kick`, `ban` or `log` |
| `origin` | What created the case: `manual`, `automod` or `security` |
| `incident` | Present for security cases: `join-burst`, `honeypot` or `watchlist` |
| `actorId` | The staff member who acted, when one did |
| `targetId` | The member the case concerns, when there is one |
| `channelId` | The channel involved, when there is one |
| `ruleName` | The automod rule that matched, for automod cases |
| `linkedCaseNo` | The earlier case this one reverses or follows |
| `reason` | The reason, or `null` when the owner erased the case |
| `outcome` | `pending`, `succeeded`, `failed` or `uncertain` when NeonFlux could not confirm the action |
| `voided` | Whether staff voided the warning |
| `erased` | Whether the owner erased the case's text |
| `createdAt` | When the case was created |
| `corrections` | Reason corrections and voids, each with `type`, `actorId`, `previousReason`, `reason` and `createdAt`. Empty for an erased case |

## Appeals

| Field | Value |
| --- | --- |
| `appealNo` | The appeal number in this server |
| `caseNo` | The appealed case |
| `userId` | The member who appealed |
| `status` | `open`, `accepted`, `rejected` or `withdrawn` |
| `text` | The appeal, or `null` when the owner erased its case |
| `decisionReason` | Present once staff decided, or `null` when erased |
| `decidedBy` | The staff member who decided |
| `decidedAt` | When staff decided |
| `erased` | Whether the owner erased the appeal's case |
| `createdAt` | When the member appealed |

## What the export leaves out

The export holds no credentials, sessions, receipts, leases, delivery attempts or other bookkeeping. It also leaves out other data the server owner does not author or that belongs to members, such as AFK statuses, birthdays, RSVPs, votes, suggestions, tickets, analytics counts, metadata log records and the audit log itself. Showcases and profiles are included because members publish them in the server. Members export their own data with [`!mydata`](BOT.md#your-data)

Fluxer's own channels are not NeonFlux data, so the export lists none of them, including forum and media channels with their tags and post settings. The encrypted backup's `structure` category keeps those for a restore into NeonFlux, as [the bot guide](BOT.md#selective-backup-and-additive-restore) describes

## How NeonFlux reads it

The export is read in pages, one backend transaction each, so no server is too large for it. A page holds one family's settings with at most 20 items of each list, up to 500 leveling profiles, up to 200 showcases, up to 500 member profiles, up to 100 cases with up to 20 corrections each, or up to 200 appeals. The dashboard reads pages while the owner's access check is fresh, two minutes after the bot answered it. An export that takes longer asks the bot for a new check and continues where it stopped, and the audit log records the continuation. In chat, NeonFlux reads the owner and the DM again at least every 45 seconds and right before it sends each part
