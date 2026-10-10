import { ServerExportPage, ServerExportStartResult, type ServerExportPageRequest, type ServerExportStartRequest } from "@neonflux/contracts/server-export"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class ServerExportStoreError extends Data.TaggedError("ServerExportStoreError")<{ readonly operation: string, readonly status: number | null }> {}
/** The readable server export. Every request carries the bot's fresh evidence that the server owner asked in a private conversation */
export interface ServerExportStore {
    start(input: ServerExportStartRequest): Effect.Effect<ServerExportStartResult, ServerExportStoreError>
    page(input: ServerExportPageRequest): Effect.Effect<ServerExportPage, ServerExportStoreError>
}
export function createServerExportStore(config: BackendConfig): ServerExportStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/export/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new ServerExportStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        start: input => call("start", input, ServerExportStartResult),
        page: input => call("page", input, ServerExportPage),
    }
}
