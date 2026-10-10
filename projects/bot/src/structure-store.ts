import type * as D from "@neonflux/backend/dashboard-contracts"
import { Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

const id = Schema.String.check(Schema.makeFilter(value => /^[1-9]\d{0,18}$/.test(value)))
const integer = Schema.Number.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0))
const work = Schema.Union([Schema.Struct({ type: Schema.Literal("read") }), Schema.Struct({ type: Schema.Literal("threads"), channelId: id }), Schema.Struct({ type: Schema.Literal("save") })])
const readySchema = Schema.Struct({ jobs: Schema.Array(Schema.Struct({ userId: id, requestedAt: integer, work })).check(Schema.isMaxLength(10)) })
const applySchema = Schema.Union([
    Schema.Struct({ itemNo: integer, type: Schema.Literal("rename"), channelId: id, name: Schema.String.check(Schema.isMaxLength(100)) }),
    Schema.Struct({ itemNo: integer, type: Schema.Literal("move"), channelId: id, parentId: Schema.NullOr(id), precedingSiblingId: Schema.NullOr(id) }),
])
const claimSchema = Schema.Struct({ claimed: Schema.Boolean, applyUntil: integer, apply: Schema.Array(applySchema).check(Schema.isMaxLength(100)) })
const recordedSchema = Schema.Struct({ recorded: Schema.Boolean })

export type StructureJob = typeof readySchema.Type["jobs"][number]
export type StructureAnswer = { read: Omit<D.StructureRead, "readAt"> } | { threads: { channelId: string, threads: D.StructureThread[], more: boolean } } | { failure: "access" | "error" }
export type StructureWriteResult = { itemNo: number, outcome: "applied" | "failed" | "uncertain", reason?: string }

/** The structure editor's backend requests. A recorded read arms one change notice, which the next channel event of the server sends */
export function createStructureStore(backend: BackendConfig) {
    const request = createBackendRequest(backend)
    const job = (serverId: string, value: StructureJob) => ({ serverId, userId: value.userId, requestedAt: value.requestedAt })
    let armed = false
    return {
        ready: (serverId: string) => request("/structure/ready", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(readySchema))),
        answer: (serverId: string, value: StructureJob, answer: StructureAnswer) => request("/structure/answer", { ...job(serverId, value), work: value.work.type,
            ...("failure" in answer ? {} : { originServerId: serverId }), ...answer }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(recordedSchema)),
            Effect.tap(result => Effect.sync(() => { if (result.recorded && "read" in answer) armed = true }))),
        claim: (serverId: string, value: StructureJob, current: readonly D.StructureChannel[]) => request("/structure/claim", { ...job(serverId, value), originServerId: serverId, current })
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(claimSchema))),
        record: (serverId: string, value: StructureJob, results: readonly StructureWriteResult[]) => request("/structure/record", { ...job(serverId, value), results })
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(recordedSchema))),
        /** A channel was created, changed, deleted or reordered. Only the first such event after a read reaches the backend */
        serverChanged: (serverId: string) => Effect.suspend(() => {
            if (!armed) return Effect.void
            armed = false
            return request("/structure/changed", { serverId }).pipe(Effect.asVoid, Effect.catch(() => Effect.sync(() => { armed = true })))
        }),
    }
}
export type StructureStore = ReturnType<typeof createStructureStore>
