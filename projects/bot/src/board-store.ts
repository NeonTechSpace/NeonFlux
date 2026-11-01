import {
    BoardQueryResult,
    BoardView,
    BoardWorkResult,
    type BoardManageRequest,
    type BoardQueryRequest,
    type BoardWorkRequest,
} from "@neonflux/contracts/boards"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

export class BoardStoreError extends Data.TaggedError("BoardStoreError")<{
    readonly operation: string
    readonly status: number | null
}> {}
export interface BoardStore {
    query(input: BoardQueryRequest): Effect.Effect<BoardQueryResult, BoardStoreError>
    manage(input: BoardManageRequest): Effect.Effect<BoardView, BoardStoreError>
    work(input: BoardWorkRequest): Effect.Effect<BoardWorkResult, BoardStoreError>
}
export function createBoardStore(config: BackendConfig): BoardStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) =>
        request(`/boards/${operation}`, input).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.mapError(
                (error) =>
                    new BoardStoreError({
                        operation,
                        status: "status" in error && typeof error.status === "number" ? error.status : null,
                    }),
            ),
        )
    return {
        query: (input) => call("query", input, BoardQueryResult),
        manage: (input) => call("manage", input, BoardView),
        work: (input) => call("work", input, BoardWorkResult),
    }
}
