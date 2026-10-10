import { LfgSettingsPatch, type LfgOperation, type LfgSettings } from "@neonflux/contracts/lfg"
import { decode } from "./validation.ts"

export { LFG_LIMITS, LFG_WORK_PAGE } from "@neonflux/contracts/lfg"

/** A new server starts with looking for group off, groups of up to 10 members that stay open for an hour, one open group per host and 20 per server */
export const LFG_DEFAULTS: LfgSettings = { enabled: false, channelId: null, generatorChannelId: null, expiryMinutes: 60, maxSize: 10, memberGroups: 1, serverGroups: 20 }

// Dashboard configuration jobs carry the same settings patch as chat
export const lfgSettingsPatch = (value: unknown): LfgSettingsPatch => decode(LfgSettingsPatch, value)

/** Activities and notes are stored trimmed */
export function lfgOperation(op: LfgOperation): LfgOperation {
    if (op.type !== "create") return op
    return { ...op, activity: op.activity.trim(), ...(op.note !== undefined ? { note: op.note.trim() } : {}) }
}
