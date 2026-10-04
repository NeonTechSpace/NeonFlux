import { Schema } from "effect"
import { Ids, isId } from "./common.ts"

// The bot service: the deployment scope

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
/**
 * Every public function of the backend's botService module, by name, and whether it is a query or a mutation. The bot calls them by
 * these names, and a backend test checks the list against botService.ts
 */
export const BOT_FUNCTIONS = {
    serviceScope: "query",
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
} as const satisfies Record<string, "query" | "mutation">
export type BotFunction = keyof typeof BOT_FUNCTIONS
