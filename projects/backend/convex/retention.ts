import { v } from "convex/values"
import { internal } from "./_generated/api.js"
import { internalMutation, type MutationCtx } from "./_generated/server.js"
import { cleanupAuditLog } from "./auditLog.ts"
import { cleanupBackups } from "./backupRetention.ts"
import { cleanupCleanupMetadata } from "./cleanupRetention.ts"
import { cleanupEvents } from "./eventsCleanup.ts"
import { cleanupGreetings } from "./greetingLifecycle.ts"
import { cleanupLeveling } from "./levelingCleanup.ts"
import { cleanupMetadataLogs } from "./metadataLogsRetention.ts"
import { cleanupMilestones } from "./milestonesCleanup.ts"
import { cleanupModeration } from "./moderation.ts"
import { cleanupPublishing } from "./publishing.ts"
import { cleanupResponses } from "./responses.ts"
import { retentionPass, type RetentionPass, type RetentionResult } from "./retentionStore.ts"
import { cleanupRoles } from "./roleLifecycle.ts"
import { cleanupSchedules } from "./schedulesCleanup.ts"
import { cleanupSuggestions } from "./suggestionsCleanup.ts"
import { cleanupTickets, scheduleTicketPurges } from "./ticketLifecycle.ts"

// Retention runs as one chain of runs. The cron starts a run every ten minutes, so an idle deployment costs 144 runs a
// day. A run repeats each module's pass while it fills a batch, within a read budget, and a run that spends its budget
// schedules the next one at once
export const RETENTION_INTERVAL_MS = 10 * 60000
export const RETENTION_ROWS_PER_RUN = 2048, RETENTION_BYTES_PER_RUN = 4 * 1024 * 1024
// A scheduled continuation holds the lease, so the cron leaves it alone, and a chain that stopped resumes once its lease ends.
// A run that finds no finished run in one and a half intervals isolates every pass
const RETENTION_LEASE_MS = 5 * 60000, RETENTION_STALE_MS = RETENTION_INTERVAL_MS * 3 / 2

// Passes in visiting order. A pass handles one bounded batch per range of its module
export const RETENTION_PASSES: readonly (readonly [string, RetentionPass])[] = [
    ["backup", cleanupBackups], ["metadataLogs", cleanupMetadataLogs], ["cleanup", cleanupCleanupMetadata], ["responses", cleanupResponses],
    ["moderation", cleanupModeration], ["publishing", cleanupPublishing], ["roles", cleanupRoles], ["greetings", cleanupGreetings],
    ["tickets", cleanupTickets], ["leveling", cleanupLeveling], ["events", cleanupEvents], ["schedules", cleanupSchedules],
    ["milestones", cleanupMilestones], ["suggestions", cleanupSuggestions], ["auditLog", cleanupAuditLog],
]
// Passes that only schedule other work run once when a chain starts, not in its continuations
const RETENTION_START_PASSES: readonly RetentionPass[] = [scheduleTicketPurges]

async function spent(ctx: MutationCtx) {
    const metrics = await ctx.meta.getTransactionMetrics()
    return metrics.documentsRead.used >= RETENTION_ROWS_PER_RUN || metrics.bytesRead.used >= RETENTION_BYTES_PER_RUN || metrics.documentsWritten.used >= RETENTION_ROWS_PER_RUN
}

// One pass in its own sub-transaction, so a pass that throws rolls back alone
export const pass = internalMutation({ args: { index: v.number(), now: v.number() }, handler: async (ctx, { index, now }): Promise<RetentionResult> => {
    const { more } = await retentionPass(ctx, RETENTION_PASSES[index]![1], now)
    return { more }
} })

export type RetentionRun = { next: "skipped" | "continue" | "idle", passes: number, failed: string[] }

// generation binds a scheduled run to the chain that scheduled it. next is the pass a budget continuation resumes at
export const run = internalMutation({ args: { generation: v.optional(v.number()), next: v.optional(v.number()) }, handler: async (ctx, { generation, next }): Promise<RetentionRun> => {
    const now = Date.now(), state = await ctx.db.query("retentionState").first()
    // The cron starts a chain only when no run is scheduled, and a scheduled run proceeds only for the current chain
    if (generation === undefined ? (state?.leaseUntil ?? 0) > now : state?.generation !== generation) return { next: "skipped", passes: 0, failed: [] }
    // A pass that failed runs isolated until it succeeds. A failed run records nothing, so after one, and before the first
    // finished run, every pass is isolated once
    const isolated = new Set(!state || now - state.finishedAt > RETENTION_STALE_MS ? RETENTION_PASSES.map(([name]) => name) : state.isolated)
    const failed: string[] = [], unproven = new Set(isolated)
    if (next === undefined) for (const start of RETENTION_START_PASSES) await start(ctx, now)
    // Rounds repeat the passes that made progress with a full batch until none is left or the budget is spent
    let due = RETENTION_PASSES.map((_, index) => (index + (next ?? 0)) % RETENTION_PASSES.length), resume: number | undefined, passes = 0
    rounds: while (due.length) {
        const again: number[] = []
        for (const index of due) {
            if (await spent(ctx)) { resume = index; break rounds }
            const [name, step] = RETENTION_PASSES[index]!
            let result: RetentionResult
            if (isolated.has(name)) {
                try { result = await ctx.runMutation(internal.retention.pass, { index, now }); unproven.delete(name) }
                catch (error) { console.error(`Retention pass ${name} failed`, error); failed.push(name); continue }
            } else result = await retentionPass(ctx, step, now)
            passes++
            if (result.more) again.push(index)
        }
        due = again
    }
    const following = (state?.generation ?? 0) + 1
    const save = async (leaseUntil: number) => {
        // Isolated passes stay isolated until one of their runs succeeds, including those a spent budget did not reach
        const value = { generation: following, leaseUntil, finishedAt: now, isolated: [...unproven] }
        if (state) await ctx.db.patch(state._id, value)
        else await ctx.db.insert("retentionState", value)
    }
    if (resume !== undefined) {
        await ctx.scheduler.runAfter(0, internal.retention.run, { generation: following, next: resume })
        await save(now + RETENTION_LEASE_MS)
        return { next: "continue", passes, failed }
    }
    await save(0)
    return { next: "idle", passes, failed }
} })
