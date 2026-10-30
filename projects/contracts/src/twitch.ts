import { Schema } from "effect"
import { Id, List, Millis, origin } from "./common.ts"
import { ModerationActor } from "./shared.ts"
import { PublishingContent, PublishingGrant, PublishingTwitchConsumer } from "./publishing-base.ts"
export { isTwitchChannelId, isTwitchStreamId } from "./publishing-base.ts"

// Twitch live alerts, see docs/BOT.md#twitch-live-alerts

/** A server follows at most ten Twitch channels, and a work pass lists at most ten due alerts */
export const TWITCH_LIMIT = 10,
    TWITCH_WORK_BATCH = 10
const optional = Schema.optionalKey
const stored = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
/** Logins and broadcaster IDs are accepted internally, and public forms parse Twitch links first */
export const TWITCH_CHANNEL_ID_HINT = "Enter a Twitch login or a twitch.tv/<login> link"
/** Numeric logins stay distinct from numeric broadcaster IDs until the lookup completes */
export const twitchLoginKey = (login: string) => (/^\d+$/.test(login) ? `pending:${login}` : login)
const { twitchChannelId, streamId } = PublishingTwitchConsumer.fields
export function twitchLink(text: string): { path: string; twitchChannelId?: string } | undefined {
    try {
        const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
        if (url.hostname.toLowerCase().replace(/^www\./, "") !== "twitch.tv" || url.username || url.password)
            return undefined
        const login = /^\/([a-z0-9_]{1,25})\/?$/i.exec(url.pathname)?.[1]?.toLowerCase()
        return { path: url.pathname, ...(login ? { twitchChannelId: login } : {}) }
    } catch {
        return undefined
    }
}

/** Why NeonFlux turned a Twitch subscription off: Its destination channel is gone, or NeonFlux cannot post there */
export const TwitchProblem = Schema.Literals(["channel", "permission"])
export type TwitchProblem = typeof TwitchProblem.Type
/** The latest stream NeonFlux saw in an EventSub notification */
export const TwitchStream = Schema.Struct({
    streamId,
    title: stored(1000),
    publishedAt: Schema.Finite,
    game: optional(stored(256)),
    thumbnail: optional(stored(2048)),
})
export type TwitchStream = typeof TwitchStream.Type
/** Connection, lookup or revocation errors and the streamer's latest activity */
export const TwitchStatus = Schema.Struct({
    title: optional(stored(256)),
    login: optional(stored(25)),
    connected: optional(Schema.Boolean),
    retrying: optional(Schema.Boolean),
    hubError: optional(stored(300)),
    lastNotificationAt: optional(Millis),
    lastPostAt: optional(Millis),
    latestStream: optional(TwitchStream),
})
export type TwitchStatus = typeof TwitchStatus.Type
/** One followed channel and where its alerts go. Twitch sources use a login until resolution, then the stable numeric broadcaster ID */
export const TwitchSubscription = Schema.Struct({
    twitchChannelId,
    channelId: Id,
    enabled: Schema.Boolean,
    problem: optional(TwitchProblem),
    createdAt: Millis,
    status: TwitchStatus,
})
export type TwitchSubscription = typeof TwitchSubscription.Type
/** configured is whether this deployment has Twitch credentials and a callback origin. Subscriptions are sorted by Twitch channel ID */
export const TwitchView = Schema.Struct({
    configured: Schema.Boolean,
    subscriptions: List(TwitchSubscription, TWITCH_LIMIT),
})
export type TwitchView = typeof TwitchView.Type
/** Add follows a channel or, for one already followed, changes its destination and turns it back on */
export const TwitchOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("add"), twitchChannelId, channelId: Id }),
    Schema.Struct({ type: Schema.Literal("remove"), twitchChannelId }),
])
export type TwitchOperation = typeof TwitchOperation.Type
/** Chat changes carry the server manager's fresh native authority, like sticky messages */
export const TwitchManageRequest = Schema.Struct({
    ...origin,
    serverId: Id,
    messageId: Id,
    createdAt: Millis,
    actor: ModerationActor,
    managerAuthorized: Schema.Literal(true),
    operation: TwitchOperation,
})
export type TwitchManageRequest = typeof TwitchManageRequest.Type
export const TwitchManageResult = Schema.Struct({
    type: Schema.Literals(["added", "removed"]),
    subscription: TwitchSubscription,
})
export type TwitchManageResult = typeof TwitchManageResult.Type
/** sample asks for a test alert of one followed channel, built like a real alert from its latest stream or a placeholder */
export const TwitchQueryRequest = Schema.Struct({ serverId: Id, sample: optional(twitchChannelId) })
export type TwitchQueryRequest = typeof TwitchQueryRequest.Type
export const TwitchQueryResult = Schema.Struct({
    ...TwitchView.fields,
    sample: optional(Schema.Struct({ channelId: Id, content: PublishingContent, forumPostName: stored(100) })),
})
export type TwitchQueryResult = typeof TwitchQueryResult.Type
/** The bot's fresh read of an alert's destination, acting as itself */
export const TwitchDeliveryContext = Schema.Struct({
    ...origin,
    observedAt: Millis,
    channelId: Id,
    botId: Id,
    botAuthorized: Schema.Literal(true),
})
export type TwitchDeliveryContext = typeof TwitchDeliveryContext.Type
/** An alert that waits for the bot, with its subscription's current destination */
export const TwitchDelivery = Schema.Struct({ twitchChannelId, streamId, channelId: Id })
export type TwitchDelivery = typeof TwitchDelivery.Type
/**
 * list returns up to ten due alerts. reserve claims one for the publisher. defer waits a minute after a failed read, and blocked turns a
 * subscription off because its destination is gone or NeonFlux cannot post there. channelId names the destination the bot read
 */
export const TwitchWorkOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("list") }),
    Schema.Struct({ type: Schema.Literal("reserve"), twitchChannelId, streamId, context: TwitchDeliveryContext }),
    Schema.Struct({ type: Schema.Literal("defer"), twitchChannelId, streamId }),
    Schema.Struct({ type: Schema.Literal("blocked"), twitchChannelId, channelId: Id, reason: TwitchProblem }),
])
export type TwitchWorkOperation = typeof TwitchWorkOperation.Type
export const TwitchWorkRequest = Schema.Struct({ serverId: Id, operation: TwitchWorkOperation })
export type TwitchWorkRequest = typeof TwitchWorkRequest.Type
/**
 * skipped means the alert will not be posted, for example because its subscription is off or it is two hours old. recorded is false when nothing changed.
 * A recorded blocked report names the Twitch channel once a notification gave its name, so the staff note can use it
 */
export const TwitchWorkResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("deliveries"), deliveries: List(TwitchDelivery, TWITCH_WORK_BATCH) }),
    Schema.Struct({ type: Schema.Literal("reserved"), grant: PublishingGrant }),
    Schema.Struct({ type: Schema.Literal("skipped") }),
    Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean, title: optional(stored(256)) }),
])
export type TwitchWorkResult = typeof TwitchWorkResult.Type
