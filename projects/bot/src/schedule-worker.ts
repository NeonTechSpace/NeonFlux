import type { Client } from "@neontechspace/fluxerly/effect"
import type { SchedulesDeliveryCursor } from "@neonflux/contracts/schedules"
import { Cause, Effect } from "effect"
import type { SchedulesStore } from "./schedule-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { processScheduleDelivery, scheduleDeliveryBinding, SchedulesHandlingError } from "./schedules.ts"
import { startSignalledWorker } from "./signalled-worker.ts"

export const schedulesPassBudget = 20
export function processSchedulesPass(
    store: SchedulesStore,
    publishing: PublishingStore,
    serverId: string,
    client: Client,
    cursor?: SchedulesDeliveryCursor,
) {
    return Effect.gen(function* () {
        // Discovery atomically advances the backend's durable cursor before native authorization.
        const page = yield* store.delivery({ serverId, operation: { type: "list", ...(cursor ? { cursor } : {}) } })
        if (page.type !== "deliveries" || page.deliveries.length > schedulesPassBudget)
            return yield* Effect.fail(new SchedulesHandlingError({ stage: "response" }))
        let considered = 0
        for (const delivery of page.deliveries) {
            considered++
            yield* processScheduleDelivery(store, publishing, serverId, client, delivery).pipe(
                Effect.catchCause((cause) =>
                    Cause.hasInterrupts(cause)
                        ? Effect.failCause(cause)
                        : store
                              .delivery({
                                  serverId,
                                  operation: { type: "defer", binding: scheduleDeliveryBinding(delivery) },
                              })
                              .pipe(Effect.catch(() => Effect.void)),
                ),
            )
        }
        return { considered, hasMore: page.hasMore, nextCursor: page.nextCursor }
    })
}
export function startSchedulesWorker(
    store: SchedulesStore,
    publishing: PublishingStore,
    serverId: string,
    client: Client,
) {
    return Effect.gen(function* () {
        let cursor: SchedulesDeliveryCursor | undefined
        const { wake } = yield* startSignalledWorker(
            Effect.suspend(() => processSchedulesPass(store, publishing, serverId, client, cursor)),
            Effect.logWarning(
                "Schedule work paused. Retained delivery status and exact-post reconciliation remain available",
            ),
            (result, again) =>
                Effect.sync(() => {
                    cursor = result.nextCursor
                }).pipe(Effect.andThen(result.hasMore ? again : Effect.void)),
        )
        // The work dispatcher wakes this worker when a delivery of this server is due
        return { notify: () => wake }
    })
}
