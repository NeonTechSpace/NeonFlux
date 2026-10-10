import { Schema } from "effect"
import { Id, Int, IsoTime, List, Millis, Str, isId, origin } from "./common.ts"
import { EventsMemberContext, ModerationActor, ModerationSource } from "./shared.ts"

export const CLEANUP_DAY = 86400000, CLEANUP_RETENTION = 30 * CLEANUP_DAY, CLEANUP_GRANT_MS = 120000, CLEANUP_SETTLE_MS = 10000
export const CLEANUP_EPOCH = 1420070400000
export const CleanupAge = Int(3600000, 365 * CLEANUP_DAY)
const text = (max = 128) => Str(max).check(Schema.isMinLength(1))
const cursorId = Schema.Union([Id, Schema.Literal("0")])
export const CleanupContext = Schema.Struct({ ...origin, observedAt: Millis, actor: ModerationActor, member: EventsMemberContext, channelId: Id, channelType: Schema.Literals([0, 5]), botId: Id, botAuthorized: Schema.Boolean, actorAuthorized: Schema.Boolean, actorKind: Schema.Literals(["human", "bot", "unknown"]), botKind: Schema.Literals(["bot", "unknown"]), botMember: EventsMemberContext })

export const CleanupSettings = Schema.Struct({ enabled: Schema.Boolean, revision: Int(1), policies: Schema.mutableKey(Int(0, 50)), retainedTargets: Int(), retainedSweeps: Int(), receipts: Int(), targetCapacity: Schema.Literal(10000), quotaPaused: Schema.Boolean })
export const CleanupPolicy = Schema.Struct({ channelId: Id, revision: Schema.mutableKey(Int(1)), enabled: Schema.mutableKey(Schema.Boolean), ageMs: Int(3600000, 31536000000), ownerId: Id, excludedAuthorIds: List(Id, 50), excludedMessageIds: List(Id, 100), nextCheckAt: Int(), sweepNo: Schema.optionalKey(Int(1)), blockedReason: Schema.optionalKey(text()) }).check(Schema.makeFilter(v => new Set(v.excludedAuthorIds).size === v.excludedAuthorIds.length && new Set(v.excludedMessageIds).size === v.excludedMessageIds.length))
export const CleanupMessage = Schema.Struct({ ...origin, messageId: Id, channelId: Id, serverId: Schema.NullOr(Id), observedAt: Int(), createdAt: Schema.NullOr(text()), authorId: Schema.mutableKey(Schema.NullOr(Id)), authorBot: Schema.NullOr(Schema.Boolean), authorSystem: Schema.NullOr(Schema.Boolean), type: Schema.NullOr(Int(0, 2147483647)), pinned: Schema.NullOr(Schema.Boolean), webhookId: Schema.NullOr(Id) })
export const CleanupCounts = Schema.Struct({ scanned: Int(), skipped: Int(), attempted: Int(), submitted: Int(), acknowledged: Int(), observedAbsent: Int(), unresolved: Int(), failed: Int(), cancelled: Int() })
export const CleanupSweepBinding = Schema.Struct({ channelId: Id, policyRevision: Int(1), moduleRevision: Int(1), sweepNo: Int(1) })
const sweepFields = CleanupSweepBinding.fields
export const CleanupTargetBinding = Schema.Struct({ ...sweepFields, pageNo: Int(1), targetNo: Int(1), messageId: Id })
const targetFields = CleanupTargetBinding.fields
export const CleanupTargetState = Schema.Literals(["queued", "reserved", "deleted", "failed", "uncertain", "absent", "skipped", "cancelled"])
/** A sweep reads the policy channel's history, then each active thread of it in turn. threadId names the thread being read */
export const CleanupSweep = Schema.Struct({ ...sweepFields, threadId: Schema.optionalKey(Id), ownerId: Id, cutoffAt: Int(), before: cursorId, pageNo: Int(1), state: Schema.Literals(["active", "complete", "cancelled"]), counts: CleanupCounts, createdAt: Int(), updatedAt: Int() }).check(Schema.makeFilter(v => v.updatedAt >= v.createdAt))
export const CleanupSkipReason = Schema.Literals(["pinned", "pin-unknown", "bot", "webhook", "system", "identity-unknown", "timestamp-unknown", "too-new", "excluded-author", "excluded-message", "protected", "retained-attempt"])
export const CleanupPageItem = Schema.Struct({ message: CleanupMessage, disposition: Schema.Literals(["eligible", "skipped"]), reason: Schema.optionalKey(CleanupSkipReason), targetNo: Schema.mutableKey(Schema.optionalKey(Int(1))) }).check(Schema.makeFilter(v => v.disposition === "skipped" ? v.reason !== undefined && v.targetNo === undefined : v.reason === undefined))
export const CleanupPage = Schema.Struct({ ...sweepFields, threadId: Schema.optionalKey(Id), pageNo: Int(1), before: cursorId, nextBefore: Schema.optionalKey(Id), empty: Schema.Boolean, items: List(CleanupPageItem, 50), persistedAt: Int() }).check(Schema.makeFilter(v => v.empty === (v.items.length === 0) && (v.empty ? v.nextBefore === undefined : v.nextBefore === v.items.at(-1)?.message.messageId) && v.items.every((m, index) => m.message.channelId === (v.threadId ?? v.channelId) && BigInt(m.message.messageId) < BigInt(index ? v.items[index - 1]!.message.messageId : v.before))))
export const CleanupGrant = Schema.Struct({ ...targetFields, ownerId: Id, botId: Id, cutoffAt: Int(), createdAt: text(), authorId: Id, dispatchExpiresAt: Int(), nativeDeadlineMs: Schema.Literal(5000) }).check(Schema.makeFilter(v => { const timestamp = cleanupTimestamp(v.messageId, v.createdAt); return timestamp !== undefined && timestamp < v.cutoffAt }))
export const CleanupObservation = Schema.Struct({ ...origin, messageId: Id, channelId: Id, observedAt: Int(), status: Schema.Literals(["present", "absent", "unknown"]), channelVisible: Schema.Boolean })
export const CleanupTarget = Schema.Struct({ ...targetFields, threadId: Schema.optionalKey(Id), ownerId: Id, state: CleanupTargetState, message: CleanupMessage, createdAt: Int(), updatedAt: Int(), grant: Schema.optionalKey(CleanupGrant), claimedAt: Schema.optionalKey(Int()), finishedAt: Schema.optionalKey(Int()), noDispatch: Schema.optionalKey(Schema.Literal(true)), expiresAt: Schema.optionalKey(Int()), reason: Schema.optionalKey(text()), observation: Schema.optionalKey(CleanupObservation), lateOutcome: Schema.optionalKey(Schema.Literals(["deleted", "failed", "uncertain"])), reassessedAt: Schema.optionalKey(Int()) }).check(Schema.makeFilter(v => v.message.messageId === v.messageId && v.message.channelId === (v.threadId ?? v.channelId) && (!v.grant || sameCleanupBinding(v, v.grant) && v.grant.ownerId === v.ownerId) && (!v.observation || v.observation.messageId === v.messageId && v.observation.channelId === v.channelId && (v.observation.status !== "absent" || v.observation.channelVisible)) && v.updatedAt >= v.createdAt))
const targets = List(CleanupTarget, 50)
export const CleanupQueryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings: CleanupSettings }), Schema.Struct({ type: Schema.Literal("policies"), policies: List(CleanupPolicy, 50) }), Schema.Struct({ type: Schema.Literal("policy"), policy: CleanupPolicy }),
    Schema.Struct({ type: Schema.Literal("status"), settings: CleanupSettings, policy: CleanupPolicy, sweep: Schema.NullOr(CleanupSweep), page: Schema.NullOr(CleanupPage), targets: List(CleanupTarget, 10), nextBeforeTargetNo: Schema.optionalKey(Int(1)) }),
    Schema.Struct({ type: Schema.Literal("preview"), cutoffAt: Int(), eligible: Int(0, 50), skipped: Int(0, 50), unknown: Int(0, 50), items: List(CleanupPageItem, 50) }),
])
export const CleanupManageResult = Schema.Union([Schema.Struct({ duplicate: Schema.Literal(true) }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings: CleanupSettings }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("policy"), policy: CleanupPolicy }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("reconciled"), recorded: Schema.Boolean, target: CleanupTarget }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("forgotten"), removed: Int(0, 20), complete: Schema.Boolean })])
export const CleanupWorkCursor = Schema.Struct({ cursor: Str(8192), throughAt: Millis })
export const CleanupWorkResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("policies"), policies: List(CleanupPolicy, 20), hasMore: Schema.Boolean, nextCursor: Schema.optionalKey(CleanupWorkCursor.check(Schema.makeFilter(v => v.cursor.length > 0 && v.cursor.length <= 4096))), settings: CleanupSettings }),
    Schema.Struct({ type: Schema.Literal("sweep"), sweep: CleanupSweep, page: Schema.NullOr(CleanupPage), targets }), Schema.Struct({ type: Schema.Literal("page"), page: Schema.NullOr(CleanupPage), targets, quotaPaused: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("reserved"), grant: CleanupGrant }), Schema.Struct({ type: Schema.Literal("claimed"), claimed: Schema.Boolean, grant: CleanupGrant }),
    Schema.Struct({ type: Schema.Literal("recovery"), targets, nextBeforeTargetNo: Schema.optionalKey(Int(1)) }), Schema.Struct({ type: Schema.Literal("target"), recorded: Schema.Boolean, target: CleanupTarget }), Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean, complete: Schema.Boolean }),
])

export const CleanupMessageInput = CleanupMessage.check(Schema.makeFilter(v => (v.type === null || v.type <= 65535) && (v.createdAt === null || Schema.is(IsoTime)(v.createdAt))))
export const CleanupManageOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("module"), expectedRevision: Int(1), enabled: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("configure"), channelId: Id, expectedRevision: Int(), ageMs: CleanupAge }),
    Schema.Struct({ type: Schema.Literal("enable"), channelId: Id, expectedRevision: Int(1), enabled: Schema.Boolean, confirm: Schema.optionalKey(Schema.Literal(true)) }),
    Schema.Struct({ type: Schema.Literal("exclude"), channelId: Id, expectedRevision: Int(1), kind: Schema.Literals(["author", "message"]), id: Id, add: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("owner"), channelId: Id, expectedRevision: Int(1), ownerId: Id, recipientOwner: CleanupContext }),
    Schema.Struct({ type: Schema.Literal("reconcile"), binding: CleanupTargetBinding, observation: CleanupObservation }),
    Schema.Struct({ type: Schema.Literal("forget"), channelId: Id, confirm: Schema.Literal(true) }),
])
export const CleanupPolicyDeleteOperation = Schema.Struct({ type: Schema.Literal("policy-delete"), channelId: Id, expectedRevision: Int(1), confirm: Schema.Literal(true) })
export const CleanupManagementOperation = Schema.Union([CleanupManageOperation, CleanupPolicyDeleteOperation])
export const CleanupManageRequest = Schema.Struct({ ...ModerationSource.fields, serverId: Id, context: CleanupContext, operation: CleanupManageOperation })
export const CleanupPolicyDeleteRequest = Schema.Struct({ ...CleanupManageRequest.fields, operation: CleanupPolicyDeleteOperation })
export const CleanupQueryRequest = Schema.Struct({ serverId: Id, context: CleanupContext, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings") }), Schema.Struct({ type: Schema.Literal("list") }), Schema.Struct({ type: Schema.Literal("show"), channelId: Id }),
    Schema.Struct({ type: Schema.Literal("status"), channelId: Id, beforeTargetNo: Schema.optionalKey(Int(1)) }),
    Schema.Struct({ type: Schema.Literal("preview"), channelId: Id, messages: List(CleanupMessageInput, 50) }),
]) })
export const CleanupWorkRequest = Schema.Struct({ serverId: Id, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("list"), cursor: Schema.optionalKey(CleanupWorkCursor) }),
    Schema.Struct({ type: Schema.Literal("start"), channelId: Id, expectedRevision: Int(1), context: CleanupContext }),
    Schema.Struct({ type: Schema.Literal("page"), binding: CleanupSweepBinding, pageNo: Int(1), before: Id, messages: List(CleanupMessageInput, 50), context: CleanupContext }),
    /** After an empty page, nextThreadId moves the sweep to that thread of the channel instead of completing it */
    Schema.Struct({ type: Schema.Literal("advance"), binding: CleanupSweepBinding, pageNo: Int(1), nextThreadId: Schema.optionalKey(Id) }),
    Schema.Struct({ type: Schema.Literal("defer"), channelId: Id, expectedRevision: Int(1), reason: Schema.Literals(["authority", "history", "malformed", "quota", "target"]) }),
    Schema.Struct({ type: Schema.Literal("reserve"), binding: CleanupTargetBinding, message: CleanupMessageInput, context: CleanupContext }),
    Schema.Struct({ type: Schema.Literal("claim"), binding: CleanupTargetBinding, message: CleanupMessageInput, context: CleanupContext, claimToken: Schema.String.check(Schema.isPattern(/^[a-f0-9]{32,128}$/i)) }),
    Schema.Struct({ type: Schema.Literal("check"), binding: CleanupTargetBinding, message: CleanupMessageInput, context: CleanupContext, claimToken: Schema.String.check(Schema.isPattern(/^[a-f0-9]{32,128}$/i)) }),
    Schema.Struct({ type: Schema.Literal("outcome"), binding: CleanupTargetBinding, outcome: Schema.Literals(["deleted", "failed", "uncertain", "absent", "skipped"]), claimToken: Schema.optionalKey(Schema.String), noDispatch: Schema.optionalKey(Schema.Literal(true)), observation: Schema.optionalKey(CleanupObservation) }),
    Schema.Struct({ type: Schema.Literal("recover"), binding: CleanupTargetBinding, observation: CleanupObservation }),
    Schema.Struct({ type: Schema.Literal("recovery"), beforeTargetNo: Schema.optionalKey(Int(1)) }),
]) })

export function cleanupTimestamp(messageId: string, createdAt: string | null) {
    if (!isId(messageId) || createdAt === null || createdAt.length > 128 || !/^\d{4}-\d\d-\d\dT/.test(createdAt)) return undefined
    const timestamp = Date.parse(createdAt)
    return Number.isSafeInteger(timestamp) && timestamp >= 0 && Number((BigInt(messageId) >> 22n) + BigInt(CLEANUP_EPOCH)) === timestamp ? timestamp : undefined
}
export function sameCleanupBinding(a: CleanupTargetBinding, b: CleanupTargetBinding) { return a.channelId === b.channelId && a.policyRevision === b.policyRevision && a.moduleRevision === b.moduleRevision && a.sweepNo === b.sweepNo && a.pageNo === b.pageNo && a.targetNo === b.targetNo && a.messageId === b.messageId }
export type CleanupAge = typeof CleanupAge.Type
export type CleanupContext = typeof CleanupContext.Type
export type CleanupSettings = typeof CleanupSettings.Type
export type CleanupPolicy = typeof CleanupPolicy.Type
export type CleanupMessage = typeof CleanupMessage.Type
export type CleanupCounts = typeof CleanupCounts.Type
export type CleanupSweepBinding = typeof CleanupSweepBinding.Type
export type CleanupTargetBinding = typeof CleanupTargetBinding.Type
export type CleanupTargetState = typeof CleanupTargetState.Type
export type CleanupSweep = typeof CleanupSweep.Type
export type CleanupSkipReason = typeof CleanupSkipReason.Type
export type CleanupPageItem = typeof CleanupPageItem.Type
export type CleanupPage = typeof CleanupPage.Type
export type CleanupGrant = typeof CleanupGrant.Type
export type CleanupObservation = typeof CleanupObservation.Type
export type CleanupTarget = typeof CleanupTarget.Type
export type CleanupQueryResult = typeof CleanupQueryResult.Type
export type CleanupManageResult = typeof CleanupManageResult.Type
export type CleanupWorkCursor = typeof CleanupWorkCursor.Type
export type CleanupWorkResult = typeof CleanupWorkResult.Type
export type CleanupManageOperation = typeof CleanupManageOperation.Type
export type CleanupPolicyDeleteOperation = typeof CleanupPolicyDeleteOperation.Type
export type CleanupManagementOperation = typeof CleanupManagementOperation.Type
export type CleanupManageRequest = typeof CleanupManageRequest.Type
export type CleanupPolicyDeleteRequest = typeof CleanupPolicyDeleteRequest.Type
export type CleanupQueryRequest = typeof CleanupQueryRequest.Type
export type CleanupWorkRequest = typeof CleanupWorkRequest.Type
export type CleanupMessageInput = typeof CleanupMessageInput.Type
