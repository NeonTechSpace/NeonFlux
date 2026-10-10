import { Schema } from "effect"
import { Id, Ids, Int, IsoTime, List, Millis, Text, origin } from "./common.ts"
import { canonicalPublishingContent, equalPublishingContent, PublishingContent, PublishingName } from "./publishing-base.ts"
import { ModerationActor, ModerationSource } from "./shared.ts"

// Welcome, DM and goodbye greetings, see docs/BOT.md#welcome-and-goodbye

const optional = Schema.optionalKey
/** A name the backend trims and lowercases before matching a template */
const nameInput = Schema.String.check(Schema.makeFilter((value: string) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value.trim().toLowerCase())))
const deliveryId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const cursor = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))
const claimToken = Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/))
const timing = Schema.Literals(["join", "verified"])

export const GreetingsRoute = Schema.Literals(["welcome", "dm", "goodbye"])
export type GreetingsRoute = typeof GreetingsRoute.Type
export const GreetingsRouteSettings = Schema.Struct({ revision: Int(1), enabled: Schema.Boolean, timing, channelId: optional(Id), templateName: optional(PublishingName),
    templateRevision: optional(Int(1)), content: optional(PublishingContent) })
export type GreetingsRouteSettings = typeof GreetingsRouteSettings.Type
/** An enabled route has its template copy, and a channel unless it is the DM route */
export const GreetingsSettings = Schema.Struct({ routes: Schema.Struct({ welcome: GreetingsRouteSettings, dm: GreetingsRouteSettings, goodbye: GreetingsRouteSettings }),
    claimsPerMinute: Int(1, 60), retentionDays: Int(30, 3650) }).check(Schema.makeFilter(v => v.routes.dm.channelId === undefined
        && [v.routes.welcome, v.routes.dm, v.routes.goodbye].every(r => !r.enabled || r.content !== undefined && r.templateName !== undefined && r.templateRevision !== undefined)
        && [v.routes.welcome, v.routes.goodbye].every(r => !r.enabled || r.channelId !== undefined)))
export type GreetingsSettings = typeof GreetingsSettings.Type
export const GreetingsMemberContext = Schema.Struct({ ...origin, userId: Id, userName: Text(128), serverName: Text(128), joinedAt: IsoTime, isBot: Schema.Boolean, roleIds: Ids(1000),
    timeoutUntil: Schema.NullOr(IsoTime) })
export type GreetingsMemberContext = typeof GreetingsMemberContext.Type
/** member is null exactly when the bot confirmed the member is absent */
export const GreetingsContext = Schema.Struct({ ...origin, botId: Id, botAuthorized: Schema.Boolean, observedAt: Millis, member: Schema.NullOr(GreetingsMemberContext), memberAbsent: Schema.Boolean,
    memberOriginServerId: optional(Id), memberUserId: optional(Id), channelId: optional(Id) }).check(Schema.makeFilter(v => (v.member === null) === v.memberAbsent))
export type GreetingsContext = typeof GreetingsContext.Type
export const GreetingsState = Schema.Literals(["waiting", "ready", "reserved", "sent", "failed", "uncertain", "cancelled", "expired"])
export type GreetingsState = typeof GreetingsState.Type

const bindingFields = { deliveryId, route: GreetingsRoute, routeRevision: Int(1), userId: Id, joinedAt: IsoTime, memberGeneration: Int(1) }
type Bound = { deliveryId: string, route: GreetingsRoute, routeRevision: number, userId: string, joinedAt: string, memberGeneration: number }
const sameBinding = (a: Bound, b: Bound) => a.deliveryId === b.deliveryId && a.route === b.route && a.routeRevision === b.routeRevision && a.userId === b.userId
    && a.joinedAt === b.joinedAt && a.memberGeneration === b.memberGeneration
/** A channel route's grant names its channel, and canonicalContent is the canonical form of content */
export const GreetingsGrant = Schema.Struct({ ...bindingFields, deliveryNo: Int(1), templateName: PublishingName, templateRevision: Int(1), botId: Id, channelId: optional(Id),
    content: PublishingContent, canonicalContent: PublishingContent, dispatchExpiresAt: Int(1), nativeDeadlineMs: Schema.Literal(5000) })
    .check(Schema.makeFilter(v => (v.route === "dm" ? v.channelId === undefined : v.channelId !== undefined) && equalPublishingContent(canonicalPublishingContent(v.content), v.canonicalContent)))
export type GreetingsGrant = typeof GreetingsGrant.Type
export const GreetingsDelivery = Schema.Struct({ ...bindingFields, deliveryNo: Int(1), state: GreetingsState, createdAt: Millis, pendingExpiresAt: Int(1), nextCheckAt: Millis,
    reason: optional(Schema.Literals(["verification", "eligibility", "configuration", "membership", "lifetime", "capacity"])), grant: optional(GreetingsGrant), claimedAt: optional(Millis),
    finishedAt: optional(Millis), noDispatch: optional(Schema.Literal(true)), messageId: optional(Id), channelId: optional(Id) })
    .check(Schema.makeFilter(v => (!v.grant || sameBinding(v, v.grant) && v.deliveryNo === v.grant.deliveryNo) && (!v.noDispatch || ["failed", "expired", "cancelled"].includes(v.state))
        && (v.messageId === undefined || v.channelId !== undefined)
        && (!["sent", "uncertain"].includes(v.state) || v.grant !== undefined && v.claimedAt !== undefined)
        && (v.state !== "sent" || v.messageId !== undefined && v.channelId !== undefined)
        && (v.claimedAt === undefined || !!v.grant && v.claimedAt < v.grant.dispatchExpiresAt)))
export type GreetingsDelivery = typeof GreetingsDelivery.Type
export const GreetingsBinding = Schema.Struct({ serverId: Id, ...bindingFields })
export type GreetingsBinding = typeof GreetingsBinding.Type

/** A channel route needs its channel and the DM route has none. Goodbye is sent on departure, so it has no verified timing */
export const GreetingsManageRequest = Schema.Struct({ ...ModerationSource.fields, serverId: Id, actor: ModerationActor, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("configure"), route: GreetingsRoute, templateName: nameInput, expectedTemplateRevision: Int(1), channelId: optional(Id), timing: optional(timing) })
        .check(Schema.makeFilter(v => (v.route === "dm" ? v.channelId === undefined : v.channelId !== undefined) && (v.route !== "goodbye" || v.timing === undefined || v.timing === "join"))),
    Schema.Struct({ type: Schema.Literal("module"), route: GreetingsRoute, enabled: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("clear"), route: GreetingsRoute }),
    Schema.Struct({ type: Schema.Literal("settings"), claimsPerMinute: optional(Int(1, 60)), retentionDays: optional(Int(30, 3650)) })
        .check(Schema.makeFilter(v => v.claimsPerMinute !== undefined || v.retentionDays !== undefined)),
]) })
export type GreetingsManageRequest = typeof GreetingsManageRequest.Type
export const GreetingsManageResult = Schema.Struct({ duplicate: Schema.Boolean, settings: GreetingsSettings })
export type GreetingsManageResult = typeof GreetingsManageResult.Type
export const GreetingsQueryRequest = Schema.Struct({ serverId: Id, actor: ModerationActor, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings") }),
    Schema.Struct({ type: Schema.Literal("member"), userId: Id }),
    Schema.Struct({ type: Schema.Literal("delivery"), deliveryNo: Int(1) }),
    Schema.Struct({ type: Schema.Literal("deliveries"), beforeDeliveryNo: optional(Int(1)) }),
    Schema.Struct({ type: Schema.Literal("preview"), route: GreetingsRoute, userId: Id, userName: Text(128), serverName: Text(128), channelId: Id }),
]) })
export type GreetingsQueryRequest = typeof GreetingsQueryRequest.Type
export const GreetingsMember = Schema.Struct({ userId: Id, joinedAt: IsoTime, generation: Int(1), present: Schema.Boolean, observedAt: Millis, expiresAt: Int(1) })
export type GreetingsMember = typeof GreetingsMember.Type
export const GreetingsQueryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings: GreetingsSettings }),
    Schema.Struct({ type: Schema.Literal("member"), member: Schema.NullOr(GreetingsMember) }),
    Schema.Struct({ type: Schema.Literal("delivery"), delivery: GreetingsDelivery }),
    Schema.Struct({ type: Schema.Literal("deliveries"), deliveries: List(GreetingsDelivery, 10), nextBeforeDeliveryNo: optional(Int(1)) }),
    Schema.Struct({ type: Schema.Literal("preview"), content: PublishingContent, canonicalContent: PublishingContent }),
])
export type GreetingsQueryResult = typeof GreetingsQueryResult.Type
export const GreetingsObserveRequest = Schema.Struct({ serverId: Id, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("join"), eventJoinedAt: IsoTime, observedAt: Millis, member: GreetingsMemberContext }),
    Schema.Struct({ type: Schema.Literal("present"), expectedGeneration: Int(1), observedAt: Millis, member: GreetingsMemberContext }),
    Schema.Struct({ ...origin, type: Schema.Literal("absent"), userId: Id, expectedGeneration: Int(1), joinedAt: IsoTime, observedAt: Millis, memberAbsent: Schema.Literal(true) }),
    Schema.Struct({ ...origin, type: Schema.Literal("departed"), userId: Id, userName: Text(128), serverName: Text(128), observedAt: Millis, memberAbsent: Schema.Literal(true) }),
]) })
export type GreetingsObserveRequest = typeof GreetingsObserveRequest.Type
export const GreetingsObserveResult = Schema.Struct({ recorded: Schema.Boolean, member: Schema.NullOr(GreetingsMember), admitted: Int(0, 2) })
export type GreetingsObserveResult = typeof GreetingsObserveResult.Type
/** A later page repeats the first page's scanAt with its cursor */
export const GreetingsPendingRequest = Schema.Struct({ serverId: Id, cursor: optional(cursor), userId: optional(Id), scanAt: optional(Millis) })
    .check(Schema.makeFilter(v => v.cursor === undefined || v.scanAt !== undefined))
export type GreetingsPendingRequest = typeof GreetingsPendingRequest.Type
const candidate = Schema.Struct({ ...bindingFields, channelId: optional(Id), hasEmbed: Schema.Boolean })
    .check(Schema.makeFilter(v => v.route === "dm" ? v.channelId === undefined : v.channelId !== undefined))
export const GreetingsPendingResult = Schema.Struct({ scanAt: Millis, candidates: List(candidate, 10), nextCursor: optional(cursor), nextClaimAt: Millis, nextCheckAt: optional(Millis) })
export type GreetingsPendingResult = typeof GreetingsPendingResult.Type
export const GreetingsReserveRequest = Schema.Struct({ ...GreetingsBinding.fields, context: GreetingsContext })
export type GreetingsReserveRequest = typeof GreetingsReserveRequest.Type
export const GreetingsReserveResult = Schema.Union([
    Schema.Struct({ status: Schema.Literal("reserved"), grant: GreetingsGrant }),
    Schema.Struct({ status: Schema.Literals(["waiting", "cancelled", "expired", "terminal"]) }),
])
export type GreetingsReserveResult = typeof GreetingsReserveResult.Type
export const GreetingsDispatchRequest = Schema.Struct({ ...GreetingsBinding.fields, claimToken, context: GreetingsContext })
export type GreetingsDispatchRequest = typeof GreetingsDispatchRequest.Type
export const GreetingsDispatchResult = Schema.Struct({ claimed: Schema.Boolean, dispatchExpiresAt: Int(1), nativeDeadlineMs: Schema.Literal(5000), nextClaimAt: Millis })
export type GreetingsDispatchResult = typeof GreetingsDispatchResult.Type
/** A message names its channel. A sent greeting names its message, and only a failed one that never dispatched carries noDispatch */
export const GreetingsOutcomeRequest = Schema.Struct({ ...GreetingsBinding.fields, claimToken: optional(claimToken), outcome: Schema.Literals(["sent", "failed", "uncertain"]),
    noDispatch: optional(Schema.Literal(true)), messageId: optional(Id), channelId: optional(Id) })
    .check(Schema.makeFilter(v => (v.messageId === undefined) === (v.channelId === undefined) && (v.outcome !== "sent" || v.messageId !== undefined)
        && (v.outcome === "failed") === (v.noDispatch === true) && (v.noDispatch !== true || v.messageId === undefined)))
export type GreetingsOutcomeRequest = typeof GreetingsOutcomeRequest.Type
export const GreetingsOutcomeResult = Schema.Struct({ recorded: Schema.Boolean })
export type GreetingsOutcomeResult = typeof GreetingsOutcomeResult.Type
export const GreetingsDeferRequest = Schema.Struct({ ...GreetingsBinding.fields, reason: Schema.Literals(["verification", "eligibility"]) })
export type GreetingsDeferRequest = typeof GreetingsDeferRequest.Type
export const GreetingsDeferResult = Schema.Struct({ deferred: Schema.Boolean })
export type GreetingsDeferResult = typeof GreetingsDeferResult.Type
export const GreetingsMemberRequest = Schema.Struct({ serverId: Id, userId: Id })
export type GreetingsMemberRequest = typeof GreetingsMemberRequest.Type
export const GreetingsMemberResult = Schema.Struct({ member: Schema.NullOr(GreetingsMember) })
export type GreetingsMemberResult = typeof GreetingsMemberResult.Type

export const GreetingsDiscoverRequest = GreetingsPendingRequest
export type GreetingsDiscoverRequest = typeof GreetingsDiscoverRequest.Type
export const GreetingsDiscoverResult = Schema.Struct({ scanAt: Millis, examined: Int(0, 10), queued: Int(0, 10), nextCursor: optional(cursor) })
export type GreetingsDiscoverResult = typeof GreetingsDiscoverResult.Type
