import { internalMutation } from "./_generated/server.js"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { internal } from "./_generated/api.js"
import { retireSuggestionPost } from "./publishing.ts"
import { terminalSuggestion, SUGGESTIONS_BATCH } from "./suggestionsDomain.ts"
import { expiredSuggestion, patchSuggestionCard, suggestionCount } from "./suggestionsStore.ts"
import { fail } from "./validation.ts"

export async function forgetSuggestion(ctx: MutationCtx, row: Doc<"suggestions">): Promise<{ complete: boolean, removed: number }> {
    if (!terminalSuggestion(row.state) && !expiredSuggestion(row)) fail(409, "Terminal suggestion required before forgetting")
    if (await ctx.db.query("publishingAttempts").withIndex("by_suggestion_unresolved", q => q.eq("serverId", row.serverId).eq("consumer.suggestionNo", row.suggestionNo).eq("unresolved", true)).first()) fail(409, "Unresolved suggestion publication preserved")
    await ctx.db.patch(row._id, { forgetting: true })
    await patchSuggestionCard(ctx, row, { dirty: false, cardState: "current" })
    let removed = 0
    const votes = await ctx.db.query("suggestionVotes").withIndex("by_suggestion_user", q => q.eq("serverId", row.serverId).eq("suggestionNo", row.suggestionNo)).take(SUGGESTIONS_BATCH + 1)
    for (const vote of votes.slice(0, SUGGESTIONS_BATCH)) { await ctx.db.delete(vote._id); await suggestionCount(ctx, row.serverId, "voters", -1); removed++ }
    if (removed) await ctx.db.patch(row._id, { voters: row.voters - removed, up: row.up - votes.slice(0, removed).filter(v => v.choice === "up").length, down: row.down - votes.slice(0, removed).filter(v => v.choice === "down").length })
    if (votes.length > SUGGESTIONS_BATCH || removed === SUGGESTIONS_BATCH) return { complete: false, removed }
    const posts = await ctx.db.query("publishingPosts").withIndex("by_suggestion", q => q.eq("serverId", row.serverId).eq("consumer.suggestionNo", row.suggestionNo)).take(2)
    for (const post of posts) {
        const retired = await retireSuggestionPost(ctx, post, SUGGESTIONS_BATCH - removed)
        removed += retired.removed
        if (!retired.complete || removed === SUGGESTIONS_BATCH) return { complete: false, removed }
        if (post.postNo === row.postNo) await ctx.db.patch(row._id, { postNo: undefined, attemptId: undefined })
    }
    if (await ctx.db.query("publishingPosts").withIndex("by_suggestion", q => q.eq("serverId", row.serverId).eq("consumer.suggestionNo", row.suggestionNo)).first()) return { complete: false, removed }
    if (removed === SUGGESTIONS_BATCH) return { complete: false, removed }
    await ctx.db.delete(row._id); await suggestionCount(ctx, row.serverId, "suggestions", -1)
    return { complete: true, removed: removed + 1 }
}

export const cleanup = internalMutation({ args: {}, handler: async ctx => {
    const now = Date.now()
    let removed = 0, continuation = false
    const receipts = await ctx.db.query("suggestionReceipts").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(SUGGESTIONS_BATCH)
    for (const receipt of receipts) { await ctx.db.delete(receipt._id); await suggestionCount(ctx, receipt.serverId, receipt.category === "staff" ? "staffReceipts" : "memberReceipts", -1); removed++ }
    continuation ||= receipts.length === SUGGESTIONS_BATCH
    const rows = await ctx.db.query("suggestions").withIndex("by_history", q => q.gt("cleanupAt", 0).lte("cleanupAt", now)).take(SUGGESTIONS_BATCH)
    continuation ||= rows.length === SUGGESTIONS_BATCH
    for (const row of rows) {
        if (await ctx.db.query("publishingAttempts").withIndex("by_suggestion_unresolved", q => q.eq("serverId", row.serverId).eq("consumer.suggestionNo", row.suggestionNo).eq("unresolved", true)).first()) { await ctx.db.patch(row._id, { cleanupAt: now + 86400000 }); continue }
        const result = await forgetSuggestion(ctx, row)
        removed += result.removed
        continuation ||= !result.complete
        // One retained definition per transaction bounds all dependent erasure work
        break
    }
    if (continuation) await ctx.scheduler.runAfter(0, internal.suggestionsCleanup.cleanup, {})
    return { removed }
} })
