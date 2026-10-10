import { Schema } from "effect"
import { Id, Int, List, Millis, Text, origin } from "./common.ts"
import { ModerationActor } from "./shared.ts"

// Temporary voice rooms, see docs/BOT.md#temporary-voice-rooms

/** A server keeps at most ten generators and fifty temporary rooms */
export const VOICE_GENERATOR_LIMIT = 10, VOICE_ROOM_LIMIT = 50
// Fluxer removes U+000C and U+202E and trims names before its own 1 to 100 code unit check
export const VoiceChannelName = Text(100)
export const VoiceTemplate = Text(100).check(Schema.makeFilter((value: string) => !/[{}]/.test(value.replaceAll("{owner}", ""))))
export const VoiceUserLimit = Schema.NullOr(Int(1, 99))
export const VoiceRegion = Schema.NullOr(Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)))
export const VoiceCategory = Schema.NullOr(Id)

export const VoiceGenerator = Schema.Struct({ channelId: Id, categoryId: VoiceCategory, template: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)), userLimit: VoiceUserLimit,
    region: VoiceRegion, revision: Int(1), createdAt: Millis, updatedAt: Millis })
export type VoiceGenerator = typeof VoiceGenerator.Type
export const VoiceRoom = Schema.Struct({ channelId: Id, ownerId: Id, generatorChannelId: Id, createdAt: Millis })
export type VoiceRoom = typeof VoiceRoom.Type
/** Channel names are applied natively by the bot and validated by the backend, which does not store them */
export const VoiceGeneratorPatch = Schema.Struct({ channelName: Schema.optionalKey(VoiceChannelName), categoryId: Schema.optionalKey(VoiceCategory), template: Schema.optionalKey(VoiceTemplate),
    userLimit: Schema.optionalKey(VoiceUserLimit), region: Schema.optionalKey(VoiceRegion) }).check(Schema.makeFilter(value => Object.keys(value).length > 0))
export type VoiceGeneratorPatch = typeof VoiceGeneratorPatch.Type
export const VoiceManageOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("generator-add"), channelId: Id, channelName: VoiceChannelName, categoryId: VoiceCategory, template: VoiceTemplate, userLimit: VoiceUserLimit, region: VoiceRegion }),
    Schema.Struct({ type: Schema.Literal("generator-set"), channelId: Id, expectedRevision: Schema.optionalKey(Int()), patch: VoiceGeneratorPatch }),
    Schema.Struct({ type: Schema.Literal("generator-remove"), channelId: Id, expectedRevision: Schema.optionalKey(Int()) }),
])
export type VoiceManageOperation = typeof VoiceManageOperation.Type
export const VoiceManageRequest = Schema.Struct({ serverId: Id, messageId: Id, createdAt: Millis, actor: ModerationActor, operation: VoiceManageOperation })
export type VoiceManageRequest = typeof VoiceManageRequest.Type
export const VoiceManageResult = Schema.Union([Schema.Struct({ type: Schema.Literal("generator"), generator: VoiceGenerator }), Schema.Struct({ type: Schema.Literal("removed"), channelId: Id })])
export type VoiceManageResult = typeof VoiceManageResult.Type
export const VoiceQueryOperation = Schema.Union([Schema.Struct({ type: Schema.Literal("state") }), Schema.Struct({ type: Schema.Literal("authority"), actor: ModerationActor, channelId: Schema.optionalKey(Id) })])
export type VoiceQueryOperation = typeof VoiceQueryOperation.Type
export const VoiceQueryRequest = Schema.Struct({ serverId: Id, operation: VoiceQueryOperation })
export type VoiceQueryRequest = typeof VoiceQueryRequest.Type
const generators = List(VoiceGenerator, VOICE_GENERATOR_LIMIT)
export const VoiceQueryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("state"), generators, rooms: List(VoiceRoom, VOICE_ROOM_LIMIT) }),
    Schema.Struct({ type: Schema.Literal("authority"), staff: Schema.Boolean, room: Schema.NullOr(VoiceRoom), generators, rooms: Int(0, VOICE_ROOM_LIMIT) }),
])
export type VoiceQueryResult = typeof VoiceQueryResult.Type
export const VoiceRoomsOperation = Schema.Union([Schema.Struct({ type: Schema.Literal("create"), channelId: Id, ownerId: Id, generatorChannelId: Id }), Schema.Struct({ type: Schema.Literal("forget"), channelId: Id })])
export type VoiceRoomsOperation = typeof VoiceRoomsOperation.Type
export const VoiceRoomsRequest = Schema.Struct({ serverId: Id, operation: VoiceRoomsOperation })
export type VoiceRoomsRequest = typeof VoiceRoomsRequest.Type
export const VoiceRoomsResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("created"), room: VoiceRoom }),
    Schema.Struct({ type: Schema.Literal("refused"), reason: Schema.Literals(["generator", "owner", "room-limit"]), room: Schema.optionalKey(VoiceRoom) }),
    Schema.Struct({ type: Schema.Literal("forgotten"), room: Schema.Boolean, generator: Schema.Boolean }),
])
export type VoiceRoomsResult = typeof VoiceRoomsResult.Type
/** The generator channel the bot created for a dashboard request, read back from Fluxer in the configured server */
export const VoiceDashboardContext = Schema.Struct({ ...origin, channelId: Id })
export type VoiceDashboardContext = typeof VoiceDashboardContext.Type
