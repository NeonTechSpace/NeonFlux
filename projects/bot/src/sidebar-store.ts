import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

const integer = (min = 0) => Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= min))
const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const resultSchema = Schema.Struct({ link: Schema.NullOr(Schema.Struct({ channelId: id, revision: integer(1), updatedAt: integer() })) })

export class SidebarStoreError extends Data.TaggedError("SidebarStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface SidebarStore {
    get(input: C.SidebarGetRequest): Effect.Effect<C.SidebarResult, SidebarStoreError>
    manage(input: C.SidebarManageRequest): Effect.Effect<C.SidebarResult, SidebarStoreError>
}
export function createSidebarStore(config: BackendConfig): SidebarStore {
    const request = createBackendRequest(config)
    const call = (operation: string, input: unknown) => request(`/sidebar/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(resultSchema, { onExcessProperty: "error" })),
        Effect.mapError(error => new SidebarStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return { get: input => call("get", input), manage: input => call("manage", input) }
}
