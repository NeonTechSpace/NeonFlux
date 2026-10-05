import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { ServiceWorkSignal } from "@neonflux/contracts/service"

// The bot subscribes to this one row through botService:serviceWorkSignal and dispatches its work whenever version changes.
// Writers outside the bot ring it when they create work the bot should start at once, such as website jobs and scheduled
// wake batches. The bot learns of the work its own mutations create from their answers,
// and of later due times from each dispatch, so those writes do not touch this row, except a DEFCON change back to 3, which
// rings it for the suggestion cards and event reminders DEFCON held, and turning events or publishing on, which rings it for the
// event reminders they held. The row carries no server data
export async function readWorkSignal(ctx: Pick<QueryCtx, "db">): Promise<ServiceWorkSignal> {
    return { version: (await ctx.db.query("workSignal").first())?.version ?? 0 }
}

export async function ringWork(ctx: Pick<MutationCtx, "db">): Promise<void> {
    const row = await ctx.db.query("workSignal").first()
    if (row) await ctx.db.patch(row._id, { version: row.version + 1 })
    else await ctx.db.insert("workSignal", { version: 1 })
}
