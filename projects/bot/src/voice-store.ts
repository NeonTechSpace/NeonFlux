import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"

const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter(v => Number.isSafeInteger(v) && v >= min && v <= max))
const id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const array = <A>(schema: Schema.Codec<A>, max: number) => Schema.mutable(Schema.Array(schema)).check(Schema.isMaxLength(max))
export const voiceGeneratorSchema = Schema.Struct({ channelId: id, categoryId: Schema.NullOr(id), template: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
    userLimit: Schema.NullOr(integer(1, 99)), region: Schema.NullOr(Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/))), revision: integer(1), createdAt: integer(), updatedAt: integer() })
export const voiceRoomSchema = Schema.Struct({ channelId: id, ownerId: id, generatorChannelId: id, createdAt: integer() })
const generators = array(voiceGeneratorSchema, 10), rooms = array(voiceRoomSchema, 50)
const querySchema = Schema.Union([Schema.Struct({ type: Schema.Literal("state"), generators, rooms }),
    Schema.Struct({ type: Schema.Literal("authority"), staff: Schema.Boolean, room: Schema.NullOr(voiceRoomSchema), generators, rooms: integer(0, 50) })])
const manageSchema = Schema.Union([Schema.Struct({ type: Schema.Literal("generator"), generator: voiceGeneratorSchema }), Schema.Struct({ type: Schema.Literal("removed"), channelId: id })])
const roomsSchema = Schema.Union([Schema.Struct({ type: Schema.Literal("created"), room: voiceRoomSchema }),
    Schema.Struct({ type: Schema.Literal("refused"), reason: Schema.Literals(["generator", "owner", "room-limit"]), room: Schema.optionalKey(voiceRoomSchema) }),
    Schema.Struct({ type: Schema.Literal("forgotten"), room: Schema.Boolean, generator: Schema.Boolean })])

export class VoiceStoreError extends Data.TaggedError("VoiceStoreError")<{ readonly operation: string, readonly status: number | null }> {}
export interface VoiceStore {
    query(input: C.VoiceQueryRequest): Effect.Effect<C.VoiceQueryResult, VoiceStoreError>
    manage(input: C.VoiceManageRequest): Effect.Effect<C.VoiceManageResult, VoiceStoreError>
    rooms(input: C.VoiceRoomsRequest): Effect.Effect<C.VoiceRoomsResult, VoiceStoreError>
}
export function createVoiceStore(config: BackendConfig): VoiceStore {
    const request = createBackendRequest(config)
    const call = <A>(operation: string, input: unknown, schema: Schema.Codec<A>) => request(`/voice/${operation}`, input).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
        Effect.mapError(error => new VoiceStoreError({ operation, status: "status" in error && typeof error.status === "number" ? error.status : null })))
    return {
        query: input => call("query", input, querySchema) as Effect.Effect<C.VoiceQueryResult, VoiceStoreError>,
        manage: input => call("manage", input, manageSchema) as Effect.Effect<C.VoiceManageResult, VoiceStoreError>,
        rooms: input => call("rooms", input, roomsSchema) as Effect.Effect<C.VoiceRoomsResult, VoiceStoreError>,
    }
}
