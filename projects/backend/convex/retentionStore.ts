import type { MutationCtx } from "./_generated/server.js"

// One pass handles one bounded batch per range of a module. more reports a full batch, so due rows may remain
export type RetentionResult = { more: boolean }
export type RetentionPass<R extends RetentionResult = RetentionResult> = (ctx: MutationCtx, now: number) => Promise<R>

// Runs one pass and keeps more only when the pass wrote something. A full batch of rows that stay due, such as
// retained open appeals, makes no progress when repeated, so it waits for the next scheduled run
export async function retentionPass<R extends RetentionResult>(ctx: MutationCtx, pass: RetentionPass<R>, now = Date.now()): Promise<R> {
    const before = (await ctx.meta.getTransactionMetrics()).documentsWritten.used
    const result = await pass(ctx, now)
    if (!result.more || (await ctx.meta.getTransactionMetrics()).documentsWritten.used > before) return result
    return { ...result, more: false }
}
