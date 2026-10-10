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
    /** The Convex deployment URL, normally https://<deployment>.convex.cloud */
    readonly url: string
    readonly serverId?: string
    readonly scopeMode?: "single" | "multi"
    readonly onScopeDenied?: () => void
    readonly isActive?: () => boolean
    readonly secret: Redacted.Redacted<string>
    /** Replaces the Convex client. Tests pass an in-memory backend */
    readonly client?: BackendClient
    /** Receives the time, on this process's clock, at which work a mutation created becomes due */
    readonly onWorkDue?: (at: number) => void
}

/** Calls the backend's public functions by name. Rejections that carry `data` with a status are backend answers */
export interface BackendClient {
    query(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
    mutation(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
    /** Calls onValue with each new result of a query until the returned function stops the subscription */
    subscribe(name: string, args: Record<string, unknown>, onValue: (value: unknown) => void, onError: (error: unknown) => void): () => void
}

export class BotConfigError extends Data.TaggedError("BotConfigError")<{
    readonly message: string
}> {}

// An origin without credentials, path, query or fragment, using HTTPS or loopback HTTP
function origin(value: string): URL | undefined {
    let url: URL
    try { url = new URL(value) } catch { return undefined }
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]"
    if (url.protocol !== "https:" && !(local && url.protocol === "http:") || url.username || url.password || url.search || url.hash || url.pathname !== "/") return undefined
    return url
}
// CONVEX_URL names the deployment. A Convex cloud HTTP Actions URL from CONVEX_SITE_URL is accepted in its place, because
// a cloud deployment serves functions at the same name under .convex.cloud. Other hosts need CONVEX_URL
function deploymentUrl(convexUrl: string | undefined, siteUrl: string | undefined): string | undefined {
    if (convexUrl) {
        const url = origin(convexUrl)
        return url && !url.hostname.endsWith(".convex.site") ? url.origin : undefined
    }
    const site = siteUrl ? origin(siteUrl) : undefined
    const cloud = site?.protocol === "https:" && site.port === "" ? /^([a-z0-9-]+)\.convex\.site$/.exec(site.hostname) : null
    return cloud ? `https://${cloud[1]}.convex.cloud` : undefined
}

export function readConfig(environment: Readonly<NodeJS.ProcessEnv>) {
    return Effect.gen(function* () {
        const token = environment.FLUXER_BOT_TOKEN?.trim()
        if (!token) {
            return yield* Effect.fail(new BotConfigError({
                message: "Set FLUXER_BOT_TOKEN to the bot token before starting NeonFlux",
            }))
        }

        const scope = yield* Effect.try({ try: () => parseDeploymentScope(environment), catch: error => new BotConfigError({ message: error instanceof Error ? error.message : "Check server scope configuration" }) })

        const convexUrl = environment.CONVEX_URL?.trim(), siteUrl = environment.CONVEX_SITE_URL?.trim()
        const customStatus = environment.NEONFLUX_CUSTOM_STATUS?.trim()
        if (customStatus && (customStatus.length > 128 || /[\u000c\u202e]/.test(customStatus))) {
            return yield* Effect.fail(new BotConfigError({ message: "Set NEONFLUX_CUSTOM_STATUS to at most 128 characters of normal status text" }))
        }
        const backendSecret = environment.NEONFLUX_BOT_API_SECRET?.trim()
        let backend: BackendConfig | undefined
        if (convexUrl || siteUrl || backendSecret) {
            const url = deploymentUrl(convexUrl, siteUrl)
            if (!url) {
                return yield* Effect.fail(new BotConfigError({
                    message: "Set CONVEX_URL to the Convex deployment URL, using HTTPS or local HTTP",
                }))
            }
            if (!backendSecret || backendSecret.length < 32) {
                return yield* Effect.fail(new BotConfigError({
                    message: "Set NEONFLUX_BOT_API_SECRET to a dedicated backend credential of at least 32 characters",
                }))
            }
            backend = { url, secret: Redacted.make(backendSecret) }
        }

        if (scope.mode === "multi" && !backend) {
            return yield* Effect.fail(new BotConfigError({ message: "Set CONVEX_URL and NEONFLUX_BOT_API_SECRET. Multi mode registers servers through the backend" }))
        }

        const backupKey = yield* Effect.try({ try: () => parseBackupKey(environment), catch: () => new BotConfigError({ message: "Set NEONFLUX_BACKUP_KEY to an independent canonical base64 32-byte recovery key" }) })
        let websiteUrl: string | undefined
        if (environment.NEONFLUX_WEBSITE_URL?.trim()) {
            const website = origin(environment.NEONFLUX_WEBSITE_URL.trim())
            if (!website) return yield* Effect.fail(new BotConfigError({ message: "Set NEONFLUX_WEBSITE_URL to the dashboard origin, using HTTPS or local HTTP" }))
            websiteUrl = website.origin
        }
        return { token: Redacted.make(token), ...(scope.mode === "single" ? { serverId: scope.serverIds[0]! } : {}), scope, ...(backend ? { backend } : {}), ...(customStatus ? { customStatus } : {}), ...(backupKey ? { backupKey } : {}), ...(websiteUrl ? { websiteUrl } : {}) } satisfies BotRootConfig
    })
}
