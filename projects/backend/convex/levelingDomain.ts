import type { LevelingCandidate, LevelingFence, LevelingMapping, LevelingMemberContext, LevelingSettings } from "../contracts.js"
import { shape } from "./publishingDomain.ts"
import { epoch } from "./rolesDomain.ts"
import { fail, requireId, requireServer, bool, ids, integer, text } from "./validation.ts"
export const LEVELING_DAY = 86400000
export const LEVELING_WINDOW = 600000
export const LEVELING_CAP = 50000
export const LEVELING_XP_CAP = 100000000
export const LEVELING_BATCH = 32
export const LEVELING_DEFER = 60000
export const defaultLevelingSettings = (): LevelingSettings => ({ enabled: false, xpPerMessage: 15, cooldownSeconds: 60, excludedChannelIds: [], excludedRoleIds: [], revision: 1, mappingRevision: 1, scoreEpoch: 1, mappings: [] })
export const levelForXp = (xp: number) => Math.min(1000, Math.floor(Math.sqrt(xp / 100)))
export const nextLevelXp = (xp: number) => levelForXp(xp) === 1000 ? null : 100 * (levelForXp(xp) + 1) ** 2
export function advance(value: number) { if (value >= Number.MAX_SAFE_INTEGER) fail(429, "Leveling revision exhausted"); return value + 1 }
export function server(value: unknown) { const result = requireId(value); requireServer(result); return result }
export function fence(value: unknown): LevelingFence {
    const input = shape(value, ["scoreEpoch", "adjustmentRevision", "mappingRevision"], ["scoreEpoch", "adjustmentRevision", "mappingRevision"])
    return { scoreEpoch: integer(input.scoreEpoch, 1, Number.MAX_SAFE_INTEGER), adjustmentRevision: integer(input.adjustmentRevision, 0, Number.MAX_SAFE_INTEGER), mappingRevision: integer(input.mappingRevision, 1, Number.MAX_SAFE_INTEGER) }
}
export const sameFence = (a: LevelingFence, b: LevelingFence) => a.scoreEpoch === b.scoreEpoch && a.adjustmentRevision === b.adjustmentRevision && a.mappingRevision === b.mappingRevision
export function candidate(value: unknown): LevelingCandidate {
    const fields = ["messageId", "createdAt", "userId", "channelId", "digest"], input = shape(value, fields, fields)
    if (typeof input.digest !== "string" || !/^[a-f0-9]{64}$/.test(input.digest)) fail(400, "Invalid leveling digest")
    return {
        messageId: requireId(input.messageId),
        createdAt: integer(input.createdAt, 0, Number.MAX_SAFE_INTEGER),
        userId: requireId(input.userId),
        channelId: requireId(input.channelId),
        digest: input.digest,
    }
}
export function levelingMember(value: unknown): LevelingMemberContext {
    const input = shape(value, ["userId", "joinedAt", "roleIds", "isBot", "timeoutUntil"], ["userId", "joinedAt", "roleIds", "isBot", "timeoutUntil"])
    return { userId: requireId(input.userId), joinedAt: epoch(input.joinedAt), roleIds: ids(input.roleIds, 1000), isBot: bool(input.isBot), timeoutUntil: input.timeoutUntil === null ? null : epoch(input.timeoutUntil) }
}
export function settingsPatch(current: LevelingSettings, value: unknown): LevelingSettings {
    const patch = shape(value, ["enabled", "xpPerMessage", "cooldownSeconds", "excludedChannelIds", "excludedRoleIds"])
    if (!Object.keys(patch).length) fail(400, "Empty leveling settings patch")
    const result = { ...current, revision: advance(current.revision) }
    if (patch.enabled !== undefined) result.enabled = bool(patch.enabled)
    if (patch.xpPerMessage !== undefined) result.xpPerMessage = integer(patch.xpPerMessage, 1, 100)
    if (patch.cooldownSeconds !== undefined) result.cooldownSeconds = integer(patch.cooldownSeconds, 15, 3600)
    if (patch.excludedChannelIds !== undefined) result.excludedChannelIds = ids(patch.excludedChannelIds, 50)
    if (patch.excludedRoleIds !== undefined) result.excludedRoleIds = ids(patch.excludedRoleIds, 50)
    return result
}
export function levelMappings(value: unknown): LevelingMapping[] {
    if (!Array.isArray(value) || value.length > 20) fail(400, "Invalid leveling mappings")
    const result = value.map(value => { const input = shape(value, ["level", "roleId"], ["level", "roleId"]); return { level: integer(input.level, 1, 1000), roleId: requireId(input.roleId) } })
    if (new Set(result.map(x => x.roleId)).size !== result.length) fail(400, "Duplicate leveling role")
    if (new Set(result.map(x => x.level)).size !== result.length) fail(400, "Duplicate leveling level")
    return result.sort((a, b) => a.level - b.level || (a.roleId < b.roleId ? -1 : 1))
}
export const reason = (value: unknown) => text(value, 500)
