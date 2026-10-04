import type { MilestonesContext, MilestonesDelivery, MilestonesDeliveryBinding, MilestonesDeliveryReason, MilestonesDeliveryState, MilestonesEnrollment, MilestonesParticipantContext, MilestonesRoute } from "../contracts.js"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { canonicalPublishingContent } from "./publishingDomain.ts"
import { advanceMilestone, milestoneAnnual, milestoneBinding, milestoneDeliveryContext, milestoneLocalParts, MILESTONES_DAY } from "./milestonesDomain.ts"
import { publisherSettings, scheduleAutomation } from "./schedulesStore.ts"
import { fail } from "./validation.ts"
import { civilDayEnded } from "./civilDomain.ts"
import { eventAdmin, eventEligible } from "./publishingContext.ts"

export type MilestonesRead = MutationCtx | QueryCtx
export const milestoneSettings = (ctx: MilestonesRead, serverId: string) => ctx.db.query("milestoneSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
export const milestoneRoute = (ctx: MilestonesRead, serverId: string, kind: "birthday" | "anniversary") => ctx.db.query("milestoneRoutes").withIndex("by_kind", q => q.eq("serverId", serverId).eq("kind", kind)).unique()
export const milestoneEnrollment = (ctx: MilestonesRead, serverId: string, userId: string, kind: "birthday" | "anniversary") => ctx.db.query("milestoneEnrollments").withIndex("by_user_kind", q => q.eq("serverId", serverId).eq("userId", userId).eq("kind", kind)).unique()
export async function milestoneState(ctx: MutationCtx, serverId: string) {
    const old = await milestoneSettings(ctx, serverId)
    if (old) return old
    const id = await ctx.db.insert("milestoneSettings", { serverId, enabled: false, revision: 1, activatedAt: 0, accounts: 0, enrollments: 0, deliveries: 0, staffReceipts: 0, memberReceipts: 0 })
    return (await ctx.db.get(id))!
}
export async function milestoneCount(ctx: MutationCtx, serverId: string, key: "accounts" | "enrollments" | "deliveries" | "staffReceipts" | "memberReceipts", delta: number) {
    const row = await milestoneState(ctx, serverId), cap = { accounts: 1000, enrollments: 2000, deliveries: 4000, staffReceipts: 1000, memberReceipts: 10000 }[key]
    if (row[key] + delta > cap) fail(429, "Milestone capacity reached")
    if (row[key] + delta < 0) fail(503, "Milestone accounting unavailable")
    await ctx.db.patch(row._id, { [key]: row[key] + delta })
}
export function publicMilestoneRoute(row: Doc<"milestoneRoutes">): MilestonesRoute {
    const { _id, _creationTime, serverId, configured, ...value } = row
    return { ...value, canonicalContent: canonicalPublishingContent(value.canonicalContent) }
}
export function publicMilestoneEnrollment(row: Doc<"milestoneEnrollments">, route: Doc<"milestoneRoutes"> | null): MilestonesEnrollment {
    return { kind: row.kind, revision: row.revision, joinedAt: row.joinedAt, audienceGeneration: row.audienceGeneration, channelId: row.channelId, consentedAt: row.consentedAt, ...(row.monthDay ? { monthDay: row.monthDay } : {}), needsReconsent: !route?.configured || row.audienceGeneration !== route.audienceGeneration || row.channelId !== route.channelId }
}
export function deliveryBinding(row: Doc<"milestoneDeliveries">): MilestonesDeliveryBinding {
    return { deliveryId: row._id, kind: row.kind, intentRevision: row.intentRevision, userId: row.userId, joinedAt: row.joinedAt, consentRevision: row.consentRevision, audienceGeneration: row.audienceGeneration, celebrationYear: row.celebrationYear, completedYears: row.completedYears, generation: row.generation }
}
export function publicMilestoneDelivery(row: Doc<"milestoneDeliveries">): MilestonesDelivery {
    return { ...deliveryBinding(row), channelId: row.channelId, zone: row.zone, dueAt: row.dueAt, offsetMinutes: row.offsetMinutes, state: row.state, nextCheckAt: row.nextCheckAt, ...(row.claimedAt !== undefined ? { claimedAt: row.claimedAt } : {}), ...(row.postNo !== undefined ? { postNo: row.postNo } : {}), ...(row.attemptId ? { attemptId: row.attemptId } : {}), ...(row.reason ? { reason: row.reason } : {}) }
}
export async function boundMilestoneDelivery(ctx: MilestonesRead, serverId: string, binding: MilestonesDeliveryBinding) {
    const id = ctx.db.normalizeId("milestoneDeliveries", binding.deliveryId), row = id ? await ctx.db.get(id) : null
    if (!row || row.serverId !== serverId || Object.entries(deliveryBinding(row)).some(([key, value]) => binding[key as keyof MilestonesDeliveryBinding] !== value)) fail(409, "Milestone delivery binding changed")
    return row
}
export async function milestoneParticipantEligible(ctx: MilestonesRead, serverId: string, participant: MilestonesParticipantContext, channelId: string, userId: string) {
    // Member eligibility is independent from the owner/admin actor proof
    return eventEligible(ctx, serverId, { observedAt: participant.observedAt, actor: { userId, roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: false }, channelId: participant.channelId, botId: participant.botId, botAuthorized: true, actorAuthorized: false, member: participant.member }, channelId, userId)
}
export async function milestoneAdmin(ctx: MilestonesRead, serverId: string, context: MilestonesContext, critical = false) {
    if (!context.member || context.member.isBot || context.member.userId !== context.actor.userId || context.actor.userId === context.botId) fail(403, "Actual current human administrator required")
    await eventAdmin(ctx, serverId, context, critical)
}
export async function milestoneReceipt(ctx: MutationCtx, identity: { serverId: string, messageId: string, createdAt: number }, actorId: string, category: "staff" | "member", operation: unknown, channelId?: string, removal = false) {
    const old = await ctx.db.query("milestoneReceipts").withIndex("by_source", q => q.eq("serverId", identity.serverId).eq("messageId", identity.messageId)).unique()
    const keyMaterial = process.env.NEONFLUX_BOT_API_SECRET
    if (!keyMaterial) fail(503, "Milestone source binding unavailable")
    const encoder = new TextEncoder(), key = await crypto.subtle.importKey("raw", encoder.encode(keyMaterial), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(JSON.stringify({ identity, actorId, category, channelId, operation })))
    const operationKey = Array.from(new Uint8Array(signed), byte => byte.toString(16).padStart(2, "0")).join("")
    if (old) {
        if (old.actorId !== actorId || old.category !== category || old.channelId !== channelId || old.createdAt !== identity.createdAt || old.operationKey !== operationKey) fail(409, "Milestone source binding changed")
        return false
    }
    if (!removal) await milestoneCount(ctx, identity.serverId, category === "staff" ? "staffReceipts" : "memberReceipts", 1)
    await ctx.db.insert("milestoneReceipts", { ...identity, actorId, category, operationKey, ...(channelId ? { channelId } : {}), ...(!removal ? { receiptExpiresAt: Date.now() + MILESTONES_DAY } : {}), expiresAt: Date.now() + (category === "member" ? 400 : 1) * MILESTONES_DAY })
    return true
}
export async function milestoneConsumed(ctx: MilestonesRead, row: { serverId: string, userId: string, kind: "birthday" | "anniversary", joinedAt: string, celebrationYear: number, completedYears: number }) {
    return ctx.db.query("milestoneConsumed").withIndex("by_binding", q => q.eq("serverId", row.serverId).eq("userId", row.userId).eq("kind", row.kind).eq("epoch", row.kind === "birthday" ? "" : row.joinedAt).eq("year", row.kind === "birthday" ? row.celebrationYear : row.completedYears)).unique()
}
export async function consumeMilestone(ctx: MutationCtx, row: Doc<"milestoneDeliveries">) {
    if (!await milestoneConsumed(ctx, row)) await ctx.db.insert("milestoneConsumed", { serverId: row.serverId, userId: row.userId, kind: row.kind, epoch: row.kind === "birthday" ? "" : row.joinedAt, year: row.kind === "birthday" ? row.celebrationYear : row.completedYears, createdAt: Date.now(), expiresAt: Date.now() + 400 * MILESTONES_DAY })
}
export async function closeMilestoneDelivery(ctx: MutationCtx, row: Doc<"milestoneDeliveries">, state: MilestonesDeliveryState, reason: MilestonesDeliveryReason) {
    if (!row.active || row.claimedAt !== undefined) return false
    const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null, now = Date.now()
    if (attempt && (attempt.dispatchedAt !== undefined || attempt.outcome !== "pending")) return false
    if (attempt) {
        if (attempt.consumer?.type !== "milestone" || attempt.consumer.deliveryId !== row._id) fail(503, "Milestone ownership unavailable")
        const post = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", row.serverId).eq("postNo", attempt.postNo)).unique()
        if (!post || post.attemptId !== attempt._id) fail(503, "Milestone post unavailable")
        await ctx.db.patch(attempt._id, { outcome: "failed", noDispatch: true, unresolved: false, finishedAt: now, expiresAt: now + 30 * MILESTONES_DAY })
        await ctx.db.patch(post._id, { outcome: "failed", updatedAt: now })
    }
    await ctx.db.patch(row._id, { state, reason, active: false, historyExpiresAt: now + 30 * MILESTONES_DAY })
    return true
}
export async function removeMilestoneEnrollment(ctx: MutationCtx, row: Doc<"milestoneEnrollments">, reason: "consent" | "membership" = "consent") {
    if (row.deliveryId) { const delivery = await ctx.db.get(row.deliveryId); if (delivery) await closeMilestoneDelivery(ctx, delivery, "cancelled", reason) }
    await ctx.db.delete(row._id)
    await milestoneCount(ctx, row.serverId, "enrollments", -1)
    if (!await ctx.db.query("milestoneEnrollments").withIndex("by_user_kind", q => q.eq("serverId", row.serverId).eq("userId", row.userId)).first()) await milestoneCount(ctx, row.serverId, "accounts", -1)
}
export async function milestoneAvailability(ctx: MilestonesRead, row: Doc<"milestoneDeliveries">) {
    const route = await milestoneRoute(ctx, row.serverId, row.kind), enrollment = await milestoneEnrollment(ctx, row.serverId, row.userId, row.kind), module = await milestoneSettings(ctx, row.serverId), publisher = await publisherSettings(ctx, row.serverId)
    const consent = !!route?.configured && !!enrollment && enrollment.revision === row.consentRevision && enrollment.joinedAt === row.joinedAt && enrollment.audienceGeneration === route.audienceGeneration && row.audienceGeneration === route.audienceGeneration && enrollment.channelId === route.channelId
    const replaced = !!route && route.intentRevision !== row.intentRevision && row.dueAt > route.updatedAt
    return { consent, replaced, route, enrollment, enabled: !!route?.configured && route.enabled && !!module?.enabled && (publisher?.enabled ?? true), cutoff: Math.max(route?.activatedAt ?? 0, module?.activatedAt ?? 0, publisher?.activatedAt ?? 0) }
}
export async function availableMilestone(ctx: MutationCtx, row: Doc<"milestoneDeliveries">) {
    const now = Date.now()
    if (!row.active || row.claimedAt !== undefined) return "terminal" as const
    const gate = await milestoneAvailability(ctx, row)
    if (!gate.consent) { await closeMilestoneDelivery(ctx, row, "cancelled", "consent"); return "cancelled" as const }
    if (gate.replaced) { await closeMilestoneDelivery(ctx, row, "superseded", "superseded"); return "cancelled" as const }
    if (row.dueAt <= gate.cutoff) { await closeMilestoneDelivery(ctx, row, "skipped", "activation-cutoff"); return "skipped" as const }
    if (civilDayEnded(row.dueAt, row.zone, now)) { await closeMilestoneDelivery(ctx, row, "skipped", "late-window"); return "skipped" as const }
    return gate.enabled && now >= row.dueAt ? "ready" as const : "waiting" as const
}
// Enrollments wait for their next due time, so a route intent change re-arms them now
export async function rearmMilestones(ctx: MutationCtx, serverId: string, kind: "birthday" | "anniversary", now: number) {
    const waiting = await ctx.db.query("milestoneEnrollments").withIndex("by_discovery", q => q.eq("serverId", serverId).gt("nextCheckAt", now)).take(2000)
    for (const enrollment of waiting) if (enrollment.kind === kind) await ctx.db.patch(enrollment._id, { nextCheckAt: now })
}
export async function progressMilestone(ctx: MutationCtx, enrollment: Doc<"milestoneEnrollments">) {
    const route = await milestoneRoute(ctx, enrollment.serverId, enrollment.kind), now = Date.now()
    let frozen: Doc<"milestoneDeliveries"> | undefined
    if (enrollment.deliveryId) {
        let old = await ctx.db.get(enrollment.deliveryId)
        if (old) { await availableMilestone(ctx, old); old = await ctx.db.get(old._id) }
        if (old?.active) {
            const nextCheckAt = old.dueAt <= now ? now + 60000 : old.dueAt
            await ctx.db.patch(enrollment._id, { nextCheckAt })
            await ctx.db.patch(old._id, { nextCheckAt })
            return { ...old, nextCheckAt }
        }
        if (old && old.state !== "superseded" && old.state !== "cancelled") enrollment = { ...enrollment, nextYear: Math.max(enrollment.nextYear, old.celebrationYear + 1) }
        if (old?.state === "superseded" && route && old.zone === route.zone && old.time === route.time && old.fold === route.fold && old.dueAt > route.updatedAt) frozen = old
    }
    if (!route?.configured || enrollment.audienceGeneration !== route.audienceGeneration || enrollment.channelId !== route.channelId) {
        // Only explicit reconsent, which re-arms discovery, can make this enrollment deliverable again
        await ctx.db.patch(enrollment._id, { nextCheckAt: now + MILESTONES_DAY, deliveryId: undefined })
        return null
    }
    const year = frozen?.celebrationYear ?? Math.max(enrollment.nextYear, milestoneLocalParts(now, route.zone).year)
    const annual = frozen ? { celebrationYear: frozen.celebrationYear, completedYears: frozen.completedYears, instantAt: frozen.dueAt, offsetMinutes: frozen.offsetMinutes, reason: undefined } : milestoneAnnual(enrollment.kind, enrollment.joinedAt, enrollment.monthDay, route, year)
    if (annual.completedYears < (enrollment.kind === "anniversary" ? 1 : 0)) { await ctx.db.patch(enrollment._id, { nextYear: year + 1, nextCheckAt: now + 60000, deliveryId: undefined }); return null }
    const seen = await milestoneConsumed(ctx, { ...enrollment, ...annual })
    if (seen) { await ctx.db.patch(enrollment._id, { nextYear: year + 1, nextCheckAt: now + 60000, deliveryId: undefined }); return null }
    const state = await milestoneState(ctx, enrollment.serverId)
    if (state.deliveries >= 4000) { await ctx.db.patch(enrollment._id, { nextCheckAt: now + 60000, deliveryId: undefined }); return null }
    await milestoneCount(ctx, enrollment.serverId, "deliveries", 1)
    const generation = advanceMilestone(enrollment.generation)
    const id = await ctx.db.insert("milestoneDeliveries", { serverId: enrollment.serverId, kind: enrollment.kind, intentRevision: route.intentRevision, userId: enrollment.userId, joinedAt: enrollment.joinedAt, consentRevision: enrollment.revision, audienceGeneration: enrollment.audienceGeneration, celebrationYear: annual.celebrationYear, completedYears: annual.completedYears, generation, channelId: route.channelId, zone: route.zone, time: route.time, fold: route.fold, dueAt: annual.instantAt, offsetMinutes: annual.offsetMinutes, template: route.template, content: route.content, active: true, state: "queued", nextCheckAt: annual.instantAt, createdAt: now })
    let row = (await ctx.db.get(id))!
    if (annual.reason || annual.instantAt <= Math.max(enrollment.consentedAt, route.updatedAt)) { await closeMilestoneDelivery(ctx, row, "skipped", annual.reason ?? "activation-cutoff"); row = (await ctx.db.get(id))! }
    const nextCheckAt = row.active && row.dueAt > now ? row.dueAt : now + 60000
    await ctx.db.patch(enrollment._id, { generation, deliveryId: id, nextYear: row.active ? year : year + 1, nextCheckAt })
    return row
}
export async function milestonePublishingFence(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, value: unknown) {
    if (attempt.consumer?.type !== "milestone" || attempt.source?.type !== "milestone-timer" || attempt.provenance?.type !== "milestone") fail(409, "Milestone consumer missing")
    const row = await boundMilestoneDelivery(ctx, attempt.serverId, milestoneBinding(attempt.consumer)), now = Date.now()
    if (row.attemptId !== attempt._id || row.postNo !== attempt.postNo || attempt.actorId !== attempt.botId || row.channelId !== attempt.channelId || row.dueAt !== attempt.source.dueAt || attempt.source.deliveryId !== row._id || attempt.provenance.kind !== row.kind || attempt.provenance.intentRevision !== row.intentRevision || JSON.stringify(attempt.provenance.template) !== JSON.stringify(row.template)) fail(409, "Milestone publication binding changed")
    if (await availableMilestone(ctx, row) !== "ready") return false
    if (now >= attempt.dispatchExpiresAt) { await closeMilestoneDelivery(ctx, row, "skipped", "dispatch-expired"); return false }
    const context = milestoneDeliveryContext(value)
    if (context.automation.botId !== attempt.botId || context.participant.botId !== attempt.botId) fail(403, "Milestone bot changed")
    if (context.participant.member.userId !== row.userId || context.participant.channelId !== row.channelId) fail(403, "Milestone participant changed")
    if (context.participant.member.joinedAt !== row.joinedAt) {
        const enrollment = await milestoneEnrollment(ctx, row.serverId, row.userId, row.kind)
        if (enrollment?.revision === row.consentRevision && context.participant.observedAt >= Math.max(enrollment.consentedAt, enrollment.observedAt)) await removeMilestoneEnrollment(ctx, enrollment, "membership")
        return false
    }
    await scheduleAutomation(ctx, row.serverId, context.automation, row.channelId)
    const member = await milestoneParticipantEligible(ctx, row.serverId, context.participant, row.channelId, row.userId)
    if (member.joinedAt !== row.joinedAt) fail(403, "Milestone membership changed")
    return true
}
export async function claimMilestonePublishing(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, now: number) {
    if (attempt.consumer?.type !== "milestone") return
    const row = await boundMilestoneDelivery(ctx, attempt.serverId, milestoneBinding(attempt.consumer))
    if (row.attemptId !== attempt._id) fail(409, "Milestone attempt changed")
    await consumeMilestone(ctx, row)
    await ctx.db.patch(row._id, { claimedAt: now, active: false })
    const enrollment = await milestoneEnrollment(ctx, row.serverId, row.userId, row.kind)
    if (enrollment?.revision === row.consentRevision && enrollment.deliveryId === row._id) await ctx.db.patch(enrollment._id, { nextYear: row.celebrationYear + 1, nextCheckAt: now })
}
export async function syncMilestonePublishing(ctx: MutationCtx, attempt: Doc<"publishingAttempts">, outcome: "sent" | "failed" | "uncertain") {
    if (attempt.consumer?.type !== "milestone") return
    const row = await boundMilestoneDelivery(ctx, attempt.serverId, milestoneBinding(attempt.consumer))
    if (row.attemptId !== attempt._id) fail(409, "Milestone attempt changed")
    if (!row.active && row.claimedAt === undefined && row.reason) return
    await ctx.db.patch(row._id, { state: outcome, active: false, historyExpiresAt: Date.now() + 30 * MILESTONES_DAY })
}
