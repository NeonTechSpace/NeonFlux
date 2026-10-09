import { v } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server.js"
import type { QueryCtx } from "./_generated/server.js"
import type { ServiceInstallation, ServiceInstallationPage } from "../contracts.js"
import { configuredServerScope, scopeDenied } from "./serverScope.ts"
import { fail, isId } from "./validation.ts"

const PAGE_SIZE = 500
type Read = Pick<QueryCtx, "db">

// The one installation decision. Single mode allows only the configured server, multi mode an active installation row
export async function isInstalled(ctx: Read, serverId: string): Promise<boolean> {
    if (!isId(serverId)) return false
    const scope = configuredServerScope()
    if (scope.mode === "single") return scope.serverIds[0] === serverId
    const row = await ctx.db.query("serverInstallations").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    return row?.status === "active"
}

export async function requireInstalled(ctx: Read, serverId: unknown): Promise<void> {
    if (typeof serverId !== "string" || !await isInstalled(ctx, serverId)) scopeDenied()
}

// http.ts binds every bot request to request.serverId, or serverId for the AFK routes
function boundServer(args: Record<string, unknown>): unknown {
    const request = args.request
    return request !== null && typeof request === "object" && !Array.isArray(request) ? (request as Record<string, unknown>).serverId : args.serverId
}
function guarded<Builder>(builder: Builder): Builder {
    return ((definition: { handler: (ctx: QueryCtx, args: Record<string, unknown>) => unknown }) => {
        if (typeof definition !== "object" || typeof definition.handler !== "function") throw new Error("Service functions need an object definition")
        return (builder as (value: unknown) => unknown)({ ...definition, handler: async (ctx: QueryCtx, args: Record<string, unknown>) => {
            await requireInstalled(ctx, boundServer(args))
            return definition.handler(ctx, args)
        } })
    }) as Builder
}
// Every bot service function registered in http.ts checks installation in its own transaction before domain work
export const serviceQuery = guarded(internalQuery)
export const serviceMutation = guarded(internalMutation)

export const list = internalQuery({ args: { cursor: v.union(v.string(), v.null()) }, handler: async (ctx, { cursor }): Promise<ServiceInstallationPage> => {
    const page = await ctx.db.query("serverInstallations").withIndex("by_status_removed", q => q.eq("status", "active")).paginate({ cursor, numItems: PAGE_SIZE })
    return { serverIds: page.page.map(row => row.serverId), nextCursor: page.isDone ? null : page.continueCursor }
} })

// Joining again restores a removed server with the data the purge has not deleted, and stops a running purge
export const join = internalMutation({ args: { serverId: v.string() }, handler: async (ctx, { serverId }): Promise<ServiceInstallation> => {
    if (!isId(serverId)) fail(400, "Invalid request")
    const now = Date.now(), row = await ctx.db.query("serverInstallations").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (!row) await ctx.db.insert("serverInstallations", { serverId, status: "active", joinedAt: now, lastSeenAt: now })
    else if (row.status === "removed") await ctx.db.patch(row._id, { status: "active", joinedAt: now, lastSeenAt: now, removedAt: undefined, purgeLeaseUntil: undefined })
    else await ctx.db.patch(row._id, { lastSeenAt: now })
    return { serverId, active: true }
} })

// Leaving keeps every row. removedAt records when the server stopped being served, and installationsPurge deletes its data 30 days later
export const leave = internalMutation({ args: { serverId: v.string() }, handler: async (ctx, { serverId }): Promise<ServiceInstallation> => {
    if (!isId(serverId)) fail(400, "Invalid request")
    const now = Date.now(), row = await ctx.db.query("serverInstallations").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (row?.status === "active") await ctx.db.patch(row._id, { status: "removed", removedAt: now, lastSeenAt: now })
    return { serverId, active: false }
} })
