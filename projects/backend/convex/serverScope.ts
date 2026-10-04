import { ConvexError } from "convex/values"
import { parseServerScope, type ServiceScope } from "@neonflux/contracts/service"

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
        return misconfigured(error instanceof Error ? error.message : "Check NEONFLUX_SERVER_ID")
    }
}

export function scopeDenied(): never {
    throw new ConvexError({ status: 403, error: "Server not allowed", code: "NEONFLUX_SCOPE_DENIED" })
}

// The bot names the server of every native read in originServerId or memberOriginServerId.
// Evidence read from one allowed server can never authorize work in another
export function requireOrigin(value: unknown, serverId: string, depth = 0): void {
    if (depth > 32) throw new ConvexError({ status: 400, error: "Invalid request" })
    if (value === null || typeof value !== "object") return
    for (const [key, child] of Object.entries(value)) {
        if ((key === "originServerId" || key === "memberOriginServerId") && child !== serverId) {
            throw new ConvexError({ status: 403, error: "Native evidence server mismatch" })
        }
        requireOrigin(child, serverId, depth + 1)
    }
}
