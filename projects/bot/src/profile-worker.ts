import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect } from "effect"
import type { ProfileStore } from "./profile-store.ts"
import { readMemberContent } from "./showcase-worker.ts"

// Website profile saves from the dashboard job queue. The bot reads the member fresh, and the backend decides with the current settings,
// access lists and automod rules
export function processProfilePass(store: ProfileStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        const ready = yield* store.ready({ serverId })
        for (const job of ready.jobs) yield* Effect.gen(function* () {
            if ((yield* Clock.currentTimeMillis) >= job.expiresAt) return
            yield* store.apply({ serverId, jobId: job.id, actorId: job.actorId, member: yield* readMemberContent(client, serverId, job.actorId) })
        }).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
            : store.fail({ serverId, jobId: job.id }).pipe(Effect.catch(() => Effect.void))))
    })
}
