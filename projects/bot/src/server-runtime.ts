import { Data, Effect, Redacted, Schema } from "effect"
import { ServiceStartup, parseServerScope } from "@neonflux/contracts/service"
import type { BotConfig, BotEnvironment } from "./config.ts"
import type { DeploymentScope } from "./server-scope.ts"
import { BackendRequestError } from "./backend-http.ts"
import { createAfkStore } from "./afk-store.ts"
import { createResponseStore } from "./responses-store.ts"
import { createModerationStore } from "./moderation-store.ts"
import { createPublishingStore } from "./publishing-store.ts"
import { createRolesStore } from "./roles-store.ts"
import { createGreetingsStore } from "./welcome-store.ts"
import { createTicketStore } from "./ticket-store.ts"
import { createLevelingStore } from "./level-store.ts"
import { createEventsStore } from "./event-store.ts"
import { createSchedulesStore } from "./schedule-store.ts"
import { createMilestonesStore } from "./milestone-store.ts"
import { createSuggestionsStore } from "./suggestion-store.ts"
import { createCleanupStore } from "./cleanup-store.ts"
import { createMetadataLogsStore } from "./metadata-log-store.ts"
import { createBackupStore } from "./backup-store.ts"
import { createGeneralSettingsStore } from "./general-settings.ts"

export class ServerScopeError extends Data.TaggedError("ServerScopeError")<{ readonly message: string }> {}
export function configScope(config: BotConfig): DeploymentScope {
    return config.scope ?? parseServerScope({ NEONFLUX_SERVER_ID: config.serverId })
}
const unavailable = (error: BackendRequestError) => new ServerScopeError({ message: error.status === 401
    ? "The backend refused the bot's secret. Set the same NEONFLUX_BOT_API_SECRET in the bot and the Convex deployment, then restart"
    : error.status === 503 ? "The backend is not configured. The Convex deployment's logs name the variable to fix"
    : error.status === null ? "The backend could not be reached. Check CONVEX_SITE_URL and the connection, then restart"
    : "The backend refused the startup request. Deploy the backend and the bot from the same version" })
function mismatch(expected: DeploymentScope, actual: DeploymentScope) {
    return new ServerScopeError({ message: expected.mode !== actual.mode
        ? `The backend serves ${actual.mode} mode, but the bot environment asks for ${expected.mode} mode. Remove NEONFLUX_SERVER_MODE, NEONFLUX_SERVER_ID and NEONFLUX_SERVER_IDS from the bot to adopt the backend's scope`
        : "The backend serves other servers than the bot environment names. Check that CONVEX_SITE_URL names this deployment, or remove NEONFLUX_SERVER_ID and NEONFLUX_SERVER_IDS" })
}
// The backend owns the server scope and the website origin, and the bot adopts both before it builds any runtime. Scope variables
// the operator also set in the bot must match, which catches a bot pointed at another deployment. Without a backend, the bot serves
// the one server its environment names
export function adoptBackendScope(config: BotEnvironment):Effect.Effect<BotConfig, ServerScopeError> {
    const { backend, serverId, scope: expected } = config
    if (!backend) return serverId === undefined ? Effect.fail(new ServerScopeError({ message: "Set NEONFLUX_SERVER_ID to the server NeonFlux should manage" })) : Effect.succeed({ ...config, serverId })
    return Effect.tryPromise({ try: async signal => {
        const response = await fetch(new URL("/service/scope", backend.siteUrl), { method: "GET", headers: { Authorization: `Bearer ${Redacted.value(backend.secret)}` }, signal, redirect: "error" })
        if (!response.ok) throw new BackendRequestError({ status: response.status })
        return await response.json() as unknown
    }, catch: error => error instanceof BackendRequestError ? error : new BackendRequestError({ status: null }) }).pipe(
        Effect.timeout("5 seconds"),
        Effect.mapError(error => unavailable(error instanceof BackendRequestError ? error : new BackendRequestError({ status: null }))),
        // An answer with any other key is not one this bot understands
        Effect.flatMap(value => Schema.decodeUnknownEffect(ServiceStartup, { onExcessProperty: "error" })(value).pipe(
            Effect.mapError(() => new ServerScopeError({ message: "The backend's startup answer is not one this bot understands. Deploy the backend and the bot from the same version" })))),
        Effect.flatMap(({ scope, websiteUrl }) => expected && (expected.mode !== scope.mode || JSON.stringify(expected.serverIds) !== JSON.stringify(scope.serverIds))
            ? Effect.fail(mismatch(expected, scope))
            : Effect.succeed({ ...config, backend, scope, serverId: scope.serverIds[0]!, ...(websiteUrl ? { websiteUrl } : {}) })),
    )
}
export function createServerAdapters(config: BotConfig) {
    if (!config.backend) return undefined
    const backend = Object.freeze({ ...config.backend, serverId: config.serverId })
    return {
        afk: createAfkStore(backend, config.serverId), responses: createResponseStore(backend), moderation: createModerationStore(backend), publishing: createPublishingStore(backend),
        roles: createRolesStore(backend), greetings: createGreetingsStore(backend), tickets: createTicketStore(backend), leveling: createLevelingStore(backend), events: createEventsStore(backend),
        schedules: createSchedulesStore(backend), milestones: createMilestonesStore(backend), suggestions: createSuggestionsStore(backend), cleanup: createCleanupStore(backend), metadata: createMetadataLogsStore(backend), backup: createBackupStore(backend), general: createGeneralSettingsStore(backend, config.serverId),
    }
}
export function createServerRuntimeRegistry(config: BotConfig) {
    const scope = configScope(config)
    return new Map(scope.serverIds.map(serverId => {
        let active = true, retired: (() => void) | undefined
        const scoped = Object.freeze({ ...config, serverId, ...(config.backend ? { backend: Object.freeze({ ...config.backend, serverId,
            isActive: () => active, onScopeDenied: () => { if (!active) return; active = false; retired?.() } }) } : {}) })
        return [serverId, { config: scoped, adapters: createServerAdapters(scoped), active: () => active, onRetire: (callback: () => void) => { retired = callback } }] as const
    }))
}
