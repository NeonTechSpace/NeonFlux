import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { voiceGeneratorSchema, voiceRoomSchema } from "./voice-store.ts"

const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= min && v <= max))
const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
const settings = Schema.Struct({ enabled: Schema.Boolean, channelId: Schema.NullOr(id), generatorChannelId: Schema.NullOr(id), expiryMinutes: integer(10, 1440), maxSize: integer(2, 25),
    memberGroups: integer(1, 5), serverGroups: integer(1, 50) })
export const lfgGroupSchema = Schema.Struct({ groupNo: integer(1), hostId: id, activity: text(50), size: integer(2, 25), note: Schema.optionalKey(text(200)), startsAt: Schema.optionalKey(integer()),
    channelId: id, messageId: Schema.NullOr(id), memberIds: Schema.mutable(Schema.Array(id)).check(Schema.isMinLength(1), Schema.isMaxLength(25)), expiresAt: integer(), createdAt: integer() })
const groups = (max: number) => Schema.mutable(Schema.Array(lfgGroupSchema)).check(Schema.isMaxLength(max))
const refusal = Schema.Literals(["off", "size", "member-limit", "server-limit", "missing", "joined", "full", "host", "not-joined", "permission", "generator", "room-limit"])
const manageSchema = Schema.Union([Schema.Struct({ type: Schema.Literal("settings"), revision: integer(), settings }), Schema.Struct({ type: Schema.Literals(["group", "closed"]), group: lfgGroupSchema }),
    Schema.Struct({ type: Schema.Literal("started"), group: lfgGroupSchema, room: voiceRoomSchema, created: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("refused"), reason: refusal, limit: Schema.optionalKey(integer()) })])
const querySchema = Schema.Union([Schema.Struct({ type: Schema.Literal("groups"), revision: integer(), settings, groups: groups(50) }),
    Schema.Struct({ type: Schema.Literal("start"), group: Schema.NullOr(lfgGroupSchema), generator: Schema.NullOr(voiceGeneratorSchema) })])

export class LfgStoreError extends Data.TaggedError("LfgStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface LfgStore {
    query(input: C.LfgQueryRequest): Effect.Effect<C.LfgQueryResult, LfgStoreError>
    manage(input: C.LfgManageRequest): Effect.Effect<C.LfgManageResult, LfgStoreError>
    work(input: C.LfgWorkRequest): Effect.Effect<C.LfgWorkResult, LfgStoreError>
}
export function createLfgStore(config: BackendConfig): LfgStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/lfg/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new LfgStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        query: input => call("query", input, querySchema) as Effect.Effect<C.LfgQueryResult, LfgStoreError>,
        manage: input => call("manage", input, manageSchema) as Effect.Effect<C.LfgManageResult, LfgStoreError>,
        work: input => call("work", input, Schema.Struct({ groups: groups(10) })) as Effect.Effect<C.LfgWorkResult, LfgStoreError>,
    }
}
