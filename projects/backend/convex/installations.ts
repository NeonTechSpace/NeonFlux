import type { DefaultFunctionArgs, RegisteredMutation, RegisteredQuery } from "convex/server"
import type { ObjectType, PropertyValidators } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { ServiceInstallation, ServiceInstallationPage } from "@neonflux/contracts/service"
import { configuredServerScope, scopeDenied } from "./serverScope.ts"
import { isId } from "./validation.ts"

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
// Every bot service function checks installation in its own transaction before domain work. The bot reaches them through
// botService.ts, which runs the same guarded handler in the public function's transaction, and the scheduler calls the
// registered internal function directly. The handler travels on the registered function, typed by its arguments and result
const GUARDED = Symbol("guarded handler")
type Guarded<Ctx, Args, Returns> = { readonly [GUARDED]: (ctx: Ctx, args: Args) => Promise<Returns> }
export function serviceQuery<Args extends PropertyValidators, Returns>(definition: { args: Args, handler: (ctx: QueryCtx, args: ObjectType<Args>) => Promise<Returns> }): RegisteredQuery<"internal", ObjectType<Args>, Promise<Returns>> {
    const guarded = async (ctx: QueryCtx, args: ObjectType<Args>): Promise<Returns> => {
        await requireInstalled(ctx, boundServer(args))
        return definition.handler(ctx, args)
    }
    return Object.defineProperty(internalQuery({ args: definition.args, handler: guarded }), GUARDED, { value: guarded })
}
export function serviceMutation<Args extends PropertyValidators, Returns>(definition: { args: Args, handler: (ctx: MutationCtx, args: ObjectType<Args>) => Promise<Returns> }): RegisteredMutation<"internal", ObjectType<Args>, Promise<Returns>> {
    const guarded = async (ctx: MutationCtx, args: ObjectType<Args>): Promise<Returns> => {
        await requireInstalled(ctx, boundServer(args))
        return definition.handler(ctx, args)
    }
    return Object.defineProperty(internalMutation({ args: definition.args, handler: guarded }), GUARDED, { value: guarded })
}
/** The installation-checked handler of a service query or mutation */
export const guardedQuery = <Args extends DefaultFunctionArgs, Returns>(fn: RegisteredQuery<"internal", Args, Returns>) => (fn as unknown as Guarded<QueryCtx, Args, Awaited<Returns>>)[GUARDED]
export const guardedMutation = <Args extends DefaultFunctionArgs, Returns>(fn: RegisteredMutation<"internal", Args, Returns>) => (fn as unknown as Guarded<MutationCtx, Args, Awaited<Returns>>)[GUARDED]

// Multi mode only. The bot lists active installations at startup and registers the servers it joins and leaves
export async function listInstallations(ctx: QueryCtx, cursor: string | null): Promise<ServiceInstallationPage> {
    const page = await ctx.db.query("serverInstallations").withIndex("by_status_removed", q => q.eq("status", "active")).paginate({ cursor, numItems: PAGE_SIZE })
    return { serverIds: page.page.map(row => row.serverId), nextCursor: page.isDone ? null : page.continueCursor }
}

// Joining again restores a removed server with the data the purge has not deleted, and stops a running purge.
// Only the join that starts an installation answers welcome, so repeated joins after a reconnect post no second note
export async function joinInstallation(ctx: MutationCtx, serverId: string): Promise<ServiceInstallation> {
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
    const now = Date.now(), row = await ctx.db.query("serverInstallations").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (row?.status === "active") await ctx.db.patch(row._id, { status: "removed", removedAt: now, lastSeenAt: now })
    return { serverId, active: false }
}
