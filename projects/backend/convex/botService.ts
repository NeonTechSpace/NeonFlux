import type { RegisteredMutation, RegisteredQuery } from "convex/server"
import { ConvexError, v } from "convex/values"
import { mutation, query } from "./_generated/server.js"
import type { ServiceScope } from "@neonflux/contracts/service"
import { fail, isId } from "./validation.ts"
import { requireOrigin, scopeDenied } from "./serverScope.ts"
import { requireServiceKey } from "./serviceKey.ts"
import { guardedMutation, guardedQuery } from "./serviceGuard.ts"
import * as afk from "./afk.ts"
import * as generalSettings from "./generalSettings.ts"
import * as responses from "./responses.ts"

// The bot's entry points. Each is a public function that checks the key derived from the bot secret before it reads
// anything, binds the request to one server and then runs the service function's own
// server-checked handler in this transaction. Nothing here calls ctx.runQuery or ctx.runMutation, so each bot
// request is one function call. The bot maps its request paths to these names in bot/src/backend-routes.ts

type Service = Record<string, unknown> & { serverId: string }
const entryArgs = { key: v.optional(v.any()), serverId: v.optional(v.any()), request: v.optional(v.any()) }
type EntryArgs = { key?: unknown; serverId?: unknown; request?: unknown }

// Errors carry only a status, a fixed message and the scope denial code. Anything else answers 503
async function entry<Result>(work: () => Promise<Result>): Promise<Result> {
    try {
        return await work()
    } catch (error) {
        const data =
            error instanceof ConvexError
                ? (error.data as { status?: unknown; error?: unknown; code?: unknown } | null)
                : null
        if (
            typeof data?.status === "number" &&
            typeof data.error === "string" &&
            data.status >= 400 &&
            data.status <= 599
        ) {
            const code = data.code === "NEONFLUX_SCOPE_DENIED" ? { code: data.code } : {}
            throw new ConvexError({ status: data.status, error: data.error, ...code })
        }
        console.error("Bot service function failed", error)
        throw new ConvexError({ status: 503, error: "Backend unavailable" })
    }
}

// The request as JSON parsing returns it, so handlers see plain JSON values, within the route's limit in UTF-16 code units
function readRequest(value: unknown, limit: number): Record<string, unknown> {
    let text: string | undefined
    try {
        text = JSON.stringify(value)
    } catch {
        fail(400, "Invalid JSON")
    }
    if (text !== undefined && text.length > limit) fail(413, "Request too large")
    const body: unknown = text === undefined ? undefined : JSON.parse(text)
    if (body === null || typeof body !== "object" || Array.isArray(body)) fail(400, "Invalid request")
    return body as Record<string, unknown>
}

// Every bot request is bound to one server before any feature code runs. serverId selects it and may be omitted, and
// the request and all native evidence must name the same server. The service handler then checks that the deployment serves it
async function boundRequest(args: EntryArgs, limit: number): Promise<Service> {
    const scope = await requireServiceKey(args.key)
    const serverId = args.serverId ?? scope.serverIds[0]!
    if (!isId(serverId) || serverId !== scope.serverIds[0]) scopeDenied()
    const body = readRequest(args.request, limit)
    if (body.serverId !== serverId) scopeDenied()
    requireOrigin(body, serverId)
    return body as Service
}

// Handlers run in this function's own transaction. A nested call would be billed as a second function call, so it fails instead
function nestedCall(): never {
    throw new Error("Bot service handlers run inline and cannot call other functions")
}
export const inline = <Ctx extends object>(ctx: Ctx): Ctx => ({ ...ctx, runQuery: nestedCall, runMutation: nestedCall })

function botQuery<Returns>(limit: number, fn: RegisteredQuery<"internal", { request: any }, Returns>) {
    const handler = guardedQuery(fn)
    return query({
        args: entryArgs,
        handler: (ctx, args) =>
            entry(async () => await handler(inline(ctx), { request: await boundRequest(args, limit) })),
    })
}
function botMutation<Returns>(limit: number, fn: RegisteredMutation<"internal", { request: any }, Returns>) {
    const handler = guardedMutation(fn)
    return mutation({
        args: entryArgs,
        handler: (ctx, args) =>
            entry(async () => await handler(inline(ctx), { request: await boundRequest(args, limit) })),
    })
}

// The bot adopts this scope before it starts any server runtime
export const serviceScope = query({
    args: entryArgs,
    handler: (_ctx, args): Promise<ServiceScope> => entry(() => requireServiceKey(args.key)),
})

export const afkSet = botMutation(4096, afk.setStatus)
export const afkObserve = botMutation(4096, afk.observeMessage)

export const generalGet = botQuery(4096, generalSettings.get)
export const generalManage = botMutation(4096, generalSettings.manage)

export const responsesManage = botMutation(32768, responses.manage)
export const responsesEvaluate = botMutation(32768, responses.evaluate)
