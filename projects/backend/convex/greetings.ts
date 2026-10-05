import { onboardingProtection } from "./roleClaims.ts"
import { v } from "convex/values"
import { bumpConfigurationRevision } from "./configurationRevision.ts"
import type { GreetingsManageResult, GreetingsMemberResult, GreetingsObserveResult, GreetingsPendingResult, GreetingsQueryResult, GreetingsRoute } from "../contracts.js"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { internalMutation, internalQuery } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import { actor, administrator } from "./moderationDomain.ts"
import { shape, canonicalPublishingContent } from "./publishingDomain.ts"
import { epoch } from "./rolesDomain.ts"
import { fail, requireId, requireServer, bool, fresh, integer, name, source, text } from "./validation.ts"
import { defaultGreetings, greetingCursor, greetingMember, greetingRoutes, greetingTemplate, renderGreeting, route, GREETING_DAY, GREETING_BATCH } from "./greetingsDomain.ts"
import { currentGreeting, finishGreeting, greetingDelivery, greetingMemberRow, greetingState, publicGreetingDelivery, publicGreetingMember, readGreetingSettings, wakeGreetings } from "./greetingLifecycle.ts"
async function greetingAdmin(ctx: Parameters<typeof readGreetingSettings>[0], serverId: string, value: unknown, critical: boolean) {
    const who = actor(value); if (!administrator(who)) fail(403, "Administrator permission required")
    const moderation = await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (moderation?.config.defcon === 1 && !critical) fail(403, "DEFCON restriction")
}
async function nextGeneration(ctx: MutationCtx, serverId: string) {
    const row = await greetingState(ctx, serverId), next = integer(row.nextGeneration, 1, Number.MAX_SAFE_INTEGER - 1)
    await ctx.db.patch(row._id, { nextGeneration: next + 1 }); return next
}
async function cancelEpoch(ctx: MutationCtx, member: Doc<"greetingMembers">) {
    for (const destination of greetingRoutes) {
        const row = await ctx.db.query("greetingDeliveries").withIndex("by_epoch_route", q => q.eq("serverId", member.serverId).eq("userId", member.userId).eq("joinedAt", member.joinedAt).eq("route", destination)).unique()
        if (row?.active && row.claimedAt === undefined) await finishGreeting(ctx, row, "cancelled", "membership", true)
    }
}
async function admit(ctx: MutationCtx, member: Doc<"greetingMembers">, destination: GreetingsRoute) {
    const settings = await greetingState(ctx, member.serverId), config = settings.config.routes[destination], now = Date.now()
    if (!config.enabled || !config.content || !config.templateName || !config.templateRevision || destination !== "goodbye" && Date.parse(member.joinedAt) < settings.activatedAt[destination]) return false
    const old = await ctx.db.query("greetingDeliveries").withIndex("by_epoch_route", q => q.eq("serverId", member.serverId).eq("userId", member.userId).eq("joinedAt", member.joinedAt).eq("route", destination)).unique()
    if (old) return false
    const deliveryNo = integer(settings.nextDeliveryNo, 1, Number.MAX_SAFE_INTEGER - 1)
    await ctx.db.patch(settings._id, { nextDeliveryNo: deliveryNo + 1 })
    let content = config.content, rendered = true
    try { content = renderGreeting(config.content, destination, member.serverId, member, config.channelId) } catch { rendered = false }
    const waiting = destination !== "goodbye" && config.timing === "verified"
    await ctx.db.insert("greetingDeliveries", { serverId: member.serverId, deliveryNo, route: destination, routeRevision: config.revision, templateName: config.templateName, templateRevision: config.templateRevision, content, userId: member.userId, joinedAt: member.joinedAt, memberGeneration: member.generation, timing: config.timing, state: rendered ? waiting ? "waiting" : "ready" : "failed", active: rendered, createdAt: now, pendingExpiresAt: now + GREETING_DAY, nextCheckAt: now,
        ...(config.channelId ? { channelId: config.channelId } : {}), ...(waiting && rendered ? { reason: "verification" as const } : {}), ...(!rendered ? { reason: "eligibility" as const, noDispatch: true as const, finishedAt: now, expiresAt: now + settings.config.retentionDays * GREETING_DAY } : {}) })
    return true
}
export const invalidate = internalMutation({ args: { serverId: v.string(), route: v.union(v.literal("welcome"), v.literal("dm"), v.literal("goodbye")) }, handler: async (ctx, args) => {
    requireServer(args.serverId); const config = (await greetingState(ctx, args.serverId)).config.routes[args.route]
    const rows = await ctx.db.query("greetingDeliveries").withIndex("by_route_unclaimed", q => q.eq("serverId", args.serverId).eq("route", args.route).eq("active", true).eq("claimedAt", undefined).lt("routeRevision", config.revision)).take(GREETING_BATCH)
    for (const row of rows) await finishGreeting(ctx, row, "cancelled", "configuration", true)
    if (rows.length === GREETING_BATCH) await ctx.scheduler.runAfter(0, internal.greetings.invalidate, args)
    return { cancelled: rows.length }
} })
export const manage = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GreetingsManageResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "actor", "operation"], ["serverId", "messageId", "createdAt", "actor", "operation"]), now = Date.now(), identity = source(input, now), op = shape(input.operation, ["type", "route", "templateName", "expectedTemplateRevision", "channelId", "timing", "enabled", "claimsPerMinute", "retentionDays"], ["type"])
    await greetingAdmin(ctx, identity.serverId, input.actor, op.type === "clear" || op.type === "module" && op.enabled === false)
    // A redelivered command message is applied once
    const receipt = await ctx.db.query("greetingReceipts").withIndex("by_source", q => q.eq("serverId", identity.serverId).eq("messageId", identity.messageId)).unique()
    if (receipt) return { duplicate: true, settings: (await greetingState(ctx, identity.serverId)).config }
    await ctx.db.insert("greetingReceipts", { serverId: identity.serverId, messageId: identity.messageId, expiresAt: now + GREETING_DAY })
    const result = await applyGreetingConfiguration(ctx, identity.serverId, op, now)
    await bumpConfigurationRevision(ctx, identity.serverId, "greetings", { kind: "chat", createdAt: identity.createdAt })
    return result
} })
export const member = internalQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GreetingsMemberResult> => {
    const input = shape(request, ["serverId", "userId"], ["serverId", "userId"]), serverId = requireId(input.serverId); requireServer(serverId)
    const row = await greetingMemberRow(ctx, serverId, requireId(input.userId)); return { member: row && row.expiresAt > Date.now() ? publicGreetingMember(row) : null }
} })
export const query = internalQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GreetingsQueryResult> => {
    const input = shape(request, ["serverId", "actor", "operation"], ["serverId", "actor", "operation"]), serverId = requireId(input.serverId); requireServer(serverId)
    const op = shape(input.operation, ["type", "userId", "deliveryNo", "beforeDeliveryNo", "route", "userName", "serverName", "channelId"], ["type"])
    await greetingAdmin(ctx, serverId, input.actor, op.type !== "preview")
    if (op.type === "settings") { shape(op, ["type"]); return { type: "settings", settings: (await readGreetingSettings(ctx, serverId))?.config ?? defaultGreetings() } }
    if (op.type === "member") { shape(op, ["type", "userId"], ["type", "userId"]); const row = await greetingMemberRow(ctx, serverId, requireId(op.userId)); return { type: "member", member: row && row.expiresAt > Date.now() ? publicGreetingMember(row) : null } }
    if (op.type === "delivery") {
        shape(op, ["type", "deliveryNo"], ["type", "deliveryNo"])
        const row = await ctx.db.query("greetingDeliveries").withIndex("by_number", q => q.eq("serverId", serverId).eq("deliveryNo", integer(op.deliveryNo, 1, Number.MAX_SAFE_INTEGER))).unique()
        if (!row) fail(404, "Greeting delivery not found")
        return { type: "delivery", delivery: publicGreetingDelivery(row) }
    }
    if (op.type === "deliveries") {
        shape(op, ["type", "beforeDeliveryNo"])
        const before = op.beforeDeliveryNo === undefined ? Number.MAX_SAFE_INTEGER : integer(op.beforeDeliveryNo, 1, Number.MAX_SAFE_INTEGER)
        const rows = await ctx.db.query("greetingDeliveries").withIndex("by_number", q => q.eq("serverId", serverId).lt("deliveryNo", before)).order("desc").take(11)
        return { type: "deliveries", deliveries: rows.slice(0, 10).map(publicGreetingDelivery), ...(rows.length > 10 ? { nextBeforeDeliveryNo: rows[9]!.deliveryNo } : {}) }
    }
    if (op.type === "preview") {
        shape(op, ["type", "route", "userId", "userName", "serverName", "channelId"], ["type", "route", "userId", "userName", "serverName", "channelId"])
        const who = actor(input.actor); if (requireId(op.userId) !== who.userId) fail(403, "Preview uses the invoking member")
        const destination = route(op.route), config = ((await readGreetingSettings(ctx, serverId))?.config ?? defaultGreetings()).routes[destination]
        if (!config.content) fail(404, "Greeting is not configured")
        const content = renderGreeting(config.content, destination, serverId, { userId: who.userId, userName: text(op.userName, 128), serverName: text(op.serverName, 128) }, requireId(op.channelId))
        return { type: "preview", content, canonicalContent: canonicalPublishingContent(content) }
    }
    fail(400, "Unknown greeting query")
} })
export const observe = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GreetingsObserveResult> => {
    const input = shape(request, ["serverId", "operation"], ["serverId", "operation"]), serverId = requireId(input.serverId); requireServer(serverId)
    const op = shape(input.operation, ["type", "eventJoinedAt", "observedAt", "member", "expectedGeneration", "userId", "joinedAt", "memberAbsent", "userName", "serverName"], ["type", "observedAt"]), now = Date.now(), observedAt = integer(op.observedAt, now - 60000, now + 1000)
    if (op.type === "join") {
        shape(op, ["type", "eventJoinedAt", "observedAt", "member"], ["type", "eventJoinedAt", "observedAt", "member"])
        const current = greetingMember(op.member), raw = epoch(op.eventJoinedAt); fresh(Date.parse(raw), now)
        if (current.joinedAt !== raw || current.isBot) fail(403, "Greeting join is not eligible")
        const enabled = (await readGreetingSettings(ctx, serverId))?.config.routes; if (!enabled || !Object.values(enabled).some(r => r.enabled)) return { recorded: false, member: null, admitted: 0 }
        const old = await greetingMemberRow(ctx, serverId, current.userId)
        if (old && (observedAt < old.observedAt || Date.parse(raw) < Date.parse(old.joinedAt))) fail(409, "Greeting observation is stale")
        if (old?.joinedAt === raw) return { recorded: false, member: publicGreetingMember(old), admitted: 0 }
        if (old) await cancelEpoch(ctx, old)
        const generation = await nextGeneration(ctx, serverId), value = { serverId, userId: current.userId, userName: current.userName, serverName: current.serverName, joinedAt: raw, generation, present: true, observedAt, expiresAt: now + 365 * GREETING_DAY }
        const id = old ? old._id : await ctx.db.insert("greetingMembers", value); if (old) await ctx.db.patch(id, value)
        const member = (await ctx.db.get(id))!; let admitted = 0
        let protectedAdmission = false; try { await onboardingProtection(ctx, serverId, current.userId, current.timeoutUntil) } catch { protectedAdmission = true }
        if (!protectedAdmission) for (const destination of ["welcome", "dm"] as const) if (await admit(ctx, member, destination)) admitted++
        return { recorded: true, member: publicGreetingMember(member), admitted }
    }
    if (op.type === "present") {
        shape(op, ["type", "expectedGeneration", "observedAt", "member"], ["type", "expectedGeneration", "observedAt", "member"])
        const current = greetingMember(op.member), old = await greetingMemberRow(ctx, serverId, current.userId)
        if (!old || old.expiresAt <= now) return { recorded: false, member: null, admitted: 0 }
        if (integer(op.expectedGeneration, 1, Number.MAX_SAFE_INTEGER) !== old.generation || observedAt < old.observedAt) fail(409, "Greeting observation is stale")
        if (current.isBot || current.joinedAt !== old.joinedAt) {
            await cancelEpoch(ctx, old); await ctx.db.patch(old._id, { present: false, observedAt, expiresAt: now + GREETING_DAY, generation: await nextGeneration(ctx, serverId) })
        } else {
            if (!old.present) await cancelEpoch(ctx, old)
            await ctx.db.patch(old._id, { present: true, observedAt, userName: current.userName, serverName: current.serverName, ...(!old.present ? { generation: await nextGeneration(ctx, serverId) } : {}) })
            await wakeGreetings(ctx, serverId, current.userId, current.joinedAt)
        }
        return { recorded: true, member: publicGreetingMember((await ctx.db.get(old._id))!), admitted: 0 }
    }
    if (op.type === "absent") {
        shape(op, ["type", "userId", "expectedGeneration", "joinedAt", "observedAt", "memberAbsent"], ["type", "userId", "expectedGeneration", "joinedAt", "observedAt", "memberAbsent"])
        if (op.memberAbsent !== true) fail(400, "Confirmed member absence required")
        const old = await greetingMemberRow(ctx, serverId, requireId(op.userId))
        if (!old || old.expiresAt <= now) return { recorded: false, member: null, admitted: 0 }
        if (integer(op.expectedGeneration, 1, Number.MAX_SAFE_INTEGER) !== old.generation || epoch(op.joinedAt) !== old.joinedAt || observedAt < old.observedAt) fail(409, "Greeting observation is stale")
        if (!old.present) return { recorded: false, member: publicGreetingMember(old), admitted: 0 }
        await cancelEpoch(ctx, old); await ctx.db.patch(old._id, { present: false, generation: await nextGeneration(ctx, serverId), observedAt, expiresAt: now + GREETING_DAY })
        const member = (await ctx.db.get(old._id))!; let permitted = true; try { await onboardingProtection(ctx, serverId, member.userId, null) } catch { permitted = false }; const admitted = permitted && await admit(ctx, member, "goodbye")
        return { recorded: true, member: publicGreetingMember(member), admitted: admitted ? 1 : 0 }
    }
    if (op.type === "departed") {
        shape(op, ["type", "userId", "userName", "serverName", "observedAt", "memberAbsent"], ["type", "userId", "userName", "serverName", "observedAt", "memberAbsent"])
        if (op.memberAbsent !== true) fail(400, "Confirmed member absence required")
        const userId = requireId(op.userId), old = await greetingMemberRow(ctx, serverId, userId)
        if (old && old.expiresAt > now) return { recorded: false, member: publicGreetingMember(old), admitted: 0 }
        // A member who joined before greetings recorded them has no join epoch, so the departure time keys the goodbye
        const value = { serverId, userId, userName: text(op.userName, 128), serverName: text(op.serverName, 128), joinedAt: new Date(observedAt).toISOString(),
            generation: await nextGeneration(ctx, serverId), present: false, observedAt, expiresAt: now + GREETING_DAY }
        if (old) await ctx.db.patch(old._id, value)
        const id = old ? old._id : await ctx.db.insert("greetingMembers", value), member = (await ctx.db.get(id))!
        let permitted = true
        try { await onboardingProtection(ctx, serverId, userId, null) } catch { permitted = false }
        const admitted = permitted && await admit(ctx, member, "goodbye")
        return { recorded: true, member: publicGreetingMember(member), admitted: admitted ? 1 : 0 }
    }
    fail(400, "Unknown greeting observation")
} })
export const pending = internalQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GreetingsPendingResult> => {
    const input = shape(request, ["serverId", "cursor", "userId", "scanAt"], ["serverId"]), serverId = requireId(input.serverId); requireServer(serverId)
    const userId = input.userId === undefined ? undefined : requireId(input.userId), now = Date.now(), scanAt = input.scanAt === undefined ? now : integer(input.scanAt, now - GREETING_DAY, now + 1000)
    if (input.cursor !== undefined && input.scanAt === undefined) fail(400, "Cursor scan cutoff required")
    const base = userId === undefined ? ctx.db.query("greetingDeliveries").withIndex("by_ready", q => q.eq("serverId", serverId).eq("state", "ready").lte("nextCheckAt", scanAt)) : ctx.db.query("greetingDeliveries").withIndex("by_member_state", q => q.eq("serverId", serverId).eq("userId", userId).eq("state", "ready").lte("nextCheckAt", scanAt))
    const page = await base.paginate({ numItems: 10, cursor: greetingCursor(input.cursor) }), settings = await readGreetingSettings(ctx, serverId)
    const next = userId === undefined ? await ctx.db.query("greetingDeliveries").withIndex("by_ready", q => q.eq("serverId", serverId).eq("state", "ready").gt("nextCheckAt", now)).first() : await ctx.db.query("greetingDeliveries").withIndex("by_member_state", q => q.eq("serverId", serverId).eq("userId", userId).eq("state", "ready").gt("nextCheckAt", now)).first()
    const waiting = userId === undefined ? await ctx.db.query("greetingDeliveries").withIndex("by_ready", q => q.eq("serverId", serverId).eq("state", "waiting")).first() : await ctx.db.query("greetingDeliveries").withIndex("by_member_state", q => q.eq("serverId", serverId).eq("userId", userId).eq("state", "waiting")).first()
    const nextDue = Math.min(next?.nextCheckAt ?? Infinity, waiting?.nextCheckAt ?? Infinity)
    return { scanAt, candidates: page.page.map(row => ({ deliveryId: row._id, route: row.route, routeRevision: row.routeRevision, userId: row.userId, joinedAt: row.joinedAt, memberGeneration: row.memberGeneration, hasEmbed: Boolean(row.content.embed), ...(row.channelId ? { channelId: row.channelId } : {}) })), nextClaimAt: settings?.nextClaimAt ?? 0, ...(Number.isFinite(nextDue) ? { nextCheckAt: nextDue } : {}), ...(!page.isDone ? { nextCursor: page.continueCursor } : {}) }
} })

export const discover = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = shape(request, ["serverId", "cursor", "userId", "scanAt"], ["serverId"]), serverId = requireId(input.serverId); requireServer(serverId)
    const now = Date.now(), userId = input.userId === undefined ? undefined : requireId(input.userId), scanAt = input.scanAt === undefined ? now : integer(input.scanAt, now - GREETING_DAY, now + 1000)
    if (input.cursor !== undefined && input.scanAt === undefined) fail(400, "Cursor scan cutoff required")
    const scan = userId === undefined ? ctx.db.query("greetingDeliveries").withIndex("by_ready", q => q.eq("serverId", serverId).eq("state", "waiting").lte("nextCheckAt", scanAt)) : ctx.db.query("greetingDeliveries").withIndex("by_member_state", q => q.eq("serverId", serverId).eq("userId", userId).eq("state", "waiting").lte("nextCheckAt", scanAt))
    const page = await scan.paginate({ numItems: 10, cursor: greetingCursor(input.cursor) })
    const config = await ctx.db.query("roleSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique(), panel = await ctx.db.query("rolePanels").withIndex("by_server_kind", q => q.eq("serverId", serverId).eq("kind", "verification")).unique()
    let queued = 0
    for (const row of page.page) {
        if (!(await currentGreeting(ctx, row)).valid) continue
        await ctx.db.patch(row._id, { nextCheckAt: now + 60000 })
        if (!config?.config.verificationEnabled || !panel?.enabled || panel.withdrawing || !panel.published || panel.revision !== panel.published.revision) continue
        const ack = await ctx.db.query("roleAcknowledgments").withIndex("by_server_member", q => q.eq("serverId", serverId).eq("userId", row.userId).eq("joinedAt", row.joinedAt)).unique(), roleId = panel.published.mappings[0]?.roleId
        if (!ack || !roleId || ack.panelName !== panel.name || ack.rulesRevision !== panel.published.revision) continue
        const owner = await ctx.db.query("roleOwnership").withIndex("by_server_member_role", q => q.eq("serverId", serverId).eq("userId", row.userId).eq("joinedAt", row.joinedAt).eq("roleId", roleId)).unique()
        if (!owner || owner.status !== "idle") continue
        const refs = await ctx.db.query("roleReferences").withIndex("by_owner", q => q.eq("ownershipId", owner._id)).take(101)
        if (refs.length > 100 || !refs.some(r => r.desired && r.consumerKey === `panel:${panel.name}:${panel.published!.revision}`)) continue
        // This only schedules a candidate, fresh native access is still required at reservation and dispatch
        await ctx.db.patch(row._id, { state: "ready", nextCheckAt: now }); queued++
    }
    return { scanAt, examined: page.page.length, queued, ...(!page.isDone ? { nextCursor: page.continueCursor } : {}) }
} })

export async function applyGreetingConfiguration(ctx: MutationCtx, serverId: string, op: Record<string, unknown>, now: number): Promise<GreetingsManageResult> {
    const identity = { serverId }, state = await greetingState(ctx, serverId)
    const config = structuredClone(state.config), activatedAt = { ...state.activatedAt }
    if (op.type === "settings") {
        shape(op, ["type", "claimsPerMinute", "retentionDays"], ["type"])
        if (op.claimsPerMinute === undefined && op.retentionDays === undefined) fail(400, "Empty greeting settings")
        if (op.claimsPerMinute !== undefined) config.claimsPerMinute = integer(op.claimsPerMinute, 1, 60)
        if (op.retentionDays !== undefined) config.retentionDays = integer(op.retentionDays, 30, 3650)
    } else if (op.type === "configure" || op.type === "module" || op.type === "clear") {
        const destination = route(op.route), current = config.routes[destination], revision = integer(current.revision, 1, Number.MAX_SAFE_INTEGER - 1) + 1
        if (op.type === "clear") {
            shape(op, ["type", "route"], ["type", "route"])
            config.routes[destination] = { revision, enabled: false, timing: "join" }
            activatedAt[destination] = 0
        } else if (op.type === "module") {
            shape(op, ["type", "route", "enabled"], ["type", "route", "enabled"])
            const enabled = bool(op.enabled); if (enabled && (!current.content || destination !== "dm" && !current.channelId)) fail(409, "Greeting is not configured")
            config.routes[destination] = { ...current, enabled, revision }; if (enabled) activatedAt[destination] = now
        } else {
            shape(op, ["type", "route", "templateName", "expectedTemplateRevision", "channelId", "timing"], ["type", "route", "templateName", "expectedTemplateRevision"])
            const template = await ctx.db.query("publishingDrafts").withIndex("by_server_kind_name", q => q.eq("serverId", identity.serverId).eq("kind", "template").eq("name", name(op.templateName))).unique()
            if (!template) fail(404, "Greeting template not found")
            if (template.revision !== integer(op.expectedTemplateRevision, 1, Number.MAX_SAFE_INTEGER)) fail(409, "Greeting template changed")
            if (destination === "dm" && op.channelId !== undefined || destination === "goodbye" && op.timing !== undefined && op.timing !== "join") fail(400, "Invalid greeting destination")
            const timing = op.timing ?? "join"; if (timing !== "join" && timing !== "verified") fail(400, "Invalid greeting timing")
            config.routes[destination] = { revision, enabled: current.enabled, timing, templateName: template.name, templateRevision: template.revision, content: greetingTemplate(template.content, destination), ...(destination !== "dm" ? { channelId: requireId(op.channelId) } : {}) }
            activatedAt[destination] = now
        }
        await ctx.scheduler.runAfter(0, internal.greetings.invalidate, { serverId: identity.serverId, route: destination })
    } else fail(400, "Unknown greeting operation")
    const latest = await greetingState(ctx, identity.serverId)
    await ctx.db.patch(latest._id, { config, activatedAt }); return { duplicate: false, settings: config }
}
