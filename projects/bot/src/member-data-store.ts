import type * as C from "@neonflux/backend/contracts"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest, rootBackend } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { validServerId } from "./server-scope.ts"

const count = Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= 0))
const serverId = Schema.String.check(Schema.makeFilter(validServerId))
const text = Schema.String.check(Schema.isMaxLength(500))
const cursor = Schema.NullOr(Schema.Struct({ table: count, after: Schema.Number.check(Schema.makeFilter(v => Number.isFinite(v) && v >= 0)) }))
const listSchema = Schema.Struct({ complete: Schema.Boolean, servers: Schema.mutable(Schema.Array(Schema.Struct({ serverId,
    features: Schema.mutable(Schema.Array(Schema.Struct({ feature: text, count, kept: Schema.NullOr(text) }))) }))) })
const serversSchema = Schema.Struct({ serverIds: Schema.mutable(Schema.Array(serverId)), cursor: Schema.NullOr(Schema.Struct({ table: count, after: Schema.NullOr(serverId) })) })
const exportSchema =Schema.Struct({ cursor, records: Schema.mutable(Schema.Array(Schema.Struct({ feature: text, data: Schema.Record(Schema.String, Schema.Unknown) })).check(Schema.isMaxLength(100))) })
const deleteSchema = Schema.Struct({ cursor, deleted: Schema.mutable(Schema.Array(Schema.Struct({ feature: text, count }))),
    kept: Schema.mutable(Schema.Array(Schema.Struct({ feature: text, count, reason: text }))) })

export class MemberDataStoreError extends Data.TaggedError("MemberDataStoreError")<{ readonly operation: string, readonly status: number | null }> {}
/** A member's own data across servers. The bot vouches for the member's ID after verifying the private conversation */
export interface MemberDataStore {
    list(input: { userId: string }): Effect.Effect<C.MemberDataList, MemberDataStoreError>
    servers(input: { userId: string, cursor: C.MemberDataServerCursor | null }): Effect.Effect<C.MemberDataServerPage, MemberDataStoreError>
    export(input: { userId: string, serverId: string, cursor: C.MemberDataCursor | null }): Effect.Effect<C.MemberDataExportPage, MemberDataStoreError>
    delete(input: { userId: string, userName: string, serverId: string, cursor: C.MemberDataCursor | null }): Effect.Effect<C.MemberDataDeletePage, MemberDataStoreError>
}
// These requests bind no server, because a member's data spans every server
export function createMemberDataStore(config: BackendConfig): MemberDataStore {
    const request = createBackendRequest(rootBackend(config))
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/service/member-data/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new MemberDataStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        list: input => call("list", input, listSchema),
        servers: input => call("servers", input, serversSchema),
        export: input => call("export", input, exportSchema),
        delete: input => call("delete", input, deleteSchema),
    }
}
