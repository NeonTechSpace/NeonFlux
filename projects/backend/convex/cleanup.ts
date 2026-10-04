import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { v } from "convex/values"
import {
    CleanupManageRequest,
    CleanupManageOperation,
    CleanupQueryRequest,
    type CleanupManageResult,
    type CleanupPageItem,
    type CleanupQueryResult,
} from "@neonflux/contracts/cleanup"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import { advanceCleanup, cleanupContext, cleanupMessages } from "./cleanupDomain.ts"
import {
    cancelCleanupSweep,
    cleanupAdmin,
    cleanupAuthority,
    cleanupCount,
    cleanupDisposition,
    cleanupPolicy,
    cleanupReceipt,
    cleanupSettings,
    cleanupState,
    invalidateCleanupPolicy,
    orderedCleanupSource,
    publicCleanupPage,
    publicCleanupPolicy,
    publicCleanupSettings,
    publicCleanupSweep,
    publicCleanupTarget,
    readCleanupPage,
    readCleanupPolicy,
    readCleanupSweep,
} from "./cleanupStore.ts"
import { decode, fail, integer, source, type ConfigurationIdentity } from "./validation.ts"

export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<CleanupManageResult> => {
        const input = decode(CleanupManageRequest, request),
            identity = source(input, Date.now()),
            context = cleanupContext(input.context),
            raw = input.operation
        const critical = (raw.type === "module" || raw.type === "enable") && raw.enabled === false
        await cleanupAdmin(ctx, identity.serverId, context, critical)
        if (!(await cleanupReceipt(ctx, identity, context.actor.userId, raw))) return { duplicate: true }
        return applyCleanupManagement(
            ctx,
            {
                serverId: identity.serverId,
                actorId: context.actor.userId,
                createdAt: identity.createdAt,
                source: { kind: "chat", messageId: identity.messageId },
            },
            context,
            raw,
        )
    },
})

export const query = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<CleanupQueryResult> => {
        const input = decode(CleanupQueryRequest, request),
            serverId = input.serverId
        const context = cleanupContext(input.context),
            raw = input.operation
        await cleanupAdmin(ctx, serverId, context, true)
        if (raw.type === "settings") {
            return { type: "settings", settings: publicCleanupSettings(await cleanupSettings(ctx, serverId)) }
        }
        if (raw.type === "list") {
            return {
                type: "policies",
                policies: (
                    await ctx.db
                        .query("cleanupPolicies")
                        .withIndex("by_channel", (q) => q.eq("serverId", serverId))
                        .take(50)
                ).map(publicCleanupPolicy),
            }
        }
        const channelId = raw.channelId,
            policy = await cleanupPolicy(ctx, serverId, channelId)
        if (raw.type === "show") {
            return { type: "policy", policy: publicCleanupPolicy(policy) }
        }
        if (raw.type === "preview") {
            await cleanupAuthority(ctx, serverId, context, channelId)
            const cutoffAt = Date.now() - policy.ageMs,
                messages = cleanupMessages(raw.messages, channelId, serverId),
                items: CleanupPageItem[] = []
            for (const message of messages) {
                const reason = await cleanupDisposition(
                    ctx,
                    serverId,
                    message,
                    publicCleanupPolicy(policy),
                    cutoffAt,
                    true,
                )
                items.push({ message, disposition: reason ? "skipped" : "eligible", ...(reason ? { reason } : {}) })
            }
            const unknownReasons = ["identity-unknown", "pin-unknown", "timestamp-unknown"]
            return {
                type: "preview",
                cutoffAt,
                eligible: items.filter((x) => x.disposition === "eligible").length,
                skipped: items.filter((x) => x.disposition === "skipped").length,
                unknown: items.filter((x) => x.reason && unknownReasons.includes(x.reason)).length,
                items,
            }
        }
        if (raw.type !== "status") fail(400, "Unknown cleanup query")
        const before =
                raw.beforeTargetNo === undefined
                    ? Number.MAX_SAFE_INTEGER
                    : integer(raw.beforeTargetNo, 1, Number.MAX_SAFE_INTEGER),
            rows = await ctx.db
                .query("cleanupTargets")
                .withIndex("by_channel", (q) =>
                    q.eq("serverId", serverId).eq("channelId", channelId).lt("targetNo", before),
                )
                .order("desc")
                .take(11),
            targets = rows.slice(0, 10)
        const sweep = policy.sweepNo === undefined ? null : await readCleanupSweep(ctx, serverId, policy.sweepNo),
            page = sweep ? await readCleanupPage(ctx, serverId, sweep.sweepNo) : null
        return {
            type: "status",
            settings: publicCleanupSettings(await cleanupSettings(ctx, serverId)),
            policy: publicCleanupPolicy(policy),
            sweep: sweep ? publicCleanupSweep(sweep) : null,
            page: page ? publicCleanupPage(page) : null,
            targets: targets.map(publicCleanupTarget),
            ...(rows.length > 10 ? { nextBeforeTargetNo: targets.at(-1)!.targetNo } : {}),
        }
    },
})

export async function applyCleanupManagement(
    ctx: MutationCtx,
    identity: ConfigurationIdentity,
    context: ReturnType<typeof cleanupContext> | undefined,
    value: Record<string, unknown>,
): Promise<CleanupManageResult> {
    const raw = decode(CleanupManageOperation, value)
    const sourceOrder = (old: { acceptedCreatedAt?: number; acceptedMessageId?: string }) =>
        identity.source.kind === "chat"
            ? orderedCleanupSource({ messageId: identity.source.messageId, createdAt: identity.createdAt }, old)
            : {}
    const state = await cleanupState(ctx, identity.serverId)
    if (raw.type === "module") {
        const op = raw,
            enabled = op.enabled
        if (state.revision !== integer(op.expectedRevision, 1, Number.MAX_SAFE_INTEGER))
            fail(409, "Cleanup module revision changed")
        await ctx.db.patch(state._id, { enabled, revision: advanceCleanup(state.revision), ...sourceOrder(state) })
        const policies = await ctx.db
            .query("cleanupPolicies")
            .withIndex("by_channel", (q) => q.eq("serverId", identity.serverId))
            .take(50)
        for (const policy of policies) {
            if (policy.sweepNo !== undefined) {
                const sweep = await readCleanupSweep(ctx, identity.serverId, policy.sweepNo)
                if (sweep) await cancelCleanupSweep(ctx, sweep)
            }
            await ctx.db.patch(policy._id, { sweepNo: undefined, nextCheckAt: Date.now(), blockedReason: undefined })
        }
        return {
            duplicate: false,
            type: "settings",
            settings: publicCleanupSettings(await cleanupSettings(ctx, identity.serverId)),
        }
    }
    const channelId = raw.channelId
    let policy = await readCleanupPolicy(ctx, identity.serverId, channelId)
    if (raw.type === "configure") {
        const op = raw,
            ageMs = op.ageMs
        if (!context) fail(403, "Native cleanup owner required")
        await cleanupAuthority(ctx, identity.serverId, context, channelId)
        if (!policy) {
            if (op.expectedRevision !== 0) fail(409, "Cleanup policy revision changed")
            await cleanupCount(ctx, identity.serverId, "policies", 1)
            const id = await ctx.db.insert("cleanupPolicies", {
                serverId: identity.serverId,
                channelId,
                revision: 1,
                enabled: false,
                ageMs,
                ownerId: context.actor.userId,
                excludedAuthorIds: [],
                excludedMessageIds: [],
                nextCheckAt: Date.now(),
                ...sourceOrder({}),
            })
            policy = (await ctx.db.get(id))!
        } else {
            if (policy.revision !== integer(op.expectedRevision, 1, Number.MAX_SAFE_INTEGER))
                fail(409, "Cleanup policy revision changed")
            const ordered = sourceOrder(policy)
            await invalidateCleanupPolicy(ctx, policy)
            await ctx.db.patch(policy._id, {
                ageMs,
                ...ordered,
            })
            policy = (await ctx.db.get(policy._id))!
        }
        return { duplicate: false, type: "policy", policy: publicCleanupPolicy(policy) }
    }
    policy = await cleanupPolicy(ctx, identity.serverId, channelId, raw.expectedRevision)
    const ordered = sourceOrder(policy)
    if (raw.type === "enable") {
        const op = raw,
            enabled = op.enabled
        if (enabled) {
            if (!context) fail(403, "Native cleanup owner required")
            if (op.confirm !== true)
                fail(400, "Existing old messages may be deleted, explicit enable confirmation required")
            await cleanupAuthority(ctx, identity.serverId, context, channelId)
        }
        await invalidateCleanupPolicy(ctx, policy)
        await ctx.db.patch(policy._id, { enabled, ...(enabled ? { ownerId: context!.actor.userId } : {}), ...ordered })
    } else if (raw.type === "exclude") {
        const op = raw,
            id = op.id,
            add = op.add
        const key = op.kind === "author" ? "excludedAuthorIds" : "excludedMessageIds",
            old = policy[key],
            values = add ? Array.from(new Set([...old, id])) : old.filter((x) => x !== id)
        if (values.length > (op.kind === "author" ? 50 : 100))
            fail(
                429,
                `A channel keeps at most ${op.kind === "author" ? "50 excluded authors" : "100 excluded messages"}. Remove one first`,
                "REFUSED",
            )
        await invalidateCleanupPolicy(ctx, policy)
        await ctx.db.patch(policy._id, { [key]: values, ...ordered })
    } else fail(400, "Unknown cleanup management operation")
    return { duplicate: false, type: "policy", policy: publicCleanupPolicy((await ctx.db.get(policy._id))!) }
}

/**
 * Saves a policy's age, owner, exclusions and switch, as a backup restore does. A new policy counts toward the server's limit, and one that
 * exists drops its sweep and plan and takes its next revision first, as every change to it does. The caller has checked who may turn a policy on
 */
export async function saveCleanupPolicy(
    ctx: MutationCtx,
    serverId: string,
    policy: Doc<"cleanupPolicies"> | null,
    value: Pick<
        Doc<"cleanupPolicies">,
        "channelId" | "enabled" | "ageMs" | "ownerId" | "excludedAuthorIds" | "excludedMessageIds"
    >,
) {
    if (!policy) {
        await cleanupCount(ctx, serverId, "policies", 1)
        await ctx.db.insert("cleanupPolicies", { serverId, revision: 1, nextCheckAt: Date.now(), ...value })
        return
    }
    await invalidateCleanupPolicy(ctx, policy)
    const { channelId: _channelId, ...fields } = value
    await ctx.db.patch(policy._id, fields)
}
