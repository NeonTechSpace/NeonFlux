import { MemberDataDeletePage, MemberDataExportPage, MemberDataList, MemberDataServerPage, type MemberDataDeleteRequest, type MemberDataExportRequest, type MemberDataListRequest,
    type MemberDataServersRequest } from "@neonflux/contracts/member-data"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest, rootBackend } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class MemberDataStoreError extends Data.TaggedError("MemberDataStoreError")<{ readonly operation: string, readonly status: number | null }> {}
/** A member's own data across servers. The bot vouches for the member's ID after verifying the private conversation */
export interface MemberDataStore {
    list(input: MemberDataListRequest): Effect.Effect<MemberDataList, MemberDataStoreError>
    servers(input: MemberDataServersRequest): Effect.Effect<MemberDataServerPage, MemberDataStoreError>
    export(input: MemberDataExportRequest): Effect.Effect<MemberDataExportPage, MemberDataStoreError>
    delete(input: MemberDataDeleteRequest): Effect.Effect<MemberDataDeletePage, MemberDataStoreError>
}
// These requests bind no server, because a member's data spans every server
export function createMemberDataStore(config: BackendConfig): MemberDataStore {
    const request = createBackendRequest(rootBackend(config))
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/service/member-data/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new MemberDataStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        list: input => call("list", input, MemberDataList),
        servers: input => call("servers", input, MemberDataServerPage),
        export: input => call("export", input, MemberDataExportPage),
        delete: input => call("delete", input, MemberDataDeletePage),
    }
}
