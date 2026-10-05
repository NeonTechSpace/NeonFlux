import { Schema } from "effect"
import { Ids, isId } from "./common.ts"

// The bot service: the deployment scope

/** Single mode names its one server. Multi mode names one to ten servers */
export const ServiceScope = Schema.Struct({ mode: Schema.Literals(["single", "multi"]), serverIds: Ids(10) })
export type ServiceScope = typeof ServiceScope.Type
/**
 * The scope in the Convex deployment's NEONFLUX_SERVER_MODE with NEONFLUX_SERVER_ID or NEONFLUX_SERVER_IDS, which the bot also reads when its
 * operator sets them to check the backend's scope. A variable the mode does not use is ambiguous and refused. Errors name the variable to fix, never a value
 */
export function parseServerScope(env: Readonly<Record<string, string | undefined>>): ServiceScope {
    const mode = env.NEONFLUX_SERVER_MODE ?? "single"
    if (mode !== "single" && mode !== "multi") throw new Error("Set NEONFLUX_SERVER_MODE to single or multi")
    if (mode === "single") {
        if (env.NEONFLUX_SERVER_IDS !== undefined) throw new Error("Remove NEONFLUX_SERVER_IDS in single mode")
        const serverId = env.NEONFLUX_SERVER_ID?.trim()
        if (!isId(serverId)) throw new Error("Set NEONFLUX_SERVER_ID to the decimal ID of the server NeonFlux should manage")
        return { mode, serverIds: [serverId] }
    }
    if (env.NEONFLUX_SERVER_ID !== undefined) throw new Error("Remove NEONFLUX_SERVER_ID in multi mode")
    let ids: unknown
    try { ids = JSON.parse(env.NEONFLUX_SERVER_IDS ?? "") } catch { throw new Error("Set NEONFLUX_SERVER_IDS to a JSON array of one to ten canonical server IDs") }
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10 || !ids.every(isId) || new Set(ids).size !== ids.length) {
        throw new Error("Set NEONFLUX_SERVER_IDS to a JSON array of one to ten distinct canonical server IDs")
    }
    return { mode, serverIds: (ids as string[]).sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1) }
}
/** Hosts that an origin may name over plain HTTP, for local testing */
export const isLoopbackHost = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
/** An origin without credentials, path, query or fragment, using HTTPS or loopback HTTP */
export function parseOrigin(value: string): URL | undefined {
    let url: URL
    try { url = new URL(value) } catch { return undefined }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname)) || url.username || url.password || url.search || url.hash || url.pathname !== "/") return undefined
    return url
}
/** The website origin, as the Convex deployment's NEONFLUX_WEBSITE_URL names it for the bot and the web server */
export const WebsiteUrl = Schema.String.check(Schema.makeFilter((value: string) => parseOrigin(value)?.origin === value))
/** What the bot adopts at startup from /service/scope. websiteUrl is null when the deployment names no website */
export const ServiceStartup = Schema.Struct({ scope: ServiceScope, websiteUrl: Schema.NullOr(WebsiteUrl) })
export type ServiceStartup = typeof ServiceStartup.Type
