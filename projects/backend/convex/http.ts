import { httpRouter, type FunctionReference } from "convex/server"
import { ConvexError } from "convex/values"
import { internal } from "./_generated/api.js"
import { httpAction, type ActionCtx } from "./_generated/server.js"
import { fail, isId } from "./validation.ts"
import { afkMentions, afkReason } from "./afkDomain.ts"

type Service = Record<string, unknown> & { serverId: string }
type Reference<Type extends "query" | "mutation"> = FunctionReference<Type, "internal", { request: unknown }>

const http = httpRouter()

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function failure(error: unknown) {
    const data = error instanceof ConvexError ? error.data as { status?: unknown, error?: unknown, code?: unknown } | null : null
    if (typeof data?.status !== "number" || typeof data.error !== "string" || data.status < 400 || data.status > 599) {
        return json({ error: "Backend unavailable" }, 503)
    }
    return json({ error: data.error }, data.status)
}

function authenticate(request: Request): Response | string {
    const secret = process.env.NEONFLUX_BOT_API_SECRET
    const serverId = process.env.NEONFLUX_SERVER_ID
    if (!secret || secret.length < 32 || !isId(serverId)) return json({ error: "Backend not configured" }, 503)
    if (request.headers.get("Authorization") !== `Bearer ${secret}`) return json({ error: "Unauthorized" }, 401)
    return serverId
}

async function readBody(request: Request, limit: number): Promise<Response | Record<string, unknown>> {
    try {
        const text = await request.text()
        if (text.length > limit) return json({ error: "Request too large" }, 413)
        const value: unknown = JSON.parse(text)
        if (value === null || typeof value !== "object" || Array.isArray(value)) return json({ error: "Invalid request" }, 400)
        return value as Record<string, unknown>
    } catch {
        return json({ error: "Invalid JSON" }, 400)
    }
}

// Every bot request is bound to the configured server before any feature code runs
function serviceRoute(path: string, limit: number, run: (ctx: ActionCtx, request: Service) => Promise<unknown>) {
    http.route({ path, method: "POST", handler: httpAction(async (ctx, request) => {
        const serverId = authenticate(request)
        if (serverId instanceof Response) return serverId
        const body = await readBody(request, limit)
        if (body instanceof Response) return body
        if (body.serverId !== serverId) return json({ error: "Server not allowed" }, 403)
        try {
            return json(await run(ctx, body as Service))
        } catch (error) {
            return failure(error)
        }
    }) })
}
const query = (path: string, limit: number, reference: Reference<"query">) => serviceRoute(path, limit, (ctx, request) => ctx.runQuery(reference, { request }))
const mutation = (path: string, limit: number, reference: Reference<"mutation">) => serviceRoute(path, limit, (ctx, request) => ctx.runMutation(reference, { request }))

query("/general/get", 4096, internal.generalSettings.get)
mutation("/general/manage", 4096, internal.generalSettings.manage)

serviceRoute("/afk/set", 4096, (ctx, body) => {
    if (!isId(body.userId)) fail(400, "Invalid member ID")
    const reason = afkReason(body.reason)
    if (reason === null) fail(400, "Away messages must contain 1 to 200 characters")
    return ctx.runMutation(internal.afk.setStatus, { serverId: body.serverId, userId: body.userId, reason })
})
serviceRoute("/afk/observe", 4096, (ctx, body) => {
    if (!isId(body.userId)) fail(400, "Invalid member ID")
    const mentionedUserIds = afkMentions(body.mentionedUserIds)
    if (mentionedUserIds === null) fail(400, "Invalid mentions")
    return ctx.runMutation(internal.afk.observeMessage, { serverId: body.serverId, userId: body.userId, mentionedUserIds })
})

mutation("/responses/manage", 32768, internal.responses.manage)
mutation("/responses/evaluate", 32768, internal.responses.evaluate)

query("/moderation/query", 65536, internal.moderation.query)
query("/moderation/gate", 65536, internal.moderation.gate)
mutation("/moderation/manage", 65536, internal.moderation.manage)
mutation("/moderation/evaluate", 65536, internal.protection.evaluate)
mutation("/moderation/join", 65536, internal.protection.join)
mutation("/moderation/outcome", 65536, internal.moderation.outcome)
mutation("/moderation/log-outcome", 65536, internal.moderation.logOutcome)
mutation("/moderation/notice-outcome", 65536, internal.moderation.noticeOutcome)
mutation("/moderation/reconcile", 65536, internal.moderation.reconcile)
mutation("/moderation/observe", 65536, internal.moderation.observe)
mutation("/appeals/member", 65536, internal.appeals.member)
mutation("/appeals/staff", 65536, internal.appeals.staff)

export default http
