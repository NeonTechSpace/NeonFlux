import { MemberListManageResult, type MemberListManageRequest } from "@neonflux/contracts/member-list"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class MemberListStoreError extends Data.TaggedError("MemberListStoreError")<{ readonly status: number | null }> {}
export interface MemberListStore {
    manage(input: MemberListManageRequest): Effect.Effect<MemberListManageResult, MemberListStoreError>
}
export function createMemberListStore(config: BackendConfig): MemberListStore {
    const request = createBackendRequest(config)
    return {
        manage: input => request("/memberlist/manage", input).pipe(Effect.flatMap(Schema.decodeUnknownEffect(MemberListManageResult, { onExcessProperty: "error" })),
            Effect.mapError(error => new MemberListStoreError({ status: "status" in error && typeof error.status === "number" ? error.status : null }))),
    }
}
