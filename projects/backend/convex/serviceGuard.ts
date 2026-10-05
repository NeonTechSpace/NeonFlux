import type { DefaultFunctionArgs, RegisteredMutation, RegisteredQuery } from "convex/server"
import type { ObjectType, PropertyValidators } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { configuredServerScope, scopeDenied } from "./serverScope.ts"
import { isId } from "./validation.ts"

type Read = Pick<QueryCtx, "db">

// Whether the deployment serves a server: the configured one in single mode, an active installation in multi mode
export async function isServed(ctx: Read, serverId: string): Promise<boolean> {
    if (!isId(serverId)) return false
    const scope = configuredServerScope()
    if (scope.mode === "single") return scope.serverIds[0] === serverId
    const row = await ctx.db
        .query("serverInstallations")
        .withIndex("by_server", (q) => q.eq("serverId", serverId))
        .unique()
    return row?.status === "active"
}

async function requireServed(ctx: Read, serverId: unknown): Promise<void> {
    if (typeof serverId !== "string" || !(await isServed(ctx, serverId))) scopeDenied()
}

// botService.ts binds every bot request to request.serverId
function boundServer(args: Record<string, unknown>): unknown {
    const request = args.request
    return request !== null && typeof request === "object" && !Array.isArray(request)
        ? (request as Record<string, unknown>).serverId
        : undefined
}
// Every bot service function checks its server in its own transaction before domain work. The bot reaches them through
// botService.ts, which runs the same guarded handler in the public function's transaction, and the scheduler calls the
// registered internal function directly. The handler travels on the registered function, typed by its arguments and result
const GUARDED = Symbol("guarded handler")
type Guarded<Ctx, Args, Returns> = { readonly [GUARDED]: (ctx: Ctx, args: Args) => Promise<Returns> }
export function serviceQuery<Args extends PropertyValidators, Returns>(definition: {
    args: Args
    handler: (ctx: QueryCtx, args: ObjectType<Args>) => Promise<Returns>
}): RegisteredQuery<"internal", ObjectType<Args>, Promise<Returns>> {
    const guarded = async (ctx: QueryCtx, args: ObjectType<Args>): Promise<Returns> => {
        await requireServed(ctx, boundServer(args))
        return definition.handler(ctx, args)
    }
    return Object.defineProperty(internalQuery({ args: definition.args, handler: guarded }), GUARDED, {
        value: guarded,
    })
}
export function serviceMutation<Args extends PropertyValidators, Returns>(definition: {
    args: Args
    handler: (ctx: MutationCtx, args: ObjectType<Args>) => Promise<Returns>
}): RegisteredMutation<"internal", ObjectType<Args>, Promise<Returns>> {
    const guarded = async (ctx: MutationCtx, args: ObjectType<Args>): Promise<Returns> => {
        await requireServed(ctx, boundServer(args))
        return definition.handler(ctx, args)
    }
    return Object.defineProperty(internalMutation({ args: definition.args, handler: guarded }), GUARDED, {
        value: guarded,
    })
}
/** The server-checked handler of a service query or mutation */
export const guardedQuery = <Args extends DefaultFunctionArgs, Returns>(
    fn: RegisteredQuery<"internal", Args, Returns>,
) => (fn as unknown as Guarded<QueryCtx, Args, Awaited<Returns>>)[GUARDED]
export const guardedMutation = <Args extends DefaultFunctionArgs, Returns>(
    fn: RegisteredMutation<"internal", Args, Returns>,
) => (fn as unknown as Guarded<MutationCtx, Args, Awaited<Returns>>)[GUARDED]
