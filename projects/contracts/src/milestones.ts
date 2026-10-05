import { Schema } from "effect"
import { Id, Int, IsoTime, List, Millis, Text, Token, origin } from "./common.ts"
import { EventsMemberContext, ModerationSource } from "./shared.ts"
import { MilestonesDeliveryBinding, MilestonesKind, MilestonesTemplateSource, PublishingContent, PublishingGrant, PublishingMilestoneConsumer, PublishingObservation, PublishingPost,
    canonicalPublishingContent, equalPublishingContent, publishingGrantFields } from "./publishing-base.ts"
import { CivilFoldPolicy, CivilOffset, CivilZone, CivilZoneName } from "./civil.ts"
import { SchedulesAutomationContext, SchedulesContext, SchedulesDeliveryCursor, SchedulesDeliveryState, SchedulesNameInput } from "./schedules.ts"

// Birthdays and membership anniversaries, see docs/BOT.md#birthdays-and-membership-anniversaries

/** Delivery, member and cleanup pages hold at most 20 rows */
export const MILESTONES_BATCH = 20
const optional = Schema.optionalKey, isGrant = Schema.is(PublishingGrant)
const cursorText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))
const uniqueKinds = Schema.makeFilter((value: readonly { kind: MilestonesKind }[]) => new Set(value.map(row => row.kind)).size === value.length)
/** A local time of day, HH:mm */
export const MilestonesTime = Schema.String.check(Schema.isPattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/))
/** A birthday is a month and day, MM-DD, and may be 02-29. It never has a year */
export const MilestonesMonthDay = Schema.String.check(Schema.makeFilter((value: string) => {
    const date = new Date(`2000-${value}T00:00:00Z`)
    return /^\d\d-\d\d$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(5, 10) === value
}))
/** When a route posts. The backend checks a changed zone and time against the zone database */
export const MilestonesCivil = Schema.Struct({ zone: CivilZoneName, time: MilestonesTime, fold: CivilFoldPolicy })

export const MilestonesContext = SchedulesContext
export type MilestonesContext = typeof MilestonesContext.Type
export const MilestonesSettings = Schema.Struct({ enabled: Schema.Boolean, revision: Int(1), activatedAt: Millis })
export type MilestonesSettings = typeof MilestonesSettings.Type
/** One kind's channel, time and template. intentRevision changes with what a post would be, audienceGeneration when members must consent again */
export const MilestonesRoute = Schema.Struct({ kind: MilestonesKind, revision: Int(1), intentRevision: Int(1), audienceGeneration: Int(1), createdBy: Id, channelId: Id, zone: CivilZone, time: MilestonesTime,
    fold: CivilFoldPolicy, template: MilestonesTemplateSource, content: PublishingContent, canonicalContent: PublishingContent, enabled: Schema.Boolean, activatedAt: Millis, createdAt: Millis, updatedAt: Millis })
    .check(Schema.makeFilter(v => v.intentRevision <= v.revision && v.updatedAt >= v.createdAt && equalPublishingContent(v.canonicalContent, canonicalPublishingContent(v.content))))
export type MilestonesRoute = typeof MilestonesRoute.Type
const routes = List(MilestonesRoute, 2).check(uniqueKinds)
/** A verified one-to-one DM with a human, where members manage their own dates */
export const MilestonesDmIdentity = Schema.Struct({ ...origin, userId: Id, channelId: Id, isDirectMessage: Schema.Literal(true), isBot: Schema.Literal(false), observedAt: Millis })
export type MilestonesDmIdentity = typeof MilestonesDmIdentity.Type
/** The fresh read of the celebrated member in the destination, with the names a post shows */
export const MilestonesParticipantContext = Schema.Struct({ ...origin, observedAt: Millis, channelId: Id, botId: Id, member: EventsMemberContext, userName: Text(100), serverName: Text(100) })
export type MilestonesParticipantContext = typeof MilestonesParticipantContext.Type
export const MilestonesDeliveryContext = Schema.Struct({ automation: SchedulesAutomationContext, participant: MilestonesParticipantContext })
export type MilestonesDeliveryContext = typeof MilestonesDeliveryContext.Type
/** Consent holds for the route's channel and audience at the time. needsReconsent shows that the member must opt in again */
export const MilestonesEnrollment = Schema.Struct({ kind: MilestonesKind, revision: Int(1), joinedAt: IsoTime, audienceGeneration: Int(1), channelId: Id, consentedAt: Millis,
    monthDay: optional(MilestonesMonthDay), needsReconsent: Schema.Boolean }).check(Schema.makeFilter(v => v.kind === "birthday" ? v.monthDay !== undefined : v.monthDay === undefined))
export type MilestonesEnrollment = typeof MilestonesEnrollment.Type
const enroll = { confirmChannelId: Id, participant: MilestonesParticipantContext }
export const MilestonesPersonalRequest = Schema.Struct({ ...ModerationSource.fields, serverId: Id, identity: MilestonesDmIdentity, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("me") }),
    Schema.Struct({ type: Schema.Literal("enroll"), kind: Schema.Literal("birthday"), monthDay: MilestonesMonthDay, ...enroll }),
    Schema.Struct({ type: Schema.Literal("enroll"), kind: Schema.Literal("anniversary"), ...enroll }),
    Schema.Struct({ type: Schema.Literal("remove"), kind: Schema.Literals(["birthday", "anniversary", "all"]) }),
]) })
export type MilestonesPersonalRequest = typeof MilestonesPersonalRequest.Type
const duplicate = Schema.Struct({ duplicate: Schema.Literal(true) }), done = { duplicate: Schema.Literal(false) }
export const MilestonesPersonalResult = Schema.Union([duplicate, Schema.Struct({ ...done, type: Schema.Literal("me"), enrollments: List(MilestonesEnrollment, 2).check(uniqueKinds), routes }),
    Schema.Struct({ ...done, type: Schema.Literal("enrollment"), enrollment: MilestonesEnrollment }), Schema.Struct({ ...done, type: Schema.Literal("removed"), removed: Int(0, 2) })])
export type MilestonesPersonalResult = typeof MilestonesPersonalResult.Type
export const MilestonesDeliveryState = SchedulesDeliveryState
export type MilestonesDeliveryState = typeof MilestonesDeliveryState.Type
export const MilestonesDeliveryReason = Schema.Literals(["activation-cutoff", "late-window", "superseded", "cancelled", "permission", "capacity", "dispatch-expired", "consent", "membership", "civil-gap",
    "civil-fold", "consumed"])
export type MilestonesDeliveryReason = typeof MilestonesDeliveryReason.Type
export const MilestonesDelivery = Schema.Struct({ ...MilestonesDeliveryBinding.fields, channelId: Id, zone: CivilZone, dueAt: Millis, offsetMinutes: CivilOffset, state: MilestonesDeliveryState,
    nextCheckAt: Millis, claimedAt: optional(Millis), postNo: optional(Int(1)), attemptId: optional(Token), reason: optional(MilestonesDeliveryReason) })
    .check(Schema.makeFilter(v => (v.kind === "birthday" ? v.completedYears === 0 : v.completedYears >= 1) && (v.postNo === undefined) === (v.attemptId === undefined)
        && (v.claimedAt === undefined || v.postNo !== undefined) && (!["reserved", "sent", "uncertain"].includes(v.state) || v.postNo !== undefined)))
export type MilestonesDelivery = typeof MilestonesDelivery.Type
const deliveries = List(MilestonesDelivery, MILESTONES_BATCH).check(Schema.makeFilter(v => new Set(v.map(row => row.deliveryId)).size === v.length))
export const MilestonesDeliveryGrant = Schema.Struct({ ...publishingGrantFields, source: Schema.Struct({ type: Schema.Literal("milestone-timer"), deliveryId: Token, dueAt: Millis }),
    provenance: Schema.Struct({ type: Schema.Literal("milestone"), kind: MilestonesKind, intentRevision: Int(1), template: MilestonesTemplateSource }), consumer: PublishingMilestoneConsumer })
    .check(Schema.makeFilter(v => isGrant(v)))
export type MilestonesDeliveryGrant = typeof MilestonesDeliveryGrant.Type

export const MilestonesManageOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), expectedRevision: Int(1), enabled: Schema.Boolean }),
    // expectedRevision is 0 while the kind is not configured
    Schema.Struct({ type: Schema.Literal("configure"), kind: MilestonesKind, expectedRevision: Int(0), channelId: Id, ...MilestonesCivil.fields,
        template: Schema.Struct({ ...MilestonesTemplateSource.fields, name: SchedulesNameInput }) }),
    Schema.Struct({ type: Schema.Literals(["enable", "disable", "clear"]), kind: MilestonesKind, expectedRevision: Int(1) }),
    Schema.Struct({ type: Schema.Literal("reconcile"), binding: MilestonesDeliveryBinding, attemptId: Token, expectedGeneration: Int(1), observation: PublishingObservation }),
    Schema.Struct({ type: Schema.Literal("forget"), binding: MilestonesDeliveryBinding, confirm: Schema.Literal("forget") }),
])
export type MilestonesManageOperation = typeof MilestonesManageOperation.Type
export const MilestonesManageRequest = Schema.Struct({ ...ModerationSource.fields, serverId: Id, context: MilestonesContext, operation: MilestonesManageOperation })
export type MilestonesManageRequest = typeof MilestonesManageRequest.Type
export const MilestonesManageResult = Schema.Union([duplicate, Schema.Struct({ ...done, type: Schema.Literal("settings"), settings: MilestonesSettings }),
    Schema.Struct({ ...done, type: Schema.Literal("route"), route: MilestonesRoute }), Schema.Struct({ ...done, type: Schema.Literal("cleared"), kind: MilestonesKind }),
    Schema.Struct({ ...done, type: Schema.Literal("reconciled"), recorded: Schema.Boolean, post: PublishingPost }), Schema.Struct({ ...done, type: Schema.Literal("forgotten"), removed: Int() })])
export type MilestonesManageResult = typeof MilestonesManageResult.Type
export const MilestonesQueryRequest = Schema.Struct({ serverId: Id, context: MilestonesContext, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literals(["settings", "status"]) }),
    Schema.Struct({ type: Schema.Literal("preview"), kind: MilestonesKind }),
    Schema.Struct({ type: Schema.Literal("deliveries"), kind: MilestonesKind, cursor: optional(cursorText) }),
]) })
export type MilestonesQueryRequest = typeof MilestonesQueryRequest.Type
export const MilestonesQueryResult = Schema.Union([Schema.Struct({ type: Schema.Literal("settings"), settings: MilestonesSettings, routes }),
    Schema.Struct({ type: Schema.Literal("status"), settings: MilestonesSettings, routes, accounts: Int(0, 1000), enrollments: Int(0, 2000), deliveries: Int(0, 4000), staffReceipts: Int(0, 1000),
        memberReceipts: Int(0, 10000), publishing: Schema.Struct({ enabled: Schema.Boolean }), limits: Schema.Struct({ accounts: Schema.Literal(1000), slotsPerAccount: Schema.Literal(2),
            deliveries: Schema.Literal(4000), staffReceipts: Schema.Literal(1000), memberReceipts: Schema.Literal(10000) }) }),
    Schema.Struct({ type: Schema.Literal("preview"), route: MilestonesRoute, content: PublishingContent }), Schema.Struct({ type: Schema.Literal("deliveries"), deliveries, nextCursor: optional(cursorText) })])
export type MilestonesQueryResult = typeof MilestonesQueryResult.Type
export const MilestonesDeliveryCursor = SchedulesDeliveryCursor
export type MilestonesDeliveryCursor = typeof MilestonesDeliveryCursor.Type
/** Continues the membership cleanup of one raw join epoch after the observation that started it */
export const MilestonesMemberCursor = Schema.Struct({ cursor: cursorText, userId: Id, joinedAt: IsoTime, observedAt: Millis })
export type MilestonesMemberCursor = typeof MilestonesMemberCursor.Type
export const MilestonesMembershipObservation = Schema.Union([Schema.Struct({ ...origin, observedAt: Millis, userId: Id, status: Schema.Literal("absent") }),
    Schema.Struct({ ...origin, observedAt: Millis, userId: Id, status: Schema.Literal("present"), joinedAt: IsoTime })])
export type MilestonesMembershipObservation = typeof MilestonesMembershipObservation.Type
export const MilestonesMemberTarget = Schema.Struct({ kind: MilestonesKind, userId: Id, joinedAt: IsoTime, consentRevision: Int(1), consentedAt: Millis })
export type MilestonesMemberTarget = typeof MilestonesMemberTarget.Type
export const MilestonesDeliveryRequest = Schema.Struct({ serverId: Id, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("list"), cursor: optional(MilestonesDeliveryCursor) }),
    Schema.Struct({ type: Schema.Literal("reserve"), binding: MilestonesDeliveryBinding, context: MilestonesDeliveryContext }),
    Schema.Struct({ type: Schema.Literal("defer"), binding: MilestonesDeliveryBinding }),
    Schema.Struct({ type: Schema.Literal("membership"), binding: MilestonesDeliveryBinding, observation: MilestonesMembershipObservation, cursor: optional(MilestonesMemberCursor) }),
    Schema.Struct({ type: Schema.Literal("member-targets"), userId: Id, cursor: optional(cursorText) }),
    Schema.Struct({ type: Schema.Literal("member-observation"), target: MilestonesMemberTarget, observation: MilestonesMembershipObservation }),
]) })
export type MilestonesDeliveryRequest = typeof MilestonesDeliveryRequest.Type
export const MilestonesDeliveryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("deliveries"), deliveries, hasMore: Schema.Boolean, nextCursor: optional(MilestonesDeliveryCursor) }),
    Schema.Struct({ type: Schema.Literal("reservation"), status: Schema.Literal("reserved"), grant: MilestonesDeliveryGrant }),
    Schema.Struct({ type: Schema.Literal("reservation"), status: Schema.Literals(["waiting", "skipped", "cancelled", "terminal"]) }),
    Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean, hasMore: optional(Schema.Boolean), nextCursor: optional(MilestonesMemberCursor) }),
    Schema.Struct({ type: Schema.Literal("member-targets"), targets: List(MilestonesMemberTarget, MILESTONES_BATCH), hasMore: Schema.Boolean, nextCursor: optional(cursorText) }),
])
export type MilestonesDeliveryResult = typeof MilestonesDeliveryResult.Type
