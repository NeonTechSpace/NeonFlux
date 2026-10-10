import type { CleanupWorkCursor } from "@neonflux/contracts/cleanup"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Effect, Queue } from "effect"
import { CleanupHandlingError, processCleanupTarget } from "./cleanup.ts"
import { fetchCleanupHistory, nextCleanupThread } from "./cleanup-evidence.ts"
import { readCleanupAutomationContext } from "./cleanup-permissions.ts"
import { cleanupSweepBinding, type CleanupStore } from "./cleanup-store.ts"

export const cleanupPassBudget = 20
export const cleanupChannelBudget = 5
export function processCleanupPass(store: CleanupStore, serverId: string, client: Client, cursor?: CleanupWorkCursor) {
    return Effect.gen(function* () {
        const discovery = yield* store.work({ serverId, operation: { type: "list", ...(cursor ? { cursor } : {}) } })
        if (discovery.type !== "policies" || discovery.policies.length > 20) return yield* Effect.fail(new CleanupHandlingError({ stage: "response" }))
        let considered = 0, attempted = 0, submitted = 0, acknowledged = 0, unresolved = 0
        for (const policy of discovery.policies) {
            if (attempted >= cleanupPassBudget) break
            considered++
            let stage: "authority" | "history" | "malformed" | "target" = "authority"
            yield* Effect.gen(function* () {
                if (!discovery.settings.enabled || !policy.enabled) return
                const context = yield* readCleanupAutomationContext(client, serverId, policy.channelId)
                const start = yield* store.work({ serverId, operation: { type: "start", channelId: policy.channelId, expectedRevision: policy.revision, context } })
                if (start.type !== "sweep") return yield* Effect.fail(new CleanupHandlingError({ stage: "response" }))
                if (start.sweep.state !== "active") return
                const binding = cleanupSweepBinding(start.sweep)
                let page = start.page, targets = start.targets
                if (!page) {
                    stage = "history"
                    const messages = start.sweep.threadId ? yield* fetchCleanupHistory(client, serverId, start.sweep.threadId, start.sweep.before, policy.channelId)
                        : yield* fetchCleanupHistory(client, serverId, policy.channelId, start.sweep.before)
                    stage = "malformed"
                    const saved = yield* store.work({ serverId, operation: { type: "page", binding, pageNo: start.sweep.pageNo, before: start.sweep.before, messages, context } })
                    if (saved.type !== "page") return yield* Effect.fail(new CleanupHandlingError({ stage: "response" }))
                    page = saved.page; targets = saved.targets
                }
                if (!page) return yield* Effect.fail(new CleanupHandlingError({ stage: "response" }))
                stage = "target"
                let channelAttempted = 0
                for (const target of targets) {
                    if (target.claimedAt !== undefined || target.state !== "queued" && target.state !== "reserved") continue
                    if (attempted >= cleanupPassBudget || channelAttempted >= cleanupChannelBudget) break
                    attempted++; channelAttempted++
                    const result = yield* processCleanupTarget(store, serverId, client, policy, target)
                    if (result.submitted) submitted++
                    if (result.acknowledged) acknowledged++
                    if (result.unresolved) unresolved++
                }
                // An empty page ends the channel or thread being read, and the sweep moves on to the next active thread, if any
                stage = "history"
                const nextThreadId = page.empty ? yield* nextCleanupThread(client, serverId, start.sweep) : undefined
                stage = "target"
                // Backend refuses advance until every persisted target has an accounted disposition.
                yield* store.work({ serverId, operation: { type: "advance", binding, pageNo: page.pageNo, ...(nextThreadId ? { nextThreadId } : {}) } })
            }).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
                : store.work({ serverId, operation: { type: "defer", channelId: policy.channelId, expectedRevision: policy.revision, reason: stage } }).pipe(Effect.catch(() => Effect.void))))
        }
        // Revisit this discovery page so its untouched policies keep their due priority.
        const partial = considered < discovery.policies.length
        return { considered, attempted, submitted, acknowledged, unresolved, hasMore: partial || discovery.hasMore, nextCursor: partial ? cursor : discovery.nextCursor }
    })
}
export function startCleanupWorker(store: CleanupStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const queue = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" })
        const notify = () => Queue.offer(queue, undefined).pipe(Effect.asVoid)
        let cursor: CleanupWorkCursor | undefined
        yield* Effect.gen(function* () { for (;;) {
            yield* Queue.take(queue)
            yield* processCleanupPass(store, serverId, client, cursor).pipe(Effect.tap(result => Effect.sync(() => { cursor = result.nextCursor })),
                Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning("Message cleanup paused. Retained cursors and exact-target audit remain available")))
        } }).pipe(Effect.forkScoped({ startImmediately: true }))
        // The work dispatcher wakes this worker when a policy of this server is due
        return { notify }
    })
}
