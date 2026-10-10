import { internalMutation, internalQuery } from "./_generated/server.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
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

// botService.ts binds every bot request to request.serverId, or serverId for the AFK functions
function boundServer(args: Record<string, unknown>): unknown {
    const request = args.request
    return request !== null && typeof request === "object" && !Array.isArray(request) ? (request as Record<string, unknown>).serverId : args.serverId
}
type ServiceKind = "query" | "mutation"
export type ServiceHandler = (ctx: QueryCtx, args: Record<string, unknown>) => Promise<unknown>
// The installation-checked handler of each service function, so the public entry points in botService.ts can run it inline
const serviceHandlers = new WeakMap<object, { readonly kind: ServiceKind, readonly handler: ServiceHandler }>()
function guarded<Builder>(builder: Builder, kind: ServiceKind): Builder {
    return ((definition: { handler: (ctx: QueryCtx, args: Record<string, unknown>) => unknown }) => {
        if (typeof definition !== "object" || typeof definition.handler !== "function") throw new Error("Service functions need an object definition")
        const handler: ServiceHandler = async (ctx, args) => {
            await requireInstalled(ctx, boundServer(args))
            return definition.handler(ctx, args)
        }
        const registered = (builder as (value: unknown) => object)({ ...definition, handler })
        serviceHandlers.set(registered, { kind, handler })
        return registered
    }) as Builder
}
// Every bot service function checks installation in its own transaction before domain work. The bot reaches them through
// botService.ts, which runs the same handler in the public function's transaction, and the scheduler calls them directly
export const serviceQuery = guarded(internalQuery, "query")
export const serviceMutation = guarded(internalMutation, "mutation")

/** The installation-checked handler of a service function of the given kind */
export function serviceHandler(fn: object, kind: ServiceKind): ServiceHandler {
    const entry = serviceHandlers.get(fn)
    if (entry?.kind !== kind) throw new Error(`Bot entry points need a service ${kind}`)
    return entry.handler
}

// Multi mode only. The bot lists active installations at startup and registers the servers it joins and leaves
export async function listInstallations(ctx: QueryCtx, cursor: string | null): Promise<ServiceInstallationPage> {
    const page = await ctx.db.query("serverInstallations").withIndex("by_status_removed", q => q.eq("status", "active")).paginate({ cursor, numItems: PAGE_SIZE })
    return { serverIds: page.page.map(row => row.serverId), nextCursor: page.isDone ? null : page.continueCursor }
}

// Joining again restores a removed server with the data the purge has not deleted, and stops a running purge.
// Only the join that starts an installation answers welcome, so repeated joins after a reconnect post no second note
export async function joinInstallation(ctx: MutationCtx, serverId: string): Promise<ServiceInstallation> {
    if (!isId(serverId)) fail(400, "Invalid request")
    const now = Date.now(), row = await ctx.db.query("serverInstallations").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (row?.status === "active") {
        await ctx.db.patch(row._id, { lastSeenAt: now })
        return { serverId, active: true }
    }
    if (!row) await ctx.db.insert("serverInstallations", { serverId, status: "active", joinedAt: now, lastSeenAt: now })
    else await ctx.db.patch(row._id, { status: "active", joinedAt: now, lastSeenAt: now, removedAt: undefined, purgeLeaseUntil: undefined })
    return { serverId, active: true, welcome: true }
}

// Leaving keeps every row. removedAt records when the server stopped being served, and installationsPurge deletes its data 30 days later
export async function leaveInstallation(ctx: MutationCtx, serverId: string): Promise<ServiceInstallation> {
    if (!isId(serverId)) fail(400, "Invalid request")
    const now = Date.now(), row = await ctx.db.query("serverInstallations").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (row?.status === "active") await ctx.db.patch(row._id, { status: "removed", removedAt: now, lastSeenAt: now })
    return { serverId, active: false }
}
