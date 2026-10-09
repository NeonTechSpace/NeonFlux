import { ConvexError } from "convex/values"
import type { ServiceScope } from "../contracts.js"

const canonicalId = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n

export function parseServerScope(env: Record<string, string | undefined>): ServiceScope {
    const mode = env.NEONFLUX_SERVER_MODE ?? "single"
    if (mode !== "single" && mode !== "multi") throw new Error("NEONFLUX_SERVER_MODE must be single or multi")
    if (mode === "single") {
        if (env.NEONFLUX_SERVER_IDS !== undefined) throw new Error("NEONFLUX_SERVER_IDS must be absent in single mode")
        const serverId = env.NEONFLUX_SERVER_ID?.trim()
        if (!canonicalId(serverId)) throw new Error("NEONFLUX_SERVER_ID must be a canonical server ID in single mode")
        return { mode, serverIds: [serverId] }
    }
    if (env.NEONFLUX_SERVER_ID !== undefined) throw new Error("NEONFLUX_SERVER_ID must be absent in multi mode")
    // Multi mode serves the installations the bot registers when it joins servers, never an environment list
    if (env.NEONFLUX_SERVER_IDS !== undefined) throw new Error("NEONFLUX_SERVER_IDS is no longer used and must be removed in multi mode")
    return { mode }
}

export function configuredServerScope(): ServiceScope {
    try { return parseServerScope(process.env) } catch { throw new ConvexError({ status: 503, error: "Backend not configured" }) }
}

export function scopeDenied(): never {
    throw new ConvexError({ status: 403, error: "Server not allowed", code: "NEONFLUX_SCOPE_DENIED" })
}

// Native authority and membership facts the backend trusts. In multi mode any object carrying one must name its read server
const nativeFacts = ["managerAuthorized", "adminAuthorized", "actorAuthorized", "nativePermissionAuthorized", "isOwner", "isAdministrator",
    "memberAbsent", "privateChannelVerified", "actorCanManage", "actorCanManageChannels", "botAuthorized"]

// The bot names the server of every native read in originServerId or memberOriginServerId.
// Evidence read from one allowed server can never authorize work in another
export function requireOrigin(value: unknown, serverId: string, multi: boolean, depth = 0): void {
    if (depth > 32) throw new ConvexError({ status: 400, error: "Invalid request" })
    if (value === null || typeof value !== "object") return
    if (multi && !Array.isArray(value) && nativeFacts.some(key => Object.hasOwn(value, key)) && !Object.hasOwn(value, "originServerId") && !Object.hasOwn(value, "memberOriginServerId")) {
        throw new ConvexError({ status: 403, error: "Native evidence server mismatch" })
    }
    for (const [key, child] of Object.entries(value)) {
        if ((key === "originServerId" || key === "memberOriginServerId") && child !== serverId) {
            throw new ConvexError({ status: 403, error: "Native evidence server mismatch" })
        }
        requireOrigin(child, serverId, multi, depth + 1)
    }
}
