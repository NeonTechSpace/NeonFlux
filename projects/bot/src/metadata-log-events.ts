import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect } from "effect"
import type { MetadataLogsStore } from "./metadata-log-store.ts"
import { createMetadataObservationSession, projectMetadataEvent } from "./metadata-log-projector.ts"
import { readAuthenticatedBotId } from "./safety-permissions.ts"

/** How long gateway events skip admission after the backend answered that metadata logs are off, unless a logs change rechecks sooner */
export const METADATA_OFF_RECHECK_MS = 60000
/** Each server's recheck by server ID, registered while its runtime runs */
export const metadataRechecks = new Map<string, () => void>()

export function createMetadataGatewayAdmission(store: MetadataLogsStore, serverId: string, notify: () => Effect.Effect<void>) {
    const observation = createMetadataObservationSession()
    // A recheck starts a new generation, so a disabled answer to an admission sent before it cannot pause admission again
    let lastFailureAt = -Infinity, failures = 0, offUntil = 0, generation = 0
    const admit = (name: string, payload: unknown, client: Client) => Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        if (now < offUntil) return
        const asked = generation
        const botId = yield* readAuthenticatedBotId(client).pipe(Effect.catch(() => Effect.succeed(undefined)))
        const scope = observation(serverId, now)
        const event = projectMetadataEvent(name, payload, { ...scope, ...(botId ? { botId } : {}) })
        if (!event) return
        const result = yield* store.admit({ serverId, event })
        if (result.admitted) yield* notify()
        else if (result.reason === "disabled" && asked === generation) offUntil = now + METADATA_OFF_RECHECK_MS
    }).pipe(Effect.catchCause(cause => {
        if (Cause.hasInterrupts(cause)) return Effect.failCause(cause)
        return Effect.gen(function* () {
            failures = Math.min(10000, failures + 1)
            const now = yield* Clock.currentTimeMillis
            if (now - lastFailureAt < 60000) return
            lastFailureAt = now
            const count = failures; failures = 0
            const scope = observation(serverId, now)
            yield* store.admit({ serverId, event: { category: "operations", type: "admission-failure", source: { kind: "observation", sessionId: scope.sessionId, sequence: scope.sequence }, observedAt: now, actor: { kind: "unknown" }, resourceIds: [], changedFields: [], count, outcome: "failed" } }).pipe(Effect.catch(() => Effect.void))
        })
    }))
    return Object.assign(admit, { recheck: () => { offUntil = 0; generation++ } })
}
