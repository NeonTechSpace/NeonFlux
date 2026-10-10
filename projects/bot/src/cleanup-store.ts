import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { cleanupTimestamp } from "./cleanup-permissions.ts"

const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= min && v <= max))
const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const cursorId = Schema.String.check(Schema.makeFilter(snowflakes.isValid))
const text = (max = 128) => Schema.String.check(Schema.makeFilter(v => v.length > 0 && v.length <= max))
const optional = Schema.optionalKey
const array = <A>(schema: Schema.Codec<A>, max: number) => Schema.mutable(Schema.Array(schema)).check(Schema.isMaxLength(max))
export const cleanupSettingsSchema = Schema.Struct({ enabled: Schema.Boolean, revision: integer(1), policies: integer(0, 50), retainedTargets: integer(), retainedSweeps: integer(), receipts: integer(), targetCapacity: Schema.Literal(10000), quotaPaused: Schema.Boolean })
export const cleanupPolicySchema = Schema.Struct({ channelId: id, revision: integer(1), enabled: Schema.Boolean, ageMs: integer(3600000, 31536000000), ownerId: id, excludedAuthorIds: array(id, 50), excludedMessageIds: array(id, 100), nextCheckAt: integer(), sweepNo: optional(integer(1)), blockedReason: optional(text()) }).check(Schema.makeFilter(v => new Set(v.excludedAuthorIds).size === v.excludedAuthorIds.length && new Set(v.excludedMessageIds).size === v.excludedMessageIds.length))
export const cleanupMessageSchema = Schema.Struct({ messageId: id, channelId: id, serverId: Schema.NullOr(id), observedAt: integer(), createdAt: Schema.NullOr(text()), authorId: Schema.NullOr(id), authorBot: Schema.NullOr(Schema.Boolean), authorSystem: Schema.NullOr(Schema.Boolean), type: Schema.NullOr(integer(0, 2147483647)), pinned: Schema.NullOr(Schema.Boolean), webhookId: Schema.NullOr(id) })
const counts = Schema.Struct({ scanned: integer(), skipped: integer(), attempted: integer(), submitted: integer(), acknowledged: integer(), observedAbsent: integer(), unresolved: integer(), failed: integer(), cancelled: integer() })
const sweepFields = { channelId: id, policyRevision: integer(1), moduleRevision: integer(1), sweepNo: integer(1) }
const targetFields = { ...sweepFields, pageNo: integer(1), targetNo: integer(1), messageId: id }
export const cleanupSweepSchema = Schema.Struct({ ...sweepFields, threadId: optional(id), ownerId: id, cutoffAt: integer(), before: cursorId, pageNo: integer(1), state: Schema.Literals(["active", "complete", "cancelled"]), counts, createdAt: integer(), updatedAt: integer() }).check(Schema.makeFilter(v => v.updatedAt >= v.createdAt))
const skipReason = Schema.Literals(["pinned", "pin-unknown", "bot", "webhook", "system", "identity-unknown", "timestamp-unknown", "too-new", "excluded-author", "excluded-message", "protected", "retained-attempt"])
const item = Schema.Struct({ message: cleanupMessageSchema, disposition: Schema.Literals(["eligible", "skipped"]), reason: optional(skipReason), targetNo: optional(integer(1)) }).check(Schema.makeFilter(v => v.disposition === "skipped" ? v.reason !== undefined && v.targetNo === undefined : v.reason === undefined))
export const cleanupPageSchema = Schema.Struct({ ...sweepFields, threadId: optional(id), pageNo: integer(1), before: cursorId, nextBefore: optional(id), empty: Schema.Boolean, items: array(item, 50), persistedAt: integer() }).check(Schema.makeFilter(v => v.empty === (v.items.length === 0) && (v.empty ? v.nextBefore === undefined : v.nextBefore === v.items.at(-1)?.message.messageId) && v.items.every((m, index) => m.message.channelId === (v.threadId ?? v.channelId) && BigInt(m.message.messageId) < BigInt(index ? v.items[index - 1]!.message.messageId : v.before))))
export const cleanupGrantSchema = Schema.Struct({ ...targetFields, ownerId: id, botId: id, cutoffAt: integer(), createdAt: text(), authorId: id, dispatchExpiresAt: integer(), nativeDeadlineMs: Schema.Literal(5000) }).check(Schema.makeFilter(v => { const timestamp = cleanupTimestamp(v.messageId, v.createdAt); return timestamp !== undefined && timestamp < v.cutoffAt }))
const observation = Schema.Struct({ messageId: id, channelId: id, observedAt: integer(), status: Schema.Literals(["present", "absent", "unknown"]), channelVisible: Schema.Boolean }).check(Schema.makeFilter(v => v.status !== "absent" || v.channelVisible))
export const cleanupTargetSchema = Schema.Struct({ ...targetFields, threadId: optional(id), ownerId: id, state: Schema.Literals(["queued", "reserved", "deleted", "failed", "uncertain", "absent", "skipped", "cancelled"]), message: cleanupMessageSchema, createdAt: integer(), updatedAt: integer(), grant: optional(cleanupGrantSchema), claimedAt: optional(integer()), finishedAt: optional(integer()), noDispatch: optional(Schema.Literal(true)), expiresAt: optional(integer()), reason: optional(text()), observation: optional(observation), lateOutcome: optional(Schema.Literals(["deleted", "failed", "uncertain"])), reassessedAt: optional(integer()) }).check(Schema.makeFilter(v => v.message.messageId === v.messageId && v.message.channelId === (v.threadId ?? v.channelId) && (!v.grant || sameCleanupBinding(v, v.grant) && v.grant.ownerId === v.ownerId) && (!v.observation || v.observation.messageId === v.messageId && v.observation.channelId === v.channelId) && v.updatedAt >= v.createdAt))
const targets = array(cleanupTargetSchema, 50)
const querySchema = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings: cleanupSettingsSchema }), Schema.Struct({ type: Schema.Literal("policies"), policies: array(cleanupPolicySchema, 50) }), Schema.Struct({ type: Schema.Literal("policy"), policy: cleanupPolicySchema }),
    Schema.Struct({ type: Schema.Literal("status"), settings: cleanupSettingsSchema, policy: cleanupPolicySchema, sweep: Schema.NullOr(cleanupSweepSchema), page: Schema.NullOr(cleanupPageSchema), targets: array(cleanupTargetSchema, 20), nextBeforeTargetNo: optional(integer(1)) }),
    Schema.Struct({ type: Schema.Literal("preview"), cutoffAt: integer(), eligible: integer(0, 50), skipped: integer(0, 50), unknown: integer(0, 50), items: array(item, 50) }),
])
const manageSchema = Schema.Union([Schema.Struct({ duplicate: Schema.Literal(true) }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings: cleanupSettingsSchema }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("policy"), policy: cleanupPolicySchema }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("forgotten"), removed: integer(0, 20), complete: Schema.Boolean })])
const workSchema = Schema.Union([
    Schema.Struct({ type: Schema.Literal("policies"), policies: array(cleanupPolicySchema, 20), hasMore: Schema.Boolean, nextCursor: optional(Schema.Struct({ cursor: text(4096), throughAt: integer() })), settings: cleanupSettingsSchema }),
    Schema.Struct({ type: Schema.Literal("sweep"), sweep: cleanupSweepSchema, page: Schema.NullOr(cleanupPageSchema), targets }), Schema.Struct({ type: Schema.Literal("page"), page: Schema.NullOr(cleanupPageSchema), targets, quotaPaused: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("reserved"), grant: cleanupGrantSchema }), Schema.Struct({ type: Schema.Literal("claimed"), claimed: Schema.Boolean, grant: cleanupGrantSchema }),
    Schema.Struct({ type: Schema.Literal("target"), recorded: Schema.Boolean, target: cleanupTargetSchema }), Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean, complete: Schema.Boolean }),
])
export const cleanupSweepBinding = (v: C.CleanupSweepBinding): C.CleanupSweepBinding => ({ channelId: v.channelId, policyRevision: v.policyRevision, moduleRevision: v.moduleRevision, sweepNo: v.sweepNo })
export const cleanupTargetBinding = (v: C.CleanupTargetBinding): C.CleanupTargetBinding => ({ ...cleanupSweepBinding(v), pageNo: v.pageNo, targetNo: v.targetNo, messageId: v.messageId })
export const sameCleanupSweep = (a: C.CleanupSweepBinding, b: C.CleanupSweepBinding) => a.channelId === b.channelId && a.policyRevision === b.policyRevision && a.moduleRevision === b.moduleRevision && a.sweepNo === b.sweepNo
export function sameCleanupBinding(a: C.CleanupTargetBinding, b: C.CleanupTargetBinding) { return sameCleanupSweep(a, b) && a.pageNo === b.pageNo && a.targetNo === b.targetNo && a.messageId === b.messageId }
export class CleanupStoreError extends Data.TaggedError("CleanupStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface CleanupStore {
    manage(input: C.CleanupManageRequest): Effect.Effect<C.CleanupManageResult, CleanupStoreError>
    query(input: C.CleanupQueryRequest): Effect.Effect<C.CleanupQueryResult, CleanupStoreError>
    work(input: C.CleanupWorkRequest): Effect.Effect<C.CleanupWorkResult, CleanupStoreError>
}
export function createCleanupStore(config: BackendConfig): CleanupStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/cleanup/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new CleanupStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        query: input => call("query", input, querySchema),
        manage: input => call("manage", input, manageSchema),
        work: input => call("work", input, workSchema),
    }
}
