import type { MutationCtx } from "./_generated/server.js"
import { configurationSourceId, type ConfigurationIdentity } from "./configurationRevision.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { v } from "convex/values"
import { MilestonesManageOperation, MilestonesManageRequest, MilestonesPersonalRequest, MilestonesQueryRequest, type MilestonesContext, type MilestonesManageResult, type MilestonesParticipantContext,
    type MilestonesPersonalResult, type MilestonesQueryResult } from "@neonflux/contracts/milestones"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { epochOrder } from "./eventsDomain.ts"
import { publishingName } from "./publishingDomain.ts"
import { milestoneCivil, milestoneLocalParts, milestoneParticipant, advanceMilestone, renderMilestone, validateMilestoneTemplate, MILESTONES_DAY } from "./milestonesDomain.ts"
import { boundMilestoneDelivery, milestoneAdmin, milestoneCount, milestoneEnrollment, milestoneParticipantEligible, milestoneReceipt, milestoneRoute, milestoneSettings, milestoneState, progressMilestone, publicMilestoneDelivery, publicMilestoneEnrollment, publicMilestoneRoute, rearmMilestones, removeMilestoneEnrollment } from "./milestonesStore.ts"
import { publisherSettings, scheduleSnapshot } from "./schedulesStore.ts"
import { reconcilePublishing, releaseMilestonePublication } from "./publishing.ts"
import { recentObservation } from "./schedulesDomain.ts"
import { decode, fail, requireServer, source } from "./validation.ts"
import { eventContext } from "./publishingContext.ts"

const settings = (row: { enabled: boolean, revision: number, activatedAt: number } | null) => ({ enabled: row?.enabled ?? false, revision: row?.revision ?? 1, activatedAt: row?.activatedAt ?? 0 })
export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<MilestonesManageResult> => {
    const input = decode(MilestonesManageRequest, request)
    const identity = source(input, Date.now()), context = eventContext(input.context), op = input.operation, now = Date.now()
    await milestoneAdmin(ctx, identity.serverId, context, ["disable", "clear", "reconcile", "forget"].includes(op.type) || op.type === "settings" && op.enabled === false)
    if (!await milestoneReceipt(ctx, identity, context.actor.userId, "staff", op)) return { duplicate: true }
    const apply = () => applyMilestonesManagement(ctx, { serverId: identity.serverId, actorId: context.actor.userId, createdAt: identity.createdAt, source: { kind: "chat", messageId: identity.messageId } }, context, op, now)
    if (op.type === "reconcile" || op.type === "forget") return apply()
    return changeConfiguration(ctx, identity.serverId, "milestones", { kind: "chat", createdAt: identity.createdAt, actor: { userId: context.actor.userId, source: "command" }, operation: op }, apply)
} })
export const query = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<MilestonesQueryResult> => {
    const { serverId, context, operation: op } = decode(MilestonesQueryRequest, request)
    requireServer(serverId)
    await milestoneAdmin(ctx, serverId, eventContext(context), true)
    const current = await milestoneSettings(ctx, serverId), routes = (await ctx.db.query("milestoneRoutes").withIndex("by_kind", q => q.eq("serverId", serverId)).take(2)).filter(r => r.configured).map(publicMilestoneRoute)
    if (op.type === "settings" || op.type === "status") {
        if (op.type === "settings") return { type: "settings", settings: settings(current), routes }
        const publishing = await publisherSettings(ctx, serverId)
        return { type: "status", settings: settings(current), routes, accounts: current?.accounts ?? 0, enrollments: current?.enrollments ?? 0, deliveries: current?.deliveries ?? 0, staffReceipts: current?.staffReceipts ?? 0, memberReceipts: current?.memberReceipts ?? 0, publishing: { enabled: publishing?.enabled ?? true }, limits: { accounts: 1000, slotsPerAccount: 2, deliveries: 4000, staffReceipts: 1000, memberReceipts: 10000 } }
    }
    if (op.type === "preview") {
        const kind = op.kind, route = routes.find(r => r.kind === kind)
        if (!route) fail(404, "Milestone route not configured")
        return { type: "preview", route, content: renderMilestone(route.content, kind, "Example member", "Example server", 1) }
    }
    if (op.type !== "deliveries") fail(400, "Invalid milestone query")
    // Chat shows 10 celebrations per page
    const kind = op.kind, page = await ctx.db.query("milestoneDeliveries").withIndex("by_route", q => q.eq("serverId", serverId).eq("kind", kind)).paginate({ cursor: op.cursor ?? null, numItems: 10 })
    return { type: "deliveries", deliveries: page.page.map(publicMilestoneDelivery), ...(!page.isDone ? { nextCursor: page.continueCursor } : {}) }
} })
export const personal = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<MilestonesPersonalResult> => {
    const input = decode(MilestonesPersonalRequest, request), identity = source(input, Date.now()), dm = input.identity, op = input.operation, now = Date.now()
    recentObservation(dm.observedAt, now)
    if (op.type === "me") {
        const rows = await ctx.db.query("milestoneEnrollments").withIndex("by_user_kind", q => q.eq("serverId", identity.serverId).eq("userId", dm.userId)).take(2), routes = await ctx.db.query("milestoneRoutes").withIndex("by_kind", q => q.eq("serverId", identity.serverId)).take(2)
        return { duplicate: false, type: "me", enrollments: rows.map(row => publicMilestoneEnrollment(row, routes.find(route => route.kind === row.kind) ?? null)), routes: routes.filter(r => r.configured).map(publicMilestoneRoute) }
    }
    const kind = op.kind
    let participant: MilestonesParticipantContext | undefined, monthDay: string | undefined
    if (op.type === "enroll") {
        monthDay = op.kind === "birthday" ? op.monthDay : undefined
        participant = milestoneParticipant(op.participant)
        if (participant.member.userId !== dm.userId || participant.member.isBot) fail(403, "DM author membership required")
        const route = await milestoneRoute(ctx, identity.serverId, op.kind)
        if (!route?.configured) fail(404, "Milestone route not configured")
        if (op.confirmChannelId !== route.channelId || participant.channelId !== route.channelId) fail(409, "Explicit current destination consent required")
        await milestoneParticipantEligible(ctx, identity.serverId, participant, route.channelId, dm.userId)
    }
    // Do not retain sensitive raw enrollment operations or names in source receipts
    const binding = op.type === "enroll" ? { type: op.type, kind, monthDay, confirmChannelId: op.confirmChannelId, joinedAt: participant!.member.joinedAt } : { type: op.type, kind }
    if (!await milestoneReceipt(ctx, identity, dm.userId, "member", binding, dm.channelId, op.type === "remove")) return { duplicate: true }
    const member = await ctx.db.query("milestoneMembers").withIndex("by_user", q => q.eq("serverId", identity.serverId).eq("userId", dm.userId)).unique()
    if (member && (identity.createdAt < member.acceptedCreatedAt || identity.createdAt === member.acceptedCreatedAt && BigInt(identity.messageId) <= BigInt(member.acceptedMessageId))) fail(409, "Milestone member command superseded")
    const revision = member ? advanceMilestone(member.revision) : 1, memberFields = { revision, acceptedCreatedAt: identity.createdAt, acceptedMessageId: identity.messageId, expiresAt: now + 400 * MILESTONES_DAY }
    if (member) await ctx.db.patch(member._id, memberFields)
    else await ctx.db.insert("milestoneMembers", { serverId: identity.serverId, userId: dm.userId, ...memberFields })
    const rows = await ctx.db.query("milestoneEnrollments").withIndex("by_user_kind", q => q.eq("serverId", identity.serverId).eq("userId", dm.userId)).take(2)
    if (op.type === "remove") {
        const selected = rows.filter(row => kind === "all" || row.kind === kind)
        for (const row of selected) await removeMilestoneEnrollment(ctx, row)
        return { duplicate: false, type: "removed", removed: selected.length }
    }
    const selectedKind = op.kind, route = (await milestoneRoute(ctx, identity.serverId, selectedKind))!, old = rows.find(row => row.kind === selectedKind)
    if (old && (participant!.observedAt < old.observedAt || epochOrder(participant!.member.joinedAt) < epochOrder(old.joinedAt))) fail(409, "Milestone membership observation superseded")
    if (old) await removeMilestoneEnrollment(ctx, old)
    const currentRows = await ctx.db.query("milestoneEnrollments").withIndex("by_user_kind", q => q.eq("serverId", identity.serverId).eq("userId", dm.userId)).first()
    if (!currentRows) await milestoneCount(ctx, identity.serverId, "accounts", 1)
    await milestoneCount(ctx, identity.serverId, "enrollments", 1)
    const id = await ctx.db.insert("milestoneEnrollments", { serverId: identity.serverId, userId: dm.userId, kind: selectedKind, revision, joinedAt: participant!.member.joinedAt, audienceGeneration: route.audienceGeneration, channelId: route.channelId, consentedAt: now, observedAt: participant!.observedAt, ...(monthDay ? { monthDay } : {}), nextYear: milestoneLocalParts(now, route.zone).year, generation: 0, nextCheckAt: now })
    await progressMilestone(ctx, (await ctx.db.get(id))!)
    return { duplicate: false, type: "enrollment", enrollment: publicMilestoneEnrollment((await ctx.db.get(id))!, route) }
} })

// Dashboard jobs pass their stored operation, so it is decoded here as well
export async function applyMilestonesManagement(ctx: MutationCtx, identity: ConfigurationIdentity, context: MilestonesContext | undefined, value: unknown, now: number): Promise<MilestonesManageResult> {
    const op = decode(MilestonesManageOperation, value)
    if (op.type === "settings") {
        const current = await milestoneState(ctx, identity.serverId), enabled = op.enabled
        if (op.expectedRevision !== current.revision) fail(409, "Milestone settings changed")
        await ctx.db.patch(current._id, { enabled, revision: advanceMilestone(current.revision), ...(enabled && !current.enabled ? { activatedAt: now } : {}) })
        return { duplicate: false, type: "settings", settings: settings((await ctx.db.get(current._id))!) }
    }
    if (op.type === "forget" || op.type === "reconcile") {
        const row = await boundMilestoneDelivery(ctx, identity.serverId, op.binding)
        if (op.type === "forget") {
            if (row.active) fail(409, "Pending milestone preserved")
            await releaseMilestonePublication(ctx, row)
            await ctx.db.delete(row._id); await milestoneCount(ctx, row.serverId, "deliveries", -1)
            return { duplicate: false, type: "forgotten", removed: 1 }
        }
        const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
        if (!attempt || attempt._id !== op.attemptId || attempt.generation !== op.expectedGeneration) fail(409, "Milestone attempt changed")
        const post = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", row.serverId).eq("postNo", attempt.postNo)).unique()
        if (!post || post.attemptId !== attempt._id) fail(503, "Milestone post unavailable")
        const result = await reconcilePublishing(ctx, post, attempt, op.observation)
        return { duplicate: false, type: "reconciled", ...result }
    }
    const kind = op.kind, route = await milestoneRoute(ctx, identity.serverId, kind)
    if (op.type === "configure") {
        if (!context) fail(403, "Native milestone owner required")
        if (op.expectedRevision !== (route?.configured ? route.revision : 0)) fail(409, "Milestone route changed")
        const channelId = op.channelId, civil = route?.configured && op.zone === route.zone && op.time === route.time && op.fold === route.fold ? { zone: route.zone, time: route.time, fold: route.fold } : milestoneCivil({ zone: op.zone, time: op.time, fold: op.fold })
        if (context.channelId !== channelId || !context.actorAuthorized || !context.botAuthorized) fail(403, "Milestone destination permission required")
        const snapshot = await scheduleSnapshot(ctx, identity.serverId, { kind: "template", name: publishingName(op.template.name), revision: op.template.revision })
        validateMilestoneTemplate(snapshot.content, kind)
        const fields = { channelId, ...civil, template: { name: snapshot.source.name, revision: snapshot.source.revision }, content: snapshot.content, canonicalContent: snapshot.canonicalContent, configured: true, revision: route ? advanceMilestone(route.revision) : 1, intentRevision: route ? advanceMilestone(route.intentRevision) : 1, audienceGeneration: route ? route.channelId !== channelId || !route.configured ? advanceMilestone(route.audienceGeneration) : route.audienceGeneration : 1, updatedAt: now }
        const id = route ? route._id : await ctx.db.insert("milestoneRoutes", { serverId: identity.serverId, kind, createdBy: identity.actorId, enabled: false, activatedAt: 0, createdAt: now, ...fields })
        if (route) {
            await ctx.db.patch(id, fields)
            await rearmMilestones(ctx, identity.serverId, kind, now)
        }
        return { duplicate: false, type: "route", route: publicMilestoneRoute((await ctx.db.get(id))!) }
    }
    if (!route?.configured) fail(404, "Milestone route not configured")
    if (op.expectedRevision !== route.revision) fail(409, "Milestone route changed")
    await ctx.db.patch(route._id, { enabled: op.type === "enable", revision: advanceMilestone(route.revision), ...(op.type === "enable" && !route.enabled ? { activatedAt: now } : {}), ...(op.type === "clear" ? { configured: false, audienceGeneration: advanceMilestone(route.audienceGeneration), intentRevision: advanceMilestone(route.intentRevision) } : {}), updatedAt: now })
    if (op.type === "clear") return { duplicate: false, type: "cleared", kind }
    return { duplicate: false, type: "route", route: publicMilestoneRoute((await ctx.db.get(route._id))!) }
}
