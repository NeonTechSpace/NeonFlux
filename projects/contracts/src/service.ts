import { Schema } from "effect"
import { Cursor, Ids, Int, Millis, isId } from "./common.ts"

// The bot service: the deployment scope, the work dispatcher and its signal

/** Every bot request carries the HMAC-SHA256 of this label keyed by NEONFLUX_BOT_API_SECRET. Changing it changes the key on both sides */
export const SERVICE_KEY_LABEL = "neonflux/bot-service-key/v1"
/** The deployment names exactly one server */
export const ServiceScope = Schema.Struct({ serverIds: Ids(1).check(Schema.isMinLength(1)) })
export type ServiceScope = typeof ServiceScope.Type
/**
 * The scope in the Convex deployment's NEONFLUX_SERVER_ID, which the bot also reads when its operator sets it to check the
 * backend's scope. Errors name the variable to fix, never a value
 */
export function parseServerScope(env: Readonly<Record<string, string | undefined>>): ServiceScope {
    const serverId = env.NEONFLUX_SERVER_ID?.trim()
    if (!isId(serverId))
        throw new Error("Set NEONFLUX_SERVER_ID to the decimal ID of the server NeonFlux should manage")
    return { serverIds: [serverId] }
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
/** Background workers the bot wakes when /service/work reports due work for their server, in the order it wakes them, levels last */
export const ServiceWorkKind = Schema.Literals([
    "events",
    "schedules",
    "milestones",
    "suggestions",
    "cleanup",
    "metadata",
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
const delay = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
/**
 * Servers with due work per worker, oldest due first. The cursor is opaque and goes back with the next request.
 * nextDueIn is how many milliseconds from now, by the backend clock, the next listed row becomes due, or null when none waits
 */
export const ServiceWork = Schema.Struct({
    kinds: Schema.Record(ServiceWorkKind, Ids(100).check(Schema.isUnique())),
    cursor: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))),
    nextDueIn: Schema.NullOr(delay),
})
export type ServiceWork = typeof ServiceWork.Type
/** The bot's work signal. version changes whenever a writer other than the bot creates work for it */
export const ServiceWorkSignal = Schema.Struct({ version: Int() })
export type ServiceWorkSignal = typeof ServiceWorkSignal.Type
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
    serviceWork: "query",
    // Subscribed by the work dispatcher rather than requested
    serviceWorkSignal: "query",
    afkSet: "mutation",
    afkObserve: "mutation",
    generalGet: "query",
    generalManage: "mutation",
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
    metadataLogsQuery: "query",
    metadataLogsManage: "mutation",
    metadataLogsAdmit: "mutation",
    metadataLogsWork: "mutation",
} as const satisfies Record<string, "query" | "mutation">
export type BotFunction = keyof typeof BOT_FUNCTIONS
