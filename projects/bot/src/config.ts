import { parseOrigin, parseServerScope } from "@neonflux/contracts/service"
import { type DeploymentScope } from "./server-scope.ts"
import { Data, Effect, Redacted } from "effect"

/**
 * Process configuration, which may name the server. The scope is the backend's, adopted at startup. Before that, scope
 * holds the operator's own scope variable, if any
 */
export interface BotRootConfig {
    readonly token: Redacted.Redacted<string>
    readonly serverId?: string
    readonly scope?: DeploymentScope
    readonly backend?: BackendConfig
}

/** Configuration of one server runtime */
export interface BotConfig extends BotRootConfig {
    readonly serverId: string
}

export interface BackendConfig {
    /** The Convex deployment URL, normally https://<deployment>.convex.cloud */
    readonly url: string
    readonly serverId?: string
    readonly onScopeDenied?: () => void
    readonly isActive?: () => boolean
    readonly secret: Redacted.Redacted<string>
    /** Replaces the Convex client. Tests pass an in-memory backend */
    readonly client?: BackendClient
}

/** Calls the backend's public functions by name. Rejections that carry `data` with a status are backend answers */
export interface BackendClient {
    query(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
    mutation(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>
}

class BotConfigError extends Data.TaggedError("BotConfigError")<{
    readonly message: string
}> {}

// CONVEX_URL names the deployment. Its HTTP Actions URL under .convex.site serves no functions, so it is refused
function deploymentUrl(convexUrl: string): string | undefined {
    const url = parseOrigin(convexUrl)
    return url && !url.hostname.endsWith(".convex.site") ? url.origin : undefined
}

export function readConfig(environment: Readonly<NodeJS.ProcessEnv>) {
    return Effect.gen(function* () {
        const token = environment.FLUXER_BOT_TOKEN?.trim()
        if (!token) {
            return yield* Effect.fail(
                new BotConfigError({
                    message: "Set FLUXER_BOT_TOKEN to the bot token before starting NeonFlux",
                }),
            )
        }

        // The backend owns the scope. A scope variable the operator sets here is only compared with it at startup, and a blank line counts as unset
        const scopeNames = ["NEONFLUX_SERVER_ID"] as const
        const scopeEnvironment = Object.fromEntries(
            scopeNames.flatMap((name) => (environment[name]?.trim() ? [[name, environment[name]]] : [])),
        )
        const scope =
            Object.keys(scopeEnvironment).length === 0
                ? undefined
                : yield* Effect.try({
                      try: () => parseServerScope(scopeEnvironment),
                      catch: (error) =>
                          new BotConfigError({
                              message: error instanceof Error ? error.message : "Check server scope configuration",
                          }),
                  })

        const convexUrl = environment.CONVEX_URL?.trim()
        // The backend derives the key from the secret as written, so surrounding space would make the two keys differ
        const backendSecret = environment.NEONFLUX_BOT_API_SECRET
        let backend: BackendConfig | undefined
        if (convexUrl || backendSecret?.trim()) {
            const url = convexUrl ? deploymentUrl(convexUrl) : undefined
            if (!url) {
                return yield* Effect.fail(
                    new BotConfigError({
                        message: "Set CONVEX_URL to the Convex deployment URL, using HTTPS or local HTTP",
                    }),
                )
            }
            if (!backendSecret || backendSecret.length < 32 || backendSecret !== backendSecret.trim()) {
                return yield* Effect.fail(
                    new BotConfigError({
                        message:
                            "Set NEONFLUX_BOT_API_SECRET to a dedicated backend credential of at least 32 characters, without surrounding spaces",
                    }),
                )
            }
            backend = { url, secret: Redacted.make(backendSecret) }
        }

        if (!backend && !scope) {
            return yield* Effect.fail(
                new BotConfigError({
                    message:
                        "Set CONVEX_URL and NEONFLUX_BOT_API_SECRET, so NeonFlux adopts the backend's server scope. Without a backend, set NEONFLUX_SERVER_ID to the one server",
                }),
            )
        }

        return {
            token: Redacted.make(token),
            ...(scope ? { serverId: scope.serverIds[0]! } : {}),
            ...(scope ? { scope } : {}),
            ...(backend ? { backend } : {}),
        } satisfies BotRootConfig
    })
}
