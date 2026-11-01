import { v } from "convex/values"
import {
    JAIL_PAGE,
    JAIL_RECORD_LIMIT,
    JailDueRequest,
    JailHeldRequest,
    JailListRequest,
    JailManageRequest,
    JailMemoryRequest,
    JailReleaseRequest,
    JailReportRequest,
    JailStatusRequest,
    type JailDashboardOperation,
    type JailDueResult,
    type JailHeldResult,
    type JailListResult,
    type JailMemory,
    type JailReleaseResult,
    type JailReportResult,
    type JailResult,
    type JailSetupResult,
    type JailStatus,
} from "@neonflux/contracts/jail"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx } from "./_generated/server.js"
import { changeConfiguration } from "./configurationChange.ts"
import {
    jailedRows,
    jailView,
    publicJailEntry,
    publicJailSettings,
    readJailRecord,
    readJailSettings,
} from "./jailStore.ts"
import { admitSecurityRecord } from "./lockdownStore.ts"
import { reserveAction } from "./moderationActions.ts"
import { actor, authorize, privateRead } from "./moderationDomain.ts"
import {
    config as moderationConfig,
    readSettings as readModeration,
    requireAdministrator,
    state,
} from "./moderationStore.ts"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import { decode, fail, source } from "./validation.ts"

// How long a claimed release waits before it is due again, in case the worker never got to it
const RELEASE_LEASE_MS = 600000

/** Chat and dashboard share these rules. A dashboard setup carries the role and channel the bot found or made, see configurationNative.ts */
export async function applyJailManagement(
    ctx: MutationCtx,
    serverId: string,
    actorId: string,
    op: Exclude<JailDashboardOperation, { type: "setup" }> | ({ type: "setup" } & JailSetupResult),
): Promise<JailResult> {
    const row = await readJailSettings(ctx, serverId),
        settings = publicJailSettings(row)
    const staff = moderationConfig(await readModeration(ctx, serverId)).staffRoleIds
    const checkRole = async (roleId: string) => {
        // The jail role replaces every other role, so these would either keep their access or lose staff
        if (roleId === serverId) fail(400, "The everyone role can't be the jail role", "REFUSED")
        if (Object.values(staff).some((ids) => ids.includes(roleId)))
            fail(409, "A staff role can't be the jail role. Choose or create another", "REFUSED")
        // Stored jails hold the current role, and an unconfirmed one is settled by whether the member holds it
        if (settings.roleId !== roleId && (await jailedRows(ctx, serverId, 1)).length)
            fail(409, "Members are jailed with the current role. Unjail them before you change it", "REFUSED")
    }
    const now = Date.now()
    let fields: Partial<Pick<Doc<"jailSettings">, "enabled" | "roleId" | "channelId" | "setup">> = {}
    if (op.type === "module") {
        if (op.enabled && (!settings.roleId || !settings.channelId))
            fail(409, "Jail needs a role and a channel first. Run !jail setup", "REFUSED")
        fields = { enabled: op.enabled }
    } else if (op.type === "role") {
        await checkRole(op.roleId)
        fields = { roleId: op.roleId }
    } else if (op.type === "channel") fields = { channelId: op.channelId }
    else {
        await checkRole(op.roleId)
        fields = {
            enabled: true,
            roleId: op.roleId,
            channelId: op.channelId,
            setup: { state: "running", total: 0, done: 0, problems: [], moreProblems: 0, updatedAt: now },
        }
    }
    const change = { ...fields, updatedAt: now, updatedBy: actorId }
    if (row) await ctx.db.patch(row._id, change)
    else await ctx.db.insert("jailSettings", { serverId, enabled: false, ...change })
    return { settings: publicJailSettings(await readJailSettings(ctx, serverId)) }
}

// A server start reads this once and keeps it in memory, so joins and member updates cost no backend call. It also lists jails while the
// module is off, since members jailed before stay jailed and must not escape by rejoining
export const memory = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<JailMemory> => {
        const { serverId } = decode(JailMemoryRequest, request)
        const rows = await jailedRows(ctx, serverId, JAIL_RECORD_LIMIT)
        const row = await readJailSettings(ctx, serverId)
        return {
            settings: publicJailSettings(row),
            setupRunning: row?.setup?.state === "running",
            moderationRoleIds: moderationConfig(await readModeration(ctx, serverId)).staffRoleIds.moderation,
            jailedIds: rows.filter((row) => row.state === "active").map((row) => row.userId),
            confinedIds: rows.map((row) => row.userId),
        }
    },
})

export const status = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<JailStatus> => {
        const input = decode(JailStatusRequest, request)
        authorize(actor(input.actor), moderationConfig(await readModeration(ctx, input.serverId)), "moderation", true)
        return jailView(ctx, input.serverId)
    },
})

export const list = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<JailListResult> => {
        const input = decode(JailListRequest, request),
            { serverId, afterUserId } = input
        const settings = moderationConfig(await readModeration(ctx, serverId))
        authorize(actor(input.actor), settings, "moderation", true)
        privateRead(input, settings, "moderation")
        const rows = await ctx.db
            .query("jailRecords")
            .withIndex("by_server_user", (q) =>
                afterUserId === undefined
                    ? q.eq("serverId", serverId)
                    : q.eq("serverId", serverId).gt("userId", afterUserId),
            )
            .take(JAIL_PAGE + 1)
        const shown = rows.slice(0, JAIL_PAGE)
        return {
            entries: shown.map(publicJailEntry),
            ...(rows.length > JAIL_PAGE ? { nextAfterUserId: shown.at(-1)!.userId } : {}),
        }
    },
})

export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<JailResult> => {
        const input = decode(JailManageRequest, request),
            identity = source(input, Date.now()),
            op = input.operation
        const who = await requireAdministrator(ctx, identity.serverId, input.actor, op.type === "module" && !op.enabled)
        return changeConfiguration(
            ctx,
            identity.serverId,
            "jail",
            {
                kind: "chat",
                createdAt: identity.createdAt,
                actor: { userId: who.userId, source: "command" },
                operation: op,
            },
            () => applyJailManagement(ctx, identity.serverId, who.userId, op),
        )
    },
})

/** The channel pass's progress, which !jail status and the dashboard read */
export const report = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<JailReportResult> => {
        const { serverId, setup } = decode(JailReportRequest, request)
        const row = await readJailSettings(ctx, serverId)
        if (!row) return { recorded: false }
        await ctx.db.patch(row._id, { setup: { ...setup, problems: [...setup.problems], updatedAt: Date.now() } })
        return { recorded: true }
    },
})

/** The next jails whose length ended. Each waits a while before it is due again, so one the worker cannot release never holds up the rest */
export const due = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<JailDueResult> => {
        const { serverId } = decode(JailDueRequest, request),
            now = Date.now()
        const rows = await ctx.db
            .query("jailRecords")
            .withIndex("by_server_due", (q) => q.eq("serverId", serverId).eq("timed", true).lte("nextCheckAt", now))
            .take(JAIL_PAGE)
        for (const row of rows) await ctx.db.patch(row._id, { nextCheckAt: now + RELEASE_LEASE_MS })
        return { userIds: rows.map((row) => row.userId) }
    },
})

/** Opens the unjail of a jail whose length ended, from the bot's fresh read of the member. A jail that changed since has nothing due */
export const release = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<JailReleaseResult> => {
        const { serverId, userId, context } = decode(JailReleaseRequest, request),
            now = Date.now()
        const record = await readJailRecord(ctx, serverId, userId)
        if (!record || record.state !== "active" || record.releaseAt === undefined || record.releaseAt > now) return {}
        return reserveAction(ctx, {
            serverId,
            sourceId: `jail:${record.caseNo}`,
            settings: moderationConfig(await state(ctx, serverId)),
            input: { type: "unjail", targetId: userId, reason: "Jail length ended", linkedCaseNo: record.caseNo },
            context,
            origin: "jail",
            now,
        })
    },
})

/** Records that NeonFlux held a jailed member again, which reaches staff through the security log */
export const held = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<JailHeldResult> => {
        const { serverId, userId, kind, outcome, at } = decode(JailHeldRequest, request)
        return {
            admitted: await admitSecurityRecord(ctx, serverId, `jail:${userId}:${at}:${kind}`, {
                type: "jail-change",
                resourceIds: [userId],
                changedFields: [kind === "rejoin" ? "jail-rejoin" : "jail-stripped", outcome],
            }),
        }
    },
})
