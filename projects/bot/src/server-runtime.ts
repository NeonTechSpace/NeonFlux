import { Data, Effect, Redacted } from "effect"
import type { BotConfig } from "./config.ts"
import { parseDeploymentScope, type DeploymentScope } from "./server-scope.ts"
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
    return config.scope ?? parseDeploymentScope({ NEONFLUX_SERVER_ID: config.serverId })
}
const scopeMismatch = () => new ServerScopeError({ message: "Backend server scope is unavailable or differs from the bot. Check both scope configurations and restart" })
// The backend and bot must allow exactly the same servers before any runtime starts
export function verifyBackendScope(config: BotConfig) {
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
        if (actual?.mode !== expected.mode || JSON.stringify(actual.serverIds) !== JSON.stringify(expected.serverIds)) throw new Error()
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
export function createServerRuntimeRegistry(config: BotConfig) {
    const scope = configScope(config)
    return new Map(scope.serverIds.map(serverId => {
        let active = true, retired: (() => void) | undefined
        const scoped = Object.freeze({ ...config, serverId, ...(config.backend ? { backend: Object.freeze({ ...config.backend, serverId,
            isActive: () => active, onScopeDenied: () => { if (!active) return; active = false; retired?.() } }) } : {}) })
        return [serverId, { config: scoped, adapters: createServerAdapters(scoped), active: () => active, onRetire: (callback: () => void) => { retired = callback } }] as const
    }))
}
