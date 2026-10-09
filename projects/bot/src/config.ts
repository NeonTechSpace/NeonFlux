import { parseOrigin, parseServerScope } from "@neonflux/contracts/service"
import { type DeploymentScope } from "./server-scope.ts"
import { Data, Effect, Redacted } from "effect"
import { parseBackupKey, type BackupKey } from "./backup-crypto.ts"

/**
 * Process configuration. Single mode names its server here, while multi mode has no server until the bot joins one. The scope and
 * the website origin are the backend's, adopted at startup. Before that, scope holds the operator's own scope variables, if any
 */
export interface BotRootConfig {
    readonly token: Redacted.Redacted<string>
    readonly serverId?: string
    readonly scope?: DeploymentScope
    readonly backend?: BackendConfig
    readonly customStatus?: string
    readonly backupKey?: BackupKey
    readonly websiteUrl?: string
}

/** Configuration of one server runtime */
export interface BotConfig extends BotRootConfig {
    readonly serverId: string
}

export interface BackendConfig {
    readonly siteUrl: string
    readonly serverId?: string
    readonly scopeMode?: "single" | "multi"
    readonly onScopeDenied?: () => void
    readonly isActive?: () => boolean
    readonly secret: Redacted.Redacted<string>
}

export class BotConfigError extends Data.TaggedError("BotConfigError")<{
    readonly message: string
}> {}

export function readConfig(environment: Readonly<NodeJS.ProcessEnv>) {
    return Effect.gen(function* () {
        const token = environment.FLUXER_BOT_TOKEN?.trim()
        if (!token) {
            return yield* Effect.fail(new BotConfigError({
                message: "Set FLUXER_BOT_TOKEN to the bot token before starting NeonFlux",
            }))
        }

        // The backend owns the scope. Scope variables the operator sets here are only compared with it at startup, and a blank line counts as unset
        const scopeNames = ["NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_ID"] as const
        const scopeEnvironment = Object.fromEntries(scopeNames.flatMap(name => environment[name]?.trim() ? [[name, environment[name]]] : []))
        const scope = Object.keys(scopeEnvironment).length === 0 ? undefined : yield* Effect.try({ try: () => parseServerScope(scopeEnvironment),
            catch: error => new BotConfigError({ message: error instanceof Error ? error.message : "Check server scope configuration" }) })

        const siteUrl = environment.CONVEX_SITE_URL?.trim()
        const customStatus = environment.NEONFLUX_CUSTOM_STATUS?.trim()
        if (customStatus && (customStatus.length > 128 || /[\u000c\u202e]/.test(customStatus))) {
            return yield* Effect.fail(new BotConfigError({ message: "Set NEONFLUX_CUSTOM_STATUS to at most 128 characters of normal status text" }))
        }
        // The backend compares the secret as written, so surrounding space would make the two differ
        const backendSecret = environment.NEONFLUX_BOT_API_SECRET
        let backend: BackendConfig | undefined
        if (siteUrl || backendSecret?.trim()) {
            const url = siteUrl ? parseOrigin(siteUrl) : undefined
            if (!url) {
                return yield* Effect.fail(new BotConfigError({
                    message: "Set CONVEX_SITE_URL to the Convex HTTP Actions origin, using HTTPS or local HTTP",
                }))
            }
            if (!backendSecret || backendSecret.length < 32 || backendSecret !== backendSecret.trim()) {
                return yield* Effect.fail(new BotConfigError({
                    message: "Set NEONFLUX_BOT_API_SECRET to a dedicated backend credential of at least 32 characters, without surrounding spaces",
                }))
            }
            backend = { siteUrl: url.origin, secret: Redacted.make(backendSecret) }
        }

        if (!backend && scope?.mode !== "single") {
            return yield* Effect.fail(new BotConfigError({ message: scope ? "Set CONVEX_SITE_URL and NEONFLUX_BOT_API_SECRET. Multi mode registers servers through the backend"
                : "Set CONVEX_SITE_URL and NEONFLUX_BOT_API_SECRET, so NeonFlux adopts the backend's server scope. Without a backend, set NEONFLUX_SERVER_ID to the one server" }))
        }

        const backupKey = yield* Effect.try({ try: () => parseBackupKey(environment), catch: () => new BotConfigError({ message: "Set NEONFLUX_BACKUP_KEY to an independent canonical base64 32-byte recovery key" }) })
        return { token: Redacted.make(token), ...(scope?.mode === "single" ? { serverId: scope.serverIds[0]! } : {}), ...(scope ? { scope } : {}), ...(backend ? { backend } : {}), ...(customStatus ? { customStatus } : {}), ...(backupKey ? { backupKey } : {}) } satisfies BotRootConfig
    })
}
