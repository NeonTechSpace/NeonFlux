import { v } from "convex/values"
import type { PublishingAttempt, PublishingDispatchPolicy, PublishingDraft, PublishingGrant, PublishingManageResult, PublishingObservation, PublishingPost, PublishingQueryResult, PublishingSource, PublishingProvenance, PublishingConsumer } from "../contracts.js"
import { internalMutation, internalQuery } from "./_generated/server.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { internal } from "./_generated/api.js"
import { actor, administrator } from "./moderationDomain.ts"
import { canonicalPublishingContent, editPublishingContent, PUBLISHING_BATCH, PUBLISHING_DAY, publishingContent, publishingKind, publishingName, shape } from "./publishingDomain.ts"
import { fail, object, requireId, requireServer, fresh, integer, source, token } from "./validation.ts"
import { protectedPanelPost } from "./rolesStore.ts"
import { claimSchedulePublishing, schedulePublishingFence, syncSchedulePublishing } from "./schedulesStore.ts"

// Retained posts and attempts protect exact native IDs even for disabled consumers
export async function publishingProtectsMessage(ctx: QueryCtx | MutationCtx, serverId: string, channelId: string, messageId: string) {
    return !!await ctx.db.query("publishingPosts").withIndex("by_native_message", q => q.eq("serverId", serverId).eq("channelId", channelId).eq("messageId", messageId)).first()
        || !!await ctx.db.query("publishingAttempts").withIndex("by_native_message", q => q.eq("serverId", serverId).eq("channelId", channelId).eq("messageId", messageId)).first()
}

type Read = MutationCtx | QueryCtx
const policy = { windowMs: 180000, nativeDeadlineMs: 5000, marginMs: 5000 } satisfies PublishingDispatchPolicy
const DISPATCH_WINDOW = policy.windowMs, NATIVE_DEADLINE = policy.nativeDeadlineMs, DISPATCH_MARGIN = policy.marginMs
const RETENTION = 180 * PUBLISHING_DAY
const dispatchClosed = (attempt: Doc<"publishingAttempts">, now: number) => attempt.dispatchedAt === undefined
    ? attempt.outcome !== "pending" || now >= attempt.dispatchExpiresAt
    : now >= attempt.dispatchExpiresAt + attempt.nativeDeadlineMs + DISPATCH_MARGIN
function dispatchToken(value: unknown) {
    if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) fail(400, "Invalid publishing claim")
    return value
}
async function settings(ctx: Read, serverId: string) { return ctx.db.query("publishingSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique() }
async function state(ctx: MutationCtx, serverId: string) {
    const existing = await settings(ctx, serverId)
    if (existing) return existing
    const id = await ctx.db.insert("publishingSettings", { serverId, enabled: true, nextPostNo: 1 })
    return (await ctx.db.get(id))!
}
async function authorize(ctx: Read, serverId: string, value: unknown, critical: boolean) {
    const who = actor(value)
    if (!administrator(who)) fail(403, "Administrator permission required")
    const moderation = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (moderation?.config.defcon === 1 && !critical) fail(403, "DEFCON restriction")
    return who
}
async function reserveSource(ctx: MutationCtx, serverId: string, sourceId: string, now: number) {
    const old = await ctx.db.query("publishingReceipts").withIndex("by_server_source", q => q.eq("serverId", serverId).eq("sourceId", sourceId)).unique()
    if (old) return false
    await ctx.db.insert("publishingReceipts", { serverId, sourceId, createdAt: now, expiresAt: now + PUBLISHING_DAY })
    return true
}
async function draft(ctx: Read, serverId: string, kind: unknown, name: unknown, revision?: unknown) {
    const row = await ctx.db.query("publishingDrafts").withIndex("by_server_kind_name", q => q.eq("serverId", serverId).eq("kind", publishingKind(kind)).eq("name", publishingName(name))).unique()
    if (!row) fail(404, "Publishing draft not found")
    if (revision !== undefined && row.revision !== integer(revision, 1, Number.MAX_SAFE_INTEGER)) fail(409, "Publishing draft changed")
    return row
}
async function post(ctx: Read, serverId: string, postNo: unknown, generation?: unknown) {
    const row = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", serverId).eq("postNo", integer(postNo, 1, Number.MAX_SAFE_INTEGER))).unique()
    if (!row) fail(404, "Tracked post not found")
    if (generation !== undefined && row.generation !== integer(generation, 1, Number.MAX_SAFE_INTEGER)) fail(409, "Tracked post changed")
    return row
}
export function publicDraft(row: Doc<"publishingDrafts">): PublishingDraft {
    return { kind: row.kind, name: row.name, revision: row.revision, content: row.content, canonicalContent: canonicalPublishingContent(row.canonicalContent), createdAt: row.createdAt, updatedAt: row.updatedAt }
}
export function publicAttempt(row: Doc<"publishingAttempts">): PublishingAttempt {
    return { attemptId: row._id, postNo: row.postNo, generation: row.generation, sourceId: row.sourceId, actorId: row.actorId, botId: row.botId,
        action: row.action, channelId: row.channelId, ...(row.messageId ? { messageId: row.messageId } : {}), ...(row.draftKind ? { draftKind: row.draftKind, draftName: row.draftName!, draftRevision: row.draftRevision! } : {}),
        ...(row.source ? { source: row.source } : {}), ...(row.provenance ? { provenance: row.provenance } : {}), ...(row.consumer ? { consumer: row.consumer } : {}),
        content: row.content, canonicalContent: canonicalPublishingContent(row.canonicalContent), ...(row.expectedContent ? { expectedContent: canonicalPublishingContent(row.expectedContent) } : {}), dispatchExpiresAt: row.dispatchExpiresAt, nativeDeadlineMs: row.nativeDeadlineMs,
        ...(row.dispatchedAt !== undefined ? { dispatchedAt: row.dispatchedAt } : {}), ...(row.noDispatch ? { noDispatch: true } : {}), outcome: row.outcome, createdAt: row.createdAt,
        ...(row.finishedAt !== undefined ? { finishedAt: row.finishedAt } : {}),
        ...(row.observation ? { observation: { ...row.observation, content: canonicalPublishingContent(row.observation.content) } } : {}), ...(row.resolution ? { resolution: row.resolution } : {}) }
}
export async function publicPost(ctx: Read, row: Doc<"publishingPosts">): Promise<PublishingPost> {
    const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
    if (!attempt || attempt.serverId !== row.serverId || attempt.postNo !== row.postNo) fail(503, "Tracked post unavailable")
    return { postNo: row.postNo, generation: row.generation, channelId: row.channelId, botId: row.botId, ...(row.messageId ? { messageId: row.messageId } : {}),
        outcome: row.outcome, createdAt: row.createdAt, updatedAt: row.updatedAt, ...(row.confirmedContent ? { confirmedContent: row.confirmedContent } : {}),
        ...(row.confirmedCanonicalContent ? { confirmedCanonicalContent: canonicalPublishingContent(row.confirmedCanonicalContent) } : {}), ...(row.confirmedDraftRevision !== undefined ? { confirmedDraftRevision: row.confirmedDraftRevision } : {}), ...(row.consumer ? { consumer: row.consumer } : {}), attempt: publicAttempt(attempt) }
}
export async function reservePublishing(ctx: MutationCtx, input: { serverId: string, actorId: string, botId: string, channelId: string, sourceId: string, source: PublishingSource, provenance: PublishingProvenance, content: PublishingAttempt["content"], consumer?: PublishingConsumer, draft?: { kind: PublishingDraft["kind"], name: string, revision: number }, existing?: Doc<"publishingPosts">, expiresAt?: number }) {
    const now = Date.now(), current = await state(ctx, input.serverId), existing = input.existing
    if (existing && existing.serverId !== input.serverId) fail(409, "Publishing server changed")
    if (!current.enabled) fail(403, "Publishing disabled")
    if (existing) {
        const prior = existing.attemptId ? await ctx.db.get(existing.attemptId) : null
        if (prior?.unresolved !== false || !existing.messageId || !existing.confirmedCanonicalContent) fail(409, "Tracked post cannot be edited")
        if (existing.channelId !== input.channelId || existing.botId !== input.botId) fail(409, "Publishing destination changed")
    }
    const postNo = existing?.postNo ?? current.nextPostNo, generation = integer((existing?.generation ?? 0) + 1, 1, Number.MAX_SAFE_INTEGER)
    const content = publishingContent(input.content, true), canonicalContent = canonicalPublishingContent(content), dispatchExpiresAt = input.expiresAt ?? now + DISPATCH_WINDOW
    if (dispatchExpiresAt <= now || dispatchExpiresAt > now + DISPATCH_WINDOW) fail(409, "Publishing dispatch window closed")
    if (!existing) await ctx.db.patch(current._id, { nextPostNo: integer(postNo + 1, 1, Number.MAX_SAFE_INTEGER) })
    const attemptId = await ctx.db.insert("publishingAttempts", { serverId: input.serverId, postNo, generation, sourceId: input.sourceId, actorId: input.actorId, botId: input.botId, channelId: input.channelId, action: existing?.messageId ? "edit" : "send",
        ...(existing?.messageId ? { messageId: existing.messageId } : {}), ...(input.draft ? { draftKind: input.draft.kind, draftName: input.draft.name, draftRevision: input.draft.revision } : {}),
        source: input.source, provenance: input.provenance, ...(input.consumer ? { consumer: input.consumer } : {}), content, canonicalContent, ...(existing?.confirmedCanonicalContent ? { expectedContent: canonicalPublishingContent(existing.confirmedCanonicalContent) } : {}),
        dispatchExpiresAt, nativeDeadlineMs: NATIVE_DEADLINE, outcome: "pending", unresolved: true, createdAt: now })
    const fields = { generation, outcome: "pending" as const, attemptId, updatedAt: now, ...(input.consumer ? { consumer: input.consumer } : {}) }
    const id = existing ? existing._id : await ctx.db.insert("publishingPosts", { serverId: input.serverId, postNo, channelId: input.channelId, botId: input.botId, createdAt: now, ...fields })
    if (existing) await ctx.db.patch(id, fields)
    const { outcome, createdAt, finishedAt, noDispatch, dispatchedAt, observation, resolution, ...grant } = publicAttempt((await ctx.db.get(attemptId))!)
    return { post: await publicPost(ctx, (await ctx.db.get(id))!), grant: grant as PublishingGrant }
}
async function syncPublishing(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, outcome: "sent" | "failed" | "uncertain") {
    if (attempt.consumer?.type === "schedule") await syncSchedulePublishing(ctx, attempt, outcome)
}
export async function releaseSchedulePublication(ctx: MutationCtx, delivery: Doc<"scheduleDeliveries">) {
    if (!delivery.attemptId) return
    const attempt = await ctx.db.get(delivery.attemptId)
    if (!attempt || attempt.consumer?.type !== "schedule" || attempt.consumer.deliveryId !== delivery._id || attempt.outcome === "pending" || attempt.unresolved) fail(409, "Unresolved schedule publication preserved")
    const row = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", delivery.serverId).eq("postNo", attempt.postNo)).unique()
    if (!row || row.attemptId !== attempt._id || row.consumer?.type !== "schedule" || row.consumer.deliveryId !== delivery._id) fail(503, "Schedule publication unavailable")
    await protectedPanelPost(ctx, delivery.serverId, row.postNo)
    if (await ctx.db.query("publishingAttempts").withIndex("by_server_post_unresolved", q => q.eq("serverId", row.serverId).eq("postNo", row.postNo).eq("unresolved", true)).first()) fail(409, "Unresolved schedule publication preserved")
    await ctx.db.delete(row._id)
    await ctx.db.delete(attempt._id)
}
export const manage = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<PublishingManageResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "actor", "operation"], ["serverId", "messageId", "createdAt", "actor", "operation"])
    const now = Date.now(), identity = source(input, now), op = object(input.operation)
    const critical = op.type === "settings" && Object.keys(object(op.patch)).length === 1 && object(op.patch).enabled === false
    const who = await authorize(ctx, identity.serverId, input.actor, critical)
    if (!await reserveSource(ctx, identity.serverId, identity.messageId, now)) return { duplicate: true }
    const current = await state(ctx, identity.serverId)
    if (op.type === "settings" || String(op.type).startsWith("draft-")) {
        const result = await applyPublishingConfiguration(ctx, identity.serverId, op, now)
        return result
    }
    if (op.type === "forget") {
        shape(op, ["type", "postNo", "expectedGeneration"], ["type", "postNo", "expectedGeneration"])
        const row = await post(ctx, identity.serverId, op.postNo, op.expectedGeneration)
        if (row.consumer) fail(409, "Tracked post retained by publishing consumer")
        await protectedPanelPost(ctx, identity.serverId, row.postNo)
        if (await ctx.db.query("publishingAttempts").withIndex("by_server_post_unresolved", q => q.eq("serverId", identity.serverId).eq("postNo", row.postNo).eq("unresolved", true)).first()) fail(409, "Unresolved tracked post preserved")
        await ctx.db.delete(row._id)
        return { duplicate: false, type: "forgotten", postNo: row.postNo }
    }
    if (op.type === "resolve") {
        shape(op, ["type", "postNo", "expectedGeneration", "outcome", "messageId", "channelId", "botId", "content"], ["type", "postNo", "expectedGeneration", "outcome"])
        const row = await post(ctx, identity.serverId, op.postNo, op.expectedGeneration)
        await protectedPanelPost(ctx, identity.serverId, row.postNo)
        const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
        if (!attempt || attempt.outcome !== "uncertain" || !attempt.unresolved) fail(409, "Tracked post has no unknown outcome")
        const outcome = op.outcome === "sent" || op.outcome === "failed" ? op.outcome : fail(400, "Invalid publishing resolution")
        if (["messageId", "channelId", "botId", "content"].some(field => (outcome === "sent") !== (op[field] !== undefined))) fail(400, "Invalid publishing resolution")
        const messageId = outcome === "sent" ? requireId(op.messageId) : undefined
        if (messageId && (attempt.messageId ?? row.messageId ?? messageId) !== messageId) fail(409, "Tracked message changed")
        // The bot read the message back, so it must be the bot's own message in the post's channel with the attempt's content
        if (messageId && (requireId(op.channelId) !== attempt.channelId || requireId(op.botId) !== attempt.botId
            || JSON.stringify(canonicalPublishingContent(publishingContent(op.content))) !== JSON.stringify(canonicalPublishingContent(attempt.canonicalContent)))) fail(409, "Publishing observation mismatch")
        await settle(ctx, row, attempt, outcome, now, messageId)
        return { duplicate: false, type: "resolved", post: await publicPost(ctx, (await ctx.db.get(row._id))!) }
    }
    if (!["draft-update", "draft-delete", "preview", "send", "edit"].includes(String(op.type))) fail(400, "Invalid publishing operation")
    const allowed = op.type === "draft-update" ? ["type", "kind", "name", "expectedRevision", "edit"] : op.type === "send" ? ["type", "kind", "name", "expectedRevision", "channelId", "context"]
        : op.type === "edit" ? ["type", "kind", "name", "expectedRevision", "postNo", "expectedGeneration", "context"] : ["type", "kind", "name", "expectedRevision"]
    shape(op, allowed, allowed)
    const selected = await draft(ctx, identity.serverId, op.kind, op.name, op.expectedRevision)
    const content = publishingContent(selected.content, true)
    if (op.type === "preview") return { duplicate: false, type: "preview", draft: publicDraft(selected) }
    if (!current.enabled) fail(403, "Publishing disabled")
    const context = shape(op.context, ["botId", "channelId", "botAuthorized", "actorAuthorized"], ["botId", "channelId", "botAuthorized", "actorAuthorized"])
    if (context.botAuthorized !== true || context.actorAuthorized !== true) fail(403, "Publishing channel permission required")
    const botId = requireId(context.botId), channelId = requireId(context.channelId), action = op.type === "send" ? "send" : "edit"
    const existing = action === "edit" ? await post(ctx, identity.serverId, op.postNo, op.expectedGeneration) : null
    if (existing) await protectedPanelPost(ctx, identity.serverId, existing.postNo)
    if (existing?.consumer) fail(409, "Tracked post retained by publishing consumer")
    const previousAttempt = existing?.attemptId ? await ctx.db.get(existing.attemptId) : null
    if (existing && (previousAttempt?.unresolved !== false || !existing.messageId || !existing.confirmedCanonicalContent)) fail(409, "Tracked post cannot be edited")
    if (channelId !== (existing?.channelId ?? requireId(op.channelId)) || existing && botId !== existing.botId) fail(409, "Publishing destination changed")
    const reserved = await reservePublishing(ctx, { serverId: identity.serverId, actorId: who.userId, botId, channelId, sourceId: identity.messageId,
        source: { type: "human", messageId: identity.messageId, createdAt: identity.createdAt }, provenance: { type: "draft", kind: selected.kind, name: selected.name, revision: selected.revision },
        content, draft: { kind: selected.kind, name: selected.name, revision: selected.revision }, ...(existing ? { existing } : {}) })
    return { duplicate: false, type: "post", ...reserved }
} })
export const query = internalQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<PublishingQueryResult> => {
    const input = shape(request, ["serverId", "actor", "operation"], ["serverId", "actor", "operation"]), serverId = requireId(input.serverId); requireServer(serverId)
    const op = object(input.operation); await authorize(ctx, serverId, input.actor, op.type === "settings" || op.type === "post-show" || op.type === "post-list")
    if (op.type === "settings") { shape(op, ["type"]); const row = await settings(ctx, serverId); return { type: "settings", settings: { enabled: row?.enabled ?? true } } }
    if (op.type === "draft-show") { shape(op, ["type", "kind", "name"], ["type", "kind", "name"]); return { type: "draft", draft: publicDraft(await draft(ctx, serverId, op.kind, op.name)) } }
    if (op.type === "draft-list") {
        shape(op, ["type", "kind", "page"], ["type", "kind"]); const kind = publishingKind(op.kind), page = op.page === undefined ? 1 : integer(op.page, 1, 10)
        const rows = await ctx.db.query("publishingDrafts").withIndex("by_server_kind_name", q => q.eq("serverId", serverId).eq("kind", kind)).take(101), totalPages = Math.max(1, Math.ceil(rows.length / 10))
        if (page > totalPages) fail(400, "Invalid publishing page")
        return { type: "drafts", kind, page, totalPages, drafts: rows.slice((page - 1) * 10, page * 10).map(publicDraft) }
    }
    if (op.type === "post-show") { shape(op, ["type", "postNo"], ["type", "postNo"]); return { type: "post", post: await publicPost(ctx, await post(ctx, serverId, op.postNo)) } }
    if (op.type === "post-list") {
        shape(op, ["type", "beforePostNo"], ["type"]); const before = op.beforePostNo === undefined ? Number.MAX_SAFE_INTEGER : integer(op.beforePostNo, 1, Number.MAX_SAFE_INTEGER)
        const rows = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", serverId).lt("postNo", before)).order("desc").take(11), chosen = rows.slice(0, 10)
        return { type: "posts", posts: await Promise.all(chosen.map(row => publicPost(ctx, row))), ...(rows.length > 10 ? { nextBeforePostNo: chosen.at(-1)!.postNo } : {}) }
    }
    fail(400, "Invalid publishing query")
} })
async function bound(ctx: Read, input: Record<string, unknown>) {
    const serverId = requireId(input.serverId); requireServer(serverId)
    const row = await post(ctx, serverId, input.postNo, input.generation ?? input.expectedGeneration)
    const id = ctx.db.normalizeId("publishingAttempts", token(input.attemptId)), attempt = id ? await ctx.db.get(id) : null
    if (!attempt || attempt.serverId !== serverId || attempt.postNo !== row.postNo || attempt.generation !== row.generation || row.attemptId !== id) fail(409, "Publishing attempt changed")
    return { row, attempt }
}
export const dispatch = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = shape(request, ["serverId", "postNo", "attemptId", "generation", "sourceId", "claimToken", "scheduleContext"], ["serverId", "postNo", "attemptId", "generation", "sourceId", "claimToken"])
    const { attempt } = await bound(ctx, input), now = Date.now()
    const claimToken = dispatchToken(input.claimToken)
    if (attempt.sourceId !== (attempt.source?.type === "schedule-timer" ? token(input.sourceId) : requireId(input.sourceId))) fail(409, "Publishing source changed")
    const response = { dispatchExpiresAt: attempt.dispatchExpiresAt, nativeDeadlineMs: attempt.nativeDeadlineMs }
    if (attempt.dispatchedAt !== undefined) return { claimed: false, ...response }
    if (attempt.consumer?.type === "schedule") {
        if (attempt.outcome !== "pending" || !await schedulePublishingFence(ctx, attempt, input.scheduleContext)) return { claimed: false, ...response }
    } else {
        if (input.scheduleContext !== undefined) fail(400, "Unexpected schedule context")
        if (attempt.outcome !== "pending" || now >= attempt.dispatchExpiresAt) fail(409, "Publishing dispatch expired")
    }
    await ctx.db.patch(attempt._id, { dispatchedAt: now, claimToken })
    await claimSchedulePublishing(ctx, attempt, now)
    return { claimed: true, ...response }
} })
export const outcome = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = shape(request, ["serverId", "postNo", "attemptId", "generation", "sourceId", "outcome", "messageId", "claimToken"], ["serverId", "postNo", "attemptId", "generation", "sourceId", "outcome"])
    const serverId = requireId(input.serverId); requireServer(serverId)
    const id = ctx.db.normalizeId("publishingAttempts", token(input.attemptId)), attempt = id ? await ctx.db.get(id) : null, now = Date.now()
    if (!attempt || attempt.serverId !== serverId || attempt.postNo !== integer(input.postNo, 1, Number.MAX_SAFE_INTEGER) || attempt.generation !== integer(input.generation, 1, Number.MAX_SAFE_INTEGER)) fail(409, "Publishing attempt changed")
    const row = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", serverId).eq("postNo", attempt.postNo)).unique()
    if (attempt.sourceId !== (attempt.source?.type === "schedule-timer" ? token(input.sourceId) : requireId(input.sourceId)) || !["sent", "failed", "uncertain"].includes(String(input.outcome))) fail(409, "Publishing outcome changed")
    const messageId = input.messageId === undefined ? undefined : requireId(input.messageId)
    const claimToken = input.claimToken === undefined ? undefined : dispatchToken(input.claimToken)
    if (attempt.dispatchedAt !== undefined ? claimToken !== attempt.claimToken : claimToken !== undefined || input.outcome !== "failed") fail(409, "Publishing dispatch ownership changed")
    if (input.outcome === "sent" && !messageId || input.outcome === "failed" && messageId || attempt.action === "edit" && messageId && messageId !== attempt.messageId) fail(400, "Invalid publishing outcome")
    if (attempt.messageId && messageId && attempt.messageId !== messageId) fail(409, "Tracked message changed")
    const result = input.outcome as "sent" | "failed" | "uncertain"
    const late = attempt.outcome === "uncertain" && attempt.unresolved && attempt.dispatchedAt !== undefined
    if (attempt.outcome !== "pending" && !late) {
        if (attempt.outcome !== result || messageId && attempt.messageId !== messageId) fail(409, "Publishing outcome already recorded")
        return { recorded: false }
    }
    if (!row || row.attemptId !== attempt._id || row.generation !== attempt.generation) fail(409, "Publishing attempt changed")
    if (attempt.dispatchedAt === undefined && result !== "failed") fail(409, "Publishing dispatch not claimed")
    if (row.messageId && messageId && row.messageId !== messageId) fail(409, "Tracked message changed")
    if (late && result === "uncertain") {
        if (!messageId || attempt.messageId) return { recorded: false }
        await ctx.db.patch(attempt._id, { messageId })
        await ctx.db.patch(row._id, { messageId, updatedAt: now })
        return { recorded: true }
    }
    await settle(ctx, row, attempt, result, now, messageId)
    return { recorded: true }
} })
async function settle(ctx: MutationCtx, row: Doc<"publishingPosts">, attempt: Doc<"publishingAttempts">, result: "sent" | "failed" | "uncertain", now: number, messageId?: string) {
    await ctx.db.patch(attempt._id, { outcome: result, unresolved: result === "uncertain", finishedAt: now, ...(messageId ? { messageId } : {}),
        ...(attempt.dispatchedAt === undefined ? { noDispatch: true as const } : {}), ...(result !== "uncertain" ? { expiresAt: now + RETENTION } : {}) })
    const confirmed = { confirmedContent: attempt.content, confirmedCanonicalContent: canonicalPublishingContent(attempt.canonicalContent),
        confirmedDraftRevision: attempt.draftRevision }
    await ctx.db.patch(row._id, { outcome: result, updatedAt: now, ...(messageId ? { messageId } : {}), ...(result === "sent" ? confirmed : {}) })
    await syncPublishing(ctx, attempt, result)
}
export const reconcile = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "actor", "postNo", "attemptId", "expectedGeneration", "observation"], ["serverId", "messageId", "createdAt", "actor", "postNo", "attemptId", "expectedGeneration", "observation"])
    const now = Date.now(), identity = source(input, now); await authorize(ctx, identity.serverId, input.actor, true)
    const { row, attempt } = await bound(ctx, input)
    if (!await reserveSource(ctx, identity.serverId, identity.messageId, now)) return { recorded: false, post: await publicPost(ctx, row) }
    return reconcilePublishing(ctx, row, attempt, input.observation)
} })
export async function reconcilePublishing(ctx: MutationCtx, row: Doc<"publishingPosts">, attempt: Doc<"publishingAttempts">, rawObservation: unknown) {
    const now = Date.now()
    const value = shape(rawObservation, ["observedAt", "messageId", "channelId", "botId", "content"], ["observedAt", "messageId", "channelId", "botId", "content"])
    const observedAt = integer(value.observedAt, attempt.createdAt, now + 60000); fresh(observedAt, now)
    if (!row.messageId || row.messageId !== requireId(value.messageId) || row.channelId !== requireId(value.channelId) || row.botId !== requireId(value.botId)) fail(409, "Publishing observation mismatch")
    if ((attempt.observation?.observedAt ?? -1) >= observedAt) return { recorded: false, post: await publicPost(ctx, row) }
    const observation: PublishingObservation = { observedAt, messageId: row.messageId, channelId: row.channelId, botId: row.botId, content: canonicalPublishingContent(publishingContent(value.content)) }
    await ctx.db.patch(attempt._id, { observation })
    if (attempt.outcome === "uncertain" && dispatchClosed(attempt, now) && dispatchClosed(attempt, observedAt)) {
        const intended = JSON.stringify(observation.content) === JSON.stringify(canonicalPublishingContent(attempt.canonicalContent))
        const previous = row.confirmedCanonicalContent && JSON.stringify(observation.content) === JSON.stringify(canonicalPublishingContent(row.confirmedCanonicalContent))
        if (intended || previous) {
            const resolution = { attemptId: attempt._id, generation: attempt.generation, sourceId: attempt.sourceId, observedAt, matched: intended ? "intended" as const : "previous" as const }
            await ctx.db.patch(attempt._id, { unresolved: false, resolution, expiresAt: now + RETENTION })
            if (intended) await ctx.db.patch(row._id, { confirmedContent: attempt.content, confirmedCanonicalContent: canonicalPublishingContent(attempt.canonicalContent), confirmedDraftRevision: attempt.draftRevision, updatedAt: now })
        } else if (attempt.resolution) await ctx.db.patch(attempt._id, { unresolved: true, resolution: undefined, expiresAt: undefined })
    }
    return { recorded: true, post: await publicPost(ctx, (await ctx.db.get(row._id))!) }
}
export async function age(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, now: number) {
    if (attempt.outcome !== "pending" || !dispatchClosed(attempt, now)) return false
    const outcome = attempt.dispatchedAt === undefined ? "failed" : "uncertain"
    await ctx.db.patch(attempt._id, { outcome, unresolved: outcome === "uncertain", ...(outcome === "failed" ? { noDispatch: true as const, finishedAt: now, expiresAt: now + RETENTION } : {}) })
    const row = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", attempt.serverId).eq("postNo", attempt.postNo)).unique()
    if (row?.attemptId === attempt._id) await ctx.db.patch(row._id, { outcome, updatedAt: now })
    await syncPublishing(ctx, attempt, outcome)
    return outcome === "uncertain"
}
export const observe = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = shape(request, ["serverId", "mode"], ["serverId", "mode"]), serverId = requireId(input.serverId); requireServer(serverId)
    if (input.mode !== "restart" && input.mode !== "aged") fail(400, "Invalid publishing observation mode")
    const now = Date.now(), before = now - NATIVE_DEADLINE - DISPATCH_MARGIN
    const rows = await ctx.db.query("publishingAttempts").withIndex("by_pending_deadline", q => q.eq("serverId", serverId).eq("outcome", "pending").lte("dispatchExpiresAt", before)).take(PUBLISHING_BATCH)
    let uncertainAttempts = 0
    for (const attempt of rows) if (await age(ctx, attempt, now)) uncertainAttempts++
    if (rows.length === PUBLISHING_BATCH) await ctx.scheduler.runAfter(0, internal.publishing.observe, { request: input })
    return { uncertainAttempts }
} })
export const cleanup = internalMutation({ args: {}, handler: async ctx => {
    const now = Date.now(); let removed = 0; let continuation = false
    const pending = await ctx.db.query("publishingAttempts").withIndex("by_global_pending_deadline", q => q.eq("outcome", "pending").lte("dispatchExpiresAt", now - NATIVE_DEADLINE - DISPATCH_MARGIN)).take(PUBLISHING_BATCH)
    for (const attempt of pending) await age(ctx, attempt, now)
    continuation ||= pending.length === PUBLISHING_BATCH
    const receipts = await ctx.db.query("publishingReceipts").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(PUBLISHING_BATCH)
    for (const row of receipts) { await ctx.db.delete(row._id); removed++ }
    continuation ||= receipts.length === PUBLISHING_BATCH
    const attempts = await ctx.db.query("publishingAttempts").withIndex("by_expiry", q => q.gt("expiresAt", 0).lte("expiresAt", now)).take(PUBLISHING_BATCH)
    for (const attempt of attempts) {
        if (attempt.unresolved) continue
        const row = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", attempt.serverId).eq("postNo", attempt.postNo)).unique()
        if (row?.attemptId === attempt._id) { await ctx.db.patch(attempt._id, { expiresAt: now + PUBLISHING_DAY }); continue }
        await ctx.db.delete(attempt._id); removed++
    }
    continuation ||= attempts.length === PUBLISHING_BATCH
    if (continuation) await ctx.scheduler.runAfter(0, internal.publishing.cleanup, {})
    return { removed }
} })

export async function applyPublishingConfiguration(ctx: MutationCtx, serverId: string, op: Record<string, unknown>, now: number): Promise<PublishingManageResult> {
    const identity = { serverId }, current = await state(ctx, serverId)
    if (op.type === "settings") {
        shape(op, ["type", "patch"], ["type", "patch"]); const patch = shape(op.patch, ["enabled"])
        if (!Object.keys(patch).length || patch.enabled !== undefined && typeof patch.enabled !== "boolean") fail(400, "Invalid publishing settings")
        await ctx.db.patch(current._id, { ...(patch.enabled !== undefined ? { enabled: patch.enabled as boolean } : {}), ...(patch.enabled === true && !current.enabled ? { activatedAt: now } : {}) })
        const next = (await ctx.db.get(current._id))!; return { duplicate: false, type: "settings", settings: { enabled: next.enabled } }
    }
    if (op.type === "draft-create" || op.type === "draft-clone") {
        const clone = op.type === "draft-clone"
        shape(op, clone ? ["type", "kind", "name", "expectedRevision", "toKind", "toName"] : ["type", "kind", "name", "content"], clone ? ["type", "kind", "name", "expectedRevision", "toKind", "toName"] : ["type", "kind", "name"])
        const from = clone ? await draft(ctx, identity.serverId, op.kind, op.name, op.expectedRevision) : null
        const kind = publishingKind(clone ? op.toKind : op.kind), name = publishingName(clone ? op.toName : op.name)
        if (await ctx.db.query("publishingDrafts").withIndex("by_server_kind_name", q => q.eq("serverId", identity.serverId).eq("kind", kind).eq("name", name)).unique()) fail(409, "Publishing name already exists")
        const content = from?.content ?? (op.content === undefined ? { content: "" } : publishingContent(op.content)), canonicalContent = canonicalPublishingContent(content)
        const id = await ctx.db.insert("publishingDrafts", { serverId: identity.serverId, kind, name, revision: 1, content, canonicalContent, createdAt: now, updatedAt: now })
        return { duplicate: false, type: "draft", draft: publicDraft((await ctx.db.get(id))!) }
    }
    const fields = op.type === "draft-set" ? ["type", "kind", "name", "expectedRevision", "content"] : op.type === "draft-update" ? ["type", "kind", "name", "expectedRevision", "edit"] : ["type", "kind", "name", "expectedRevision"]
    shape(op, fields, fields)
    const selected = await draft(ctx, serverId, op.kind, op.name, op.expectedRevision)
    if (op.type === "draft-set") {
        const content = publishingContent(op.content)
        await ctx.db.patch(selected._id, { revision: integer(selected.revision + 1, 1, Number.MAX_SAFE_INTEGER), content, canonicalContent: canonicalPublishingContent(content), updatedAt: now })
        return { duplicate: false, type: "draft", draft: publicDraft((await ctx.db.get(selected._id))!) }
    }
    if (op.type === "draft-delete") { await ctx.db.delete(selected._id); return { duplicate: false, type: "deleted", kind: selected.kind, name: selected.name } }
    if (op.type === "draft-update") {
        const content = editPublishingContent(selected.content, op.edit)
        await ctx.db.patch(selected._id, { revision: integer(selected.revision + 1, 1, Number.MAX_SAFE_INTEGER), content, canonicalContent: canonicalPublishingContent(content), updatedAt: now })
        return { duplicate: false, type: "draft", draft: publicDraft((await ctx.db.get(selected._id))!) }
    }
    fail(400, "Invalid publishing configuration")
}
