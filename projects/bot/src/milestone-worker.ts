import type { Client } from "@neontechspace/fluxerly/effect"
import type { MilestonesDeliveryCursor } from "@neonflux/contracts/milestones"
import { Cause, Effect, Queue } from "effect"
import type { MilestonesStore } from "./milestone-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { processMilestoneDelivery, milestoneDeliveryBinding, MilestonesHandlingError } from "./milestones.ts"
import { observeMilestoneDeparture } from "./milestone-events.ts"
import { warnFailure } from "./contained.ts"

const milestonesPassBudget = 20
export function processMilestonesPass(
    store: MilestonesStore,
    publishing: PublishingStore,
    serverId: string,
    client: Client,
    cursor?: MilestonesDeliveryCursor,
) {
    return Effect.gen(function* () {
        const page = yield* store.delivery({ serverId, operation: { type: "list", ...(cursor ? { cursor } : {}) } })
        if (page.type !== "deliveries" || page.deliveries.length > milestonesPassBudget)
            return yield* Effect.fail(new MilestonesHandlingError({ stage: "response" }))
        let considered = 0
        for (const delivery of page.deliveries) {
            considered++
            yield* processMilestoneDelivery(store, publishing, serverId, client, delivery).pipe(
                Effect.catchCause((cause) =>
                    Cause.hasInterrupts(cause)
                        ? Effect.failCause(cause)
                        : store
                              .delivery({
                                  serverId,
                                  operation: { type: "defer", binding: milestoneDeliveryBinding(delivery) },
                              })
                              .pipe(Effect.catch(() => Effect.void)),
                ),
            )
        }
        return { considered, hasMore: page.hasMore, nextCursor: page.nextCursor }
    })
}
export function startMilestonesWorker(
    store: MilestonesStore,
    publishing: PublishingStore,
    serverId: string,
    client: Client,
) {
    return Effect.gen(function* () {
        const queue = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" })
        // A member event only observes that member. Its backend answer reports any delivery it makes due to the work dispatcher, which wakes the delivery pass
        let passDue = false
        const wake = () => Queue.offer(queue, undefined).pipe(Effect.asVoid)
        const notify = () =>
            Effect.suspend(() => {
                passDue = true
                return wake()
            })
        let cursor: MilestonesDeliveryCursor | undefined
        const members = new Set<string>()
        const notifyMember = (userId: string) =>
            Effect.gen(function* () {
                if (!members.has(userId) && members.size >= 1000) {
                    yield* Effect.logWarning("Membership hint capacity reached")
                    return
                }
                members.add(userId)
                yield* wake()
            })
        yield* Effect.gen(function* () {
            for (;;) {
                yield* Queue.take(queue)
                const userId = members.values().next().value
                let observed = false
                if (userId !== undefined) {
                    yield* observeMilestoneDeparture(store, serverId, client, userId).pipe(
                        Effect.tap(() =>
                            Effect.sync(() => {
                                observed = true
                                members.delete(userId)
                            }),
                        ),
                        Effect.catchCause((cause) =>
                            Cause.hasInterrupts(cause)
                                ? Effect.failCause(cause)
                                : Effect.sync(() => {
                                      members.delete(userId)
                                      members.add(userId)
                                  }),
                        ),
                    )
                }
                // The hints left go on at once, but a failed check waits for the minute retry
                if (observed && members.size) yield* wake()
                if (!passDue) continue
                passDue = false
                yield* processMilestonesPass(store, publishing, serverId, client, cursor).pipe(
                    Effect.tap((result) =>
                        Effect.sync(() => {
                            cursor = result.nextCursor
                        }).pipe(Effect.andThen(result.hasMore ? notify() : Effect.void)),
                    ),
                    Effect.catchCause((cause) =>
                        Cause.hasInterrupts(cause)
                            ? Effect.failCause(cause)
                            : warnFailure(
                                  "Milestone work paused. Private status and exact-post reconciliation remain available",
                                  cause,
                              ),
                    ),
                )
            }
        }).pipe(Effect.forkScoped({ startImmediately: true }))
        // Membership hints live only in memory, so unfinished ones are retried each minute. Due enrollments are woken by the
        // work dispatcher, so an idle server makes no requests
        yield* Effect.gen(function* () {
            for (;;) {
                yield* Effect.sleep("60 seconds")
                if (members.size) yield* wake()
            }
        }).pipe(Effect.forkScoped({ startImmediately: true }))
        return { notify, notifyMember }
    })
}
