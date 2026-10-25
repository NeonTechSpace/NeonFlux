import {
    SUGGESTIONS_CARD_PAGE,
    SuggestionsWorkRequest,
    type SuggestionsCardGrant,
    type SuggestionsWorkResult,
} from "@neonflux/contracts/suggestions"
import { v } from "convex/values"
import { serviceMutation } from "./serviceGuard.ts"
import { age, publicAttempt, reservePublishing } from "./publishing.ts"
import { renderSuggestion, SUGGESTIONS_BATCH, terminalSuggestion } from "./suggestionsDomain.ts"
import { serverPrefix } from "./generalSettings.ts"
import {
    cardBinding,
    closeUnclaimedSuggestion,
    dirtySuggestion,
    expiredSuggestion,
    patchSuggestionCard,
    publicSuggestionWork,
    suggestionAutomation,
    suggestionCardChannel,
    reactionCard,
    suggestionCardContext,
    suggestionRow,
    suggestionSettings,
    suggestionVote,
} from "./suggestionsStore.ts"
import { defconHoldsAutomation, publisherSettings } from "./schedulesStore.ts"
import { decode, fail, integer } from "./validation.ts"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"

// One page of a suggestion's votes per request, so a suggestion takes any number of voters
const VOTE_PAGE = 500
// Reaction votes a cleared or missing reaction no longer holds become clear as of observedAt, one page of the suggestion's
// votes at a time. The cursor names the next page. Command votes and votes observed later are never touched
async function clearReactionVotes(
    ctx: MutationCtx,
    row: Doc<"suggestions">,
    clears: (vote: Doc<"suggestionVotes">) => boolean,
    observedAt: number,
    cursor: string | undefined,
) {
    const page = await ctx.db
        .query("suggestionVotes")
        .withIndex("by_suggestion_user", (q) => q.eq("serverId", row.serverId).eq("suggestionNo", row.suggestionNo))
        .paginate({ cursor: cursor ?? null, numItems: VOTE_PAGE })
    let up = row.up,
        down = row.down,
        cleared = 0
    for (const vote of page.page) {
        if (vote.via !== "reaction" || vote.choice === "clear" || vote.observedAt > observedAt || !clears(vote))
            continue
        if (vote.choice === "up") up--
        else down--
        await ctx.db.patch(vote._id, { choice: "clear", observedAt })
        cleared++
    }
    if (up < 0 || down < 0) fail(503, "Suggestion vote accounting unavailable")
    if (cleared) {
        await ctx.db.patch(row._id, { up, down })
        await dirtySuggestion(ctx, row)
    }
    return { cleared, ...(page.isDone ? {} : { cursor: page.continueCursor }) }
}
// Votes change only while members could vote with a command
async function votingOpen(ctx: MutationCtx, row: Doc<"suggestions">) {
    if (row.forgetting || expiredSuggestion(row) || terminalSuggestion(row.state)) return false
    return !!(await suggestionSettings(ctx, row.serverId))?.enabled && !(await defconHoldsAutomation(ctx, row.serverId))
}
export const work = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<SuggestionsWorkResult> => {
        const input = decode(SuggestionsWorkRequest, request),
            serverId = input.serverId
        const op = input.operation,
            now = Date.now()
        if (op.type === "list") {
            let cursor: string | null = null,
                throughAt = now
            if (op.cursor !== undefined) {
                const c = op.cursor
                cursor = c.cursor
                throughAt = integer(c.throughAt, 0, now)
            }
            const settings = await suggestionSettings(ctx, serverId),
                publisher = await publisherSettings(ctx, serverId)
            // Cards wait while suggestions or publishing are off or DEFCON is below 3, and stay due for when they may update again
            if (!settings?.enabled || publisher?.enabled === false || (await defconHoldsAutomation(ctx, serverId)))
                return { type: "cards", cards: [], hasMore: false }
            const page = await ctx.db
                .query("suggestions")
                .withIndex("by_work", (q) => q.eq("serverId", serverId).eq("dirty", true).lte("nextCheckAt", throughAt))
                .paginate({ cursor, numItems: SUGGESTIONS_BATCH })
            const cards = []
            for (const found of page.page) {
                if (expiredSuggestion(found) || found.forgetting) continue
                let row = found,
                    attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
                if (attempt?.outcome === "pending") {
                    await age(ctx, attempt, now)
                    attempt = await ctx.db.get(attempt._id)
                    row = (await ctx.db.get(row._id))!
                    if (
                        attempt?.outcome === "pending" &&
                        attempt.dispatchedAt === undefined &&
                        (attempt.consumer?.type !== "suggestion-card" ||
                            attempt.consumer.desiredRevision !== row.desiredRevision)
                    ) {
                        await closeUnclaimedSuggestion(ctx, row, attempt)
                        row = (await ctx.db.get(row._id))!
                        attempt = await ctx.db.get(attempt._id)
                    }
                }
                await ctx.db.patch(row._id, { nextCheckAt: now + 60000 })
                if (
                    attempt &&
                    ((attempt.dispatchedAt !== undefined && attempt.outcome === "pending") ||
                        (attempt.unresolved && attempt.outcome !== "pending") ||
                        (attempt.dispatchedAt !== undefined && attempt.outcome === "failed" && !attempt.resolution))
                )
                    continue
                if (row.dirty) cards.push(publicSuggestionWork({ ...row, nextCheckAt: now + 60000 }))
            }
            return {
                type: "cards",
                cards,
                hasMore: !page.isDone,
                ...(!page.isDone ? { nextCursor: { cursor: page.continueCursor, throughAt } } : {}),
            }
        }
        if (op.type === "card-index") {
            if (!(await suggestionSettings(ctx, serverId))?.enabled) return { type: "card-index", cards: [] }
            const page = await ctx.db
                .query("suggestions")
                .withIndex("by_number", (q) => q.eq("serverId", serverId))
                .paginate({ cursor: op.cursor ?? null, numItems: SUGGESTIONS_CARD_PAGE })
            const cards = []
            for (const row of page.page) {
                if (
                    row.postNo === undefined ||
                    row.forgetting ||
                    expiredSuggestion(row) ||
                    terminalSuggestion(row.state)
                )
                    continue
                const post = await ctx.db
                    .query("publishingPosts")
                    .withIndex("by_server_post", (q) => q.eq("serverId", serverId).eq("postNo", row.postNo!))
                    .unique()
                if (
                    post?.messageId &&
                    post.consumer?.type === "suggestion-card" &&
                    post.consumer.suggestionNo === row.suggestionNo &&
                    post.consumer.cardGeneration === row.cardGeneration
                )
                    cards.push({
                        suggestionNo: row.suggestionNo,
                        channelId: row.channelId,
                        cardChannelId: post.channelId,
                        messageId: post.messageId,
                    })
            }
            return { type: "card-index", cards, ...(page.isDone ? {} : { cursor: page.continueCursor }) }
        }
        if (op.type === "reactions-cleared") {
            const row = await reactionCard(ctx, serverId, op.channelId, op.messageId),
                observedAt = integer(op.observedAt, 0, now + 1000)
            if (!row || !(await votingOpen(ctx, row))) return { type: "progress", recorded: false }
            const swept = await clearReactionVotes(
                ctx,
                row,
                (vote) => op.choice === "all" || vote.choice === op.choice,
                observedAt,
                op.cursor,
            )
            return { type: "progress", recorded: swept.cleared > 0, ...(swept.cursor ? { cursor: swept.cursor } : {}) }
        }
        if (op.type === "reaction-sync") {
            const row = await suggestionRow(ctx, serverId, op.suggestionNo),
                observedAt = integer(op.observedAt, now - 60000, now + 1000)
            if (!(await votingOpen(ctx, row))) return { type: "reaction-sync", differing: [] }
            const differing = []
            for (const userId of new Set(op.present)) {
                const vote = await suggestionVote(ctx, serverId, row.suggestionNo, userId)
                // A command vote wins over a reaction until the member changes a reaction again
                if (!vote || (vote.via === "reaction" && vote.choice !== op.choice)) differing.push(userId)
                // A reaction vote this read confirms is kept by the sweep that ends the recount of its emoji
                else if (vote.via === "reaction" && vote.observedAt < observedAt)
                    await ctx.db.patch(vote._id, { observedAt })
            }
            return { type: "reaction-sync", differing }
        }
        if (op.type === "reaction-sweep") {
            const row = await suggestionRow(ctx, serverId, op.suggestionNo),
                before = integer(op.before, 0, now)
            if (!(await votingOpen(ctx, row))) return { type: "reaction-sweep", cleared: 0 }
            // Every reactor of the emoji was read since before, so a reaction vote for it that no read confirmed lost its reaction
            const swept = await clearReactionVotes(
                ctx,
                row,
                (vote) => vote.choice === op.choice && vote.observedAt < before,
                before,
                op.cursor,
            )
            return { type: "reaction-sweep", ...swept }
        }
        if (op.type !== "reserve" && op.type !== "defer") fail(400, "Invalid suggestion work operation")
        const binding = op.binding
        let row = await suggestionRow(ctx, serverId, binding.suggestionNo)
        if (
            row.cardGeneration !== binding.cardGeneration ||
            row.desiredRevision !== binding.desiredRevision ||
            row.forgetting ||
            !row.dirty
        )
            fail(409, "Suggestion work changed")
        if (op.type === "defer") {
            await patchSuggestionCard(ctx, row, {
                cardState: row.cardState === "reserved" ? "reserved" : "blocked",
                nextCheckAt: now + 60000,
            })
            return { type: "progress", recorded: true }
        }
        const settings = await suggestionSettings(ctx, serverId),
            publisher = await publisherSettings(ctx, serverId),
            context = suggestionCardContext(op.context)
        if (!settings?.enabled || publisher?.enabled === false) fail(403, "Suggestion publication disabled")
        if (now < row.dueAt) fail(409, "Suggestion card coalescing")
        await suggestionAutomation(ctx, serverId, context, suggestionCardChannel(row))
        let attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
        if (attempt?.outcome === "pending") {
            await age(ctx, attempt, now)
            attempt = await ctx.db.get(attempt._id)
            row = (await ctx.db.get(row._id))!
            if (attempt?.outcome === "pending") {
                if (attempt.dispatchedAt !== undefined) fail(409, "Suggestion card already claimed")
                if (
                    attempt.consumer?.type === "suggestion-card" &&
                    attempt.consumer.desiredRevision === binding.desiredRevision &&
                    attempt.consumer.cardGeneration === binding.cardGeneration &&
                    attempt.botId === context.botId
                ) {
                    const {
                        outcome,
                        createdAt,
                        finishedAt,
                        noDispatch,
                        dispatchedAt,
                        observation,
                        resolution,
                        ...grant
                    } = publicAttempt(attempt)
                    return { type: "reserved", grant: grant as SuggestionsCardGrant }
                }
                await closeUnclaimedSuggestion(ctx, row, attempt)
                row = (await ctx.db.get(row._id))!
                attempt = await ctx.db.get(attempt._id)
            }
        }
        if (
            attempt &&
            (attempt.unresolved ||
                (attempt.dispatchedAt !== undefined && attempt.outcome !== "sent" && !attempt.resolution))
        )
            fail(409, "Suggestion publication requires recovery")
        const existing =
            row.postNo !== undefined
                ? await ctx.db
                      .query("publishingPosts")
                      .withIndex("by_server_post", (q) => q.eq("serverId", serverId).eq("postNo", row.postNo!))
                      .unique()
                : null
        if (
            row.postNo !== undefined &&
            (!existing ||
                existing.attemptId !== row.attemptId ||
                existing.consumer?.type !== "suggestion-card" ||
                existing.consumer.suggestionNo !== row.suggestionNo ||
                existing.consumer.cardGeneration !== row.cardGeneration)
        )
            fail(409, "Suggestion card binding changed")
        const consumer = { type: "suggestion-card" as const, ...cardBinding(row) },
            sourceId = `suggestion_${row.suggestionNo}_${row.cardGeneration}_${row.desiredRevision}_${(existing?.generation ?? 0) + 1}`
        const reserved = await reservePublishing(ctx, {
            serverId,
            actorId: context.botId,
            botId: context.botId,
            channelId: suggestionCardChannel(row),
            sourceId,
            source: consumer,
            provenance: consumer,
            consumer,
            content: renderSuggestion(row, await serverPrefix(ctx, serverId)),
            ...(existing ? { existing } : {}),
            // In a forum or media channel the card becomes the first message of its own post
            forumPostName: `#${row.suggestionNo} ${row.text}`,
        })
        await patchSuggestionCard(ctx, row, {
            cardState: "reserved",
            postNo: reserved.post.postNo,
            attemptId: ctx.db.normalizeId("publishingAttempts", reserved.grant.attemptId)!,
            nextCheckAt: now + 60000,
        })
        return { type: "reserved", grant: reserved.grant as SuggestionsCardGrant }
    },
})
