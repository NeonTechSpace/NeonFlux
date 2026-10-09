import { Schema } from "effect"
import { Cursor, Id, Ids, isId } from "./common.ts"

// The bot service: the deployment scope, multi-mode installations and the work dispatcher

/** Single mode names exactly one server. Multi mode serves the active installations listed by /service/installations/list */
export const ServiceScope = Schema.Union([Schema.Struct({ mode: Schema.Literal("single"), serverIds: Ids(1).check(Schema.isMinLength(1)) }), Schema.Struct({ mode: Schema.Literal("multi") })])
export type ServiceScope = typeof ServiceScope.Type
export const ServiceInstallationsListRequest = Schema.Struct({ cursor: Schema.optionalKey(Schema.NullOr(Cursor)) })
export type ServiceInstallationsListRequest = typeof ServiceInstallationsListRequest.Type
/**
 * The scope in the Convex deployment's NEONFLUX_SERVER_MODE and NEONFLUX_SERVER_ID, which the bot also reads when its operator
 * sets them to check the backend's scope. A server ID in multi mode is ambiguous and refused. Errors name the variable to fix, never a value
 */
export function parseServerScope(env: Readonly<Record<string, string | undefined>>): ServiceScope {
    const mode = env.NEONFLUX_SERVER_MODE ?? "single", serverId = env.NEONFLUX_SERVER_ID?.trim()
    if (mode !== "single" && mode !== "multi") throw new Error("Set NEONFLUX_SERVER_MODE to single or multi")
    if (mode === "multi") {
        if (serverId !== undefined) throw new Error("Remove NEONFLUX_SERVER_ID in multi mode. Multi mode serves every server the bot joins")
        return { mode }
    }
    if (!isId(serverId)) throw new Error("Set NEONFLUX_SERVER_ID to the decimal ID of the server NeonFlux should manage")
    return { mode, serverIds: [serverId] }
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
export const ServiceInstallationPage = Schema.Struct({ serverIds: Schema.mutable(Schema.Array(Id)), nextCursor: Schema.NullOr(Cursor) })
export type ServiceInstallationPage = typeof ServiceInstallationPage.Type
/** A join or a leave of one server */
export const ServiceInstallationRequest = Schema.Struct({ serverId: Id })
export type ServiceInstallationRequest = typeof ServiceInstallationRequest.Type
export const ServiceInstallation = Schema.Struct({ serverId: Id, active: Schema.Boolean })
export type ServiceInstallation = typeof ServiceInstallation.Type
/** Background workers the bot wakes when /service/work reports due work for their server */
export const ServiceWorkKind = Schema.Literals(["dashboard", "verification", "events", "schedules", "milestones", "suggestions", "cleanup", "metadata", "levels"])
export type ServiceWorkKind = typeof ServiceWorkKind.Type
/** The cursor is the previous answer's */
export const ServiceWorkRequest = Schema.Struct({ cursor: Schema.optionalKey(Schema.NullOr(Cursor)) })
export type ServiceWorkRequest = typeof ServiceWorkRequest.Type
/** The passes of the bot's dashboard worker, one per kind of dashboard job, so a wake runs only the passes with work */
export const ServiceDashboardWork = Schema.Literals(["roles", "metadata", "configuration", "messages"])
export type ServiceDashboardWork = typeof ServiceDashboardWork.Type
/**
 * Servers with due work per worker, oldest due first. The cursor is opaque and goes back with the next request.
 * dashboard names the dashboard passes with work for servers listed under kinds.dashboard, and a server it leaves out runs every pass
 */
export const ServiceWork = Schema.Struct({ kinds: Schema.Record(ServiceWorkKind, Ids(100).check(Schema.isUnique())),
    dashboard: Schema.optionalKey(Schema.Record(Id, Schema.Array(ServiceDashboardWork))),
    cursor: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))) })
export type ServiceWork = typeof ServiceWork.Type
