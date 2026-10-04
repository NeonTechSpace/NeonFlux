import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Redacted } from "effect"

export interface BotConfig {
    readonly token: Redacted.Redacted<string>
    readonly serverId: string
    readonly backend?: BackendConfig
}

export interface BackendConfig {
    readonly siteUrl: string
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

        const serverId = environment.NEONFLUX_SERVER_ID?.trim()
        if (!snowflakes.isValid(serverId) || serverId === "0") {
            return yield* Effect.fail(new BotConfigError({
                message: "Set NEONFLUX_SERVER_ID to the decimal ID of the server NeonFlux should manage",
            }))
        }

        const siteUrl = environment.CONVEX_SITE_URL?.trim()
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

        return { token: Redacted.make(token), serverId, ...(backend ? { backend } : {}) } satisfies BotConfig
    })
}
