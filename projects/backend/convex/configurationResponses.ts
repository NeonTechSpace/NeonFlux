import type { MutationCtx } from "./_generated/server.js"
import type { DashboardConfigurationOperationMap } from "../dashboard-contracts.js"
import { ResponseConfigurationOperation } from "@neonflux/contracts/responses"
import { responseOperation } from "./responseDomain.ts"
import { applyResponseManagement, definition } from "./responses.ts"
import { decode, fail } from "./validation.ts"

export function responseConfigurationOperation(value: unknown): DashboardConfigurationOperationMap["responses"] {
    const input = decode(ResponseConfigurationOperation, value, "Invalid definition")
    return { kind: input.kind, operation: responseOperation(input.operation) } as DashboardConfigurationOperationMap["responses"]
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
