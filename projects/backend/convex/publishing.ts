import { v } from "convex/values"
import {
    PublishingObservation,
    equalPublishingContent,
    type PublishingAttempt,
    type PublishingConsumer,
    type PublishingGrant,
    type PublishingKind,
    type PublishingPost,
    type PublishingProvenance,
    type PublishingSource,
} from "@neonflux/contracts/publishing-base"
import {
    PublishingConfigurationOperation,
    PublishingDispatchRequest,
    PublishingManageRequest,
    PublishingObserveRequest,
    PublishingOutcomeRequest,
    PublishingQueryRequest,
    PublishingReconcileRequest,
    type PublishingDispatchPolicy,
    type PublishingDispatchResult,
    type PublishingDraft,
    type PublishingManageOperation,
    type PublishingManageResult,
    type PublishingObserveResult,
    type PublishingOutcomeResult,
    type PublishingQueryResult,
    type PublishingReconcileResult,
} from "@neonflux/contracts/publishing"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { internal } from "./_generated/api.js"
import {
    canonicalPublishingContent,
    editPublishingContent,
    PUBLISHING_BATCH,
    PUBLISHING_DAY,
    publishingContent,
    publishingName,
} from "./publishingDomain.ts"
import { decode, fail, requireId, requireServer, fresh, integer, source } from "./validation.ts"
import { protectedPanelPost } from "./rolesStore.ts"
import { requireAdministrator } from "./moderationStore.ts"
import { claimEventPublishing, eventPublishingFence, syncEventPublishing } from "./eventsStore.ts"
import { claimSchedulePublishing, schedulePublishingFence, syncSchedulePublishing } from "./schedulesStore.ts"
import { claimMilestonePublishing, milestonePublishingFence, syncMilestonePublishing } from "./milestonesStore.ts"
import { suggestionPublishingFence, syncSuggestionPublishing } from "./suggestionsStore.ts"
import { ringWork } from "./workSignal.ts"

type Read = MutationCtx | QueryCtx
const policy = { windowMs: 180000, nativeDeadlineMs: 5000, marginMs: 5000 } satisfies PublishingDispatchPolicy
const DISPATCH_WINDOW = policy.windowMs,
    NATIVE_DEADLINE = policy.nativeDeadlineMs,
    DISPATCH_MARGIN = policy.marginMs
const RETENTION = 180 * PUBLISHING_DAY
const dispatchClosed = (attempt: Doc<"publishingAttempts">, now: number) =>
    attempt.dispatchedAt === undefined
        ? attempt.outcome !== "pending" || now >= attempt.dispatchExpiresAt
        : now >= attempt.dispatchExpiresAt + attempt.nativeDeadlineMs + DISPATCH_MARGIN
async function settings(ctx: Read, serverId: string) {
    return ctx.db
        .query("publishingSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
}
async function state(ctx: MutationCtx, serverId: string) {
    const existing = await settings(ctx, serverId)
    if (existing) return existing
    const id = await ctx.db.insert("publishingSettings", { serverId, enabled: true, nextPostNo: 1 })
    return (await ctx.db.get(id))!
}
async function reserveSource(ctx: MutationCtx, serverId: string, sourceId: string, now: number) {
    const old = await ctx.db
        .query("publishingReceipts")
        .withIndex("by_server_source", (q) => q.eq("serverId", serverId).eq("sourceId", sourceId))
        .unique()
    if (old) return false
    await ctx.db.insert("publishingReceipts", { serverId, sourceId, createdAt: now, expiresAt: now + PUBLISHING_DAY })
    return true
}
async function draft(ctx: Read, serverId: string, kind: PublishingKind, name: string, revision?: number) {
    const row = await ctx.db
        .query("publishingDrafts")
        .withIndex("by_server_kind_name", (q) =>
            q.eq("serverId", serverId).eq("kind", kind).eq("name", publishingName(name)),
        )
        .unique()
    if (!row) fail(404, "Publishing draft not found")
    if (revision !== undefined && row.revision !== revision) fail(409, "Publishing draft changed")
    return row
}
async function post(ctx: Read, serverId: string, postNo: number, generation?: number) {
    const row = await ctx.db
        .query("publishingPosts")
        .withIndex("by_server_post", (q) => q.eq("serverId", serverId).eq("postNo", postNo))
        .unique()
    if (!row) fail(404, "Tracked post not found")
    if (generation !== undefined && row.generation !== generation) fail(409, "Tracked post changed")
    return row
}
function publicDraft(row: Doc<"publishingDrafts">): PublishingDraft {
    return {
        kind: row.kind,
        name: row.name,
        revision: row.revision,
        content: row.content,
        canonicalContent: row.canonicalContent,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}
export function publicAttempt(row: Doc<"publishingAttempts">): PublishingAttempt {
    return {
        attemptId: row._id,
        postNo: row.postNo,
        generation: row.generation,
        sourceId: row.sourceId,
        actorId: row.actorId,
        botId: row.botId,
        action: row.action,
        channelId: row.channelId,
        ...(row.messageId ? { messageId: row.messageId } : {}),
        ...(row.draftKind
            ? { draftKind: row.draftKind, draftName: row.draftName!, draftRevision: row.draftRevision! }
            : {}),
        ...(row.source ? { source: row.source } : {}),
        ...(row.provenance ? { provenance: row.provenance } : {}),
        ...(row.consumer ? { consumer: row.consumer } : {}),
        content: row.content,
        canonicalContent: row.canonicalContent,
        ...(row.expectedContent ? { expectedContent: row.expectedContent } : {}),
        dispatchExpiresAt: row.dispatchExpiresAt,
        nativeDeadlineMs: row.nativeDeadlineMs,
        ...(row.dispatchedAt !== undefined ? { dispatchedAt: row.dispatchedAt } : {}),
        ...(row.noDispatch ? { noDispatch: true } : {}),
        outcome: row.outcome,
        createdAt: row.createdAt,
        ...(row.finishedAt !== undefined ? { finishedAt: row.finishedAt } : {}),
        ...(row.observation ? { observation: row.observation } : {}),
        ...(row.resolution ? { resolution: row.resolution } : {}),
    }
}
export async function publicPost(ctx: Read, row: Doc<"publishingPosts">): Promise<PublishingPost> {
    const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
    if (!attempt || attempt.serverId !== row.serverId || attempt.postNo !== row.postNo)
        fail(503, "Tracked post unavailable")
    return {
        postNo: row.postNo,
        generation: row.generation,
        channelId: row.channelId,
        botId: row.botId,
        ...(row.messageId ? { messageId: row.messageId } : {}),
        outcome: row.outcome,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        ...(row.confirmedContent ? { confirmedContent: row.confirmedContent } : {}),
        ...(row.confirmedCanonicalContent ? { confirmedCanonicalContent: row.confirmedCanonicalContent } : {}),
        ...(row.confirmedDraftRevision !== undefined ? { confirmedDraftRevision: row.confirmedDraftRevision } : {}),
        ...(row.consumer ? { consumer: row.consumer } : {}),
        attempt: publicAttempt(attempt),
    }
}
export async function reservePublishing(
    ctx: MutationCtx,
    input: {
        serverId: string
        actorId: string
        botId: string
        channelId: string
        sourceId: string
        source: PublishingSource
        provenance: PublishingProvenance
        content: PublishingAttempt["content"]
        consumer?: PublishingConsumer
        draft?: { kind: PublishingDraft["kind"]; name: string; revision: number }
        existing?: Doc<"publishingPosts">
        expiresAt?: number
    },
) {
    const now = Date.now(),
        current = await state(ctx, input.serverId),
        existing = input.existing
    if (existing && existing.serverId !== input.serverId) fail(409, "Publishing server changed")
    if (!current.enabled) fail(403, "Publishing disabled")
    if (existing) {
        const prior = existing.attemptId ? await ctx.db.get(existing.attemptId) : null
        const retryUnclaimedCard =
            ((input.consumer?.type === "event" && input.consumer.purpose === "card") ||
                input.consumer?.type === "suggestion-card") &&
            !existing.messageId &&
            prior?.outcome === "failed" &&
            prior.noDispatch === true
        if (
            prior?.unresolved !== false ||
            (!retryUnclaimedCard && (!existing.messageId || !existing.confirmedCanonicalContent))
        )
            fail(409, "Tracked post cannot be edited")
        if (existing.channelId !== input.channelId || existing.botId !== input.botId)
            fail(409, "Publishing destination changed")
        if (existing.consumer?.type === "suggestion-card") {
            if (
                input.consumer?.type !== "suggestion-card" ||
                existing.consumer.suggestionNo !== input.consumer.suggestionNo ||
                existing.consumer.cardGeneration !== input.consumer.cardGeneration
            )
                fail(409, "Publishing suggestion consumer changed")
        } else if (
            existing.consumer &&
            (existing.consumer.type !== "event" ||
                input.consumer?.type !== "event" ||
                existing.consumer.eventNo !== input.consumer.eventNo ||
                existing.consumer.purpose !== input.consumer.purpose)
        )
            fail(409, "Publishing consumer changed")
    }
    const postNo = existing?.postNo ?? current.nextPostNo,
        generation = integer((existing?.generation ?? 0) + 1, 1, Number.MAX_SAFE_INTEGER)
    const content = publishingContent(input.content, true),
        canonicalContent = canonicalPublishingContent(content),
        dispatchExpiresAt = input.expiresAt ?? now + DISPATCH_WINDOW
    if (dispatchExpiresAt <= now || dispatchExpiresAt > now + DISPATCH_WINDOW)
        fail(409, "Publishing dispatch window closed")
    if (!existing) await ctx.db.patch(current._id, { nextPostNo: integer(postNo + 1, 1, Number.MAX_SAFE_INTEGER) })
    const attemptId = await ctx.db.insert("publishingAttempts", {
        serverId: input.serverId,
        postNo,
        generation,
        sourceId: input.sourceId,
        actorId: input.actorId,
        botId: input.botId,
        channelId: input.channelId,
        action: existing?.messageId ? "edit" : "send",
        ...(existing?.messageId ? { messageId: existing.messageId } : {}),
        ...(input.draft
            ? { draftKind: input.draft.kind, draftName: input.draft.name, draftRevision: input.draft.revision }
            : {}),
        source: input.source,
        provenance: input.provenance,
        ...(input.consumer ? { consumer: input.consumer } : {}),
        content,
        canonicalContent,
        ...(existing?.confirmedCanonicalContent ? { expectedContent: existing.confirmedCanonicalContent } : {}),
        dispatchExpiresAt,
        nativeDeadlineMs: NATIVE_DEADLINE,
        outcome: "pending",
        unresolved: true,
        createdAt: now,
    })
    const fields = {
        generation,
        outcome: "pending" as const,
        attemptId,
        updatedAt: now,
        ...(input.consumer ? { consumer: input.consumer } : {}),
    }
    const id = existing
        ? existing._id
        : await ctx.db.insert("publishingPosts", {
              serverId: input.serverId,
              postNo,
              channelId: input.channelId,
              botId: input.botId,
              createdAt: now,
              ...fields,
          })
    if (existing) await ctx.db.patch(id, fields)
    const { outcome, createdAt, finishedAt, noDispatch, dispatchedAt, observation, resolution, ...grant } =
        publicAttempt((await ctx.db.get(attemptId))!)
    return { post: await publicPost(ctx, (await ctx.db.get(id))!), grant: grant as PublishingGrant }
}
export async function forgetConsumerPost(ctx: MutationCtx, row: Doc<"publishingPosts">) {
    if (
        await ctx.db
            .query("publishingAttempts")
            .withIndex("by_server_post_unresolved", (q) =>
                q.eq("serverId", row.serverId).eq("postNo", row.postNo).eq("unresolved", true),
            )
            .first()
    )
        fail(409, "Unresolved event publication preserved")
    await ctx.db.delete(row._id)
}
export async function retireSuggestionPost(
    ctx: MutationCtx,
    row: Doc<"publishingPosts">,
    limit: number,
): Promise<{ complete: boolean; removed: number }> {
    if (row.consumer?.type !== "suggestion-card") fail(409, "Suggestion post required")
    if (
        await ctx.db
            .query("publishingAttempts")
            .withIndex("by_server_post_unresolved", (q) =>
                q.eq("serverId", row.serverId).eq("postNo", row.postNo).eq("unresolved", true),
            )
            .first()
    )
        fail(409, "Unresolved suggestion publication preserved")
    const attempts = await ctx.db
        .query("publishingAttempts")
        .withIndex("by_server_post", (q) => q.eq("serverId", row.serverId).eq("postNo", row.postNo))
        .take(limit + 1)
    let removed = 0
    for (const attempt of attempts.filter((a) => a._id !== row.attemptId).slice(0, Math.max(0, limit - 2))) {
        if (
            attempt.outcome === "pending" ||
            attempt.unresolved ||
            attempt.consumer?.type !== "suggestion-card" ||
            attempt.consumer.suggestionNo !== row.consumer.suggestionNo
        )
            fail(409, "Suggestion publication evidence preserved")
        await ctx.db.delete(attempt._id)
        removed++
    }
    const remaining = await ctx.db
        .query("publishingAttempts")
        .withIndex("by_server_post", (q) => q.eq("serverId", row.serverId).eq("postNo", row.postNo))
        .take(2)
    if (remaining.some((a) => a._id !== row.attemptId) || limit - removed < remaining.length + 1)
        return { complete: false, removed }
    for (const attempt of remaining) {
        await ctx.db.delete(attempt._id)
        removed++
    }
    await ctx.db.delete(row._id)
    return { complete: true, removed: removed + 1 }
}
async function syncPublishing(
    ctx: MutationCtx,
    attempt: Doc<"publishingAttempts">,
    outcome: "sent" | "failed" | "uncertain",
) {
    if (attempt.consumer?.type === "event") await syncEventPublishing(ctx, attempt, outcome)
    else if (attempt.consumer?.type === "schedule") await syncSchedulePublishing(ctx, attempt, outcome)
    else if (attempt.consumer?.type === "milestone") await syncMilestonePublishing(ctx, attempt, outcome)
    else if (attempt.consumer?.type === "suggestion-card") await syncSuggestionPublishing(ctx, attempt, outcome)
}
export async function releaseConsumerPublication(
    ctx: MutationCtx,
    delivery: Doc<"milestoneDeliveries"> | Doc<"scheduleDeliveries">,
    type: "milestone" | "schedule",
) {
    if (!delivery.attemptId) return
    const attempt = await ctx.db.get(delivery.attemptId)
    if (
        !attempt ||
        attempt.consumer?.type !== type ||
        attempt.consumer.deliveryId !== delivery._id ||
        attempt.outcome === "pending" ||
        attempt.unresolved
    )
        fail(409, `Unresolved ${type} publication preserved`)
    const row = await ctx.db
        .query("publishingPosts")
        .withIndex("by_server_post", (q) => q.eq("serverId", delivery.serverId).eq("postNo", attempt.postNo))
        .unique()
    if (
        !row ||
        row.attemptId !== attempt._id ||
        row.consumer?.type !== type ||
        row.consumer.deliveryId !== delivery._id
    )
        fail(503, `${type[0]!.toUpperCase()}${type.slice(1)} publication unavailable`)
    await protectedPanelPost(ctx, delivery.serverId, row.postNo)
    if (
        await ctx.db
            .query("publishingAttempts")
            .withIndex("by_server_post_unresolved", (q) =>
                q.eq("serverId", row.serverId).eq("postNo", row.postNo).eq("unresolved", true),
            )
            .first()
    )
        fail(409, `Unresolved ${type} publication preserved`)
    await ctx.db.delete(row._id)
    await ctx.db.delete(attempt._id)
}
const configuration = (op: PublishingManageOperation): op is PublishingConfigurationOperation =>
    op.type === "settings" || op.type.startsWith("draft-")
export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<PublishingManageResult> => {
        const input = decode(PublishingManageRequest, request),
            now = Date.now(),
            identity = source(input, now),
            op = input.operation
        const who = await requireAdministrator(
            ctx,
            identity.serverId,
            input.actor,
            op.type === "settings" && op.patch.enabled === false,
        )
        if (!(await reserveSource(ctx, identity.serverId, identity.messageId, now))) return { duplicate: true }
        const current = await state(ctx, identity.serverId)
        if (configuration(op)) {
            return applyPublishingConfiguration(ctx, identity.serverId, op, now)
        }
        if (op.type === "forget") {
            const row = await post(ctx, identity.serverId, op.postNo, op.expectedGeneration)
            if (row.consumer) fail(409, "Tracked post retained by publishing consumer")
            await protectedPanelPost(ctx, identity.serverId, row.postNo)
            if (
                await ctx.db
                    .query("publishingAttempts")
                    .withIndex("by_server_post_unresolved", (q) =>
                        q.eq("serverId", identity.serverId).eq("postNo", row.postNo).eq("unresolved", true),
                    )
                    .first()
            )
                fail(409, "Unresolved tracked post preserved")
            await ctx.db.delete(row._id)
            return { duplicate: false, type: "forgotten", postNo: row.postNo }
        }
        if (op.type === "resolve") {
            const row = await post(ctx, identity.serverId, op.postNo, op.expectedGeneration)
            await protectedPanelPost(ctx, identity.serverId, row.postNo)
            const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
            if (!attempt || attempt.outcome !== "uncertain" || !attempt.unresolved)
                fail(409, "That post has no unknown outcome to resolve, because it is already known", "REFUSED")
            const messageId = op.outcome === "sent" ? op.messageId : undefined
            if (messageId && (attempt.messageId ?? row.messageId ?? messageId) !== messageId)
                fail(409, "Tracked message changed")
            // The bot read the message back, so it must be the bot's own message in the post's channel with the attempt's content
            if (
                op.outcome === "sent" &&
                (op.channelId !== attempt.channelId ||
                    op.botId !== attempt.botId ||
                    !equalPublishingContent(canonicalPublishingContent(op.content), attempt.canonicalContent))
            )
                fail(409, "Publishing observation mismatch")
            await settle(ctx, row, attempt, op.outcome, now, messageId)
            return { duplicate: false, type: "resolved", post: await publicPost(ctx, (await ctx.db.get(row._id))!) }
        }
        const selected = await draft(ctx, identity.serverId, op.kind, op.name, op.expectedRevision)
        const content = publishingContent(selected.content, true)
        if (op.type === "preview") return { duplicate: false, type: "preview", draft: publicDraft(selected) }
        if (!current.enabled) fail(403, "Publishing disabled")
        const { botId, channelId, botAuthorized, actorAuthorized } = op.context
        if (!botAuthorized || !actorAuthorized) fail(403, "Publishing channel permission required")
        const existing =
            op.type === "edit" ? await post(ctx, identity.serverId, op.postNo, op.expectedGeneration) : null
        if (existing) await protectedPanelPost(ctx, identity.serverId, existing.postNo)
        if (existing?.consumer) fail(409, "Tracked post retained by publishing consumer")
        const previousAttempt = existing?.attemptId ? await ctx.db.get(existing.attemptId) : null
        if (
            existing &&
            (previousAttempt?.unresolved !== false || !existing.messageId || !existing.confirmedCanonicalContent)
        )
            fail(409, "Tracked post cannot be edited")
        if (
            channelId !== (existing?.channelId ?? (op.type === "send" ? op.channelId : undefined)) ||
            (existing && botId !== existing.botId)
        )
            fail(409, "Publishing destination changed")
        const reserved = await reservePublishing(ctx, {
            serverId: identity.serverId,
            actorId: who.userId,
            botId,
            channelId,
            sourceId: identity.messageId,
            source: { type: "human", messageId: identity.messageId, createdAt: identity.createdAt },
            provenance: { type: "draft", kind: selected.kind, name: selected.name, revision: selected.revision },
            content,
            draft: { kind: selected.kind, name: selected.name, revision: selected.revision },
            ...(existing ? { existing } : {}),
        })
        return { duplicate: false, type: "post", ...reserved }
    },
})
export const query = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<PublishingQueryResult> => {
        const input = decode(PublishingQueryRequest, request),
            serverId = input.serverId,
            op = input.operation
        await requireAdministrator(
            ctx,
            serverId,
            input.actor,
            op.type === "settings" || op.type === "post-show" || op.type === "post-list",
        )
        if (op.type === "settings") {
            const row = await settings(ctx, serverId)
            return { type: "settings", settings: { enabled: row?.enabled ?? true } }
        }
        if (op.type === "draft-show")
            return { type: "draft", draft: publicDraft(await draft(ctx, serverId, op.kind, op.name)) }
        if (op.type === "draft-list") {
            // Name order with a name cursor, so every draft can be reached however many there are
            const kind = op.kind,
                after = op.afterName
            const rows = await ctx.db
                    .query("publishingDrafts")
                    .withIndex("by_server_kind_name", (q) =>
                        after === undefined
                            ? q.eq("serverId", serverId).eq("kind", kind)
                            : q.eq("serverId", serverId).eq("kind", kind).gt("name", after),
                    )
                    .take(11),
                chosen = rows.slice(0, 10)
            return {
                type: "drafts",
                kind,
                drafts: chosen.map(publicDraft),
                ...(rows.length > 10 ? { nextAfterName: chosen.at(-1)!.name } : {}),
            }
        }
        if (op.type === "post-show")
            return { type: "post", post: await publicPost(ctx, await post(ctx, serverId, op.postNo)) }
        const before = op.beforePostNo ?? Number.MAX_SAFE_INTEGER
        const rows = await ctx.db
                .query("publishingPosts")
                .withIndex("by_server_post", (q) => q.eq("serverId", serverId).lt("postNo", before))
                .order("desc")
                .take(11),
            chosen = rows.slice(0, 10)
        return {
            type: "posts",
            posts: await Promise.all(chosen.map((row) => publicPost(ctx, row))),
            ...(rows.length > 10 ? { nextBeforePostNo: chosen.at(-1)!.postNo } : {}),
        }
    },
})
async function bound(ctx: Read, serverId: string, postNo: number, attemptId: string, generation: number) {
    requireServer(serverId)
    const row = await post(ctx, serverId, postNo, generation)
    const id = ctx.db.normalizeId("publishingAttempts", attemptId),
        attempt = id ? await ctx.db.get(id) : null
    if (
        !attempt ||
        attempt.serverId !== serverId ||
        attempt.postNo !== row.postNo ||
        attempt.generation !== row.generation ||
        row.attemptId !== id
    )
        fail(409, "Publishing attempt changed")
    return { row, attempt }
}
// Every source but a human message names its own work, and only a human message's source ID must be a real message ID
const claimedSourceId = (attempt: Doc<"publishingAttempts">, sourceId: string | undefined) =>
    attempt.source && attempt.source.type !== "human" ? sourceId : requireId(sourceId)
export const dispatch = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<PublishingDispatchResult> => {
        const input = decode(PublishingDispatchRequest, request)
        const { attempt } = await bound(ctx, input.serverId, input.postNo, input.attemptId, input.generation),
            now = Date.now()
        if (attempt.sourceId !== claimedSourceId(attempt, input.sourceId)) fail(409, "Publishing source changed")
        const response = { dispatchExpiresAt: attempt.dispatchExpiresAt, nativeDeadlineMs: attempt.nativeDeadlineMs }
        if (attempt.dispatchedAt !== undefined) return { claimed: false, ...response }
        if (attempt.consumer?.type === "suggestion-card") {
            if (
                input.eventContext !== undefined ||
                input.scheduleContext !== undefined ||
                input.milestoneContext !== undefined
            )
                fail(400, "Unexpected publishing context")
            if (
                attempt.outcome !== "pending" ||
                !(await suggestionPublishingFence(ctx, attempt, input.suggestionContext))
            )
                return { claimed: false, ...response }
        } else if (attempt.consumer?.type === "milestone") {
            if (input.suggestionContext !== undefined) fail(400, "Unexpected suggestion context")
            if (input.eventContext !== undefined || input.scheduleContext !== undefined)
                fail(400, "Unexpected publishing context")
            if (
                attempt.outcome !== "pending" ||
                !(await milestonePublishingFence(ctx, attempt, input.milestoneContext))
            )
                return { claimed: false, ...response }
        } else if (attempt.consumer?.type === "schedule") {
            if (input.suggestionContext !== undefined) fail(400, "Unexpected suggestion context")
            if (input.milestoneContext !== undefined) fail(400, "Unexpected milestone context")
            if (input.eventContext !== undefined) fail(400, "Unexpected event context")
            if (attempt.outcome !== "pending" || !(await schedulePublishingFence(ctx, attempt, input.scheduleContext)))
                return { claimed: false, ...response }
        } else {
            if (input.suggestionContext !== undefined) fail(400, "Unexpected suggestion context")
            if (input.milestoneContext !== undefined) fail(400, "Unexpected milestone context")
            if (input.scheduleContext !== undefined) fail(400, "Unexpected schedule context")
            if (attempt.outcome !== "pending" || now >= attempt.dispatchExpiresAt)
                fail(409, "Publishing dispatch expired")
            if (attempt.consumer?.type === "event") await eventPublishingFence(ctx, attempt, input.eventContext)
            else if (input.eventContext !== undefined) fail(400, "Unexpected event context")
        }
        await ctx.db.patch(attempt._id, { dispatchedAt: now, claimToken: input.claimToken })
        await claimEventPublishing(ctx, attempt, now)
        await claimSchedulePublishing(ctx, attempt, now)
        await claimMilestonePublishing(ctx, attempt, now)
        return { claimed: true, ...response }
    },
})
export const outcome = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<PublishingOutcomeResult> => {
        const input = decode(PublishingOutcomeRequest, request),
            { serverId, messageId, claimToken } = input
        const id = ctx.db.normalizeId("publishingAttempts", input.attemptId),
            attempt = id ? await ctx.db.get(id) : null,
            now = Date.now()
        if (
            !attempt ||
            attempt.serverId !== serverId ||
            attempt.postNo !== input.postNo ||
            attempt.generation !== input.generation
        )
            fail(409, "Publishing attempt changed")
        const row = await ctx.db
            .query("publishingPosts")
            .withIndex("by_server_post", (q) => q.eq("serverId", serverId).eq("postNo", attempt.postNo))
            .unique()
        if (attempt.sourceId !== claimedSourceId(attempt, input.sourceId)) fail(409, "Publishing outcome changed")
        if (
            attempt.dispatchedAt !== undefined
                ? claimToken !== attempt.claimToken
                : claimToken !== undefined || input.outcome !== "failed"
        )
            fail(409, "Publishing dispatch ownership changed")
        if (
            (input.outcome === "sent" && !messageId) ||
            (input.outcome === "failed" && messageId) ||
            (attempt.action === "edit" && messageId && messageId !== attempt.messageId)
        )
            fail(400, "Invalid publishing outcome")
        if (attempt.messageId && messageId && attempt.messageId !== messageId) fail(409, "Tracked message changed")
        const result = input.outcome
        const late = attempt.outcome === "uncertain" && attempt.unresolved && attempt.dispatchedAt !== undefined
        if (attempt.outcome !== "pending" && !late) {
            if (attempt.outcome !== result || (messageId && attempt.messageId !== messageId))
                fail(409, "Publishing outcome already recorded")
            return { recorded: false }
        }
        if (!row || row.attemptId !== attempt._id || row.generation !== attempt.generation)
            fail(409, "Publishing attempt changed")
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
    },
})
async function settle(
    ctx: MutationCtx,
    row: Doc<"publishingPosts">,
    attempt: Doc<"publishingAttempts">,
    result: "sent" | "failed" | "uncertain",
    now: number,
    messageId?: string,
) {
    await ctx.db.patch(attempt._id, {
        outcome: result,
        unresolved: result === "uncertain",
        finishedAt: now,
        ...(messageId ? { messageId } : {}),
        ...(attempt.dispatchedAt === undefined ? { noDispatch: true as const } : {}),
        ...(result !== "uncertain" ? { expiresAt: now + RETENTION } : {}),
    })
    const confirmed = {
        confirmedContent: attempt.content,
        confirmedCanonicalContent: attempt.canonicalContent,
        confirmedDraftRevision: attempt.draftRevision,
    }
    await ctx.db.patch(row._id, {
        outcome: result,
        updatedAt: now,
        ...(messageId ? { messageId } : {}),
        ...(result === "sent" ? confirmed : {}),
    })
    await syncPublishing(ctx, attempt, result)
}
export const reconcile = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<PublishingReconcileResult> => {
        const input = decode(PublishingReconcileRequest, request),
            now = Date.now(),
            identity = source(input, now)
        await requireAdministrator(ctx, identity.serverId, input.actor, true)
        const { row, attempt } = await bound(
            ctx,
            identity.serverId,
            input.postNo,
            input.attemptId,
            input.expectedGeneration,
        )
        if (row.consumer?.type === "suggestion-card")
            fail(409, "Suggestion publication recovery uses its owning consumer")
        if (!(await reserveSource(ctx, identity.serverId, identity.messageId, now)))
            return { recorded: false, post: await publicPost(ctx, row) }
        return reconcilePublishing(ctx, row, attempt, input.observation)
    },
})
export async function reconcilePublishing(
    ctx: MutationCtx,
    row: Doc<"publishingPosts">,
    attempt: Doc<"publishingAttempts">,
    rawObservation: unknown,
): Promise<PublishingReconcileResult> {
    const now = Date.now(),
        value = decode(PublishingObservation, rawObservation)
    const observedAt = integer(value.observedAt, attempt.createdAt, now + 60000)
    fresh(observedAt, now)
    if (
        !row.messageId ||
        row.messageId !== value.messageId ||
        row.channelId !== value.channelId ||
        row.botId !== value.botId
    )
        fail(409, "Publishing observation mismatch")
    if ((attempt.observation?.observedAt ?? -1) >= observedAt)
        return { recorded: false, post: await publicPost(ctx, row) }
    const observation: PublishingObservation = {
        observedAt,
        messageId: row.messageId,
        channelId: row.channelId,
        botId: row.botId,
        content: canonicalPublishingContent(value.content),
    }
    await ctx.db.patch(attempt._id, { observation })
    if (
        (attempt.outcome === "uncertain" ||
            (attempt.consumer?.type === "suggestion-card" &&
                attempt.outcome === "failed" &&
                attempt.dispatchedAt !== undefined)) &&
        dispatchClosed(attempt, now) &&
        dispatchClosed(attempt, observedAt)
    ) {
        const intended = equalPublishingContent(observation.content, attempt.canonicalContent)
        const previous =
            row.confirmedCanonicalContent && equalPublishingContent(observation.content, row.confirmedCanonicalContent)
        if (intended || previous) {
            const resolution = {
                attemptId: attempt._id,
                generation: attempt.generation,
                sourceId: attempt.sourceId,
                observedAt,
                matched: intended ? ("intended" as const) : ("previous" as const),
            }
            await ctx.db.patch(attempt._id, { unresolved: false, resolution, expiresAt: now + RETENTION })
            if (intended)
                await ctx.db.patch(row._id, {
                    confirmedContent: attempt.content,
                    confirmedCanonicalContent: attempt.canonicalContent,
                    confirmedDraftRevision: attempt.draftRevision,
                    updatedAt: now,
                })
        } else if (attempt.resolution)
            await ctx.db.patch(attempt._id, { unresolved: true, resolution: undefined, expiresAt: undefined })
    }
    return { recorded: true, post: await publicPost(ctx, (await ctx.db.get(row._id))!) }
}
export async function age(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, now: number) {
    if (attempt.outcome !== "pending" || !dispatchClosed(attempt, now)) return false
    const outcome = attempt.dispatchedAt === undefined ? "failed" : "uncertain"
    await ctx.db.patch(attempt._id, {
        outcome,
        unresolved: outcome === "uncertain",
        ...(outcome === "failed" ? { noDispatch: true as const, finishedAt: now, expiresAt: now + RETENTION } : {}),
    })
    const row = await ctx.db
        .query("publishingPosts")
        .withIndex("by_server_post", (q) => q.eq("serverId", attempt.serverId).eq("postNo", attempt.postNo))
        .unique()
    if (row?.attemptId === attempt._id) await ctx.db.patch(row._id, { outcome, updatedAt: now })
    await syncPublishing(ctx, attempt, outcome)
    return outcome === "uncertain"
}
export const observe = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<PublishingObserveResult> => {
        const input = decode(PublishingObserveRequest, request),
            serverId = input.serverId
        const now = Date.now(),
            before = now - NATIVE_DEADLINE - DISPATCH_MARGIN
        const rows = await ctx.db
            .query("publishingAttempts")
            .withIndex("by_pending_deadline", (q) =>
                q.eq("serverId", serverId).eq("outcome", "pending").lte("dispatchExpiresAt", before),
            )
            .take(PUBLISHING_BATCH)
        let uncertainAttempts = 0
        for (const attempt of rows) if (await age(ctx, attempt, now)) uncertainAttempts++
        if (rows.length === PUBLISHING_BATCH)
            await ctx.scheduler.runAfter(0, internal.publishing.observe, { request: input })
        return { uncertainAttempts }
    },
})
export async function cleanupPublishing(ctx: MutationCtx, now: number) {
    let removed = 0
    let continuation = false
    const pending = await ctx.db
        .query("publishingAttempts")
        .withIndex("by_global_pending_deadline", (q) =>
            q.eq("outcome", "pending").lte("dispatchExpiresAt", now - NATIVE_DEADLINE - DISPATCH_MARGIN),
        )
        .take(PUBLISHING_BATCH)
    for (const attempt of pending) await age(ctx, attempt, now)
    continuation ||= pending.length === PUBLISHING_BATCH
    const receipts = await ctx.db
        .query("publishingReceipts")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(PUBLISHING_BATCH)
    for (const row of receipts) {
        await ctx.db.delete(row._id)
        removed++
    }
    continuation ||= receipts.length === PUBLISHING_BATCH
    const attempts = await ctx.db
        .query("publishingAttempts")
        .withIndex("by_expiry", (q) => q.gt("expiresAt", 0).lte("expiresAt", now))
        .take(PUBLISHING_BATCH)
    for (const attempt of attempts) {
        if (attempt.unresolved) continue
        const row = await ctx.db
            .query("publishingPosts")
            .withIndex("by_server_post", (q) => q.eq("serverId", attempt.serverId).eq("postNo", attempt.postNo))
            .unique()
        if (row?.attemptId === attempt._id) {
            await ctx.db.patch(attempt._id, { expiresAt: now + PUBLISHING_DAY })
            continue
        }
        await ctx.db.delete(attempt._id)
        removed++
    }
    continuation ||= attempts.length === PUBLISHING_BATCH
    return { removed, more: continuation }
}

async function applyPublishingConfiguration(
    ctx: MutationCtx,
    serverId: string,
    value: unknown,
    now: number,
): Promise<PublishingManageResult> {
    const op = decode(PublishingConfigurationOperation, value),
        current = await state(ctx, serverId)
    if (op.type === "settings") {
        const enabled = op.patch.enabled
        await ctx.db.patch(current._id, {
            ...(enabled !== undefined ? { enabled } : {}),
            ...(enabled === true && !current.enabled ? { activatedAt: now } : {}),
        })
        // Event reminders that came due while publishing was off are listed again only from now on, so the bot hears of them at once
        if (enabled === true && !current.enabled) await ringWork(ctx)
        const next = (await ctx.db.get(current._id))!
        return { duplicate: false, type: "settings", settings: { enabled: next.enabled } }
    }
    if (op.type === "draft-create" || op.type === "draft-clone") {
        const from =
            op.type === "draft-clone" ? await draft(ctx, serverId, op.kind, op.name, op.expectedRevision) : null
        const kind = op.type === "draft-clone" ? op.toKind : op.kind,
            name = publishingName(op.type === "draft-clone" ? op.toName : op.name)
        if (
            await ctx.db
                .query("publishingDrafts")
                .withIndex("by_server_kind_name", (q) => q.eq("serverId", serverId).eq("kind", kind).eq("name", name))
                .unique()
        )
            fail(409, "A draft or template with that name already exists. Choose another name", "REFUSED")
        const content = from?.content ?? ((op.type === "draft-create" && op.content) || { content: "" }),
            canonicalContent = canonicalPublishingContent(content)
        const id = await ctx.db.insert("publishingDrafts", {
            serverId,
            kind,
            name,
            revision: 1,
            content,
            canonicalContent,
            createdAt: now,
            updatedAt: now,
        })
        return { duplicate: false, type: "draft", draft: publicDraft((await ctx.db.get(id))!) }
    }
    const selected = await draft(ctx, serverId, op.kind, op.name, op.expectedRevision)
    if (op.type === "draft-delete") {
        await ctx.db.delete(selected._id)
        return { duplicate: false, type: "deleted", kind: selected.kind, name: selected.name }
    }
    const content = op.type === "draft-set" ? op.content : editPublishingContent(selected.content, op.edit)
    await ctx.db.patch(selected._id, {
        revision: integer(selected.revision + 1, 1, Number.MAX_SAFE_INTEGER),
        content,
        canonicalContent: canonicalPublishingContent(content),
        updatedAt: now,
    })
    return { duplicate: false, type: "draft", draft: publicDraft((await ctx.db.get(selected._id))!) }
}
