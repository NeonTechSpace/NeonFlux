import type { LfgOperation, LfgSettings } from "@neonflux/contracts/lfg"

export { LFG_LIMITS, LFG_WORK_PAGE } from "@neonflux/contracts/lfg"

/** A new server starts with looking for group off, groups of up to 10 members that stay open for an hour, one open group per host and 20 per server */
export const LFG_DEFAULTS: LfgSettings = {
    enabled: false,
    channelId: null,
    generatorChannelId: null,
    expiryMinutes: 60,
    maxSize: 10,
    memberGroups: 1,
    serverGroups: 20,
}

/** Activities and notes are stored trimmed */
export function lfgOperation(op: LfgOperation): LfgOperation {
    if (op.type !== "create") return op
    return { ...op, activity: op.activity.trim(), ...(op.note !== undefined ? { note: op.note.trim() } : {}) }
}
