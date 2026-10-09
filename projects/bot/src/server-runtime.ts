import { Data, Effect, Redacted } from "effect"
import type { ServiceInstallation, ServiceInstallationPage } from "@neonflux/backend/contracts"
import type { BackendConfig, BotConfig, BotRootConfig } from "./config.ts"
import { parseDeploymentScope, validServerId, type DeploymentScope } from "./server-scope.ts"
import { createBackendRequest } from "./backend-http.ts"
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
export function configScope(config: BotRootConfig): DeploymentScope {
    return config.scope ?? parseDeploymentScope({ NEONFLUX_SERVER_ID: config.serverId })
}
const scopeMismatch = () => new ServerScopeError({ message: "Backend server scope is unavailable or differs from the bot. Check both scope configurations and restart" })
// The backend must serve the same mode, and in single mode the same server, before any runtime starts
export function verifyBackendScope(config: BotRootConfig) {
    return Effect.tryPromise({ try: async signal => {
        if (!config.backend) {
            if (configScope(config).mode === "multi") throw new Error()
            return
        }
        const headers = { Authorization: `Bearer ${Redacted.value(config.backend.secret)}` }
        const response = await fetch(new URL("/service/scope", config.backend.siteUrl), { method: "GET", headers, signal, redirect: "error" })
        if (!response.ok) throw new Error()
        const actual = await response.json() as { mode?: unknown, serverIds?: unknown } | null
        const expected = configScope(config)
        if (actual?.mode !== expected.mode || JSON.stringify(actual.serverIds) !== JSON.stringify(expected.mode === "single" ? expected.serverIds : undefined)) throw new Error()
    }, catch: scopeMismatch }).pipe(Effect.timeout("5 seconds"), Effect.mapError(scopeMismatch))
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
const installationPage = (value: unknown): value is ServiceInstallationPage => value !== null && typeof value === "object"
    && "serverIds" in value && Array.isArray(value.serverIds) && value.serverIds.every(validServerId)
    && "nextCursor" in value && (value.nextCursor === null || typeof value.nextCursor === "string" && value.nextCursor.length > 0)
const installationResult = (value: unknown, serverId: string, active: boolean) => value !== null && typeof value === "object"
    && (value as Partial<ServiceInstallation>).serverId === serverId && (value as Partial<ServiceInstallation>).active === active
// Multi-mode registrations. The routes bind no server, so the root backend configuration sends no server header
export function createInstallationClient(backend: BackendConfig) {
    const post = createBackendRequest(Object.freeze({ siteUrl: backend.siteUrl, secret: backend.secret }))
    const change = (operation: "join" | "leave", serverId: string) => post(`/service/installations/${operation}`, { serverId }).pipe(
        Effect.flatMap(value => installationResult(value, serverId, operation === "join") ? Effect.void : Effect.fail(new InstallationError({ operation }))),
        Effect.mapError(() => new InstallationError({ operation })))
    return {
        list: Effect.gen(function* () {
            const serverIds = new Set<string>()
            let cursor: string | null = null
            for (let page = 0; page < 10000; page++) {
                const value: unknown = yield* post("/service/installations/list", { cursor }).pipe(Effect.mapError(() => new InstallationError({ operation: "list" })))
                if (!installationPage(value)) return yield* Effect.fail(new InstallationError({ operation: "list" }))
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
