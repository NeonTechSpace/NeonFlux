import { v } from "convex/values"
import type { MutationCtx } from "./_generated/server.js"
import {
    CounterManageRequest,
    CounterQueryRequest,
    CounterWorkRequest,
    type CounterOperation,
    type CounterView,
    type CounterWorkResult,
} from "@neonflux/contracts/counters"
import { changeConfiguration } from "./configurationChange.ts"
import { COUNTER_LIMIT } from "./countersDomain.ts"
import { counterView, readCounter, readCounters, readCounterSettings } from "./countersStore.ts"
import { actor } from "./moderationDomain.ts"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import { decode, fail, source, type ConfigurationIdentity } from "./validation.ts"

// Chat changes. The bot vouches for a server manager's fresh native authority, like sticky messages
export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<CounterView> => {
        const input = decode(CounterManageRequest, request)
        const identity = source(input, Date.now()),
            who = actor(input.actor),
            op = input.operation
        if (!who.nativePermissionAuthorized) fail(403, "Manage community permission required")
        return changeConfiguration(
            ctx,
            identity.serverId,
            "counters",
            {
                kind: "chat",
                createdAt: identity.createdAt,
                actor: { userId: who.userId, source: "command" },
                operation: op,
            },
            () =>
                applyCounterManagement(
                    ctx,
                    {
                        serverId: identity.serverId,
                        actorId: who.userId,
                        createdAt: identity.createdAt,
                        source: { kind: "chat", messageId: identity.messageId },
                    },
                    op,
                ),
        )
    },
})

/** Chat, the dashboard and a backup restore share these rules */
export async function applyCounterManagement(
    ctx: MutationCtx,
    identity: ConfigurationIdentity,
    op: CounterOperation,
): Promise<CounterView> {
    const { serverId } = identity,
        now = Date.now()
    if (op.type === "module") {
        const settings = await readCounterSettings(ctx, serverId)
        if (settings) await ctx.db.patch(settings._id, { enabled: op.enabled })
        else await ctx.db.insert("counterSettings", { serverId, enabled: op.enabled })
        return counterView(ctx, serverId)
    }
    const row = await readCounter(ctx, serverId, op.channelId)
    if (op.type === "remove") {
        if (!row) fail(404, "This channel has no counter")
        await ctx.db.delete(row._id)
    } else if (op.type === "set") {
        if (!row) fail(404, "This channel has no counter")
        await ctx.db.patch(row._id, {
            template: op.template,
            enabled: true,
            problem: undefined,
            countProblem: undefined,
            updatedAt: now,
            updatedBy: identity.actorId,
        })
    } else {
        const counted = {
            kind: op.kind,
            roleId: op.roleId,
            template: op.template,
            enabled: true,
            problem: undefined,
            countProblem: undefined,
        }
        if (row) await ctx.db.patch(row._id, { ...counted, updatedAt: now, updatedBy: identity.actorId })
        else {
            if ((await readCounters(ctx, serverId)).length >= COUNTER_LIMIT)
                fail(429, `A server can have at most ${COUNTER_LIMIT} counters`)
            await ctx.db.insert("counters", {
                serverId,
                channelId: op.channelId,
                kind: op.kind,
                ...(op.roleId ? { roleId: op.roleId } : {}),
                template: op.template,
                enabled: true,
                createdAt: now,
                updatedAt: now,
                updatedBy: identity.actorId,
            })
        }
    }
    return counterView(ctx, serverId)
}

/** What the bot loads once when a server starts and after a change it did not make itself. It makes no call per tick */
export const query = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<CounterView> =>
        counterView(ctx, decode(CounterQueryRequest, request).serverId),
})

/** A rename Fluxer refused turns the channel's counter off once, and the bot then tells the server */
export const work = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<CounterWorkResult> => {
        const input = decode(CounterWorkRequest, request),
            row = await readCounter(ctx, input.serverId, input.channelId)
        if (!row?.enabled || row.template !== input.template) return { recorded: false }
        if ("countProblem" in input) {
            await ctx.db.patch(row._id, { countProblem: input.countProblem ?? undefined, updatedAt: Date.now() })
            return { recorded: true }
        }
        await ctx.db.patch(row._id, { enabled: false, problem: input.reason, updatedAt: Date.now() })
        return { recorded: true }
    },
})
