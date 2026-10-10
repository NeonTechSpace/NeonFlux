import {
    ServerExportPage,
    ServerExportStartResult,
    type ServerExportPageRequest,
    type ServerExportStartRequest,
} from "@neonflux/contracts/server-export"
import { Effect, Schema } from "effect"
import { createBackendRequest, type BackendRequestError } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

/** The readable server export. Every request carries the bot's fresh evidence that the server owner asked in a private conversation */
export interface ServerExportStore {
    start(
        input: ServerExportStartRequest,
    ): Effect.Effect<ServerExportStartResult, BackendRequestError | Schema.SchemaError>
    page(input: ServerExportPageRequest): Effect.Effect<ServerExportPage, BackendRequestError | Schema.SchemaError>
}
export function createServerExportStore(config: BackendConfig): ServerExportStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) =>
        request(`/export/${operation}`, input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        )
    return {
        start: (input) => call("start", input, ServerExportStartResult),
        page: (input) => call("page", input, ServerExportPage),
    }
}
