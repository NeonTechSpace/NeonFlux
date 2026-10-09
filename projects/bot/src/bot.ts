import { commands, MessageType, type BotOptions, type BotEventContext, type Client, type EventName } from "@neontechspace/fluxerly/effect"
import { Cause, Deferred, Effect, Exit, Redacted, Scope, Semaphore, Stream } from "effect"
import type { AfkStore } from "./afk-store.ts"
import { handleAfk } from "./afk.ts"
import type { BotConfig, BotRootConfig } from "./config.ts"
import { parseManagement } from "./response-command.ts"
import type { ResponseStore } from "./responses-store.ts"
import { handleManagement, handleResponse, noMentions } from "./responses.ts"
import type { ModerationStore } from "./moderation-store.ts"
import { handleSafetyCommand, initializeModeration, moderationActor, applyDefconPresence } from "./moderation.ts"
import { parseSafetyCommand, safetyGateClass, safetyNames, type SafetyName } from "./moderation-command.ts"
import { readSafetyAuthority, verifyPrivateAuthor } from "./safety-permissions.ts"
import { containProtection, handleProtectionJoin, handleProtectionMessage } from "./protections.ts"
import type { ModerationActor } from "@neonflux/backend/contracts"
import type { PublishingStore } from "./publishing-store.ts"
import { parsePublishingCommand } from "./publishing-command.ts"
import { handlePublishing } from "./publishing.ts"
import type { RolesStore } from "./roles-store.ts"
import { parseRoleCommand, type RoleCommandName } from "./role-command.ts"
import { handleRoleCommand } from "./role-management.ts"
import { handleRoleReaction, handleRoleJoin, RoleHandlingError } from "./roles.ts"
import { startRoleReactionWorker } from "./role-reconciliation.ts"
import type { GreetingsStore } from "./welcome-store.ts"
import { parseGreetingsCommand, greetingsCritical } from "./welcome-command.ts"
import { handleGreetingsCommand } from "./welcome-management.ts"
import { startGreetingsWorker } from "./welcome-worker.ts"
import { observeGreetingJoin, observeGreetingMembership } from "./welcome-events.ts"
import type { TicketStore } from "./ticket-store.ts"
import { parseTicketCommand } from "./ticket-command.ts"
import { handleTicketCommand } from "./ticket-management.ts"
import { verifyTicketPrivateAuthor } from "./ticket-permissions.ts"
import type { LevelingStore } from "./level-store.ts"
import { parseLevelCommand, parseRankCommand, parseLeaderboardCommand } from "./level-command.ts"
import { handleLevelCommand } from "./level-management.ts"
import { levelCandidate, startLevelCreditWorker } from "./leveling.ts"
import { startLevelRoleWorker } from "./level-worker.ts"
import type { EventsStore } from "./event-store.ts"
import { parseEventCommand, eventCritical, eventPublic } from "./event-command.ts"
import { handleEventCommand } from "./event-management.ts"
import { startEventsWorker } from "./event-worker.ts"
import type { SchedulesStore } from "./schedule-store.ts"
import { scheduleCritical } from "./schedule-command.ts"
import { startSchedulesWorker } from "./schedule-worker.ts"
import type { MilestonesStore } from "./milestone-store.ts"
import { parseMilestoneCommand } from "./milestone-command.ts"
import { handleMilestoneCommand } from "./milestone-management.ts"
import { verifyMilestonePrivateAuthor } from "./milestone-permissions.ts"
import { startMilestonesWorker } from "./milestone-worker.ts"
import type { SuggestionsStore } from "./suggestion-store.ts"
import { parseSuggestionCommand, suggestionCritical, suggestionPublic } from "./suggestion-command.ts"
import { handleSuggestionCommand } from "./suggestion-management.ts"
import { startSuggestionsWorker } from "./suggestion-worker.ts"
import type { CleanupStore } from "./cleanup-store.ts"
import { parseCleanupCommand } from "./cleanup-command.ts"
import { handleCleanupCommand } from "./cleanup-management.ts"
import { startCleanupWorker } from "./cleanup-worker.ts"
import type { MetadataLogsStore } from "./metadata-log-store.ts"
import { isMetadataLogCommand, parseMetadataLogCommand } from "./metadata-log-command.ts"
import { handleMetadataLogCommand } from "./metadata-log-management.ts"
import { createMetadataGatewayAdmission } from "./metadata-log-events.ts"
import { startMetadataLogsWorker } from "./metadata-log-worker.ts"
import type { BackupStore } from "./backup-store.ts"
import { parseBackupCommand } from "./backup-command.ts"
import { handleBackupCommand } from "./backup.ts"
import { configScope, createInstallationClient, createServerRuntime, ServerScopeError, verifyBackendScope, type ServerRuntime } from "./server-runtime.ts"
import { selectServerCommand, serverReply, validServerId, type DeploymentScope } from "./server-scope.ts"
import { createPrefixReader, handleNicknameCommand, handlePrefixCommand, withPrefix, type GeneralSettingsStore } from "./general-settings.ts"
import { createVerificationStore, type VerificationStore } from "./verification-store.ts"
import { requestVerificationLink, reviewVerificationRequest, startVerificationWorker } from "./verification.ts"
import { createDashboardPanelPublisher, startDashboardRolesWorker } from "./dashboard-roles.ts"
import type { AnalyticsStore } from "./analytics-store.ts"
import { startAnalyticsWorker } from "./analytics-worker.ts"
import { handleStatsCommand } from "./analytics-management.ts"
import type { ServiceWorkKind } from "@neonflux/backend/contracts"
import { startWorkDispatcher } from "./work-dispatcher.ts"
import type { VoiceStore } from "./voice-store.ts"
import { parseVoiceCommand, voicePublic } from "./voice-command.ts"
import { handleVoiceCommand } from "./voice-management.ts"
import { createVoiceRuntime } from "./voice-worker.ts"
import type { RolePickerStore } from "./rolepicker-store.ts"
import { parseRolePickerCommand, rolePickerCritical } from "./rolepicker-command.ts"
import { handleRolePickerCommand } from "./rolepicker-management.ts"
import { processRolePickerPass } from "./rolepicker-worker.ts"

/** Backend adapters by feature. Omitted stores use the configured backend, and tests pass in-memory replacements */
export interface BotStores {
    readonly afk?: AfkStore | undefined
    readonly responses?: ResponseStore | undefined
    readonly moderation?: ModerationStore | undefined
    readonly publishing?: PublishingStore | undefined
    readonly roles?: RolesStore | undefined
    readonly greetings?: GreetingsStore | undefined
    readonly tickets?: TicketStore | undefined
    readonly leveling?: LevelingStore | undefined
    readonly events?: EventsStore | undefined
    readonly schedules?: SchedulesStore | undefined
    readonly milestones?: MilestonesStore | undefined
    readonly suggestions?: SuggestionsStore | undefined
    readonly cleanup?: CleanupStore | undefined
    readonly metadata?: MetadataLogsStore | undefined
    readonly backup?: BackupStore | undefined
    readonly general?: GeneralSettingsStore | undefined
    readonly verification?: VerificationStore | undefined
    readonly analytics?: AnalyticsStore | undefined
    readonly voice?: VoiceStore | undefined
    readonly rolePicker?: RolePickerStore | undefined
}

// Every gateway event a server runtime handles. Each is routed to exactly one runtime and never broadcast
const routedEvents = ["messageCreate", "messageUpdate", "guildMemberAdd", "guildMemberRemove", "guildMemberUpdate", "messageDelete", "messageDeleteBulk",
    "guildRoleCreate", "guildRoleUpdate", "guildRoleDelete", "guildRoleUpdateBulk", "guildChannelCreate", "guildChannelUpdate", "guildChannelDelete", "guildChannelUpdateBulk",
    "guildUpdate", "guildAuditLogEntryCreate", "messageReactionAdd", "messageReactionAddMany", "messageReactionRemove", "messageReactionRemoveAll", "messageReactionRemoveEmoji",
    "voiceStateUpdate", "voiceStateSnapshot", "guildDelete"] as const satisfies readonly EventName[]
type ScopedBotOptions = ReturnType<typeof createScopedBotOptions>
type Same<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false
// Compilation fails when a runtime handler is added without routing it, or the reverse
const routedEventsComplete: Same<keyof ScopedBotOptions["events"], typeof routedEvents[number]> = true
void routedEventsComplete

// Multi-mode sizing for a public bot. The technology guide explains these values
const MULTI_EVENT_CONCURRENCY = 8
const MULTI_REST = { concurrency: 6, mediaConcurrency: 2, maxQueued: 256, queuedJsonMaxBytes: 4194304 } as const
const RUNTIME_START_CONCURRENCY = 4
const GUILD_LIST_LIMIT = 100000

export function createBotOptions(config: BotRootConfig, stores: BotStores = {}) {
    const scope = configScope(config)
    const multi = scope.mode === "multi"
    const runtimes = createRuntimeRegistry(config, scope, stores)
    // Single mode always names its configured server. Multi mode serves the servers registered now
    const served = (serverId: string) => scope.mode === "single" ? serverId === scope.serverIds[0] : runtimes.has(serverId)
    const events: NonNullable<BotOptions<unknown>["events"]> = {}
    for (const name of routedEvents) {
        const handler = (context: BotEventContext<EventName>) => {
            const work = Effect.gen(function* () {
                const payload = context.event as unknown as { guildId?: string, channelId?: string, id?: string, content?: string }
                let guildId = payload.guildId ?? (name === "guildUpdate" || name === "guildDelete" ? payload.id : undefined)
                if (guildId !== undefined && !served(guildId)) return
                let selected: ReturnType<typeof selectServerCommand>
                if (name === "messageCreate") {
                    const messageContext = context as BotEventContext<"messageCreate">
                    if (messageContext.message.author.isSystem || messageContext.message.webhookId
                        || messageContext.message.type !== MessageType.Default && messageContext.message.type !== MessageType.Reply) return
                    // Selector validation precedes private reads and feature admission.
                    selected = selectServerCommand(messageContext.message.content, scope, served, guildId)
                    if (selected && "error" in selected && (guildId !== undefined || /^\s*!\S+\s+--server(?:\s|$)/.test(messageContext.message.content))) {
                        yield* messageContext.reply({ content: selected.error, allowedMentions: noMentions })
                        return
                    }
                }
                if (guildId === undefined && payload.channelId) {
                    const response = yield* context.client.rest.request({ method: "GET", path: `/channels/${payload.channelId}`, timeoutMs: 5000 }).pipe(Effect.catch(() => Effect.succeed(undefined)))
                    const channel = response?.status === 200 && response.body !== null && typeof response.body === "object" && !Array.isArray(response.body)
                        ? response.body as Record<string, unknown> : undefined
                    if (!channel || channel.id !== payload.channelId) return
                    if (channel.guild_id !== undefined) {
                        if (!validServerId(channel.guild_id) || !served(channel.guild_id) || ![0, 2, 4, 5, 10, 11, 12].includes(channel.type as number)) return
                        guildId = channel.guild_id
                    } else if (name !== "messageCreate" || channel.type !== 1) return
                }
                if (name === "messageCreate") {
                    selected = selectServerCommand(payload.content ?? "", scope, served, guildId)
                    if (selected && "error" in selected) { yield* (context as BotEventContext<"messageCreate">).reply({ content: selected.error, allowedMentions: noMentions }); return }
                    if (!selected) return
                }
                const serverId = selected && !("error" in selected) ? selected.serverId : guildId
                if (!serverId) return
                // Events for a server whose runtime is still starting wait for its setup, and a retired runtime receives none
                const runtime = runtimes.get(serverId)
                if (!runtime || !(yield* Deferred.await(runtime.ready))) return
                const event = guildId && payload.guildId === undefined ? { ...context.event, guildId } : context.event
                let routed = { ...context, event }
                if (name === "messageCreate") {
                    const original = context as BotEventContext<"messageCreate">
                    const message = { ...original.message, ...(guildId ? { guildId } : {}), content: selected && !("error" in selected) ? selected.content : original.message.content }
                    const reply: typeof original.reply = (input, settings) => original.reply(multi && !guildId
                        ? typeof input === "string" ? serverReply(input, serverId) : { ...input, ...(input.content ? { content: serverReply(input.content, serverId) } : {}) } : input, settings)
                    routed = { ...routed, event: message, message, reply } as typeof routed
                }
                const invoke = runtime.options.events[name].handler as (value: BotEventContext<EventName>) => Effect.Effect<unknown, unknown>
                yield* invoke(routed)
                })
            return work
        }
        Object.assign(events, { [name]: { concurrency: multi ? MULTI_EVENT_CONCURRENCY : 1, ...(multi ? { partition: "guild" as const } : {}), handler } })
    }
    // The routed guildDelete tells a temporarily unavailable server's runtime about the outage
    const routedDelete = (events.guildDelete as { handler: (context: BotEventContext<"guildDelete">) => Effect.Effect<unknown, unknown> }).handler
    if (multi) Object.assign(events, {
        // Startup hydration, recovery and Resume repeat guildCreate, so registration is idempotent
        guildCreate: { concurrency: MULTI_EVENT_CONCURRENCY, partition: "guild" as const, handler: ({ event }: BotEventContext<"guildCreate">) => runtimes.join(event.id) },
        // A temporarily unavailable server keeps its runtime. Any other deletion means the bot no longer sees the server
        guildDelete: { concurrency: MULTI_EVENT_CONCURRENCY, partition: "guild" as const, handler: (context: BotEventContext<"guildDelete">) => context.event.unavailable ? routedDelete(context) : runtimes.leave(context.event.id) },
    })
    return { token: Redacted.value(config.token), processSignals: true, ...(multi ? { sharding: "auto" as const, rest: MULTI_REST } : {}), events,
        setup: (client: Client) => Effect.gen(function* () {
            yield* verifyBackendScope(config)
            yield* runtimes.start(client, yield* Effect.scope)
            // One dispatcher serves every runtime in both modes, so a server without due work causes no backend requests
            if (config.backend) yield* startWorkDispatcher(config.backend, runtimes.wake)
        }) } satisfies BotOptions<unknown>
}

interface RuntimeEntry {
    readonly runtime: ServerRuntime
    readonly options: ScopedBotOptions
    /** Succeeds with true once setup has finished, or with false when the runtime retired first */
    readonly ready: Deferred.Deferred<boolean>
    started: boolean
    scope?: Scope.Closeable
}

// Server runtimes by ID. Single mode serves its configured server. Multi mode serves the servers the bot is in and retires those it leaves
function createRuntimeRegistry(root: BotRootConfig, scope: DeploymentScope, stores: BotStores) {
    const entries = new Map<string, RuntimeEntry>()
    // Every backend join and leave passes through this one queue, so a registration and a removal never race
    const queue = Semaphore.makeUnsafe(1)
    const installations = scope.mode === "multi" && root.backend ? createInstallationClient(root.backend) : undefined
    let lifetime: { readonly client: Client, readonly scope: Scope.Scope } | undefined

    function register(serverId: string) {
        const existing = entries.get(serverId)
        if (existing) return existing
        const runtime = createServerRuntime(root, serverId, () => retire(entry))
        const injected = Object.fromEntries(Object.entries(stores).filter(([, store]) => store !== undefined))
        const entry: RuntimeEntry = { runtime, options: createScopedBotOptions(runtime.config, scope.mode === "single" ? { ...runtime.adapters, ...injected } : runtime.adapters ?? {}),
            ready: Deferred.makeUnsafe<boolean>(), started: false }
        entries.set(serverId, entry)
        return entry
    }
    // Retiring stops the runtime's backend requests, workers and event routing. Its stored data stays in the backend
    function retire(entry: RuntimeEntry) {
        const serverId = entry.runtime.config.serverId, runtimeScope = entry.scope, client = lifetime?.client
        if (entries.get(serverId) === entry) entries.delete(serverId)
        entry.runtime.deactivate()
        Deferred.doneUnsafe(entry.ready, Effect.succeed(false))
        if (runtimeScope) Effect.runFork(Scope.close(runtimeScope, Exit.void).pipe(Effect.andThen(client ? applyDefconPresence(client, entry.runtime.config, undefined) : Effect.void), Effect.catchCause(() => Effect.void)))
    }
    // Setup runs in the server's own scope. Single mode stops on a setup failure, while multi mode keeps serving that server
    const start = (entry: RuntimeEntry) => Effect.gen(function* () {
        if (entry.started || !entry.runtime.active() || !lifetime) return
        const { client, scope: rootScope } = lifetime
        entry.started = true
        const runtimeScope = yield* Scope.fork(rootScope)
        entry.scope = runtimeScope
        const exit = yield* Effect.exit(Scope.provide(entry.options.setup(client), runtimeScope))
        if (Exit.isFailure(exit)) {
            if (Cause.hasInterrupts(exit.cause) || scope.mode === "single") return yield* Effect.failCause(exit.cause)
            yield* Effect.logWarning(`Server ${entry.runtime.config.serverId} startup recovery paused`)
        }
        yield* Deferred.succeed(entry.ready, entry.runtime.active())
    })
    // Runs inside the queue. A server the backend could not register is retired until it becomes available again
    const registerWithBackend = (entry: RuntimeEntry) => Effect.suspend(() => {
        const serverId = entry.runtime.config.serverId
        if (!installations || entries.get(serverId) !== entry || !entry.runtime.active()) return Effect.succeed(false)
        return installations.join(serverId).pipe(Effect.as(true), Effect.catch(() => Effect.sync(() => retire(entry)).pipe(
            Effect.andThen(Effect.logWarning(`Server ${serverId} could not be registered. Registration is retried when the server becomes available again`)), Effect.as(false))))
    })
    // Runs inside the queue
    const remove = (serverId: string) => Effect.gen(function* () {
        const entry = entries.get(serverId)
        if (entry) retire(entry)
        if (installations) yield* installations.leave(serverId).pipe(Effect.catch(() => Effect.logWarning(`Server ${serverId} removal could not be recorded. The next startup records it`)))
    })
    const reconcile = (client: Client, rootScope: Scope.Scope) => Effect.gen(function* () {
        if (!installations) return
        const installed = yield* installations.list
        const guildIds: string[] = []
        yield* client.guilds.iterate({ maxItems: GUILD_LIST_LIMIT, maxPages: GUILD_LIST_LIMIT / 200 + 1 }).pipe(Stream.runForEach(guild => Effect.sync(() => { guildIds.push(guild.id) })))
        const present = new Set(guildIds), last = guildIds.at(-1), complete = guildIds.length < GUILD_LIST_LIMIT
        // Current servers register before the gateway connects, so their events wait for their runtimes instead of being dropped
        const current = guildIds.map(serverId => ({ entry: register(serverId), missing: !installed.has(serverId) }))
        // A truncated guild list cannot prove absence beyond its last server
        const stale = [...installed].filter(serverId => !present.has(serverId) && (complete || last !== undefined && BigInt(serverId) < BigInt(last)))
        yield* Effect.gen(function* () {
            for (const serverId of stale) yield* queue.withPermit(Effect.suspend(() => entries.has(serverId) ? Effect.void : remove(serverId)))
            // Bounded concurrency staggers runtime setup, so a large bot does not start every server against the backend at once
            yield* Effect.forEach(current, ({ entry, missing }) => (missing ? queue.withPermit(registerWithBackend(entry)) : Effect.succeed(true)).pipe(
                Effect.flatMap(registered => registered ? start(entry) : Effect.void),
                Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning(`Server ${entry.runtime.config.serverId} could not start`))),
            { concurrency: RUNTIME_START_CONCURRENCY, discard: true })
        }).pipe(Effect.forkIn(rootScope))
    }).pipe(Effect.mapError(() => new ServerScopeError({ message: "Server registrations could not be read from the backend or Fluxer. Check both and restart" })))
    return {
        has: (serverId: string) => entries.has(serverId),
        get: (serverId: string) => entries.get(serverId),
        start: (client: Client, rootScope: Scope.Scope) => Effect.gen(function* () {
            lifetime = { client, scope: rootScope }
            if (scope.mode === "single") return yield* start(register(scope.serverIds[0]!))
            // The shared presence shows only the configured status, so no single server's state changes it
            yield* applyDefconPresence(client, root, undefined)
            yield* reconcile(client, rootScope)
        }),
        // A server the bot is not serving yet is registered with the backend before its runtime starts
        join: (serverId: string) => Effect.gen(function* () {
            if (!validServerId(serverId)) return
            const entry = yield* queue.withPermit(Effect.suspend(() => {
                if (entries.has(serverId)) return Effect.succeed(undefined)
                const entry = register(serverId)
                return registerWithBackend(entry).pipe(Effect.map(registered => registered ? entry : undefined))
            }))
            if (entry) yield* start(entry)
        }),
        leave: (serverId: string) => validServerId(serverId) ? queue.withPermit(remove(serverId)) : Effect.void,
        // Retiring removes a runtime from the registry before its scope closes, so the dispatcher never wakes a retired runtime
        wake: (serverId: string, kind: ServiceWorkKind) => {
            const entry = entries.get(serverId)
            return entry?.runtime.active() ? entry.options.wake(kind) : Effect.void
        },
    }
}

function createScopedBotOptions(config: BotConfig, stores: BotStores) {
    const { afk: store, responses, moderation, publishing, greetings, tickets, leveling: levels, events, schedules, milestones, suggestions, cleanup, metadata,
        backup: backups, general, voice } = stores
    const voiceRooms = voice ? createVoiceRuntime(voice, config.serverId) : undefined
    const verification = stores.verification ?? (config.backend && config.websiteUrl ? createVerificationStore(config.backend) : undefined)
    const readPrefix = createPrefixReader(general, config.serverId)
    let metadataWorker: Effect.Success<ReturnType<typeof startMetadataLogsWorker>> | undefined
    let analyticsWorker: Effect.Success<ReturnType<typeof startAnalyticsWorker>> | undefined
    const admitMetadata = metadata ? createMetadataGatewayAdmission(metadata, config.serverId, () => metadataWorker?.notify() ?? Effect.void) : undefined
    let cleanupWorker: Effect.Success<ReturnType<typeof startCleanupWorker>> | undefined
    let suggestionWorker: Effect.Success<ReturnType<typeof startSuggestionsWorker>> | undefined
    let milestoneWorker: Effect.Success<ReturnType<typeof startMilestonesWorker>> | undefined
    let scheduleWorker: Effect.Success<ReturnType<typeof startSchedulesWorker>> | undefined
    let eventWorker: Effect.Success<ReturnType<typeof startEventsWorker>> | undefined
    let levelCredits: Effect.Success<ReturnType<typeof startLevelCreditWorker>> | undefined
    let levelRewards: Effect.Success<ReturnType<typeof startLevelRoleWorker>> | undefined
    let greetingWorker: Effect.Success<ReturnType<typeof startGreetingsWorker>> | undefined
    const roleBackend = stores.roles
    const wake = (userId?: string) => greetingWorker?.notify(userId) ?? Effect.void
    const roles: RolesStore | undefined = roleBackend && greetings ? {
        manage: (input) => roleBackend.manage(input),
        query: (input) => roleBackend.query(input),
        memberQuery: (input) => roleBackend.memberQuery(input),
        policy: (input) => roleBackend.policy(input),
        reactionJobs: (input) => roleBackend.reactionJobs(input),
        dispatch: (input) => roleBackend.dispatch(input),
        observe: (input) => roleBackend.observe(input),
        evaluate: (input) => roleBackend.evaluate(input).pipe(Effect.tap(() => wake(input.context.userId))),
        outcome: (input) => roleBackend.outcome(input).pipe(Effect.tap((value) => value.recorded ? wake() : Effect.void)),
        reconcile: (input) => roleBackend.reconcile(input).pipe(Effect.tap((value) => value.recorded ? wake(input.observation.userId) : Effect.void)),
    } : roleBackend
    let roleWorker: Effect.Success<ReturnType<typeof startRoleReactionWorker>> | undefined
    let backupScope: Scope.Scope | undefined
    // Each started worker's wake, for the process's work dispatcher
    const wakers: Partial<Record<ServiceWorkKind, () => Effect.Effect<void>>> = {}
    const unprivilegedActor = (userId: string): ModerationActor => ({ originServerId: config.serverId, userId, roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: false })
    const options = {
        token: Redacted.value(config.token),
        processSignals: true,
        setup: (client) => Effect.gen(function* () {
            backupScope = yield* Effect.scope
            // Voice rooms start first and never fail setup, so another feature's startup failure cannot strand recorded rooms
            if (voiceRooms) yield* voiceRooms.start(client)
            if (moderation) yield* initializeModeration(moderation, config, client)
            else yield* applyDefconPresence(client, config, 3)
            if (publishing) yield* publishing.observe({ serverId: config.serverId, mode: "restart" })
            if (config.backend) wakers.dashboard = (yield* startDashboardRolesWorker(config, client, publishing ? createDashboardPanelPublisher(config, client, publishing) : undefined, publishing,
                stores.rolePicker && roles ? processRolePickerPass(stores.rolePicker, roles, config.serverId, client) : undefined)).notify
            if (roles) {
                yield* roles.observe({ serverId: config.serverId, mode: "restart" })
                roleWorker = yield* startRoleReactionWorker(roles, config.serverId, client)
                if (verification) wakers.verification = (yield* startVerificationWorker(verification, roles, config, client)).notify
            }
            if (greetings) greetingWorker = yield* startGreetingsWorker(greetings, config.serverId, client)
            if (events && publishing) wakers.events = (eventWorker = yield* startEventsWorker(events, publishing, config.serverId, client)).notify
            if (schedules && publishing) wakers.schedules = (scheduleWorker = yield* startSchedulesWorker(schedules, publishing, config.serverId, client)).notify
            if (milestones && publishing) wakers.milestones = (milestoneWorker = yield* startMilestonesWorker(milestones, publishing, config.serverId, client)).notify
            if (suggestions && publishing) wakers.suggestions = (suggestionWorker = yield* startSuggestionsWorker(suggestions, publishing, config.serverId, client)).wake
            if (cleanup) wakers.cleanup = (cleanupWorker = yield* startCleanupWorker(cleanup, config.serverId, client)).notify
            if (metadata) wakers.metadata = (metadataWorker = yield* startMetadataLogsWorker(metadata, config.serverId, client)).notify
            if (stores.analytics) analyticsWorker = yield* startAnalyticsWorker(stores.analytics, config.serverId, client.threads)
            if (levels) {
                if (roles) wakers.levels = (levelRewards = yield* startLevelRoleWorker(levels, roles, config.serverId, client)).notify
                levelCredits = yield* startLevelCreditWorker(levels, config.serverId, client, Effect.suspend(() => levelRewards?.notify() ?? Effect.void))
            }
        }),
        events: {
            messageCreate: {
                concurrency: 1,
                handler: (context) => Effect.gen(function* () {
                    const { message, reply } = context
                    if (message.author.isSystem || message.webhookId
                        || (message.type !== MessageType.Default && message.type !== MessageType.Reply)) return
                    // Analytics adds only an in-memory count to this serialized path
                    if (analyticsWorker && message.guildId === config.serverId && !message.author.isBot) yield* analyticsWorker.message(message.channelId)
                    const content = message.content.trimStart()
                    const prefix = message.guildId === config.serverId && /^[!$%&*+,.?~^|:/\-]/.test(content) ? yield* readPrefix : "!"
                    // The fixed prefix remains available for recovery and private server selection
                    const invocationPrefix = content.startsWith(prefix) ? prefix : /^!prefix(?:\s|$)/i.test(content) ? "!" : undefined
                    const commandBody = invocationPrefix ? content.slice(invocationPrefix.length) : undefined
                    const quoted = commandBody !== undefined
                        ? commands.parseQuoted({ message, prefix: invocationPrefix!, source: commandBody }) : undefined
                    const command = quoted && !("reason" in quoted) ? quoted : undefined
                    // The quoted parser names a quote that never closes or a backslash with nothing to escape
                    const syntaxProblem = quoted && "reason" in quoted ? `${quoted.reason}.` : "Check quoting and syntax."
                    const name = commandBody === undefined ? undefined : /^([a-z0-9][a-z0-9_-]*)(?:\s|$)/i.exec(commandBody)?.[1]?.toLowerCase()
                    // Parser usage text names the prefix this command was invoked with
                    const usage = <T,>(parsed: T): T => parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string"
                        ? { ...parsed, error: withPrefix(parsed.error, invocationPrefix!) } : parsed
                    const quotingError = (hint: string) => ({ error: `${syntaxProblem} Use ${invocationPrefix}${hint}` })
                    if (name === "backup") {
                        // Backups run beside the serial message handler, so a long export never blocks other commands
                        const backup = handleBackupCommand(backups, config, command ? parseBackupCommand(command.args) : { error: `${syntaxProblem} Use !backup help privately` }, context)
                            .pipe(Effect.catchCause(() => Effect.logWarning("Backup command stopped")))
                        yield* backupScope ? backup.pipe(Effect.forkIn(backupScope)) : backup.pipe(Effect.forkDetach)
                        return
                    }
                    const safetyName = safetyNames.includes(name as SafetyName) ? name as SafetyName : undefined
                    const metadataInvocation = name === "logs" && command && isMetadataLogCommand(command.args)
                    const parsedMetadata = metadataInvocation ? usage(parseMetadataLogCommand(command.args)) : undefined
                    const parsedSafety = safetyName ? command ? usage(parseSafetyCommand(safetyName, command.args)) : quotingError(`${safetyName} help for examples`) : undefined
                    const parsedPublishing = name === "publish" ? command ? usage(parsePublishingCommand(command.args)) : quotingError("publish help for examples") : undefined
                    const roleName = ["roles", "verify", "autorole"].includes(name ?? "") ? name as RoleCommandName : undefined
                    const parsedRoles = roleName ? command ? usage(parseRoleCommand(roleName, command.args)) : quotingError(`${roleName} help for examples`) : undefined
                    const parsedRolePicker = name === "rolepicker" ? command ? parseRolePickerCommand(command.args) : quotingError("rolepicker help") : undefined
                    const greetingName = name === "welcome" || name === "goodbye" ? name : undefined
                    const parsedGreeting = greetingName ? command ? usage(parseGreetingsCommand(greetingName, command.args)) : quotingError(`${greetingName} help for examples`) : undefined
                    const parsedTicket = name === "ticket" ? command ? usage(parseTicketCommand(command.args)) : quotingError("ticket help for examples") : undefined
                    const parsedMilestone = name === "milestone" ? command ? usage(parseMilestoneCommand(command.args)) : quotingError("milestone help in private") : undefined
                    const parsedSuggestion = name === "suggest" ? command ? usage(parseSuggestionCommand(command.args)) : quotingError("suggest help") : undefined
                    const parsedCleanup = name === "cleanup" ? command ? usage(parseCleanupCommand(command.args)) : quotingError("cleanup help") : undefined
                    const parsedVoice = name === "voice" ? command ? usage(parseVoiceCommand(command.args)) : quotingError("voice help") : undefined
                    const levelName = name === "level" || name === "rank" || name === "leaderboard" ? name : undefined
                    const eventName = name === "event" || name === "events" ? name : undefined
                    const parsedEvent = eventName ? command ? usage(parseEventCommand(eventName === "events" ? ["list", ...command.args] : command.args))
                        : quotingError("event help for examples") : undefined
                    const privateInvocation = message.guildId !== config.serverId
                    if (privateInvocation) {
                        if (message.guildId !== undefined || !(metadataInvocation && metadata || name === "milestone" && milestones || name === "ticket" && tickets || safetyName && moderation)) return
                        const verified = yield* (name === "milestone" ? verifyMilestonePrivateAuthor(context.client, message.channelId, message.author.id).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)))
                            : name === "ticket" || metadataInvocation ? verifyTicketPrivateAuthor(context.client, message.channelId, message.author.id).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)))
                            : verifyPrivateAuthor(context.client, message.channelId, message.author.id).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false))))
                        if (!verified) return
                    }
                    let protectionUnknown = false
                    if (moderation && !metadataInvocation) {
                        const publishingCritical = parsedPublishing && !("error" in parsedPublishing) && (parsedPublishing.type === "settings" && parsedPublishing.patch.enabled === false
                            || parsedPublishing.type === "reconcile" || parsedPublishing.type === "query" && ["settings", "post-show", "post-list"].includes(parsedPublishing.operation.type)
                            || parsedPublishing.type === "schedule" && scheduleCritical(parsedPublishing.command))
                        const roleCritical = parsedRoles && !("error" in parsedRoles) && (parsedRoles.type === "status" || parsedRoles.type === "jobs" || parsedRoles.type === "resume"
                            || parsedRoles.type === "module" && !parsedRoles.enabled || parsedRoles.type === "member")
                        const rolePublic = parsedRoles && !("error" in parsedRoles) && (parsedRoles.type === "verify" || parsedRoles.type === "choose")
                        const parsedLevel = levelName === "level" && command ? parseLevelCommand(command.args) : undefined
                        const levelCritical = parsedLevel && !("error" in parsedLevel) && (parsedLevel.type === "config" || parsedLevel.type === "status" || parsedLevel.type === "audit"
                            || parsedLevel.type === "reconcile" || parsedLevel.type === "reset-member" || parsedLevel.type === "reset-server" || parsedLevel.type === "clear"
                            || parsedLevel.type === "module" && !parsedLevel.enabled || parsedLevel.type === "correct")
                        // Independent feature handlers apply their own backend authorization and DEFCON policy.
                        // The moderation read still supplies presence and native message protection.
                        const gateClass = metadataInvocation || name === "ticket" || name === "milestone" || name === "cleanup" ? "critical" : safetyName ? safetyGateClass(safetyName, parsedSafety!) : publishingCritical || roleCritical || levelCritical || parsedGreeting && greetingsCritical(parsedGreeting) || parsedEvent && eventCritical(parsedEvent) || parsedSuggestion && suggestionCritical(parsedSuggestion) || parsedRolePicker && rolePickerCritical(parsedRolePicker) ? "critical"
                            : greetingName || roleName && !rolePublic || parsedRolePicker || name === "custom" || name === "auto" || name === "publish" || levelName === "level" || parsedEvent && !eventPublic(parsedEvent) || parsedSuggestion && !("error" in parsedSuggestion) && !suggestionPublic(parsedSuggestion) || parsedVoice && !voicePublic(parsedVoice) ? "staff" : "public"
                        const actor = metadataInvocation || name === "ticket" || name === "milestone" || name === "cleanup" || gateClass === "public" || gateClass === "appeal" ? unprivilegedActor(message.author.id)
                            : moderationActor(yield* readSafetyAuthority(context.client, config.serverId, message.author.id))
                        const gate = yield* moderation.gate({ serverId: config.serverId, actor, command: gateClass })
                        yield* applyDefconPresence(context.client, config, gate.defcon)
                        const blocked = !privateInvocation && gate.messageProtectionEnabled
                            ? yield* containProtection(handleProtectionMessage(moderation, config, "create", message, context.client), "unknown" as const) : false
                        if (name !== "ticket" && name !== "milestone" && name !== "cleanup" && !gate.allowed || blocked === true) {
                            if (!privateInvocation && store) yield* handleAfk(store, config.serverId, context, false, prefix)
                            return
                        }
                        // A message protection could not judge gets no public command or reply. Leveling collection still runs
                        protectionUnknown = blocked === "unknown" && gateClass === "public"
                    } else if (privateInvocation && name !== "ticket" && name !== "milestone" && !metadataInvocation) return
                    // Collection adds only bounded hashing and a dropping queue offer to this serialized path.
                    if (!privateInvocation && name === "prefix" && !protectionUnknown) {
                        yield* handlePrefixCommand(general, config.serverId, command?.args ?? ["invalid quoting"], context)
                        return
                    }
                    if (!privateInvocation && name === "nickname" && !protectionUnknown) {
                        yield* handleNicknameCommand(general, config.serverId, command?.args ?? ["invalid quoting"], context)
                        return
                    }
                    if (!privateInvocation && name === "stats" && !protectionUnknown) {
                        yield* handleStatsCommand(stores.analytics, analyticsWorker, config.serverId, command?.args ?? ["invalid quoting"], context)
                        return
                    }
                    if (!privateInvocation && parsedRolePicker && !protectionUnknown) {
                        yield* handleRolePickerCommand(stores.rolePicker, config, parsedRolePicker, context)
                        return
                    }
                    if (!privateInvocation && levelCredits && config.backend && commandBody === undefined) {
                        const candidate = levelCandidate(message, config.serverId, config.backend.secret)
                        if (candidate) yield* levelCredits.offer(candidate)
                    }
                    if (protectionUnknown) {
                        if (store) yield* handleAfk(store, config.serverId, context, false, prefix)
                        return
                    }
                    const pingExit: Exit.Exit<void, unknown> = name === "ping"
                        ? yield* Effect.exit(reply({ content: "Pong!", allowedMentions: noMentions }).pipe(Effect.asVoid)) : Exit.void
                    if (Exit.isFailure(pingExit) && Cause.hasInterrupts(pingExit.cause)) return yield* Effect.failCause(pingExit.cause)
                    const afkExit: Exit.Exit<void, unknown> = store && !privateInvocation ? yield* Effect.exit(handleAfk(store, config.serverId, context, true, prefix)) : Exit.void
                    if (Exit.isFailure(afkExit) && Cause.hasInterrupts(afkExit.cause)) return yield* Effect.failCause(afkExit.cause)
                    const responseExit: Exit.Exit<void, unknown> = yield* Effect.exit(Effect.gen(function* () {
                        if (name === "afk" || name === "ping") return
                        if (metadataInvocation) {
                            if (metadata) yield* handleMetadataLogCommand(metadata, config, parsedMetadata!, context, metadataWorker)
                            return
                        }
                        if (name === "cleanup") {
                            if (cleanup) yield* handleCleanupCommand(cleanup, config, parsedCleanup!, context, cleanupWorker)
                            else yield* reply({ content: "Cleanup persistence is not configured", allowedMentions: noMentions })
                            return
                        }
                        if (name === "voice") {
                            if (voice && voiceRooms) yield* handleVoiceCommand(voice, voiceRooms, config, parsedVoice!, context)
                            else yield* reply({ content: "Voice room persistence is not configured", allowedMentions: noMentions })
                            return
                        }
                        if (name === "suggest") {
                            if (suggestions) yield* handleSuggestionCommand(suggestions, config, parsedSuggestion!, context, suggestionWorker)
                            else yield* reply({ content: "Suggestion persistence is not configured", allowedMentions: noMentions })
                            return
                        }
                        if (name === "milestone") {
                            if (milestones) yield* handleMilestoneCommand(milestones, publishing, config, parsedMilestone!, context, milestoneWorker)
                            return
                        }
                        if (eventName) {
                            if (!events) yield* reply({ content: "Event persistence is not configured", allowedMentions: noMentions })
                            else yield* handleEventCommand(events, publishing, config, parsedEvent!, context, eventWorker)
                            return
                        }
                        if (levelName) {
                            if (!levels) yield* reply({ content: "Leveling persistence is not configured", allowedMentions: noMentions })
                            else if (!command) yield* reply({ content: `${syntaxProblem} Use ${invocationPrefix}${levelName === "level" ? "level help" : levelName} for examples`, allowedMentions: noMentions })
                            else if (levelName === "level") yield* handleLevelCommand(levels, config, { name: "level", command: usage(parseLevelCommand(command.args)) }, context, levelRewards)
                            else if (levelName === "rank") yield* handleLevelCommand(levels, config, { name: "rank", command: usage(parseRankCommand(command.args)) }, context)
                            else yield* handleLevelCommand(levels, config, { name: "leaderboard", command: usage(parseLeaderboardCommand(command.args)) }, context)
                            return
                        }
                        if (name === "ticket") {
                            if (!tickets) yield* reply({ content: "Ticket persistence is not configured", allowedMentions: noMentions })
                            else yield* handleTicketCommand(tickets, publishing, config, parsedTicket!, context)
                            return
                        }
                        if (greetingName) {
                            if (!greetings) yield* reply({ content: "Greeting persistence is not configured", allowedMentions: noMentions })
                            else yield* handleGreetingsCommand(greetings, publishing, config, parsedGreeting!, context, greetingWorker)
                            return
                        }
                        if (roleName) {
                            if (parsedRoles && !("error" in parsedRoles) && parsedRoles.type === "verification-review" && verification && roles) {
                                yield* reviewVerificationRequest(verification, roles, config, context.client, parsedRoles.challengeId, message.author.id)
                                yield* reply({ content: "Staff review accepted. Access role pending", allowedMentions: noMentions })
                                return
                            }
                            if (roleName === "verify" && command?.args.length === 0 && verification && roles
                                && (yield* requestVerificationLink(verification, roles, config, context.client, message.author.id))) return
                            if (!roles) yield* reply({ content: "Role persistence is not configured", allowedMentions: noMentions })
                            else yield* handleRoleCommand(roles, publishing, config, roleName, parsedRoles!, context, roleWorker)
                            return
                        }
                        if (name === "publish") {
                            if (!publishing) yield* reply({ content: "Publishing persistence is not configured", allowedMentions: noMentions })
                            else yield* handlePublishing(publishing, config, parsedPublishing!, context, schedules, scheduleWorker)
                            return
                        }
                        if (safetyName) {
                            if (!moderation) yield* reply({ content: "Moderation persistence is not configured", allowedMentions: noMentions })
                            else if (parsedSafety && "error" in parsedSafety) yield* reply({ content: parsedSafety.error, allowedMentions: noMentions })
                            else yield* handleSafetyCommand(moderation, config, safetyName, parsedSafety!, context, privateInvocation)
                            return
                        }
                        if (name === "custom" || name === "auto") {
                            const parsed = command ? usage(parseManagement(name, command.args)) : quotingError(`${name} help for examples`)
                            if ("error" in parsed || "help" in parsed) {
                                yield* reply({ content: "error" in parsed ? parsed.error : withPrefix(parsed.help, invocationPrefix!), allowedMentions: noMentions })
                            } else if (responses) {
                                yield* handleManagement(responses, config.serverId, parsed, context)
                            } else {
                                yield* reply({ content: "Response persistence is not configured", allowedMentions: noMentions })
                            }
                            return
                        }
                        if (responses) yield* handleResponse(responses, config.serverId, context)
                    }))
                    let cause: Cause.Cause<unknown> = Cause.empty
                    for (const outcome of [pingExit, afkExit, responseExit]) {
                        if (Exit.isFailure(outcome)) cause = Cause.combine(cause, outcome.cause)
                    }
                    if (cause.reasons.length) return yield* Effect.failCause(cause)
                }),
            },
            messageUpdate: {
                concurrency: 1,
                handler: ({ event, client }) => Effect.gen(function* () {
                    if (admitMetadata) yield* admitMetadata("messageUpdate", event, client)
                    if (!moderation || event.guildId !== config.serverId || event.author.isSystem || event.webhookId
                        || (event.type !== MessageType.Default && event.type !== MessageType.Reply)) return
                    const gate = yield* moderation.gate({ serverId: config.serverId, actor: unprivilegedActor(event.author.id), command: "public" })
                    if (gate.messageProtectionEnabled) yield* containProtection(handleProtectionMessage(moderation, config, "edit", event, client), false)
                }),
            },
            guildMemberAdd: {
                concurrency: 1,
                handler: (context) => Effect.gen(function* () {
                    if (admitMetadata) yield* admitMetadata("guildMemberAdd", context.event, context.client)
                    if (context.event.guildId !== config.serverId) return
                    if (analyticsWorker) yield* analyticsWorker.join()
                    if (milestoneWorker) yield* milestoneWorker.notifyMember(context.event.userId)
                    const gate = moderation ? yield* moderation.gate({ serverId: config.serverId, actor: unprivilegedActor(context.event.userId), command: "public" }) : undefined
                    if (moderation && gate?.joinProtectionEnabled) yield* containProtection(handleProtectionJoin(moderation, config, context), undefined)
                    if (greetings) yield* observeGreetingJoin(greetings, config.serverId, context.client, context.event.userId, context.event.joinedAt)
                        .pipe(Effect.andThen(wake(context.event.userId)), Effect.catchCause((cause) => Cause.hasInterrupts(cause)
                            ? Effect.failCause(cause) : Effect.logWarning("Greeting admission could not be verified. Existing join protection and role handling remain independent")))
                    if (roles && (!gate || gate.allowed)) {
                        yield* handleRoleJoin(roles, config.serverId, context.client, context.event.userId, context.event.joinedAt)
                            .pipe(Effect.mapError(() => new RoleHandlingError({ stage: "eligibility" })))
                    }
                }),
            },
            guildMemberRemove: {
                concurrency: 1,
                handler: ({ event, client }) => Effect.gen(function* () {
                    if (admitMetadata) yield* admitMetadata("guildMemberRemove", event, client)
                    if (event.guildId !== config.serverId) return
                    if (analyticsWorker) yield* analyticsWorker.leave()
                    if (eventWorker) yield* eventWorker.notifyMember(event.userId)
                    if (milestoneWorker) yield* milestoneWorker.notifyMember(event.userId)
                    if (greetings) yield* observeGreetingMembership(greetings, config.serverId, client, event.userId, true).pipe(Effect.andThen(wake(event.userId)))
                }),
            },
            guildMemberUpdate: {
                concurrency: 1,
                handler: ({ event, client }) => Effect.gen(function* () {
                    if (admitMetadata) yield* admitMetadata("guildMemberUpdate", event, client)
                    if (event.guildId !== config.serverId) return
                    if (milestoneWorker) yield* milestoneWorker.notifyMember(event.userId)
                    if (greetings) yield* observeGreetingMembership(greetings, config.serverId, client, event.userId).pipe(Effect.andThen(wake(event.userId)))
                }),
            },
            messageDelete: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("messageDelete", event, client) ?? Effect.void },
            messageDeleteBulk: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("messageDeleteBulk", event, client) ?? Effect.void },
            guildRoleCreate: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("guildRoleCreate", event, client) ?? Effect.void },
            guildRoleUpdate: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("guildRoleUpdate", event, client) ?? Effect.void },
            guildRoleDelete: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("guildRoleDelete", event, client) ?? Effect.void },
            guildRoleUpdateBulk: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("guildRoleUpdateBulk", event, client) ?? Effect.void },
            guildChannelCreate: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("guildChannelCreate", event, client) ?? Effect.void },
            guildChannelUpdate: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("guildChannelUpdate", event, client) ?? Effect.void },
            guildChannelDelete: {
                concurrency: 1,
                handler: ({ event, client }) => Effect.gen(function* () {
                    if (voiceRooms && event.guildId === config.serverId) yield* voiceRooms.channelDeleted(event.id)
                    if (admitMetadata) yield* admitMetadata("guildChannelDelete", event, client)
                }),
            },
            voiceStateUpdate: { concurrency: 1, handler: ({ event }) => voiceRooms?.voiceState(event) ?? Effect.void },
            voiceStateSnapshot: { concurrency: 1, handler: ({ event }) => voiceRooms?.snapshot(event) ?? Effect.void },
            guildDelete: { concurrency: 1, handler: ({ event }) => voiceRooms && event.id === config.serverId ? voiceRooms.unavailable() : Effect.void },
            guildChannelUpdateBulk: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("guildChannelUpdateBulk", event, client) ?? Effect.void },
            guildUpdate: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("guildUpdate", event, client) ?? Effect.void },
            guildAuditLogEntryCreate: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("guildAuditLogEntryCreate", event, client) ?? Effect.void },
            messageReactionAdd: {
                concurrency: 1,
                handler: ({ event, client }) => Effect.gen(function* () {
                    if (!roles) return
                    if (verification && (yield* requestVerificationLink(verification, roles, config, client, event.userId, event))) return
                    yield* handleRoleReaction(roles, config.serverId, client, event, event.userId)
                }).pipe(Effect.mapError(() => new RoleHandlingError({ stage: "eligibility" }))),
            },
            messageReactionAddMany: {
                concurrency: 1,
                handler: ({ event, client }) => Effect.gen(function* () {
                    if (!roles) return
                    for (const userId of new Set(event.reactions.map((reaction) => reaction.userId))) {
                        if (verification && (yield* requestVerificationLink(verification, roles, config, client, userId, event))) continue
                        yield* handleRoleReaction(roles, config.serverId, client, event, userId)
                    }
                }).pipe(Effect.mapError(() => new RoleHandlingError({ stage: "eligibility" }))),
            },
            messageReactionRemove: {
                concurrency: 1,
                handler: ({ event, client }) => roles ? handleRoleReaction(roles, config.serverId, client, event, event.userId)
                    .pipe(Effect.mapError(() => new RoleHandlingError({ stage: "eligibility" }))) : Effect.void,
            },
            messageReactionRemoveAll: {
                concurrency: 1,
                handler: ({ event }) => event.guildId !== undefined && event.guildId !== config.serverId || !roleWorker
                    ? Effect.void : roleWorker.enqueue(event.id),
            },
            messageReactionRemoveEmoji: {
                concurrency: 1,
                handler: ({ event }) => event.guildId !== undefined && event.guildId !== config.serverId || !roleWorker
                    ? Effect.void : roleWorker.enqueue(event.id),
            },
        },
    } satisfies BotOptions<unknown>
    return { ...options, wake: (kind: ServiceWorkKind) => wakers[kind]?.() ?? Effect.void }
}
