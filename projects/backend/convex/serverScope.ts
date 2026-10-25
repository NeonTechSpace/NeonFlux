import { ConvexError } from "convex/values"
import { parseOrigin, parseServerScope, type ServiceScope } from "@neonflux/contracts/service"

/** Answers 503 to the caller and logs the variable to fix, never its value */
export function misconfigured(message: string): never {
    console.error(message)
    throw new ConvexError({ status: 503, error: "Backend not configured" })
}

// The deployment owns the scope, and the bot adopts it at startup
export function configuredServerScope(): ServiceScope {
    try {
        return parseServerScope(process.env)
    } catch (error) {
        return misconfigured(
            error instanceof Error ? error.message : "Check NEONFLUX_SERVER_MODE and NEONFLUX_SERVER_ID",
        )
    }
}

/** The one website origin the bot and the web server adopt, or null when the deployment names none */
export function configuredWebsiteUrl(): string | null {
    const value = process.env.NEONFLUX_WEBSITE_URL?.trim()
    if (!value) return null
    return (
        parseOrigin(value)?.origin ??
        misconfigured("Set NEONFLUX_WEBSITE_URL to the website origin, using HTTPS or loopback HTTP, without a path")
    )
}

export function scopeDenied(): never {
    throw new ConvexError({ status: 403, error: "Server not allowed", code: "NEONFLUX_SCOPE_DENIED" })
}

// Native authority and membership facts the backend trusts. In multi mode any object carrying one must name its read server
const nativeFacts = [
    "managerAuthorized",
    "adminAuthorized",
    "actorAuthorized",
    "nativePermissionAuthorized",
    "isOwner",
    "isAdministrator",
    "memberAbsent",
    "privateChannelVerified",
    "staffChannelRoleIds",
    "actorCanManage",
    "actorCanManageChannels",
    "botAuthorized",
]

// The bot names the server of every native read in originServerId or memberOriginServerId.
// Evidence read from one allowed server can never authorize work in another
export function requireOrigin(value: unknown, serverId: string, multi: boolean, depth = 0): void {
    if (depth > 32) throw new ConvexError({ status: 400, error: "Invalid request" })
    if (value === null || typeof value !== "object") return
    if (
        multi &&
        !Array.isArray(value) &&
        nativeFacts.some((key) => Object.hasOwn(value, key)) &&
        !Object.hasOwn(value, "originServerId") &&
        !Object.hasOwn(value, "memberOriginServerId")
    ) {
        throw new ConvexError({ status: 403, error: "Native evidence server mismatch" })
    }
    for (const [key, child] of Object.entries(value)) {
        if ((key === "originServerId" || key === "memberOriginServerId") && child !== serverId) {
            throw new ConvexError({ status: 403, error: "Native evidence server mismatch" })
        }
        requireOrigin(child, serverId, multi, depth + 1)
    }
}
