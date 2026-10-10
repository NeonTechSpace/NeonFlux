import type * as C from "@neonflux/backend/contracts"
import { isDeepStrictEqual } from "node:util"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect, Schema } from "effect"
import type { BackendConfig } from "./config.ts"
import { createBackendRequest } from "./backend-http.ts"
import { metadataLogCategories, metadataLogEventTypes, metadataLogEventSelectors } from "./metadata-log-command.ts"
import { metadataAuditActions, metadataChangedFields, metadataLogContent } from "./metadata-log-projector.ts"

const n = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: min, maximum: max }))
const text = (max = 4096) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
const id = text(20).check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const optional = Schema.optionalKey
const array = <A>(s: Schema.Codec<A>, max = 20) => Schema.mutable(Schema.Array(s)).check(Schema.isMaxLength(max))
const category = Schema.Literals(metadataLogCategories)
const types = metadataLogEventTypes
const source = Schema.Union([Schema.Struct({ kind: Schema.Literal("audit"), auditEntryId: id }), Schema.Struct({ kind: Schema.Literal("message-delete"), messageId: id }),
    Schema.Struct({ kind: Schema.Literal("member-add"), userId: id, joinedAt: text(64).check(Schema.makeFilter(v => Number.isFinite(Date.parse(v)))) }),
    Schema.Struct({ kind: Schema.Literal("observation"), sessionId: text(32).check(Schema.isPattern(/^[a-f0-9]{32}$/)), sequence: n(1) }),
    Schema.Struct({ kind: Schema.Literal("settings"), messageId: id, scope: Schema.Literals(["moderation", "metadata", "security"]) }),
    Schema.Struct({ kind: Schema.Literal("dashboard"), jobId: text(128).check(Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/)), scope: Schema.Literals(["metadata", "roles", "responses", "moderation", "publishing", "greetings", "tickets", "leveling", "milestones", "suggestions", "cleanup", "events", "schedules", "nickname", "voice", "rolepicker", "temproles", "sticky", "sidebar", "memberlist", "alerts", "helpdesk", "onboarding", "presets", "lfg", "showcase", "profile", "youtube"]) }),
    Schema.Struct({ kind: Schema.Literal("dashboard-setting"), scope: Schema.Literals(["general", "responses"]), revision: n(1) })])
const actor = Schema.Union([Schema.Struct({ kind: Schema.Literal("unknown") }), Schema.Struct({ kind: Schema.Literals(["audit", "configuration", "event"]), userId: id })])
// Security alerts may carry their own audit entry as source and actor
const auditAlert = (v: { type: string, source: { kind: string } }) => (v.type === "privilege-change" || v.type === "webhook-change") && v.source.kind === "audit"
export const metadataLogEventSchema = Schema.Struct({ originServerId: optional(id), category, type: Schema.Literals(types), source, observedAt: n(), actor, resourceIds: array(id), changedFields: array(text(64)), count: n(1, 10000),
    channelId: optional(id), parentChannelId: optional(id), authorBot: optional(Schema.NullOr(Schema.Boolean)), privateChannel: optional(Schema.Boolean), auditAction: optional(Schema.Literals(metadataAuditActions)), outcome: optional(Schema.Literals(["observed", "accepted", "failed", "disconnected", "reconnected"])) }).check(Schema.makeFilter(v => {
        const prefixes: Record<C.MetadataLogsCategory, readonly string[]> = { membership: ["member-"], resources: ["role-", "channel-", "thread-", "server-"], messages: ["message-"], audit: ["audit-entry"], settings: ["settings-change"], operations: ["backend-failure", "admission-failure", "delivery-failure", "gateway-discontinuity"], security: ["invite-", "bot-join", "webhook-change", "privilege-change", "impersonation"] }
        return prefixes[v.category].some(p => v.type.startsWith(p)) && new Set(v.resourceIds).size === v.resourceIds.length && new Set(v.changedFields).size === v.changedFields.length
            && v.changedFields.every(f => (metadataChangedFields[v.category] as readonly string[]).includes(f))
            && (v.actor.kind === "unknown" || v.actor.kind === "audit" && (v.category === "audit" || auditAlert(v)) || v.actor.kind === "configuration" && v.category === "settings" || v.actor.kind === "event" && v.type === "invite-create")
            && (v.category === "audit" ? v.source.kind === "audit" && v.auditAction !== undefined && v.resourceIds.length === 1 : v.auditAction === undefined)
            && (v.type === "message-delete" ? v.source.kind === "message-delete" && v.resourceIds.includes(v.source.messageId) : true)
            && (v.type === "member-add" && v.source.kind === "member-add" ? v.resourceIds.includes(v.source.userId) : true)
            && (v.category === "settings" ? v.source.kind === "settings" || v.source.kind === "dashboard" || v.source.kind === "dashboard-setting" : true)
            && (v.category === "audit" || v.category === "settings" || v.type === "message-delete" || v.type === "member-add" && v.source.kind === "member-add" || auditAlert(v) || v.source.kind === "observation")
            && (v.category === "messages" ? v.channelId !== undefined && v.authorBot !== undefined && v.privateChannel !== undefined : v.authorBot === undefined && v.privateChannel === undefined)
            && (v.type.startsWith("thread-") ? v.parentChannelId !== undefined && !v.resourceIds.includes(v.parentChannelId)
                : v.parentChannelId === undefined || v.category === "messages" && v.parentChannelId !== v.channelId)
            && (v.type === "message-bulk-delete" || v.category === "resources" ? v.count <= 1000 : v.category === "operations" || v.count === 1)
    }))
const route = Schema.Struct({ category, revision: n(1), enabled: Schema.Boolean, channelId: optional(id), ownerId: optional(id) }).check(Schema.makeFilter(v => !v.enabled || !!v.channelId && !!v.ownerId))
const eventRoute = Schema.Struct({ eventType: Schema.Literals(metadataLogEventSelectors), revision: n(1), enabled: Schema.Boolean, channelId: optional(id), ownerId: optional(id) }).check(Schema.makeFilter(v => (v.channelId === undefined) === (v.ownerId === undefined) && (!v.enabled || !!v.channelId && !!v.ownerId)))
export const metadataLogSettingsSchema = Schema.Struct({ enabled: Schema.Boolean, revision: n(1), configRevision: n(), routes: array(route, 7), eventRoutes: array(eventRoute, metadataLogEventSelectors.length), messageChannelIds: array(id, 50), excludedChannelIds: array(id, 50), retained: n(0, 10000), admissions: n(), admissionWindowStartedAt: n(), capacity: Schema.Literal(10000), admissionCapacity: Schema.Literal(10000), retentionMs: Schema.Literal(2592000000), quotaPaused: Schema.Boolean, refused: n(), suppressed: n() }).check(Schema.makeFilter(v => v.routes.length === 7 && new Set(v.routes.map(r => r.category)).size === 7 && new Set(v.eventRoutes.map(r => r.eventType)).size === v.eventRoutes.length && new Set(v.messageChannelIds).size === v.messageChannelIds.length && new Set(v.excludedChannelIds).size === v.excludedChannelIds.length))
const bindingFields = { recordNo: n(1), routeRevision: n(1), moduleRevision: n(1), generation: n(1), channelId: id, ownerId: id, routeEventType: optional(Schema.Literals(metadataLogEventSelectors)) }
export const metadataLogEmbedSchema = Schema.Struct({ title: text(256), description: text(4096), color: n(0, 16777215) })
export const metadataLogGrantSchema = Schema.Struct({ ...bindingFields, botId: id, dispatchExpiresAt: n(), nativeDeadlineMs: Schema.Literal(5000), content: Schema.String.check(Schema.isMaxLength(2000)), embed: optional(metadataLogEmbedSchema) }).check(Schema.makeFilter(v => v.embed ? v.content === "" : v.content.length > 0))
const delivery = Schema.Struct({ ...bindingFields, state: Schema.Literals(["queued", "reserved", "sent", "failed", "uncertain", "cancelled"]), nextCheckAt: n(), grant: optional(metadataLogGrantSchema), claimedAt: optional(n()), finishedAt: optional(n()), noDispatch: optional(Schema.Literal(true)), messageId: optional(id), reconciledAt: optional(n()), resolution: optional(Schema.Literals(["match", "absent"])) }).check(Schema.makeFilter(v => (!v.grant || sameMetadataLogBinding(v, v.grant)) && (!v.noDispatch || v.claimedAt === undefined) && (!v.resolution || v.reconciledAt !== undefined)))
export const metadataLogRecordSchema = Schema.Struct({ recordNo: n(1), event: metadataLogEventSchema, admittedAt: n(), expiresAt: n(), presentation: optional(Schema.Struct({ format: Schema.Literal("embed-v1"), embed: metadataLogEmbedSchema })), delivery: Schema.NullOr(delivery) }).check(Schema.makeFilter(v => v.expiresAt >= v.admittedAt && (!v.delivery || v.delivery.recordNo === v.recordNo && (v.delivery.routeEventType === undefined || v.delivery.routeEventType === v.event.type || v.event.type === "audit-entry" && v.delivery.routeEventType === `audit-entry:${v.event.auditAction}`)
    && (!v.delivery.grant || v.delivery.grant.content === (v.presentation ? "" : metadataLogContent(v.recordNo, v.event)) && isDeepStrictEqual(v.delivery.grant.embed, v.presentation?.embed)))))
const definitions = Schema.Struct({ tickets: Schema.Literal("Active slots including reserved and recovery work"), moderation: Schema.Literal("Retained manual, event and critical cases"), metadata: Schema.Literal("Retained admitted records, not unique causal actions"), deliveries: Schema.Literal("Current delivery states, independent of event admission") })
const counters = Schema.Struct({ activeTicketSlots: n(), retainedModerationCases: n(), retainedMetadataRecords: n(0, 10000), categories: Schema.Struct({ membership: n(), resources: n(), messages: n(), audit: n(), settings: n(), operations: n(), security: n() }), queued: n(), reserved: n(), failed: n(), uncertain: n(), refused: n(), suppressed: n(), definitions }).check(Schema.makeFilter(v => Object.values(v.categories).reduce((a, b) => a + b, 0) === v.retainedMetadataRecords && v.queued + v.reserved + v.failed + v.uncertain <= v.retainedMetadataRecords))
const query = Schema.Union([Schema.Struct({ type: Schema.Literal("settings"), settings: metadataLogSettingsSchema }), Schema.Struct({ type: Schema.Literal("records"), records: array(metadataLogRecordSchema), nextBeforeRecordNo: optional(n(1)) }), Schema.Struct({ type: Schema.Literal("record"), record: metadataLogRecordSchema }), Schema.Struct({ type: Schema.Literal("counters"), counters })])
const manage = Schema.Union([Schema.Struct({ duplicate: Schema.Literal(true) }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings: metadataLogSettingsSchema }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("forgotten"), recordNo: n(1) }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("reconciled"), recorded: Schema.Boolean, record: metadataLogRecordSchema })])
const work = Schema.Union([Schema.Struct({ type: Schema.Literal("work"), records: array(metadataLogRecordSchema), nextCursor: optional(text(8192)) }), Schema.Struct({ type: Schema.Literal("reserved"), grant: metadataLogGrantSchema }), Schema.Struct({ type: Schema.Literal("claimed"), claimed: Schema.Boolean, grant: metadataLogGrantSchema }), Schema.Struct({ type: Schema.Literal("record"), record: metadataLogRecordSchema })])
const admit = Schema.Union([Schema.Struct({ admitted: Schema.Literal(true), duplicate: Schema.Literal(false), record: metadataLogRecordSchema }), Schema.Struct({ admitted: Schema.Literal(false), duplicate: Schema.Boolean, reason: Schema.Literals(["duplicate", "disabled", "excluded", "quota", "rate-limited"]) })])
function metadataSnapshot(event: C.MetadataLogsEvent) {
    const { originServerId: _origin, ...snapshot } = event
    return snapshot
}
export function metadataLogBinding(v: C.MetadataLogsBinding): C.MetadataLogsBinding { return { recordNo: v.recordNo, routeRevision: v.routeRevision, moduleRevision: v.moduleRevision, generation: v.generation, channelId: v.channelId, ownerId: v.ownerId, ...(v.routeEventType ? { routeEventType: v.routeEventType } : {}) } }
export function sameMetadataLogBinding(a: C.MetadataLogsBinding, b: C.MetadataLogsBinding) { return a.recordNo === b.recordNo && a.routeRevision === b.routeRevision && a.moduleRevision === b.moduleRevision && a.generation === b.generation && a.channelId === b.channelId && a.ownerId === b.ownerId && a.routeEventType === b.routeEventType }
export class MetadataLogsStoreError extends Data.TaggedError("MetadataLogsStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface MetadataLogsStore {
    admit(input: C.MetadataLogsAdmitRequest): Effect.Effect<C.MetadataLogsAdmitResult, MetadataLogsStoreError>
    manage(input: C.MetadataLogsManageRequest): Effect.Effect<C.MetadataLogsManageResult, MetadataLogsStoreError>
    query(input: C.MetadataLogsQueryRequest): Effect.Effect<C.MetadataLogsQueryResult, MetadataLogsStoreError>
    work(input: C.MetadataLogsWorkRequest): Effect.Effect<C.MetadataLogsWorkResult, MetadataLogsStoreError>
}
export function createMetadataLogsStore(config: BackendConfig): MetadataLogsStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (v: A, receivedAt: number) => boolean) => request(`/metadata-logs/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })), Effect.flatMap(v => Clock.currentTimeMillis.pipe(Effect.flatMap(now => matches(v, now) ? Effect.succeed(v) : Effect.fail(new MetadataLogsStoreError({ operation, status: null }))))),
        Effect.mapError(e => new MetadataLogsStoreError({ operation, status: "status" in e && typeof e.status === "number" ? e.status : null })))
    return {
        admit: input => call("admit", input, admit, v => !v.admitted ? v.duplicate === (v.reason === "duplicate")
            : (v.record.event.originServerId === undefined || v.record.event.originServerId === input.serverId) && isDeepStrictEqual(metadataSnapshot(v.record.event), metadataSnapshot(input.event))),
        query: input => call("query", input, query, v => {
            const op = input.operation
            if (op.type === "settings" || op.type === "counters") return v.type === op.type
            if (op.type === "show") return v.type === "record" && v.record.recordNo === op.recordNo
            return op.type === "list" && v.type === "records"
        }),
        manage: input => call("manage", input, manage, v => {
            if (v.duplicate) return true
            const op = input.operation
            if (op.type === "forget") return v.type === "forgotten" && v.recordNo === op.recordNo
            if (op.type === "reconcile") return v.type === "reconciled" && v.record.recordNo === op.binding.recordNo && !!v.record.delivery && sameMetadataLogBinding(v.record.delivery, op.binding)
            if (v.type !== "settings") return false
            if (op.type === "module") return v.settings.revision === op.expectedRevision + 1 && v.settings.enabled === op.enabled
            if (op.type === "channels") return v.settings.revision === op.expectedRevision + 1 && JSON.stringify(v.settings.messageChannelIds) === JSON.stringify(op.messageChannelIds) && JSON.stringify(v.settings.excludedChannelIds) === JSON.stringify(op.excludedChannelIds)
            if (op.type === "event-route" || op.type === "event-clear") {
                const r = v.settings.eventRoutes.find(r => r.eventType === op.eventType)
                return v.settings.configRevision === op.expectedRevision + 1 && (op.type === "event-clear" ? r === undefined : r?.enabled === op.enabled && r.channelId === op.channelId && r.ownerId === op.ownerId)
            }
            const r = v.settings.routes.find(r => r.category === op.category)
            return r?.revision === op.expectedRevision + 1 && (op.type === "clear" ? !r.enabled && r.channelId === undefined && r.ownerId === undefined : r.enabled === op.enabled && r.channelId === op.channelId && r.ownerId === op.ownerId)
        }),
        work: input => call("work", input, work, (v, now) => {
            const op = input.operation
            if (op.type === "discover") return v.type === "work" && (!v.nextCursor || v.nextCursor !== op.cursor) && new Set(v.records.map(r => r.recordNo)).size === v.records.length && v.records.every(r => r.delivery !== null && r.delivery.claimedAt === undefined && (r.delivery.state === "queued" || r.delivery.state === "reserved" || r.delivery.state === "failed" && r.delivery.noDispatch === true))
            if (v.type === "record") return v.record.recordNo === op.binding.recordNo && !!v.record.delivery && sameMetadataLogBinding(v.record.delivery, op.binding)
            if (v.type !== (op.type === "reserve" ? "reserved" : "claimed") || !("grant" in v) || !("context" in op)) return false
            const g = v.grant, b = op.binding
            const matches = op.type === "reserve" ? g.recordNo === b.recordNo && g.routeRevision === b.routeRevision && g.channelId === b.channelId && g.ownerId === b.ownerId
                && g.routeEventType === b.routeEventType && g.moduleRevision >= b.moduleRevision && (g.generation === b.generation || g.generation === b.generation + 1) : sameMetadataLogBinding(g, b)
            return matches && g.botId === op.context.botId && g.dispatchExpiresAt <= now + 120000
        }),
    }
}
