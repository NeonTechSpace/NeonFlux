import { Schema } from "effect"
import { Id, Int, List, Millis, Token, origin } from "./common.ts"
import { EventsMemberContext, ModerationActor, ModerationSource } from "./shared.ts"
import { PublishingContent, PublishingGrant, PublishingName, PublishingObservation, PublishingPost, PublishingScheduleConsumer, SchedulesContentSource, canonicalPublishingContent, equalPublishingContent,
    publishingGrantFields } from "./publishing-base.ts"
import { CivilLocalMinute, CivilOffset, CivilZone, civilAt, civilIntent, civilSeries } from "./civil.ts"

// Scheduled publishing, see docs/BOT.md#scheduled-publishing

/** Delivery pages, cleanup passes and forget selections hold at most 20 rows */
export const SCHEDULES_BATCH = 20
const optional = Schema.optionalKey, isName = Schema.is(PublishingName), isGrant = Schema.is(PublishingGrant)
const cursorText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))
const canonical = (value: { content: PublishingContent, canonicalContent: PublishingContent }) => equalPublishingContent(value.canonicalContent, canonicalPublishingContent(value.content))
/** A draft, template or schedule name as a request may spell it. The backend trims and lowercases it */
export const SchedulesNameInput = Schema.String.check(Schema.makeFilter((value: string) => isName(value.trim().toLowerCase())))
export const SchedulesSourceInput = Schema.Struct({ ...SchedulesContentSource.fields, name: SchedulesNameInput })

export const SchedulesResolvedDate = Schema.Struct({ localMinute: CivilLocalMinute, dueAt: Millis, offsetMinutes: CivilOffset }).check(Schema.makeFilter(v => civilAt(v.localMinute, v.dueAt, v.offsetMinutes)))
export type SchedulesResolvedDate = typeof SchedulesResolvedDate.Type
/** The dates are resolved once when the calendar is set. Other edits copy them, so a changed zone database never moves a planned post */
export const SchedulesCalendar = Schema.Struct({ ...civilIntent, dates: List(SchedulesResolvedDate, 26) }).check(Schema.makeFilter(v => civilSeries(v, v.dates.map(date => date.dueAt))))
export type SchedulesCalendar = typeof SchedulesCalendar.Type
export const SchedulesMemberContext = EventsMemberContext
export type SchedulesMemberContext = typeof SchedulesMemberContext.Type
/** The fresh native read of the member who asked, and of the bot, in the channel a change names */
export const SchedulesContext = Schema.Struct({ ...origin, observedAt: Millis, actor: ModerationActor, channelId: Id, botId: Id, botAuthorized: Schema.Boolean, actorAuthorized: Schema.Boolean,
    member: optional(SchedulesMemberContext) })
export type SchedulesContext = typeof SchedulesContext.Type
/** Automatic deliveries carry the bot's fresh permission to post in the destination */
export const SchedulesAutomationContext = Schema.Struct({ ...origin, observedAt: Millis, channelId: Id, botId: Id, botAuthorized: Schema.Literal(true) })
export type SchedulesAutomationContext = typeof SchedulesAutomationContext.Type
/** The draft or template content as it was when the schedule took it */
export const SchedulesSnapshot = Schema.Struct({ source: SchedulesContentSource, content: PublishingContent, canonicalContent: PublishingContent }).check(Schema.makeFilter(canonical))
export type SchedulesSnapshot = typeof SchedulesSnapshot.Type
export const SchedulesSettings = Schema.Struct({ enabled: Schema.Boolean, revision: Int(1), activatedAt: Millis })
export type SchedulesSettings = typeof SchedulesSettings.Type
export const SchedulesDefinition = Schema.Struct({ ...SchedulesSnapshot.fields, scheduleNo: Int(1), name: PublishingName, revision: Int(1), planRevision: Int(1), createdBy: Id, channelId: Id,
    calendar: SchedulesCalendar, enabled: Schema.Boolean, cancelled: Schema.Boolean, activatedAt: Millis, createdAt: Millis, updatedAt: Millis })
    .check(Schema.makeFilter(v => canonical(v) && v.updatedAt >= v.createdAt && v.planRevision <= v.revision && (!v.cancelled || !v.enabled)))
export type SchedulesDefinition = typeof SchedulesDefinition.Type
export const SchedulesDeliveryBinding = Schema.Struct({ deliveryId: Token, scheduleNo: Int(1), planRevision: Int(1), occurrenceNo: Int(1) })
export type SchedulesDeliveryBinding = typeof SchedulesDeliveryBinding.Type
export const SchedulesDeliveryState = Schema.Literals(["queued", "blocked", "reserved", "sent", "failed", "uncertain", "skipped", "cancelled", "superseded"])
export type SchedulesDeliveryState = typeof SchedulesDeliveryState.Type
export const SchedulesDeliveryReason = Schema.Literals(["activation-cutoff", "late-window", "superseded", "cancelled", "permission", "capacity", "dispatch-expired"])
export type SchedulesDeliveryReason = typeof SchedulesDeliveryReason.Type
/** One planned post. postNo and attemptId name its publishing attempt once it is reserved */
export const SchedulesDelivery = Schema.Struct({ ...SchedulesDeliveryBinding.fields, ...SchedulesSnapshot.fields, channelId: Id, localMinute: CivilLocalMinute, zone: CivilZone, offsetMinutes: CivilOffset,
    dueAt: Millis, state: SchedulesDeliveryState, nextCheckAt: Millis, claimedAt: optional(Millis), postNo: optional(Int(1)), attemptId: optional(Token), reason: optional(SchedulesDeliveryReason) })
    .check(Schema.makeFilter(v => canonical(v) && civilAt(v.localMinute, v.dueAt, v.offsetMinutes) && (v.postNo === undefined) === (v.attemptId === undefined)
        && (v.claimedAt === undefined || v.postNo !== undefined) && (!["reserved", "sent", "uncertain"].includes(v.state) || v.postNo !== undefined)))
export type SchedulesDelivery = typeof SchedulesDelivery.Type
export const SchedulesDeliveryGrant = Schema.Struct({ ...publishingGrantFields, source: Schema.Struct({ type: Schema.Literal("schedule-timer"), deliveryId: Token, dueAt: Millis }),
    provenance: Schema.Struct({ type: Schema.Literal("schedule"), scheduleNo: Int(1), planRevision: Int(1), source: SchedulesContentSource }), consumer: PublishingScheduleConsumer })
    .check(Schema.makeFilter(v => isGrant(v)))
export type SchedulesDeliveryGrant = typeof SchedulesDeliveryGrant.Type

const scheduled = { scheduleNo: Int(1), expectedRevision: Int(1) }
export const SchedulesManageOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), expectedRevision: Int(1), enabled: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("create"), name: SchedulesNameInput, source: SchedulesSourceInput, channelId: Id, calendar: SchedulesCalendar }),
    Schema.Struct({ type: Schema.Literal("content"), ...scheduled, source: SchedulesSourceInput }),
    Schema.Struct({ type: Schema.Literal("calendar"), ...scheduled, calendar: SchedulesCalendar }),
    Schema.Struct({ type: Schema.Literal("destination"), ...scheduled, channelId: Id }),
    Schema.Struct({ type: Schema.Literals(["enable", "disable", "cancel"]), ...scheduled }),
    Schema.Struct({ type: Schema.Literal("reconcile"), ...scheduled, deliveryId: Token, attemptId: Token, expectedGeneration: Int(1), observation: PublishingObservation }),
    // Without occurrenceNos a forget removes the first 20 dates, which must all be settled
    Schema.Struct({ type: Schema.Literal("forget"), ...scheduled, confirm: Schema.Literal("forget"),
        occurrenceNos: optional(List(Int(1), SCHEDULES_BATCH).check(Schema.isMinLength(1), Schema.makeFilter(v => new Set(v).size === v.length))) }),
])
export type SchedulesManageOperation = typeof SchedulesManageOperation.Type
export const SchedulesManageRequest = Schema.Struct({ ...ModerationSource.fields, serverId: Id, context: SchedulesContext, operation: SchedulesManageOperation })
export type SchedulesManageRequest = typeof SchedulesManageRequest.Type
const done = { duplicate: Schema.Literal(false) }
export const SchedulesManageResult = Schema.Union([Schema.Struct({ duplicate: Schema.Literal(true) }), Schema.Struct({ ...done, type: Schema.Literal("settings"), settings: SchedulesSettings }),
    Schema.Struct({ ...done, type: Schema.Literal("schedule"), schedule: SchedulesDefinition }), Schema.Struct({ ...done, type: Schema.Literal("reconciled"), recorded: Schema.Boolean, post: PublishingPost }),
    Schema.Struct({ ...done, type: Schema.Literal("forgotten"), scheduleNo: Int(1), complete: Schema.Boolean, removed: Int() })])
export type SchedulesManageResult = typeof SchedulesManageResult.Type
export const SchedulesQueryRequest = Schema.Struct({ serverId: Id, context: SchedulesContext, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literals(["settings", "status"]) }),
    Schema.Struct({ type: Schema.Literal("list"), beforeScheduleNo: optional(Int(1)) }),
    Schema.Struct({ type: Schema.Literal("show"), scheduleNo: Int(1) }),
    /** Schedule names are unique in a server, so the bot finds the schedule a command names this way */
    Schema.Struct({ type: Schema.Literal("show"), name: SchedulesNameInput }),
    Schema.Struct({ type: Schema.Literal("deliveries"), scheduleNo: Int(1), afterOccurrenceNo: optional(Int(1)) }),
]) })
export type SchedulesQueryRequest = typeof SchedulesQueryRequest.Type
export const SchedulesQueryResult = Schema.Union([Schema.Struct({ type: Schema.Literal("settings"), settings: SchedulesSettings }),
    Schema.Struct({ type: Schema.Literal("status"), settings: SchedulesSettings, definitions: Int(0, 50), deliveries: Int(0, 200), receipts: Int(0, 1000), publishing: Schema.Struct({ enabled: Schema.Boolean }),
        limits: Schema.Struct({ definitions: Schema.Literal(50), deliveries: Schema.Literal(200), receipts: Schema.Literal(1000) }) }),
    Schema.Struct({ type: Schema.Literal("schedules"), schedules: List(SchedulesDefinition, SCHEDULES_BATCH), nextBeforeScheduleNo: optional(Int(1)) }),
    Schema.Struct({ type: Schema.Literal("schedule"), schedule: SchedulesDefinition }),
    Schema.Struct({ type: Schema.Literal("deliveries"), deliveries: List(SchedulesDelivery, SCHEDULES_BATCH), nextAfterOccurrenceNo: optional(Int(1)) })])
export type SchedulesQueryResult = typeof SchedulesQueryResult.Type
/** The bot passes the cursor of a page back for the next one. throughAt keeps a pass to the deliveries due when it began */
export const SchedulesDeliveryCursor = Schema.Struct({ cursor: cursorText, throughAt: Millis })
export type SchedulesDeliveryCursor = typeof SchedulesDeliveryCursor.Type
export const SchedulesDeliveryRequest = Schema.Struct({ serverId: Id, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("list"), cursor: optional(SchedulesDeliveryCursor) }),
    Schema.Struct({ type: Schema.Literal("reserve"), binding: SchedulesDeliveryBinding, context: SchedulesAutomationContext }),
    Schema.Struct({ type: Schema.Literal("defer"), binding: SchedulesDeliveryBinding }),
]) })
export type SchedulesDeliveryRequest = typeof SchedulesDeliveryRequest.Type
export const SchedulesDeliveryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("deliveries"), deliveries: List(SchedulesDelivery, SCHEDULES_BATCH), hasMore: Schema.Boolean, nextCursor: optional(SchedulesDeliveryCursor) }),
    Schema.Struct({ type: Schema.Literal("reservation"), status: Schema.Literal("reserved"), grant: SchedulesDeliveryGrant }),
    Schema.Struct({ type: Schema.Literal("reservation"), status: Schema.Literals(["waiting", "skipped", "cancelled", "terminal"]) }),
    Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean }),
])
export type SchedulesDeliveryResult = typeof SchedulesDeliveryResult.Type
