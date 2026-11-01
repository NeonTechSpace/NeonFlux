import { Schema } from "effect"
import { Id, Ids, Int, List, Millis, Str, Text, Token, origin } from "./common.ts"
import { MemberRequestJob } from "./member-content.ts"
import { ModerationActor } from "./shared.ts"

// Temporary voice rooms, see docs/BOT.md#temporary-voice-rooms

/** A server keeps at most ten generators and fifty temporary rooms */
export const VOICE_GENERATOR_LIMIT = 10,
    VOICE_ROOM_LIMIT = 50
// Fluxer removes U+000C and U+202E and trims names before its own 1 to 100 code unit check
export const VoiceChannelName = Text(100)
export const VoiceTemplate = Text(100).check(
    Schema.makeFilter((value: string) => !/[{}]/.test(value.replaceAll("{owner}", ""))),
)
export const VoiceUserLimit = Schema.NullOr(Int(1, 99))
export const VoiceRegion = Schema.NullOr(Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)))
export const isVoiceChannelName = Schema.is(VoiceChannelName),
    isVoiceTemplate = Schema.is(VoiceTemplate),
    isVoiceRegion = Schema.is(VoiceRegion)
export const VoiceCategory = Schema.NullOr(Id)

export const VoiceGenerator = Schema.Struct({
    channelId: Id,
    categoryId: VoiceCategory,
    template: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
    userLimit: VoiceUserLimit,
    region: VoiceRegion,
    /** False stops the room controls card for new rooms. Left out means on */
    panel: Schema.optionalKey(Schema.Boolean),
    revision: Int(1),
    createdAt: Millis,
    updatedAt: Millis,
})
export type VoiceGenerator = typeof VoiceGenerator.Type
const LOCK_GRANT_LIMIT = 1000
const HeldAllow = Schema.String.check(Schema.isPattern(/^\d{1,20}$/))
/** What the bot last read of a room in Fluxer, for the room's website page. Fluxer's overwrites stay the truth for every decision */
export const VoiceRoomView = Schema.Struct({
    name: Str(100),
    userLimit: Int(0, 99),
    hidden: Schema.Boolean,
    locked: Schema.Boolean,
    region: VoiceRegion,
    observedAt: Millis,
})
export type VoiceRoomView = typeof VoiceRoomView.Type
export const VoiceRoom = Schema.Struct({
    channelId: Id,
    ownerId: Id,
    generatorChannelId: Id,
    createdAt: Millis,
    /** The room controls card in the room's chat, which reactions on it act on */
    panelMessageId: Schema.optionalKey(Id),
    view: Schema.optionalKey(VoiceRoomView),
    /** The permission bits, in decimal, a lock or hide took from an explicit allow for everyone, which unlock and show give back */
    heldAllow: Schema.optionalKey(HeldAllow),
    /** The members a lock gave Connect so they can rejoin, which unlock takes back, leaving grants the lock did not add */
    lockGrants: Schema.optionalKey(Ids(LOCK_GRANT_LIMIT)),
})
export type VoiceRoom = typeof VoiceRoom.Type
/** Channel names are applied natively by the bot and validated by the backend, which does not store them */
export const VoiceGeneratorPatch = Schema.Struct({
    channelName: Schema.optionalKey(VoiceChannelName),
    categoryId: Schema.optionalKey(VoiceCategory),
    template: Schema.optionalKey(VoiceTemplate),
    userLimit: Schema.optionalKey(VoiceUserLimit),
    region: Schema.optionalKey(VoiceRegion),
    panel: Schema.optionalKey(Schema.Boolean),
}).check(Schema.makeFilter((value) => Object.keys(value).length > 0))
export type VoiceGeneratorPatch = typeof VoiceGeneratorPatch.Type
export const VoiceManageOperation = Schema.Union([
    Schema.Struct({
        type: Schema.Literal("generator-add"),
        channelId: Id,
        channelName: VoiceChannelName,
        categoryId: VoiceCategory,
        template: VoiceTemplate,
        userLimit: VoiceUserLimit,
        region: VoiceRegion,
    }),
    Schema.Struct({
        type: Schema.Literal("generator-set"),
        channelId: Id,
        expectedRevision: Schema.optionalKey(Int()),
        patch: VoiceGeneratorPatch,
    }),
    Schema.Struct({
        type: Schema.Literal("generator-remove"),
        channelId: Id,
        expectedRevision: Schema.optionalKey(Int()),
    }),
])
export type VoiceManageOperation = typeof VoiceManageOperation.Type
export const VoiceManageRequest = Schema.Struct({
    serverId: Id,
    messageId: Id,
    createdAt: Millis,
    actor: ModerationActor,
    operation: VoiceManageOperation,
})
export type VoiceManageRequest = typeof VoiceManageRequest.Type
export const VoiceManageResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("generator"), generator: VoiceGenerator }),
    Schema.Struct({ type: Schema.Literal("removed"), channelId: Id }),
])
export type VoiceManageResult = typeof VoiceManageResult.Type
export const VoiceQueryOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("state") }),
    Schema.Struct({ type: Schema.Literal("authority"), actor: ModerationActor, channelId: Schema.optionalKey(Id) }),
])
export type VoiceQueryOperation = typeof VoiceQueryOperation.Type
export const VoiceQueryRequest = Schema.Struct({ serverId: Id, operation: VoiceQueryOperation })
export type VoiceQueryRequest = typeof VoiceQueryRequest.Type
const generators = List(VoiceGenerator, VOICE_GENERATOR_LIMIT)
export const VoiceQueryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("state"), generators, rooms: List(VoiceRoom, VOICE_ROOM_LIMIT) }),
    Schema.Struct({
        type: Schema.Literal("authority"),
        staff: Schema.Boolean,
        room: Schema.NullOr(VoiceRoom),
        generators,
        rooms: Int(0, VOICE_ROOM_LIMIT),
        /** DEFCON pauses this member's room commands, which the room panel and website page follow too */
        paused: Schema.optionalKey(Schema.Literal(true)),
    }),
])
export type VoiceQueryResult = typeof VoiceQueryResult.Type
export const VoiceRoomsOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("create"), channelId: Id, ownerId: Id, generatorChannelId: Id }),
    Schema.Struct({ type: Schema.Literal("forget"), channelId: Id }),
    /** Gives a room to ownerId while expectedOwnerId still owns it */
    Schema.Struct({ type: Schema.Literal("transfer"), channelId: Id, expectedOwnerId: Id, ownerId: Id }),
    /** Records the room's panel message or what the bot last read of the room */
    Schema.Struct({
        type: Schema.Literal("update"),
        channelId: Id,
        panelMessageId: Schema.optionalKey(Id),
        view: Schema.optionalKey(VoiceRoomView),
        /** "0" clears it */
        heldAllow: Schema.optionalKey(HeldAllow),
        /** An empty list clears it */
        lockGrants: Schema.optionalKey(Ids(LOCK_GRANT_LIMIT)),
    }),
])
export type VoiceRoomsOperation = typeof VoiceRoomsOperation.Type
export const VoiceRoomsRequest = Schema.Struct({ serverId: Id, operation: VoiceRoomsOperation })
export type VoiceRoomsRequest = typeof VoiceRoomsRequest.Type
export const VoiceRoomsResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("created"), room: VoiceRoom }),
    Schema.Struct({
        type: Schema.Literal("refused"),
        reason: Schema.Literals(["generator", "owner", "room-limit"]),
        room: Schema.optionalKey(VoiceRoom),
    }),
    Schema.Struct({ type: Schema.Literal("forgotten"), room: Schema.Boolean, generator: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("transferred"), room: VoiceRoom }),
    /** owner: the new owner already owns a room. changed: the room is gone or has another owner by now */
    Schema.Struct({ type: Schema.Literal("not-transferred"), reason: Schema.Literals(["owner", "changed"]) }),
    /** room is null for a room that is gone */
    Schema.Struct({ type: Schema.Literal("updated"), room: Schema.NullOr(VoiceRoom) }),
])
export type VoiceRoomsResult = typeof VoiceRoomsResult.Type
/** The generator channel the bot created for a dashboard request, read back from Fluxer in the configured server */
export const VoiceDashboardContext = Schema.Struct({ ...origin, channelId: Id })
export type VoiceDashboardContext = typeof VoiceDashboardContext.Type

/** Website requests of a room owner, which the bot rechecks and carries out like the chat commands. Lookup reads the member's room again */
const roomRequest = <const T extends string, F extends Schema.Struct.Fields>(type: T, fields: F) =>
    Schema.Struct({ type: Schema.Literal(type), roomId: Id, ...fields })
export const VoiceMemberOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("lookup") }),
    roomRequest("rename", { name: VoiceChannelName }),
    roomRequest("limit", { limit: Int(0, 99) }),
    roomRequest("lock", {}),
    roomRequest("unlock", {}),
    roomRequest("hide", {}),
    roomRequest("show", {}),
    roomRequest("allow", { userId: Id }),
    roomRequest("block", { userId: Id }),
    roomRequest("transfer", { userId: Id }),
    roomRequest("region", { region: VoiceRegion }),
])
export type VoiceMemberOperation = typeof VoiceMemberOperation.Type
export const VoiceJob = MemberRequestJob(VoiceMemberOperation)
export type VoiceJob = typeof VoiceJob.Type
export const VoiceMemberReadyRequest = Schema.Struct({ serverId: Id })
export type VoiceMemberReadyRequest = typeof VoiceMemberReadyRequest.Type
export const VoiceMemberReadyResult = Schema.Struct({ jobs: List(VoiceJob, 4) })
export type VoiceMemberReadyResult = typeof VoiceMemberReadyResult.Type
/** The bot claims a request once before it acts, with the member's fresh roles, which a new room name is checked against */
export const VoiceMemberStartRequest = Schema.Struct({
    serverId: Id,
    jobId: Token,
    actorId: Id,
    roleIds: Ids(1000),
})
export type VoiceMemberStartRequest = typeof VoiceMemberStartRequest.Type
/** started is false for a request another pass claimed or the backend refused, which it finished with the reason */
export const VoiceMemberStartResult = Schema.Struct({ started: Schema.Boolean })
export type VoiceMemberStartResult = typeof VoiceMemberStartResult.Type
/** error says why the bot refused or could not finish the request, for the member's page */
export const VoiceMemberFinishRequest = Schema.Struct({
    serverId: Id,
    jobId: Token,
    error: Schema.optionalKey(Str(512).check(Schema.isMinLength(1))),
})
export type VoiceMemberFinishRequest = typeof VoiceMemberFinishRequest.Type
export const VoiceMemberFinishResult = Schema.Struct({ job: VoiceJob })
export type VoiceMemberFinishResult = typeof VoiceMemberFinishResult.Type
