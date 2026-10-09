import type { MetadataLogsEventType } from "@neonflux/contracts/metadata-logs"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Queue } from "effect"
import type { MetadataLogsStore } from "./metadata-log-store.ts"
import { metadataLogBinding } from "./metadata-log-store.ts"
import { executeMetadataLogRecord, MetadataLogHandlingError } from "./metadata-logs.ts"
import { createMetadataObservationSession } from "./metadata-log-projector.ts"

export function createMetadataOperationReporter(store: MetadataLogsStore, serverId: string) {
    const observation = createMetadataObservationSession(), pending = new Map<string, { at: number, count: number }>()
    return (type: Extract<MetadataLogsEventType, "backend-failure" | "delivery-failure" | "gateway-discontinuity">, count = 1) => Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis, previous = pending.get(type) ?? { at: -Infinity, count: 0 }
        previous.count = Math.min(10000, previous.count + count); pending.set(type, previous)
        if (now - previous.at < 60000) return
        const scope = observation(serverId, now), total = previous.count
        previous.at = now; previous.count = 0
        yield* store.admit({ serverId, event: { originServerId: serverId, category: "operations", type, source: { kind: "observation", sessionId: scope.sessionId, sequence: scope.sequence }, observedAt: now, actor: { kind: "unknown" }, resourceIds: [], changedFields: [], count: total, outcome: type === "gateway-discontinuity" ? "observed" : "failed" } }).pipe(Effect.catch(() => Effect.void))
    })
}

export function processMetadataLogsPass(store: MetadataLogsStore, serverId: string, client: Client, cursor?: string, report?: ReturnType<typeof createMetadataOperationReporter>) {
    return Effect.gen(function* () {
        const page = yield* store.work({ serverId, operation: { type: "discover", ...(cursor ? { cursor } : {}) } })
        if (page.type !== "work" || page.records.length > 20) return yield* Effect.fail(new MetadataLogHandlingError({ stage: "response" }))
        let attempted = 0, sent = 0
        for (const record of page.records) yield* executeMetadataLogRecord(store, serverId, client, record).pipe(Effect.tap(result => Effect.sync(() => { if (result.attempted) attempted++; if (result.sent) sent++ })),
            Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.gen(function* () {
                if (report) yield* report("delivery-failure")
                if (record.delivery) yield* store.work({ serverId, operation: { type: "defer", binding: metadataLogBinding(record.delivery) } }).pipe(Effect.catch(() => Effect.void))
            })))
        return { considered: page.records.length, attempted, sent, nextCursor: page.nextCursor }
    })
}
export function startMetadataLogsWorker(store: MetadataLogsStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const queue = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" })
        const notify = () => Queue.offer(queue, undefined).pipe(Effect.asVoid)
        let cursor: string | undefined
        const report = createMetadataOperationReporter(store, serverId)
        const discontinuities = () => { const c = client.diagnostics().counters; return c.reconnects + c.eventsDropped.overflow + c.eventsDropped.malformed + c.eventsDropped.collector }
        let observed = discontinuities()
        yield* Effect.gen(function* () { for (;;) {
            yield* Queue.take(queue)
            yield* processMetadataLogsPass(store, serverId, client, cursor, report).pipe(Effect.tap(result => Effect.sync(() => { cursor = result.nextCursor })),
                Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : report("backend-failure")))
        } }).pipe(Effect.forkScoped({ startImmediately: true }))
        // Gateway gaps are counted in memory and reported at most once a minute. Due deliveries are woken by the work
        // dispatcher, so an idle server makes no requests
        yield* Effect.gen(function* () { for (;;) {
            yield* Effect.sleep("60 seconds")
            const current = discontinuities()
            if (current > observed) yield* report("gateway-discontinuity", Math.min(10000, current - observed))
            observed = current
        } }).pipe(Effect.forkScoped({ startImmediately: true }))
        return { notify }
    })
}
