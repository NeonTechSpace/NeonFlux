import type { MutationCtx } from "./_generated/server.js"
import { bumpConfigurationRevision, configurationSourceId, type ConfigurationIdentity } from "./configurationRevision.ts"
import { v } from "convex/values"
import type { MilestonesManageResult, MilestonesPersonalResult, MilestonesQueryResult } from "../contracts.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { epochOrder } from "./eventsDomain.ts"
import { publishingName, shape } from "./publishingDomain.ts"
import { milestoneBinding, milestoneCivil, milestoneIdentity, milestoneKind, milestoneLocalParts, milestoneMonthDay, milestoneParticipant, advanceMilestone, renderMilestone, validateMilestoneTemplate, MILESTONES_BATCH, MILESTONES_DAY } from "./milestonesDomain.ts"
import { boundMilestoneDelivery, milestoneAdmin, milestoneCount, milestoneEnrollment, milestoneParticipantEligible, milestoneReceipt, milestoneRoute, milestoneSettings, milestoneState, progressMilestone, publicMilestoneDelivery, publicMilestoneEnrollment, publicMilestoneRoute, rearmMilestones, removeMilestoneEnrollment } from "./milestonesStore.ts"
import { publisherSettings, scheduleSnapshot } from "./schedulesStore.ts"
import { reconcilePublishing, releaseMilestonePublication } from "./publishing.ts"
import { fail, object, requireId, requireServer, bool, integer, source, token, cursor } from "./validation.ts"
import { eventContext } from "./publishingContext.ts"

const settings = (row: { enabled: boolean, revision: number, activatedAt: number } | null) => ({ enabled: row?.enabled ?? false, revision: row?.revision ?? 1, activatedAt: row?.activatedAt ?? 0 })
export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<MilestonesManageResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "context", "operation"], ["serverId", "messageId", "createdAt", "context", "operation"])
    const identity = source(input, Date.now()), context = eventContext(input.context), op = object(input.operation), now = Date.now()
    await milestoneAdmin(ctx, identity.serverId, context, ["disable", "clear", "reconcile", "forget"].includes(String(op.type)) || op.type === "settings" && op.enabled === false)
    if (!await milestoneReceipt(ctx, identity, context.actor.userId, "staff", op)) return { duplicate: true }
    const result = await applyMilestonesManagement(ctx, { serverId: identity.serverId, actorId: context.actor.userId, createdAt: identity.createdAt, source: { kind: "chat", messageId: identity.messageId } }, context, op, now)
    if (op.type !== "reconcile" && op.type !== "forget") await bumpConfigurationRevision(ctx, identity.serverId, "milestones", { kind: "chat", createdAt: identity.createdAt })
    return result
} })
export const query = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<MilestonesQueryResult> => {
    const input = shape(request, ["serverId", "context", "operation"], ["serverId", "context", "operation"]), serverId = requireId(input.serverId)
    requireServer(serverId)
    await milestoneAdmin(ctx, serverId, eventContext(input.context), true)
    const op = object(input.operation), current = await milestoneSettings(ctx, serverId), routes = (await ctx.db.query("milestoneRoutes").withIndex("by_kind", q => q.eq("serverId", serverId)).take(2)).filter(r => r.configured).map(publicMilestoneRoute)
    if (op.type === "settings" || op.type === "status") {
        shape(op, ["type"], ["type"])
        if (op.type === "settings") return { type: "settings", settings: settings(current), routes }
        const publishing = await publisherSettings(ctx, serverId)
        return { type: "status", settings: settings(current), routes, accounts: current?.accounts ?? 0, enrollments: current?.enrollments ?? 0, deliveries: current?.deliveries ?? 0, staffReceipts: current?.staffReceipts ?? 0, memberReceipts: current?.memberReceipts ?? 0, publishing: { enabled: publishing?.enabled ?? true }, limits: { accounts: 1000, slotsPerAccount: 2, deliveries: 4000, staffReceipts: 1000, memberReceipts: 10000 } }
    }
    const kind = milestoneKind(op.kind), route = routes.find(r => r.kind === kind)
    if (op.type === "preview") {
        shape(op, ["type", "kind"], ["type", "kind"])
        if (!route) fail(404, "Milestone route not configured")
        return { type: "preview", route, content: renderMilestone(route.content, kind, "Example member", "Example server", 1) }
    }
    if (op.type !== "deliveries") fail(400, "Invalid milestone query")
    shape(op, ["type", "kind", "cursor"], ["type", "kind"])
    if (op.cursor !== undefined && (typeof op.cursor !== "string" || op.cursor.length > 4096)) fail(400, "Invalid milestone cursor")
    const page = await ctx.db.query("milestoneDeliveries").withIndex("by_route", q => q.eq("serverId", serverId).eq("kind", kind)).paginate({ cursor: cursor(op.cursor), numItems: MILESTONES_BATCH })
    return { type: "deliveries", deliveries: page.page.map(publicMilestoneDelivery), ...(!page.isDone ? { nextCursor: page.continueCursor } : {}) }
} })
export const personal = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<MilestonesPersonalResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "identity", "operation"], ["serverId", "messageId", "createdAt", "identity", "operation"]), identity = source(input, Date.now()), dm = milestoneIdentity(input.identity), op = object(input.operation), now = Date.now()
    if (op.type === "me") {
        shape(op, ["type"], ["type"])
        const rows = await ctx.db.query("milestoneEnrollments").withIndex("by_user_kind", q => q.eq("serverId", identity.serverId).eq("userId", dm.userId)).take(2), routes = await ctx.db.query("milestoneRoutes").withIndex("by_kind", q => q.eq("serverId", identity.serverId)).take(2)
        return { duplicate: false, type: "me", enrollments: rows.map(row => publicMilestoneEnrollment(row, routes.find(route => route.kind === row.kind) ?? null)), routes: routes.filter(r => r.configured).map(publicMilestoneRoute) }
    }
    if (op.type !== "enroll" && op.type !== "remove") fail(400, "Invalid milestone personal operation")
    const kind = op.type === "remove" && op.kind === "all" ? "all" : milestoneKind(op.kind)
    let participant: ReturnType<typeof milestoneParticipant> | undefined, monthDay: string | undefined
    if (op.type === "enroll") {
        shape(op, ["type", "kind", "monthDay", "confirmChannelId", "participant"], kind === "birthday" ? ["type", "kind", "monthDay", "confirmChannelId", "participant"] : ["type", "kind", "confirmChannelId", "participant"])
        if (kind === "anniversary" && op.monthDay !== undefined) fail(400, "Anniversary date comes from membership")
        monthDay = kind === "birthday" ? milestoneMonthDay(op.monthDay) : undefined
        participant = milestoneParticipant(op.participant)
        if (participant.member.userId !== dm.userId || participant.member.isBot) fail(403, "DM author membership required")
        const route = await milestoneRoute(ctx, identity.serverId, kind as "birthday" | "anniversary")
        if (!route?.configured) fail(404, "Milestone route not configured")
        if (requireId(op.confirmChannelId) !== route.channelId || participant.channelId !== route.channelId) fail(409, "Explicit current destination consent required")
        await milestoneParticipantEligible(ctx, identity.serverId, participant, route.channelId, dm.userId)
    } else shape(op, ["type", "kind"], ["type", "kind"])
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
    const selectedKind = kind as "birthday" | "anniversary", route = (await milestoneRoute(ctx, identity.serverId, selectedKind))!, old = rows.find(row => row.kind === selectedKind)
    if (old && (participant!.observedAt < old.observedAt || epochOrder(participant!.member.joinedAt) < epochOrder(old.joinedAt))) fail(409, "Milestone membership observation superseded")
    if (old) await removeMilestoneEnrollment(ctx, old)
    const currentRows = await ctx.db.query("milestoneEnrollments").withIndex("by_user_kind", q => q.eq("serverId", identity.serverId).eq("userId", dm.userId)).first()
    if (!currentRows) await milestoneCount(ctx, identity.serverId, "accounts", 1)
    await milestoneCount(ctx, identity.serverId, "enrollments", 1)
    const id = await ctx.db.insert("milestoneEnrollments", { serverId: identity.serverId, userId: dm.userId, kind: selectedKind, revision, joinedAt: participant!.member.joinedAt, audienceGeneration: route.audienceGeneration, channelId: route.channelId, consentedAt: now, observedAt: participant!.observedAt, ...(monthDay ? { monthDay } : {}), nextYear: milestoneLocalParts(now, route.zone).year, generation: 0, nextCheckAt: now })
    await progressMilestone(ctx, (await ctx.db.get(id))!)
    return { duplicate: false, type: "enrollment", enrollment: publicMilestoneEnrollment((await ctx.db.get(id))!, route) }
} })

export async function applyMilestonesManagement(ctx: MutationCtx, identity: ConfigurationIdentity, context: ReturnType<typeof eventContext> | undefined, op: Record<string, unknown>, now: number): Promise<MilestonesManageResult> {
    if (op.type === "settings") {
        shape(op, ["type", "expectedRevision", "enabled"], ["type", "expectedRevision", "enabled"])
        const current = await milestoneState(ctx, identity.serverId), enabled = bool(op.enabled)
        if (integer(op.expectedRevision, 1, Number.MAX_SAFE_INTEGER) !== current.revision) fail(409, "Milestone settings changed")
        await ctx.db.patch(current._id, { enabled, revision: advanceMilestone(current.revision), ...(enabled && !current.enabled ? { activatedAt: now } : {}) })
        return { duplicate: false, type: "settings", settings: settings((await ctx.db.get(current._id))!) }
    }
    if (op.type === "forget" || op.type === "reconcile") {
        shape(op, op.type === "forget" ? ["type", "binding", "confirm"] : ["type", "binding", "attemptId", "expectedGeneration", "observation"], op.type === "forget" ? ["type", "binding", "confirm"] : ["type", "binding", "attemptId", "expectedGeneration", "observation"])
        const row = await boundMilestoneDelivery(ctx, identity.serverId, milestoneBinding(op.binding))
        if (op.type === "forget") {
            if (op.confirm !== "forget") fail(400, "Explicit forget confirmation required")
            if (row.active) fail(409, "Pending milestone preserved")
            await releaseMilestonePublication(ctx, row)
            await ctx.db.delete(row._id); await milestoneCount(ctx, row.serverId, "deliveries", -1)
            return { duplicate: false, type: "forgotten", removed: 1 }
        }
        const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
        if (!attempt || attempt._id !== token(op.attemptId) || attempt.generation !== integer(op.expectedGeneration, 1, Number.MAX_SAFE_INTEGER)) fail(409, "Milestone attempt changed")
        const post = await ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", row.serverId).eq("postNo", attempt.postNo)).unique()
        if (!post || post.attemptId !== attempt._id) fail(503, "Milestone post unavailable")
        const result = await reconcilePublishing(ctx, post, attempt, op.observation)
        return { duplicate: false, type: "reconciled", ...result }
    }
    const kind = milestoneKind(op.kind), route = await milestoneRoute(ctx, identity.serverId, kind)
    if (op.type === "configure") {
        if (!context) fail(403, "Native milestone owner required")
        shape(op, ["type", "kind", "expectedRevision", "channelId", "zone", "time", "fold", "template"], ["type", "kind", "expectedRevision", "channelId", "zone", "time", "fold", "template"])
        if (integer(op.expectedRevision, 0, Number.MAX_SAFE_INTEGER) !== (route?.configured ? route.revision : 0)) fail(409, "Milestone route changed")
        const channelId = requireId(op.channelId), civil = route?.configured && op.zone === route.zone && op.time === route.time && op.fold === route.fold ? { zone: route.zone, time: route.time, fold: route.fold } : milestoneCivil({ zone: op.zone, time: op.time, fold: op.fold }), selected = shape(op.template, ["name", "revision"], ["name", "revision"])
        if (context.channelId !== channelId || !context.actorAuthorized || !context.botAuthorized) fail(403, "Milestone destination permission required")
        const snapshot = await scheduleSnapshot(ctx, identity.serverId, { kind: "template", name: publishingName(selected.name), revision: selected.revision })
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
    if (integer(op.expectedRevision, 1, Number.MAX_SAFE_INTEGER) !== route.revision) fail(409, "Milestone route changed")
    shape(op, ["type", "kind", "expectedRevision"], ["type", "kind", "expectedRevision"])
    if (op.type !== "enable" && op.type !== "disable" && op.type !== "clear") fail(400, "Invalid milestone operation")
    await ctx.db.patch(route._id, { enabled: op.type === "enable", revision: advanceMilestone(route.revision), ...(op.type === "enable" && !route.enabled ? { activatedAt: now } : {}), ...(op.type === "clear" ? { configured: false, audienceGeneration: advanceMilestone(route.audienceGeneration), intentRevision: advanceMilestone(route.intentRevision) } : {}), updatedAt: now })
    if (op.type === "clear") return { duplicate: false, type: "cleared", kind }
    return { duplicate: false, type: "route", route: publicMilestoneRoute((await ctx.db.get(route._id))!) }
}
