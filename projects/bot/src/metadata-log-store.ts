import { MetadataLogsAdmitResult, MetadataLogsQueryResult, MetadataLogsManageResult, MetadataLogsWorkResult, type MetadataLogsEvent, type MetadataLogsBinding, type MetadataLogsAdmitRequest, type MetadataLogsManageRequest, type MetadataLogsQueryRequest, type MetadataLogsWorkRequest } from "@neonflux/contracts/metadata-logs"
import { isDeepStrictEqual } from "node:util"
import { Clock, Data, Effect, Schema } from "effect"
import type { BackendConfig } from "./config.ts"
import { createBackendRequest } from "./backend-http.ts"

export { MetadataLogsEvent as metadataLogEventSchema, MetadataLogsSettings as metadataLogSettingsSchema, MetadataLogsEmbed as metadataLogEmbedSchema, MetadataLogsGrant as metadataLogGrantSchema, MetadataLogsRecord as metadataLogRecordSchema } from "@neonflux/contracts/metadata-logs"

function metadataSnapshot(event: MetadataLogsEvent) {
    const { originServerId: _origin, ...snapshot } = event
    return snapshot
}
export function metadataLogBinding(v: MetadataLogsBinding): MetadataLogsBinding { return { recordNo: v.recordNo, routeRevision: v.routeRevision, moduleRevision: v.moduleRevision, generation: v.generation, channelId: v.channelId, ownerId: v.ownerId, ...(v.routeEventType ? { routeEventType: v.routeEventType } : {}) } }
export function sameMetadataLogBinding(a: MetadataLogsBinding, b: MetadataLogsBinding) { return a.recordNo === b.recordNo && a.routeRevision === b.routeRevision && a.moduleRevision === b.moduleRevision && a.generation === b.generation && a.channelId === b.channelId && a.ownerId === b.ownerId && a.routeEventType === b.routeEventType }
export class MetadataLogsStoreError extends Data.TaggedError("MetadataLogsStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface MetadataLogsStore {
    admit(input: MetadataLogsAdmitRequest): Effect.Effect<MetadataLogsAdmitResult, MetadataLogsStoreError>
    manage(input: MetadataLogsManageRequest): Effect.Effect<MetadataLogsManageResult, MetadataLogsStoreError>
    query(input: MetadataLogsQueryRequest): Effect.Effect<MetadataLogsQueryResult, MetadataLogsStoreError>
    work(input: MetadataLogsWorkRequest): Effect.Effect<MetadataLogsWorkResult, MetadataLogsStoreError>
}
export function createMetadataLogsStore(config: BackendConfig): MetadataLogsStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>, matches: (v: A, receivedAt: number) => boolean) => request(`/metadata-logs/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })), Effect.flatMap(v => Clock.currentTimeMillis.pipe(Effect.flatMap(now => matches(v, now) ? Effect.succeed(v) : Effect.fail(new MetadataLogsStoreError({ operation, status: null }))))),
        Effect.mapError(e => new MetadataLogsStoreError({ operation, status: "status" in e && typeof e.status === "number" ? e.status : null })))
    return {
        admit: input => call("admit", input, MetadataLogsAdmitResult, v => !v.admitted ? v.duplicate === (v.reason === "duplicate")
            : (v.record.event.originServerId === undefined || v.record.event.originServerId === input.serverId) && isDeepStrictEqual(metadataSnapshot(v.record.event), metadataSnapshot(input.event))),
        query: input => call("query", input, MetadataLogsQueryResult, v => {
            const op = input.operation
            if (op.type === "settings" || op.type === "counters") return v.type === op.type
            if (op.type === "show") return v.type === "record" && v.record.recordNo === op.recordNo
            return op.type === "list" && v.type === "records"
        }),
        manage: input => call("manage", input, MetadataLogsManageResult, v => {
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
        work: input => call("work", input, MetadataLogsWorkResult, (v, now) => {
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
