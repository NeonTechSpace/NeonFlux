import { v } from "convex/values"
import { serviceMutation } from "./serviceGuard.ts"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import {
    COMMAND_RULE_LIMIT,
    CommandRuleOperation,
    CommandRulesManageRequest,
    type CommandRule,
    type CommandRulesState,
} from "@neonflux/contracts/command-rules"
import { changeConfiguration } from "./configurationChange.ts"
import { actor } from "./moderationDomain.ts"
import { decode, fail, source } from "./validation.ts"

type Read = Pick<QueryCtx, "db">
export const publicCommandRule = (row: Doc<"commandRules">): CommandRule => ({
    command: row.command as CommandRule["command"],
    channelIds: row.channelIds,
    roleIds: row.roleIds,
    updatedAt: row.updatedAt,
})
/** Every rule of a server, by command name. The bot reads them with the prefix, so they cost no call of their own */
export const readCommandRules = async (ctx: Read, serverId: string): Promise<CommandRule[]> =>
    (
        await ctx.db
            .query("commandRules")
            .withIndex("by_command", (q) => q.eq("serverId", serverId))
            .take(COMMAND_RULE_LIMIT)
    ).map(publicCommandRule)

// Chat commands and dashboard saves share these rules. A rule with no limit left is removed
export async function applyCommandRule(
    ctx: MutationCtx,
    serverId: string,
    value: unknown,
    now = Date.now(),
): Promise<CommandRulesState> {
    const op = decode(CommandRuleOperation, value),
        row = await ctx.db
            .query("commandRules")
            .withIndex("by_command", (q) => q.eq("serverId", serverId).eq("command", op.command))
            .unique()
    const channelIds = op.type === "clear" ? [] : (op.channelIds ?? row?.channelIds ?? []),
        roleIds = op.type === "clear" ? [] : (op.roleIds ?? row?.roleIds ?? [])
    if (!channelIds.length && !roleIds.length) {
        if (row) await ctx.db.delete(row._id)
    } else if (row) await ctx.db.patch(row._id, { channelIds: [...channelIds], roleIds: [...roleIds], updatedAt: now })
    else {
        if ((await readCommandRules(ctx, serverId)).length >= COMMAND_RULE_LIMIT)
            fail(429, `A server can have at most ${COMMAND_RULE_LIMIT} command rules`)
        await ctx.db.insert("commandRules", {
            serverId,
            command: op.command,
            channelIds: [...channelIds],
            roleIds: [...roleIds],
            updatedAt: now,
        })
    }
    return { rules: await readCommandRules(ctx, serverId) }
}

export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<CommandRulesState> => {
        const input = decode(CommandRulesManageRequest, request),
            identity = source(input, Date.now()),
            who = actor(input.actor)
        if (!who.nativePermissionAuthorized) fail(403, "Manage community permission required")
        return changeConfiguration(
            ctx,
            identity.serverId,
            "commandrules",
            {
                kind: "chat",
                createdAt: identity.createdAt,
                actor: { userId: who.userId, source: "command" },
                operation: input.operation,
            },
            () => applyCommandRule(ctx, identity.serverId, input.operation),
        )
    },
})
