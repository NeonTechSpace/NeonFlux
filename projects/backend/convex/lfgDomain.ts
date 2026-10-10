import type { LfgOperation, LfgSettings, LfgSettingsPatch } from "../contracts.js"
import { shape } from "./publishingDomain.ts"
import { bool, fail, integer, requireId } from "./validation.ts"

/** A new server starts with looking for group off, groups of up to 10 members that stay open for an hour, one open group per host and 20 per server */
export const LFG_DEFAULTS: LfgSettings = { enabled: false, channelId: null, generatorChannelId: null, expiryMinutes: 60, maxSize: 10, memberGroups: 1, serverGroups: 20 }
export const LFG_LIMITS = { expiryMinutes: [10, 1440], maxSize: [2, 25], memberGroups: [1, 5], serverGroups: [1, 50] } as const
/** Activities have 1 to 50 characters and notes 1 to 200. A start time lies at most seven days ahead */
export const LFG_ACTIVITY_LENGTH = 50, LFG_NOTE_LENGTH = 200, LFG_START_MINUTES = 10080
/** Due groups the worker closes per request */
export const LFG_WORK_PAGE = 10

// One line of visible text, since activities and notes appear in the group card and the room name
function line(value: unknown, max: number, label: string) {
    if (typeof value !== "string" || value.length > max || /[\r\n]/.test(value) || !value.replace(/[\u000c‮]/g, "").trim()) fail(400, `${label} need 1 to ${max} characters on one line`)
    return value.trim()
}
const channel = (value: unknown) => value === null ? null : requireId(value)

export function lfgSettingsPatch(value: unknown): LfgSettingsPatch {
    const raw = shape(value, ["enabled", "channelId", "generatorChannelId", "expiryMinutes", "maxSize", "memberGroups", "serverGroups"]), patch: LfgSettingsPatch = {}
    if (!Object.keys(raw).length) fail(400, "Choose a setting")
    if (raw.enabled !== undefined) patch.enabled = bool(raw.enabled)
    if (raw.channelId !== undefined) patch.channelId = channel(raw.channelId)
    if (raw.generatorChannelId !== undefined) patch.generatorChannelId = channel(raw.generatorChannelId)
    for (const key of Object.keys(LFG_LIMITS) as (keyof typeof LFG_LIMITS)[]) if (raw[key] !== undefined) patch[key] = integer(raw[key], LFG_LIMITS[key][0], LFG_LIMITS[key][1])
    return patch
}

export function lfgOperation(value: unknown): LfgOperation {
    const raw = shape(value, ["type", "patch", "activity", "size", "note", "startsInMinutes", "groupNo", "messageId", "channelId"], ["type"])
    const groupNo = () => integer(raw.groupNo, 1, Number.MAX_SAFE_INTEGER)
    if (raw.type === "settings") { shape(raw, ["type", "patch"], ["type", "patch"]); return { type: "settings", patch: lfgSettingsPatch(raw.patch) } }
    if (raw.type === "create") {
        shape(raw, ["type", "activity", "size", "note", "startsInMinutes"], ["type", "activity", "size"])
        return { type: "create", activity: line(raw.activity, LFG_ACTIVITY_LENGTH, "Activities"), size: integer(raw.size, 2, LFG_LIMITS.maxSize[1]),
            ...(raw.note !== undefined ? { note: line(raw.note, LFG_NOTE_LENGTH, "Notes") } : {}),
            ...(raw.startsInMinutes !== undefined ? { startsInMinutes: integer(raw.startsInMinutes, 1, LFG_START_MINUTES) } : {}) }
    }
    for (const type of ["join", "leave", "cancel"] as const) if (raw.type === type) { shape(raw, ["type", "groupNo"], ["type", "groupNo"]); return { type, groupNo: groupNo() } }
    if (raw.type === "card") { shape(raw, ["type", "groupNo", "messageId"], ["type", "groupNo", "messageId"]); return { type: "card", groupNo: groupNo(), messageId: requireId(raw.messageId) } }
    if (raw.type === "start") { shape(raw, ["type", "groupNo", "channelId"], ["type", "groupNo", "channelId"]); return { type: "start", groupNo: groupNo(), channelId: requireId(raw.channelId) } }
    fail(400, "Unknown looking for group operation")
}
