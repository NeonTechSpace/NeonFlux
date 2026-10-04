import type { MutationCtx } from "./_generated/server.js"
import { v } from "convex/values"
import type { CleanupManageResult, CleanupPageItem, CleanupQueryResult } from "../contracts.js"
import { internalMutation, internalQuery } from "./_generated/server.js"
import { shape } from "./publishingDomain.ts"
import { advanceCleanup, cleanupAge, cleanupContext, cleanupMessages } from "./cleanupDomain.ts"
import { cancelCleanupSweep, cleanupAdmin, cleanupAuthority, cleanupCount, cleanupDisposition, cleanupPolicy, cleanupReceipt, cleanupSettings, cleanupState, invalidateCleanupPolicy, orderedCleanupSource, publicCleanupPage, publicCleanupPolicy, publicCleanupSettings, publicCleanupSweep, publicCleanupTarget, readCleanupPage, readCleanupPolicy, readCleanupSweep } from "./cleanupStore.ts"
import { fail, requireId, requireServer, bool, integer, source, type ConfigurationIdentity } from "./validation.ts"

export const manage = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<CleanupManageResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "context", "operation"], ["serverId", "messageId", "createdAt", "context", "operation"]), identity = source(input, Date.now()), context = cleanupContext(input.context), raw = shape(input.operation, ["type", "channelId", "expectedRevision", "enabled", "ageMs", "confirm", "kind", "id", "add", "ownerId"])
    const critical = (raw.type === "module" || raw.type === "enable") && raw.enabled === false
    await cleanupAdmin(ctx, identity.serverId, context, critical)
    if (!await cleanupReceipt(ctx, identity, context.actor.userId, raw)) return { duplicate: true }
    const result = await applyCleanupManagement(ctx, { serverId: identity.serverId, actorId: context.actor.userId, createdAt: identity.createdAt, source: { kind: "chat", messageId: identity.messageId } }, context, raw)
    return result
} })

export const query = internalQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<CleanupQueryResult> => {
    const input = shape(request, ["serverId", "context", "operation"], ["serverId", "context", "operation"]), serverId = requireId(input.serverId); requireServer(serverId)
    const context = cleanupContext(input.context), raw = shape(input.operation, ["type", "channelId", "beforeTargetNo", "messages"])
    await cleanupAdmin(ctx, serverId, context, true)
    if (raw.type === "settings") { shape(raw, ["type"], ["type"]); return { type: "settings", settings: publicCleanupSettings(await cleanupSettings(ctx, serverId)) } }
    if (raw.type === "list") { shape(raw, ["type"], ["type"]); return { type: "policies", policies: (await ctx.db.query("cleanupPolicies").withIndex("by_channel", q => q.eq("serverId", serverId)).take(50)).map(publicCleanupPolicy) } }
    const channelId = requireId(raw.channelId), policy = await cleanupPolicy(ctx, serverId, channelId)
    if (raw.type === "show") { shape(raw, ["type", "channelId"], ["type", "channelId"]); return { type: "policy", policy: publicCleanupPolicy(policy) } }
    if (raw.type === "preview") {
        shape(raw, ["type", "channelId", "messages"], ["type", "channelId", "messages"])
        await cleanupAuthority(ctx, serverId, context, channelId)
        const cutoffAt = Date.now() - policy.ageMs, messages = cleanupMessages(raw.messages, channelId, serverId), items: CleanupPageItem[] = []
        for (const message of messages) { const reason = await cleanupDisposition(ctx, serverId, message, publicCleanupPolicy(policy), cutoffAt, true); items.push({ message, disposition: reason ? "skipped" : "eligible", ...(reason ? { reason } : {}) }) }
        const unknownReasons = ["identity-unknown", "pin-unknown", "timestamp-unknown"]
        return { type: "preview", cutoffAt, eligible: items.filter(x => x.disposition === "eligible").length, skipped: items.filter(x => x.disposition === "skipped").length, unknown: items.filter(x => x.reason && unknownReasons.includes(x.reason)).length, items }
    }
    if (raw.type !== "status") fail(400, "Unknown cleanup query")
    shape(raw, ["type", "channelId", "beforeTargetNo"], ["type", "channelId"])
    const before = raw.beforeTargetNo === undefined ? Number.MAX_SAFE_INTEGER : integer(raw.beforeTargetNo, 1, Number.MAX_SAFE_INTEGER), rows = await ctx.db.query("cleanupTargets").withIndex("by_channel", q => q.eq("serverId", serverId).eq("channelId", channelId).lt("targetNo", before)).order("desc").take(21), targets = rows.slice(0, 20)
    const sweep = policy.sweepNo === undefined ? null : await readCleanupSweep(ctx, serverId, policy.sweepNo), page = sweep ? await readCleanupPage(ctx, serverId, sweep.sweepNo) : null
    return { type: "status", settings: publicCleanupSettings(await cleanupSettings(ctx, serverId)), policy: publicCleanupPolicy(policy), sweep: sweep ? publicCleanupSweep(sweep) : null, page: page ? publicCleanupPage(page) : null, targets: targets.map(publicCleanupTarget), ...(rows.length > 20 ? { nextBeforeTargetNo: targets.at(-1)!.targetNo } : {}) }
} })

export async function applyCleanupManagement(ctx: MutationCtx, identity: ConfigurationIdentity, context: ReturnType<typeof cleanupContext> | undefined, raw: Record<string, unknown>): Promise<CleanupManageResult> {
    const sourceOrder = (old: { acceptedCreatedAt?: number, acceptedMessageId?: string }) => orderedCleanupSource({ messageId: identity.source.messageId, createdAt: identity.createdAt }, old)
    const state = await cleanupState(ctx, identity.serverId)
    if (raw.type === "module") {
        const op = shape(raw, ["type", "expectedRevision", "enabled"], ["type", "expectedRevision", "enabled"]), enabled = bool(op.enabled)
        if (state.revision !== integer(op.expectedRevision, 1, Number.MAX_SAFE_INTEGER)) fail(409, "Cleanup module revision changed")
        await ctx.db.patch(state._id, { enabled, revision: advanceCleanup(state.revision), ...sourceOrder( state) })
        const policies = await ctx.db.query("cleanupPolicies").withIndex("by_channel", q => q.eq("serverId", identity.serverId)).take(50)
        for (const policy of policies) {
            if (policy.sweepNo !== undefined) { const sweep = await readCleanupSweep(ctx, identity.serverId, policy.sweepNo); if (sweep) await cancelCleanupSweep(ctx, sweep) }
            await ctx.db.patch(policy._id, { sweepNo: undefined, nextCheckAt: Date.now(), blockedReason: undefined })
        }
        return { duplicate: false, type: "settings", settings: publicCleanupSettings(await cleanupSettings(ctx, identity.serverId)) }
    }
    const channelId = requireId(raw.channelId)
    if(raw.type === "policy-delete") {
        shape(raw,["type","channelId","expectedRevision","confirm"],["type","channelId","expectedRevision","confirm"])
        if(raw.confirm!==true)fail(400,"Policy deletion requires confirmation")
        const policy=await cleanupPolicy(ctx,identity.serverId,channelId,raw.expectedRevision)
        if(policy.enabled || policy.sweepNo!==undefined) fail(409,"Disable and settle the cleanup policy first")
        const active=await ctx.db.query("cleanupTargets").withIndex("by_channel_active",q=>q.eq("serverId",identity.serverId).eq("channelId",channelId).eq("active",true)).first(),unresolved=await ctx.db.query("cleanupTargets").withIndex("by_channel_unresolved",q=>q.eq("serverId",identity.serverId).eq("channelId",channelId).eq("replayBlocked",true).eq("expiresAt",undefined)).first()
        if(active || unresolved)fail(409,"Unsettled cleanup evidence preserved")
        await ctx.db.delete(policy._id);await cleanupCount(ctx,identity.serverId,"policies",-1)
        return {duplicate:false,type:"forgotten",removed:1,complete:true}
    }
    let policy = await readCleanupPolicy(ctx, identity.serverId, channelId)
    if (raw.type === "configure") {
        const op = shape(raw, ["type", "channelId", "expectedRevision", "ageMs"], ["type", "channelId", "expectedRevision", "ageMs"]), ageMs = cleanupAge(op.ageMs)
        if (!context) fail(403, "Native cleanup owner required")
        await cleanupAuthority(ctx, identity.serverId, context, channelId)
        if (!policy) {
            if (op.expectedRevision !== 0) fail(409, "Cleanup policy revision changed")
            await cleanupCount(ctx, identity.serverId, "policies", 1)
            const id = await ctx.db.insert("cleanupPolicies", { serverId: identity.serverId, channelId, revision: 1, enabled: false, ageMs, ownerId: context.actor.userId, excludedAuthorIds: [], excludedMessageIds: [], nextCheckAt: Date.now(), ...sourceOrder( {}) })
            policy = (await ctx.db.get(id))!
        } else {
            if (policy.revision !== integer(op.expectedRevision, 1, Number.MAX_SAFE_INTEGER)) fail(409, "Cleanup policy revision changed")
            const ordered = sourceOrder( policy)
            await invalidateCleanupPolicy(ctx, policy)
            await ctx.db.patch(policy._id, { ageMs, ...ordered })
            policy = (await ctx.db.get(policy._id))!
        }
        return { duplicate: false, type: "policy", policy: publicCleanupPolicy(policy) }
    }
    policy = await cleanupPolicy(ctx, identity.serverId, channelId, raw.expectedRevision)
    const ordered = sourceOrder( policy)
    if (raw.type === "enable") {
        const op = shape(raw, ["type", "channelId", "expectedRevision", "enabled", "confirm"], ["type", "channelId", "expectedRevision", "enabled"]), enabled = bool(op.enabled)
        if (enabled) { if (!context) fail(403, "Native cleanup owner required"); if (op.confirm !== true) fail(400, "Existing old messages may be deleted, explicit enable confirmation required"); await cleanupAuthority(ctx, identity.serverId, context, channelId, policy.ownerId) }
        await invalidateCleanupPolicy(ctx, policy)
        await ctx.db.patch(policy._id, { enabled, ...ordered })
    } else if (raw.type === "exclude") {
        const op = shape(raw, ["type", "channelId", "expectedRevision", "kind", "id", "add"], ["type", "channelId", "expectedRevision", "kind", "id", "add"]), id = requireId(op.id), add = bool(op.add)
        if (op.kind !== "author" && op.kind !== "message") fail(400, "Invalid cleanup exclusion")
        const key = op.kind === "author" ? "excludedAuthorIds" : "excludedMessageIds", old = policy[key], values = add ? Array.from(new Set([...old, id])) : old.filter(x => x !== id)
        if (values.length > (op.kind === "author" ? 50 : 100)) fail(429, "Cleanup exclusion capacity reached")
        await invalidateCleanupPolicy(ctx, policy)
        await ctx.db.patch(policy._id, { [key]: values, ...ordered })
    } else fail(400, "Unknown cleanup management operation")
    return { duplicate: false, type: "policy", policy: publicCleanupPolicy((await ctx.db.get(policy._id))!) }
}
