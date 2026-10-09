import { parseDeploymentScope, type DeploymentScope } from "./server-scope.ts"
import { Data, Effect, Redacted } from "effect"
import { parseBackupKey, type BackupKey } from "./backup-crypto.ts"

/** Process configuration. Single mode names its server here, while multi mode has no server until the bot joins one */
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

        const scope = yield* Effect.try({ try: () => parseDeploymentScope(environment), catch: error => new BotConfigError({ message: error instanceof Error ? error.message : "Check server scope configuration" }) })

        const siteUrl = environment.CONVEX_SITE_URL?.trim()
        const customStatus = environment.NEONFLUX_CUSTOM_STATUS?.trim()
        if (customStatus && (customStatus.length > 128 || /[\u000c\u202e]/.test(customStatus))) {
            return yield* Effect.fail(new BotConfigError({ message: "Set NEONFLUX_CUSTOM_STATUS to at most 128 characters of normal status text" }))
        }
        const backendSecret = environment.NEONFLUX_BOT_API_SECRET?.trim()
        let backend: BackendConfig | undefined
        if (siteUrl || backendSecret) {
            let url: URL | undefined
            try { url = new URL(siteUrl ?? "") } catch { /* Validated below */ }
            const local = url?.hostname === "localhost" || url?.hostname === "127.0.0.1" || url?.hostname === "[::1]"
            if (!url || (url.protocol !== "https:" && !(local && url.protocol === "http:"))
                || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
                return yield* Effect.fail(new BotConfigError({
                    message: "Set CONVEX_SITE_URL to the Convex HTTP Actions origin, using HTTPS or local HTTP",
                }))
            }
            if (!backendSecret || backendSecret.length < 32) {
                return yield* Effect.fail(new BotConfigError({
                    message: "Set NEONFLUX_BOT_API_SECRET to a dedicated backend credential of at least 32 characters",
                }))
            }
            backend = { siteUrl: url.origin, secret: Redacted.make(backendSecret) }
        }

        if (scope.mode === "multi" && !backend) {
            return yield* Effect.fail(new BotConfigError({ message: "Set CONVEX_SITE_URL and NEONFLUX_BOT_API_SECRET. Multi mode registers servers through the backend" }))
        }

        const backupKey = yield* Effect.try({ try: () => parseBackupKey(environment), catch: () => new BotConfigError({ message: "Set NEONFLUX_BACKUP_KEY to an independent canonical base64 32-byte recovery key" }) })
        let websiteUrl: string | undefined
        if (environment.NEONFLUX_WEBSITE_URL?.trim()) {
            let website: URL | undefined
            try { website = new URL(environment.NEONFLUX_WEBSITE_URL.trim()) } catch { /* Validated below */ }
            const local = website?.hostname === "localhost" || website?.hostname === "127.0.0.1" || website?.hostname === "[::1]"
            if (!website || website.protocol !== "https:" && !(local && website.protocol === "http:") || website.username || website.password || website.search || website.hash || website.pathname !== "/") return yield* Effect.fail(new BotConfigError({ message: "Set NEONFLUX_WEBSITE_URL to the dashboard origin, using HTTPS or local HTTP" }))
            websiteUrl = website.origin
        }
        return { token: Redacted.make(token), ...(scope.mode === "single" ? { serverId: scope.serverIds[0]! } : {}), scope, ...(backend ? { backend } : {}), ...(customStatus ? { customStatus } : {}), ...(backupKey ? { backupKey } : {}), ...(websiteUrl ? { websiteUrl } : {}) } satisfies BotRootConfig
    })
}
