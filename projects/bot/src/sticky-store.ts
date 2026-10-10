import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= min && v <= max))
const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
export const stickySchema = Schema.Struct({ channelId: id, content: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)), intervalSeconds: integer(10, 3600),
    messageId: Schema.NullOr(id), revision: integer(1), updatedAt: integer() })
const listSchema = Schema.Struct({ stickies: Schema.mutable(Schema.Array(stickySchema)).check(Schema.isMaxLength(5)) })
const manageSchema = Schema.Struct({ type: Schema.Literals(["saved", "removed"]), sticky: stickySchema })
const postedSchema = Schema.Union([Schema.Struct({ accepted: Schema.Literal(true), sticky: stickySchema }), Schema.Struct({ accepted: Schema.Literal(false), sticky: Schema.NullOr(stickySchema) })])

export class StickyStoreError extends Data.TaggedError("StickyStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface StickyStore {
    list(input: C.StickyListRequest): Effect.Effect<C.StickyListResult, StickyStoreError>
    manage(input: C.StickyManageRequest): Effect.Effect<C.StickyManageResult, StickyStoreError>
    posted(input: C.StickyPostedRequest): Effect.Effect<C.StickyPostedResult, StickyStoreError>
}
export function createStickyStore(config: BackendConfig): StickyStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/sticky/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new StickyStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        list: input => call("list", input, listSchema),
        manage: input => call("manage", input, manageSchema),
        posted: input => call("posted", input, postedSchema) as Effect.Effect<C.StickyPostedResult, StickyStoreError>,
    }
}
