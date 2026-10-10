import { Schema } from "effect"
import { Id, Int, List, Millis, origin } from "./common.ts"
import { ModerationActor } from "./shared.ts"
import { PublishingContent, PublishingGrant, PublishingYoutubeConsumer } from "./publishing-base.ts"

// YouTube upload alerts, see docs/BOT.md#youtube-upload-alerts

/** A server follows at most ten YouTube channels, and a work pass lists at most ten due alerts */
export const YOUTUBE_LIMIT = 10, YOUTUBE_WORK_BATCH = 10
const optional = Schema.optionalKey
const stored = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
// YouTube channel IDs start with UC and have 24 characters, and video IDs have 11
const { youtubeChannelId, videoId } = PublishingYoutubeConsumer.fields

/** Why NeonFlux turned a YouTube subscription off: Its destination channel is gone, or NeonFlux cannot post there */
export const YoutubeProblem = Schema.Literals(["channel", "permission"])
export type YoutubeProblem = typeof YoutubeProblem.Type
/** The newest video NeonFlux saw for a channel in YouTube's notifications */
export const YoutubeVideo = Schema.Struct({ videoId, title: stored(1000), publishedAt: Schema.Number })
export type YoutubeVideo = typeof YoutubeVideo.Type
/**
 * What NeonFlux knows about a followed channel. subscribedUntil is when YouTube's hub stops sending notifications unless NeonFlux renews,
 * hubError why the latest request to the hub failed, lastNotificationAt the latest notification for the channel and lastPostAt this
 * server's latest alert
 */
export const YoutubeStatus = Schema.Struct({ title: optional(stored(256)), subscribedUntil: optional(Millis), hubError: optional(stored(300)), lastNotificationAt: optional(Millis),
    lastPostAt: optional(Millis), latestVideo: optional(YoutubeVideo) })
export type YoutubeStatus = typeof YoutubeStatus.Type
/** One followed channel and where its alerts go. YouTube channel IDs start with UC and have 24 characters */
export const YoutubeSubscription = Schema.Struct({ youtubeChannelId, channelId: Id, enabled: Schema.Boolean, problem: optional(YoutubeProblem), createdAt: Millis, status: YoutubeStatus })
export type YoutubeSubscription = typeof YoutubeSubscription.Type
/** configured is whether this deployment can reach YouTube's hub. Subscriptions are sorted by YouTube channel ID */
export const YoutubeView = Schema.Struct({ configured: Schema.Boolean, subscriptions: List(YoutubeSubscription, YOUTUBE_LIMIT) })
export type YoutubeView = typeof YoutubeView.Type
/** Add follows a channel or, for one already followed, changes its destination and turns it back on */
export const YoutubeOperation = Schema.Union([Schema.Struct({ type: Schema.Literal("add"), youtubeChannelId, channelId: Id }), Schema.Struct({ type: Schema.Literal("remove"), youtubeChannelId })])
export type YoutubeOperation = typeof YoutubeOperation.Type
/** Chat changes carry the server manager's fresh native authority, like sticky messages */
export const YoutubeManageRequest = Schema.Struct({ ...origin, serverId: Id, messageId: Id, createdAt: Millis, actor: ModerationActor, managerAuthorized: Schema.Literal(true), operation: YoutubeOperation })
export type YoutubeManageRequest = typeof YoutubeManageRequest.Type
export const YoutubeManageResult = Schema.Struct({ type: Schema.Literals(["added", "removed"]), subscription: YoutubeSubscription })
export type YoutubeManageResult = typeof YoutubeManageResult.Type
/** sample asks for a test alert of one followed channel, built like a real alert from its newest video or a placeholder */
export const YoutubeQueryRequest = Schema.Struct({ serverId: Id, sample: optional(youtubeChannelId) })
export type YoutubeQueryRequest = typeof YoutubeQueryRequest.Type
export const YoutubeQueryResult = Schema.Struct({ ...YoutubeView.fields, sample: optional(Schema.Struct({ channelId: Id, content: PublishingContent, forumPostName: stored(100) })) })
export type YoutubeQueryResult = typeof YoutubeQueryResult.Type
/** The bot's fresh read of an alert's destination, acting as itself */
export const YoutubeDeliveryContext = Schema.Struct({ ...origin, observedAt: Millis, channelId: Id, botId: Id, botAuthorized: Schema.Literal(true) })
export type YoutubeDeliveryContext = typeof YoutubeDeliveryContext.Type
/** An alert that waits for the bot, with its subscription's current destination */
export const YoutubeDelivery = Schema.Struct({ youtubeChannelId, videoId, channelId: Id })
export type YoutubeDelivery = typeof YoutubeDelivery.Type
/**
 * list returns up to ten due alerts. reserve claims one for the publisher. defer waits a minute after a failed read, and blocked turns a
 * subscription off because its destination is gone or NeonFlux cannot post there. channelId names the destination the bot read
 */
export const YoutubeWorkOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("list") }),
    Schema.Struct({ type: Schema.Literal("reserve"), youtubeChannelId, videoId, context: YoutubeDeliveryContext }),
    Schema.Struct({ type: Schema.Literal("defer"), youtubeChannelId, videoId }),
    Schema.Struct({ type: Schema.Literal("blocked"), youtubeChannelId, channelId: Id, reason: YoutubeProblem }),
])
export type YoutubeWorkOperation = typeof YoutubeWorkOperation.Type
export const YoutubeWorkRequest = Schema.Struct({ serverId: Id, operation: YoutubeWorkOperation })
export type YoutubeWorkRequest = typeof YoutubeWorkRequest.Type
/**
 * skipped means the alert will not be posted, for example because its subscription is off or it is a day old. recorded is false when nothing changed.
 * A recorded blocked report names the YouTube channel once a notification gave its name, so the staff note can use it
 */
export const YoutubeWorkResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("deliveries"), deliveries: List(YoutubeDelivery, YOUTUBE_WORK_BATCH) }),
    Schema.Struct({ type: Schema.Literal("reserved"), grant: PublishingGrant }),
    Schema.Struct({ type: Schema.Literal("skipped") }),
    Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean, title: optional(stored(256)) }),
])
export type YoutubeWorkResult = typeof YoutubeWorkResult.Type
