import { LevelingMappings, LevelingSettingsPatch, type LevelingFence, type LevelingMapping, type LevelingSettings } from "@neonflux/contracts/leveling"
import { decode, fail, requireServer } from "./validation.ts"
export { LEVELING_CAP, LEVELING_XP_CAP } from "@neonflux/contracts/leveling"
export const LEVELING_DAY = 86400000
export const LEVELING_WINDOW = 600000
export const LEVELING_BATCH = 32
export const LEVELING_DEFER = 60000
export const defaultLevelingSettings = (): LevelingSettings => ({ enabled: false, xpPerMessage: 15, cooldownSeconds: 60, excludedChannelIds: [], excludedRoleIds: [], revision: 1, mappingRevision: 1, scoreEpoch: 1, mappings: [] })
export const levelForXp = (xp: number) => Math.min(1000, Math.floor(Math.sqrt(xp / 100)))
export const nextLevelXp = (xp: number) => levelForXp(xp) === 1000 ? null : 100 * (levelForXp(xp) + 1) ** 2
export function advance(value: number) { if (value >= Number.MAX_SAFE_INTEGER) fail(429, "Leveling revision exhausted"); return value + 1 }
export function server(serverId: string) { requireServer(serverId); return serverId }
export const sameFence = (a: LevelingFence, b: LevelingFence) => a.scoreEpoch === b.scoreEpoch && a.adjustmentRevision === b.adjustmentRevision && a.mappingRevision === b.mappingRevision
// A native read the bot made just before its request
export function observed(at: number, now: number) { if (at < now - 60000 || at > now + 1000) fail(400, "Invalid request"); return at }
// Chat, dashboard jobs, presets and backups share these. Excluded lists drop repeated IDs and mappings are kept in level order
export function settingsPatch(current: LevelingSettings, value: unknown): LevelingSettings {
    const patch = decode(LevelingSettingsPatch, value), unique = (ids: readonly string[]) => [...new Set(ids)]
    return { ...current, ...patch, revision: advance(current.revision), ...(patch.excludedChannelIds ? { excludedChannelIds: unique(patch.excludedChannelIds) } : {}),
        ...(patch.excludedRoleIds ? { excludedRoleIds: unique(patch.excludedRoleIds) } : {}) }
}
export const levelMappings = (value: unknown): LevelingMapping[] => [...decode(LevelingMappings, value)].sort((a, b) => a.level - b.level || (a.roleId < b.roleId ? -1 : 1))
