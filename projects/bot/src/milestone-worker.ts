import type { Client } from "@neontechspace/fluxerly/effect"
import type * as C from "@neonflux/backend/contracts"
import { Cause, Effect, Queue } from "effect"
import type { MilestonesStore } from "./milestone-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { processMilestoneDelivery, milestoneDeliveryBinding, MilestonesHandlingError } from "./milestones.ts"
import { observeMilestoneDeparture } from "./milestone-events.ts"

export const milestonesPassBudget = 20
export function processMilestonesPass(store: MilestonesStore, publishing: PublishingStore, serverId: string, client: Client, cursor?: C.MilestonesDeliveryCursor) {
    return Effect.gen(function* () {
        const page = yield* store.delivery({ serverId, operation: { type: "list", ...(cursor ? { cursor } : {}) } })
        if (page.type !== "deliveries" || page.deliveries.length > milestonesPassBudget) return yield* Effect.fail(new MilestonesHandlingError({ stage: "response" }))
        let considered = 0
        for (const delivery of page.deliveries) {
            considered++
            yield* processMilestoneDelivery(store, publishing, serverId, client, delivery).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
                : store.delivery({ serverId, operation: { type: "defer", binding: milestoneDeliveryBinding(delivery) } }).pipe(Effect.catch(() => Effect.void))))
        }
        return { considered, hasMore: page.hasMore, nextCursor: page.nextCursor }
    })
}
export function startMilestonesWorker(store: MilestonesStore, publishing: PublishingStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const queue = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" })
        const notify = () => Queue.offer(queue, undefined).pipe(Effect.asVoid)
        let cursor: C.MilestonesDeliveryCursor | undefined
        const members = new Map<string, string | undefined>()
        const notifyMember = (userId: string) => Effect.gen(function* () {
            if (!members.has(userId) && members.size >= 1000) { yield* Effect.logWarning("Membership hint capacity reached"); return }
            members.set(userId, members.get(userId))
            yield* notify()
        })
        yield* Effect.gen(function* () {
            for (;;) {
                yield* Queue.take(queue)
                const member = members.entries().next().value
                if (member) {
                    const [userId, memberCursor] = member
                    yield* observeMilestoneDeparture(store, serverId, client, userId, memberCursor).pipe(Effect.tap(result => Effect.sync(() => {
                        members.delete(userId)
                        if (result.hasMore) members.set(userId, result.nextCursor)
                    })), Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.sync(() => {
                        members.delete(userId)
                        members.set(userId, memberCursor)
                    })))
                }
                yield* processMilestonesPass(store, publishing, serverId, client, cursor).pipe(
                    Effect.tap(result => Effect.sync(() => { cursor = result.nextCursor }).pipe(Effect.andThen(result.hasMore ? notify() : Effect.void))),
                    Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
                    : Effect.logWarning("Milestone work paused. Private status and exact-post reconciliation remain available")))
            }
        }).pipe(Effect.forkScoped({ startImmediately: true }))
        // Membership hints live only in memory, so unfinished ones are retried each minute. Due enrollments are woken by the
        // work dispatcher, so an idle server makes no requests
        yield* Effect.gen(function* () { for (;;) { yield* Effect.sleep("60 seconds"); if (members.size) yield* notify() } }).pipe(Effect.forkScoped({ startImmediately: true }))
        return { notify, notifyMember }
    })
}
