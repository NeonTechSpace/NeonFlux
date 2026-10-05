import type { MutationCtx } from "./_generated/server.js"
import type { DashboardConfigurationOperationMap } from "../dashboard-contracts.js"
import { cooldown, ids, kind, name, priority, reply, responseOperation, trigger } from "./responseDomain.ts"
import { shape } from "./publishingDomain.ts"
import { applyResponseManagement, definition } from "./responses.ts"
import { fail, bool } from "./validation.ts"

export function responseConfigurationOperation(value: unknown): DashboardConfigurationOperationMap["responses"] {
    const input = shape(value, ["kind", "operation"], ["kind", "operation"]), currentKind = kind(input.kind), op = shape(input.operation, ["type", "definition", "name", "reply", "trigger", "enabled", "field", "channelIds", "roleIds", "cooldownSeconds", "priority"])
    if (op.type === "definition-create" || op.type === "definition-update") {
        shape(op, ["type", "definition"], ["type", "definition"])
        const keys = ["name", "reply", "channelIds", "roleIds", "cooldownSeconds", "priority", "enabled"], fields = shape(op.definition, currentKind === "auto" ? [...keys, "trigger"] : keys, currentKind === "auto" ? [...keys, "trigger"] : keys)
        return { kind: currentKind, operation: { type: op.type, definition: { name: name(fields.name), reply: reply(fields.reply), channelIds: ids(fields.channelIds), roleIds: ids(fields.roleIds), cooldownSeconds: cooldown(fields.cooldownSeconds), priority: priority(fields.priority), enabled: bool(fields.enabled), ...(currentKind === "auto" ? { trigger: trigger(fields.trigger) } : {}) } } }
    }
    const operation = responseOperation(input.operation, currentKind)
    if (operation.type === "list" || operation.type === "show") fail(400, "Read operation is not configuration")
    return { kind: currentKind, operation } as DashboardConfigurationOperationMap["responses"]
}
export async function applyResponseConfiguration(ctx: MutationCtx, serverId: string, input: DashboardConfigurationOperationMap["responses"], now: number) {
    const op = input.operation
    if (op.type !== "definition-create" && op.type !== "definition-update") return applyResponseManagement(ctx, { serverId, ...input } as Parameters<typeof applyResponseManagement>[1], now)
    const data = op.definition
    if (op.type === "definition-create") await applyResponseManagement(ctx, { serverId, kind: input.kind, operation: { type: "create", name: data.name, reply: data.reply, ...(input.kind === "auto" ? { trigger: data.trigger! } : {}) } }, now)
    const row = await ctx.db.query("responseDefinitions").withIndex("by_server_kind_name", q => q.eq("serverId", serverId).eq("kind", input.kind).eq("name", data.name)).unique()
    if (!row) fail(404, "Definition not found")
    await ctx.db.patch(row._id, { ...data, updatedAt: now })
    return { duplicate: false as const, type: "definition" as const, definition: definition((await ctx.db.get(row._id))!) }
}
