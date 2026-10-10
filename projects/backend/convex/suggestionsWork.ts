import { SuggestionsWorkRequest, type SuggestionsCardGrant, type SuggestionsWorkResult } from "@neonflux/contracts/suggestions"
import { v } from "convex/values"
import { serviceMutation } from "./installations.ts"
import { age, publicAttempt, reservePublishing } from "./publishing.ts"
import { renderSuggestion, SUGGESTIONS_BATCH } from "./suggestionsDomain.ts"
import { cardBinding, closeUnclaimedSuggestion, expiredSuggestion, patchSuggestionCard, publicSuggestionWork, suggestionAutomation, suggestionCardChannel, suggestionCardContext, suggestionRow, suggestionSettings } from "./suggestionsStore.ts"
import { publisherSettings } from "./schedulesStore.ts"
import { decode, fail, requireServer, integer } from "./validation.ts"
export const work = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<SuggestionsWorkResult> => {
    const input = decode(SuggestionsWorkRequest, request), serverId = input.serverId
    requireServer(serverId)
    const op = input.operation, now = Date.now()
    if (op.type === "list") {
        let cursor: string | null = null, throughAt = now
        if (op.cursor !== undefined) {
            const c = op.cursor
            cursor = c.cursor; throughAt = integer(c.throughAt, 0, now)
        }
        const settings = await suggestionSettings(ctx, serverId), publisher = await publisherSettings(ctx, serverId)
        if (!settings?.enabled || publisher?.enabled === false) return { type: "cards", cards: [], hasMore: false }
        const page = await ctx.db.query("suggestions").withIndex("by_work", q => q.eq("serverId", serverId).eq("dirty", true).lte("nextCheckAt", throughAt)).paginate({ cursor, numItems: SUGGESTIONS_BATCH })
        const cards = []
        for (const found of page.page) {
            if (expiredSuggestion(found) || found.forgetting) continue
            let row = found, attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
            if (attempt?.outcome === "pending") {
                await age(ctx, attempt, now)
                attempt = await ctx.db.get(attempt._id)
                row = (await ctx.db.get(row._id))!
                if (attempt?.outcome === "pending" && attempt.dispatchedAt === undefined && (attempt.consumer?.type !== "suggestion-card" || attempt.consumer.desiredRevision !== row.desiredRevision)) {
                    await closeUnclaimedSuggestion(ctx, row, attempt)
                    row = (await ctx.db.get(row._id))!; attempt = await ctx.db.get(attempt._id)
                }
            }
            await ctx.db.patch(row._id, { nextCheckAt: now + 60000 })
            if (attempt && (attempt.dispatchedAt !== undefined && attempt.outcome === "pending" || attempt.unresolved && attempt.outcome !== "pending" || attempt.dispatchedAt !== undefined && attempt.outcome === "failed" && !attempt.resolution)) continue
            if (row.dirty) cards.push(publicSuggestionWork({ ...row, nextCheckAt: now + 60000 }))
        }
        return { type: "cards", cards, hasMore: !page.isDone, ...(!page.isDone ? { nextCursor: { cursor: page.continueCursor, throughAt } } : {}) }
    }
    if (op.type !== "reserve" && op.type !== "defer") fail(400, "Invalid suggestion work operation")
    const binding = op.binding
    let row = await suggestionRow(ctx, serverId, binding.suggestionNo)
    if (row.cardGeneration !== binding.cardGeneration || row.desiredRevision !== binding.desiredRevision || row.forgetting || !row.dirty) fail(409, "Suggestion work changed")
    if (op.type === "defer") {
        await patchSuggestionCard(ctx, row, { cardState: row.cardState === "reserved" ? "reserved" : "blocked", nextCheckAt: now + 60000 })
        return { type: "progress", recorded: true }
    }
    const settings = await suggestionSettings(ctx, serverId), publisher = await publisherSettings(ctx, serverId), context = suggestionCardContext(op.context)
    if (!settings?.enabled || publisher?.enabled === false) fail(403, "Suggestion publication disabled")
    if (now < row.dueAt) fail(409, "Suggestion card coalescing")
    await suggestionAutomation(ctx, serverId, context, suggestionCardChannel(row))
    let attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
    if (attempt?.outcome === "pending") {
        await age(ctx, attempt, now)
        attempt = await ctx.db.get(attempt._id); row = (await ctx.db.get(row._id))!
        if (attempt?.outcome === "pending") {
            if (attempt.dispatchedAt !== undefined) fail(409, "Suggestion card already claimed")
            if (attempt.consumer?.type === "suggestion-card" && attempt.consumer.desiredRevision === binding.desiredRevision && attempt.consumer.cardGeneration === binding.cardGeneration && attempt.botId === context.botId) {
                const { outcome, createdAt, finishedAt, noDispatch, dispatchedAt, observation, resolution, ...grant } = publicAttempt(attempt)
                return { type: "reserved", grant: grant as SuggestionsCardGrant }
            }
            await closeUnclaimedSuggestion(ctx, row, attempt)
            row = (await ctx.db.get(row._id))!; attempt = await ctx.db.get(attempt._id)
        }
    }
    if (attempt && (attempt.unresolved || attempt.dispatchedAt !== undefined && attempt.outcome !== "sent" && !attempt.resolution)) fail(409, "Suggestion publication requires recovery")
    const existing = row.postNo !== undefined ? await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", serverId).eq("postNo", row.postNo!)).unique() : null
    if (row.postNo !== undefined && (!existing || existing.attemptId !== row.attemptId || existing.consumer?.type !== "suggestion-card" || existing.consumer.suggestionNo !== row.suggestionNo || existing.consumer.cardGeneration !== row.cardGeneration)) fail(409, "Suggestion card binding changed")
    const consumer = { type: "suggestion-card" as const, ...cardBinding(row) }, sourceId = `suggestion_${row.suggestionNo}_${row.cardGeneration}_${row.desiredRevision}_${(existing?.generation ?? 0) + 1}`
    const reserved = await reservePublishing(ctx, { serverId, actorId: context.botId, botId: context.botId, channelId: suggestionCardChannel(row), sourceId, source: consumer, provenance: consumer, consumer, content: renderSuggestion(row), ...(existing ? { existing } : {}),
        // In a forum or media channel the card becomes the first message of its own post
        forumPostName: `#${row.suggestionNo} ${row.text}` })
    await patchSuggestionCard(ctx, row, { cardState: "reserved", postNo: reserved.post.postNo, attemptId: ctx.db.normalizeId("publishingAttempts", reserved.grant.attemptId)!, nextCheckAt: now + 60000 })
    return { type: "reserved", grant: reserved.grant as SuggestionsCardGrant }
} })
