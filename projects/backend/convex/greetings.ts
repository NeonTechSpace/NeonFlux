import { onboardingProtection } from "./roleClaims.ts"
import { v } from "convex/values"
import { changeConfiguration } from "./configurationChange.ts"
import { GreetingsDiscoverRequest, GreetingsManageRequest, GreetingsMemberRequest, GreetingsObserveRequest, GreetingsPendingRequest, GreetingsQueryRequest, type GreetingsDiscoverResult, type GreetingsManageResult,
    type GreetingsMemberResult, type GreetingsObserveResult, type GreetingsPendingResult, type GreetingsQueryResult, type GreetingsRoute } from "@neonflux/contracts/greetings"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { internalMutation } from "./_generated/server.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { internal } from "./_generated/api.js"
import { actor, administrator } from "./moderationDomain.ts"
import { canonicalPublishingContent } from "./publishingDomain.ts"
import { decode, fail, requireServer, fresh, integer, name, source } from "./validation.ts"
import { defaultGreetings, greetingMember, greetingRoutes, greetingTemplate, renderGreeting, GREETING_DAY, GREETING_BATCH } from "./greetingsDomain.ts"
import { onboardingChecklist, withChecklist } from "./onboarding.ts"
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
    // The newcomer checklist goes with the greeting of its route
    if (rendered) content = withChecklist(content, await onboardingChecklist(ctx, member.serverId, destination))
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
export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GreetingsManageResult> => {
    const input = decode(GreetingsManageRequest, request), now = Date.now(), identity = source(input, now), op = input.operation
    await greetingAdmin(ctx, identity.serverId, input.actor, op.type === "clear" || op.type === "module" && op.enabled === false)
    // A redelivered command message is applied once
    const receipt = await ctx.db.query("greetingReceipts").withIndex("by_source", q => q.eq("serverId", identity.serverId).eq("messageId", identity.messageId)).unique()
    if (receipt) return { duplicate: true, settings: (await greetingState(ctx, identity.serverId)).config }
    await ctx.db.insert("greetingReceipts", { serverId: identity.serverId, messageId: identity.messageId, expiresAt: now + GREETING_DAY })
    return changeConfiguration(ctx, identity.serverId, "greetings", { kind: "chat", createdAt: identity.createdAt, actor: { userId: actor(input.actor).userId, source: "command" }, operation: op },
        () => applyGreetingConfiguration(ctx, identity.serverId, op, now))
} })
export const member = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GreetingsMemberResult> => {
    const { serverId, userId } = decode(GreetingsMemberRequest, request); requireServer(serverId)
    const row = await greetingMemberRow(ctx, serverId, userId); return { member: row && row.expiresAt > Date.now() ? publicGreetingMember(row) : null }
} })
export const query = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GreetingsQueryResult> => {
    const input = decode(GreetingsQueryRequest, request), serverId = input.serverId, op = input.operation; requireServer(serverId)
    await greetingAdmin(ctx, serverId, input.actor, op.type !== "preview")
    if (op.type === "settings") return { type: "settings", settings: (await readGreetingSettings(ctx, serverId))?.config ?? defaultGreetings() }
    if (op.type === "member") { const row = await greetingMemberRow(ctx, serverId, op.userId); return { type: "member", member: row && row.expiresAt > Date.now() ? publicGreetingMember(row) : null } }
    if (op.type === "delivery") {
        const row = await ctx.db.query("greetingDeliveries").withIndex("by_number", q => q.eq("serverId", serverId).eq("deliveryNo", op.deliveryNo)).unique()
        if (!row) fail(404, "Greeting delivery not found")
        return { type: "delivery", delivery: publicGreetingDelivery(row) }
    }
    if (op.type === "deliveries") {
        const before = op.beforeDeliveryNo ?? Number.MAX_SAFE_INTEGER
        const rows = await ctx.db.query("greetingDeliveries").withIndex("by_number", q => q.eq("serverId", serverId).lt("deliveryNo", before)).order("desc").take(11)
        return { type: "deliveries", deliveries: rows.slice(0, 10).map(publicGreetingDelivery), ...(rows.length > 10 ? { nextBeforeDeliveryNo: rows[9]!.deliveryNo } : {}) }
    }
    const who = actor(input.actor); if (op.userId !== who.userId) fail(403, "Preview uses the invoking member")
    const destination = op.route, config = ((await readGreetingSettings(ctx, serverId))?.config ?? defaultGreetings()).routes[destination]
    if (!config.content) fail(404, "Greeting is not configured")
    const content = withChecklist(renderGreeting(config.content, destination, serverId, { userId: who.userId, userName: op.userName, serverName: op.serverName }, op.channelId),
        await onboardingChecklist(ctx, serverId, destination))
    return { type: "preview", content, canonicalContent: canonicalPublishingContent(content) }
} })
export const observe = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GreetingsObserveResult> => {
    const input = decode(GreetingsObserveRequest, request), serverId = input.serverId, op = input.operation; requireServer(serverId)
    const now = Date.now(), observedAt = integer(op.observedAt, now - 60000, now + 1000)
    if (op.type === "join") {
        const current = greetingMember(op.member), raw = op.eventJoinedAt; fresh(Date.parse(raw), now)
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
        const current = greetingMember(op.member), old = await greetingMemberRow(ctx, serverId, current.userId)
        if (!old || old.expiresAt <= now) return { recorded: false, member: null, admitted: 0 }
        if (op.expectedGeneration !== old.generation || observedAt < old.observedAt) fail(409, "Greeting observation is stale")
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
        const old = await greetingMemberRow(ctx, serverId, op.userId)
        if (!old || old.expiresAt <= now) return { recorded: false, member: null, admitted: 0 }
        if (op.expectedGeneration !== old.generation || op.joinedAt !== old.joinedAt || observedAt < old.observedAt) fail(409, "Greeting observation is stale")
        if (!old.present) return { recorded: false, member: publicGreetingMember(old), admitted: 0 }
        await cancelEpoch(ctx, old); await ctx.db.patch(old._id, { present: false, generation: await nextGeneration(ctx, serverId), observedAt, expiresAt: now + GREETING_DAY })
        const member = (await ctx.db.get(old._id))!; let permitted = true; try { await onboardingProtection(ctx, serverId, member.userId, null) } catch { permitted = false }; const admitted = permitted && await admit(ctx, member, "goodbye")
        return { recorded: true, member: publicGreetingMember(member), admitted: admitted ? 1 : 0 }
    }
    const userId = op.userId, old = await greetingMemberRow(ctx, serverId, userId)
    if (old && old.expiresAt > now) return { recorded: false, member: publicGreetingMember(old), admitted: 0 }
    // A member who joined before greetings recorded them has no join epoch, so the departure time keys the goodbye
    const value = { serverId, userId, userName: op.userName, serverName: op.serverName, joinedAt: new Date(observedAt).toISOString(),
        generation: await nextGeneration(ctx, serverId), present: false, observedAt, expiresAt: now + GREETING_DAY }
    if (old) await ctx.db.patch(old._id, value)
    const id = old ? old._id : await ctx.db.insert("greetingMembers", value), member = (await ctx.db.get(id))!
    let permitted = true
    try { await onboardingProtection(ctx, serverId, userId, null) } catch { permitted = false }
    const admitted = permitted && await admit(ctx, member, "goodbye")
    return { recorded: true, member: publicGreetingMember(member), admitted: admitted ? 1 : 0 }
} })
export const pending = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GreetingsPendingResult> => {
    const input = decode(GreetingsPendingRequest, request), { serverId, userId } = input; requireServer(serverId)
    const now = Date.now(), scanAt = input.scanAt === undefined ? now : integer(input.scanAt, now - GREETING_DAY, now + 1000)
    const base = userId === undefined ? ctx.db.query("greetingDeliveries").withIndex("by_ready", q => q.eq("serverId", serverId).eq("state", "ready").lte("nextCheckAt", scanAt)) : ctx.db.query("greetingDeliveries").withIndex("by_member_state", q => q.eq("serverId", serverId).eq("userId", userId).eq("state", "ready").lte("nextCheckAt", scanAt))
    const page = await base.paginate({ numItems: 10, cursor: input.cursor ?? null }), settings = await readGreetingSettings(ctx, serverId)
    const next = userId === undefined ? await ctx.db.query("greetingDeliveries").withIndex("by_ready", q => q.eq("serverId", serverId).eq("state", "ready").gt("nextCheckAt", now)).first() : await ctx.db.query("greetingDeliveries").withIndex("by_member_state", q => q.eq("serverId", serverId).eq("userId", userId).eq("state", "ready").gt("nextCheckAt", now)).first()
    const waiting = userId === undefined ? await ctx.db.query("greetingDeliveries").withIndex("by_ready", q => q.eq("serverId", serverId).eq("state", "waiting")).first() : await ctx.db.query("greetingDeliveries").withIndex("by_member_state", q => q.eq("serverId", serverId).eq("userId", userId).eq("state", "waiting")).first()
    const nextDue = Math.min(next?.nextCheckAt ?? Infinity, waiting?.nextCheckAt ?? Infinity)
    return { scanAt, candidates: page.page.map(row => ({ deliveryId: row._id, route: row.route, routeRevision: row.routeRevision, userId: row.userId, joinedAt: row.joinedAt, memberGeneration: row.memberGeneration, hasEmbed: Boolean(row.content.embed), ...(row.channelId ? { channelId: row.channelId } : {}) })), nextClaimAt: settings?.nextClaimAt ?? 0, ...(Number.isFinite(nextDue) ? { nextCheckAt: nextDue } : {}), ...(!page.isDone ? { nextCursor: page.continueCursor } : {}) }
} })

export const discover = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GreetingsDiscoverResult> => {
    const input = decode(GreetingsDiscoverRequest, request), { serverId, userId } = input; requireServer(serverId)
    const now = Date.now(), scanAt = input.scanAt === undefined ? now : integer(input.scanAt, now - GREETING_DAY, now + 1000)
    const scan = userId === undefined ? ctx.db.query("greetingDeliveries").withIndex("by_ready", q => q.eq("serverId", serverId).eq("state", "waiting").lte("nextCheckAt", scanAt)) : ctx.db.query("greetingDeliveries").withIndex("by_member_state", q => q.eq("serverId", serverId).eq("userId", userId).eq("state", "waiting").lte("nextCheckAt", scanAt))
    const page = await scan.paginate({ numItems: 10, cursor: input.cursor ?? null })
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

// Dashboard jobs carry the same operation as chat
export async function applyGreetingConfiguration(ctx: MutationCtx, serverId: string, value: unknown, now: number): Promise<GreetingsManageResult> {
    const op = decode(GreetingsManageRequest.fields.operation, value), identity = { serverId }, state = await greetingState(ctx, serverId)
    const config = structuredClone(state.config), activatedAt = { ...state.activatedAt }
    if (op.type === "settings") {
        if (op.claimsPerMinute !== undefined) config.claimsPerMinute = op.claimsPerMinute
        if (op.retentionDays !== undefined) config.retentionDays = op.retentionDays
    } else {
        const destination = op.route, current = config.routes[destination], revision = integer(current.revision, 1, Number.MAX_SAFE_INTEGER - 1) + 1
        if (op.type === "clear") {
            config.routes[destination] = { revision, enabled: false, timing: "join" }
            activatedAt[destination] = 0
        } else if (op.type === "module") {
            const enabled = op.enabled; if (enabled && (!current.content || destination !== "dm" && !current.channelId)) fail(409, "Greeting is not configured")
            config.routes[destination] = { ...current, enabled, revision }; if (enabled) activatedAt[destination] = now
        } else {
            const template = await ctx.db.query("publishingDrafts").withIndex("by_server_kind_name", q => q.eq("serverId", identity.serverId).eq("kind", "template").eq("name", name(op.templateName))).unique()
            if (!template) fail(404, "Greeting template not found")
            if (template.revision !== op.expectedTemplateRevision) fail(409, "Greeting template changed")
            config.routes[destination] = { revision, enabled: current.enabled, timing: op.timing ?? "join", templateName: template.name, templateRevision: template.revision, content: greetingTemplate(template.content, destination), ...(op.channelId !== undefined ? { channelId: op.channelId } : {}) }
            activatedAt[destination] = now
        }
        await ctx.scheduler.runAfter(0, internal.greetings.invalidate, { serverId: identity.serverId, route: destination })
    }
    const latest = await greetingState(ctx, identity.serverId)
    await ctx.db.patch(latest._id, { config, activatedAt }); return { duplicate: false, settings: config }
}
