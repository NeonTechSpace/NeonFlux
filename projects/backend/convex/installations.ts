import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { ServiceInstallation, ServiceInstallationPage } from "@neonflux/contracts/service"

const PAGE_SIZE = 500

// Multi mode only. The bot lists active installations at startup and registers the servers it joins and leaves
export async function listInstallations(ctx: QueryCtx, cursor: string | null): Promise<ServiceInstallationPage> {
    const page = await ctx.db
        .query("serverInstallations")
        .withIndex("by_status_removed", (q) => q.eq("status", "active"))
        .paginate({ cursor, numItems: PAGE_SIZE })
    return { serverIds: page.page.map((row) => row.serverId), nextCursor: page.isDone ? null : page.continueCursor }
}

// Joining again restores a removed server with the data the purge has not deleted, and stops a running purge
export async function joinInstallation(ctx: MutationCtx, serverId: string): Promise<ServiceInstallation> {
    const now = Date.now(),
        row = await ctx.db
            .query("serverInstallations")
            .withIndex("by_server", (q) => q.eq("serverId", serverId))
            .unique()
    if (row?.status === "active") return { serverId, active: true }
    if (!row) await ctx.db.insert("serverInstallations", { serverId, status: "active", joinedAt: now })
    else
        await ctx.db.patch(row._id, {
            status: "active",
            joinedAt: now,
            removedAt: undefined,
            purgeLeaseUntil: undefined,
        })
    return { serverId, active: true }
}

// Leaving keeps every row. removedAt records when the server stopped being served, and installationsPurge deletes its data 30 days later
export async function leaveInstallation(ctx: MutationCtx, serverId: string): Promise<ServiceInstallation> {
    const now = Date.now(),
        row = await ctx.db
            .query("serverInstallations")
            .withIndex("by_server", (q) => q.eq("serverId", serverId))
            .unique()
    if (row?.status === "active") await ctx.db.patch(row._id, { status: "removed", removedAt: now })
    return { serverId, active: false }
}
