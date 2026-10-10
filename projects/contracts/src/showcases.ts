import { Schema } from "effect"
import { Id, Int, List, Millis, Str, Token, origin } from "./common.ts"
import { MemberAccessLists, ModerationActor } from "./shared.ts"
import { PublishingGrant } from "./publishing-base.ts"
import { MemberAccessOperation, MemberContentContext, MemberRequestJob, memberLinks } from "./member-content.ts"

// Showcases, see docs/BOT.md#showcases

export const SHOWCASE_TITLE = 100, SHOWCASE_TEXT = 1000, SHOWCASE_MAX_PER_MEMBER = 50, SHOWCASE_MAX_INTERVAL_MINUTES = 10080
const text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
const showcaseNo = Int(1)

/** maxPerMember counts showcases that still exist, and intervalMinutes is the shortest time after a member's newest showcase. Null turns either off */
export const ShowcaseSettings = Schema.Struct({ enabled: Schema.Boolean, channelId: Schema.NullOr(Id), maxPerMember: Schema.NullOr(Int(1, SHOWCASE_MAX_PER_MEMBER)),
    intervalMinutes: Schema.NullOr(Int(1, SHOWCASE_MAX_INTERVAL_MINUTES)) })
export type ShowcaseSettings = typeof ShowcaseSettings.Type
export const ShowcaseOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), enabled: Schema.optionalKey(Schema.Boolean), channelId: Schema.optionalKey(ShowcaseSettings.fields.channelId),
        maxPerMember: Schema.optionalKey(ShowcaseSettings.fields.maxPerMember), intervalMinutes: Schema.optionalKey(ShowcaseSettings.fields.intervalMinutes) })
        .check(Schema.makeFilter(value => Object.keys(value).length > 1)),
    MemberAccessOperation,
])
export type ShowcaseOperation = typeof ShowcaseOperation.Type
export const ShowcaseState = Schema.Struct({ revision: Int(), settings: ShowcaseSettings, access: MemberAccessLists })
export type ShowcaseState = typeof ShowcaseState.Type
/** A title of 1 to 100 characters on one line, text of 1 to 1,000 characters and up to 3 HTTP or HTTPS links */
export const ShowcaseContent = Schema.Struct({ title: text(SHOWCASE_TITLE), text: text(SHOWCASE_TEXT), links: memberLinks })
export type ShowcaseContent = typeof ShowcaseContent.Type
/** posting while the bot sends or edits its message, unconfirmed when Fluxer did not confirm the last send or edit, failed when staff recorded that no message was sent, and posted otherwise */
export const ShowcaseStatus = Schema.Literals(["posting", "posted", "unconfirmed", "failed"])
export type ShowcaseStatus = typeof ShowcaseStatus.Type
export const Showcase = Schema.Struct({ showcaseNo, authorId: Id, ...ShowcaseContent.fields, channelId: Id, postNo: Int(1), messageId: Schema.optionalKey(Id), status: ShowcaseStatus,
    createdAt: Millis, updatedAt: Millis })
export type Showcase = typeof Showcase.Type
export const ShowcaseMemberOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("create"), ...ShowcaseContent.fields }),
    Schema.Struct({ type: Schema.Literal("edit"), showcaseNo, ...ShowcaseContent.fields }),
    Schema.Struct({ type: Schema.Literal("delete"), showcaseNo }),
])
export type ShowcaseMemberOperation = typeof ShowcaseMemberOperation.Type
export const ShowcaseJob = MemberRequestJob(ShowcaseMemberOperation)
export type ShowcaseJob = typeof ShowcaseJob.Type
export const ShowcaseManageRequest = Schema.Struct({ ...origin, serverId: Id, messageId: Id, createdAt: Millis, actor: ModerationActor, managerAuthorized: Schema.Literal(true), operation: ShowcaseOperation })
export type ShowcaseManageRequest = typeof ShowcaseManageRequest.Type
export const ShowcaseSettingsRequest = Schema.Struct({ serverId: Id })
export type ShowcaseSettingsRequest = typeof ShowcaseSettingsRequest.Type
/** Newest first, at most 10, optionally one member's */
export const ShowcaseListRequest = Schema.Struct({ serverId: Id, authorId: Schema.optionalKey(Id) })
export type ShowcaseListRequest = typeof ShowcaseListRequest.Type
export const ShowcaseListResult = Schema.Struct({ showcases: List(Showcase, 10), more: Schema.Boolean })
export type ShowcaseListResult = typeof ShowcaseListResult.Type
export const ShowcaseReadyRequest = Schema.Struct({ serverId: Id })
export type ShowcaseReadyRequest = typeof ShowcaseReadyRequest.Type
export const ShowcaseReadyResult = Schema.Struct({ jobs: List(ShowcaseJob, 4) })
export type ShowcaseReadyResult = typeof ShowcaseReadyResult.Type
export const ShowcaseStartRequest = Schema.Struct({ serverId: Id, jobId: Token, actorId: Id, member: MemberContentContext })
export type ShowcaseStartRequest = typeof ShowcaseStartRequest.Type
/** grant is the send or edit to perform as the bot, and remove the bot's message to delete. Without either, the request is already decided */
export const ShowcaseStartResult = Schema.Struct({ job: ShowcaseJob, grant: Schema.optionalKey(PublishingGrant), remove: Schema.optionalKey(Schema.Struct({ channelId: Id, messageId: Id })) })
export type ShowcaseStartResult = typeof ShowcaseStartResult.Type
/** removed reports whether the message of a delete request is gone. fix names what NeonFlux lacks when the post or deletion failed for a permission */
export const ShowcaseCompleteRequest = Schema.Struct({ serverId: Id, jobId: Token, removed: Schema.optionalKey(Schema.Boolean), fix: Schema.optionalKey(Str(300)) })
export type ShowcaseCompleteRequest = typeof ShowcaseCompleteRequest.Type
export const ShowcaseCompleteResult = Schema.Struct({ job: ShowcaseJob })
export type ShowcaseCompleteResult = typeof ShowcaseCompleteResult.Type
export const ShowcaseFailRequest = Schema.Struct({ serverId: Id, jobId: Token })
export type ShowcaseFailRequest = typeof ShowcaseFailRequest.Type
export const ShowcaseFailResult = Schema.Null
export type ShowcaseFailResult = typeof ShowcaseFailResult.Type
