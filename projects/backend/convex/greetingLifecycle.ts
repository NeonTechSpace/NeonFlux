import { v } from "convex/values"
import type { GreetingsBinding, GreetingsContext, GreetingsDelivery, GreetingsDispatchResult, GreetingsMember, GreetingsOutcomeResult, GreetingsReserveResult } from "../contracts.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { internalMutation } from "./_generated/server.js"
import { serviceMutation } from "./installations.ts"
import { internal } from "./_generated/api.js"
import { canonicalPublishingContent, shape } from "./publishingDomain.ts"
import { claimToken, epoch } from "./rolesDomain.ts"
import { rolesAcknowledgment, readRolesSettings } from "./rolesStore.ts"
import { participationAvailability } from "./roleClaims.ts"
import { fail, requireId, requireServer, integer } from "./validation.ts"
import { defaultGreetings, greetingContext, route, GREETING_DAY, GREETING_WINDOW, GREETING_NATIVE, GREETING_MARGIN, GREETING_BATCH } from "./greetingsDomain.ts"
import { retentionPass } from "./retentionStore.ts"
export type GreetingRead = MutationCtx | QueryCtx
export const readGreetingSettings = (ctx: GreetingRead, serverId: string) => ctx.db.query("greetingSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
export async function greetingState(ctx: MutationCtx, serverId: string) {
    const old = await readGreetingSettings(ctx, serverId); if (old) return old
    const id = await ctx.db.insert("greetingSettings", { serverId, config: defaultGreetings(), activatedAt: { welcome: 0, dm: 0, goodbye: 0 }, nextGeneration: 1, nextDeliveryNo: 1, nextClaimAt: 0 })
    return (await ctx.db.get(id))!
}
export const greetingMemberRow = (ctx: GreetingRead, serverId: string, userId: string) => ctx.db.query("greetingMembers").withIndex("by_server_user", q => q.eq("serverId", serverId).eq("userId", userId)).unique()
export function publicGreetingMember(row: Doc<"greetingMembers">): GreetingsMember { return { userId: row.userId, joinedAt: row.joinedAt, generation: row.generation, present: row.present, observedAt: row.observedAt, expiresAt: row.expiresAt } }
export function publicGreetingDelivery(row: Doc<"greetingDeliveries">): GreetingsDelivery {
    return { deliveryId: row._id, deliveryNo: row.deliveryNo, route: row.route, routeRevision: row.routeRevision, userId: row.userId, joinedAt: row.joinedAt, memberGeneration: row.memberGeneration, state: row.state, createdAt: row.createdAt, pendingExpiresAt: row.pendingExpiresAt, nextCheckAt: row.nextCheckAt,
        ...(row.reason ? { reason: row.reason } : {}), ...(row.grant ? { grant: { ...row.grant, canonicalContent: canonicalPublishingContent(row.grant.canonicalContent) } } : {}), ...(row.claimedAt !== undefined ? { claimedAt: row.claimedAt } : {}), ...(row.finishedAt !== undefined ? { finishedAt: row.finishedAt } : {}), ...(row.noDispatch ? { noDispatch: true } : {}), ...(row.messageId ? { messageId: row.messageId } : {}), ...(row.channelId ? { channelId: row.channelId } : {}) }
}
export async function greetingDelivery(ctx: GreetingRead, serverId: string, value: unknown) {
    if (typeof value !== "string" || value.length > 256) fail(400, "Invalid greeting delivery")
    const id = ctx.db.normalizeId("greetingDeliveries", value), row = id ? await ctx.db.get(id) : null
    if (!row || row.serverId !== serverId) fail(404, "Greeting delivery not found")
    return row
}
export async function boundGreeting(ctx: GreetingRead, input: Record<string, unknown>) {
    const serverId = requireId(input.serverId); requireServer(serverId)
    const row = await greetingDelivery(ctx, serverId, input.deliveryId)
    if (route(input.route) !== row.route || integer(input.routeRevision, 1, Number.MAX_SAFE_INTEGER) !== row.routeRevision || requireId(input.userId) !== row.userId || epoch(input.joinedAt) !== row.joinedAt || integer(input.memberGeneration, 1, Number.MAX_SAFE_INTEGER) !== row.memberGeneration) fail(409, "Greeting binding changed")
    return row
}
export async function finishGreeting(ctx: MutationCtx, row: Doc<"greetingDeliveries">, state: "sent" | "failed" | "uncertain" | "cancelled" | "expired", reason?: Doc<"greetingDeliveries">["reason"], noDispatch = false) {
    const settings = await greetingState(ctx, row.serverId), now = Date.now()
    await ctx.db.patch(row._id, { state, active: false, finishedAt: now, expiresAt: now + settings.config.retentionDays * GREETING_DAY, ...(reason ? { reason } : {}), ...(noDispatch ? { noDispatch: true } : {}) })
}
export async function currentGreeting(ctx: MutationCtx, row: Doc<"greetingDeliveries">) {
    const state = await greetingState(ctx, row.serverId), member = await greetingMemberRow(ctx, row.serverId, row.userId), config = state.config.routes[row.route], now = Date.now()
    if (row.claimedAt !== undefined) return { member, config, valid: true }
    if (now >= row.pendingExpiresAt) { await finishGreeting(ctx, row, "expired", "lifetime", true); return { member, config, valid: false } }
    if (!config.enabled || config.revision !== row.routeRevision) { await finishGreeting(ctx, row, "cancelled", "configuration", true); return { member, config, valid: false } }
    if (!member || member.expiresAt <= now || member.generation !== row.memberGeneration || member.joinedAt !== row.joinedAt || member.present !== (row.route !== "goodbye")) { await finishGreeting(ctx, row, "cancelled", "membership", true); return { member, config, valid: false } }
    return { member, config, valid: true }
}
export async function greetingEligible(ctx: GreetingRead, row: Doc<"greetingDeliveries">, context: GreetingsContext) {
    const member = context.member
    if (!context.botAuthorized || row.userId === context.botId || (row.route === "goodbye" ? !context.memberAbsent : !member || member.userId !== row.userId || member.joinedAt !== row.joinedAt || member.isBot)) return false
    if (row.route !== "dm" && context.channelId !== row.channelId) return false
    try { await participationAvailability(ctx, row.serverId, { userId: row.userId, joinedAt: row.joinedAt, isBot: false, roleIds: member?.roleIds ?? [], timeoutUntil: member?.timeoutUntil ?? null, botId: context.botId, botAuthorized: true, roles: [] }) }
    catch { return false }
    if (row.timing === "verified" && row.route !== "goodbye") {
        const settings = await readRolesSettings(ctx, row.serverId), panel = await ctx.db.query("rolePanels").withIndex("by_server_kind", q => q.eq("serverId", row.serverId).eq("kind", "verification")).unique()
        if (!settings?.config.verificationEnabled || !panel?.enabled || panel.withdrawing || !panel.published || panel.revision !== panel.published.revision) return false
        const ack = await rolesAcknowledgment(ctx, row.serverId, row.userId, row.joinedAt, member!.roleIds)
        if (!ack.acknowledged || !ack.accessConfirmed || !ack.accessRolePresent) return false
    }
    return true
}
export async function wakeGreetings(ctx: MutationCtx, serverId: string, userId: string, joinedAt: string) {
    const rows = await ctx.db.query("greetingDeliveries").withIndex("by_member_epoch_state", q => q.eq("serverId", serverId).eq("userId", userId).eq("joinedAt", joinedAt).eq("state", "waiting")).take(4)
    for (const row of rows) if (row.joinedAt === joinedAt && row.active) await ctx.db.patch(row._id, { state: "ready", nextCheckAt: Date.now() })
}
export const reserve = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GreetingsReserveResult> => {
    const input = shape(request, ["serverId", "deliveryId", "route", "routeRevision", "userId", "joinedAt", "memberGeneration", "context"], ["serverId", "deliveryId", "route", "routeRevision", "userId", "joinedAt", "memberGeneration", "context"]), row = await boundGreeting(ctx, input), now = Date.now(), context = greetingContext(input.context, now, row.userId)
    if (!row.active) return { status: "terminal" }
    if (row.claimedAt !== undefined) return { status: "terminal" }
    const current = await currentGreeting(ctx, row)
    if (!current.valid) return { status: now >= row.pendingExpiresAt ? "expired" : "cancelled" }
    if (context.observedAt < current.member!.observedAt) fail(409, "Greeting observation is stale")
    if (row.state === "reserved" && row.grant) return { status: "reserved", grant: { ...row.grant, canonicalContent: canonicalPublishingContent(row.grant.canonicalContent) } }
    if (now < row.nextCheckAt) return { status: "waiting" }
    if (!await greetingEligible(ctx, row, context)) {
        await ctx.db.patch(row._id, { state: row.timing === "verified" ? "waiting" : "ready", reason: row.timing === "verified" ? "verification" : "eligibility", nextCheckAt: now + 60000 }); return { status: "waiting" }
    }
    const grant = { deliveryId: row._id, deliveryNo: row.deliveryNo, route: row.route, routeRevision: row.routeRevision, templateName: row.templateName, templateRevision: row.templateRevision, userId: row.userId, joinedAt: row.joinedAt, memberGeneration: row.memberGeneration, botId: context.botId, content: row.content, canonicalContent: canonicalPublishingContent(row.content), dispatchExpiresAt: now + GREETING_WINDOW, nativeDeadlineMs: GREETING_NATIVE as 5000, ...(row.channelId ? { channelId: row.channelId } : {}) }
    await ctx.db.patch(row._id, { state: "reserved", grant }); return { status: "reserved", grant }
} })
export const dispatch = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GreetingsDispatchResult> => {
    const input = shape(request, ["serverId", "deliveryId", "route", "routeRevision", "userId", "joinedAt", "memberGeneration", "claimToken", "context"], ["serverId", "deliveryId", "route", "routeRevision", "userId", "joinedAt", "memberGeneration", "claimToken", "context"]), row = await boundGreeting(ctx, input), now = Date.now(), context = greetingContext(input.context, now, row.userId), capability = claimToken(input.claimToken), settings = await greetingState(ctx, row.serverId)
    if (!row.grant) fail(409, "Greeting was not reserved")
    const denied = { claimed: false, dispatchExpiresAt: row.grant.dispatchExpiresAt, nativeDeadlineMs: 5000 as const, nextClaimAt: settings.nextClaimAt }
    if (!row.active || row.state !== "reserved" || row.claimedAt !== undefined) return denied
    if (now >= row.grant.dispatchExpiresAt) { await finishGreeting(ctx, row, "failed", "lifetime", true); return denied }
    const current = await currentGreeting(ctx, row)
    if (!current.valid || context.observedAt < current.member!.observedAt || context.botId !== row.grant.botId || !await greetingEligible(ctx, row, context)) return denied
    if (now < settings.nextClaimAt) return denied
    const nextClaimAt = now + Math.ceil(60000 / settings.config.claimsPerMinute)
    await ctx.db.patch(row._id, { claimedAt: now, claimToken: capability }); await ctx.db.patch(settings._id, { nextClaimAt })
    return { claimed: true, dispatchExpiresAt: row.grant.dispatchExpiresAt, nativeDeadlineMs: 5000, nextClaimAt }
} })
export const outcome = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<GreetingsOutcomeResult> => {
    const input = shape(request, ["serverId", "deliveryId", "route", "routeRevision", "userId", "joinedAt", "memberGeneration", "claimToken", "outcome", "noDispatch", "messageId", "channelId"], ["serverId", "deliveryId", "route", "routeRevision", "userId", "joinedAt", "memberGeneration", "outcome"]), row = await boundGreeting(ctx, input), capability = input.claimToken === undefined ? undefined : claimToken(input.claimToken)
    if (!["sent", "failed", "uncertain"].includes(String(input.outcome)) || input.noDispatch !== undefined && input.noDispatch !== true) fail(400, "Invalid greeting outcome")
    if (row.claimedAt === undefined ? capability !== undefined || input.outcome !== "failed" || input.noDispatch !== true : capability !== row.claimToken) fail(409, "Greeting claim mismatch")
    const messageId = input.messageId === undefined ? undefined : requireId(input.messageId), channelId = input.channelId === undefined ? undefined : requireId(input.channelId)
    if ((messageId === undefined) !== (channelId === undefined) || input.outcome === "sent" && !messageId || input.outcome === "failed" && input.noDispatch !== true || input.noDispatch === true && (messageId !== undefined || input.outcome !== "failed")) fail(400, "Invalid greeting delivery evidence")
    if (messageId && row.route !== "dm" && channelId !== row.channelId) fail(409, "Greeting destination changed")
    if (row.messageId && messageId && (row.messageId !== messageId || row.channelId !== channelId)) fail(409, "Greeting identity changed")
    if (!row.active) {
        if (row.state === "uncertain" && messageId && !row.messageId) { await ctx.db.patch(row._id, { messageId, channelId }); return { recorded: true } }
        if (row.state !== input.outcome) fail(409, "Greeting outcome is immutable")
        return { recorded: false }
    }
    if (row.state !== "reserved") fail(409, "Greeting was not reserved")
    await finishGreeting(ctx, row, input.outcome as "sent" | "failed" | "uncertain", undefined, input.noDispatch === true)
    if (messageId) await ctx.db.patch(row._id, { messageId, channelId })
    return { recorded: true }
} })
export const defer = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }) => {
    const input = shape(request, ["serverId", "deliveryId", "route", "routeRevision", "userId", "joinedAt", "memberGeneration", "reason"], ["serverId", "deliveryId", "route", "routeRevision", "userId", "joinedAt", "memberGeneration", "reason"]), row = await boundGreeting(ctx, input)
    if (input.reason !== "verification" && input.reason !== "eligibility") fail(400, "Invalid greeting deferral")
    if (!row.active || row.claimedAt !== undefined || row.state === "reserved") return { deferred: false }
    if (!(await currentGreeting(ctx, row)).valid) return { deferred: false }
    await ctx.db.patch(row._id, { state: input.reason === "verification" ? "waiting" : "ready", reason: input.reason, nextCheckAt: Date.now() + 60000 }); return { deferred: true }
} })
export async function cleanupGreetings(ctx: MutationCtx, now: number) {
    let continuation = false
    const reserved = await ctx.db.query("greetingDeliveries").withIndex("by_reserved", q => q.eq("state", "reserved").lte("grant.dispatchExpiresAt", now - GREETING_NATIVE - GREETING_MARGIN)).take(GREETING_BATCH)
    for (const row of reserved) if (row.active) await finishGreeting(ctx, row, row.claimedAt === undefined ? "failed" : "uncertain", "lifetime", row.claimedAt === undefined)
    continuation ||= reserved.length === GREETING_BATCH
    const active = await ctx.db.query("greetingDeliveries").withIndex("by_active_expiry", q => q.eq("active", true).eq("claimedAt", undefined).lte("pendingExpiresAt", now)).take(GREETING_BATCH)
    for (const row of active) if (row.claimedAt === undefined) await finishGreeting(ctx, row, "expired", "lifetime", true)
    continuation ||= active.length === GREETING_BATCH
    const receipts = await ctx.db.query("greetingReceipts").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(GREETING_BATCH)
    for (const r of receipts) await ctx.db.delete(r._id)
    continuation ||= receipts.length === GREETING_BATCH
    const deliveries = await ctx.db.query("greetingDeliveries").withIndex("by_expiry", q => q.gt("expiresAt", 0).lte("expiresAt", now)).take(GREETING_BATCH)
    for (const r of deliveries) await ctx.db.delete(r._id)
    continuation ||= deliveries.length === GREETING_BATCH
    const members = await ctx.db.query("greetingMembers").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(GREETING_BATCH)
    for (const r of members) await ctx.db.delete(r._id)
    continuation ||= members.length === GREETING_BATCH
    return { more: continuation }
}

// One pass that continues itself while a batch is full. The cron runs it through the retention chain in retention.ts
export const cleanup = internalMutation({ args: {}, handler: async ctx => {
    if ((await retentionPass(ctx, cleanupGreetings)).more) await ctx.scheduler.runAfter(0, internal.greetingLifecycle.cleanup, {})
    return { cleaned: true }
} })
