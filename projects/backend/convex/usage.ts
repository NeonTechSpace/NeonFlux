import type { MutationCtx } from "./_generated/server.js"
import type { ServiceUsage } from "@neonflux/contracts/service"
import { fail } from "./validation.ts"

/** The bot pauses optional work once the month's calls reach this share of the budget */
export const USAGE_PAUSE_SHARE = 0.9
/** The warning share when NEONFLUX_BUDGET_WARNING_SHARE is unset, inside the 60 to 70 percent alert target */
export const USAGE_DEFAULT_WARNING_SHARE = 0.65

/** The operator's monthly budget in billed function calls, or undefined when unset, which turns the guard off */
export function parseUsageBudget(env: Record<string, string | undefined>): { calls: number, warningShare: number } | undefined {
    const budget = env.NEONFLUX_MONTHLY_CALL_BUDGET?.trim(), share = env.NEONFLUX_BUDGET_WARNING_SHARE?.trim()
    if (!budget) {
        if (share) throw new Error("NEONFLUX_BUDGET_WARNING_SHARE needs NEONFLUX_MONTHLY_CALL_BUDGET")
        return undefined
    }
    const calls = Number(budget), warningShare = share ? Number(share) : USAGE_DEFAULT_WARNING_SHARE
    if (!/^[1-9]\d*$/.test(budget) || !Number.isSafeInteger(calls)) throw new Error("NEONFLUX_MONTHLY_CALL_BUDGET must be a whole number of calls")
    if (!(warningShare > 0 && warningShare < USAGE_PAUSE_SHARE)) throw new Error(`NEONFLUX_BUDGET_WARNING_SHARE must be above 0 and below ${USAGE_PAUSE_SHARE}`)
    return { calls, warningShare }
}

function configuredUsageBudget() {
    try { return parseUsageBudget(process.env) } catch { return fail(503, "Usage budget not configured correctly") }
}

// Adds one bot report to the current UTC month, the window Convex usage limits reset on, and answers the guard state.
// The first report at or past the warning share in a month answers warn, so the operator gets one warning a month
export async function recordUsage(ctx: Pick<MutationCtx, "db">, calls: number, now: number): Promise<ServiceUsage> {
    const budget = configuredUsageBudget()
    const month = new Date(now).toISOString().slice(0, 7)
    const row = await ctx.db.query("usageMonths").withIndex("by_month", q => q.eq("month", month)).unique()
    const total = (row?.calls ?? 0) + calls
    const state = !budget ? "normal" : total >= budget.calls * USAGE_PAUSE_SHARE ? "paused" : total >= budget.calls * budget.warningShare ? "warning" : "normal"
    const warn = state !== "normal" && !row?.warned
    if (row) await ctx.db.patch(row._id, { calls: total, ...(warn ? { warned: true } : {}) })
    else await ctx.db.insert("usageMonths", { month, calls: total, warned: warn })
    return { month, calls: total, budget: budget?.calls ?? null, state, warn }
}
