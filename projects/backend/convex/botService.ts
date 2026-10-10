import type { RegisteredMutation, RegisteredQuery } from "convex/server"
import { ConvexError, v } from "convex/values"
import { mutation, query, type MutationCtx } from "./_generated/server.js"
import type { TableNames } from "./_generated/dataModel.js"
import type { MemberDataDeletePage, ServiceInstallation, ServiceMutationResult, ServiceScope, ServiceUsage } from "../contracts.js"
import { cursor, fail, isId, REASON_CODES, requireId } from "./validation.ts"
import { requireOrigin, scopeDenied } from "./serverScope.ts"
import { requireServiceKey } from "./serviceKey.ts"
import { joinInstallation, leaveInstallation, listInstallations, serviceHandler } from "./installations.ts"
import { dueWork, rowDueAt, WORK_TABLES } from "./workDispatch.ts"
import { readWorkSignal } from "./workSignal.ts"
import { recordUsage } from "./usage.ts"
import { memberDataCursor, memberDataDelete, memberDataExport, memberDataList, memberDataServerCursor, memberDataServers, memberDataUser } from "./memberData.ts"
import { afkMentions, afkReason } from "./afkDomain.ts"
import * as afk from "./afk.ts"
import * as generalSettings from "./generalSettings.ts"
import * as setupCheck from "./setupCheck.ts"
import * as privateData from "./privateData.ts"
import * as recovery from "./recovery.ts"
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
import * as voice from "./voice.ts"
import * as lfg from "./lfg.ts"
import * as sticky from "./sticky.ts"
import * as sidebar from "./sidebar.ts"
import * as alerts from "./alerts.ts"
import * as memberList from "./memberList.ts"
import * as helpDesk from "./helpDesk.ts"
import * as metadataLogs from "./metadataLogs.ts"
import * as metadataLogsWorkModule from "./metadataLogsWork.ts"
import * as analytics from "./analytics.ts"
import * as backup from "./backup.ts"
import * as serverExport from "./serverExport.ts"
import * as structure from "./structure.ts"
import * as dashboardMetadata from "./dashboardMetadata.ts"
import * as dashboardConfiguration from "./dashboardConfiguration.ts"
import * as dashboardMessages from "./dashboardMessages.ts"
import * as dashboardRoles from "./dashboardRoles.ts"
import * as rolePicker from "./rolePicker.ts"
import * as temporaryRoles from "./temporaryRoles.ts"
import * as onboarding from "./onboarding.ts"
import * as presets from "./presets.ts"
import * as showcases from "./showcases.ts"
import * as profiles from "./profiles.ts"
import * as verification from "./verification.ts"

// The bot's entry points. Each is a public function that checks the key derived from the bot secret before it reads
// anything, binds the request to one server like the former HTTP routes and then runs the service function's own
// installation-checked handler in this transaction. Nothing here calls ctx.runQuery or ctx.runMutation, so each bot
// request is one function call. The bot maps its request paths to these names in bot/src/backend-routes.ts.
// Mutations answer { value, dueIn }, where dueIn says when work their writes created becomes due

type Service = Record<string, unknown> & { serverId: string }
const entryArgs = { key: v.optional(v.any()), serverId: v.optional(v.any()), request: v.optional(v.any()) }
type EntryArgs = { key?: unknown, serverId?: unknown, request?: unknown }

// Errors carry only a status, a fixed message and the scope denial code or a reason code. Anything else answers 503 like the former routes
async function entry<Result>(work: () => Promise<Result>): Promise<Result> {
    try {
        return await work()
    } catch (error) {
        const data = error instanceof ConvexError ? error.data as { status?: unknown, error?: unknown, code?: unknown } | null : null
        if (typeof data?.status === "number" && typeof data.error === "string" && data.status >= 400 && data.status <= 599) {
            const code = typeof data.code === "string" && (data.code === "NEONFLUX_SCOPE_DENIED" || REASON_CODES.includes(data.code)) ? { code: data.code } : {}
            throw new ConvexError({ status: data.status, error: data.error, ...code })
        }
        console.error("Bot service function failed", error)
        throw new ConvexError({ status: 503, error: "Backend unavailable" })
    }
}

// The request as the former routes parsed it from JSON, so handlers see the same values, within the route's limit in UTF-16 code units
function readRequest(value: unknown, limit: number): Record<string, unknown> {
    let text: string | undefined
    try { text = JSON.stringify(value) } catch { fail(400, "Invalid JSON") }
    if (text !== undefined && text.length > limit) fail(413, "Request too large")
    const body: unknown = text === undefined ? undefined : JSON.parse(text)
    if (body === null || typeof body !== "object" || Array.isArray(body)) fail(400, "Invalid request")
    return body as Record<string, unknown>
}

// Every bot request is bound to one server before any feature code runs. serverId selects it, optional in single mode, and
// the request and all native evidence must name the same server. The service handler then requires the installation
async function boundRequest(args: EntryArgs, limit: number): Promise<Service> {
    const scope = await requireServiceKey(args.key)
    const serverId = args.serverId ?? (scope.mode === "single" ? scope.serverIds[0]! : "")
    if (!isId(serverId) || scope.mode === "single" && serverId !== scope.serverIds[0]) scopeDenied()
    const body = readRequest(args.request, limit)
    if (body.serverId !== serverId) scopeDenied()
    requireOrigin(body, serverId, scope.mode === "multi")
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
    const tableOf = (id: string) => [...WORK_TABLES].find(table => ctx.db.normalizeId(table, id) !== null)
    const db = new Proxy(ctx.db, { get: (target, property) => {
        if (property === "insert") return async (table: TableNames, value: Record<string, unknown>) => {
            const id = await target.insert(table, value as never)
            if (WORK_TABLES.has(table)) note(table, value)
            return id
        }
        if (property === "patch" || property === "replace") return async (...args: unknown[]) => {
            await (target[property] as (...values: unknown[]) => Promise<void>)(...args)
            const [table, id] = args.length === 3 ? [args[0] as TableNames, args[1] as string] : [tableOf(args[0] as string), args[0] as string]
            if (table && WORK_TABLES.has(table)) note(table, await target.get(id as never) as Record<string, unknown> | null)
        }
        const value: unknown = Reflect.get(target, property)
        return typeof value === "function" ? value.bind(target) : value
    } })
    return { ctx: { ...ctx, db }, answer: <T>(value: T): ServiceMutationResult<T> => dueAt === undefined ? { value } : { value, dueIn: Math.max(0, dueAt - now) } }
}

function botQuery<Returns>(limit: number, fn: RegisteredQuery<"internal", { request: any }, Returns>) {
    const handler = serviceHandler(fn, "query")
    return query({ args: entryArgs, handler: (ctx, args) => entry(async () => await handler(inline(ctx), { request: await boundRequest(args, limit) }) as Awaited<Returns>) })
}
function botMutation<Returns>(limit: number, fn: RegisteredMutation<"internal", { request: any }, Returns>) {
    const handler = serviceHandler(fn, "mutation")
    return mutation({ args: entryArgs, handler: (ctx, args) => entry(async () => {
        const request = await boundRequest(args, limit), writes = observed(ctx, Date.now())
        return writes.answer(await handler(inline(writes.ctx), { request }) as Awaited<Returns>)
    }) })
}

// The bot compares this scope with its own before starting any server runtime
export const serviceScope = query({ args: entryArgs, handler: (_ctx, args): Promise<ServiceScope> => entry(() => requireServiceKey(args.key)) })

// Multi mode only. These bind no server, and repeating a call leaves the same state
async function installationRequest(args: EntryArgs) {
    const scope = await requireServiceKey(args.key)
    if (scope.mode !== "multi") fail(404, "Server installations require multi mode")
    return readRequest(args.request, 4096)
}
export const serviceInstallationsList = query({ args: entryArgs, handler: (ctx, args) => entry(async () => listInstallations(ctx, cursor((await installationRequest(args)).cursor))) })
// A server that joins again may have retained due work, so the bot dispatches soon after
export const serviceInstallationsJoin = mutation({ args: entryArgs, handler: (ctx, args) => entry(async (): Promise<ServiceMutationResult<ServiceInstallation>> =>
    ({ value: await joinInstallation(ctx, requireId((await installationRequest(args)).serverId)), dueIn: 0 })) })
export const serviceInstallationsLeave = mutation({ args: entryArgs, handler: (ctx, args) => entry(async (): Promise<ServiceMutationResult<ServiceInstallation>> =>
    ({ value: await leaveInstallation(ctx, requireId((await installationRequest(args)).serverId)) })) })

// The bot's one work dispatcher calls this in both modes. It binds no server and reads only bounded global indexes.
// Due checks use the backend clock, the same clock the worker functions use. The bot's requestedAt only makes each call
// distinct, so a cached query result never hides work that became due since
export const serviceWork = query({ args: entryArgs, handler: (ctx, args) => entry(async () => {
    await requireServiceKey(args.key)
    return dueWork(ctx, Date.now(), cursor(readRequest(args.request, 4096).cursor))
}) })

// The bot subscribes to this. It returns only the signal's counter, so a subscriber learns nothing about any server
export const serviceWorkSignal = query({ args: entryArgs, handler: (ctx, args) => entry(async () => {
    await requireServiceKey(args.key)
    return readWorkSignal(ctx)
}) })

// The bot reports the function calls it caused since its last report, at most every five minutes, and learns the bill guard's state
export const serviceUsage = mutation({ args: entryArgs, handler: (ctx, args) => entry(async (): Promise<ServiceMutationResult<ServiceUsage>> => {
    await requireServiceKey(args.key)
    return { value: await recordUsage(ctx, readRequest(args.request, 4096).calls, Date.now()) }
}) })

// A plain DM names no server, so this finds a member's open ticket intakes in both modes. It answers server and intake numbers only
export const serviceTicketIntakes = query({ args: entryArgs, handler: (ctx, args) => entry(async () => {
    const scope = await requireServiceKey(args.key)
    return tickets.openIntakes(ctx, scope, requireId(readRequest(args.request, 4096).userId))
}) })

// Member data rights. A member asks in a private conversation the bot verified, so the key vouches for the member's ID.
// These bind no server, because a member's data spans every server, including removed servers that wait for their purge
async function memberDataRequest(args: EntryArgs) {
    await requireServiceKey(args.key)
    const body = readRequest(args.request, 4096)
    return { body, userId: memberDataUser(body.userId) }
}
export const serviceMemberDataList = query({ args: entryArgs, handler: (ctx, args) => entry(async () => memberDataList(ctx, (await memberDataRequest(args)).userId)) })
export const serviceMemberDataServers = query({ args: entryArgs, handler: (ctx, args) => entry(async () => {
    const { body, userId } = await memberDataRequest(args)
    return memberDataServers(ctx, userId, memberDataServerCursor(body.cursor))
}) })
export const serviceMemberDataExport = query({ args: entryArgs, handler: (ctx, args) => entry(async () => {
    const { body, userId } = await memberDataRequest(args)
    return memberDataExport(ctx, userId, requireId(body.serverId), memberDataCursor(body.cursor))
}) })
export const serviceMemberDataDelete = mutation({ args: entryArgs, handler: (ctx, args) => entry(async (): Promise<ServiceMutationResult<MemberDataDeletePage>> => {
    const { body, userId } = await memberDataRequest(args)
    const name = typeof body.userName === "string" && body.userName.length >= 1 && body.userName.length <= 100 ? body.userName : undefined
    return { value: await memberDataDelete(inline(ctx), { userId, name }, requireId(body.serverId), memberDataCursor(body.cursor)) }
}) })

const setAfk = serviceHandler(afk.setStatus, "mutation"), observeAfk = serviceHandler(afk.observeMessage, "mutation")
export const afkSet = mutation({ args: entryArgs, handler: (ctx, args) => entry(async () => {
    const body = await boundRequest(args, 4096)
    if (!isId(body.userId)) fail(400, "Invalid member ID")
    const reason = afkReason(body.reason)
    if (reason === null) fail(400, "Away messages must contain 1 to 200 characters")
    return { value: await setAfk(inline(ctx), { serverId: body.serverId, userId: body.userId, reason }) }
}) })
export const afkObserve = mutation({ args: entryArgs, handler: (ctx, args) => entry(async () => {
    const body = await boundRequest(args, 4096)
    if (!isId(body.userId)) fail(400, "Invalid member ID")
    const mentionedUserIds = afkMentions(body.mentionedUserIds)
    if (mentionedUserIds === null) fail(400, "Invalid mentions")
    return { value: await observeAfk(inline(ctx), { serverId: body.serverId, userId: body.userId, mentionedUserIds }) }
}) })

export const setupStatus = botQuery(4096, setupCheck.status)
export const setupReady = botQuery(4096, setupCheck.ready)
export const setupRecord = botMutation(65536, setupCheck.record)
export const privateDataReady = botQuery(4096, privateData.ready)
export const privateDataRecord = botMutation(65536, privateData.record)
export const recoveryList = botQuery(4096, recovery.list)

export const generalGet = botQuery(4096, generalSettings.get)
export const generalManage = botMutation(4096, generalSettings.manage)
export const generalNickname = botMutation(4096, generalSettings.nickname)
export const generalNicknameResult = botMutation(4096, generalSettings.nicknameResult)

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

export const voiceQuery = botQuery(65536, voice.query)
export const voiceManage = botMutation(65536, voice.manage)
export const voiceRooms = botMutation(65536, voice.rooms)
export const lfgQuery = botQuery(4096, lfg.query)
export const lfgManage = botMutation(8192, lfg.manage)
export const lfgWork = botMutation(4096, lfg.work)
export const stickyList = botQuery(4096, sticky.list)
export const stickyManage = botMutation(8192, sticky.manage)
export const stickyPosted = botMutation(4096, sticky.posted)
export const sidebarGet = botQuery(4096, sidebar.get)
export const sidebarManage = botMutation(4096, sidebar.manage)
export const alertsGet = botQuery(4096, alerts.get)
export const alertsManage = botMutation(8192, alerts.manage)
export const memberlistManage = botMutation(16384, memberList.manage)
export const helpdeskGet = botQuery(4096, helpDesk.get)
export const helpdeskAnswers = botQuery(4096, helpDesk.answers)
export const helpdeskManage = botMutation(16384, helpDesk.manage)
export const helpdeskOpened = botMutation(4096, helpDesk.opened)
export const helpdeskWork = botMutation(4096, helpDesk.work)
export const helpdeskGuard = botMutation(4096, helpDesk.guard)

export const metadataLogsQuery = botQuery(65536, metadataLogs.query)
export const metadataLogsManage = botMutation(65536, metadataLogs.manage)
export const metadataLogsAdmit = botMutation(65536, metadataLogs.admit)
export const metadataLogsWork = botMutation(65536, metadataLogsWorkModule.work)

export const analyticsSettings = botQuery(4096, analytics.settings)
export const analyticsSummary = botQuery(4096, analytics.summary)
export const analyticsManage = botMutation(4096, analytics.manage)
export const analyticsRecord = botMutation(65536, analytics.record)

export const backupSnapshot = botQuery(262144, backup.snapshot)
export const backupQuery = botQuery(262144, backup.query)
export const backupManage = botMutation(1048576, backup.manage)
export const backupWork = botMutation(262144, backup.work)
export const backupPreview = botMutation(1048576, backup.preview)
export const backupPreviewReady = botQuery(4096, backup.previewReady)
export const backupPreviewFailed = botMutation(4096, backup.previewFailed)
export const structureReady = botQuery(4096, structure.ready)
export const structureAnswer = botMutation(524288, structure.answer)
export const structureClaim = botMutation(262144, structure.claim)
export const structureRecord = botMutation(65536, structure.record)
export const structureChanged = botMutation(4096, structure.changed)

export const exportStart = botMutation(4096, serverExport.serviceStart)
export const exportPage = botQuery(8192, serverExport.servicePage)

export const dashboardMetadataReady = botQuery(65536, dashboardMetadata.ready)
export const dashboardMetadataExecute = botMutation(65536, dashboardMetadata.execute)
export const dashboardMetadataFail = botMutation(65536, dashboardMetadata.failJob)
export const dashboardConfigurationReady = botQuery(65536, dashboardConfiguration.ready)
export const dashboardConfigurationExecute = botMutation(65536, dashboardConfiguration.execute)
export const dashboardConfigurationFail = botMutation(65536, dashboardConfiguration.failJob)
export const dashboardMessagesReady = botQuery(4096, dashboardMessages.ready)
export const dashboardMessagesReserve = botMutation(4096, dashboardMessages.reserve)
export const dashboardMessagesComplete = botMutation(4096, dashboardMessages.complete)
export const dashboardMessagesFail = botMutation(4096, dashboardMessages.failJob)
export const dashboardRolesReady = botQuery(65536, dashboardRoles.ready)
export const dashboardRolesExecute = botMutation(65536, dashboardRoles.execute)
export const dashboardRolesReserve = botMutation(65536, dashboardRoles.reserve)
export const dashboardRolesComplete = botMutation(65536, dashboardRoles.complete)
export const dashboardRolesFail = botMutation(65536, dashboardRoles.failJob)

export const rolepickerSettings = botQuery(4096, rolePicker.settings)
export const rolepickerManage = botMutation(65536, rolePicker.manage)
export const rolepickerReady = botQuery(4096, rolePicker.ready)
export const rolepickerStart = botMutation(262144, rolePicker.start)
export const rolepickerComplete = botMutation(262144, rolePicker.complete)
export const rolepickerFail = botMutation(4096, rolePicker.failRequest)

export const temprolesQuery = botQuery(4096, temporaryRoles.query)
export const temprolesManage = botMutation(262144, temporaryRoles.manage)
export const temprolesWork = botMutation(4096, temporaryRoles.work)
export const onboardingGet = botQuery(4096, onboarding.get)
export const onboardingManage = botMutation(262144, onboarding.manage)
export const onboardingMember = botMutation(262144, onboarding.member)
export const presetPlans = botQuery(4096, presets.plans)
export const presetApply = botMutation(8192, presets.apply)
export const showcaseManage = botMutation(8192, showcases.manage)
export const showcaseSettings = botQuery(4096, showcases.settings)
export const showcaseList = botQuery(4096, showcases.list)
export const showcaseReady = botQuery(4096, showcases.ready)
export const showcaseStart = botMutation(16384, showcases.start)
export const showcaseComplete = botMutation(4096, showcases.complete)
export const showcaseFail = botMutation(4096, showcases.failRequest)
export const profileManage = botMutation(8192, profiles.manage)
export const profileSettings = botQuery(4096, profiles.settings)
export const profileShow = botQuery(16384, profiles.show)
export const profileReady = botQuery(4096, profiles.ready)
export const profileApply = botMutation(16384, profiles.apply)
export const profileFail = botMutation(4096, profiles.failRequest)

export const verificationRequest = botQuery(65536, verification.request)
export const verificationIssue = botMutation(65536, verification.issue)
export const verificationReady = botMutation(65536, verification.ready)
export const verificationClaim = botMutation(65536, verification.claim)
export const verificationDelivery = botMutation(65536, verification.delivery)
export const verificationReview = botMutation(65536, verification.review)
