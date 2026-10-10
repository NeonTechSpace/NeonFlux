import { SidebarResult, type SidebarGetRequest, type SidebarManageRequest } from "@neonflux/contracts/sidebar"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class SidebarStoreError extends Data.TaggedError("SidebarStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface SidebarStore {
    get(input: SidebarGetRequest): Effect.Effect<SidebarResult, SidebarStoreError>
    manage(input: SidebarManageRequest): Effect.Effect<SidebarResult, SidebarStoreError>
}
export function createSidebarStore(config: BackendConfig): SidebarStore {
    const request = createBackendRequest(config)
    const call = (operation: string, input: unknown) => request(`/sidebar/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(SidebarResult, { onExcessProperty: "error" })),
        Effect.mapError(error => new SidebarStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return { get: input => call("get", input), manage: input => call("manage", input) }
}
