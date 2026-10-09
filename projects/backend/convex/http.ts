import { httpRouter, type FunctionReference } from "convex/server"
import { ConvexError } from "convex/values"
import { internal } from "./_generated/api.js"
import { httpAction, type ActionCtx } from "./_generated/server.js"
import { cursor, fail, isId, requireId } from "./validation.ts"
import { afkMentions, afkReason } from "./afkDomain.ts"
import { configuredServerScope, requireOrigin, scopeDenied } from "./serverScope.ts"
import type { ServiceScope } from "../contracts.js"

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
    return json({ error: data.error, ...(data.code === "NEONFLUX_SCOPE_DENIED" ? { code: data.code } : {}) }, data.status)
}

function authenticate(request: Request): Response | ServiceScope {
    const secret = process.env.NEONFLUX_BOT_API_SECRET
    let scope: ServiceScope
    try { scope = configuredServerScope() } catch { return json({ error: "Backend not configured" }, 503) }
    if (!secret || secret.length < 32) return json({ error: "Backend not configured" }, 503)
    if (request.headers.get("Authorization") !== `Bearer ${secret}`) return json({ error: "Unauthorized" }, 401)
    return scope
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

// Every bot request is bound to one server before any feature code runs.
// The header selects it, optional in single mode, and the body and all native evidence must name the same server.
// In multi mode the bound service function then requires an active installation in its own transaction
function serviceRoute(path: string, limit: number, run: (ctx: ActionCtx, request: Service) => Promise<unknown>) {
    http.route({ path, method: "POST", handler: httpAction(async (ctx, request) => {
        const scope = authenticate(request)
        if (scope instanceof Response) return scope
        const serverId = request.headers.get("X-NeonFlux-Server-ID") ?? (scope.mode === "single" ? scope.serverIds[0]! : "")
        if (!isId(serverId) || scope.mode === "single" && serverId !== scope.serverIds[0]) return json({ error: "Server not allowed", code: "NEONFLUX_SCOPE_DENIED" }, 403)
        const body = await readBody(request, limit)
        if (body instanceof Response) return body
        try {
            if (body.serverId !== serverId) scopeDenied()
            requireOrigin(body, serverId, scope.mode === "multi")
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
mutation("/general/nickname", 4096, internal.generalSettings.nickname)
mutation("/general/nickname-result", 4096, internal.generalSettings.nicknameResult)

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

query("/publishing/query", 65536, internal.publishing.query)
mutation("/publishing/manage", 65536, internal.publishing.manage)
mutation("/publishing/dispatch", 65536, internal.publishing.dispatch)
mutation("/publishing/outcome", 65536, internal.publishing.outcome)
mutation("/publishing/reconcile", 65536, internal.publishing.reconcile)
mutation("/publishing/observe", 65536, internal.publishing.observe)

query("/schedules/query", 65536, internal.schedules.query)
mutation("/schedules/manage", 65536, internal.schedules.manage)
mutation("/schedules/delivery", 65536, internal.schedulesDelivery.delivery)

query("/roles/query", 262144, internal.roles.query)
query("/roles/member-query", 262144, internal.roles.memberQuery)
query("/roles/policy", 262144, internal.roles.policy)
mutation("/roles/manage", 262144, internal.roles.manage)
mutation("/roles/reaction-jobs", 262144, internal.roleReactions.manage)
mutation("/roles/evaluate", 262144, internal.roleParticipation.evaluate)
mutation("/roles/dispatch", 262144, internal.roleLifecycle.dispatch)
mutation("/roles/outcome", 262144, internal.roleLifecycle.outcome)
mutation("/roles/reconcile", 262144, internal.roleLifecycle.reconcile)
mutation("/roles/observe", 262144, internal.roleLifecycle.observe)

query("/greetings/query", 65536, internal.greetings.query)
query("/greetings/member", 65536, internal.greetings.member)
query("/greetings/pending", 65536, internal.greetings.pending)
mutation("/greetings/manage", 65536, internal.greetings.manage)
mutation("/greetings/observe", 65536, internal.greetings.observe)
mutation("/greetings/discover", 65536, internal.greetings.discover)
mutation("/greetings/reserve", 65536, internal.greetingLifecycle.reserve)
mutation("/greetings/dispatch", 65536, internal.greetingLifecycle.dispatch)
mutation("/greetings/outcome", 65536, internal.greetingLifecycle.outcome)
mutation("/greetings/defer", 65536, internal.greetingLifecycle.defer)

query("/tickets/query", 262144, internal.tickets.query)
mutation("/tickets/manage", 262144, internal.tickets.manage)
mutation("/tickets/intake", 262144, internal.tickets.intake)
mutation("/tickets/transcript", 262144, internal.tickets.transcript)
mutation("/tickets/dispatch", 262144, internal.ticketLifecycle.dispatch)
mutation("/tickets/outcome", 262144, internal.ticketLifecycle.outcome)
mutation("/tickets/reconcile", 262144, internal.ticketLifecycle.reconcile)

query("/levels/query", 262144, internal.leveling.query)
query("/levels/preflight", 262144, internal.leveling.preflight)
mutation("/levels/manage", 262144, internal.leveling.manage)
mutation("/levels/award", 262144, internal.leveling.award)
mutation("/levels/work", 262144, internal.levelingWork.work)

query("/events/query", 65536, internal.events.query)
mutation("/events/manage", 65536, internal.events.manage)
mutation("/events/rsvp", 65536, internal.events.rsvp)
mutation("/events/work", 65536, internal.eventsWork.work)
mutation("/events/delivery", 65536, internal.eventsDelivery.delivery)

query("/milestones/query", 65536, internal.milestones.query)
mutation("/milestones/manage", 65536, internal.milestones.manage)
mutation("/milestones/personal", 65536, internal.milestones.personal)
mutation("/milestones/delivery", 65536, internal.milestonesDelivery.delivery)

query("/suggestions/query", 65536, internal.suggestions.query)
mutation("/suggestions/manage", 65536, internal.suggestions.manage)
mutation("/suggestions/member", 65536, internal.suggestions.member)
mutation("/suggestions/work", 65536, internal.suggestionsWork.work)

query("/cleanup/query", 65536, internal.cleanup.query)
mutation("/cleanup/manage", 65536, internal.cleanup.manage)
mutation("/cleanup/work", 65536, internal.cleanupWork.work)

query("/voice/query", 65536, internal.voice.query)
mutation("/voice/manage", 65536, internal.voice.manage)
mutation("/voice/rooms", 65536, internal.voice.rooms)

query("/metadata-logs/query", 65536, internal.metadataLogs.query)
mutation("/metadata-logs/manage", 65536, internal.metadataLogs.manage)
mutation("/metadata-logs/admit", 65536, internal.metadataLogs.admit)
mutation("/metadata-logs/work", 65536, internal.metadataLogsWork.work)

query("/analytics/settings", 4096, internal.analytics.settings)
query("/analytics/summary", 4096, internal.analytics.summary)
mutation("/analytics/manage", 4096, internal.analytics.manage)
mutation("/analytics/record", 65536, internal.analytics.record)

query("/backup/snapshot", 262144, internal.backup.snapshot)
query("/backup/query", 262144, internal.backup.query)
mutation("/backup/manage", 1048576, internal.backup.manage)
mutation("/backup/work", 262144, internal.backup.work)

// The bot compares this scope with its own before starting any server runtime
http.route({ path: "/service/scope", method: "GET", handler: httpAction(async (_ctx, request) => {
    const scope = authenticate(request)
    return scope instanceof Response ? scope : json(scope)
}) })

// Multi mode only. The bot registers the servers it joins and leaves, and lists active installations at startup.
// These routes bind no server, and repeating a call leaves the same state
function installationRoute(path: string, run: (ctx: ActionCtx, body: Record<string, unknown>) => Promise<unknown>) {
    http.route({ path, method: "POST", handler: httpAction(async (ctx, request) => {
        const scope = authenticate(request)
        if (scope instanceof Response) return scope
        if (scope.mode !== "multi") return json({ error: "Server installations require multi mode" }, 404)
        const body = await readBody(request, 4096)
        if (body instanceof Response) return body
        try {
            return json(await run(ctx, body))
        } catch (error) {
            return failure(error)
        }
    }) })
}
installationRoute("/service/installations/list", (ctx, body) => ctx.runQuery(internal.installations.list, { cursor: cursor(body.cursor) }))
installationRoute("/service/installations/join", (ctx, body) => ctx.runMutation(internal.installations.join, { serverId: requireId(body.serverId) }))
installationRoute("/service/installations/leave", (ctx, body) => ctx.runMutation(internal.installations.leave, { serverId: requireId(body.serverId) }))

// The bot's one work dispatcher polls this in both modes. It binds no server and reads only bounded global indexes
http.route({ path: "/service/work", method: "POST", handler: httpAction(async (ctx, request) => {
    const scope = authenticate(request)
    if (scope instanceof Response) return scope
    const body = await readBody(request, 4096)
    if (body instanceof Response) return body
    try {
        // The time is an argument, so a cached query result never hides work that became due since
        return json(await ctx.runQuery(internal.workDispatch.due, { now: Date.now(), cursor: cursor(body.cursor) }))
    } catch (error) {
        return failure(error)
    }
}) })

query("/dashboard-metadata/ready", 65536, internal.dashboardMetadata.ready)
mutation("/dashboard-metadata/execute", 65536, internal.dashboardMetadata.execute)
mutation("/dashboard-metadata/fail", 65536, internal.dashboardMetadata.failJob)
query("/dashboard-configuration/ready", 65536, internal.dashboardConfiguration.ready)
mutation("/dashboard-configuration/execute", 65536, internal.dashboardConfiguration.execute)
mutation("/dashboard-configuration/fail", 65536, internal.dashboardConfiguration.failJob)
query("/dashboard-messages/ready", 4096, internal.dashboardMessages.ready)
mutation("/dashboard-messages/reserve", 4096, internal.dashboardMessages.reserve)
mutation("/dashboard-messages/complete", 4096, internal.dashboardMessages.complete)
mutation("/dashboard-messages/fail", 4096, internal.dashboardMessages.failJob)
query("/dashboard-roles/ready", 65536, internal.dashboardRoles.ready)
mutation("/dashboard-roles/execute", 65536, internal.dashboardRoles.execute)
mutation("/dashboard-roles/reserve", 65536, internal.dashboardRoles.reserve)
mutation("/dashboard-roles/complete", 65536, internal.dashboardRoles.complete)
mutation("/dashboard-roles/fail", 65536, internal.dashboardRoles.failJob)

query("/rolepicker/settings", 4096, internal.rolePicker.settings)
mutation("/rolepicker/manage", 65536, internal.rolePicker.manage)
query("/rolepicker/ready", 4096, internal.rolePicker.ready)
mutation("/rolepicker/start", 262144, internal.rolePicker.start)
mutation("/rolepicker/complete", 262144, internal.rolePicker.complete)
mutation("/rolepicker/fail", 4096, internal.rolePicker.failRequest)

query("/verification/request", 65536, internal.verification.request)
mutation("/verification/issue", 65536, internal.verification.issue)
mutation("/verification/ready", 65536, internal.verification.ready)
mutation("/verification/claim", 65536, internal.verification.claim)
mutation("/verification/delivery", 65536, internal.verification.delivery)
mutation("/verification/review", 65536, internal.verification.review)

export default http
