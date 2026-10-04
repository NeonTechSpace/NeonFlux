import { Data, Effect, Schema } from "effect"
import { ServiceScope, parseServerScope } from "@neonflux/contracts/service"
import type { BotConfig, BotRootConfig } from "./config.ts"
import type { DeploymentScope } from "./server-scope.ts"
import { createBackendRequest, type BackendRequestError } from "./backend-http.ts"
import { createAfkStore } from "./afk-store.ts"
import { createResponseStore } from "./responses-store.ts"
import { createModerationStore } from "./moderation-store.ts"
import { createPublishingStore } from "./publishing-store.ts"
import { createRolesStore } from "./roles-store.ts"
import { createGreetingsStore } from "./welcome-store.ts"
import { createTicketStore } from "./ticket-store.ts"
import { createLevelingStore } from "./level-store.ts"
import { createSchedulesStore } from "./schedule-store.ts"
import { createGeneralSettingsStore } from "./general-settings.ts"

export class ServerScopeError extends Data.TaggedError("ServerScopeError")<{ readonly message: string }> {}
export function configScope(config: BotRootConfig): DeploymentScope {
    return config.scope ?? parseServerScope({ NEONFLUX_SERVER_ID: config.serverId })
}
const unavailable = (error: BackendRequestError) =>
    new ServerScopeError({
        message:
            error.status === 401
                ? "The backend refused the bot's key. Set the same NEONFLUX_BOT_API_SECRET in the bot and the Convex deployment, then restart"
                : error.status === 503
                  ? "The backend is not configured. The Convex deployment's logs name the variable to fix"
                  : error.status === null
                    ? "The backend could not be reached. Check CONVEX_URL and the connection, then restart"
                    : "The backend refused the startup request. Deploy the backend and the bot from the same version",
    })
function mismatch() {
    return new ServerScopeError({
        message:
            "The backend serves a different server than NEONFLUX_SERVER_ID in the bot environment. Check that CONVEX_URL names this server's deployment, or remove NEONFLUX_SERVER_ID",
    })
}
// The backend owns the server scope, and the bot adopts it before it builds any runtime. A scope variable the operator also set in
// the bot must match, which catches a bot pointed at another deployment. Without a backend, the bot serves the one server its
// environment names
export function adoptBackendScope(config: BotRootConfig): Effect.Effect<BotRootConfig, ServerScopeError> {
    const { backend, serverId: _serverId, scope: expected, ...root } = config
    if (!backend) return Effect.succeed(config)
    return createBackendRequest(backend)("/service/scope", {}).pipe(
        Effect.mapError(unavailable),
        // An answer with any other key is not one this bot understands
        Effect.flatMap((value) =>
            Schema.decodeUnknownEffect(ServiceScope, { onExcessProperty: "error" })(value).pipe(
                Effect.mapError(
                    () =>
                        new ServerScopeError({
                            message:
                                "The backend's scope answer is not one this bot understands. Deploy the backend and the bot from the same version",
                        }),
                ),
            ),
        ),
        Effect.flatMap((scope) =>
            expected && expected.serverIds[0] !== scope.serverIds[0]
                ? Effect.fail(mismatch())
                : Effect.succeed({
                      ...root,
                      backend,
                      scope,
                      serverId: scope.serverIds[0]!,
                  }),
        ),
    )
}
// The runtime's frozen backend already binds its server, so every store shares one transport
function createServerAdapters(config: BotConfig) {
    const backend = config.backend
    if (!backend) return undefined
    return {
        afk: createAfkStore(backend, config.serverId),
        responses: createResponseStore(backend),
        moderation: createModerationStore(backend),
        publishing: createPublishingStore(backend),
        roles: createRolesStore(backend),
        greetings: createGreetingsStore(backend),
        tickets: createTicketStore(backend),
        leveling: createLevelingStore(backend),
        schedules: createSchedulesStore(backend),
        general: createGeneralSettingsStore(backend, config.serverId),
    }
}

export interface ServerRuntime {
    readonly config: BotConfig
    readonly adapters: ReturnType<typeof createServerAdapters>
    active(): boolean
    /** Stop this runtime's backend requests. Returns false when it had already stopped */
    deactivate(): boolean
}
// One server's immutable configuration and backend adapters. A backend scope denial stops only this runtime
export function createServerRuntime(root: BotRootConfig, serverId: string, onScopeDenied: () => void): ServerRuntime {
    const scope = configScope(root)
    let active = true
    const deactivate = () => {
        if (!active) return false
        active = false
        return true
    }
    const config: BotConfig = Object.freeze({
        ...root,
        serverId,
        scope,
        ...(root.backend
            ? {
                  backend: Object.freeze({
                      ...root.backend,
                      serverId,
                      isActive: () => active,
                      onScopeDenied: () => {
                          if (deactivate()) onScopeDenied()
                      },
                  }),
              }
            : {}),
    })
    return { config, adapters: createServerAdapters(config), active: () => active, deactivate }
}
