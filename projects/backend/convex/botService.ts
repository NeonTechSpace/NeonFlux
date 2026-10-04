import type { RegisteredMutation, RegisteredQuery } from "convex/server"
import { ConvexError, v } from "convex/values"
import { mutation, query, type MutationCtx } from "./_generated/server.js"
import type { TableNames } from "./_generated/dataModel.js"
import { ServiceWorkRequest, type ServiceMutationResult, type ServiceScope } from "@neonflux/contracts/service"
import { decode, fail, isId, REASON_CODES } from "./validation.ts"
import { requireOrigin, scopeDenied } from "./serverScope.ts"
import { requireServiceKey } from "./serviceKey.ts"
import { guardedMutation, guardedQuery } from "./serviceGuard.ts"
import { dueWork, rowDueAt, WORK_TABLES } from "./workDispatch.ts"
import { readWorkSignal } from "./workSignal.ts"
import * as afk from "./afk.ts"
import * as generalSettings from "./generalSettings.ts"
import * as responses from "./responses.ts"
import * as moderation from "./moderation.ts"
import * as protection from "./protection.ts"
import * as appeals from "./appeals.ts"
import * as publishing from "./publishing.ts"
import * as schedules from "./schedules.ts"
import * as schedulesDeliveryModule from "./schedulesDelivery.ts"
import * as roles from "./roles.ts"
import * as roleReactions from "./roleReactions.ts"
import * as roleParticipation from "./roleParticipation.ts"
import * as roleLifecycle from "./roleLifecycle.ts"
import * as greetings from "./greetings.ts"
import * as greetingLifecycle from "./greetingLifecycle.ts"
import * as tickets from "./tickets.ts"
import * as ticketLifecycle from "./ticketLifecycle.ts"
import * as leveling from "./leveling.ts"
import * as levelingWork from "./levelingWork.ts"
import * as events from "./events.ts"
import * as eventsWorkModule from "./eventsWork.ts"
import * as eventsDeliveryModule from "./eventsDelivery.ts"
import * as milestones from "./milestones.ts"
import * as milestonesDeliveryModule from "./milestonesDelivery.ts"
import * as suggestions from "./suggestions.ts"
import * as suggestionsWorkModule from "./suggestionsWork.ts"
import * as cleanup from "./cleanup.ts"
import * as cleanupWorkModule from "./cleanupWork.ts"
import * as metadataLogs from "./metadataLogs.ts"
import * as metadataLogsWorkModule from "./metadataLogsWork.ts"
import * as backup from "./backup.ts"

// The bot's entry points. Each is a public function that checks the key derived from the bot secret before it reads
// anything, binds the request to one server and then runs the service function's own
// server-checked handler in this transaction. Nothing here calls ctx.runQuery or ctx.runMutation, so each bot
// request is one function call. The bot maps its request paths to these names in bot/src/backend-routes.ts.
// Mutations answer { value, dueIn }, where dueIn says when work their writes created becomes due

type Service = Record<string, unknown> & { serverId: string }
const entryArgs = { key: v.optional(v.any()), serverId: v.optional(v.any()), request: v.optional(v.any()) }
type EntryArgs = { key?: unknown; serverId?: unknown; request?: unknown }

// Errors carry only a status, a fixed message and the scope denial code or a reason code. Anything else answers 503
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
            const code =
                typeof data.code === "string" &&
                (data.code === "NEONFLUX_SCOPE_DENIED" || (REASON_CODES as readonly string[]).includes(data.code))
                    ? { code: data.code }
                    : {}
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

// Watches a mutation's writes to the tables the dispatcher reads, so its answer can tell the bot when the work they created
// becomes due. The bot then dispatches at that time instead of waiting for its next safety poll
function observed(ctx: MutationCtx, now: number) {
    let dueAt: number | undefined
    const note = (table: TableNames, row: Record<string, unknown> | null) => {
        const at = row ? rowDueAt(table, row, now) : undefined
        if (at !== undefined) dueAt = Math.min(dueAt ?? at, at)
    }
    const tableOf = (id: string) => [...WORK_TABLES].find((table) => ctx.db.normalizeId(table, id) !== null)
    const db = new Proxy(ctx.db, {
        get: (target, property) => {
            if (property === "insert")
                return async (table: TableNames, value: Record<string, unknown>) => {
                    const id = await target.insert(table, value as never)
                    if (WORK_TABLES.has(table)) note(table, value)
                    return id
                }
            if (property === "patch" || property === "replace")
                return async (...args: unknown[]) => {
                    await (target[property] as (...values: unknown[]) => Promise<void>)(...args)
                    const [table, id] =
                        args.length === 3
                            ? [args[0] as TableNames, args[1] as string]
                            : [tableOf(args[0] as string), args[0] as string]
                    if (table && WORK_TABLES.has(table))
                        note(table, (await target.get(id as never)) as Record<string, unknown> | null)
                }
            const value: unknown = Reflect.get(target, property)
            return typeof value === "function" ? value.bind(target) : value
        },
    })
    return {
        ctx: { ...ctx, db },
        answer: <T>(value: T): ServiceMutationResult<T> =>
            dueAt === undefined ? { value } : { value, dueIn: Math.max(0, dueAt - now) },
    }
}

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
            entry(async () => {
                const request = await boundRequest(args, limit),
                    writes = observed(ctx, Date.now())
                return writes.answer(await handler(inline(writes.ctx), { request }))
            }),
    })
}

// The bot adopts this scope before it starts any server runtime
export const serviceScope = query({
    args: entryArgs,
    handler: (_ctx, args): Promise<ServiceScope> => entry(() => requireServiceKey(args.key)),
})

// The bot's one work dispatcher calls this. It binds no server and reads only bounded global indexes.
// Due checks use the backend clock, the same clock the worker functions use. The bot's requestedAt only makes each call
// distinct, so a cached query result never hides work that became due since
export const serviceWork = query({
    args: entryArgs,
    handler: (ctx, args) =>
        entry(async () => {
            await requireServiceKey(args.key)
            const request = decode(ServiceWorkRequest, readRequest(args.request, 4096))
            return dueWork(ctx, Date.now(), request.cursor ?? null, request.held ?? null)
        }),
})

// The bot subscribes to this. It returns only the signal's counter, so a subscriber learns nothing about any server
export const serviceWorkSignal = query({
    args: entryArgs,
    handler: (ctx, args) =>
        entry(async () => {
            await requireServiceKey(args.key)
            return readWorkSignal(ctx)
        }),
})

export const afkSet = botMutation(4096, afk.setStatus)
export const afkObserve = botMutation(4096, afk.observeMessage)

export const generalGet = botQuery(4096, generalSettings.get)
export const generalManage = botMutation(4096, generalSettings.manage)

export const responsesManage = botMutation(32768, responses.manage)
export const responsesEvaluate = botMutation(32768, responses.evaluate)

export const moderationQuery = botQuery(65536, moderation.query)
export const moderationGate = botQuery(65536, moderation.gate)
export const moderationManage = botMutation(65536, moderation.manage)
export const moderationEvaluate = botMutation(65536, protection.evaluate)
export const moderationJoin = botMutation(65536, protection.join)
export const moderationOutcome = botMutation(65536, moderation.outcome)
export const moderationLogOutcome = botMutation(65536, moderation.logOutcome)
export const moderationNoticeOutcome = botMutation(65536, moderation.noticeOutcome)
export const moderationReconcile = botMutation(65536, moderation.reconcile)
export const moderationObserve = botMutation(65536, moderation.observe)
export const appealsMember = botMutation(65536, appeals.member)
export const appealsStaff = botMutation(65536, appeals.staff)

export const publishingQuery = botQuery(65536, publishing.query)
export const publishingManage = botMutation(65536, publishing.manage)
export const publishingDispatch = botMutation(65536, publishing.dispatch)
export const publishingOutcome = botMutation(65536, publishing.outcome)
export const publishingReconcile = botMutation(65536, publishing.reconcile)
export const publishingObserve = botMutation(65536, publishing.observe)

export const schedulesQuery = botQuery(65536, schedules.query)
export const schedulesManage = botMutation(65536, schedules.manage)
export const schedulesDelivery = botMutation(65536, schedulesDeliveryModule.delivery)

export const rolesQuery = botQuery(262144, roles.query)
export const rolesMemberQuery = botQuery(262144, roles.memberQuery)
export const rolesPolicy = botQuery(262144, roles.policy)
export const rolesManage = botMutation(262144, roles.manage)
export const rolesReactionJobs = botMutation(262144, roleReactions.manage)
export const rolesEvaluate = botMutation(262144, roleParticipation.evaluate)
export const rolesDispatch = botMutation(262144, roleLifecycle.dispatch)
export const rolesOutcome = botMutation(262144, roleLifecycle.outcome)
export const rolesReconcile = botMutation(262144, roleLifecycle.reconcile)
export const rolesObserve = botMutation(262144, roleLifecycle.observe)

export const greetingsQuery = botQuery(65536, greetings.query)
export const greetingsMember = botQuery(65536, greetings.member)
export const greetingsPending = botQuery(65536, greetings.pending)
export const greetingsManage = botMutation(65536, greetings.manage)
export const greetingsObserve = botMutation(65536, greetings.observe)
export const greetingsDiscover = botMutation(65536, greetings.discover)
export const greetingsReserve = botMutation(65536, greetingLifecycle.reserve)
export const greetingsDispatch = botMutation(65536, greetingLifecycle.dispatch)
export const greetingsOutcome = botMutation(65536, greetingLifecycle.outcome)
export const greetingsDefer = botMutation(65536, greetingLifecycle.defer)

export const ticketsQuery = botQuery(262144, tickets.query)
export const ticketsManage = botMutation(262144, tickets.manage)
export const ticketsIntake = botMutation(262144, tickets.intake)
export const ticketsTranscript = botMutation(262144, tickets.transcript)
export const ticketsDispatch = botMutation(262144, ticketLifecycle.dispatch)
export const ticketsOutcome = botMutation(262144, ticketLifecycle.outcome)
export const ticketsReconcile = botMutation(262144, ticketLifecycle.reconcile)

export const levelsQuery = botQuery(262144, leveling.query)
export const levelsPreflight = botQuery(262144, leveling.preflight)
export const levelsManage = botMutation(262144, leveling.manage)
export const levelsAward = botMutation(262144, leveling.award)
export const levelsWork = botMutation(262144, levelingWork.work)

export const eventsQuery = botQuery(65536, events.query)
export const eventsManage = botMutation(65536, events.manage)
export const eventsRsvp = botMutation(65536, events.rsvp)
export const eventsWork = botMutation(65536, eventsWorkModule.work)
export const eventsDelivery = botMutation(65536, eventsDeliveryModule.delivery)

export const milestonesQuery = botQuery(65536, milestones.query)
export const milestonesManage = botMutation(65536, milestones.manage)
export const milestonesPersonal = botMutation(65536, milestones.personal)
export const milestonesDelivery = botMutation(65536, milestonesDeliveryModule.delivery)

export const suggestionsQuery = botQuery(65536, suggestions.query)
export const suggestionsManage = botMutation(65536, suggestions.manage)
export const suggestionsMember = botMutation(65536, suggestions.member)
export const suggestionsWork = botMutation(65536, suggestionsWorkModule.work)

export const cleanupQuery = botQuery(65536, cleanup.query)
export const cleanupManage = botMutation(65536, cleanup.manage)
export const cleanupWork = botMutation(65536, cleanupWorkModule.work)

export const metadataLogsQuery = botQuery(65536, metadataLogs.query)
export const metadataLogsManage = botMutation(65536, metadataLogs.manage)
export const metadataLogsAdmit = botMutation(65536, metadataLogs.admit)
export const metadataLogsWork = botMutation(65536, metadataLogsWorkModule.work)

export const backupSnapshot = botQuery(262144, backup.snapshot)
export const backupQuery = botQuery(262144, backup.query)
export const backupManage = botMutation(1048576, backup.manage)
export const backupWork = botMutation(262144, backup.work)
export const backupPreview = botMutation(4194304, backup.preview)
