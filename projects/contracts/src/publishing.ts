import { Schema } from "effect"
import { Id, Int, List, Millis, Token, origin } from "./common.ts"
import { ModerationActor, ModerationSource } from "./shared.ts"
import { PublishingContent, PublishingEmbed, PublishingEmbedField, PublishingGrant, PublishingKind, PublishingName, PublishingObservation, PublishingOutcome, PublishingPost,
    canonicalPublishingContent, equalPublishingContent } from "./publishing-base.ts"
import { EventsAutomationContext, EventsContext } from "./events.ts"
import { SchedulesAutomationContext, SchedulesNameInput } from "./schedules.ts"
import { MilestonesDeliveryContext } from "./milestones.ts"
import { SuggestionsCardContext } from "./suggestions.ts"
import { YoutubeDeliveryContext } from "./youtube.ts"

// Drafts, templates and the posts NeonFlux tracks, see docs/BOT.md#publishing-and-scheduled-publishing

const optional = Schema.optionalKey
/** The bot's capability for one dispatch: 32 lowercase hexadecimal digits */
const ClaimToken = Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/))
/** The member who asked. Tickets send their whole read of the member, and the backend keeps the moderation fields */
const actor = Schema.StructWithRest(ModerationActor, [Schema.Record(Schema.String, Schema.Unknown)])
const canonical = (value: { content: PublishingContent, canonicalContent: PublishingContent }) => equalPublishingContent(value.canonicalContent, canonicalPublishingContent(value.content))

export const PublishingSettings = Schema.Struct({ enabled: Schema.Boolean })
export type PublishingSettings = typeof PublishingSettings.Type
export const PublishingDraft = Schema.Struct({ kind: PublishingKind, name: PublishingName, revision: Int(1), content: PublishingContent, canonicalContent: PublishingContent, createdAt: Millis,
    updatedAt: Millis }).check(Schema.makeFilter(v => v.updatedAt >= v.createdAt && canonical(v)))
export type PublishingDraft = typeof PublishingDraft.Type
export const PublishingDispatchPolicy = Schema.Struct({ windowMs: Schema.Literal(180000), nativeDeadlineMs: Schema.Literal(5000), marginMs: Schema.Literal(5000) })
export type PublishingDispatchPolicy = typeof PublishingDispatchPolicy.Type
/** The bot's fresh read for a dashboard job that posts: its manager's permission and the bot in the destination */
export const DashboardPublishingContext = Schema.Struct({ ...origin, jobId: Token, actorId: Id, managerAuthorized: Schema.Boolean, observedAt: Millis, botId: Id, channelId: Id })
export type DashboardPublishingContext = typeof DashboardPublishingContext.Type
/** A claim carries the fresh native read of the consumer that owns the attempt, under that consumer's field */
export const PublishingDispatchRequest = Schema.Struct({ serverId: Id, postNo: Int(1), attemptId: Token, generation: Int(1), sourceId: Token, claimToken: ClaimToken,
    eventContext: optional(Schema.Union([EventsContext, EventsAutomationContext])), scheduleContext: optional(SchedulesAutomationContext), milestoneContext: optional(MilestonesDeliveryContext),
    suggestionContext: optional(SuggestionsCardContext), youtubeContext: optional(YoutubeDeliveryContext), dashboardContext: optional(DashboardPublishingContext) })
export type PublishingDispatchRequest = typeof PublishingDispatchRequest.Type
export const PublishingDispatchResult = Schema.Struct({ claimed: Schema.Boolean, dispatchExpiresAt: Int(1), nativeDeadlineMs: Schema.Literal(5000) })
export type PublishingDispatchResult = typeof PublishingDispatchResult.Type
/** The bot's fresh read of its own and the member's permission in the destination */
export const PublishingContext = Schema.Struct({ ...origin, botId: Id, channelId: Id, botAuthorized: Schema.Boolean, actorAuthorized: Schema.Boolean })
export type PublishingContext = typeof PublishingContext.Type

const embed = PublishingEmbed.fields
const property = <K extends string, S extends Schema.Top>(field: K, value: S) => Schema.Struct({ type: Schema.Literal("embed-property"), field: Schema.Literal(field), value: Schema.NullOr(value) })
/** One change to a draft. A null embed property removes it */
export const PublishingDraftEdit = Schema.Union([
    Schema.Struct({ type: Schema.Literal("content"), content: PublishingContent.fields.content }),
    Schema.Struct({ type: Schema.Literal("embed"), embed: PublishingEmbed }),
    Schema.Struct({ type: Schema.Literal("embed-clear") }),
    property("title", embed.title.schema), property("description", embed.description.schema), property("url", embed.url.schema), property("color", embed.color.schema),
    property("timestamp", embed.timestamp.schema), property("author", embed.author.schema), property("footer", embed.footer.schema), property("image", embed.image.schema),
    property("thumbnail", embed.thumbnail.schema),
    Schema.Struct({ type: Schema.Literal("field-add"), field: PublishingEmbedField }),
    Schema.Struct({ type: Schema.Literal("field-set"), index: Int(1, 25), field: PublishingEmbedField }),
    Schema.Struct({ type: Schema.Literal("field-remove"), index: Int(1, 25) }),
    Schema.Struct({ type: Schema.Literal("fields-clear") }),
])
export type PublishingDraftEdit = typeof PublishingDraftEdit.Type
// Requests may spell a name in any case and with surrounding space. The backend trims and lowercases it
const named = { kind: PublishingKind, name: SchedulesNameInput }, revised = { ...named, expectedRevision: Int(1) }, tracked = { postNo: Int(1), expectedGeneration: Int(1) }
/** The operations that change publishing's configuration, from chat or the dashboard */
export const PublishingConfigurationOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), patch: Schema.Struct({ enabled: optional(Schema.Boolean) }).check(Schema.makeFilter(v => v.enabled !== undefined)) }),
    Schema.Struct({ type: Schema.Literal("draft-create"), ...named, content: optional(PublishingContent) }),
    Schema.Struct({ type: Schema.Literal("draft-set"), ...revised, content: PublishingContent }),
    Schema.Struct({ type: Schema.Literal("draft-clone"), ...revised, toKind: PublishingKind, toName: SchedulesNameInput }),
    Schema.Struct({ type: Schema.Literal("draft-delete"), ...revised }),
    Schema.Struct({ type: Schema.Literal("draft-update"), ...revised, edit: PublishingDraftEdit }),
])
export type PublishingConfigurationOperation = typeof PublishingConfigurationOperation.Type
export const PublishingManageOperation = Schema.Union([...PublishingConfigurationOperation.members,
    Schema.Struct({ type: Schema.Literal("preview"), ...revised }),
    Schema.Struct({ type: Schema.Literal("send"), ...revised, channelId: Id, context: PublishingContext }),
    Schema.Struct({ type: Schema.Literal("edit"), ...revised, ...tracked, context: PublishingContext }),
    Schema.Struct({ type: Schema.Literal("forget"), ...tracked }),
    // Staff record what happened to an unknown outcome. A send names the bot's message that the bot read back
    Schema.Struct({ type: Schema.Literal("resolve"), ...tracked, outcome: Schema.Literal("sent"), messageId: Id, channelId: Id, botId: Id, content: PublishingContent }),
    Schema.Struct({ type: Schema.Literal("resolve"), ...tracked, outcome: Schema.Literal("failed") }),
])
export type PublishingManageOperation = typeof PublishingManageOperation.Type
export const PublishingManageRequest = Schema.Struct({ ...ModerationSource.fields, serverId: Id, actor, operation: PublishingManageOperation })
export type PublishingManageRequest = typeof PublishingManageRequest.Type
const done = { duplicate: Schema.Literal(false) }
export const PublishingManageResult = Schema.Union([Schema.Struct({ duplicate: Schema.Literal(true) }),
    Schema.Struct({ ...done, type: Schema.Literal("settings"), settings: PublishingSettings }),
    Schema.Struct({ ...done, type: Schema.Literal("draft"), draft: PublishingDraft }),
    Schema.Struct({ ...done, type: Schema.Literal("deleted"), kind: PublishingKind, name: PublishingName }),
    Schema.Struct({ ...done, type: Schema.Literal("preview"), draft: PublishingDraft }),
    Schema.Struct({ ...done, type: Schema.Literal("post"), post: PublishingPost, grant: PublishingGrant }),
    Schema.Struct({ ...done, type: Schema.Literal("forgotten"), postNo: Int(1) }),
    Schema.Struct({ ...done, type: Schema.Literal("resolved"), post: PublishingPost }),
])
export type PublishingManageResult = typeof PublishingManageResult.Type
export const PublishingQueryRequest = Schema.Struct({ serverId: Id, actor, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings") }),
    Schema.Struct({ type: Schema.Literal("draft-show"), ...named }),
    Schema.Struct({ type: Schema.Literal("draft-list"), kind: PublishingKind, page: optional(Int(1, 10)) }),
    Schema.Struct({ type: Schema.Literal("post-show"), postNo: Int(1) }),
    Schema.Struct({ type: Schema.Literal("post-list"), beforePostNo: optional(Int(1)) }),
]) })
export type PublishingQueryRequest = typeof PublishingQueryRequest.Type
/** A page holds at most ten drafts or posts */
export const PublishingQueryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings: PublishingSettings }),
    Schema.Struct({ type: Schema.Literal("draft"), draft: PublishingDraft }),
    Schema.Struct({ type: Schema.Literal("drafts"), drafts: List(PublishingDraft, 10), kind: PublishingKind, page: Int(1), totalPages: Int(1) }),
    Schema.Struct({ type: Schema.Literal("post"), post: PublishingPost }),
    Schema.Struct({ type: Schema.Literal("posts"), posts: List(PublishingPost, 10), nextBeforePostNo: optional(Int(1)) }),
])
export type PublishingQueryResult = typeof PublishingQueryResult.Type
/** A send to a forum or media channel reports the post it created as threadId */
export const PublishingOutcomeRequest = Schema.Struct({ serverId: Id, postNo: Int(1), attemptId: Token, generation: Int(1), sourceId: Token, outcome: PublishingOutcome.pick(["sent", "failed", "uncertain"]),
    messageId: optional(Id), threadId: optional(Id), claimToken: optional(ClaimToken) })
export type PublishingOutcomeRequest = typeof PublishingOutcomeRequest.Type
export const PublishingOutcomeResult = Schema.Struct({ recorded: Schema.Boolean })
export type PublishingOutcomeResult = typeof PublishingOutcomeResult.Type
export const PublishingReconcileRequest = Schema.Struct({ ...ModerationSource.fields, serverId: Id, actor, postNo: Int(1), attemptId: Token, expectedGeneration: Int(1),
    observation: PublishingObservation })
export type PublishingReconcileRequest = typeof PublishingReconcileRequest.Type
export const PublishingReconcileResult = Schema.Struct({ recorded: Schema.Boolean, post: PublishingPost })
export type PublishingReconcileResult = typeof PublishingReconcileResult.Type
export const PublishingObserveRequest = Schema.Struct({ serverId: Id, mode: Schema.Literals(["restart", "aged"]) })
export type PublishingObserveRequest = typeof PublishingObserveRequest.Type
export const PublishingObserveResult = Schema.Struct({ uncertainAttempts: Int() })
export type PublishingObserveResult = typeof PublishingObserveResult.Type
