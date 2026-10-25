import type { CleanupWorkCursor } from "@neonflux/contracts/cleanup"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect } from "effect"
import { CleanupHandlingError, cleanupBatchable, processCleanupBatch, processCleanupTarget } from "./cleanup.ts"
import { fetchCleanupHistory, nextCleanupThread } from "./cleanup-evidence.ts"
import { readCleanupAutomationContext } from "./cleanup-permissions.ts"
import { cleanupSweepBinding, type CleanupStore } from "./cleanup-store.ts"
import { startSignalledWorker } from "./signalled-worker.ts"

/** Pages one pass deletes, and the most of them one channel takes, so other channels take turns and a stopped pass loses little */
export const cleanupPassBudget = 20
export const cleanupChannelBudget = 10
export function processCleanupPass(store: CleanupStore, serverId: string, client: Client, cursor?: CleanupWorkCursor) {
    return Effect.gen(function* () {
        const discovery = yield* store.work({ serverId, operation: { type: "list", ...(cursor ? { cursor } : {}) } })
        if (discovery.type !== "policies" || discovery.policies.length > 20)
            return yield* Effect.fail(new CleanupHandlingError({ stage: "response" }))
        let considered = 0,
            pages = 0,
            attempted = 0,
            submitted = 0,
            acknowledged = 0,
            unresolved = 0
        for (const policy of discovery.policies) {
            if (pages >= cleanupPassBudget) break
            considered++
            let stage: "authority" | "history" | "malformed" | "target" = "authority"
            yield* Effect.gen(function* () {
                if (!discovery.settings.enabled || !policy.enabled) return
                // One pass keeps reading and deleting this channel's pages while its history lasts, then the next channel takes its turn
                for (let channelPages = 0; channelPages < cleanupChannelBudget && pages < cleanupPassBudget;) {
                    stage = "authority"
                    const context = yield* readCleanupAutomationContext(client, serverId, policy.channelId)
                    const start = yield* store.work({
                        serverId,
                        operation: {
                            type: "start",
                            channelId: policy.channelId,
                            expectedRevision: policy.revision,
                            context,
                        },
                    })
                    if (start.type !== "sweep")
                        return yield* Effect.fail(new CleanupHandlingError({ stage: "response" }))
                    if (start.sweep.state !== "active") return
                    const binding = cleanupSweepBinding(start.sweep)
                    let page = start.page,
                        targets = start.targets
                    if (!page) {
                        stage = "history"
                        const messages = start.sweep.threadId
                            ? yield* fetchCleanupHistory(
                                  client,
                                  serverId,
                                  start.sweep.threadId,
                                  start.sweep.before,
                                  policy.channelId,
                              )
                            : yield* fetchCleanupHistory(client, serverId, policy.channelId, start.sweep.before)
                        stage = "malformed"
                        const saved = yield* store.work({
                            serverId,
                            operation: {
                                type: "page",
                                binding,
                                pageNo: start.sweep.pageNo,
                                before: start.sweep.before,
                                messages,
                                context,
                            },
                        })
                        if (saved.type !== "page")
                            return yield* Effect.fail(new CleanupHandlingError({ stage: "response" }))
                        page = saved.page
                        targets = saved.targets
                    }
                    if (!page) return yield* Effect.fail(new CleanupHandlingError({ stage: "response" }))
                    stage = "target"
                    channelPages++
                    pages++
                    const open = targets.filter(
                        (target) =>
                            target.claimedAt === undefined &&
                            (target.state === "queued" || target.state === "reserved"),
                    )
                    // Targets whose message facts were read moments ago go in one bulk request. Older saved ones are read again one by one
                    const now = yield* Clock.currentTimeMillis,
                        fresh = open.filter((target) => cleanupBatchable(target, policy, now))
                    // A delete that failed or has no known outcome ends this channel's turn, and the backend waits a minute before the next page
                    let troubled = false
                    if (fresh.length) {
                        const result = yield* processCleanupBatch(store, serverId, client, policy, fresh)
                        attempted += result.attempted
                        submitted += result.submitted
                        acknowledged += result.acknowledged
                        unresolved += result.unresolved
                        if (result.unresolved > 0 || result.attempted > result.acknowledged) troubled = true
                    }
                    for (const target of open) {
                        if (fresh.includes(target)) continue
                        attempted++
                        const result = yield* processCleanupTarget(store, serverId, client, policy, target)
                        if (result.submitted) submitted++
                        if (result.acknowledged) acknowledged++
                        if (result.unresolved) unresolved++
                        if (result.unresolved || result.outcome === "failed" || result.outcome === "uncertain")
                            troubled = true
                    }
                    // An empty page ends the channel or thread being read, and the sweep moves on to the next active thread, if any
                    stage = "history"
                    const nextThreadId = page.empty
                        ? yield* nextCleanupThread(client, serverId, start.sweep)
                        : undefined
                    stage = "target"
                    // Backend refuses advance until every persisted target has an accounted disposition.
                    const advanced = yield* store.work({
                        serverId,
                        operation: {
                            type: "advance",
                            binding,
                            pageNo: page.pageNo,
                            ...(nextThreadId ? { nextThreadId } : {}),
                        },
                    })
                    if (troubled || advanced.type !== "progress" || !advanced.recorded || advanced.complete) return
                }
            }).pipe(
                Effect.catchCause((cause) =>
                    Cause.hasInterrupts(cause)
                        ? Effect.failCause(cause)
                        : store
                              .work({
                                  serverId,
                                  operation: {
                                      type: "defer",
                                      channelId: policy.channelId,
                                      expectedRevision: policy.revision,
                                      reason: stage,
                                  },
                              })
                              .pipe(Effect.catch(() => Effect.void)),
                ),
            )
        }
        // Revisit this discovery page so its untouched policies keep their due priority.
        const partial = considered < discovery.policies.length
        return {
            considered,
            attempted,
            submitted,
            acknowledged,
            unresolved,
            hasMore: partial || discovery.hasMore,
            nextCursor: partial ? cursor : discovery.nextCursor,
        }
    })
}
export function startCleanupWorker(store: CleanupStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        let cursor: CleanupWorkCursor | undefined
        const { wake } = yield* startSignalledWorker(
            Effect.suspend(() => processCleanupPass(store, serverId, client, cursor)),
            Effect.logWarning("Message cleanup paused. Retained cursors and exact-target audit remain available"),
            (result) =>
                Effect.sync(() => {
                    cursor = result.nextCursor
                }),
        )
        // The work dispatcher wakes this worker when a policy of this server is due
        return { notify: () => wake }
    })
}
