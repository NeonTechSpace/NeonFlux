import type { Client } from "@neontechspace/fluxerly/effect"
import type * as C from "@neonflux/backend/contracts"
import { Cause, Effect, Queue } from "effect"
import type { SchedulesStore } from "./schedule-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { processScheduleDelivery, scheduleDeliveryBinding, SchedulesHandlingError } from "./schedules.ts"

export const schedulesPassBudget = 20
export function processSchedulesPass(store: SchedulesStore, publishing: PublishingStore, serverId: string, client: Client, cursor?: C.SchedulesDeliveryCursor) {
    return Effect.gen(function* () {
        // Discovery atomically advances the backend's durable cursor before native authorization.
        const page = yield* store.delivery({ serverId, operation: { type: "list", ...(cursor ? { cursor } : {}) } })
        if (page.type !== "deliveries" || page.deliveries.length > schedulesPassBudget) return yield* Effect.fail(new SchedulesHandlingError({ stage: "response" }))
        let considered = 0
        for (const delivery of page.deliveries) {
            considered++
            yield* processScheduleDelivery(store, publishing, serverId, client, delivery).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
                : store.delivery({ serverId, operation: { type: "defer", binding: scheduleDeliveryBinding(delivery) } }).pipe(Effect.catch(() => Effect.void))))
        }
        return { considered, hasMore: page.hasMore, nextCursor: page.nextCursor }
    })
}
export function startSchedulesWorker(store: SchedulesStore, publishing: PublishingStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const queue = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" })
        const notify = () => Queue.offer(queue, undefined).pipe(Effect.asVoid)
        let cursor: C.SchedulesDeliveryCursor | undefined
        yield* Effect.gen(function* () {
            for (;;) {
                yield* Queue.take(queue)
                yield* processSchedulesPass(store, publishing, serverId, client, cursor).pipe(
                    Effect.tap(result => Effect.sync(() => { cursor = result.nextCursor }).pipe(Effect.andThen(result.hasMore ? notify() : Effect.void))),
                    Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
                    : Effect.logWarning("Schedule work paused. Retained delivery status and exact-post reconciliation remain available")))
            }
        }).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* Effect.gen(function* () { for (;;) { yield* Effect.sleep("60 seconds"); yield* notify() } }).pipe(Effect.forkScoped({ startImmediately: true }))
        yield* notify()
        return { notify }
    })
}
