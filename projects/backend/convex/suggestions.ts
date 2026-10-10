import type { ConfigurationIdentity } from "./configurationRevision.ts"
import { changeConfiguration } from "./configurationChange.ts"
import type { MutationCtx } from "./_generated/server.js"
import { v } from "convex/values"
import type { SuggestionsManageResult, SuggestionsMemberResult, SuggestionsQueryResult } from "../contracts.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { administrator } from "./moderationDomain.ts"
import { epochOrder } from "./eventsDomain.ts"
import { eventGate } from "./schedulesStore.ts"
import { shape } from "./publishingDomain.ts"
import { publicPost, reconcilePublishing } from "./publishing.ts"
import { advanceSuggestion, suggestionChoice, suggestionDigest, suggestionState as parseState, terminalSuggestion, SUGGESTIONS_DAY } from "./suggestionsDomain.ts"
import { dirtySuggestion, expiredSuggestion, orderedSuggestionSource, patchSuggestionCard, publicSuggestion, publicSuggestionSettings, publicSuggestionVote,
    suggestionCount, suggestionDestination, suggestionManager, suggestionParticipant, suggestionReceipt, suggestionRow, suggestionSettings, suggestionState, suggestionViewer, suggestionVote } from "./suggestionsStore.ts"
import { forgetSuggestion } from "./suggestionsCleanup.ts"
import { fail, object, requireId, requireServer, integer, source, text, token } from "./validation.ts"
import { eventContext } from "./publishingContext.ts"

export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<SuggestionsManageResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "context", "operation"], ["serverId", "messageId", "createdAt", "context", "operation"])
    const identity = source(input, Date.now()), context = eventContext(input.context), op = object(input.operation), state = await suggestionState(ctx, identity.serverId)
    const critical = ["status", "reconcile", "replace", "forget"].includes(String(op.type)) || op.type === "settings" && op.enabled === false
    await suggestionManager(ctx, identity.serverId, context, critical)
    if (await ctx.db.query("suggestions").withIndex("by_source", q => q.eq("serverId", identity.serverId).eq("sourceId", identity.messageId)).first()) fail(409, "Suggestion source binding changed")
    if (!await suggestionReceipt(ctx, identity, context.actor.userId, "staff", op)) return { duplicate: true }
    if (op.type === "settings" || op.type === "configure") {
        return changeConfiguration(ctx, identity.serverId, "suggestions", { kind: "chat", createdAt: identity.createdAt, actor: { userId: context.actor.userId, source: "command" }, operation: op },
            () => applySuggestionsConfiguration(ctx, { serverId: identity.serverId, actorId: context.actor.userId, createdAt: identity.createdAt, source: { kind: "chat", messageId: identity.messageId } }, context, op))
    }
    const row = await suggestionRow(ctx, identity.serverId, op.suggestionNo, op.expectedRevision, ["forget", "reconcile", "replace"].includes(String(op.type)))
    await suggestionViewer(ctx, identity.serverId, context, row.channelId)
    if (identity.createdAt < row.createdAt || !orderedSuggestionSource(identity, row)) fail(409, "Suggestion management source is stale")
    if (op.type === "forget") {
        shape(op, ["type", "suggestionNo", "expectedRevision", "confirm"], ["type", "suggestionNo", "expectedRevision", "confirm"])
        if (op.confirm !== true) fail(400, "Explicit suggestion forget confirmation required")
        const result = await forgetSuggestion(ctx, row)
        return { duplicate: false, type: "forgotten", suggestionNo: row.suggestionNo, revision: row.revision, ...result }
    }
    if (op.type !== "reconcile" && (row.forgetting || expiredSuggestion(row))) fail(409, "Suggestion history closed")
    if (op.type === "status") {
        shape(op, ["type", "suggestionNo", "expectedRevision", "state", "reason"], ["type", "suggestionNo", "expectedRevision", "state", "reason"])
        const next = parseState(op.state), reason = text(op.reason, 500)
        if (next === "withdrawn" || row.state === "withdrawn") fail(409, "Withdrawal is final")
        const retainUntil = terminalSuggestion(next) ? Date.now() + 180 * SUGGESTIONS_DAY : undefined
        await ctx.db.patch(row._id, { state: next, reason, statusBy: context.actor.userId, statusAt: Date.now(), revision: advanceSuggestion(row.revision),
            historyExpiresAt: retainUntil, cleanupAt: retainUntil })
        await dirtySuggestion(ctx, row)
    } else if (op.type === "reconcile" || op.type === "replace") {
        const fields = ["type", "suggestionNo", "expectedRevision", "cardGeneration", "postNo", "attemptId", "expectedGeneration", "observation", ...(op.type === "replace" ? ["confirm"] : [])]
        shape(op, fields, fields)
        if (integer(op.cardGeneration, 1, Number.MAX_SAFE_INTEGER) !== row.cardGeneration || integer(op.postNo, 1, Number.MAX_SAFE_INTEGER) !== row.postNo || token(op.attemptId) !== row.attemptId) fail(409, "Suggestion card changed")
        const post = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", row.serverId).eq("postNo", row.postNo!)).unique(), attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
        if (!post || !attempt || post.attemptId !== row.attemptId || post.generation !== integer(op.expectedGeneration, 1, Number.MAX_SAFE_INTEGER) || attempt.generation !== post.generation || attempt.serverId !== row.serverId || attempt.postNo !== row.postNo || attempt.consumer?.type !== "suggestion-card" || attempt.consumer.suggestionNo !== row.suggestionNo || attempt.consumer.cardGeneration !== row.cardGeneration) fail(409, "Suggestion publication binding changed")
        if (op.type === "reconcile") {
            const result = await reconcilePublishing(ctx, post, attempt, op.observation), current = (await ctx.db.get(attempt._id))!
            if (current.resolution && !current.unresolved) {
                const intended = current.resolution.matched === "intended", confirmed = intended ? attempt.consumer.desiredRevision : row.publishedRevision
                const synced = intended && confirmed === row.desiredRevision
                await patchSuggestionCard(ctx, row, { publishedRevision: confirmed, dirty: !synced, cardState: synced ? "current" : "queued", nextCheckAt: Math.max(Date.now(), row.dueAt) })
            } else if (current.unresolved) await patchSuggestionCard(ctx, row, { dirty: true, cardState: "blocked", nextCheckAt: Date.now() + 60000 })
            await ctx.db.patch(row._id, { acceptedCreatedAt: identity.createdAt, acceptedMessageId: identity.messageId })
            return { duplicate: false, type: "reconciled", recorded: result.recorded, suggestion: publicSuggestion((await ctx.db.get(row._id))!), post: result.post }
        }
        const observation = shape(op.observation, ["status", "observedAt", "messageId", "channelId", "botId"], ["status", "observedAt", "messageId", "channelId", "botId"])
        if (op.confirm !== true || observation.status !== "absent" || !post.messageId || requireId(observation.messageId) !== post.messageId || requireId(observation.channelId) !== post.channelId || requireId(observation.botId) !== post.botId) fail(409, "Exact known card absence required")
        const observedAt = integer(observation.observedAt, Math.max(attempt.createdAt, Date.now() - 60000), Date.now() + 1000)
        if (attempt.outcome === "pending" || Date.now() < attempt.dispatchExpiresAt + attempt.nativeDeadlineMs + 5000 || observedAt < attempt.dispatchExpiresAt + attempt.nativeDeadlineMs + 5000 || await ctx.db.query("publishingAttempts").withIndex("by_suggestion_unresolved", q => q.eq("serverId", row.serverId).eq("consumer.suggestionNo", row.suggestionNo).eq("unresolved", true)).first()) fail(409, "Unresolved suggestion publication preserved")
        await ctx.db.patch(row._id, { revision: advanceSuggestion(row.revision), cardGeneration: advanceSuggestion(row.cardGeneration) })
        await patchSuggestionCard(ctx, row, { dirty: true, cardState: "queued", postNo: undefined, attemptId: undefined, publishedRevision: 0, dueAt: Date.now() + 5000, nextCheckAt: Date.now() + 5000 })
    } else fail(400, "Invalid suggestion management operation")
    await ctx.db.patch(row._id, { acceptedCreatedAt: identity.createdAt, acceptedMessageId: identity.messageId })
    return { duplicate: false, type: "suggestion", suggestion: publicSuggestion((await ctx.db.get(row._id))!) }
} })

export const member = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<SuggestionsMemberResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "context", "operation"], ["serverId", "messageId", "createdAt", "context", "operation"]), identity = { serverId: requireId(input.serverId), messageId: requireId(input.messageId), createdAt: integer(input.createdAt, 0, Number.MAX_SAFE_INTEGER) }, context = eventContext(input.context), op = object(input.operation)
    requireServer(identity.serverId)
    const state = await suggestionState(ctx, identity.serverId)
    if (op.type !== "withdraw") {
        await eventGate(ctx, identity.serverId)
        if (!state.enabled) fail(403, "Suggestions disabled")
    }
    if (op.type === "submit") {
        shape(op, ["type", "text"], ["type", "text"])
        const old = await ctx.db.query("suggestions").withIndex("by_source", q => q.eq("serverId", identity.serverId).eq("sourceId", identity.messageId)).unique()
        const channelId = old?.channelId ?? state.channelId
        if (!channelId) fail(409, "Suggestion destination unavailable")
        const member = await suggestionParticipant(ctx, identity.serverId, context, channelId), body = text(op.text, 2000)
        if (BigInt(identity.createdAt) * 1000000n < epochOrder(member.joinedAt)) fail(409, "Submission predates membership")
        const key = await suggestionDigest({ identity, actorId: member.userId, text: body, joinedAt: member.joinedAt })
        if (old) {
            if (old.sourceKey !== key || old.authorId !== member.userId || old.sourceCreatedAt !== identity.createdAt) fail(409, "Suggestion submission binding changed")
            if (expiredSuggestion(old) || old.forgetting) fail(409, "Suggestion history closed")
            await suggestionViewer(ctx, identity.serverId, context, old.channelId)
            return { duplicate: true, type: "suggestion", suggestion: publicSuggestion(old) }
        }
        source(input, Date.now())
        if (!await suggestionReceipt(ctx, identity, member.userId, "member", { ...op, joinedAt: member.joinedAt })) fail(409, "Suggestion submission unavailable")
        await suggestionCount(ctx, identity.serverId, "suggestions", 1); await suggestionCount(ctx, identity.serverId, "dirty", 1)
        const suggestionNo = state.nextSuggestionNo
        await ctx.db.patch(state._id, { nextSuggestionNo: advanceSuggestion(suggestionNo) })
        const id = await ctx.db.insert("suggestions", { serverId: identity.serverId, suggestionNo, revision: 1, authorId: member.userId, authorJoinedAt: member.joinedAt, channelId, text: body, state: "under-review", up: 0, down: 0, voters: 0, desiredRevision: 1, publishedRevision: 0, cardGeneration: 1, cardState: "queued", dirty: true, dueAt: Date.now() + 5000, nextCheckAt: Date.now() + 5000, createdAt: identity.createdAt, updatedAt: Date.now(), sourceId: identity.messageId, sourceCreatedAt: identity.createdAt, sourceKey: key, acceptedCreatedAt: identity.createdAt, acceptedMessageId: identity.messageId, forgetting: false })
        return { duplicate: false, type: "suggestion", suggestion: publicSuggestion((await ctx.db.get(id))!) }
    }
    source(input, Date.now())
    const row = await suggestionRow(ctx, identity.serverId, op.suggestionNo), member = await (op.type === "withdraw" ? suggestionViewer : suggestionParticipant)(ctx, identity.serverId, context, row.channelId)
    if (row.forgetting) fail(409, "Suggestion history closed")
    if (identity.createdAt < row.createdAt || BigInt(identity.createdAt) * 1000000n < epochOrder(member.joinedAt)) fail(409, "Suggestion command predates creation or membership")
    if (await ctx.db.query("suggestions").withIndex("by_source", q => q.eq("serverId", identity.serverId).eq("sourceId", identity.messageId)).first()) fail(409, "Suggestion source binding changed")
    if (op.type === "withdraw") {
        shape(op, ["type", "suggestionNo", "expectedRevision", "confirm"], ["type", "suggestionNo", "expectedRevision", "confirm"])
        if (row.authorId !== member.userId) fail(403, "Suggestion author required")
        if (!await suggestionReceipt(ctx, identity, member.userId, "member", { ...op, joinedAt: member.joinedAt })) return { duplicate: true, type: "suggestion", suggestion: publicSuggestion(row) }
        if (op.confirm !== true) fail(400, "Explicit withdrawal confirmation required")
        if (row.revision !== integer(op.expectedRevision, 1, Number.MAX_SAFE_INTEGER) || !orderedSuggestionSource(identity, row) || row.state === "withdrawn") fail(409, "Suggestion withdrawal changed")
        const retainUntil = Date.now() + 180 * SUGGESTIONS_DAY
        await ctx.db.patch(row._id, { revision: advanceSuggestion(row.revision), state: "withdrawn",
            reason: "Withdrawn by author", statusBy: member.userId, statusAt: Date.now(), historyExpiresAt: retainUntil, cleanupAt: retainUntil,
            acceptedCreatedAt: identity.createdAt, acceptedMessageId: identity.messageId })
        await dirtySuggestion(ctx, row)
        return { duplicate: false, type: "suggestion", suggestion: publicSuggestion((await ctx.db.get(row._id))!) }
    }
    if (op.type !== "vote") fail(400, "Invalid suggestion member operation")
    shape(op, ["type", "suggestionNo", "choice"], ["type", "suggestionNo", "choice"])
    if (terminalSuggestion(row.state)) fail(403, "Suggestion voting closed")
    const choice = suggestionChoice(op.choice), old = await suggestionVote(ctx, row.serverId, row.suggestionNo, member.userId)
    const response = async (accepted: boolean, duplicate = false): Promise<SuggestionsMemberResult> => ({ duplicate, type: "vote", accepted, vote: publicSuggestionVote(await suggestionVote(ctx, row.serverId, row.suggestionNo, member.userId)), suggestion: publicSuggestion((await ctx.db.get(row._id))!) })
    const acceptedSourceKey = await suggestionDigest({ identity, actorId: member.userId, category: "member", operation: { ...op, joinedAt: member.joinedAt } })
    if (old?.acceptedMessageId === identity.messageId) {
        if (old.acceptedSourceKey !== acceptedSourceKey) fail(409, "Suggestion vote source binding changed")
        return response(false, true)
    }
    if (!await suggestionReceipt(ctx, identity, member.userId, "member", { ...op, joinedAt: member.joinedAt })) return response(false, true)
    if (old && (!orderedSuggestionSource(identity, old) || epochOrder(member.joinedAt) < epochOrder(old.joinedAt) || member.joinedAt !== old.joinedAt && epochOrder(member.joinedAt) === epochOrder(old.joinedAt) || context.observedAt < old.observedAt)) return response(false)
    if (!old && row.voters >= 1000) fail(429, "Suggestion voter capacity reached")
    const fields = { choice, acceptedSourceKey, joinedAt: member.joinedAt, acceptedCreatedAt: identity.createdAt, acceptedMessageId: identity.messageId, observedAt: context.observedAt }
    if (old) await ctx.db.patch(old._id, fields)
    else { await suggestionCount(ctx, row.serverId, "voters", 1); await ctx.db.insert("suggestionVotes", { serverId: row.serverId, suggestionNo: row.suggestionNo, userId: member.userId, ...fields }) }
    const up = row.up - (old?.choice === "up" ? 1 : 0) + (choice === "up" ? 1 : 0), down = row.down - (old?.choice === "down" ? 1 : 0) + (choice === "down" ? 1 : 0)
    if (up < 0 || down < 0) fail(503, "Suggestion vote accounting unavailable")
    await ctx.db.patch(row._id, { up, down, voters: row.voters + (old ? 0 : 1) })
    if (up !== row.up || down !== row.down) await dirtySuggestion(ctx, row)
    return response(true)
} })

export const query = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<SuggestionsQueryResult> => {
    const input = shape(request, ["serverId", "context", "operation"], ["serverId", "context", "operation"]), serverId = requireId(input.serverId)
    requireServer(serverId)
    const context = eventContext(input.context), op = object(input.operation)
    if (op.type === "settings") { shape(op, ["type"], ["type"]); await suggestionManager(ctx, serverId, context, true); return { type: "settings", settings: publicSuggestionSettings(await suggestionSettings(ctx, serverId)) } }
    if (op.type === "list") {
        shape(op, ["type", "state", "beforeSuggestionNo"], ["type"])
        await suggestionViewer(ctx, serverId, context, context.channelId)
        const before = op.beforeSuggestionNo === undefined ? Number.MAX_SAFE_INTEGER : integer(op.beforeSuggestionNo, 1, Number.MAX_SAFE_INTEGER), state = op.state === undefined ? undefined : parseState(op.state)
        const base = state === undefined ? ctx.db.query("suggestions").withIndex("by_channel", q => q.eq("serverId", serverId).eq("channelId", context.channelId).lt("suggestionNo", before)) : ctx.db.query("suggestions").withIndex("by_channel_state", q => q.eq("serverId", serverId).eq("channelId", context.channelId).eq("state", state).lt("suggestionNo", before))
        const rows = await base.order("desc").take(11), selected = rows.slice(0, 10)
        return { type: "suggestions", suggestions: selected.filter(r => !r.forgetting && !expiredSuggestion(r)).map(publicSuggestion), ...(rows.length > 10 ? { nextBeforeSuggestionNo: selected.at(-1)!.suggestionNo } : {}) }
    }
    const row = await suggestionRow(ctx, serverId, op.suggestionNo, undefined, op.type === "publication" && administrator(context.actor))
    await suggestionViewer(ctx, serverId, context, row.channelId)
    if (row.forgetting && op.type !== "publication") fail(404, "Suggestion not found")
    if (op.type === "show") { shape(op, ["type", "suggestionNo"], ["type", "suggestionNo"]); return { type: "suggestion", suggestion: publicSuggestion(row) } }
    if (op.type === "mine") { shape(op, ["type", "suggestionNo"], ["type", "suggestionNo"]); return { type: "vote", vote: publicSuggestionVote(await suggestionVote(ctx, serverId, row.suggestionNo, context.actor.userId)), suggestion: publicSuggestion(row) } }
    if (op.type === "publication") {
        shape(op, ["type", "suggestionNo"], ["type", "suggestionNo"])
        await suggestionManager(ctx, serverId, context, true)
        const post = row.postNo !== undefined ? await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", serverId).eq("postNo", row.postNo!)).unique() : null
        return { type: "publication", suggestion: publicSuggestion(row), post: post ? await publicPost(ctx, post) : null }
    }
    fail(400, "Invalid suggestion query")
} })

export async function applySuggestionsConfiguration(ctx: MutationCtx, identity: ConfigurationIdentity, context: ReturnType<typeof eventContext> | undefined, op: Record<string, unknown>): Promise<SuggestionsManageResult> {
    const state = await suggestionState(ctx, identity.serverId)
    if (op.type === "settings" || op.type === "configure") {
        shape(op, op.type === "settings" ? ["type", "expectedRevision", "enabled"] : ["type", "expectedRevision", "channelId"], op.type === "settings" ? ["type", "expectedRevision", "enabled"] : ["type", "expectedRevision", "channelId"])
        if (integer(op.expectedRevision, 1, Number.MAX_SAFE_INTEGER) !== state.revision || identity.source.kind === "chat" && !orderedSuggestionSource({ createdAt: identity.createdAt, messageId: identity.source.messageId }, state)) fail(409, "Suggestion settings changed")
        if (op.type === "configure") {
            if (!context) fail(403, "Native suggestion manager required")
            const channelId = requireId(op.channelId)
            await suggestionDestination(ctx, identity.serverId, context, channelId)
            await ctx.db.patch(state._id, { channelId })
        } else {
            if (typeof op.enabled !== "boolean") fail(400, "Invalid suggestion settings")
            if (op.enabled && !state.channelId) fail(409, "Configure suggestion destination first")
            if (op.enabled && await ctx.db.query("responseDefinitions").withIndex("by_server_kind_name", q => q.eq("serverId", identity.serverId).eq("kind", "custom").eq("name", "suggest")).first()) fail(409, "Suggestion command namespace occupied")
            await ctx.db.patch(state._id, { enabled: op.enabled })
        }
        await ctx.db.patch(state._id, { revision: advanceSuggestion(state.revision), ...(identity.source.kind === "chat" ? { acceptedCreatedAt: identity.createdAt, acceptedMessageId: identity.source.messageId } : {}) })
        return { duplicate: false, type: "settings", settings: publicSuggestionSettings((await ctx.db.get(state._id))!) }
    }
    fail(400, "Invalid suggestion configuration")
}
