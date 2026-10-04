import type { SuggestionsCardContext, SuggestionsContext, SuggestionsDefinition, SuggestionsSettings, SuggestionsVote, SuggestionsWorkRow, SuggestionsCardBinding } from "../contracts.js"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { shape } from "./publishingDomain.ts"
import { eventGate, publisherSettings } from "./schedulesStore.ts"
import { advanceSuggestion, suggestionDigest, SUGGESTIONS_DAY } from "./suggestionsDomain.ts"
import { fail, requireId, integer } from "./validation.ts"
import { eventAdmin, eventEligible } from "./publishingContext.ts"

export type SuggestionsRead = QueryCtx | MutationCtx
export const suggestionSettings = (ctx: SuggestionsRead, serverId: string) => ctx.db.query("suggestionSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
export async function suggestionState(ctx: MutationCtx, serverId: string) {
    const old = await suggestionSettings(ctx, serverId)
    if (old) return old
    const id = await ctx.db.insert("suggestionSettings", { serverId, enabled: false, revision: 1, nextSuggestionNo: 1, suggestions: 0, voters: 0, staffReceipts: 0, memberReceipts: 0, dirty: 0, blocked: 0 })
    return (await ctx.db.get(id))!
}
export async function suggestionCount(ctx: MutationCtx, serverId: string, key: "suggestions" | "voters" | "staffReceipts" | "memberReceipts" | "dirty" | "blocked", delta: number) {
    const state = await suggestionState(ctx, serverId), cap = { suggestions: 1000, voters: 10000, staffReceipts: 1000, memberReceipts: 10000, dirty: 1000, blocked: 1000 }[key]
    if (state[key] + delta > cap) fail(429, "Suggestion capacity reached")
    if (state[key] + delta < 0) fail(503, "Suggestion accounting unavailable")
    await ctx.db.patch(state._id, { [key]: state[key] + delta })
}
export function publicSuggestionSettings(row: Doc<"suggestionSettings"> | null): SuggestionsSettings {
    return { enabled: row?.enabled ?? false, revision: row?.revision ?? 1, suggestions: row?.suggestions ?? 0, voters: row?.voters ?? 0, staffReceipts: row?.staffReceipts ?? 0, memberReceipts: row?.memberReceipts ?? 0, dirty: row?.dirty ?? 0, blocked: row?.blocked ?? 0, ...(row?.channelId ? { channelId: row.channelId } : {}) }
}
export const expiredSuggestion = (row: Doc<"suggestions">) => row.historyExpiresAt !== undefined && Date.now() >= row.historyExpiresAt
export async function suggestionRow(ctx: SuggestionsRead, serverId: string, suggestionNo: unknown, revision?: unknown, allowExpired = false) {
    const row = await ctx.db.query("suggestions").withIndex("by_number", q => q.eq("serverId", serverId).eq("suggestionNo", integer(suggestionNo, 1, Number.MAX_SAFE_INTEGER))).unique()
    if (!row || !allowExpired && expiredSuggestion(row)) fail(404, "Suggestion not found")
    if (revision !== undefined && row.revision !== integer(revision, 1, Number.MAX_SAFE_INTEGER)) fail(409, "Suggestion revision changed")
    return row
}
export function publicSuggestion(row: Doc<"suggestions">): SuggestionsDefinition {
    const { suggestionNo, revision, authorId, channelId, text, state, up, down, voters, desiredRevision, publishedRevision, cardGeneration, cardState, createdAt, updatedAt, forgetting } = row
    return { suggestionNo, revision, authorId, channelId, text, state, up, down, voters, desiredRevision, publishedRevision, cardGeneration, cardState, cardStale: desiredRevision !== publishedRevision || cardState !== "current", createdAt, updatedAt, forgetting,
        ...(row.reason !== undefined ? { reason: row.reason } : {}), ...(row.statusBy ? { statusBy: row.statusBy } : {}), ...(row.statusAt !== undefined ? { statusAt: row.statusAt } : {}), ...(row.historyExpiresAt !== undefined ? { historyExpiresAt: row.historyExpiresAt } : {}), ...(row.postNo !== undefined ? { postNo: row.postNo } : {}), ...(row.attemptId ? { attemptId: row.attemptId } : {}) }
}
export function publicSuggestionVote(row: Doc<"suggestionVotes"> | null): SuggestionsVote | null {
    return row ? { choice: row.choice, joinedAt: row.joinedAt, acceptedCreatedAt: row.acceptedCreatedAt, acceptedMessageId: row.acceptedMessageId } : null
}
export const suggestionVote = (ctx: SuggestionsRead, serverId: string, suggestionNo: number, userId: string) => ctx.db.query("suggestionVotes").withIndex("by_suggestion_user", q => q.eq("serverId", serverId).eq("suggestionNo", suggestionNo).eq("userId", userId)).unique()
export const cardBinding = (row: Doc<"suggestions">): SuggestionsCardBinding => ({ suggestionNo: row.suggestionNo, cardGeneration: row.cardGeneration, desiredRevision: row.desiredRevision })
export function publicSuggestionWork(row: Doc<"suggestions">): SuggestionsWorkRow {
    return { ...cardBinding(row), channelId: row.channelId, dueAt: row.dueAt, nextCheckAt: row.nextCheckAt, state: row.cardState === "current" ? "queued" : row.cardState, ...(row.postNo !== undefined ? { postNo: row.postNo } : {}), ...(row.attemptId ? { attemptId: row.attemptId } : {}) }
}
export function orderedSuggestionSource(identity: { createdAt: number, messageId: string }, old: { acceptedCreatedAt?: number, acceptedMessageId?: string }) {
    return old.acceptedCreatedAt === undefined || BigInt(identity.messageId) > BigInt(old.acceptedMessageId!) && identity.createdAt >= old.acceptedCreatedAt
}
export async function suggestionReceipt(ctx: MutationCtx, identity: { serverId: string, messageId: string, createdAt: number }, actorId: string, category: "staff" | "member", operation: unknown) {
    const key = await suggestionDigest({ identity, actorId, category, operation }), old = await ctx.db.query("suggestionReceipts").withIndex("by_source", q => q.eq("serverId", identity.serverId).eq("messageId", identity.messageId)).unique()
    if (old) {
        if (old.actorId !== actorId || old.category !== category || old.operationKey !== key || old.createdAt !== identity.createdAt) fail(409, "Suggestion source binding changed")
        return false
    }
    await suggestionCount(ctx, identity.serverId, category === "staff" ? "staffReceipts" : "memberReceipts", 1)
    await ctx.db.insert("suggestionReceipts", { ...identity, actorId, category, operationKey: key, expiresAt: Date.now() + SUGGESTIONS_DAY })
    return true
}
export async function suggestionViewer(ctx: SuggestionsRead, serverId: string, context: SuggestionsContext, channelId: string) {
    const member = context.member
    if (context.channelId !== channelId || !member || member.userId !== context.actor.userId || member.isBot || member.userId === context.botId || !member.canView || !member.canReadHistory) fail(403, "Current visible human membership required")
    return member
}
export async function suggestionParticipant(ctx: SuggestionsRead, serverId: string, context: SuggestionsContext, channelId: string) {
    await suggestionViewer(ctx, serverId, context, channelId)
    return eventEligible(ctx, serverId, context, channelId, context.actor.userId)
}
export async function suggestionManager(ctx: SuggestionsRead, serverId: string, context: SuggestionsContext, critical = false) {
    await eventAdmin(ctx, serverId, context, critical)
    if (!context.member || context.member.userId !== context.actor.userId || context.member.isBot || context.actor.userId === context.botId) fail(403, "Current human manager required")
    await suggestionViewer(ctx, serverId, context, context.channelId)
}
export async function suggestionDestination(ctx: SuggestionsRead, serverId: string, context: SuggestionsContext, channelId: string) {
    await eventGate(ctx, serverId)
    await suggestionManager(ctx, serverId, context)
    if (!context.actorAuthorized || !context.botAuthorized || context.channelId !== channelId) fail(403, "Suggestion destination unavailable")
}
export function suggestionCardContext(value: unknown, now = Date.now()): SuggestionsCardContext {
    const r = shape(value, ["observedAt", "channelId", "botId", "botAuthorized"], ["observedAt", "channelId", "botId", "botAuthorized"])
    const observedAt = integer(r.observedAt, Math.max(0, now - 60000), now + 1000)
    if (r.botAuthorized !== true) fail(403, "Suggestion destination unavailable")
    return { observedAt, channelId: requireId(r.channelId), botId: requireId(r.botId), botAuthorized: true }
}
// Automatic card writes follow server policy: module on, DEFCON open and fresh bot permission in the destination
export async function suggestionAutomation(ctx: SuggestionsRead, serverId: string, context: SuggestionsCardContext, channelId: string) {
    await eventGate(ctx, serverId)
    if (context.channelId !== channelId) fail(403, "Suggestion destination unavailable")
}
type CardFields = Pick<Doc<"suggestions">, "dirty" | "cardState" | "dueAt" | "nextCheckAt" | "publishedRevision" | "attemptId" | "postNo">
export async function patchSuggestionCard(ctx: MutationCtx, row: Doc<"suggestions">, fields: Partial<Omit<CardFields, "attemptId" | "postNo">> & { attemptId?: CardFields["attemptId"] | undefined, postNo?: number | undefined }) {
    const next = { ...row, ...fields }
    if (next.dirty !== row.dirty) await suggestionCount(ctx, row.serverId, "dirty", next.dirty ? 1 : -1)
    if ((next.cardState === "blocked") !== (row.cardState === "blocked")) await suggestionCount(ctx, row.serverId, "blocked", next.cardState === "blocked" ? 1 : -1)
    await ctx.db.patch(row._id, fields)
}
export async function dirtySuggestion(ctx: MutationCtx, row: Doc<"suggestions">) {
    await ctx.db.patch(row._id, { desiredRevision: advanceSuggestion(row.desiredRevision), updatedAt: Date.now() })
    await patchSuggestionCard(ctx, row, { dirty: true, ...(row.dirty ? {} : { dueAt: Date.now() + 5000, nextCheckAt: Date.now() + 5000, cardState: "queued" as const }) })
}
export async function closeUnclaimedSuggestion(ctx: MutationCtx, row: Doc<"suggestions">, attempt: Doc<"publishingAttempts">) {
    if (attempt.outcome !== "pending" || attempt.dispatchedAt !== undefined) return false
    const post = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", row.serverId).eq("postNo", attempt.postNo)).unique()
    if (!post || row.attemptId !== attempt._id || post.attemptId !== attempt._id) fail(409, "Suggestion card binding changed")
    await ctx.db.patch(attempt._id, { outcome: "failed", noDispatch: true, unresolved: false, finishedAt: Date.now(), expiresAt: Date.now() + 180 * SUGGESTIONS_DAY })
    await ctx.db.patch(post._id, { outcome: "failed", updatedAt: Date.now() })
    await patchSuggestionCard(ctx, row, { cardState: "queued", nextCheckAt: Math.max(Date.now(), row.dueAt) })
    return true
}
export async function suggestionPublishingFence(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, value: unknown) {
    const consumer = attempt.consumer
    if (consumer?.type !== "suggestion-card") fail(409, "Suggestion consumer missing")
    const row = await suggestionRow(ctx, attempt.serverId, consumer.suggestionNo, undefined, true)
    if (row.attemptId !== attempt._id || row.postNo !== attempt.postNo || row.cardGeneration !== consumer.cardGeneration) fail(409, "Suggestion card binding changed")
    const settings = await suggestionSettings(ctx, row.serverId), publisher = await publisherSettings(ctx, row.serverId)
    if (expiredSuggestion(row) || row.forgetting || !settings?.enabled || publisher?.enabled === false || row.desiredRevision !== consumer.desiredRevision || Date.now() >= attempt.dispatchExpiresAt) {
        await closeUnclaimedSuggestion(ctx, row, attempt)
        return false
    }
    const context = suggestionCardContext(value)
    if (context.botId !== attempt.botId || attempt.source?.type !== "suggestion-card" || attempt.source.suggestionNo !== consumer.suggestionNo || attempt.source.cardGeneration !== consumer.cardGeneration || attempt.source.desiredRevision !== consumer.desiredRevision || attempt.provenance?.type !== "suggestion-card" || attempt.provenance.suggestionNo !== consumer.suggestionNo || attempt.provenance.cardGeneration !== consumer.cardGeneration || attempt.provenance.desiredRevision !== consumer.desiredRevision) fail(409, "Suggestion snapshot changed")
    await suggestionAutomation(ctx, row.serverId, context, row.channelId)
    return true
}
export async function syncSuggestionPublishing(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, outcome: "sent" | "failed" | "uncertain") {
    const binding = attempt.consumer
    if (binding?.type !== "suggestion-card") return
    const row = await ctx.db.query("suggestions").withIndex("by_number", q => q.eq("serverId", attempt.serverId).eq("suggestionNo", binding.suggestionNo)).unique()
    if (!row || row.attemptId !== attempt._id || row.postNo !== attempt.postNo || row.cardGeneration !== binding.cardGeneration) return
    if (outcome === "sent") {
        const current = row.desiredRevision === binding.desiredRevision
        await patchSuggestionCard(ctx, row, { publishedRevision: binding.desiredRevision, dirty: !current, cardState: current ? "current" : "queued", nextCheckAt: Math.max(Date.now(), row.dueAt) })
    } else if (outcome === "failed" && attempt.dispatchedAt === undefined) await patchSuggestionCard(ctx, row, { dirty: true, cardState: "queued", nextCheckAt: Date.now() + 60000 })
    else await patchSuggestionCard(ctx, row, { dirty: true, cardState: "blocked", nextCheckAt: Date.now() + 60000 })
}
