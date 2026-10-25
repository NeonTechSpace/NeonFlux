import { Schema } from "effect"
import { Cursor, Id, Ids, Int, Millis, isId } from "./common.ts"

// The bot service: the deployment scope, multi-mode installations, the work dispatcher, its signal and the bill guard

/** Every bot request carries the HMAC-SHA256 of this label keyed by NEONFLUX_BOT_API_SECRET. Changing it changes the key on both sides */
export const SERVICE_KEY_LABEL = "neonflux/bot-service-key/v1"
/** Single mode names exactly one server. Multi mode serves the active installations listed by /service/installations/list */
export const ServiceScope = Schema.Union([
    Schema.Struct({ mode: Schema.Literal("single"), serverIds: Ids(1).check(Schema.isMinLength(1)) }),
    Schema.Struct({ mode: Schema.Literal("multi") }),
])
export type ServiceScope = typeof ServiceScope.Type
export const ServiceInstallationsListRequest = Schema.Struct({ cursor: Schema.optionalKey(Schema.NullOr(Cursor)) })
export type ServiceInstallationsListRequest = typeof ServiceInstallationsListRequest.Type
/**
 * The scope in the Convex deployment's NEONFLUX_SERVER_MODE and NEONFLUX_SERVER_ID, which the bot reads from its own environment
 * only when it runs without a backend. A server ID in multi mode is ambiguous and refused. Errors name the variable to fix, never a value
 */
export function parseServerScope(env: Readonly<Record<string, string | undefined>>): ServiceScope {
    const mode = env.NEONFLUX_SERVER_MODE ?? "single",
        serverId = env.NEONFLUX_SERVER_ID?.trim()
    if (mode !== "single" && mode !== "multi") throw new Error("Set NEONFLUX_SERVER_MODE to single or multi")
    if (mode === "multi") {
        if (serverId !== undefined)
            throw new Error("Remove NEONFLUX_SERVER_ID in multi mode. Multi mode serves every server the bot joins")
        return { mode }
    }
    if (!isId(serverId))
        throw new Error("Set NEONFLUX_SERVER_ID to the decimal ID of the server NeonFlux should manage")
    return { mode, serverIds: [serverId] }
}
/** Hosts that an origin may name over plain HTTP, for local testing */
const isLoopbackHost = (hostname: string) =>
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
/** An origin without credentials, path, query or fragment, using HTTPS or loopback HTTP */
export function parseOrigin(value: string): URL | undefined {
    let url: URL
    try {
        url = new URL(value)
    } catch {
        return undefined
    }
    if (
        (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
    )
        return undefined
    return url
}
/** The website origin, as the Convex deployment's NEONFLUX_WEBSITE_URL names it for the bot and the web server */
const WebsiteUrl = Schema.String.check(Schema.makeFilter((value: string) => parseOrigin(value)?.origin === value))
/** What the bot adopts at startup from /service/scope. websiteUrl is null when the deployment names no website */
export const ServiceStartup = Schema.Struct({ scope: ServiceScope, websiteUrl: Schema.NullOr(WebsiteUrl) })
export type ServiceStartup = typeof ServiceStartup.Type
export const ServiceInstallationPage = Schema.Struct({
    serverIds: Schema.mutable(Schema.Array(Id)),
    nextCursor: Schema.NullOr(Cursor),
})
export type ServiceInstallationPage = typeof ServiceInstallationPage.Type
/** A join or a leave of one server */
export const ServiceInstallationRequest = Schema.Struct({ serverId: Id })
export type ServiceInstallationRequest = typeof ServiceInstallationRequest.Type
/** welcome is set by the join that starts an installation, either the first or one after a removal, so the bot posts its note once per install */
export const ServiceInstallation = Schema.Struct({
    serverId: Id,
    active: Schema.Boolean,
    welcome: Schema.optionalKey(Schema.Literal(true)),
})
export type ServiceInstallation = typeof ServiceInstallation.Type
/** Background workers the bot wakes when /service/work reports due work for their server, in the order it wakes them, levels last */
export const ServiceWorkKind = Schema.Literals([
    "dashboard",
    "verification",
    "events",
    "schedules",
    "milestones",
    "suggestions",
    "cleanup",
    "metadata",
    "temproles",
    "helpdesk",
    "lfg",
    "youtube",
    "levels",
])
export type ServiceWorkKind = typeof ServiceWorkKind.Type
/**
 * The cursor is the previous answer's. held is the cursor of an earlier pass that a fresh read without a cursor goes on
 * with, for the sources the fresh read leaves unfinished. requestedAt only makes each call distinct, so a cached result
 * never hides work that became due since
 */
export const ServiceWorkRequest = Schema.Struct({
    cursor: Schema.optionalKey(Schema.NullOr(Cursor)),
    held: Schema.optionalKey(Schema.NullOr(Cursor)),
    requestedAt: Schema.optionalKey(Millis),
})
export type ServiceWorkRequest = typeof ServiceWorkRequest.Type
/** The passes of the bot's dashboard worker, one per kind of dashboard job, so a wake runs only the passes with work */
export const ServiceDashboardWork = Schema.Literals([
    "roles",
    "metadata",
    "configuration",
    "messages",
    "rolepicker",
    "setup",
    "private",
    "preview",
    "showcase",
    "profile",
    "structure",
])
export type ServiceDashboardWork = typeof ServiceDashboardWork.Type
const delay = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
/**
 * Servers with due work per worker, oldest due first. The cursor is opaque and goes back with the next request.
 * nextDueIn is how many milliseconds from now, by the backend clock, the next listed row becomes due, or null when none waits.
 * dashboard names the dashboard passes with work for servers listed under kinds.dashboard, and a server it leaves out runs every pass
 */
export const ServiceWork = Schema.Struct({
    kinds: Schema.Record(ServiceWorkKind, Ids(100).check(Schema.isUnique())),
    dashboard: Schema.optionalKey(Schema.Record(Id, Schema.Array(ServiceDashboardWork))),
    cursor: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))),
    nextDueIn: Schema.NullOr(delay),
})
export type ServiceWork = typeof ServiceWork.Type
/** The bot's work signal. version changes whenever a writer other than the bot creates work for it */
export const ServiceWorkSignal = Schema.Struct({ version: Int() })
export type ServiceWorkSignal = typeof ServiceWorkSignal.Type
/** The most calls one report may add, far above what one bot process makes between two reports */
const USAGE_REPORT_LIMIT = 100000000
/** The function calls the bot caused since its last accepted report */
export const ServiceUsageRequest = Schema.Struct({ calls: Int(0, USAGE_REPORT_LIMIT) })
export type ServiceUsageRequest = typeof ServiceUsageRequest.Type
/**
 * The month's billed calls after a bot usage report, as /service/usage answers it. budget is null when no budget is set.
 * state is paused from 90 percent of the budget and warning from the warning share. warn is true for the month's first report past the warning share
 */
export const ServiceUsage = Schema.Struct({
    month: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}$/)),
    calls: Int(),
    budget: Schema.NullOr(Int(1)),
    state: Schema.Literals(["normal", "warning", "paused"]),
    warn: Schema.Boolean,
})
export type ServiceUsage = typeof ServiceUsage.Type
/** A bot mutation's answer. dueIn is set when its writes created work, in milliseconds from now by the backend clock */
export const ServiceMutationResult = <S extends Schema.Top>(value: S) =>
    Schema.Struct({ value, dueIn: Schema.optionalKey(delay) })
export type ServiceMutationResult<T = unknown> = ReturnType<typeof ServiceMutationResult<Schema.Codec<T>>>["Type"]
/**
 * Every public function of the backend's botService module, by name, and whether it is a query or a mutation. The bot calls them by
 * these names, and a backend test checks the list against botService.ts. Mutations answer ServiceMutationResult
 */
export const BOT_FUNCTIONS = {
    serviceScope: "query",
    serviceInstallationsList: "query",
    serviceInstallationsJoin: "mutation",
    serviceInstallationsLeave: "mutation",
    serviceWork: "query",
    // Subscribed by the work dispatcher rather than requested
    serviceWorkSignal: "query",
    serviceTicketIntakes: "query",
    serviceUsage: "mutation",
    serviceMemberDataList: "query",
    serviceMemberDataServers: "query",
    serviceMemberDataExport: "query",
    serviceMemberDataDelete: "mutation",
    afkSet: "mutation",
    afkObserve: "mutation",
    generalGet: "query",
    generalManage: "mutation",
    generalNickname: "mutation",
    generalNicknameResult: "mutation",
    setupStatus: "query",
    setupReady: "query",
    setupRecord: "mutation",
    privateDataReady: "query",
    privateDataRecord: "mutation",
    recoveryList: "query",
    responsesManage: "mutation",
    responsesEvaluate: "mutation",
    moderationQuery: "query",
    moderationGate: "query",
    moderationManage: "mutation",
    moderationEvaluate: "mutation",
    moderationJoin: "mutation",
    moderationOutcome: "mutation",
    moderationLogOutcome: "mutation",
    moderationNoticeOutcome: "mutation",
    moderationReconcile: "mutation",
    moderationObserve: "mutation",
    appealsMember: "mutation",
    appealsStaff: "mutation",
    publishingQuery: "query",
    publishingManage: "mutation",
    publishingDispatch: "mutation",
    publishingOutcome: "mutation",
    publishingReconcile: "mutation",
    publishingObserve: "mutation",
    schedulesQuery: "query",
    schedulesManage: "mutation",
    schedulesDelivery: "mutation",
    rolesQuery: "query",
    rolesMemberQuery: "query",
    rolesPolicy: "query",
    rolesManage: "mutation",
    rolesReactionJobs: "mutation",
    rolesEvaluate: "mutation",
    rolesDispatch: "mutation",
    rolesOutcome: "mutation",
    rolesReconcile: "mutation",
    rolesObserve: "mutation",
    greetingsQuery: "query",
    greetingsMember: "query",
    greetingsPending: "query",
    greetingsManage: "mutation",
    greetingsObserve: "mutation",
    greetingsDiscover: "mutation",
    greetingsReserve: "mutation",
    greetingsDispatch: "mutation",
    greetingsOutcome: "mutation",
    greetingsDefer: "mutation",
    ticketsQuery: "query",
    ticketsManage: "mutation",
    ticketsIntake: "mutation",
    ticketsTranscript: "mutation",
    ticketsDispatch: "mutation",
    ticketsOutcome: "mutation",
    ticketsReconcile: "mutation",
    levelsQuery: "query",
    levelsPreflight: "query",
    levelsManage: "mutation",
    levelsAward: "mutation",
    levelsWork: "mutation",
    eventsQuery: "query",
    eventsManage: "mutation",
    eventsRsvp: "mutation",
    eventsWork: "mutation",
    eventsDelivery: "mutation",
    milestonesQuery: "query",
    milestonesManage: "mutation",
    milestonesPersonal: "mutation",
    milestonesDelivery: "mutation",
    suggestionsQuery: "query",
    suggestionsManage: "mutation",
    suggestionsMember: "mutation",
    suggestionsWork: "mutation",
    cleanupQuery: "query",
    cleanupManage: "mutation",
    cleanupWork: "mutation",
    voiceQuery: "query",
    voiceManage: "mutation",
    voiceRooms: "mutation",
    lfgQuery: "query",
    lfgManage: "mutation",
    lfgWork: "mutation",
    stickyList: "query",
    stickyManage: "mutation",
    stickyPosted: "mutation",
    sidebarGet: "query",
    sidebarManage: "mutation",
    alertsGet: "query",
    alertsManage: "mutation",
    alertsClaimAction: "mutation",
    alertsActionOutcome: "mutation",
    alertsObserveActions: "mutation",
    memberlistManage: "mutation",
    helpdeskGet: "query",
    helpdeskAnswers: "query",
    helpdeskManage: "mutation",
    helpdeskOpened: "mutation",
    helpdeskWork: "mutation",
    helpdeskGuard: "mutation",
    youtubeQuery: "query",
    youtubeManage: "mutation",
    youtubeWork: "mutation",
    metadataLogsQuery: "query",
    metadataLogsManage: "mutation",
    metadataLogsAdmit: "mutation",
    metadataLogsWork: "mutation",
    analyticsSettings: "query",
    analyticsSummary: "query",
    analyticsManage: "mutation",
    analyticsRecord: "mutation",
    backupSnapshot: "query",
    backupQuery: "query",
    backupManage: "mutation",
    backupWork: "mutation",
    backupPreview: "mutation",
    backupPreviewReady: "query",
    backupPreviewFailed: "mutation",
    backupRunStep: "mutation",
    structureReady: "query",
    structureAnswer: "mutation",
    structureClaim: "mutation",
    structureRecord: "mutation",
    structureChanged: "mutation",
    exportStart: "mutation",
    exportPage: "query",
    dashboardMetadataReady: "query",
    dashboardMetadataExecute: "mutation",
    dashboardMetadataFail: "mutation",
    dashboardConfigurationReady: "query",
    dashboardConfigurationClaim: "mutation",
    dashboardConfigurationExecute: "mutation",
    dashboardConfigurationFail: "mutation",
    dashboardMessagesReady: "query",
    dashboardMessagesReserve: "mutation",
    dashboardMessagesComplete: "mutation",
    dashboardMessagesFail: "mutation",
    dashboardRolesReady: "query",
    dashboardRolesExecute: "mutation",
    dashboardRolesReserve: "mutation",
    dashboardRolesComplete: "mutation",
    dashboardRolesFail: "mutation",
    rolepickerSettings: "query",
    rolepickerManage: "mutation",
    rolepickerReady: "query",
    rolepickerStart: "mutation",
    rolepickerComplete: "mutation",
    rolepickerFail: "mutation",
    temprolesQuery: "query",
    temprolesManage: "mutation",
    temprolesWork: "mutation",
    onboardingGet: "query",
    onboardingManage: "mutation",
    onboardingMember: "mutation",
    presetPlans: "query",
    presetApply: "mutation",
    showcaseManage: "mutation",
    showcaseSettings: "query",
    showcaseList: "query",
    showcaseReady: "query",
    showcaseStart: "mutation",
    showcaseComplete: "mutation",
    showcaseFail: "mutation",
    profileManage: "mutation",
    profileSettings: "query",
    profileShow: "query",
    profileReady: "query",
    profileApply: "mutation",
    profileFail: "mutation",
    verificationRequest: "query",
    verificationIssue: "mutation",
    verificationReady: "mutation",
    verificationClaim: "mutation",
    verificationDelivery: "mutation",
    verificationReview: "mutation",
} as const satisfies Record<string, "query" | "mutation">
export type BotFunction = keyof typeof BOT_FUNCTIONS
