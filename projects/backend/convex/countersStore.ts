import type { CounterView } from "@neonflux/contracts/counters"
import type { Doc } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { COUNTER_LIMIT } from "./countersDomain.ts"

type Read = QueryCtx | MutationCtx
export const readCounters = (ctx: Read, serverId: string) =>
    ctx.db
        .query("counters")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .take(COUNTER_LIMIT)
export const readCounter = (ctx: Read, serverId: string, channelId: string) =>
    ctx.db
        .query("counters")
        .withIndex("by_server", (q) => q.eq("serverId", serverId).eq("channelId", channelId))
        .unique()
export const readCounterSettings = (ctx: Read, serverId: string) =>
    ctx.db
        .query("counterSettings")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
export const publicCounter = (row: Doc<"counters">): CounterView["counters"][number] => ({
    channelId: row.channelId,
    kind: row.kind,
    ...(row.roleId ? { roleId: row.roleId } : {}),
    template: row.template,
    enabled: row.enabled,
    ...(row.problem ? { problem: row.problem } : {}),
    ...(row.countProblem ? { countProblem: row.countProblem } : {}),
    createdAt: row.createdAt,
})
/** The feature is on until a server turns it off, so a first counter works at once */
export async function counterView(ctx: Read, serverId: string): Promise<CounterView> {
    return {
        enabled: (await readCounterSettings(ctx, serverId))?.enabled ?? true,
        counters: (await readCounters(ctx, serverId)).map(publicCounter),
    }
}
