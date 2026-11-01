import { v } from "convex/values"
import {
    BOT_RIGHTS,
    RIGHTS_ROLE_LIMIT,
    RIGHTS_SUSPENDED_COUNT_LIMIT,
    RIGHTS_SUSPENDED_PAGE,
    RightsGetRequest,
    RightsManageRequest,
    RightsStatusRequest,
    RightsSuspendRequest,
    rightsCritical,
    rightsOwnerOnly,
    type RightsOperation,
    type RightsResult,
    type RightsStatus,
    type RightsSuspendResult,
    type RightsView,
} from "@neonflux/contracts/rights"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { changeConfiguration } from "./configurationChange.ts"
import { actor, administrator, anyStaff } from "./moderationDomain.ts"
import { config as moderationConfig, readSettings as readModeration, requireAdministrator } from "./moderationStore.ts"
import { publicRights, readRights, readSuspension, suspendRights } from "./rightsStore.ts"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import { decode, fail, source } from "./validation.ts"

// How many rows of one right a clear deletes. A limit holds at most 50 in its window, so this covers one that was raised and lowered
const CLEAR_BATCH = 512
const RETENTION_BATCH = 256

const publicSuspension = (row: Doc<"rightsSuspensions">) => ({
    userId: row.userId,
    reason: row.reason,
    ...(row.right ? { right: row.right } : {}),
    at: row.at,
})
/** What the status command shows staff */
async function rightsStatus(ctx: QueryCtx | MutationCtx, serverId: string): Promise<RightsStatus> {
    const suspended = await ctx.db
        .query("rightsSuspensions")
        .withIndex("by_server_user", (q) => q.eq("serverId", serverId))
        .take(RIGHTS_SUSPENDED_PAGE + 1)
    return {
        settings: publicRights(await readRights(ctx, serverId)),
        suspended: suspended.slice(0, RIGHTS_SUSPENDED_PAGE).map(publicSuspension),
        moreSuspended: suspended.length > RIGHTS_SUSPENDED_PAGE,
    }
}
/** What the dashboard section shows any server manager: How many are suspended, not who */
export async function rightsView(ctx: QueryCtx | MutationCtx, serverId: string): Promise<RightsView> {
    const suspended = await ctx.db
        .query("rightsSuspensions")
        .withIndex("by_server_user", (q) => q.eq("serverId", serverId))
        .take(RIGHTS_SUSPENDED_COUNT_LIMIT)
    return { settings: publicRights(await readRights(ctx, serverId)), suspendedCount: suspended.length }
}

/** Chat and dashboard share these rules. Who may make each change is checked where each comes in, from a fresh read of that member */
export async function applyRightsManagement(
    ctx: MutationCtx,
    serverId: string,
    actorId: string,
    op: RightsOperation,
): Promise<RightsResult> {
    const row = await readRights(ctx, serverId),
        settings = publicRights(row)
    if (op.type === "clear") {
        const suspension = await readSuspension(ctx, serverId, op.userId)
        if (suspension) await ctx.db.delete(suspension._id)
        // Every right's count starts again too, or the member's next action would go over the same limit and suspend them at once. Older rows
        // are outside their window and retention takes them
        const now = Date.now()
        for (const right of BOT_RIGHTS) {
            const usage = await ctx.db
                .query("rightsUsage")
                .withIndex("by_member_right", (q) =>
                    q
                        .eq("serverId", serverId)
                        .eq("userId", op.userId)
                        .eq("right", right)
                        .gt("at", now - settings.limits[right].minutes * 60000),
                )
                .take(CLEAR_BATCH)
            for (const item of usage) await ctx.db.delete(item._id)
        }
        return { settings }
    }
    let patch: Partial<typeof settings> = {}
    if (op.type === "module") patch = { enabled: op.enabled }
    else if (op.type === "limit")
        patch = { limits: { ...settings.limits, [op.right]: { count: op.count, minutes: op.minutes } } }
    else if (op.type === "grant") {
        // The everyone role would hand the rights to every member
        if (op.roleId === serverId) fail(400, "Rights can't be granted to the everyone role", "REFUSED")
        const old = settings.grants.find((grant) => grant.roleId === op.roleId)
        if (!old && settings.grants.length >= RIGHTS_ROLE_LIMIT)
            fail(429, `At most ${RIGHTS_ROLE_LIMIT} roles can hold rights. Revoke one first`, "REFUSED")
        const rights = [...new Set([...(old?.rights ?? []), ...op.rights])]
        patch = {
            grants: [...settings.grants.filter((grant) => grant.roleId !== op.roleId), { roleId: op.roleId, rights }],
        }
    } else {
        const old = settings.grants.find((grant) => grant.roleId === op.roleId)
        const rights = op.rights ? old?.rights.filter((right) => !op.rights!.includes(right)) : []
        patch = {
            grants: [
                ...settings.grants.filter((grant) => grant.roleId !== op.roleId),
                ...(rights?.length ? [{ roleId: op.roleId, rights }] : []),
            ],
        }
    }
    const fields = { ...patch, updatedAt: Date.now(), updatedBy: actorId }
    if (row) await ctx.db.patch(row._id, fields)
    else await ctx.db.insert("rightsSettings", { serverId, ...settings, ...fields })
    return { settings: publicRights(await readRights(ctx, serverId)) }
}

export const get = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<RightsResult> => ({
        settings: publicRights(await readRights(ctx, decode(RightsGetRequest, request).serverId)),
    }),
})

export const status = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<RightsStatus> => {
        const input = decode(RightsStatusRequest, request),
            who = actor(input.actor),
            settings = moderationConfig(await readModeration(ctx, input.serverId))
        if (!anyStaff(who, settings)) fail(403, "Staff permission required")
        if (settings.defcon === 1 && !administrator(who)) fail(403, "DEFCON restriction")
        return rightsStatus(ctx, input.serverId)
    },
})

export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<RightsResult> => {
        const input = decode(RightsManageRequest, request),
            identity = source(input, Date.now()),
            op = input.operation
        const who = await requireAdministrator(ctx, identity.serverId, input.actor, rightsCritical(op))
        if (rightsOwnerOnly(op) && !who.isOwner) fail(403, "Owner permission required")
        return changeConfiguration(
            ctx,
            identity.serverId,
            "rights",
            {
                kind: "chat",
                createdAt: identity.createdAt,
                actor: { userId: who.userId, source: "command" },
                operation: op,
            },
            () => applyRightsManagement(ctx, identity.serverId, who.userId, op),
        )
    },
})

/** Anti-nuke fired on this account. A server with rights off has nothing to contain, and a suspension stays until the owner clears it */
export const suspend = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<RightsSuspendResult> => {
        const { serverId, userId } = decode(RightsSuspendRequest, request)
        if (!publicRights(await readRights(ctx, serverId)).enabled) return { suspended: false, admitted: false }
        return suspendRights(ctx, serverId, userId, "anti-nuke", Date.now())
    },
})

export async function cleanupRights(ctx: MutationCtx, now: number) {
    const rows = await ctx.db
        .query("rightsUsage")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(RETENTION_BATCH)
    for (const row of rows) await ctx.db.delete(row._id)
    return { removed: rows.length, more: rows.length === RETENTION_BATCH }
}
