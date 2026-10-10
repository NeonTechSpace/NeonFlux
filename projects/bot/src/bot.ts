import { commands, MessageType, type BotOptions, type BotEventContext, type Client, type EventName, type Message, type Observation } from "@neontechspace/fluxerly/effect"
import { Cause, Effect, Exit, Redacted, Scope, Semaphore, Stream } from "effect"
import type { AfkStore } from "./afk-store.ts"
import { handleAfk } from "./afk.ts"
import type { BotConfig, BotRootConfig } from "./config.ts"
import { parseManagement } from "./response-command.ts"
import type { ResponseStore } from "./responses-store.ts"
import { handleManagement, handleResponse, noMentions } from "./responses.ts"
import type { ModerationStore } from "./moderation-store.ts"
import { handleSafetyCommand, initializeModeration, moderationActor, applyDefconPresence } from "./moderation.ts"
import { parseSafetyCommand, safetyGateClass, safetyNames, type SafetyName } from "./moderation-command.ts"
import { readAuthenticatedBotId, readSafetyAuthority, verifyPrivateAuthor } from "./safety-permissions.ts"
import { containProtection, handleBotProtectionMessage, handleProtectionJoin, handleProtectionMessage, trackBotMessageChecks } from "./protections.ts"
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
import { createTicketStore, type TicketStore } from "./ticket-store.ts"
import { parseTicketCommand } from "./ticket-command.ts"
import { findTicketIntake, handleTicketCommand } from "./ticket-management.ts"
import { rootBackend } from "./backend-http.ts"
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
import { handleBackupCommand, processBackupPreviewPass } from "./backup.ts"
import { handleServerExportCommand } from "./server-export.ts"
import type { ServerExportStore } from "./server-export-store.ts"
import { configScope, createInstallationClient, createServerRuntime, ServerScopeError, verifyBackendScope, type ServerRuntime } from "./server-runtime.ts"
import { selectServerCommand, serverReply, validServerId, type DeploymentScope } from "./server-scope.ts"
import { createPrefixReader, handleNicknameCommand, handlePrefixCommand, withPrefix, type GeneralSettingsStore } from "./general-settings.ts"
import { createVerificationStore, type VerificationStore } from "./verification-store.ts"
import { requestVerificationLink, reviewVerificationRequest, startVerificationWorker } from "./verification.ts"
import { createDashboardPanelPublisher, startDashboardRolesWorker, type DashboardPanelPublisher } from "./dashboard-roles.ts"
import { createPanelIndex } from "./role-panel-index.ts"
import type { AnalyticsStore } from "./analytics-store.ts"
import { startAnalyticsWorker } from "./analytics-worker.ts"
import { handleStatsCommand } from "./analytics-management.ts"
import type { ServiceWorkKind } from "@neonflux/backend/contracts"
import { createWorkNotices, startWorkDispatcher } from "./work-dispatcher.ts"
import type { VoiceStore } from "./voice-store.ts"
import { parseVoiceCommand, voicePublic } from "./voice-command.ts"
import { handleVoiceCommand } from "./voice-management.ts"
import { createVoiceRuntime } from "./voice-worker.ts"
import type { RolePickerStore } from "./rolepicker-store.ts"
import { parseRolePickerCommand, rolePickerCritical } from "./rolepicker-command.ts"
import { handleRolePickerCommand } from "./rolepicker-management.ts"
import { processRolePickerPass } from "./rolepicker-worker.ts"
import type { StickyStore } from "./sticky-store.ts"
import { handleStickyCommand } from "./sticky-management.ts"
import { createStickyRuntime } from "./sticky-worker.ts"
import type { SidebarStore } from "./sidebar-store.ts"
import { handleSidebarCommand } from "./sidebar-management.ts"
import type { MemberListStore } from "./memberlist-store.ts"
import { handleMemberListCommand } from "./memberlist-management.ts"
import type { TemporaryRoleStore } from "./temprole-store.ts"
import { parseTemporaryRoleCommand, temporaryRoleCritical } from "./temprole-command.ts"
import { handleTemporaryRoleCommand } from "./temprole-management.ts"
import { startTemporaryRoleWorker } from "./temprole-worker.ts"
import type { HelpDeskStore } from "./helpdesk-store.ts"
import { handleHelpDeskInvocation, helpDeskCommands } from "./helpdesk-management.ts"
import { createHelpDeskRuntime, startHelpDeskWorker } from "./helpdesk-worker.ts"
import type { OnboardingStore } from "./onboarding-store.ts"
import { onboardingCritical, onboardingPublic, parseOnboardingCommand } from "./onboarding-command.ts"
import { handleOnboardingCommand } from "./onboarding-management.ts"
import { createOnboardingRuntime, registerOnboardingRuntime } from "./onboarding.ts"
import type { PresetStore } from "./preset-store.ts"
import { parsePresetCommand } from "./preset-command.ts"
import { handlePresetCommand } from "./preset-management.ts"
import type { LfgStore } from "./lfg-store.ts"
import { lfgStaff, parseLfgCommand } from "./lfg-command.ts"
import { handleLfgCommand } from "./lfg-management.ts"
import { startLfgWorker } from "./lfg-worker.ts"
import type { ShowcaseStore } from "./showcase-store.ts"
import { parseShowcaseCommand, showcasePublic } from "./showcase-command.ts"
import { handleShowcaseCommand } from "./showcase-management.ts"
import { processShowcasePass } from "./showcase-worker.ts"
import type { ProfileStore } from "./profile-store.ts"
import { parseProfileCommand, profilePublic } from "./profile-command.ts"
import { handleProfileCommand } from "./profile-management.ts"
import { processProfilePass } from "./profile-worker.ts"
import { observeCosts, startCostSummary } from "./costs.ts"
import { createMessageRevisions } from "./message-revisions.ts"
import { forgetAll, forgetChannel, forgetChannels, forgetRole, forgetServer, forgetThread, rememberChannel, rememberRole, updateChannel } from "./fluxerly-next.ts"
import { createServerAdmission, type ServerAdmission } from "./event-admission.ts"
import { createOptionalWork, limitAfk } from "./optional-work.ts"
import { createUsageGuard, startUsageReporter, type UsageGuard } from "./usage.ts"
import { handleHelpCommand, suggestCommand } from "./help.ts"
import { handleHealthCommand, handleRecoveryCommand, handleSetupCommand, processSetupCheckPass, type SetupStore } from "./setup-check.ts"
import { processPrivateAccessPass, type PrivateDataStore } from "./private-data.ts"
import { processStructurePass } from "./structure.ts"
import type { StructureStore } from "./structure-store.ts"
import { postInstallNote } from "./install-note.ts"
import { isMemberDataCommand } from "./member-data-command.ts"
import { handleMemberDataCommand } from "./member-data.ts"
import { createMemberDataStore, type MemberDataStore } from "./member-data-store.ts"
import type { AlertsStore } from "./alerts-store.ts"
import { createSecurityAlerts } from "./alerts-worker.ts"
import { handleAlertsCommand, handleInvitesCommand } from "./alerts-management.ts"

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
    readonly serverExport?: ServerExportStore | undefined
    readonly general?: GeneralSettingsStore | undefined
    readonly verification?: VerificationStore | undefined
    readonly analytics?: AnalyticsStore | undefined
    readonly voice?: VoiceStore | undefined
    readonly rolePicker?: RolePickerStore | undefined
    readonly temporaryRoles?: TemporaryRoleStore | undefined
    readonly onboarding?: OnboardingStore | undefined
    readonly presets?: PresetStore | undefined
    readonly showcases?: ShowcaseStore | undefined
    readonly profiles?: ProfileStore | undefined
    readonly setup?: SetupStore | undefined
    readonly privateData?: PrivateDataStore | undefined
    readonly memberData?: MemberDataStore | undefined
    readonly sticky?: StickyStore | undefined
    readonly sidebar?: SidebarStore | undefined
    readonly memberList?: MemberListStore | undefined
    readonly alerts?: AlertsStore | undefined
    readonly helpDesk?: HelpDeskStore | undefined
    readonly lfg?: LfgStore | undefined
    readonly structure?: StructureStore | undefined
}

// Every gateway event a server runtime handles. Each is routed to exactly one runtime and never broadcast
const routedEvents = ["messageCreate", "messageUpdate", "guildMemberAdd", "guildMemberRemove", "guildMemberUpdate", "messageDelete", "messageDeleteBulk",
    "guildRoleCreate", "guildRoleUpdate", "guildRoleDelete", "guildRoleUpdateBulk", "guildChannelCreate", "guildChannelUpdate", "guildChannelDelete", "guildChannelUpdateBulk",
    "guildUpdate", "guildAuditLogEntryCreate", "messageReactionAdd", "messageReactionAddMany", "messageReactionRemove", "messageReactionRemoveAll", "messageReactionRemoveEmoji",
    "voiceStateUpdate", "voiceStateSnapshot", "guildDelete", "threadCreate", "threadUpdate", "threadDelete", "threadListSync", "inviteCreate", "inviteDelete"] as const satisfies readonly EventName[]
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
// The SDK caches that evaluation reads, kept current by gateway events and bounded across the whole client
const CACHE = { guilds: { maxEntries: 5000, maxBytes: 8388608 }, members: { maxEntries: 20000, maxBytes: 16777216 } } as const

export function createBotOptions(options: BotRootConfig, stores: BotStores = {}) {
    // Every runtime's backend answers report the due times of work their writes create to the one dispatcher
    const notices = createWorkNotices()
    const config: BotRootConfig = options.backend ? { ...options, backend: { ...options.backend, onWorkDue: notices.report } } : options
    const scope = configScope(config)
    const multi = scope.mode === "multi"
    // Usage reports set it, and every runtime's optional work follows it
    const guard = createUsageGuard()
    const runtimes = createRuntimeRegistry(config, scope, stores, guard)
    // Single mode always names its configured server. Multi mode serves the servers registered now
    const served = (serverId: string) => scope.mode === "single" ? serverId === scope.serverIds[0] : runtimes.has(serverId)
    const revisions = createMessageRevisions()
    // Finds the open intake a plain DM answers. The lookup binds no server, so it uses the root backend configuration
    const intakes = scope.mode === "single" && stores.tickets ? stores.tickets : config.backend ? createTicketStore(rootBackend(config.backend)) : undefined
    const memberData = stores.memberData ?? (config.backend ? createMemberDataStore(config.backend) : undefined)
    const events: NonNullable<BotOptions<unknown>["events"]> = {}
    for (const name of routedEvents) {
        const handler = (context: BotEventContext<EventName>) => {
            const work = Effect.gen(function* () {
                const payload = context.event as unknown as { guildId?: string, channelId?: string, id?: string, content?: string, guild?: { id: string } }
                // A new invite names its server in guild
                let guildId = payload.guildId ?? (name === "guildUpdate" || name === "guildDelete" ? payload.id : name === "inviteCreate" ? payload.guild?.id : undefined)
                if (guildId !== undefined && !served(guildId)) return
                // Webhook and other bots' messages reach automod only in a server that checks them, so they cost nothing while it is off.
                // Other handlers skip bots' messages. A webhook's edits that Fluxer does not mark as a bot's still reach metadata logs
                const posted = name === "messageCreate" ? (context as BotEventContext<"messageCreate">).message : name === "messageUpdate" ? (context as BotEventContext<"messageUpdate">).event : undefined
                const checker = posted && (posted.author.isBot || posted.webhookId) && !posted.author.isSystem && (posted.type === MessageType.Default || posted.type === MessageType.Reply)
                    && guildId !== undefined ? runtimes.get(guildId) : undefined
                const checked = checker?.options.botMessages.enabled() ? checker : undefined
                if (posted?.author.isBot && !checked) return
                // A link preview or another embed-only update changes nothing a feature reads
                if (name === "messageUpdate" && !revisions.changed((context as BotEventContext<"messageUpdate">).event)) return
                if (posted && checked) {
                    if (name === "messageCreate") revisions.created(posted)
                    yield* checked.admission.admit(Effect.suspend(() => checked.options.botMessages.handle(name === "messageCreate" ? "create" : "edit", posted, context.client)))
                    if (name === "messageCreate" || posted.author.isBot) return
                }
                let selected: ReturnType<typeof selectServerCommand>
                if (name === "messageCreate") {
                    const messageContext = context as BotEventContext<"messageCreate">
                    if (messageContext.message.author.isSystem || messageContext.message.webhookId
                        || messageContext.message.type !== MessageType.Default && messageContext.message.type !== MessageType.Reply) return
                    revisions.created(messageContext.message)
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
                // A member's own data spans every server, so !mydata in a DM selects none
                if (name === "messageCreate" && guildId === undefined && isMemberDataCommand(payload.content ?? "")) return yield* handleMemberDataCommand(memberData, context as BotEventContext<"messageCreate">)
                let intakeNo: number | undefined
                if (name === "messageCreate") {
                    const messageContext = context as BotEventContext<"messageCreate">
                    selected = selectServerCommand(payload.content ?? "", scope, served, guildId)
                    if (selected && "error" in selected) { yield* messageContext.reply({ content: selected.error, allowedMentions: noMentions }); return }
                    // A plain DM answers the member's one open ticket intake, and is ignored when there is none
                    if (!selected && guildId === undefined && intakes) {
                        const open = yield* findTicketIntake(intakes, messageContext, served, scope)
                        if (open) { selected = { serverId: open.serverId, content: messageContext.message.content }; intakeNo = open.intakeNo }
                    }
                    if (!selected) return
                }
                const serverId = selected && !("error" in selected) ? selected.serverId : guildId
                if (!serverId) return
                const runtime = runtimes.get(serverId)
                if (!runtime) return
                const event = guildId && payload.guildId === undefined ? { ...context.event, guildId } : context.event
                let routed = { ...context, event }
                if (name === "messageCreate") {
                    const original = context as BotEventContext<"messageCreate">
                    const message = { ...original.message, ...(guildId ? { guildId } : {}), content: selected && !("error" in selected) ? selected.content : original.message.content }
                    const reply: typeof original.reply = (input, settings) => original.reply(multi && !guildId
                        ? typeof input === "string" ? serverReply(input, serverId) : { ...input, ...(input.content ? { content: serverReply(input.content, serverId) } : {}) } : input, settings)
                    routed = { ...routed, event: message, message, reply } as typeof routed
                }
                const answered = intakeNo
                const invoke = (answered === undefined ? runtime.options.events[name].handler
                    : (value: BotEventContext<"messageCreate">) => runtime.options.intakeReply(value, answered)) as (value: BotEventContext<EventName>) => Effect.Effect<unknown, unknown>
                // A server whose runtime is still starting holds its events without keeping this handler slot, and a retired runtime receives none
                yield* runtime.admission.admit(Effect.suspend(() => invoke(routed)))
                })
            return work
        }
        Object.assign(events, { [name]: { concurrency: multi ? MULTI_EVENT_CONCURRENCY : 1, ...(multi ? { partition: "guild" as const } : {}), handler } })
    }
    // The routed guildDelete tells a temporarily unavailable server's runtime about the outage
    const routedDelete = (events.guildDelete as { handler: (context: BotEventContext<"guildDelete">) => Effect.Effect<unknown, unknown> }).handler
    const serverEvent = { concurrency: multi ? MULTI_EVENT_CONCURRENCY : 1, ...(multi ? { partition: "guild" as const } : {}) }
    // A server that becomes available or unavailable may have changed unseen, so the roles and channels kept for it are forgotten
    Object.assign(events, {
        // Startup hydration, recovery and Resume repeat guildCreate, so multi-mode registration is idempotent
        guildCreate: { ...serverEvent, handler: ({ event, client }: BotEventContext<"guildCreate">) => Effect.suspend(() => {
            forgetServer(client, event.id)
            return multi ? runtimes.join(event.id) : Effect.void
        }) },
        // A temporarily unavailable server keeps its runtime. Any other deletion in multi mode means the bot no longer sees the server
        guildDelete: { ...serverEvent, handler: (context: BotEventContext<"guildDelete">) => Effect.suspend(() => {
            forgetServer(context.client, context.event.id)
            return multi && !context.event.unavailable ? runtimes.leave(context.event.id) : routedDelete(context)
        }) },
    })
    let connected: Client | undefined
    // Every handler is registered before the gateway connects, so automatic filtering asks Fluxer not to send the other
    // dispatch types, such as typing and presence updates
    // Bot-authored messages reach the router, which passes on only those a server's automod checks
    return { token: Redacted.value(config.token), processSignals: true, ignoreBots: false, ...(multi ? { sharding: "auto" as const, rest: MULTI_REST } : {}), events, cache: CACHE,
        observe: (observation: Observation) => {
            observeCosts(observation)
            // A lost connection can miss events that a new session does not replay
            if (observation.type === "reconnect" && connected) forgetAll(connected)
        },
        gateway: { ignoredEvents: "auto" as const },
        setup: (client: Client) => Effect.gen(function* () {
            connected = client
            yield* startCostSummary(client)
            yield* verifyBackendScope(config)
            // The first usage report answers the bill guard's state while the runtimes start
            if (config.backend) yield* startUsageReporter(config.backend, guard)
            yield* runtimes.start(client, yield* Effect.scope)
            // One dispatcher serves every runtime in both modes, so a server without due work causes no backend requests
            if (config.backend) yield* startWorkDispatcher(config.backend, runtimes.wake, notices)
        }) } satisfies BotOptions<unknown>
}

interface RuntimeEntry {
    readonly runtime: ServerRuntime
    readonly options: ScopedBotOptions
    /** Holds the server's events until setup has finished */
    readonly admission: ServerAdmission
    started: boolean
    /** Set when the backend registration started a new installation, until the install note is posted */
    welcome?: boolean
    scope?: Scope.Closeable
}

// Server runtimes by ID. Single mode serves its configured server. Multi mode serves the servers the bot is in and retires those it leaves
function createRuntimeRegistry(root: BotRootConfig, scope: DeploymentScope, stores: BotStores, guard: UsageGuard) {
    const entries = new Map<string, RuntimeEntry>()
    // Every backend join and leave passes through this one queue, so a registration and a removal never race
    const queue = Semaphore.makeUnsafe(1)
    // Events held while their servers started run under the same concurrency as the handlers
    const heldPermits = Semaphore.makeUnsafe(MULTI_EVENT_CONCURRENCY)
    const installations = scope.mode === "multi" && root.backend ? createInstallationClient(root.backend) : undefined
    let lifetime: { readonly client: Client, readonly scope: Scope.Scope } | undefined

    function register(serverId: string) {
        const existing = entries.get(serverId)
        if (existing) return existing
        const runtime = createServerRuntime(root, serverId, () => retire(entry))
        const injected = Object.fromEntries(Object.entries(stores).filter(([, store]) => store !== undefined))
        const entry: RuntimeEntry = { runtime, options: createScopedBotOptions(runtime.config, scope.mode === "single" ? { ...runtime.adapters, ...injected } : runtime.adapters ?? {}, guard.paused),
            admission: createServerAdmission(heldPermits), started: false }
        entries.set(serverId, entry)
        return entry
    }
    // Retiring stops the runtime's backend requests, workers and event routing. Its stored data stays in the backend
    function retire(entry: RuntimeEntry) {
        const serverId = entry.runtime.config.serverId, runtimeScope = entry.scope, client = lifetime?.client
        if (entries.get(serverId) === entry) entries.delete(serverId)
        entry.runtime.deactivate()
        entry.admission.close()
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
        // Held events run in the runtime's scope, so retiring stops them, and the next start is not delayed by them
        if (entry.runtime.active()) yield* entry.admission.open.pipe(Effect.forkIn(runtimeScope))
        if (entry.welcome && entry.runtime.active()) {
            entry.welcome = false
            const serverId = entry.runtime.config.serverId
            const prefix = entry.runtime.adapters ? entry.runtime.adapters.general.get().pipe(Effect.map(settings => settings.prefix), Effect.catch(() => Effect.succeed("!"))) : Effect.succeed("!")
            yield* prefix.pipe(Effect.flatMap(value => postInstallNote(client, serverId, value, root.websiteUrl)),
                Effect.catch(() => Effect.logWarning(`Server ${serverId} install note could not be posted`)), Effect.forkIn(runtimeScope))
        }
    })
    // Runs inside the queue. A server the backend could not register is retired until it becomes available again
    const registerWithBackend = (entry: RuntimeEntry) => Effect.suspend(() => {
        const serverId = entry.runtime.config.serverId
        if (!installations || entries.get(serverId) !== entry || !entry.runtime.active()) return Effect.succeed(false)
        return installations.join(serverId).pipe(Effect.map(welcome => { entry.welcome = welcome; return true }), Effect.catch(() => Effect.sync(() => retire(entry)).pipe(
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
        // Current servers register before the gateway connects, so their events are held for their runtimes instead of being dropped
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

function createScopedBotOptions(config: BotConfig, stores: BotStores, paused: () => boolean) {
    // Optional per-message work has per-server limits and stops while the bill guard pauses it
    const optional = createOptionalWork(paused)
    const store = stores.afk && limitAfk(stores.afk, optional)
    const botChecks = stores.moderation && trackBotMessageChecks(stores.moderation), moderation = botChecks?.store
    const { responses, publishing, greetings, tickets, leveling: levels, events, schedules, milestones, suggestions, cleanup, metadata,
        backup: backups, general, voice, setup } = stores
    const voiceRooms = voice ? createVoiceRuntime(voice, config.serverId) : undefined
    const stickyMessages = stores.sticky ? createStickyRuntime(stores.sticky, config.serverId, optional("sticky")) : undefined
    const helpDesk = stores.helpDesk ? createHelpDeskRuntime(stores.helpDesk, config.serverId, optional("helpdesk")) : undefined
    const verification = stores.verification ?? (config.backend && config.websiteUrl ? createVerificationStore(config.backend) : undefined)
    const readPrefix = createPrefixReader(general, config.serverId)
    let metadataWorker: Effect.Success<ReturnType<typeof startMetadataLogsWorker>> | undefined
    let analyticsWorker: Effect.Success<ReturnType<typeof startAnalyticsWorker>> | undefined
    const admitMetadata = metadata ? createMetadataGatewayAdmission(metadata, config.serverId, () => metadataWorker?.notify() ?? Effect.void) : undefined
    // Security alerts check in-memory settings on each event and reach staff through metadata logs
    const securityAlerts = stores.alerts && metadata ? createSecurityAlerts(stores.alerts, metadata, config.serverId, () => metadataWorker?.notify() ?? Effect.void) : undefined
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
    // Role changes wake greetings when they are configured, and panel reads and changes keep the panel index current
    const panelIndex = createPanelIndex()
    const roles: RolesStore | undefined = roleBackend ? {
        manage: (input) => panelIndex.change(roleBackend.manage(input)),
        query: (input) => roleBackend.query(input),
        memberQuery: (input) => panelIndex.learn(roleBackend.memberQuery(input)),
        policy: (input) => roleBackend.policy(input),
        reactionJobs: (input) => roleBackend.reactionJobs(input),
        dispatch: (input) => roleBackend.dispatch(input),
        observe: (input) => roleBackend.observe(input),
        evaluate: (input) => roleBackend.evaluate(input).pipe(Effect.tap(() => wake(input.context.userId))),
        outcome: (input) => roleBackend.outcome(input).pipe(Effect.tap((value) => value.recorded ? wake() : Effect.void)),
        reconcile: (input) => roleBackend.reconcile(input).pipe(Effect.tap((value) => value.recorded ? wake(input.observation.userId) : Effect.void)),
    } : undefined
    // The newcomer checklist follows member role changes from memory and adds its completion role through the role store
    const onboarding = stores.onboarding ? createOnboardingRuntime(stores.onboarding, roles, config.serverId) : undefined
    const publishPanel = (publisher: DashboardPanelPublisher): DashboardPanelPublisher => (job, result) => panelIndex.change(publisher(job, result))
    let roleWorker: Effect.Success<ReturnType<typeof startRoleReactionWorker>> | undefined
    let backupScope: Scope.Scope | undefined
    // A channel change after a structure editor read tells open editors that their read is out of date
    const structureChanged = stores.structure?.serverChanged(config.serverId) ?? Effect.void
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
            if (stickyMessages) yield* stickyMessages.start(client)
            if (securityAlerts) yield* securityAlerts.start()
            if (helpDesk && stores.helpDesk) {
                yield* helpDesk.start(client)
                wakers.helpdesk = (yield* startHelpDeskWorker(stores.helpDesk, config.serverId, client)).notify
            }
            if (onboarding) yield* registerOnboardingRuntime(config.serverId, onboarding)
            if (moderation) yield* initializeModeration(moderation, config, client)
            else yield* applyDefconPresence(client, config, 3)
            if (publishing) yield* publishing.observe({ serverId: config.serverId, mode: "restart" })
            if (config.backend) wakers.dashboard = (yield* startDashboardRolesWorker(config, client, publishing ? publishPanel(createDashboardPanelPublisher(config, client, publishing)) : undefined, publishing,
                stores.rolePicker && roles ? processRolePickerPass(stores.rolePicker, roles, config.serverId, client) : undefined,
                setup ? processSetupCheckPass(setup, config.serverId, client) : undefined,
                stores.privateData ? processPrivateAccessPass(stores.privateData, config.serverId, client) : undefined,
                backups ? processBackupPreviewPass(backups, config, client) : undefined,
                stores.showcases && publishing ? processShowcasePass(stores.showcases, publishing, config.serverId, client) : undefined,
                stores.profiles ? processProfilePass(stores.profiles, config.serverId, client) : undefined,
                stores.structure ? processStructurePass(stores.structure, config.serverId, client) : undefined)).notify
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
            if (stores.analytics) analyticsWorker = yield* startAnalyticsWorker(stores.analytics, config.serverId, client)
            if (levels) {
                if (roles) wakers.levels = (levelRewards = yield* startLevelRoleWorker(levels, roles, config.serverId, client)).notify
                levelCredits = yield* startLevelCreditWorker(levels, config.serverId, client, Effect.suspend(() => levelRewards?.notify() ?? Effect.void))
            }
            if (stores.temporaryRoles && roles) wakers.temproles = (yield* startTemporaryRoleWorker(stores.temporaryRoles, roles, config.serverId, client)).notify
            if (stores.lfg) wakers.lfg = (yield* startLfgWorker(stores.lfg, config.serverId, client)).notify
        }),
        events: {
            messageCreate: {
                concurrency: 1,
                handler: (context) => Effect.gen(function* () {
                    const { message, reply } = context
                    if (message.author.isSystem || message.webhookId
                        || (message.type !== MessageType.Default && message.type !== MessageType.Reply)) return
                    // Analytics adds only an in-memory count to this serialized path
                    if (analyticsWorker && message.guildId === config.serverId && !message.author.isBot && (yield* optional("analytics"))) yield* analyticsWorker.message(message.channelId)
                    // Sticky messages check an in-memory list here, and a repost runs beside this path
                    if (stickyMessages && message.guildId === config.serverId && !message.author.isBot) yield* stickyMessages.message(message.channelId)
                    const content = message.content.trimStart()
                    // A mention of the bot followed by help answers like the help command, for members who do not know the prefix
                    const mention = message.guildId === config.serverId ? /^<@!?(\d+)>\s+help(?:\s+(\S+))?\s*$/i.exec(content) : null
                    const helpMention = !!mention && mention[1] === (yield* readAuthenticatedBotId(context.client).pipe(Effect.catch(() => Effect.succeed(undefined))))
                    const prefix = message.guildId === config.serverId && (/^[!$%&*+,.?~^|:/\-]/.test(content) || helpMention) ? yield* readPrefix : "!"
                    // The fixed prefix remains available for recovery and private server selection
                    const invocationPrefix = content.startsWith(prefix) ? prefix : /^!prefix(?:\s|$)/i.test(content) ? "!" : undefined
                    const commandBody = invocationPrefix ? content.slice(invocationPrefix.length) : undefined
                    // An apostrophe inside a word, as in don't, is text rather than a quote, so free text such as a reason needs no escaping
                    const quoted = commandBody !== undefined
                        ? commands.parseQuoted({ message, prefix: invocationPrefix!, source: commandBody.replace(/(?<=\p{L})'(?=\p{L})/gu, "\\'") }) : undefined
                    const command = quoted && !("reason" in quoted) ? quoted : undefined
                    // The quoted parser names a quote that never closes or a backslash with nothing to escape
                    const syntaxProblem = quoted && "reason" in quoted ? `${quoted.reason}.` : "Check quoting and syntax."
                    const name = helpMention ? "help" : commandBody === undefined ? undefined : /^([a-z0-9][a-z0-9_-]*)(?:\s|$)/i.exec(commandBody)?.[1]?.toLowerCase()
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
                    if (name === "export") {
                        // An export reads many pages, so it also runs beside the serial message handler
                        const exporting = handleServerExportCommand(stores.serverExport, config, command?.args ?? ["invalid quoting"], context)
                            .pipe(Effect.catchCause(() => Effect.logWarning("Export command stopped")))
                        yield* backupScope ? exporting.pipe(Effect.forkIn(backupScope)) : exporting.pipe(Effect.forkDetach)
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
                    const parsedTemporaryRole = name === "temprole" ? command ? parseTemporaryRoleCommand(command.args) : quotingError("temprole help") : undefined
                    const parsedOnboarding = name === "onboarding" ? command ? usage(parseOnboardingCommand(command.args)) : quotingError("onboarding help") : undefined
                    const parsedShowcase = name === "showcase" ? command ? usage(parseShowcaseCommand(command.args)) : quotingError("showcase help") : undefined
                    const parsedProfile = name === "profile" ? command ? usage(parseProfileCommand(command.args)) : quotingError("profile help") : undefined
                    const greetingName = name === "welcome" || name === "goodbye" ? name : undefined
                    const parsedGreeting = greetingName ? command ? usage(parseGreetingsCommand(greetingName, command.args)) : quotingError(`${greetingName} help for examples`) : undefined
                    const parsedTicket = name === "ticket" ? command ? usage(parseTicketCommand(command.args)) : quotingError("ticket help for examples") : undefined
                    const parsedMilestone = name === "milestone" ? command ? usage(parseMilestoneCommand(command.args)) : quotingError("milestone help in private") : undefined
                    const parsedSuggestion = name === "suggest" ? command ? usage(parseSuggestionCommand(command.args)) : quotingError("suggest help") : undefined
                    const parsedCleanup = name === "cleanup" ? command ? usage(parseCleanupCommand(command.args)) : quotingError("cleanup help") : undefined
                    const parsedVoice = name === "voice" ? command ? usage(parseVoiceCommand(command.args)) : quotingError("voice help") : undefined
                    const parsedLfg = name === "lfg" ? command ? usage(parseLfgCommand(command.args)) : quotingError("lfg help") : undefined
                    const levelName = name === "level" || name === "rank" || name === "leaderboard" ? name : undefined
                    const eventName = name === "event" ? name : undefined
                    const parsedEvent = eventName ? command ? usage(parseEventCommand(command.args)) : quotingError("event help for examples") : undefined
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
                        const gateClass = metadataInvocation || name === "ticket" || name === "milestone" || name === "cleanup" ? "critical" : safetyName ? safetyGateClass(safetyName, parsedSafety!) : publishingCritical || roleCritical || levelCritical || parsedGreeting && greetingsCritical(parsedGreeting) || parsedEvent && eventCritical(parsedEvent) || parsedSuggestion && suggestionCritical(parsedSuggestion) || parsedRolePicker && rolePickerCritical(parsedRolePicker) || parsedTemporaryRole && temporaryRoleCritical(parsedTemporaryRole) || parsedOnboarding && onboardingCritical(parsedOnboarding) ? "critical"
                            : greetingName || roleName && !rolePublic || parsedRolePicker || parsedTemporaryRole || parsedOnboarding && !onboardingPublic(parsedOnboarding) || parsedShowcase && !showcasePublic(parsedShowcase) || parsedProfile && !profilePublic(parsedProfile) || name === "preset" || name === "sticky" || name === "sidebar" || name === "memberlist" || name === "alerts" || name === "invites" || name === "helpdesk" || name === "answer" || name === "escalate" || name === "custom" || name === "auto" || name === "publish" || levelName === "level" || parsedEvent && !eventPublic(parsedEvent) || parsedSuggestion && !("error" in parsedSuggestion) && !suggestionPublic(parsedSuggestion) || parsedVoice && !voicePublic(parsedVoice) || parsedLfg && lfgStaff(parsedLfg) ? "staff" : "public"
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
                    if (!privateInvocation && name === "help" && !protectionUnknown) {
                        yield* handleHelpCommand(config.serverId, prefix, helpMention ? mention![2] ? [mention![2]] : [] : command?.args ?? [], context)
                        return
                    }
                    if (!privateInvocation && (name === "health" || name === "setup") && !protectionUnknown) {
                        yield* (name === "health" ? handleHealthCommand : handleSetupCommand)(setup, config.serverId, prefix, context)
                        return
                    }
                    if (!privateInvocation && name === "recovery" && !protectionUnknown) {
                        yield* handleRecoveryCommand(setup, config.serverId, prefix, command?.args ?? ["invalid quoting"], context)
                        return
                    }
                    if (!privateInvocation && name === "stats" && !protectionUnknown) {
                        yield* handleStatsCommand(stores.analytics, analyticsWorker, config.serverId, command?.args ?? ["invalid quoting"], context)
                        return
                    }
                    if (!privateInvocation && name === "sticky" && !protectionUnknown) {
                        yield* handleStickyCommand(stores.sticky, stickyMessages, config, command?.args ?? ["invalid quoting"], context)
                        return
                    }
                    if (!privateInvocation && name === "sidebar" && !protectionUnknown) {
                        yield* handleSidebarCommand(stores.sidebar, config, command?.args ?? ["invalid quoting"], context)
                        return
                    }
                    if (!privateInvocation && parsedOnboarding && !protectionUnknown) {
                        yield* handleOnboardingCommand(stores.onboarding, onboarding, config, parsedOnboarding, context)
                        return
                    }
                    if (!privateInvocation && parsedShowcase && !protectionUnknown) {
                        yield* handleShowcaseCommand(stores.showcases, config, parsedShowcase, context)
                        return
                    }
                    if (!privateInvocation && parsedProfile && !protectionUnknown) {
                        yield* handleProfileCommand(stores.profiles, config, parsedProfile, context)
                        return
                    }
                    if (!privateInvocation && name === "preset" && !protectionUnknown) {
                        yield* handlePresetCommand(stores.presets, config, command ? usage(parsePresetCommand(command.args)) : quotingError("preset help"), context)
                        return
                    }
                    if (!privateInvocation && name === "memberlist" && !protectionUnknown) {
                        yield* handleMemberListCommand(stores.memberList, config, command?.args ?? ["invalid quoting"], context)
                        return
                    }
                    if (!privateInvocation && (name === "alerts" || name === "invites") && !protectionUnknown) {
                        yield* name === "alerts" ? handleAlertsCommand(stores.alerts, securityAlerts, config, command?.args ?? ["invalid quoting"], context)
                            : handleInvitesCommand(config, command?.args ?? ["invalid quoting"], context)
                        return
                    }
                    if (!privateInvocation && name && helpDeskCommands.includes(name) && !protectionUnknown) {
                        yield* handleHelpDeskInvocation(name, stores, helpDesk, config, command?.args ?? ["invalid quoting"], context)
                        return
                    }
                    if (!privateInvocation && parsedRolePicker && !protectionUnknown) {
                        yield* handleRolePickerCommand(stores.rolePicker, config, parsedRolePicker, context)
                        return
                    }
                    if (!privateInvocation && levelCredits && config.backend && commandBody === undefined && !helpMention) {
                        const candidate = levelCandidate(message, config.serverId, config.backend.secret)
                        if (candidate && (yield* optional("levels"))) yield* levelCredits.offer(candidate)
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
                        if (name === "temprole") {
                            yield* handleTemporaryRoleCommand(stores.temporaryRoles, roles, config, parsedTemporaryRole!, context)
                            return
                        }
                        if (name === "voice") {
                            if (voice && voiceRooms) yield* handleVoiceCommand(voice, voiceRooms, config, parsedVoice!, context)
                            else yield* reply({ content: "Voice room persistence is not configured", allowedMentions: noMentions })
                            return
                        }
                        if (name === "lfg") {
                            yield* handleLfgCommand(stores.lfg, voiceRooms, config, parsedLfg!, context)
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
                            else yield* handlePublishing(publishing, config, parsedPublishing!, context, schedules, scheduleWorker, events)
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
                        // Limited or paused response evaluation skips the hint too, since a custom command of that name may exist
                        const evaluated = responses ? yield* optional("responses") : true
                        const known = responses && evaluated ? yield* handleResponse(responses, config.serverId, context) : false
                        // An unknown command close to a built-in one gets one hint. Other text after the prefix stays unanswered, so chat stays quiet
                        const suggestion = evaluated && !known && name && !privateInvocation ? suggestCommand(name) : undefined
                        if (suggestion) yield* reply({ content: `Did you mean ${invocationPrefix}${suggestion}? Send ${invocationPrefix}help to list the commands you can use`, allowedMentions: noMentions })
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
                    if (analyticsWorker && (yield* optional("analytics"))) yield* analyticsWorker.join()
                    if (milestoneWorker) yield* milestoneWorker.notifyMember(context.event.userId)
                    const gate = moderation ? yield* moderation.gate({ serverId: config.serverId, actor: unprivilegedActor(context.event.userId), command: "public" }) : undefined
                    if (moderation && gate?.joinProtectionEnabled) yield* containProtection(handleProtectionJoin(moderation, config, context), undefined)
                    // After join protection, so an impersonation check's staff read never delays it
                    if (securityAlerts) yield* securityAlerts.memberAdd(context.event, context.client)
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
                    if (analyticsWorker && (yield* optional("analytics"))) yield* analyticsWorker.leave()
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
                    if (securityAlerts) yield* securityAlerts.memberUpdate(event, client)
                    // Milestones follow joins and leaves only. An update keeps the join time, and delivery rechecks membership
                    // A role change may finish the newcomer checklist. Protection already ran when the member joined, and the check never fails the handler
                    if (onboarding) yield* onboarding.memberUpdated(client, event)
                    if (greetings) yield* observeGreetingMembership(greetings, config.serverId, client, event.userId).pipe(Effect.andThen(wake(event.userId)))
                }),
            },
            messageDelete: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("messageDelete", event, client) ?? Effect.void },
            messageDeleteBulk: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("messageDeleteBulk", event, client) ?? Effect.void },
            // The roles, channels and threads the bot keeps for evaluation follow every event that changes them
            guildRoleCreate: { concurrency: 1, handler: ({ event, client }) => Effect.suspend(() => { rememberRole(client, event); return admitMetadata?.("guildRoleCreate", event, client) ?? Effect.void }) },
            guildRoleUpdate: { concurrency: 1, handler: ({ event, client }) => Effect.suspend(() => { rememberRole(client, event); return admitMetadata?.("guildRoleUpdate", event, client) ?? Effect.void }) },
            guildRoleDelete: { concurrency: 1, handler: ({ event, client }) => Effect.suspend(() => { forgetRole(client, event); return admitMetadata?.("guildRoleDelete", event, client) ?? Effect.void }) },
            guildRoleUpdateBulk: {
                concurrency: 1,
                handler: ({ event, client }) => Effect.suspend(() => {
                    for (const role of event.roles) rememberRole(client, role)
                    return admitMetadata?.("guildRoleUpdateBulk", event, client) ?? Effect.void
                }),
            },
            guildChannelCreate: { concurrency: 1, handler: ({ event, client }) => Effect.suspend(() => { rememberChannel(client, event); return Effect.andThen(structureChanged, admitMetadata?.("guildChannelCreate", event, client) ?? Effect.void) }) },
            guildChannelUpdate: { concurrency: 1, handler: ({ event, client }) => Effect.suspend(() => { updateChannel(client, event); return Effect.andThen(structureChanged, admitMetadata?.("guildChannelUpdate", event, client) ?? Effect.void) }) },
            guildChannelDelete: {
                concurrency: 1,
                handler: ({ event, client }) => Effect.gen(function* () {
                    // Fluxer deletes a channel's threads with it and sends no thread events for them
                    const threadIds = forgetChannel(client, event)
                    if (voiceRooms && event.guildId === config.serverId) yield* voiceRooms.channelDeleted(event.id)
                    yield* structureChanged
                    if (admitMetadata) {
                        yield* admitMetadata("guildChannelDelete", event, client)
                        if (threadIds.length) yield* admitMetadata("threadsDeletedWithParent", { guildId: event.guildId, id: event.id, threadIds }, client)
                    }
                }),
            },
            // Metadata logs record thread creation, changes and deletion
            threadCreate: {
                concurrency: 1,
                handler: ({ event, client }) => Effect.gen(function* () {
                    rememberChannel(client, event)
                    // A bot joining an existing thread is not a creation
                    if (admitMetadata && event.isNewlyCreated) yield* admitMetadata("threadCreate", event, client)
                    if (helpDesk) yield* helpDesk.threadCreated(event)
                }),
            },
            threadUpdate: {
                concurrency: 1,
                handler: ({ event, client }) => {
                    const previous = rememberChannel(client, event)
                    return admitMetadata?.("threadUpdate", event, client, previous) ?? Effect.void
                },
            },
            threadDelete: {
                concurrency: 1,
                handler: ({ event, client }) => {
                    forgetThread(client, event.id)
                    return admitMetadata?.("threadDelete", event, client) ?? Effect.void
                },
            },
            threadListSync: { concurrency: 1, handler: ({ event, client }) => Effect.sync(() => { for (const thread of event.threads) rememberChannel(client, thread) }) },
            voiceStateUpdate: { concurrency: 1, handler: ({ event }) => voiceRooms?.voiceState(event) ?? Effect.void },
            voiceStateSnapshot: { concurrency: 1, handler: ({ event }) => voiceRooms?.snapshot(event) ?? Effect.void },
            guildDelete: { concurrency: 1, handler: ({ event }) => voiceRooms && event.id === config.serverId ? voiceRooms.unavailable() : Effect.void },
            guildChannelUpdateBulk: { concurrency: 1, handler: ({ event, client }) => Effect.suspend(() => { forgetChannels(client, event.guildId); return Effect.andThen(structureChanged, admitMetadata?.("guildChannelUpdateBulk", event, client) ?? Effect.void) }) },
            guildUpdate: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("guildUpdate", event, client) ?? Effect.void },
            guildAuditLogEntryCreate: {
                concurrency: 1,
                handler: ({ event, client }) => Effect.gen(function* () {
                    if (admitMetadata) yield* admitMetadata("guildAuditLogEntryCreate", event, client)
                    if (securityAlerts && event.guildId === config.serverId) yield* securityAlerts.audit(event, client)
                }),
            },
            // Invite logs belong to security alerts, which keep the invite code out of every record
            inviteCreate: { concurrency: 1, handler: ({ event }) => securityAlerts?.inviteCreated(event) ?? Effect.void },
            inviteDelete: { concurrency: 1, handler: ({ event }) => securityAlerts?.inviteDeleted(event.channelId) ?? Effect.void },
            messageReactionAdd: {
                concurrency: 1,
                handler: ({ event, client }) => Effect.gen(function* () {
                    // A reaction on a message that is no panel needs no member or backend read
                    if (!roles || !(yield* panelIndex.mayBePanel(event.id))) return
                    if (verification && (yield* requestVerificationLink(verification, roles, config, client, event.userId, event))) return
                    yield* handleRoleReaction(roles, config.serverId, client, event, event.userId)
                }).pipe(Effect.mapError(() => new RoleHandlingError({ stage: "eligibility" }))),
            },
            messageReactionAddMany: {
                concurrency: 1,
                handler: ({ event, client }) => Effect.gen(function* () {
                    if (!roles || !(yield* panelIndex.mayBePanel(event.id))) return
                    for (const userId of new Set(event.reactions.map((reaction) => reaction.userId))) {
                        if (verification && (yield* requestVerificationLink(verification, roles, config, client, userId, event))) continue
                        yield* handleRoleReaction(roles, config.serverId, client, event, userId)
                    }
                }).pipe(Effect.mapError(() => new RoleHandlingError({ stage: "eligibility" }))),
            },
            messageReactionRemove: {
                concurrency: 1,
                handler: ({ event, client }) => Effect.gen(function* () {
                    if (!roles || !(yield* panelIndex.mayBePanel(event.id))) return
                    yield* handleRoleReaction(roles, config.serverId, client, event, event.userId)
                }).pipe(Effect.mapError(() => new RoleHandlingError({ stage: "eligibility" }))),
            },
            messageReactionRemoveAll: {
                concurrency: 1,
                handler: ({ event }) => Effect.gen(function* () {
                    if (event.guildId !== undefined && event.guildId !== config.serverId || !roleWorker || !(yield* panelIndex.mayBePanel(event.id))) return
                    yield* roleWorker.enqueue(event.id)
                }),
            },
            messageReactionRemoveEmoji: {
                concurrency: 1,
                handler: ({ event }) => Effect.gen(function* () {
                    if (event.guildId !== undefined && event.guildId !== config.serverId || !roleWorker || !(yield* panelIndex.mayBePanel(event.id))) return
                    yield* roleWorker.enqueue(event.id)
                }),
            },
        },
    } satisfies BotOptions<unknown>
    return { ...options, wake: (kind: ServiceWorkKind) => wakers[kind]?.() ?? Effect.void,
        intakeReply: (context: BotEventContext<"messageCreate">, intakeNo: number) => tickets
            ? handleTicketCommand(tickets, publishing, config, { type: "intake-reply", intakeNo, text: context.message.content.trim() }, context) : Effect.void,
        botMessages: {
            enabled: () => botChecks?.enabled() ?? false,
            handle: (event: "create" | "edit", message: Message, client: Client) => moderation ? containProtection(handleBotProtectionMessage(moderation, config, event, message, client), undefined) : Effect.void,
        } }
}
