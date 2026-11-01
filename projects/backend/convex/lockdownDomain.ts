import { LockdownDashboardContext, LockdownDashboardOperation, type LockdownCounts } from "@neonflux/contracts/lockdown"
import { decode } from "./validation.ts"

export const lockdownOperation = (value: unknown): LockdownDashboardOperation =>
    decode(LockdownDashboardOperation, value)
/** The plan the bot read for a dashboard lockdown */
export const lockdownPlanContext = (value: unknown) => decode(LockdownDashboardContext, value).plan
export const emptyLockdownCounts = (): LockdownCounts => ({
    queued: 0,
    writing: 0,
    locked: 0,
    uncertain: 0,
    failed: 0,
    skipped: 0,
    restored: 0,
})
