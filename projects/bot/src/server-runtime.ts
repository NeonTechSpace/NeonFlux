import { Data, Effect } from "effect"
import type { ServiceInstallation, ServiceInstallationPage } from "@neonflux/backend/contracts"
import type { BackendConfig, BotConfig, BotRootConfig } from "./config.ts"
import { parseDeploymentScope, validServerId, type DeploymentScope } from "./server-scope.ts"
import { createBackendRequest, rootBackend } from "./backend-http.ts"
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
import { createServerExportStore } from "./server-export-store.ts"
import { createGeneralSettingsStore } from "./general-settings.ts"
import { createAnalyticsStore } from "./analytics-store.ts"
import { createVoiceStore } from "./voice-store.ts"
import { createRolePickerStore } from "./rolepicker-store.ts"
import { createSetupStore } from "./setup-check.ts"
import { createStickyStore } from "./sticky-store.ts"
import { createSidebarStore } from "./sidebar-store.ts"
import { createMemberListStore } from "./memberlist-store.ts"
import { createPrivateDataStore } from "./private-data.ts"
import { createTemporaryRoleStore } from "./temprole-store.ts"
import { createAlertsStore } from "./alerts-store.ts"
import { createHelpDeskStore } from "./helpdesk-store.ts"
import { createOnboardingStore } from "./onboarding-store.ts"
import { createPresetStore } from "./preset-store.ts"
import { createLfgStore } from "./lfg-store.ts"
import { createYoutubeStore } from "./youtube-store.ts"
import { createShowcaseStore } from "./showcase-store.ts"
import { createProfileStore } from "./profile-store.ts"
import { createStructureStore } from "./structure-store.ts"

export class ServerScopeError extends Data.TaggedError("ServerScopeError")<{ readonly message: string }> {}
export function configScope(config: BotRootConfig): DeploymentScope {
    return config.scope ?? parseDeploymentScope({ NEONFLUX_SERVER_ID: config.serverId })
}
const scopeMismatch = () => new ServerScopeError({ message: "Backend server scope is unavailable or differs from the bot. Check both scope configurations and restart" })
// The backend must serve the same mode, and in single mode the same server, before any runtime starts
export function verifyBackendScope(config: BotRootConfig) {
    return Effect.gen(function* () {
        const expected = configScope(config)
        if (!config.backend) {
            if (expected.mode === "multi") return yield* Effect.fail(scopeMismatch())
            return
        }
        const actual = (yield* createBackendRequest(rootBackend(config.backend))("/service/scope", {})) as { mode?: unknown, serverIds?: unknown } | null
        if (actual?.mode !== expected.mode || JSON.stringify(actual.serverIds) !== JSON.stringify(expected.mode === "single" ? expected.serverIds : undefined)) return yield* Effect.fail(scopeMismatch())
    }).pipe(Effect.mapError(scopeMismatch))
}
export function createServerAdapters(config: BotConfig) {
    if (!config.backend) return undefined
    const backend = Object.freeze({ ...config.backend, serverId: config.serverId })
    return {
        afk: createAfkStore(backend, config.serverId), responses: createResponseStore(backend), moderation: createModerationStore(backend), publishing: createPublishingStore(backend),
        roles: createRolesStore(backend), greetings: createGreetingsStore(backend), tickets: createTicketStore(backend), leveling: createLevelingStore(backend), events: createEventsStore(backend),
        schedules: createSchedulesStore(backend), milestones: createMilestonesStore(backend), suggestions: createSuggestionsStore(backend), cleanup: createCleanupStore(backend), metadata: createMetadataLogsStore(backend), backup: createBackupStore(backend), serverExport: createServerExportStore(backend), general: createGeneralSettingsStore(backend, config.serverId),
        analytics: createAnalyticsStore(backend),
        voice: createVoiceStore(backend), rolePicker: createRolePickerStore(backend), temporaryRoles: createTemporaryRoleStore(backend), onboarding: createOnboardingStore(backend), presets: createPresetStore(backend), lfg: createLfgStore(backend), showcases: createShowcaseStore(backend), profiles: createProfileStore(backend),setup: createSetupStore(backend), privateData: createPrivateDataStore(backend),
        sticky: createStickyStore(backend), sidebar: createSidebarStore(backend), memberList: createMemberListStore(backend), alerts: createAlertsStore(backend), helpDesk: createHelpDeskStore(backend),
        structure: createStructureStore(backend), youtube: createYoutubeStore(backend),
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
// Multi-mode registrations. These bind no server, so the root backend configuration sends no server
export function createInstallationClient(backend: BackendConfig) {
    const post = createBackendRequest(rootBackend(backend))
    // Succeeds with true when this join started the installation, so the bot posts its note once per install
    const change = (operation: "join" | "leave", serverId: string) => post(`/service/installations/${operation}`, { serverId }).pipe(
        Effect.flatMap(value => installationResult(value, serverId, operation === "join") ? Effect.succeed((value as ServiceInstallation).welcome === true) : Effect.fail(new InstallationError({ operation }))),
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
