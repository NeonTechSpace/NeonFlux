import type * as C from "@neonflux/backend/contracts"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Queue } from "effect"
import type { EventsStore } from "./event-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { processEventDelivery, processEventPromotion, processEventThread, eventDeliveryBinding } from "./events.ts"
import { EventsHandlingError } from "./event-management.ts"
import { readNativeMember } from "./member-evidence.ts"

export const eventsPassBudget = 20
function workerEvent(store: EventsStore, serverId: string, source: { eventNo: number, channelId: string }) {
    return store.delivery({ serverId, operation: { type: "show", eventNo: source.eventNo } }).pipe(
        Effect.flatMap(v => v.type === "event" && v.event.channelId === source.channelId ? Effect.succeed(v.event) : Effect.fail(new EventsHandlingError({ stage: "response" }))))
}
export function processEventsPass(store: EventsStore, publishing: PublishingStore, serverId: string, client: Client, promotionCursor?: C.EventsMemberCursor) {
    return Effect.gen(function* () {
        const deliveries = yield* store.delivery({ serverId, operation: { type: "list", beforeDueAt: yield* Clock.currentTimeMillis } })
        if (deliveries.type !== "deliveries") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
        let considered = 0
        for (const delivery of deliveries.deliveries.slice(0, eventsPassBudget / 2)) {
            considered++
            yield* workerEvent(store, serverId, delivery).pipe(Effect.flatMap(event => processEventDelivery(store, publishing, serverId, client, delivery, event)),
                Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
                    : store.delivery({ serverId, operation: { type: "defer", binding: eventDeliveryBinding(delivery) } }).pipe(Effect.catch(() => Effect.void))))
        }
        // Discussion threads to start on sent cards or to close after their events come with the due deliveries
        for (const work of deliveries.threads ?? []) { considered++; yield* processEventThread(store, serverId, client, work) }
        let cursor = promotionCursor
        const stalled = new Set<string>()
        for (let slot = 0; slot < eventsPassBudget / 2; slot++) {
            // Fresh discovery binds each attempt to the current work generation.
            const page = yield* store.work({ serverId, operation: { type: "list", limit: 1, ...(cursor ? { cursor } : {}) } })
            if (page.type !== "jobs" || page.jobs.length > 1) return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
            cursor = page.nextCursor
            const job = page.jobs[0]
            if (!job) { if (!cursor) break; continue }
            const key = `${job.eventNo}:${job.occurrenceNo}`
            if (stalled.has(key)) continue
            considered++
            const result = yield* processEventPromotion(store, serverId, client, job).pipe(
                Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.void))
            // Only definite progress may revisit an occurrence during this bounded pass.
            if (!result || result.type !== "progress" || !result.recorded) stalled.add(key)
        }
        return { considered, ...(cursor ? { promotionCursor: cursor } : {}) }
    })
}
export function processEventsMemberPass(store: EventsStore, serverId: string, client: Client, userId: string, cursor?: C.EventsMemberCursor) {
    return Effect.gen(function* () {
        const page = yield* store.work({ serverId, operation: { type: "member-targets", userId, ...(cursor ? { cursor } : {}) } })
        if (page.type !== "member-targets") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
        let considered = 0
        for (const target of page.targets.slice(0, eventsPassBudget)) {
            const evidence = yield* readNativeMember(client, serverId, userId)
            if (evidence.member) return { considered, restart: false, nextCursor: undefined }
            const observation = yield* store.work({ serverId, operation: { type: "observe", ...target, originServerId: evidence.originServerId, observedAt: yield* Clock.currentTimeMillis, memberAbsent: true } })
            considered++
            if (observation.type !== "progress") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
            // A stale account or occurrence fence requires new discovery and a new native read.
            if (!observation.recorded) return { considered, restart: true, nextCursor: undefined }
        }
        return { considered, restart: false, nextCursor: page.nextCursor }
    })
}
export function startEventsWorker(store: EventsStore, publishing: PublishingStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const queue = yield* Queue.make<string>({ capacity: 100, strategy: "dropping" })
        const serverQueue = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" })
        const queued = new Set<string>(), members = new Map<string, { cursor?: C.EventsMemberCursor }>()
        const offer = (key: string) => Effect.gen(function* () {
            if (queued.has(key)) return
            queued.add(key)
            if (!(yield* Queue.offer(queue, key))) queued.delete(key)
        })
        const notify = () => Queue.offer(serverQueue, undefined).pipe(Effect.asVoid)
        let promotionCursor: C.EventsMemberCursor | undefined
        const notifyMember = (userId: string) => Effect.gen(function* () {
            if (!members.has(userId) && members.size >= 100) { yield* Effect.logWarning("Event membership discovery hint capacity reached"); return }
            // Replacing the hint keeps a newer notification distinct from an in-flight page.
            members.set(userId, {})
            yield* offer(userId)
        })
        yield* Effect.gen(function* () {
            for (;;) {
                const key = yield* Queue.take(queue)
                const hint = members.get(key)
                yield* processEventsMemberPass(store, serverId, client, key, hint?.cursor).pipe(
                    Effect.tap(result => Effect.sync(() => {
                        if (members.get(key) !== hint) return
                        if (result.restart && hint) delete hint.cursor
                        else if (result.nextCursor && hint) hint.cursor = result.nextCursor
                        else members.delete(key)
                    })),
                    Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
                        : Effect.logWarning("Event membership work paused. Recorded account fences remain available")),
                    Effect.ensuring(Effect.sync(() => { queued.delete(key) })))
                // A notification arriving during this page gets its own bounded discovery pass.
                if (members.has(key) && members.get(key) !== hint) yield* offer(key)
            }
        }).pipe(Effect.forkScoped({ startImmediately: true }))
        // Slow leave cleanup cannot block the independent due and promotion discovery budget.
        yield* Effect.gen(function* () {
            for (;;) {
                yield* Queue.take(serverQueue)
                yield* processEventsPass(store, publishing, serverId, client, promotionCursor).pipe(
                    Effect.tap(result => Effect.sync(() => { promotionCursor = result.promotionCursor })),
                    Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
                        : Effect.logWarning("Event work paused. Retained status and reconciliation remain available")))
            }
        }).pipe(Effect.forkScoped({ startImmediately: true }))
        // Membership hints live only in memory, so unfinished ones are retried each minute. Due deliveries and promotions
        // are woken by the work dispatcher, so an idle server makes no requests
        yield* Effect.gen(function* () { for (;;) { yield* Effect.sleep("60 seconds"); for (const key of members.keys()) yield* offer(key) } }).pipe(Effect.forkScoped({ startImmediately: true }))
        return { notify, notifyMember }
    })
}
