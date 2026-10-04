import { v } from "convex/values"

export const levelingMapping = v.object({ level: v.number(), roleId: v.string() })
export const levelingSettings = v.object({ enabled: v.boolean(), xpPerMessage: v.number(), cooldownSeconds: v.number(), excludedChannelIds: v.array(v.string()), excludedRoleIds: v.array(v.string()), revision: v.number(), mappingRevision: v.number(), scoreEpoch: v.number(), mappings: v.array(levelingMapping) })
