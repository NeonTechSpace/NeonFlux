import { Duration, Effect } from "effect"
import type { ServiceWork, ServiceWorkKind } from "@neonflux/backend/contracts"
import type { BackendConfig } from "./config.ts"
import { createBackendRequest } from "./backend-http.ts"
import { validServerId } from "./server-scope.ts"

export const workKinds = ["dashboard", "verification", "events", "schedules", "milestones", "suggestions", "cleanup", "metadata", "levels"] as const satisfies readonly ServiceWorkKind[]
const everyKind: [Exclude<ServiceWorkKind, typeof workKinds[number]>] extends [never] ? true : false = true
void everyKind
export const workPollMs = 5000
export const workBackoffMaxMs = 300000
// The pause before the next poll. Consecutive failures double it up to five minutes, and a success restores five seconds
export const workDelay = (failures: number) => failures === 0 ? workPollMs : Math.min(workBackoffMaxMs, workPollMs * 2 ** failures)

function decodeWork(value: unknown): ServiceWork | undefined {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
    const { kinds, cursor } = value as Partial<ServiceWork>
    if (cursor !== null && (typeof cursor !== "string" || !cursor.length || cursor.length > 4096)) return undefined
    if (kinds === null || typeof kinds !== "object") return undefined
    for (const kind of workKinds) {
        const serverIds: unknown = kinds[kind]
        if (!Array.isArray(serverIds) || serverIds.length > 100 || !serverIds.every(validServerId) || new Set(serverIds).size !== serverIds.length) return undefined
    }
    return { kinds, cursor }
}

export type WorkWake = (serverId: string, kind: ServiceWorkKind) => Effect.Effect<void>
export interface WorkDispatcherOptions {
    /** Waits between polls. Tests replace it with a barrier */
    readonly sleep?: (millis: number) => Effect.Effect<void>
}
// The one dispatcher for the whole process. It asks the backend which servers have due work and wakes those servers'
// workers, so a server without due work causes no backend requests. Wakes only signal a worker's queue, so every wake
// is delivered before the dispatcher sleeps and a busy worker never holds it
export function startWorkDispatcher(backend: BackendConfig, wake: WorkWake, options: WorkDispatcherOptions = {}) {
    // The route binds no server, so the root configuration sends no server header
    const post = createBackendRequest(Object.freeze({ siteUrl: backend.siteUrl, secret: backend.secret }))
    const sleep = options.sleep ?? (millis => Effect.sleep(Duration.millis(millis)))
    return Effect.gen(function* () {
        let cursor: string | null = null, failures = 0
        for (;;) {
            const work: ServiceWork | undefined = yield* post("/service/work", { cursor }).pipe(Effect.map(decodeWork), Effect.catch(() => Effect.succeed(undefined)))
            if (work) {
                failures = 0
                cursor = work.cursor
                for (const kind of workKinds) for (const serverId of work.kinds[kind]) yield* Effect.exit(wake(serverId, kind))
            } else {
                failures++
                // A rejected cursor must not repeat, so the next poll starts over
                cursor = null
                yield* Effect.logWarning(`Background work dispatch is unavailable. Retrying in ${workDelay(failures) / 1000} seconds`)
            }
            yield* sleep(workDelay(failures))
        }
    }).pipe(Effect.forkScoped({ startImmediately: true }), Effect.asVoid)
}
