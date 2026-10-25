import {
    LevelingMappings,
    LevelingSettingsPatch,
    type LevelingMapping,
    type LevelingSettings,
} from "@neonflux/contracts/leveling"
import { decode, fail, requireServer } from "./validation.ts"
export { LEVELING_XP_CAP, levelForXp, levelStartXp, nextLevelXp } from "@neonflux/contracts/leveling"
export const LEVELING_DAY = 86400000
export const LEVELING_WINDOW = 600000
export const LEVELING_BATCH = 32
export const LEVELING_DEFER = 60000
/** How long an account that did not settle waits while DEFCON is below 3, when DEFCON 3 wakes it earlier */
export const LEVELING_HELD = 3600000
/** Accounts one wake transaction makes due */
export const LEVELING_WAKE_BATCH = 20
export const defaultLevelingSettings = (): LevelingSettings => ({
    enabled: false,
    xpPerMessage: 15,
    cooldownSeconds: 60,
    excludedChannelIds: [],
    excludedRoleIds: [],
    revision: 1,
    mappingRevision: 1,
    scoreEpoch: 1,
    mappings: [],
})
export function advance(value: number) {
    if (value >= Number.MAX_SAFE_INTEGER) fail(429, "Leveling revision exhausted")
    return value + 1
}
export function server(serverId: string) {
    requireServer(serverId)
    return serverId
}
// A native read the bot made just before its request
export function observed(at: number, now: number) {
    if (at < now - 60000 || at > now + 1000) fail(400, "Invalid request")
    return at
}
// Chat, dashboard jobs, presets and backups share these. Channel and role lists drop repeated IDs and mappings are kept in level order
export function settingsPatch(current: LevelingSettings, value: unknown): LevelingSettings {
    const { levelUp, onlyChannelIds, ...patch } = decode(LevelingSettingsPatch, value),
        { levelUp: was, onlyChannelIds: wasOnly, ...rest } = current,
        unique = (ids: readonly string[]) => [...new Set(ids)],
        next = levelUp === undefined ? was : levelUp,
        only = onlyChannelIds === undefined ? wasOnly : unique(onlyChannelIds)
    return {
        ...rest,
        ...patch,
        // Stored settings leave out level-up messages while they are off, and the only-these channels while every channel earns XP
        ...(next ? { levelUp: next } : {}),
        ...(only?.length ? { onlyChannelIds: only } : {}),
        revision: advance(current.revision),
        ...(patch.excludedChannelIds ? { excludedChannelIds: unique(patch.excludedChannelIds) } : {}),
        ...(patch.excludedRoleIds ? { excludedRoleIds: unique(patch.excludedRoleIds) } : {}),
    }
}
export const levelMappings = (value: unknown): LevelingMapping[] =>
    [...decode(LevelingMappings, value)].sort((a, b) => a.level - b.level || (a.roleId < b.roleId ? -1 : 1))
