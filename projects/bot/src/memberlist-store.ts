import type * as C from "@neonflux/backend/contracts"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

const resultSchema = Schema.Struct({ revision: Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= 1)) })

export class MemberListStoreError extends Data.TaggedError("MemberListStoreError")<{ readonly status: number | null }> {}
export interface MemberListStore {
    manage(input: C.MemberListManageRequest): Effect.Effect<C.MemberListManageResult, MemberListStoreError>
}
export function createMemberListStore(config: BackendConfig): MemberListStore {
    const request = createBackendRequest(config)
    return {
        manage: input => request("/memberlist/manage", input).pipe(Effect.flatMap(Schema.decodeUnknownEffect(resultSchema, { onExcessProperty: "error" })),
            Effect.mapError(error => new MemberListStoreError({ status: "status" in error && typeof error.status === "number" ? error.status : null }))),
    }
}
