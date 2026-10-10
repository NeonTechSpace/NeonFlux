import { StructureAnswerResult, StructureClaim, StructureReadyResult, StructureRecordResult, type StructureChannel, type StructureReadAnswer, type StructureReadyJob, type StructureThreadPage,
    type StructureWriteResult } from "@neonflux/contracts/structure"
import { Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export type StructureAnswer = { read: StructureReadAnswer } | { threads: StructureThreadPage } | { failure: "access" | "error" }

/** The structure editor's backend requests. A recorded read arms one change notice, which the next channel event of the server sends */
export function createStructureStore(backend: BackendConfig) {
    const request = createBackendRequest(backend)
    const job = (serverId: string, value: StructureReadyJob) => ({ serverId, userId: value.userId, requestedAt: value.requestedAt })
    let armed = false
    return {
        ready: (serverId: string) => request("/structure/ready", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(StructureReadyResult))),
        answer: (serverId: string, value: StructureReadyJob, answer: StructureAnswer) => request("/structure/answer", { ...job(serverId, value), work: value.work.type,
            ...("failure" in answer ? {} : { originServerId: serverId }), ...answer }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(StructureAnswerResult)),
            Effect.tap(result => Effect.sync(() => { if (result.recorded && "read" in answer) armed = true }))),
        claim: (serverId: string, value: StructureReadyJob, current: readonly StructureChannel[]) => request("/structure/claim", { ...job(serverId, value), originServerId: serverId, current })
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(StructureClaim))),
        record: (serverId: string, value: StructureReadyJob, results: readonly StructureWriteResult[]) => request("/structure/record", { ...job(serverId, value), results })
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(StructureRecordResult))),
        /** A channel was created, changed, deleted or reordered. Only the first such event after a read reaches the backend */
        serverChanged: (serverId: string) => Effect.suspend(() => {
            if (!armed) return Effect.void
            armed = false
            return request("/structure/changed", { serverId }).pipe(Effect.asVoid, Effect.catch(() => Effect.sync(() => { armed = true })))
        }),
    }
}
export type StructureStore = ReturnType<typeof createStructureStore>
