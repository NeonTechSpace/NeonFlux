import type { RolesReactionJob, RolesReactionJobsResult } from "@neonflux/backend/contracts"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Exit, Queue } from "effect"
import { randomUUID } from "node:crypto"
import { handleRoleReaction, RoleHandlingError } from "./roles.ts"
import { RolesStoreError, type RolesStore } from "./roles-store.ts"

export function processRoleReactionJob(store: RolesStore, serverId: string, client: Client, jobId: string) {
    return Effect.gen(function* () {
        for (let pages = 0; pages < 20; pages++) {
            const claimToken = randomUUID().replaceAll("-", "")
            const page = yield* store.reactionJobs({ serverId, operation: { type: "claim", jobId, claimToken } })
            if (page.type === "job" && page.job.status === "cancelled") return page.job
            if (page.type !== "page") return yield* Effect.fail(new RoleHandlingError({ stage: "claim" }))
            if (!page.claimed) return page.job
            const { job } = page
            let blocked = false
            for (let index = 0; index < page.targets.length; index++) {
                if ((yield* Clock.currentTimeMillis) >= (job.leaseExpiresAt ?? 0)) return yield* Effect.fail(new RoleHandlingError({ stage: "claim" }))
                const target = page.targets[index]!
                const binding = { jobId, generation: job.generation, claimToken, pageStep: job.pageStep, index }
                const applied = yield* Effect.exit(handleRoleReaction(store, serverId, client, { id: job.messageId, channelId: job.channelId, guildId: serverId }, target.userId, target.joinedAt,
                    { source: { sourceId: target.sourceId, createdAt: yield* Clock.currentTimeMillis }, binding }))
                if (Exit.isFailure(applied) && Cause.hasInterrupts(applied.cause)) return yield* Effect.failCause(applied.cause)
                if (Exit.isFailure(applied) || !applied.value) {
                    yield* store.reactionJobs({ serverId, operation: { type: "block", binding } })
                    blocked = true
                }
            }
            const saved = yield* store.reactionJobs({ serverId, operation: { type: "checkpoint", jobId, generation: job.generation, claimToken, pageStep: job.pageStep, blocked } })
            if (saved.type !== "job") return yield* Effect.fail(new RoleHandlingError({ stage: "claim" }))
            if (saved.job.status !== "queued") return saved.job
            if (pages === 19) return saved.job
        }
        return yield* Effect.fail(new RoleHandlingError({ stage: "claim" }))
    })
}

export function startRoleReactionWorker(store: RolesStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const queue = yield* Queue.make<string>({ capacity: 51, strategy: "dropping" })
        const pending = new Set<string>()
        const leaseWakes = new Map<string, string>()
        const notify = (job: RolesReactionJob) => Effect.gen(function* () {
            if (!["queued", "running", "blocked"].includes(job.status) || pending.has(job.jobId)) return
            pending.add(job.jobId)
            if (!(yield* Queue.offer(queue, job.jobId))) pending.delete(job.jobId)
        })
        const initial = yield* store.reactionJobs({ serverId, operation: { type: "list" } })
        if (initial.type !== "jobs") return yield* Effect.fail(new RoleHandlingError({ stage: "claim" }))
        for (const job of initial.jobs) yield* notify(job)
        const worker = Effect.gen(function* () {
            for (;;) {
                const jobId = yield* Queue.take(queue)
                pending.delete(jobId)
                const stopped = yield* processRoleReactionJob(store, serverId, client, jobId).pipe(Effect.catchCause((cause) => Cause.hasInterrupts(cause)
                    ? Effect.failCause(cause) : Effect.logWarning("Role reaction reconciliation paused. Inspect the durable job before resuming")))
                if (stopped?.status === "queued") yield* notify(stopped)
                const lease = stopped && stopped.leaseExpiresAt !== undefined ? `${stopped.generation}:${stopped.leaseExpiresAt}` : undefined
                if (stopped && stopped.status === "running" && stopped.leaseExpiresAt !== undefined && leaseWakes.get(jobId) !== lease) {
                    const wait = Math.max(0, stopped.leaseExpiresAt - (yield* Clock.currentTimeMillis))
                    leaseWakes.set(jobId, lease!)
                    yield* Effect.sleep(`${wait} millis`).pipe(Effect.andThen(notify(stopped)), Effect.forkScoped({ startImmediately: true }))
                } else if (!stopped || ["complete", "cancelled", "blocked"].includes(stopped.status)) leaseWakes.delete(jobId)
            }
        })
        yield* worker.pipe(Effect.forkScoped({ startImmediately: true }))
        return {
            notify,
            enqueue: (messageId: string) => store.reactionJobs({ serverId, operation: { type: "enqueue", messageId } }).pipe(Effect.flatMap((result: RolesReactionJobsResult) =>
                result.type === "job" ? notify(result.job) : Effect.fail(new RoleHandlingError({ stage: "claim" }))),
                Effect.catch((error) => error instanceof RolesStoreError && (error.status === 404 || error.status === 403) ? Effect.void : Effect.fail(error))),
        }
    })
}
