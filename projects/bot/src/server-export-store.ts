import type * as C from "@neonflux/backend/contracts"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { validServerId } from "./server-scope.ts"

const n = Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= 0))
const id = Schema.String.check(Schema.makeFilter(validServerId))
const text = Schema.String.check(Schema.isMaxLength(4000))
const optional = Schema.optionalKey
const list = <A>(s: Schema.Codec<A>, max: number) => Schema.mutable(Schema.Array(s)).check(Schema.isMaxLength(max))
const cursor = Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096)))
const correction = Schema.Struct({ type: Schema.Literals(["reason", "void"]), actorId: id, previousReason: text, reason: text, createdAt: n })
const exportCase = Schema.Struct({ caseNo: n, action: text, origin: text, incident: optional(text), actorId: optional(id), targetId: optional(id), channelId: optional(id), ruleName: optional(text),
    linkedCaseNo: optional(n), reason: Schema.NullOr(text), outcome: text, voided: Schema.Boolean, erased: Schema.Boolean, createdAt: n, corrections: list(correction, 21) })
const exportAppeal = Schema.Struct({ appealNo: n, caseNo: n, userId: id, status: text, text: Schema.NullOr(text), decisionReason: optional(Schema.NullOr(text)), decidedBy: optional(id),
    decidedAt: optional(n), erased: Schema.Boolean, createdAt: n })
// Page sizes match the backend's bounds, so a page that is larger was not built by it
const pageSchema = Schema.Union([
    Schema.Struct({ cursor, section: Schema.Literal("settings"), family: Schema.String.check(Schema.isPattern(/^[a-z]{1,32}$/)), data: Schema.Record(Schema.String, Schema.Unknown) }),
    Schema.Struct({ cursor, section: Schema.Literal("levels"), levels: list(Schema.Struct({ userId: id, xp: n, level: n }), 500) }),
    Schema.Struct({ cursor, section: Schema.Literal("cases"), cases: list(exportCase, 100) }),
    Schema.Struct({ cursor, section: Schema.Literal("appeals"), appeals: list(exportAppeal, 200) }),
])
const startSchema = Schema.Struct({ version: Schema.Literal(1) })

export class ServerExportStoreError extends Data.TaggedError("ServerExportStoreError")<{ readonly operation: string, readonly status: number | null }> {}
/** The readable server export. Every request carries the bot's fresh evidence that the server owner asked in a private conversation */
export interface ServerExportStore {
    start(input: { serverId: string, context: C.BackupContext }): Effect.Effect<{ version: 1 }, ServerExportStoreError>
    page(input: { serverId: string, context: C.BackupContext, cursor: string | null }): Effect.Effect<C.ServerExportPage, ServerExportStoreError>
}
export function createServerExportStore(config: BackendConfig): ServerExportStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/export/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new ServerExportStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        start: input => call("start", input, startSchema),
        page: input => call("page", input, pageSchema) as Effect.Effect<C.ServerExportPage, ServerExportStoreError>,
    }
}
