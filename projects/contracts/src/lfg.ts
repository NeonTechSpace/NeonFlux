import { Schema } from "effect"
import { Id, Int, List, Millis, hasText, origin } from "./common.ts"
import { ModerationActor } from "./shared.ts"
import { VoiceGenerator, VoiceRoom } from "./voice.ts"

// Looking for group, see docs/BOT.md#looking-for-group

export const LFG_LIMITS = { expiryMinutes: [10, 1440], maxSize: [2, 25], memberGroups: [1, 5], serverGroups: [1, 50] } as const
/** Activities have 1 to 50 characters and notes 1 to 200. A start time lies at most seven days ahead */
export const LFG_ACTIVITY_LENGTH = 50, LFG_NOTE_LENGTH = 200, LFG_START_MINUTES = 10080
/** Due groups the worker closes per request */
export const LFG_WORK_PAGE = 10
const limit = (key: keyof typeof LFG_LIMITS) => Int(LFG_LIMITS[key][0], LFG_LIMITS[key][1])
const channel = Schema.NullOr(Id), text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
// One line of visible text, since activities and notes appear in the group card and the room name
const line = (max: number) => Schema.String.check(Schema.isMaxLength(max), Schema.makeFilter((value: string) => !/[\r\n]/.test(value) && hasText(value)))

/**
 * Looking for group. channelId receives the group cards, and generatorChannelId names the voice generator whose category, member limit
 * and region group rooms use. An open group closes expiryMinutes after it was posted, or after its start time when it names one.
 * memberGroups limits the open groups one member hosts and serverGroups the open groups of the server
 */
export const LfgSettings = Schema.Struct({ enabled: Schema.Boolean, channelId: channel, generatorChannelId: channel, expiryMinutes: limit("expiryMinutes"), maxSize: limit("maxSize"),
    memberGroups: limit("memberGroups"), serverGroups: limit("serverGroups") })
export type LfgSettings = typeof LfgSettings.Type
export const LfgSettingsPatch = Schema.Struct({ enabled: Schema.optionalKey(Schema.Boolean), channelId: Schema.optionalKey(channel), generatorChannelId: Schema.optionalKey(channel),
    expiryMinutes: Schema.optionalKey(limit("expiryMinutes")), maxSize: Schema.optionalKey(limit("maxSize")), memberGroups: Schema.optionalKey(limit("memberGroups")),
    serverGroups: Schema.optionalKey(limit("serverGroups")) }).check(Schema.makeFilter(value => Object.keys(value).length > 0))
export type LfgSettingsPatch = typeof LfgSettingsPatch.Type
/** One open group. memberIds starts with the host, and size counts the host. messageId is the group's card once the bot posted it */
export const LfgGroup = Schema.Struct({ groupNo: Int(1), hostId: Id, activity: text(LFG_ACTIVITY_LENGTH), size: limit("maxSize"), note: Schema.optionalKey(text(LFG_NOTE_LENGTH)),
    startsAt: Schema.optionalKey(Millis), channelId: Id, messageId: Schema.NullOr(Id), memberIds: List(Id, LFG_LIMITS.maxSize[1]).check(Schema.isMinLength(1)), expiresAt: Millis, createdAt: Millis })
export type LfgGroup = typeof LfgGroup.Type
const groupNo = Int(1)
export const LfgOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), patch: LfgSettingsPatch }),
    Schema.Struct({ type: Schema.Literal("create"), activity: line(LFG_ACTIVITY_LENGTH), size: Int(2, LFG_LIMITS.maxSize[1]), note: Schema.optionalKey(line(LFG_NOTE_LENGTH)),
        startsInMinutes: Schema.optionalKey(Int(1, LFG_START_MINUTES)) }),
    Schema.Struct({ type: Schema.Literal("join"), groupNo }),
    Schema.Struct({ type: Schema.Literal("leave"), groupNo }),
    Schema.Struct({ type: Schema.Literal("cancel"), groupNo }),
    Schema.Struct({ type: Schema.Literal("card"), groupNo, messageId: Id }),
    /** channelId is the room the bot just created for the group */
    Schema.Struct({ type: Schema.Literal("start"), groupNo, channelId: Id }),
])
export type LfgOperation = typeof LfgOperation.Type
/** managerAuthorized is a fresh Manage Server or Administrator read. Settings need it, and so do cancelling and starting another member's group that is not full */
export const LfgManageRequest = Schema.Struct({ ...origin, serverId: Id, messageId: Id, createdAt: Millis, actor: ModerationActor, managerAuthorized: Schema.Boolean, operation: LfgOperation })
export type LfgManageRequest = typeof LfgManageRequest.Type
/** Why a request changed nothing. limit names the size or group limit that applied */
export const LfgRefusal = Schema.Literals(["off", "size", "member-limit", "server-limit", "missing", "joined", "full", "host", "not-joined", "permission", "generator", "room-limit"])
export type LfgRefusal = typeof LfgRefusal.Type
export const LfgManageResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), revision: Int(), settings: LfgSettings }),
    Schema.Struct({ type: Schema.Literal("group"), group: LfgGroup }),
    Schema.Struct({ type: Schema.Literal("closed"), group: LfgGroup }),
    /** created is false when the host already owns a temporary voice room, which the group uses instead of the new channel */
    Schema.Struct({ type: Schema.Literal("started"), group: LfgGroup, room: VoiceRoom, created: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("refused"), reason: LfgRefusal, limit: Schema.optionalKey(Int()) }),
])
export type LfgManageResult = typeof LfgManageResult.Type
export const LfgQueryRequest = Schema.Struct({ serverId: Id, operation: Schema.Union([Schema.Struct({ type: Schema.Literal("list") }), Schema.Struct({ type: Schema.Literal("start"), groupNo })]) })
export type LfgQueryRequest = typeof LfgQueryRequest.Type
export const LfgQueryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("groups"), revision: Int(), settings: LfgSettings, groups: List(LfgGroup, LFG_LIMITS.serverGroups[1]) }),
    /** An open group and the generator its room would use, read before the bot creates the room */
    Schema.Struct({ type: Schema.Literal("start"), group: Schema.NullOr(LfgGroup), generator: Schema.NullOr(VoiceGenerator) }),
])
export type LfgQueryResult = typeof LfgQueryResult.Type
/** Closes up to ten open groups whose time ran out and returns them, so the bot can mark their cards */
export const LfgWorkRequest = Schema.Struct({ serverId: Id })
export type LfgWorkRequest = typeof LfgWorkRequest.Type
export const LfgWorkResult = Schema.Struct({ groups: List(LfgGroup, LFG_WORK_PAGE) })
export type LfgWorkResult = typeof LfgWorkResult.Type
