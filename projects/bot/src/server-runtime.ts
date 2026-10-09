import { Data, Effect, Redacted, Schema } from "effect"
import { ServiceInstallation, ServiceInstallationPage, ServiceStartup, parseServerScope, type ServiceInstallationRequest, type ServiceInstallationsListRequest } from "@neonflux/contracts/service"
import type { BackendConfig, BotConfig, BotRootConfig } from "./config.ts"
import type { DeploymentScope } from "./server-scope.ts"
import { BackendRequestError, createBackendRequest } from "./backend-http.ts"
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
import { createAnalyticsStore } from "./analytics-store.ts"
import { createVoiceStore } from "./voice-store.ts"
import { createRolePickerStore } from "./rolepicker-store.ts"

export class ServerScopeError extends Data.TaggedError("ServerScopeError")<{ readonly message: string }> {}
export function configScope(config: BotRootConfig): DeploymentScope {
    return config.scope ?? parseServerScope({ NEONFLUX_SERVER_ID: config.serverId })
}
const unavailable = (error: BackendRequestError) => new ServerScopeError({ message: error.status === 401
    ? "The backend refused the bot's secret. Set the same NEONFLUX_BOT_API_SECRET in the bot and the Convex deployment, then restart"
    : error.status === 503 ? "The backend is not configured. The Convex deployment's logs name the variable to fix"
    : error.status === null ? "The backend could not be reached. Check CONVEX_SITE_URL and the connection, then restart"
    : "The backend refused the startup request. Deploy the backend and the bot from the same version" })
function mismatch(expected: DeploymentScope, actual: DeploymentScope) {
    return new ServerScopeError({ message: expected.mode !== actual.mode
        ? `The backend serves ${actual.mode} mode, but the bot environment asks for ${expected.mode} mode. Remove NEONFLUX_SERVER_MODE and NEONFLUX_SERVER_ID from the bot to adopt the backend's scope`
        : "The backend serves a different server than NEONFLUX_SERVER_ID in the bot environment. Check that CONVEX_SITE_URL names this server's deployment, or remove NEONFLUX_SERVER_ID" })
}
// The backend owns the server scope and the website origin, and the bot adopts both before it builds any runtime. Scope variables
// the operator also set in the bot must match, which catches a bot pointed at another deployment. Without a backend, the bot serves
// the one server its environment names
export function adoptBackendScope(config: BotRootConfig): Effect.Effect<BotRootConfig, ServerScopeError> {
    const { backend, serverId: _serverId, scope: expected, websiteUrl: _websiteUrl, ...root } = config
    if (!backend) return Effect.succeed(config)
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
        Effect.flatMap(({ scope, websiteUrl }) => expected && (expected.mode !== scope.mode || expected.mode === "single" && scope.mode === "single" && expected.serverIds[0] !== scope.serverIds[0])
            ? Effect.fail(mismatch(expected, scope))
            : Effect.succeed({ ...root, backend, scope, ...(scope.mode === "single" ? { serverId: scope.serverIds[0]! } : {}), ...(websiteUrl ? { websiteUrl } : {}) })),
    )
}
export function createServerAdapters(config: BotConfig) {
    if (!config.backend) return undefined
    const backend = Object.freeze({ ...config.backend, serverId: config.serverId })
    return {
        afk: createAfkStore(backend, config.serverId), responses: createResponseStore(backend), moderation: createModerationStore(backend), publishing: createPublishingStore(backend),
        roles: createRolesStore(backend), greetings: createGreetingsStore(backend), tickets: createTicketStore(backend), leveling: createLevelingStore(backend), events: createEventsStore(backend),
        schedules: createSchedulesStore(backend), milestones: createMilestonesStore(backend), suggestions: createSuggestionsStore(backend), cleanup: createCleanupStore(backend), metadata: createMetadataLogsStore(backend), backup: createBackupStore(backend), general: createGeneralSettingsStore(backend, config.serverId),
        analytics: createAnalyticsStore(backend),
        voice: createVoiceStore(backend), rolePicker: createRolePickerStore(backend),
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
    const deactivate = () => { if (!active) return false; active = false; return true }
    const config: BotConfig = Object.freeze({ ...root, serverId, scope, ...(root.backend ? { backend: Object.freeze({ ...root.backend, serverId, scopeMode: scope.mode,
        isActive: () => active, onScopeDenied: () => { if (deactivate()) onScopeDenied() } }) } : {}) })
    return { config, adapters: createServerAdapters(config), active: () => active, deactivate }
}

export class InstallationError extends Data.TaggedError("InstallationError")<{ readonly operation: "list" | "join" | "leave" }> {}
// Multi-mode registrations. The routes bind no server, so the root backend configuration sends no server header
export function createInstallationClient(backend: BackendConfig) {
    const post = createBackendRequest(Object.freeze({ siteUrl: backend.siteUrl, secret: backend.secret }))
    const change = (operation: "join" | "leave", serverId: string) => post(`/service/installations/${operation}`, { serverId } satisfies ServiceInstallationRequest).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ServiceInstallation)),
        Effect.flatMap(value => value.serverId === serverId && value.active === (operation === "join") ? Effect.void : Effect.fail(new InstallationError({ operation }))),
        Effect.mapError(() => new InstallationError({ operation })))
    return {
        list: Effect.gen(function* () {
            const serverIds = new Set<string>()
            let cursor: string | null = null
            for (let page = 0; page < 10000; page++) {
                const value: ServiceInstallationPage = yield* post("/service/installations/list", { cursor } satisfies ServiceInstallationsListRequest).pipe(Effect.flatMap(Schema.decodeUnknownEffect(ServiceInstallationPage)),
                    Effect.mapError(() => new InstallationError({ operation: "list" })))
                for (const serverId of value.serverIds) serverIds.add(serverId)
                if (value.nextCursor === null) return serverIds
                cursor = value.nextCursor
            }
            return yield* Effect.fail(new InstallationError({ operation: "list" }))
        }),
        join: (serverId: string) => change("join", serverId),
        leave: (serverId: string) => change("leave", serverId),
    }
}
