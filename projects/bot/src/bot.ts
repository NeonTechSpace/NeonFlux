import {
    ChannelType,
    commands,
    MessageType,
    type BotOptions,
    type BotEventContext,
    type Client,
    type EventName,
    type Message,
    type Observation,
} from "@neontechspace/fluxerly/effect"
import { Cause, Context, Deferred, Effect, Exit, Redacted, Scope, Semaphore, Stream } from "effect"
import type { AfkStore } from "./afk-store.ts"
import { handleAfk } from "./afk.ts"
import type { BotConfig, BotRootConfig } from "./config.ts"
import { parseManagement } from "./response-command.ts"
import type { ResponseStore } from "./responses-store.ts"
import { handleManagement, handleResponse } from "./responses.ts"
import { notSetUp } from "./reply-style.ts"
import type { ModerationStore } from "./moderation-store.ts"
import { handleSafetyCommand, initializeModeration, moderationActor, applyDefconPresence } from "./moderation.ts"
import { parseSafetyCommand, safetyGateClass, safetyNames, type SafetyName } from "./moderation-command.ts"
import { readAuthenticatedBotId, readSafetyAuthority, verifyPrivateAuthor } from "./safety-permissions.ts"
import {
    admitMemberMessage,
    containProtection,
    handleBotProtectionMessage,
    handleProtectionJoin,
    trackModerationHints,
} from "./protections.ts"
import { moderationGate } from "@neonflux/contracts/moderation"
import type { ServiceDashboardWork, ServiceWorkKind } from "@neonflux/contracts/service"
import type { ModerationActor } from "@neonflux/contracts/shared"
import type { PublishingStore } from "./publishing-store.ts"
import { parsePublishingCommand } from "./publishing-command.ts"
import { handlePublishing } from "./publishing.ts"
import type { RolesStore } from "./roles-store.ts"
import type { RolesSettings } from "@neonflux/contracts/roles"
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
import { createMetadataGatewayAdmission, metadataRechecks } from "./metadata-log-events.ts"
import { startMetadataLogsWorker } from "./metadata-log-worker.ts"
import type { BackupStore } from "./backup-store.ts"
import { parseBackupCommand } from "./backup-command.ts"
import { forgetBackupLock, handleBackupCommand } from "./backup.ts"
import {
    configScope,
    createInstallationClient,
    createServerRuntime,
    ServerScopeError,
    type ServerRuntime,
} from "./server-runtime.ts"
import {
    selectServerCommand,
    serverCommands,
    serverLabel,
    serverReply,
    validServerId,
    type DeploymentScope,
} from "./server-scope.ts"
import {
    createPrefixReader,
    forgetPrefix,
    handleNicknameCommand,
    handlePrefixCommand,
    withPrefix,
    type GeneralSettingsStore,
} from "./general-settings.ts"
import { createVerificationStore, type VerificationStore } from "./verification-store.ts"
import {
    requestVerificationLink,
    reviewVerificationRequest,
    startVerificationWorker,
    verificationLinkFailure,
    verificationLinkReplies,
    verificationReviewFailure,
} from "./verification.ts"
import {
    createDashboardPanelPublisher,
    startDashboardRolesWorker,
    type DashboardPanelPublisher,
} from "./dashboard-roles.ts"
import { createPanelIndex } from "./role-panel-index.ts"
import type { AnalyticsStore } from "./analytics-store.ts"
import { startAnalyticsWorker } from "./analytics-worker.ts"
import { handleStatsCommand } from "./analytics-management.ts"
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
import {
    forgetShardThreads,
    forgetServerThreads,
    forgetThread,
    forgetThreadsOf,
    rememberThread,
} from "./thread-memory.ts"
import { createOptionalWork, limitAfk } from "./optional-work.ts"
import { createUsageGuard, startUsageReporter, type UsageGuard } from "./usage.ts"
import { handleHelpAll, handleHelpCommand, helpAllRequest, serverOnlyReply, suggestCommand } from "./help.ts"
import { handleHealthCommand, handleSetupCommand, processSetupCheckPass, type SetupStore } from "./setup-check.ts"
import { processPrivateAccessPass, type PrivateDataStore } from "./private-data.ts"
import { postInstallNote } from "./install-note.ts"
import { carryReceipt, nextReceipt, receiptOf, receiveEvent } from "./event-receipts.ts"
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
}

// Every gateway event a server runtime handles. Each is routed to exactly one runtime and never broadcast
const routedEvents = [
    "messageCreate",
    "messageUpdate",
    "guildMemberAdd",
    "guildMemberRemove",
    "guildMemberUpdate",
    "messageDelete",
    "messageDeleteBulk",
    "guildRoleCreate",
    "guildRoleUpdate",
    "guildRoleDelete",
    "guildRoleUpdateBulk",
    "guildChannelCreate",
    "guildChannelUpdate",
    "guildChannelDelete",
    "guildChannelUpdateBulk",
    "guildUpdate",
    "guildAuditLogEntryCreate",
    "messageReactionAdd",
    "messageReactionAddMany",
    "messageReactionRemove",
    "messageReactionRemoveAll",
    "messageReactionRemoveEmoji",
    "voiceStateUpdate",
    "voiceStateSnapshot",
    "guildDelete",
    "threadCreate",
    "threadUpdate",
    "threadDelete",
    "threadListSync",
    "inviteCreate",
    "inviteDelete",
] as const satisfies readonly EventName[]
// Events whose own ID is the server or the channel they describe, as the SDK's "guild" partition reads them
const guildSelfEvents: ReadonlySet<string> = new Set(["guildCreate", "guildUpdate", "guildDelete"])
const channelSelfEvents: ReadonlySet<string> = new Set([
    "guildChannelCreate",
    "guildChannelUpdate",
    "guildChannelDelete",
    "threadCreate",
    "threadUpdate",
    "threadDelete",
])
/**
 * The key the SDK's "guild" partition gives an event, which also numbers the event by its receipt. A function replaces
 * the built-in partition so the router can tell which events were received before a server's join, and the keys stay
 * the same
 */
function guildPartition(name: EventName) {
    return (event: object) => {
        const value = event as {
            id?: unknown
            guildId?: unknown
            channelId?: unknown
            threadId?: unknown
            guild?: { id?: unknown }
            channel?: { id?: unknown }
        }
        const guild =
            name === "inviteCreate"
                ? value.guild?.id
                : typeof value.guildId === "string"
                  ? value.guildId
                  : guildSelfEvents.has(name)
                    ? value.id
                    : undefined
        const channel =
            name === "inviteCreate"
                ? value.channel?.id
                : typeof value.channelId === "string"
                  ? value.channelId
                  : typeof value.threadId === "string"
                    ? value.threadId
                    : channelSelfEvents.has(name)
                      ? value.id
                      : undefined
        const key = guild ?? channel
        return receiveEvent(event, typeof key === "string" ? key : undefined)
    }
}
type ScopedBotOptions = ReturnType<typeof createScopedBotOptions>
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
// Compilation fails when a runtime handler is added without routing it, or the reverse
const routedEventsComplete: Same<keyof ScopedBotOptions["events"], (typeof routedEvents)[number]> = true
void routedEventsComplete

// Multi-mode sizing for a public bot. The technology guide explains these values
const MULTI_EVENT_CONCURRENCY = 8
// Waiting events of a routed event name, across all servers, before the busiest server, counting the arriving event, loses its oldest. Every server that has
// not started yet holds its events, including those waiting for one of the four start slots. In steady state it also bounds a slow
// backend's backlog per event name. The SDK's 4 MiB limit on waiting event JSON applies to each event name as well, and a message now
// carries its author's member, so about 2 KB per message reaches it first
const MULTI_EVENT_QUEUE = 2000
// The byte limit of the two events that GUILD_CREATE emits. The SDK counts each at the whole frame, 50 to 100 times what it retains, so the
// default 4 MiB would drop them at a restart, and 1 GiB of frames still bounds hostile input
const GUILD_FRAME_BYTES = 1073741824
const MULTI_REST = { concurrency: 6, mediaConcurrency: 2, maxQueued: 256, queuedJsonMaxBytes: 4194304 } as const
const RUNTIME_START_CONCURRENCY = 4
const GUILD_LIST_LIMIT = 100000
// The SDK caches that evaluation reads, kept current by gateway events and bounded across the whole client
const CACHE = {
    guilds: { maxEntries: 5000, maxBytes: 8388608 },
    members: { maxEntries: 20000, maxBytes: 16777216 },
    // The role limit counts the roles of every server together, and a server's role list is complete only while all of them fit
    roles: { maxEntries: 50000, maxBytes: 16777216 },
    channels: { maxEntries: 20000, maxBytes: 33554432 },
} as const

export function createBotOptions(options: BotRootConfig, stores: BotStores = {}) {
    // Every runtime's backend answers report the due times of work their writes create to the one dispatcher
    const notices = createWorkNotices()
    const config: BotRootConfig = options.backend
        ? { ...options, backend: { ...options.backend, onWorkDue: notices.report } }
        : options
    const scope = configScope(config)
    const multi = scope.mode === "multi"
    // Usage reports set it, and every runtime's optional work follows it
    const guard = createUsageGuard()
    const runtimes = createRuntimeRegistry(config, scope, stores, guard)
    // Waits for a runtime that is still starting, then says whether it still serves its server as the registry's current entry
    const serving = (entry: RuntimeEntry) =>
        Deferred.await(entry.ready).pipe(
            Effect.map(() => entry.runtime.active() && runtimes.get(entry.runtime.config.serverId) === entry),
        )
    // Single mode always names its configured server. Multi mode serves the servers registered now
    const served = (serverId: string) =>
        scope.mode === "single" ? serverId === scope.serverIds[0] : runtimes.has(serverId)
    const revisions = createMessageRevisions()
    // Finds the open intake a plain DM answers. The lookup binds no server, so it uses the root backend configuration
    const intakes =
        scope.mode === "single" && stores.tickets
            ? stores.tickets
            : config.backend
              ? createTicketStore(config.backend)
              : undefined
    const memberData = stores.memberData ?? (config.backend ? createMemberDataStore(config.backend) : undefined)
    const events: NonNullable<BotOptions<unknown>["events"]> = {}
    const serverEvent = { concurrency: multi ? MULTI_EVENT_CONCURRENCY : 1 }
    for (const name of routedEvents) {
        const handler = (context: BotEventContext<EventName>) => {
            const work = Effect.gen(function* () {
                const payload = context.event as unknown as {
                    guildId?: string
                    channelId?: string
                    id?: string
                    content?: string
                    channelType?: number
                    guild?: { id: string }
                }
                // A new invite names its server in guild
                let guildId =
                    payload.guildId ??
                    (name === "guildUpdate" || name === "guildDelete"
                        ? payload.id
                        : name === "inviteCreate"
                          ? payload.guild?.id
                          : undefined)
                // An event waits for the joins of its server that were received before it, whether or not the server is
                // served yet, so it never reaches a runtime that a pending join is about to replace or retire
                const receipt = receiptOf(context.event)
                if (guildId !== undefined) {
                    yield* runtimes.joinedBefore(guildId, receipt)
                    if (!served(guildId)) return
                }
                // Webhook and other bots' messages reach automod only in a server that checks them, so they cost nothing while it is off.
                // Other handlers skip bots' messages. A webhook's edits that Fluxer does not mark as a bot's still reach metadata logs
                const posted =
                    name === "messageCreate"
                        ? (context as BotEventContext<"messageCreate">).message
                        : name === "messageUpdate"
                          ? (context as BotEventContext<"messageUpdate">).event
                          : undefined
                const checker =
                    posted &&
                    (posted.author.isBot || posted.webhookId) &&
                    !posted.author.isSystem &&
                    (posted.type === MessageType.Default || posted.type === MessageType.Reply) &&
                    guildId !== undefined
                        ? runtimes.get(guildId, receipt)
                        : undefined
                // A runtime still starting has not loaded whether it checks bot messages, so the check waits for its setup
                const checked =
                    checker && (yield* serving(checker)) && checker.options.botMessages.enabled() ? checker : undefined
                if (posted?.author.isBot && !checked) return
                // A link preview or another embed-only update changes nothing a feature reads
                if (name === "messageUpdate" && !revisions.changed((context as BotEventContext<"messageUpdate">).event))
                    return
                if (posted && checked) {
                    if (name === "messageCreate") revisions.created(posted)
                    yield* checked.options.botMessages.handle(
                        name === "messageCreate" ? "create" : "edit",
                        posted,
                        context.client,
                    )
                    if (name === "messageCreate" || posted.author.isBot) return
                }
                let selected: ReturnType<typeof selectServerCommand>
                if (name === "messageCreate") {
                    const messageContext = context as BotEventContext<"messageCreate">
                    if (
                        messageContext.message.author.isSystem ||
                        messageContext.message.webhookId ||
                        (messageContext.message.type !== MessageType.Default &&
                            messageContext.message.type !== MessageType.Reply)
                    )
                        return
                    revisions.created(messageContext.message)
                    // Selector validation precedes private reads and feature admission
                    selected = selectServerCommand(messageContext.message.content, scope, served, guildId)
                    if (
                        selected &&
                        "error" in selected &&
                        (guildId !== undefined || /^\s*!\S+\s+--server(?:\s|$)/.test(messageContext.message.content))
                    ) {
                        yield* messageContext.reply({ content: selected.error })
                        return
                    }
                }
                // A message event reports its channel's type. A DM (1) needs no channel read and a group DM (3) is
                // ignored. Any other event and a message without a type read the channel
                const channelType = name === "messageCreate" ? payload.channelType : undefined
                if (guildId === undefined && channelType === 3) return
                if (guildId === undefined && payload.channelId && channelType !== 1) {
                    const response = yield* context.client.rest
                        .request({ method: "GET", path: `/channels/${payload.channelId}`, timeoutMs: 5000 })
                        .pipe(Effect.catch(() => Effect.succeed(undefined)))
                    const channel =
                        response?.status === 200 &&
                        response.body !== null &&
                        typeof response.body === "object" &&
                        !Array.isArray(response.body)
                            ? (response.body as Record<string, unknown>)
                            : undefined
                    if (!channel || channel.id !== payload.channelId) return
                    if (channel.guild_id !== undefined) {
                        if (!validServerId(channel.guild_id)) return
                        // The channel read names the server, so the joins of it received before this message are
                        // awaited here
                        yield* runtimes.joinedBefore(channel.guild_id, receipt)
                        if (!served(channel.guild_id) || ![0, 2, 4, 5, 10, 11, 12].includes(channel.type as number))
                            return
                        guildId = channel.guild_id
                    } else if (name !== "messageCreate" || channel.type !== 1) return
                }
                // A member's own data spans every server, so !mydata in a DM selects none
                if (name === "messageCreate" && guildId === undefined && isMemberDataCommand(payload.content ?? ""))
                    return yield* handleMemberDataCommand(memberData, context as BotEventContext<"messageCreate">)
                let intakeNo: number | undefined
                if (name === "messageCreate") {
                    const messageContext = context as BotEventContext<"messageCreate">
                    selected = selectServerCommand(payload.content ?? "", scope, served, guildId)
                    if (selected && "error" in selected) {
                        yield* messageContext.reply({ content: selected.error })
                        return
                    }
                    // A plain DM answers the member's one open ticket intake, and is ignored when there is none
                    if (!selected && guildId === undefined && intakes) {
                        const open = yield* findTicketIntake(intakes, messageContext, served, scope)
                        if (open) {
                            selected = { serverId: open.serverId, content: messageContext.message.content }
                            intakeNo = open.intakeNo
                        }
                    }
                    if (!selected) return
                }
                const serverId = selected && !("error" in selected) ? selected.serverId : guildId
                if (!serverId) return
                // An event of a server is run only by a runtime registered before it was received, so one held for a
                // runtime that was removed never reaches the replacement. A DM names its server by a selector and
                // holds nothing, so it goes to the server's current runtime
                const runtime = runtimes.get(serverId, guildId === undefined ? undefined : receipt)
                if (!runtime) return
                const event = guildId && payload.guildId === undefined ? { ...context.event, guildId } : context.event
                carryReceipt(context.event, event)
                let routed = { ...context, event }
                if (name === "messageCreate") {
                    const original = context as BotEventContext<"messageCreate">
                    const message = {
                        ...original.message,
                        ...(guildId ? { guildId } : {}),
                        content: selected && !("error" in selected) ? selected.content : original.message.content,
                    }
                    // A private reply in multi mode names its server. Fluxerly sends no mention notifications unless the input names them
                    const reply: typeof original.reply = (input, settings) =>
                        Effect.gen(function* () {
                            const body = typeof input === "string" ? { content: input } : input
                            return yield* original.reply(
                                multi && !guildId
                                    ? serverReply(body, yield* serverLabel(original.client, serverId))
                                    : body,
                                settings,
                            )
                        })
                    routed = { ...routed, event: message, message, reply } as typeof routed
                }
                const answered = intakeNo
                const invoke = (
                    answered === undefined
                        ? runtime.options.events[name].handler
                        : (value: BotEventContext<"messageCreate">) => runtime.options.intakeReply(value, answered)
                ) as (value: BotEventContext<EventName>) => Effect.Effect<unknown, unknown>
                // The SDK holds events keyed by their server until its runtime has started, with no handler slot. It
                // keeps a key ready while that key has running or queued events, so an event can skip that hold, and
                // then it waits only for the joins of its server received before it, as above. A DM is keyed by its
                // channel and never waits for a join or a start, since it would keep a shared handler slot: A DM that
                // names a server gets the selector's answer, or the reply that the server is still starting. A message
                // without a server ID is placed by a channel read, which awaits the joins as well, and waits here for
                // the start. A retired or replaced runtime ignores the event. An unavailable notice never waits for a
                // start, since it only marks voice rooms unsynced, which holds before setup too, and the voice tracker
                // ignores the snapshots received before it
                if (name !== "guildDelete") {
                    if (!Deferred.isDoneUnsafe(runtime.ready) && name === "messageCreate" && guildId === undefined) {
                        yield* (routed as BotEventContext<"messageCreate">).reply({
                            content: "This server is still starting. Try again in a moment",
                        })
                        return
                    }
                    if (!(yield* serving(runtime))) return
                }
                yield* invoke(routed)
            })
            return work
        }
        Object.assign(events, {
            [name]: {
                ...serverEvent,
                ...(multi ? { partitionReady: runtimes.ready, maxPendingMessages: MULTI_EVENT_QUEUE } : {}),
                // The voice tracker orders by receipt in single mode too, so these events keep their receipt there
                ...(multi || name === "voiceStateSnapshot" || name === "voiceStateUpdate"
                    ? { partition: guildPartition(name) }
                    : {}),
                ...(name === "voiceStateSnapshot" ? { maxPendingBytes: GUILD_FRAME_BYTES } : {}),
                handler,
            },
        })
    }
    // The routed guildDelete tells a temporarily unavailable server's runtime about the outage
    const routedDelete = (
        events.guildDelete as { handler: (context: BotEventContext<"guildDelete">) => Effect.Effect<unknown, unknown> }
    ).handler
    // A server that becomes available or unavailable may have changed unseen, so the threads kept for it are forgotten
    Object.assign(events, {
        // Startup hydration, recovery and Resume repeat guildCreate, so multi-mode registration is idempotent
        guildCreate: {
            ...serverEvent,
            maxPendingBytes: GUILD_FRAME_BYTES,
            // Runs when the event is received, before the same frame's voice snapshot is offered, so that snapshot and
            // every later event of the server wait for the join instead of being ignored as unserved. It also starts
            // the join, so a full queue or a busy handler slot can neither lose nor delay it. The frame limit above
            // keeps a large frame from being dropped before this runs
            ...(multi
                ? {
                      partition: (event: { readonly id: string }) => {
                          const key = guildPartition("guildCreate")(event)
                          runtimes.joining(event)
                          return key
                      },
                      maxPendingMessages: MULTI_EVENT_QUEUE,
                  }
                : {}),
            handler: ({ event, client }: BotEventContext<"guildCreate">) =>
                Effect.sync(() => forgetServerThreads(client, event.id)),
        },
        // A temporarily unavailable server keeps its runtime. Any other deletion in multi mode means the bot no longer sees the server
        guildDelete: {
            ...serverEvent,
            // A removal is started when received, like a join, so the registry applies it in receipt order with the
            // joins of its server
            partition: (event: { readonly id: string; readonly unavailable?: boolean }) => {
                const key = guildPartition("guildDelete")(event)
                if (multi && !event.unavailable) runtimes.leaving(event)
                return key
            },
            // A server still joining holds its outage notices, without a handler slot, until its join is decided. A
            // notice then reaches the runtime that is starting, whose voice tracker orders it against the snapshots
            // by receipt
            ...(multi ? { partitionReady: runtimes.joined } : {}),
            handler: (context: BotEventContext<"guildDelete">) =>
                Effect.suspend(() => {
                    forgetServerThreads(context.client, context.event.id)
                    return multi && !context.event.unavailable ? Effect.void : routedDelete(context)
                }),
        },
    })
    let connected: Client | undefined
    // Every handler is registered before the gateway connects, so automatic filtering asks Fluxer not to send the other
    // dispatch types, such as typing and presence updates
    // Bot-authored messages reach the router, which passes on only those a server's automod checks
    return {
        token: Redacted.value(config.token),
        processSignals: true,
        ignoreBots: false,
        ...(multi ? { sharding: "auto" as const, rest: MULTI_REST } : {}),
        events,
        cache: CACHE,
        observe: (observation: Observation) => {
            observeCosts(observation)
            // A lost connection can miss events that a new session does not replay
            if (observation.type === "reconnect" && connected) forgetShardThreads(connected, observation.shardId)
        },
        gateway: { ignoredEvents: "auto" as const },
        setup: (client: Client) =>
            Effect.gen(function* () {
                connected = client
                yield* startCostSummary(client)
                // The first usage report answers the bill guard's state while the runtimes start
                if (config.backend) yield* startUsageReporter(config.backend, guard)
                yield* runtimes.start(client, yield* Effect.scope)
                // One dispatcher serves every runtime in both modes, so a server without due work causes no backend requests
                if (config.backend) yield* startWorkDispatcher(config.backend, runtimes.wake, notices)
            }),
    } satisfies BotOptions<unknown>
}

/**
 * A received join or permanent removal of a server that is not yet decided. The registry applies the changes of one
 * server in receipt order. The router follows it for joins: events received after a join wait for it, and those
 * received before do not. The SDK hold for a key waits for every pending join of the server
 */
interface PendingChange {
    readonly kind: "join" | "leave"
    readonly receipt: number
    /**
     * For a join, the receipt from which the runtime it registers serves events. It is that of the first join of the
     * pending joins it follows, so events held across a failed registration and its retry are still served. A removal
     * does not use it
     */
    readonly since: number
    readonly decided: Deferred.Deferred<void>
}

interface RuntimeEntry {
    readonly runtime: ServerRuntime
    readonly options: ScopedBotOptions
    /** Done once setup has finished or the runtime is retired, which releases the server's held events */
    readonly ready: Deferred.Deferred<void>
    /** Events received before this receipt belong to an earlier runtime of the server, which this one does not serve */
    readonly since: number
    started: boolean
    /** Set when the backend registration started a new installation, until the install note is posted */
    welcome?: boolean
    scope?: Scope.Closeable
}

// Server runtimes by ID. Single mode serves its configured server. Multi mode serves the servers the bot is in and retires those it leaves
function createRuntimeRegistry(root: BotRootConfig, scope: DeploymentScope, stores: BotStores, guard: UsageGuard) {
    const entries = new Map<string, RuntimeEntry>()
    // Every backend join and leave passes through this one queue, so a registration and a removal never race. Its
    // waiters are not served in arrival order, so the order within one server comes from the pending changes
    const queue = Semaphore.makeUnsafe(1)
    const startPermits = Semaphore.makeUnsafe(RUNTIME_START_CONCURRENCY)
    // The joins and removals of each server that were received and are not yet decided
    const changes = new Map<string, PendingChange[]>()
    const mark = (serverId: string, kind: PendingChange["kind"], receipt: number) => {
        // A session check numbers its removals as of when it began, so a change can be marked behind a later one
        const list = changes.get(serverId) ?? [],
            index = list.findLastIndex((other) => other.receipt <= receipt) + 1,
            last = list[index - 1]
        const change: PendingChange = {
            kind,
            receipt,
            since: kind === "join" && last?.kind === "join" ? last.since : receipt,
            decided: Deferred.makeUnsafe<void>(),
        }
        changes.set(serverId, list.toSpliced(index, 0, change))
        return change
    }
    const decide = (serverId: string, change: PendingChange) => {
        const rest = (changes.get(serverId) ?? []).filter((other) => other !== change)
        if (rest.length > 0) changes.set(serverId, rest)
        else changes.delete(serverId)
        Deferred.doneUnsafe(change.decided, Effect.void)
    }
    // The pending changes of a server received before a receipt number, or all of them, of one kind or of both
    const waiting = (serverId: string, kind?: PendingChange["kind"], before = Number.POSITIVE_INFINITY) =>
        (changes.get(serverId) ?? []).filter(
            (change) => change.receipt < before && (kind === undefined || change.kind === kind),
        )
    const decisions = (list: readonly PendingChange[]) =>
        Effect.forEach(list, (change) => Deferred.await(change.decided), { discard: true })
    // Runs a change's work after the earlier changes of its server are decided. Whatever the work does, even when it
    // fails or is interrupted, the changes and events waiting for it go on
    const apply = <A, E>(serverId: string, change: PendingChange, work: Effect.Effect<A, E>) =>
        Effect.suspend(() => decisions(waiting(serverId, undefined, change.receipt))).pipe(
            Effect.andThen(queue.withPermit(work)),
            Effect.ensuring(Effect.sync(() => decide(serverId, change))),
        )
    const installations = scope.mode === "multi" && root.backend ? createInstallationClient(root.backend) : undefined
    // The receipt of each server's latest guildCreate, which proves the server is still there
    const created = new Map<string, number>()
    let lifetime:
        { readonly client: Client; readonly scope: Scope.Scope; readonly context: Context.Context<never> } | undefined

    function register(serverId: string, since = 0) {
        const existing = entries.get(serverId)
        if (existing) return existing
        const runtime = createServerRuntime(root, serverId, () => retire(entry))
        const injected = Object.fromEntries(Object.entries(stores).filter(([, store]) => store !== undefined))
        const entry: RuntimeEntry = {
            runtime,
            options: createScopedBotOptions(
                runtime.config,
                scope.mode === "single" ? { ...runtime.adapters, ...injected } : (runtime.adapters ?? {}),
                guard.paused,
            ),
            ready: Deferred.makeUnsafe<void>(),
            since,
            started: false,
        }
        entries.set(serverId, entry)
        return entry
    }
    // Retiring stops the runtime's backend requests, workers and event routing. Its stored data stays in the backend
    function retire(entry: RuntimeEntry) {
        const serverId = entry.runtime.config.serverId,
            runtimeScope = entry.scope,
            client = lifetime?.client
        if (entries.get(serverId) === entry) entries.delete(serverId)
        entry.runtime.deactivate()
        Deferred.doneUnsafe(entry.ready, Effect.void)
        if (runtimeScope)
            Effect.runFork(
                Scope.close(runtimeScope, Exit.void).pipe(
                    Effect.andThen(client ? applyDefconPresence(client, entry.runtime.config, undefined) : Effect.void),
                    Effect.catchCause(() => Effect.void),
                ),
            )
    }
    // Setup runs in the server's own scope. Single mode stops on a setup failure, while multi mode keeps serving that server
    const start = (entry: RuntimeEntry) =>
        Effect.gen(function* () {
            if (entry.started || !entry.runtime.active() || !lifetime) return
            const { client, scope: rootScope } = lifetime
            entry.started = true
            const runtimeScope = yield* Scope.fork(rootScope)
            entry.scope = runtimeScope
            // Every start, at startup or on a later join, shares one process budget, so many servers never start against the backend at once
            const exit = yield* Effect.exit(
                startPermits.withPermit(Scope.provide(entry.options.setup(client), runtimeScope)),
            )
            if (Exit.isFailure(exit)) {
                if (Cause.hasInterrupts(exit.cause) || scope.mode === "single")
                    return yield* Effect.failCause(exit.cause)
                yield* Effect.logWarning(`Server ${entry.runtime.config.serverId} startup recovery paused`)
            }
            yield* Deferred.succeed(entry.ready, undefined)
            if (entry.welcome && entry.runtime.active()) {
                entry.welcome = false
                const serverId = entry.runtime.config.serverId
                const prefix = entry.runtime.adapters
                    ? entry.runtime.adapters.general.get().pipe(
                          Effect.map((settings) => settings.prefix),
                          Effect.catch(() => Effect.succeed("!")),
                      )
                    : Effect.succeed("!")
                yield* prefix.pipe(
                    Effect.flatMap((value) => postInstallNote(client, serverId, value, root.websiteUrl)),
                    Effect.catch(() => Effect.logWarning(`Server ${serverId} install note could not be posted`)),
                    Effect.forkIn(runtimeScope),
                )
            }
        })
    // Runs inside the queue. A server the backend could not register is retired until it becomes available again
    const registerWithBackend = (entry: RuntimeEntry) =>
        Effect.suspend(() => {
            const serverId = entry.runtime.config.serverId
            if (!installations || entries.get(serverId) !== entry || !entry.runtime.active())
                return Effect.succeed(false)
            return installations.join(serverId).pipe(
                Effect.map((welcome) => {
                    entry.welcome = welcome
                    return true
                }),
                Effect.catch(() =>
                    Effect.sync(() => retire(entry)).pipe(
                        Effect.andThen(
                            Effect.logWarning(
                                `Server ${serverId} could not be registered. Registration is retried when the server becomes available again`,
                            ),
                        ),
                        Effect.as(false),
                    ),
                ),
            )
        })
    // Runs inside the queue
    const remove = (serverId: string) =>
        Effect.gen(function* () {
            const entry = entries.get(serverId)
            if (entry) retire(entry)
            if (installations)
                yield* installations
                    .leave(serverId)
                    .pipe(
                        Effect.catch(() =>
                            Effect.logWarning(
                                `Server ${serverId} removal could not be recorded. The next startup records it`,
                            ),
                        ),
                    )
        })
    // The servers the backend has installed and the servers Fluxer lists for the bot, with the installed ones that
    // Fluxer no longer lists
    const survey = (client: Client) =>
        Effect.gen(function* () {
            const installed = yield* installations!.list
            const guildIds: string[] = []
            yield* client.guilds.iterate({ maxItems: GUILD_LIST_LIMIT, maxPages: GUILD_LIST_LIMIT / 200 + 1 }).pipe(
                Stream.runForEach((guild) =>
                    Effect.sync(() => {
                        guildIds.push(guild.id)
                    }),
                ),
            )
            const present = new Set(guildIds),
                last = guildIds.at(-1),
                complete = guildIds.length < GUILD_LIST_LIMIT
            // A truncated guild list cannot prove absence beyond its last server
            const stale = [...installed].filter(
                (serverId) =>
                    !present.has(serverId) && (complete || (last !== undefined && BigInt(serverId) < BigInt(last))),
            )
            return { installed, guildIds, stale }
        })
    const reconcile = (client: Client, rootScope: Scope.Scope) =>
        Effect.gen(function* () {
            if (!installations) return
            const { installed, guildIds, stale } = yield* survey(client)
            // Current servers register before the gateway connects, so their events are held for their runtimes instead of being dropped
            // A server added while the bot was offline is registered below, and its events wait for that to be decided
            const current = guildIds.map((serverId) => {
                const missing = !installed.has(serverId)
                return { entry: register(serverId), missing, pending: missing ? mark(serverId, "join", 0) : undefined }
            })
            yield* Effect.gen(function* () {
                for (const serverId of stale)
                    yield* queue.withPermit(
                        Effect.suspend(() => (entries.has(serverId) ? Effect.void : remove(serverId))),
                    )
                // Bounded concurrency staggers runtime setup, so a large bot does not start every server against the backend at once
                yield* Effect.forEach(
                    current,
                    ({ entry, missing, pending }) =>
                        (missing
                            ? queue.withPermit(registerWithBackend(entry)).pipe(
                                  Effect.ensuring(
                                      Effect.sync(() => {
                                          if (pending) decide(entry.runtime.config.serverId, pending)
                                      }),
                                  ),
                              )
                            : Effect.succeed(true)
                        ).pipe(
                            Effect.flatMap((registered) => (registered ? start(entry) : Effect.void)),
                            Effect.catchCause((cause) =>
                                Cause.hasInterrupts(cause)
                                    ? Effect.failCause(cause)
                                    : Effect.logWarning(`Server ${entry.runtime.config.serverId} could not start`),
                            ),
                        ),
                    { concurrency: RUNTIME_START_CONCURRENCY, discard: true },
                )
            }).pipe(Effect.forkIn(rootScope))
        }).pipe(
            Effect.mapError(
                () =>
                    new ServerScopeError({
                        message:
                            "Server registrations could not be read from the backend or Fluxer. Check both and restart",
                    }),
            ),
        )
    // The partitionReady hook. A starting server's events wait in the SDK's queue until its runtime has started or been
    // retired, and a key that is no server runtime, such as a DM channel or a retired server, is ready at once so the
    // router ignores its events. A server whose join was received holds its events until its registration is decided,
    // even before the queue reaches it, then until its runtime has started
    const ready = (serverId: string): Effect.Effect<void> =>
        Effect.suspend(() => {
            const joins = waiting(serverId, "join")
            if (joins.length > 0) return decisions(joins).pipe(Effect.andThen(() => ready(serverId)))
            const entry = entries.get(serverId)
            return entry ? Deferred.await(entry.ready) : Effect.void
        })
    // Counts a received change and starts its work in the registry's lifetime instead of in an SDK handler, so a busy
    // handler slot or a full event queue can neither delay nor lose it. Nothing is received before start sets the
    // lifetime, because the gateway connects after the setup
    const launch = (
        serverId: string,
        kind: PendingChange["kind"],
        receipt: number,
        work: (change: PendingChange) => Effect.Effect<unknown, unknown>,
    ) => {
        if (!lifetime) return
        Effect.runForkWith(lifetime.context)(
            work(mark(serverId, kind, receipt)).pipe(
                Effect.catchCause((cause) =>
                    Cause.hasInterrupts(cause)
                        ? Effect.failCause(cause)
                        : Effect.logWarning(`Server ${serverId} ${kind} could not be applied`),
                ),
                Effect.forkIn(lifetime.scope),
            ),
        )
    }
    // A server the bot is not serving yet is registered with the backend before its runtime starts
    const join = (serverId: string) => (change: PendingChange) =>
        apply(
            serverId,
            change,
            Effect.suspend(() => {
                if (entries.has(serverId)) return Effect.succeed(undefined)
                const entry = register(serverId, change.since)
                return registerWithBackend(entry).pipe(Effect.map((registered) => (registered ? entry : undefined)))
            }),
        ).pipe(Effect.flatMap((entry) => (entry ? start(entry) : Effect.void)))
    // A server removed while a shard was disconnected sends no guildDelete when the shard returns with a new session,
    // so each new session checks the installed servers against Fluxer's list once. Each missing server is removed as of
    // the receipt at which the check began, unless a guildCreate of it was received after that, which the list may not
    // show yet
    const sweep = (client: Client) =>
        Effect.gen(function* () {
            if (!installations) return
            const started = nextReceipt()
            const { stale } = yield* survey(client)
            for (const serverId of stale)
                launch(serverId, "leave", started, (change) =>
                    apply(
                        serverId,
                        change,
                        Effect.suspend(() => ((created.get(serverId) ?? 0) > started ? Effect.void : remove(serverId))),
                    ),
                )
        }).pipe(
            Effect.catchCause((cause) =>
                Cause.hasInterrupts(cause)
                    ? Effect.failCause(cause)
                    : Effect.logWarning(
                          "Removed servers could not be checked after a new session. The next startup records them",
                      ),
            ),
        )
    // A resume keeps a shard's session epoch and replays what it missed, so only a changed epoch starts a check. The
    // first connection is the startup's. States that arrive during a check keep only the newest, so checks never
    // overlap and a session that began meanwhile gets the next one
    const watchSessions = (client: Client) =>
        Effect.suspend(() => {
            const epochs = new Map<number, number>()
            return client.observeState().pipe(
                Stream.filter((state) => state === "Connected"),
                Stream.runForEach(() =>
                    Effect.suspend(() => {
                        const renewed =
                            epochs.size > 0 &&
                            client.shards.some((shard) => epochs.get(shard.shardId) !== shard.sessionEpoch)
                        for (const shard of client.shards) epochs.set(shard.shardId, shard.sessionEpoch)
                        return renewed ? sweep(client) : Effect.void
                    }),
                ),
            )
        })
    return {
        has: (serverId: string) => entries.has(serverId),
        // The server's runtime, unless it was registered after the receipt number, which is how an event is bound to
        // the runtime lifetime it was received under
        get: (serverId: string, receipt = Number.POSITIVE_INFINITY) => {
            const entry = entries.get(serverId)
            return entry && receipt >= entry.since ? entry : undefined
        },
        ready,
        // Ends at once unless a join of this server was received and is not yet decided
        joined: (serverId: string) => Effect.suspend(() => decisions(waiting(serverId, "join"))),
        // The same for the joins received before a receipt number, which is how an event that the SDK did not hold
        // waits
        joinedBefore: (serverId: string, receipt: number) =>
            Effect.suspend(() => decisions(waiting(serverId, "join", receipt))),
        // Called when a server's join is received, which is when its events start to arrive. A server with no runtime
        // yet is counted, and so is one announced again while a change of it is pending, because the first
        // registration can fail and the second must then decide, and a removal ahead of it must run first. A join of a
        // server that is served and has no pending change is a repeat and changes nothing
        joining: (event: { readonly id: string }) => {
            const serverId = event.id
            if (!validServerId(serverId)) return
            created.set(serverId, receiptOf(event))
            if (changes.has(serverId) || !entries.has(serverId))
                launch(serverId, "join", receiptOf(event), join(serverId))
        },
        // Called when a server's permanent removal is received, so the joins received after it run after it
        leaving: (event: { readonly id: string }) => {
            if (validServerId(event.id))
                launch(event.id, "leave", receiptOf(event), (change) => apply(event.id, change, remove(event.id)))
        },
        start: (client: Client, rootScope: Scope.Scope) =>
            Effect.gen(function* () {
                lifetime = { client, scope: rootScope, context: yield* Effect.context<never>() }
                // A change that was cut short, because the bot stopped, must not leave its server's events or later
                // changes waiting
                yield* Scope.addFinalizer(
                    rootScope,
                    Effect.sync(() => {
                        for (const pending of changes.values())
                            for (const change of pending) Deferred.doneUnsafe(change.decided, Effect.void)
                        changes.clear()
                    }),
                )
                if (scope.mode === "single") return yield* start(register(scope.serverIds[0]!))
                // The shared presence shows only the configured status, so no single server's state changes it
                yield* applyDefconPresence(client, root, undefined)
                yield* reconcile(client, rootScope)
                yield* watchSessions(client).pipe(Effect.forkIn(rootScope, { startImmediately: true }))
            }),
        // Retiring removes a runtime from the registry before its scope closes, so the dispatcher never wakes a retired runtime
        wake: (serverId: string, kind: ServiceWorkKind, passes?: readonly ServiceDashboardWork[]) => {
            const entry = entries.get(serverId)
            if (!entry?.runtime.active()) return Effect.void
            if (Deferred.isDoneUnsafe(entry.ready) || !lifetime) return entry.options.wake(kind, passes)
            // A starting server has not made its workers yet, so its wake waits for setup without holding the dispatcher
            return Deferred.await(entry.ready).pipe(
                Effect.andThen(
                    Effect.suspend(() => (entry.runtime.active() ? entry.options.wake(kind, passes) : Effect.void)),
                ),
                Effect.forkIn(lifetime.scope),
                Effect.asVoid,
            )
        },
    }
}

function createScopedBotOptions(config: BotConfig, stores: BotStores, paused: () => boolean) {
    // Optional per-message work has per-server limits and stops while the bill guard pauses it
    const optional = createOptionalWork(paused)
    const store = stores.afk && limitAfk(stores.afk, optional)
    const tracked = stores.moderation && trackModerationHints(stores.moderation),
        moderation = tracked?.store,
        moderationHints = tracked?.hints
    const {
        responses,
        publishing,
        greetings,
        tickets,
        leveling: levels,
        events,
        schedules,
        milestones,
        suggestions,
        cleanup,
        metadata,
        backup: backups,
        general,
        voice,
        setup,
    } = stores
    const voiceRooms = voice ? createVoiceRuntime(voice, config.serverId) : undefined
    const stickyMessages = stores.sticky
        ? createStickyRuntime(stores.sticky, config.serverId, optional("sticky"))
        : undefined
    const helpDesk = stores.helpDesk
        ? createHelpDeskRuntime(stores.helpDesk, config.serverId, optional("helpdesk"))
        : undefined
    const verification =
        stores.verification ??
        (config.backend && config.websiteUrl ? createVerificationStore(config.backend) : undefined)
    const readPrefix = createPrefixReader(general, config.serverId)
    let metadataWorker: Effect.Success<ReturnType<typeof startMetadataLogsWorker>> | undefined
    let analyticsWorker: Effect.Success<ReturnType<typeof startAnalyticsWorker>> | undefined
    const admitMetadata = metadata
        ? createMetadataGatewayAdmission(metadata, config.serverId, () => metadataWorker?.notify() ?? Effect.void)
        : undefined
    // Security alerts check in-memory settings on each event and reach staff through metadata logs
    const securityAlerts =
        stores.alerts && metadata
            ? createSecurityAlerts(
                  stores.alerts,
                  metadata,
                  config.serverId,
                  () => metadataWorker?.notify() ?? Effect.void,
              )
            : undefined
    let cleanupWorker: Effect.Success<ReturnType<typeof startCleanupWorker>> | undefined
    let suggestionWorker: Effect.Success<ReturnType<typeof startSuggestionsWorker>> | undefined
    let milestoneWorker: Effect.Success<ReturnType<typeof startMilestonesWorker>> | undefined
    let scheduleWorker: Effect.Success<ReturnType<typeof startSchedulesWorker>> | undefined
    let eventWorker: Effect.Success<ReturnType<typeof startEventsWorker>> | undefined
    let levelCredits: Effect.Success<ReturnType<typeof startLevelCreditWorker>> | undefined
    let levelRewards: Effect.Success<ReturnType<typeof startLevelRoleWorker>> | undefined
    let greetingWorker: Effect.Success<ReturnType<typeof startGreetingsWorker>> | undefined
    const roleBackend = stores.roles
    // A member event wakes greeting discovery only when its observation recorded a change, so one that changed nothing costs no discovery
    const wake = (userId?: string) => greetingWorker?.notify(userId) ?? Effect.void
    // Role changes wake greetings when they are configured, and panel reads and changes keep the panel index current
    const panelIndex = createPanelIndex()
    // Whether the last policy or member answer had autorole or rules verification on. Only an answer sets it, so a stale value costs reads, never a skipped join
    let joinWork = false
    const learnJoin = (settings: RolesSettings) =>
        Effect.sync(() => {
            joinWork = settings.autoroleEnabled || settings.verificationEnabled
        })
    const roles: RolesStore | undefined = roleBackend
        ? {
              manage: (input) => panelIndex.change(roleBackend.manage(input)),
              query: (input) => roleBackend.query(input),
              memberQuery: (input) =>
                  panelIndex
                      .learn(roleBackend.memberQuery(input))
                      .pipe(Effect.tap((result) => learnJoin(result.settings))),
              policy: (input) => roleBackend.policy(input).pipe(Effect.tap((result) => learnJoin(result.settings))),
              reactionJobs: (input) => roleBackend.reactionJobs(input),
              dispatch: (input) => roleBackend.dispatch(input),
              observe: (input) => roleBackend.observe(input),
              evaluate: (input) => roleBackend.evaluate(input).pipe(Effect.tap(() => wake(input.context.userId))),
              outcome: (input) =>
                  roleBackend.outcome(input).pipe(Effect.tap((value) => (value.recorded ? wake() : Effect.void))),
              reconcile: (input) =>
                  roleBackend
                      .reconcile(input)
                      .pipe(Effect.tap((value) => (value.recorded ? wake(input.observation.userId) : Effect.void))),
          }
        : undefined
    // The newcomer checklist follows member role changes from memory and adds its completion role through the role store
    const onboarding = stores.onboarding
        ? createOnboardingRuntime(stores.onboarding, roles, config.serverId)
        : undefined
    const publishPanel =
        (publisher: DashboardPanelPublisher): DashboardPanelPublisher =>
        (job) =>
            panelIndex.change(publisher(job))
    let roleWorker: Effect.Success<ReturnType<typeof startRoleReactionWorker>> | undefined
    let backupScope: Scope.Scope | undefined
    // Each started worker's wake, for the process's work dispatcher
    const wakers: Partial<Record<ServiceWorkKind, (passes?: readonly ServiceDashboardWork[]) => Effect.Effect<void>>> =
        {}
    const unprivilegedActor = (userId: string): ModerationActor => ({
        originServerId: config.serverId,
        userId,
        roleIds: [],
        isOwner: false,
        isAdministrator: false,
        nativePermissionAuthorized: false,
    })
    // A step of the startup that fails in multi mode is skipped with a warning, so it never keeps the server's later
    // features from starting, since nothing starts them again. Single mode stops on a setup failure instead
    const skippable = <A, E, R>(step: Effect.Effect<A, E, R>, warning: string) =>
        config.scope?.mode !== "multi"
            ? step
            : step.pipe(
                  Effect.catchCause((cause) =>
                      Cause.hasInterrupts(cause)
                          ? Effect.failCause(cause)
                          : Effect.logWarning(warning).pipe(Effect.as(undefined)),
                  ),
              )
    const options = {
        setup: (client) =>
            Effect.gen(function* () {
                backupScope = yield* Effect.scope
                // A retired runtime leaves no per-server memory behind
                yield* Effect.addFinalizer(() => Effect.sync(() => forgetPrefix(config.serverId)))
                yield* Effect.addFinalizer(() => Effect.sync(() => forgetBackupLock(client, config.serverId)))
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
                if (publishing)
                    yield* skippable(
                        publishing.observe({ serverId: config.serverId, mode: "restart" }),
                        "Publishing recovery could not run at startup. The backend ages open attempts on its own",
                    )
                if (config.backend)
                    wakers.dashboard = (yield* startDashboardRolesWorker(
                        config,
                        client,
                        publishing
                            ? publishPanel(createDashboardPanelPublisher(config, client, publishing))
                            : undefined,
                        publishing,
                        stores.rolePicker && roles
                            ? processRolePickerPass(stores.rolePicker, roles, config.serverId, client)
                            : undefined,
                        setup ? processSetupCheckPass(setup, config.serverId, client) : undefined,
                        stores.privateData
                            ? processPrivateAccessPass(stores.privateData, config.serverId, client)
                            : undefined,
                        stores.showcases && publishing
                            ? processShowcasePass(stores.showcases, publishing, config.serverId, client)
                            : undefined,
                        stores.profiles ? processProfilePass(stores.profiles, config.serverId, client) : undefined,
                    )).notify
                if (roles) {
                    yield* skippable(
                        roles.observe({ serverId: config.serverId, mode: "restart" }),
                        "Role recovery could not run at startup. The backend ages open attempts on its own",
                    )
                    roleWorker = yield* startRoleReactionWorker(roles, config.serverId, client)
                    if (verification)
                        wakers.verification = (yield* startVerificationWorker(
                            verification,
                            roles,
                            config,
                            client,
                        )).notify
                }
                if (greetings) greetingWorker = yield* startGreetingsWorker(greetings, config.serverId, client)
                if (events && publishing)
                    wakers.events = (eventWorker = yield* startEventsWorker(
                        events,
                        publishing,
                        config.serverId,
                        client,
                    )).notify
                if (schedules && publishing)
                    wakers.schedules = (scheduleWorker = yield* startSchedulesWorker(
                        schedules,
                        publishing,
                        config.serverId,
                        client,
                    )).notify
                if (milestones && publishing)
                    wakers.milestones = (milestoneWorker = yield* startMilestonesWorker(
                        milestones,
                        publishing,
                        config.serverId,
                        client,
                    )).notify
                if (suggestions && publishing)
                    wakers.suggestions = (suggestionWorker = yield* startSuggestionsWorker(
                        suggestions,
                        publishing,
                        config.serverId,
                        client,
                    )).wake
                if (cleanup)
                    wakers.cleanup = (cleanupWorker = yield* startCleanupWorker(
                        cleanup,
                        config.serverId,
                        client,
                    )).notify
                if (metadata)
                    wakers.metadata = (metadataWorker = yield* startMetadataLogsWorker(
                        metadata,
                        config.serverId,
                        client,
                    )).notify
                if (admitMetadata) {
                    const recheck = admitMetadata.recheck
                    metadataRechecks.set(config.serverId, recheck)
                    yield* Effect.addFinalizer(() =>
                        Effect.sync(() => {
                            if (metadataRechecks.get(config.serverId) === recheck)
                                metadataRechecks.delete(config.serverId)
                        }),
                    )
                }
                if (stores.analytics)
                    analyticsWorker = yield* startAnalyticsWorker(stores.analytics, config.serverId, client)
                if (levels) {
                    if (roles)
                        wakers.levels = (levelRewards = yield* startLevelRoleWorker(
                            levels,
                            roles,
                            config.serverId,
                            client,
                        )).notify
                    levelCredits = yield* startLevelCreditWorker(
                        levels,
                        config.serverId,
                        client,
                        Effect.suspend(() => levelRewards?.notify() ?? Effect.void),
                    )
                }
                if (stores.temporaryRoles && roles)
                    wakers.temproles = (yield* startTemporaryRoleWorker(
                        stores.temporaryRoles,
                        roles,
                        config.serverId,
                        client,
                    )).notify
                if (stores.lfg) wakers.lfg = (yield* startLfgWorker(stores.lfg, config.serverId, client)).notify
            }),
        events: {
            messageCreate: {
                handler: (context) =>
                    Effect.gen(function* () {
                        const { message, reply } = context
                        if (
                            message.author.isSystem ||
                            message.webhookId ||
                            (message.type !== MessageType.Default && message.type !== MessageType.Reply)
                        )
                            return
                        // Analytics adds only an in-memory count to this serialized path
                        if (
                            analyticsWorker &&
                            message.guildId === config.serverId &&
                            !message.author.isBot &&
                            (yield* optional("analytics"))
                        )
                            yield* analyticsWorker.message(message.channelId)
                        // Sticky messages check an in-memory list here, and a repost runs beside this path
                        if (stickyMessages && message.guildId === config.serverId && !message.author.isBot)
                            yield* stickyMessages.message(message.channelId)
                        const content = message.content.trimStart()
                        // A mention of the bot followed by help answers like the help command, for members who do not know the prefix
                        const mention =
                            message.guildId === config.serverId
                                ? /^<@!?(\d+)>\s+help(?:\s+(\S+))?\s*$/i.exec(content)
                                : null
                        const helpMention =
                            !!mention &&
                            mention[1] ===
                                (yield* readAuthenticatedBotId(context.client).pipe(
                                    Effect.catch(() => Effect.succeed(undefined)),
                                ))
                        const prefix =
                            message.guildId === config.serverId && (/^[!$%&*+,.?~^|:/\-]/.test(content) || helpMention)
                                ? yield* readPrefix
                                : "!"
                        // The fixed prefix remains available for recovery and private server selection
                        const invocationPrefix = content.startsWith(prefix)
                            ? prefix
                            : /^!prefix(?:\s|$)/i.test(content)
                              ? "!"
                              : undefined
                        const commandBody = invocationPrefix ? content.slice(invocationPrefix.length) : undefined
                        const quoted =
                            commandBody !== undefined
                                ? commands.parseQuoted({ message, prefix: invocationPrefix!, source: commandBody })
                                : undefined
                        const typed = quoted && !("reason" in quoted) ? quoted : undefined
                        // The quoted parser names a quote that never closes or a backslash with nothing to escape
                        const syntaxProblem =
                            quoted && "reason" in quoted ? `${quoted.reason}.` : "Check quoting and syntax."
                        const name = helpMention
                            ? "help"
                            : commandBody === undefined
                              ? undefined
                              : /^([a-z0-9][a-z0-9_-]*)(?:\s|$)/i.exec(commandBody)?.[1]?.toLowerCase()
                        // `!<command> help all [next]` lists the forms a command's help leaves out. It parses and passes the gates as that command's help
                        const helpAll = typed && !helpMention ? helpAllRequest(name, typed.args) : undefined
                        const command = helpAll ? { ...typed!, args: helpAll.helpArgs } : typed
                        // Parser usage text names the prefix this command was invoked with, and in a multi-server DM
                        // the server selector the help it points to needs
                        const usage = <T>(parsed: T): T =>
                            parsed &&
                            typeof parsed === "object" &&
                            "error" in parsed &&
                            typeof parsed.error === "string"
                                ? {
                                      ...parsed,
                                      error: ((text) =>
                                          message.guildId === undefined ? serverCommands(text, config) : text)(
                                          withPrefix(parsed.error, invocationPrefix!),
                                      ),
                                  }
                                : parsed
                        const quotingError = (hint: string) => ({
                            error: `${syntaxProblem} Use ${invocationPrefix}${hint}`,
                        })
                        if (name === "backup") {
                            // Backups run beside the serial message handler, so a long export never blocks other commands
                            const backup = handleBackupCommand(
                                backups,
                                config,
                                command
                                    ? parseBackupCommand(command.args)
                                    : { error: `${syntaxProblem} Use !backup help privately` },
                                context,
                            ).pipe(Effect.catchCause(() => Effect.logWarning("Backup command stopped")))
                            yield* backupScope
                                ? backup.pipe(Effect.forkIn(backupScope))
                                : backup.pipe(Effect.forkDetach)
                            return
                        }
                        const safetyName = safetyNames.includes(name as SafetyName) ? (name as SafetyName) : undefined
                        const metadataInvocation = name === "logs" && command && isMetadataLogCommand(command.args)
                        const parsedMetadata = metadataInvocation
                            ? usage(parseMetadataLogCommand(command.args))
                            : undefined
                        const parsedSafety = safetyName
                            ? command
                                ? usage(parseSafetyCommand(safetyName, command.args))
                                : quotingError(`${safetyName} help for examples`)
                            : undefined
                        const parsedPublishing =
                            name === "publish"
                                ? command
                                    ? usage(parsePublishingCommand(command.args))
                                    : quotingError("publish help for examples")
                                : undefined
                        const roleName = ["roles", "verify", "autorole"].includes(name ?? "")
                            ? (name as RoleCommandName)
                            : undefined
                        const parsedRoles = roleName
                            ? command
                                ? usage(parseRoleCommand(roleName, command.args))
                                : quotingError(`${roleName} help for examples`)
                            : undefined
                        const parsedRolePicker =
                            name === "rolepicker"
                                ? command
                                    ? parseRolePickerCommand(command.args)
                                    : quotingError("rolepicker help")
                                : undefined
                        const parsedTemporaryRole =
                            name === "temprole"
                                ? command
                                    ? parseTemporaryRoleCommand(command.args)
                                    : quotingError("temprole help")
                                : undefined
                        const parsedOnboarding =
                            name === "onboarding"
                                ? command
                                    ? usage(parseOnboardingCommand(command.args))
                                    : quotingError("onboarding help")
                                : undefined
                        const parsedShowcase =
                            name === "showcase"
                                ? command
                                    ? usage(parseShowcaseCommand(command.args))
                                    : quotingError("showcase help")
                                : undefined
                        const parsedProfile =
                            name === "profile"
                                ? command
                                    ? usage(parseProfileCommand(command.args))
                                    : quotingError("profile help")
                                : undefined
                        const greetingName = name === "welcome" || name === "goodbye" ? name : undefined
                        const parsedGreeting = greetingName
                            ? command
                                ? usage(parseGreetingsCommand(greetingName, command.args))
                                : quotingError(`${greetingName} help for examples`)
                            : undefined
                        const parsedTicket =
                            name === "ticket"
                                ? command
                                    ? usage(parseTicketCommand(command.args))
                                    : quotingError("ticket help for examples")
                                : undefined
                        const parsedMilestone =
                            name === "milestone"
                                ? command
                                    ? usage(parseMilestoneCommand(command.args))
                                    : quotingError("milestone help in private")
                                : undefined
                        const parsedSuggestion =
                            name === "suggest"
                                ? command
                                    ? usage(parseSuggestionCommand(command.args))
                                    : quotingError("suggest help")
                                : undefined
                        const parsedCleanup =
                            name === "cleanup"
                                ? command
                                    ? usage(parseCleanupCommand(command.args))
                                    : quotingError("cleanup help")
                                : undefined
                        const parsedVoice =
                            name === "voice"
                                ? command
                                    ? usage(parseVoiceCommand(command.args))
                                    : quotingError("voice help")
                                : undefined
                        const parsedLfg =
                            name === "lfg"
                                ? command
                                    ? usage(parseLfgCommand(command.args))
                                    : quotingError("lfg help")
                                : undefined
                        const levelName =
                            name === "level" || name === "rank" || name === "leaderboard" ? name : undefined
                        const eventName = name === "event" ? name : undefined
                        const parsedEvent = eventName
                            ? command
                                ? usage(parseEventCommand(command.args))
                                : quotingError("event help for examples")
                            : undefined
                        const privateInvocation = message.guildId !== config.serverId
                        if (privateInvocation) {
                            if (message.guildId !== undefined) return
                            // Every other command sent in a DM gets one line that says where it works
                            if (!(
                                (metadataInvocation && metadata) ||
                                (name === "milestone" && milestones) ||
                                (name === "ticket" && tickets) ||
                                (safetyName && moderation)
                            )) {
                                yield* reply({ content: serverOnlyReply(name) })
                                return
                            }
                            const verified = yield* name === "milestone"
                                ? verifyMilestonePrivateAuthor(
                                      context.client,
                                      message.channelId,
                                      message.author.id,
                                  ).pipe(
                                      Effect.as(true),
                                      Effect.catch(() => Effect.succeed(false)),
                                  )
                                : name === "ticket" || metadataInvocation
                                  ? verifyTicketPrivateAuthor(
                                        context.client,
                                        message.channelId,
                                        message.author.id,
                                    ).pipe(
                                        Effect.as(true),
                                        Effect.catch(() => Effect.succeed(false)),
                                    )
                                  : verifyPrivateAuthor(context.client, message.channelId, message.author.id).pipe(
                                        Effect.as(true),
                                        Effect.catch(() => Effect.succeed(false)),
                                    )
                            if (!verified) return
                        }
                        let protectionUnknown = false
                        if (moderation && !metadataInvocation) {
                            const publishingCritical =
                                parsedPublishing &&
                                !("error" in parsedPublishing) &&
                                ((parsedPublishing.type === "settings" && parsedPublishing.patch.enabled === false) ||
                                    parsedPublishing.type === "reconcile" ||
                                    (parsedPublishing.type === "query" &&
                                        ["settings", "post-show", "post-list"].includes(
                                            parsedPublishing.operation.type,
                                        )) ||
                                    (parsedPublishing.type === "schedule" &&
                                        scheduleCritical(parsedPublishing.command)))
                            const roleCritical =
                                parsedRoles &&
                                !("error" in parsedRoles) &&
                                (parsedRoles.type === "status" ||
                                    parsedRoles.type === "jobs" ||
                                    parsedRoles.type === "resume" ||
                                    (parsedRoles.type === "module" && !parsedRoles.enabled) ||
                                    parsedRoles.type === "member")
                            const rolePublic =
                                parsedRoles &&
                                !("error" in parsedRoles) &&
                                (parsedRoles.type === "verify" || parsedRoles.type === "choose")
                            const parsedLevel =
                                levelName === "level" && command ? parseLevelCommand(command.args) : undefined
                            const levelCritical =
                                parsedLevel &&
                                !("error" in parsedLevel) &&
                                (parsedLevel.type === "config" ||
                                    parsedLevel.type === "status" ||
                                    parsedLevel.type === "audit" ||
                                    parsedLevel.type === "reconcile" ||
                                    parsedLevel.type === "reset-member" ||
                                    parsedLevel.type === "reset-server" ||
                                    parsedLevel.type === "clear" ||
                                    (parsedLevel.type === "module" && !parsedLevel.enabled) ||
                                    parsedLevel.type === "correct")
                            // Independent feature handlers apply their own backend authorization and DEFCON policy.
                            // The moderation read still supplies presence and native message protection.
                            const gateClass =
                                metadataInvocation ||
                                name === "ticket" ||
                                name === "milestone" ||
                                name === "cleanup" ||
                                // It must stay reachable at DEFCON 1
                                name === "preset"
                                    ? "critical"
                                    : safetyName
                                      ? safetyGateClass(safetyName, parsedSafety!)
                                      : publishingCritical ||
                                          roleCritical ||
                                          levelCritical ||
                                          (parsedGreeting && greetingsCritical(parsedGreeting)) ||
                                          (parsedEvent && eventCritical(parsedEvent)) ||
                                          (parsedSuggestion && suggestionCritical(parsedSuggestion)) ||
                                          (parsedRolePicker && rolePickerCritical(parsedRolePicker)) ||
                                          (parsedTemporaryRole && temporaryRoleCritical(parsedTemporaryRole)) ||
                                          (parsedOnboarding && onboardingCritical(parsedOnboarding))
                                        ? "critical"
                                        : greetingName ||
                                            (roleName && !rolePublic) ||
                                            parsedRolePicker ||
                                            parsedTemporaryRole ||
                                            (parsedOnboarding && !onboardingPublic(parsedOnboarding)) ||
                                            (parsedShowcase && !showcasePublic(parsedShowcase)) ||
                                            (parsedProfile && !profilePublic(parsedProfile)) ||
                                            name === "setup" ||
                                            name === "health" ||
                                            name === "stats" ||
                                            name === "prefix" ||
                                            name === "nickname" ||
                                            name === "sticky" ||
                                            name === "sidebar" ||
                                            name === "memberlist" ||
                                            name === "alerts" ||
                                            name === "invites" ||
                                            name === "helpdesk" ||
                                            name === "answer" ||
                                            name === "escalate" ||
                                            name === "custom" ||
                                            name === "auto" ||
                                            name === "publish" ||
                                            levelName === "level" ||
                                            (parsedEvent && !eventPublic(parsedEvent)) ||
                                            (parsedSuggestion &&
                                                !("error" in parsedSuggestion) &&
                                                !suggestionPublic(parsedSuggestion)) ||
                                            (parsedVoice && !voicePublic(parsedVoice)) ||
                                            (parsedLfg && lfgStaff(parsedLfg))
                                          ? "staff"
                                          : "public"
                            // DEFCON 3 admits every command whoever sends it, so the author's authority is read before the gate only while the last
                            // answer reported a raised DEFCON, and after a refusal the hint did not expect
                            const privileged = !(
                                name === "ticket" ||
                                name === "milestone" ||
                                name === "cleanup" ||
                                gateClass === "public" ||
                                gateClass === "appeal"
                            )
                            const authority = readSafetyAuthority(
                                context.client,
                                config.serverId,
                                message.author.id,
                            ).pipe(Effect.map(moderationActor))
                            const read = privileged && moderationHints!.defcon() !== 3
                            const admitted = yield* admitMemberMessage(
                                moderation,
                                moderationHints!,
                                config,
                                "create",
                                message,
                                context.client,
                                {
                                    actor: read ? yield* authority : unprivilegedActor(message.author.id),
                                    command: gateClass,
                                },
                                !privateInvocation,
                            )
                            const gate =
                                privileged && !read && !admitted.gate.allowed
                                    ? yield* moderation.gate({
                                          serverId: config.serverId,
                                          actor: yield* authority,
                                          command: gateClass,
                                      })
                                    : admitted.gate
                            const blocked = admitted.blocked
                            yield* applyDefconPresence(context.client, config, gate.defcon)
                            if (
                                (name !== "ticket" && name !== "milestone" && name !== "cleanup" && !gate.allowed) ||
                                blocked === true
                            ) {
                                if (!privateInvocation && store)
                                    yield* handleAfk(store, config.serverId, context, false, prefix)
                                return
                            }
                            // A message protection could not judge gets no public command or reply. Leveling collection still runs
                            protectionUnknown = blocked === "unknown" && gateClass === "public"
                        } else if (
                            privateInvocation &&
                            name !== "ticket" &&
                            name !== "milestone" &&
                            !metadataInvocation
                        )
                            return
                        // Collection adds only bounded hashing and a dropping queue offer to this serialized path.
                        if (
                            !privateInvocation &&
                            levelCredits &&
                            config.backend &&
                            commandBody === undefined &&
                            !helpMention
                        ) {
                            const candidate = levelCandidate(message, config.serverId, config.backend.secret)
                            if (candidate && (yield* levelCredits.wanted) && (yield* optional("levels")))
                                yield* levelCredits.offer(candidate)
                        }
                        if (protectionUnknown) {
                            if (store) yield* handleAfk(store, config.serverId, context, false, prefix)
                            return
                        }
                        const pingExit: Exit.Exit<void, unknown> =
                            name === "ping"
                                ? yield* Effect.exit(reply({ content: "Pong!" }).pipe(Effect.asVoid))
                                : Exit.void
                        if (Exit.isFailure(pingExit) && Cause.hasInterrupts(pingExit.cause))
                            return yield* Effect.failCause(pingExit.cause)
                        // AFK and responses are independent, so their backend calls run side by side and each keeps its own failure
                        const afk: Effect.Effect<void, unknown> =
                            store && !privateInvocation
                                ? handleAfk(store, config.serverId, context, true, prefix)
                                : Effect.void
                        const [afkExit, responseExit] = yield* Effect.all(
                            [
                                Effect.exit(afk),
                                Effect.exit(
                                    Effect.gen(function* () {
                                        if (name === "afk" || name === "ping") return
                                        if (!privateInvocation && name === "prefix") {
                                            yield* handlePrefixCommand(
                                                general,
                                                config.serverId,
                                                command?.args ?? ["invalid quoting"],
                                                context,
                                            )
                                            return
                                        }
                                        if (!privateInvocation && name === "nickname") {
                                            yield* handleNicknameCommand(
                                                general,
                                                config.serverId,
                                                command?.args ?? ["invalid quoting"],
                                                context,
                                            )
                                            return
                                        }
                                        if (!privateInvocation && name === "help") {
                                            yield* handleHelpCommand(
                                                config.serverId,
                                                prefix,
                                                helpMention
                                                    ? mention![2]
                                                        ? [mention![2]]
                                                        : []
                                                    : (command?.args ?? []),
                                                context,
                                            )
                                            return
                                        }
                                        if (helpAll) {
                                            yield* handleHelpAll(config, prefix, helpAll, context)
                                            return
                                        }
                                        if (!privateInvocation && (name === "health" || name === "setup")) {
                                            yield* (name === "health" ? handleHealthCommand : handleSetupCommand)(
                                                setup,
                                                config.serverId,
                                                prefix,
                                                command?.args ?? [],
                                                context,
                                            )
                                            return
                                        }
                                        if (!privateInvocation && name === "stats") {
                                            yield* handleStatsCommand(
                                                stores.analytics,
                                                analyticsWorker,
                                                config.serverId,
                                                command?.args ?? ["invalid quoting"],
                                                context,
                                            )
                                            return
                                        }
                                        if (!privateInvocation && name === "sticky") {
                                            yield* handleStickyCommand(
                                                stores.sticky,
                                                stickyMessages,
                                                config,
                                                command?.args ?? ["invalid quoting"],
                                                context,
                                            )
                                            return
                                        }
                                        if (!privateInvocation && name === "sidebar") {
                                            yield* handleSidebarCommand(
                                                stores.sidebar,
                                                config,
                                                command?.args ?? ["invalid quoting"],
                                                context,
                                            )
                                            return
                                        }
                                        if (!privateInvocation && parsedOnboarding) {
                                            yield* handleOnboardingCommand(
                                                stores.onboarding,
                                                onboarding,
                                                config,
                                                parsedOnboarding,
                                                context,
                                            )
                                            return
                                        }
                                        if (!privateInvocation && parsedShowcase) {
                                            yield* handleShowcaseCommand(
                                                stores.showcases,
                                                config,
                                                parsedShowcase,
                                                context,
                                            )
                                            return
                                        }
                                        if (!privateInvocation && parsedProfile) {
                                            yield* handleProfileCommand(stores.profiles, config, parsedProfile, context)
                                            return
                                        }
                                        if (!privateInvocation && name === "preset") {
                                            // A preset can turn leveling on
                                            yield* handlePresetCommand(
                                                stores.presets,
                                                config,
                                                command
                                                    ? usage(parsePresetCommand(command.args))
                                                    : quotingError("preset help"),
                                                context,
                                            ).pipe(Effect.ensuring(levelCredits?.recheck() ?? Effect.void))
                                            return
                                        }
                                        if (!privateInvocation && name === "memberlist") {
                                            yield* handleMemberListCommand(
                                                stores.memberList,
                                                config,
                                                command?.args ?? ["invalid quoting"],
                                                context,
                                            )
                                            return
                                        }
                                        if (!privateInvocation && (name === "alerts" || name === "invites")) {
                                            yield* name === "alerts"
                                                ? handleAlertsCommand(
                                                      stores.alerts,
                                                      securityAlerts,
                                                      config,
                                                      command?.args ?? ["invalid quoting"],
                                                      context,
                                                  )
                                                : handleInvitesCommand(
                                                      config,
                                                      command?.args ?? ["invalid quoting"],
                                                      context,
                                                  )
                                            return
                                        }
                                        if (!privateInvocation && name && helpDeskCommands.includes(name)) {
                                            yield* handleHelpDeskInvocation(
                                                name,
                                                stores,
                                                helpDesk,
                                                config,
                                                command?.args ?? ["invalid quoting"],
                                                context,
                                            )
                                            return
                                        }
                                        if (!privateInvocation && parsedRolePicker) {
                                            yield* handleRolePickerCommand(
                                                stores.rolePicker,
                                                config,
                                                parsedRolePicker,
                                                context,
                                                roles,
                                            )
                                            return
                                        }
                                        if (metadataInvocation) {
                                            // Gateway admission pauses while logs are off, so a logs command rechecks it
                                            if (metadata)
                                                yield* handleMetadataLogCommand(
                                                    metadata,
                                                    config,
                                                    parsedMetadata!,
                                                    context,
                                                    metadataWorker,
                                                ).pipe(Effect.ensuring(Effect.sync(() => admitMetadata?.recheck())))
                                            return
                                        }
                                        if (name === "cleanup") {
                                            if (cleanup)
                                                yield* handleCleanupCommand(
                                                    cleanup,
                                                    config,
                                                    parsedCleanup!,
                                                    context,
                                                    cleanupWorker,
                                                )
                                            else
                                                yield* reply({
                                                    content: notSetUp("Message cleanup"),
                                                })
                                            return
                                        }
                                        if (name === "temprole") {
                                            yield* handleTemporaryRoleCommand(
                                                stores.temporaryRoles,
                                                roles,
                                                config,
                                                parsedTemporaryRole!,
                                                context,
                                            )
                                            return
                                        }
                                        if (name === "voice") {
                                            if (voice && voiceRooms)
                                                yield* handleVoiceCommand(
                                                    voice,
                                                    voiceRooms,
                                                    config,
                                                    parsedVoice!,
                                                    context,
                                                )
                                            else
                                                yield* reply({
                                                    content: notSetUp("Temporary voice rooms"),
                                                })
                                            return
                                        }
                                        if (name === "lfg") {
                                            yield* handleLfgCommand(stores.lfg, voiceRooms, config, parsedLfg!, context)
                                            return
                                        }
                                        if (name === "suggest") {
                                            if (suggestions)
                                                yield* handleSuggestionCommand(
                                                    suggestions,
                                                    config,
                                                    parsedSuggestion!,
                                                    context,
                                                    suggestionWorker,
                                                )
                                            else
                                                yield* reply({
                                                    content: notSetUp("Suggestions"),
                                                })
                                            return
                                        }
                                        if (name === "milestone") {
                                            if (milestones)
                                                yield* handleMilestoneCommand(
                                                    milestones,
                                                    publishing,
                                                    config,
                                                    parsedMilestone!,
                                                    context,
                                                    milestoneWorker,
                                                )
                                            return
                                        }
                                        if (eventName) {
                                            if (!events)
                                                yield* reply({
                                                    content: notSetUp("Events"),
                                                })
                                            else
                                                yield* handleEventCommand(
                                                    events,
                                                    publishing,
                                                    config,
                                                    parsedEvent!,
                                                    context,
                                                    eventWorker,
                                                )
                                            return
                                        }
                                        if (levelName) {
                                            if (!levels)
                                                yield* reply({
                                                    content: notSetUp("Leveling"),
                                                })
                                            else if (!command)
                                                yield* reply({
                                                    content: `${syntaxProblem} Use ${invocationPrefix}${levelName === "level" ? "level help" : levelName} for examples`,
                                                })
                                            else if (levelName === "level")
                                                yield* handleLevelCommand(
                                                    levels,
                                                    config,
                                                    { name: "level", command: usage(parseLevelCommand(command.args)) },
                                                    context,
                                                    levelRewards,
                                                    roles,
                                                ).pipe(Effect.ensuring(levelCredits?.recheck() ?? Effect.void))
                                            else if (levelName === "rank")
                                                yield* handleLevelCommand(
                                                    levels,
                                                    config,
                                                    { name: "rank", command: usage(parseRankCommand(command.args)) },
                                                    context,
                                                )
                                            else
                                                yield* handleLevelCommand(
                                                    levels,
                                                    config,
                                                    {
                                                        name: "leaderboard",
                                                        command: usage(parseLeaderboardCommand(command.args)),
                                                    },
                                                    context,
                                                )
                                            return
                                        }
                                        if (name === "ticket") {
                                            if (!tickets)
                                                yield* reply({
                                                    content: notSetUp("Tickets"),
                                                })
                                            else
                                                yield* handleTicketCommand(
                                                    tickets,
                                                    publishing,
                                                    config,
                                                    parsedTicket!,
                                                    context,
                                                )
                                            return
                                        }
                                        if (greetingName) {
                                            if (!greetings)
                                                yield* reply({
                                                    content: notSetUp("Welcome and goodbye"),
                                                })
                                            else
                                                yield* handleGreetingsCommand(
                                                    greetings,
                                                    publishing,
                                                    config,
                                                    parsedGreeting!,
                                                    context,
                                                    greetingWorker,
                                                )
                                            return
                                        }
                                        if (roleName) {
                                            if (
                                                parsedRoles &&
                                                !("error" in parsedRoles) &&
                                                parsedRoles.type === "verification-review" &&
                                                roles
                                            ) {
                                                if (!verification) {
                                                    yield* reply({
                                                        content: withPrefix(
                                                            "Web verification is not set up on this deployment",
                                                            invocationPrefix!,
                                                        ),
                                                    })
                                                    return
                                                }
                                                const failure = yield* reviewVerificationRequest(
                                                    verification,
                                                    roles,
                                                    config,
                                                    context.client,
                                                    parsedRoles.challengeId,
                                                    message.author.id,
                                                ).pipe(
                                                    Effect.as(undefined),
                                                    // Any failed review is answered in the channel
                                                    Effect.catchCause((cause) =>
                                                        Cause.hasInterrupts(cause)
                                                            ? Effect.failCause(cause)
                                                            : Effect.logWarning(
                                                                  "A verification review could not be recorded",
                                                              ).pipe(
                                                                  Effect.as(
                                                                      verificationReviewFailure(Cause.squash(cause)),
                                                                  ),
                                                              ),
                                                    ),
                                                )
                                                yield* reply({
                                                    content: withPrefix(
                                                        failure ?? "Review recorded. The access role follows shortly",
                                                        invocationPrefix!,
                                                    ),
                                                })
                                                return
                                            }
                                            const link =
                                                roleName === "verify" &&
                                                command?.args.length === 0 &&
                                                verification &&
                                                roles
                                                    ? yield* requestVerificationLink(
                                                          verification,
                                                          roles,
                                                          config,
                                                          context.client,
                                                          message.author.id,
                                                      ).pipe(
                                                          // Any failure to deliver the link is answered in the channel
                                                          Effect.catchCause((cause) =>
                                                              Cause.hasInterrupts(cause)
                                                                  ? Effect.failCause(cause)
                                                                  : Effect.logWarning(
                                                                        "A verification link could not be delivered",
                                                                    ).pipe(
                                                                        Effect.as(
                                                                            verificationLinkFailure(
                                                                                Cause.squash(cause),
                                                                            ),
                                                                        ),
                                                                    ),
                                                          ),
                                                      )
                                                    : undefined
                                            if (link) {
                                                yield* reply({
                                                    content: withPrefix(
                                                        verificationLinkReplies[link],
                                                        invocationPrefix!,
                                                    ),
                                                })
                                                return
                                            }
                                            if (!roles)
                                                yield* reply({
                                                    content: notSetUp(
                                                        {
                                                            roles: "Reaction roles",
                                                            verify: "Rules verification",
                                                            autorole: "Autorole",
                                                        }[roleName],
                                                    ),
                                                })
                                            else
                                                yield* handleRoleCommand(
                                                    roles,
                                                    publishing,
                                                    config,
                                                    roleName,
                                                    parsedRoles!,
                                                    context,
                                                    roleWorker,
                                                )
                                            return
                                        }
                                        if (name === "publish") {
                                            if (!publishing)
                                                yield* reply({
                                                    content: notSetUp("Publishing"),
                                                })
                                            else
                                                yield* handlePublishing(
                                                    publishing,
                                                    config,
                                                    parsedPublishing!,
                                                    context,
                                                    schedules,
                                                    scheduleWorker,
                                                    events,
                                                )
                                            return
                                        }
                                        if (safetyName) {
                                            if (!moderation)
                                                yield* reply({
                                                    content: notSetUp("Moderation"),
                                                })
                                            else if (parsedSafety && "error" in parsedSafety)
                                                yield* reply({
                                                    content: parsedSafety.error,
                                                })
                                            else
                                                yield* handleSafetyCommand(
                                                    moderation,
                                                    config,
                                                    safetyName,
                                                    parsedSafety!,
                                                    context,
                                                    privateInvocation,
                                                )
                                            return
                                        }
                                        if (name === "custom" || name === "auto") {
                                            const parsed = command
                                                ? usage(parseManagement(name, command.args))
                                                : quotingError(`${name} help for examples`)
                                            if ("error" in parsed || "help" in parsed) {
                                                yield* reply({
                                                    content:
                                                        "error" in parsed
                                                            ? parsed.error
                                                            : withPrefix(parsed.help, invocationPrefix!),
                                                })
                                            } else if (responses) {
                                                yield* handleManagement(responses, config.serverId, parsed, context)
                                            } else {
                                                yield* reply({
                                                    content: notSetUp(
                                                        name === "custom" ? "Custom commands" : "Autoresponders",
                                                    ),
                                                })
                                            }
                                            return
                                        }
                                        // Limited or paused response evaluation skips the hint too, since a custom command of that name may exist
                                        const evaluated = responses ? yield* optional("responses") : true
                                        const known =
                                            responses && evaluated
                                                ? yield* handleResponse(responses, config.serverId, context)
                                                : false
                                        // An unknown command close to a built-in one gets one hint. Other text after the prefix stays unanswered, so chat stays quiet
                                        const suggestion =
                                            evaluated && !known && name && !privateInvocation
                                                ? suggestCommand(name)
                                                : undefined
                                        if (suggestion)
                                            yield* reply({
                                                content: `Did you mean ${invocationPrefix}${suggestion}? Send ${invocationPrefix}help to list the commands you can use`,
                                            })
                                    }),
                                ),
                            ],
                            { concurrency: 2 },
                        )
                        for (const outcome of [afkExit, responseExit])
                            if (Exit.isFailure(outcome) && Cause.hasInterrupts(outcome.cause))
                                return yield* Effect.failCause(outcome.cause)
                        let cause: Cause.Cause<unknown> = Cause.empty
                        for (const outcome of [pingExit, afkExit, responseExit]) {
                            if (Exit.isFailure(outcome)) cause = Cause.combine(cause, outcome.cause)
                        }
                        if (cause.reasons.length) return yield* Effect.failCause(cause)
                    }),
            },
            messageUpdate: {
                handler: ({ event, client }) =>
                    Effect.gen(function* () {
                        if (admitMetadata) yield* admitMetadata("messageUpdate", event, client)
                        if (
                            !moderation ||
                            event.guildId !== config.serverId ||
                            event.author.isSystem ||
                            event.webhookId ||
                            (event.type !== MessageType.Default && event.type !== MessageType.Reply)
                        )
                            return
                        yield* admitMemberMessage(moderation, moderationHints!, config, "edit", event, client, {
                            actor: unprivilegedActor(event.author.id),
                            command: "public",
                        })
                    }),
            },
            guildMemberAdd: {
                handler: (context) =>
                    Effect.gen(function* () {
                        if (admitMetadata) yield* admitMetadata("guildMemberAdd", context.event, context.client)
                        if (context.event.guildId !== config.serverId) return
                        if (analyticsWorker && (yield* optional("analytics"))) yield* analyticsWorker.join()
                        if (milestoneWorker) yield* milestoneWorker.notifyMember(context.event.userId)
                        // Join protection's answer carries the settings, so while the last answer reported join checks on, a checked join needs no gate
                        let allowed = true
                        if (moderation) {
                            const tried = moderationHints!.joinProtection()
                            const checked = tried
                                ? yield* containProtection(handleProtectionJoin(moderation, config, context), undefined)
                                : undefined
                            if (checked) allowed = moderationGate(checked, "public").allowed
                            else {
                                const gate = yield* moderation.gate({
                                    serverId: config.serverId,
                                    actor: unprivilegedActor(context.event.userId),
                                    command: "public",
                                })
                                allowed = gate.allowed
                                if (gate.joinProtectionEnabled && !tried)
                                    yield* containProtection(
                                        handleProtectionJoin(moderation, config, context),
                                        undefined,
                                    )
                            }
                        }
                        // After join protection, so an impersonation check's staff read never delays it
                        if (securityAlerts) yield* securityAlerts.memberAdd(context.event, context.client)
                        if (greetings)
                            yield* observeGreetingJoin(
                                greetings,
                                config.serverId,
                                context.client,
                                context.event.userId,
                                context.event.joinedAt,
                            ).pipe(
                                Effect.flatMap((recorded) => (recorded ? wake(context.event.userId) : Effect.void)),
                                Effect.catchCause((cause) =>
                                    Cause.hasInterrupts(cause)
                                        ? Effect.failCause(cause)
                                        : Effect.logWarning(
                                              "Greeting admission could not be verified. Existing join protection and role handling remain independent",
                                          ),
                                ),
                            )
                        if (roles && allowed) {
                            yield* handleRoleJoin(
                                roles,
                                config.serverId,
                                context.client,
                                context.event.userId,
                                context.event.joinedAt,
                                () => joinWork,
                            ).pipe(Effect.mapError(() => new RoleHandlingError({ stage: "eligibility" })))
                        }
                    }),
            },
            guildMemberRemove: {
                handler: ({ event, client }) =>
                    Effect.gen(function* () {
                        if (admitMetadata) yield* admitMetadata("guildMemberRemove", event, client)
                        if (event.guildId !== config.serverId) return
                        if (analyticsWorker && (yield* optional("analytics"))) yield* analyticsWorker.leave()
                        if (eventWorker) yield* eventWorker.notifyMember(event.userId)
                        if (milestoneWorker) yield* milestoneWorker.notifyMember(event.userId)
                        if (greetings)
                            yield* observeGreetingMembership(
                                greetings,
                                config.serverId,
                                client,
                                event.userId,
                                true,
                            ).pipe(Effect.flatMap((recorded) => (recorded ? wake(event.userId) : Effect.void)))
                    }),
            },
            guildMemberUpdate: {
                handler: ({ event, client }) =>
                    Effect.gen(function* () {
                        if (admitMetadata) yield* admitMetadata("guildMemberUpdate", event, client)
                        if (event.guildId !== config.serverId) return
                        if (securityAlerts) yield* securityAlerts.memberUpdate(event, client)
                        // Milestones follow joins and leaves only. An update keeps the join time, and delivery rechecks membership
                        // A role change may finish the newcomer checklist. Protection already ran when the member joined, and the check never fails the handler
                        if (onboarding) yield* onboarding.memberUpdated(client, event)
                        if (greetings)
                            yield* observeGreetingMembership(greetings, config.serverId, client, event.userId).pipe(
                                Effect.flatMap((recorded) => (recorded ? wake(event.userId) : Effect.void)),
                            )
                    }),
            },
            messageDelete: {
                handler: ({ event, client }) => admitMetadata?.("messageDelete", event, client) ?? Effect.void,
            },
            messageDeleteBulk: {
                handler: ({ event, client }) => admitMetadata?.("messageDeleteBulk", event, client) ?? Effect.void,
            },
            guildRoleCreate: {
                handler: ({ event, client }) => admitMetadata?.("guildRoleCreate", event, client) ?? Effect.void,
            },
            guildRoleUpdate: {
                handler: ({ event, client }) => admitMetadata?.("guildRoleUpdate", event, client) ?? Effect.void,
            },
            guildRoleDelete: {
                handler: ({ event, client }) => admitMetadata?.("guildRoleDelete", event, client) ?? Effect.void,
            },
            guildRoleUpdateBulk: {
                handler: ({ event, client }) => admitMetadata?.("guildRoleUpdateBulk", event, client) ?? Effect.void,
            },
            guildChannelCreate: {
                handler: ({ event, client }) => admitMetadata?.("guildChannelCreate", event, client) ?? Effect.void,
            },
            // A changed category can move its channels or change their permissions, so the threads kept for the server are forgotten
            guildChannelUpdate: {
                handler: ({ event, client }) =>
                    Effect.suspend(() => {
                        if (event.type === ChannelType.Category) forgetServerThreads(client, event.guildId)
                        return admitMetadata?.("guildChannelUpdate", event, client) ?? Effect.void
                    }),
            },
            guildChannelDelete: {
                handler: ({ event, client }) =>
                    Effect.gen(function* () {
                        // Fluxer deletes a channel's threads with it and sends no thread events for them
                        if (event.type === ChannelType.Category) forgetServerThreads(client, event.guildId)
                        const threadIds = event.type === ChannelType.Category ? [] : forgetThreadsOf(client, event.id)
                        if (voiceRooms && event.guildId === config.serverId) yield* voiceRooms.channelDeleted(event.id)
                        if (admitMetadata) {
                            yield* admitMetadata("guildChannelDelete", event, client)
                            if (threadIds.length)
                                yield* admitMetadata(
                                    "threadsDeletedWithParent",
                                    { guildId: event.guildId, id: event.id, threadIds },
                                    client,
                                )
                        }
                    }),
            },
            // Metadata logs record thread creation, changes and deletion
            threadCreate: {
                handler: ({ event, client }) =>
                    Effect.gen(function* () {
                        rememberThread(client, event)
                        // A bot joining an existing thread is not a creation
                        if (admitMetadata && event.isNewlyCreated) yield* admitMetadata("threadCreate", event, client)
                        if (helpDesk) yield* helpDesk.threadCreated(event)
                    }),
            },
            threadUpdate: {
                handler: ({ event, client }) => {
                    const previous = rememberThread(client, event)
                    return admitMetadata?.("threadUpdate", event, client, previous) ?? Effect.void
                },
            },
            threadDelete: {
                handler: ({ event, client }) => {
                    forgetThread(client, event.id)
                    return admitMetadata?.("threadDelete", event, client) ?? Effect.void
                },
            },
            threadListSync: {
                handler: ({ event, client }) =>
                    Effect.sync(() => {
                        for (const thread of event.threads) rememberThread(client, thread)
                    }),
            },
            voiceStateUpdate: {
                handler: ({ event }) => voiceRooms?.voiceState(event, receiptOf(event)) ?? Effect.void,
            },
            voiceStateSnapshot: {
                handler: ({ event, context }) =>
                    voiceRooms?.snapshot(event, context.sessionEpoch, receiptOf(event)) ?? Effect.void,
            },
            guildDelete: {
                handler: ({ event }) =>
                    voiceRooms && event.id === config.serverId ? voiceRooms.unavailable(receiptOf(event)) : Effect.void,
            },
            guildChannelUpdateBulk: {
                handler: ({ event, client }) =>
                    Effect.suspend(() => {
                        forgetServerThreads(client, event.guildId)
                        return admitMetadata?.("guildChannelUpdateBulk", event, client) ?? Effect.void
                    }),
            },
            guildUpdate: {
                handler: ({ event, client }) => admitMetadata?.("guildUpdate", event, client) ?? Effect.void,
            },
            guildAuditLogEntryCreate: {
                handler: ({ event, client }) =>
                    Effect.gen(function* () {
                        if (admitMetadata) yield* admitMetadata("guildAuditLogEntryCreate", event, client)
                        if (securityAlerts && event.guildId === config.serverId)
                            yield* securityAlerts.audit(event, client)
                    }),
            },
            // Invite logs belong to security alerts, which keep the invite code out of every record
            inviteCreate: {
                handler: ({ event }) => securityAlerts?.inviteCreated(event) ?? Effect.void,
            },
            inviteDelete: {
                handler: ({ event }) => securityAlerts?.inviteDeleted(event.channelId) ?? Effect.void,
            },
            messageReactionAdd: {
                handler: ({ event, client }) =>
                    Effect.gen(function* () {
                        // A reaction on a message that is no panel needs no member or backend read
                        if (!roles || !(yield* panelIndex.mayBePanel(event.id))) return
                        if (
                            verification &&
                            (yield* panelIndex.mayBeVerification(event.id)) &&
                            (yield* requestVerificationLink(
                                verification,
                                roles,
                                config,
                                client,
                                event.userId,
                                event,
                            )) !== undefined
                        )
                            return
                        yield* handleRoleReaction(roles, config.serverId, client, event, event.userId)
                    }).pipe(Effect.mapError(() => new RoleHandlingError({ stage: "eligibility" }))),
            },
            messageReactionAddMany: {
                handler: ({ event, client }) =>
                    Effect.gen(function* () {
                        if (!roles || !(yield* panelIndex.mayBePanel(event.id))) return
                        const verificationPanel = yield* panelIndex.mayBeVerification(event.id)
                        for (const userId of new Set(event.reactions.map((reaction) => reaction.userId))) {
                            if (
                                verification &&
                                verificationPanel &&
                                (yield* requestVerificationLink(verification, roles, config, client, userId, event)) !==
                                    undefined
                            )
                                continue
                            yield* handleRoleReaction(roles, config.serverId, client, event, userId)
                        }
                    }).pipe(Effect.mapError(() => new RoleHandlingError({ stage: "eligibility" }))),
            },
            messageReactionRemove: {
                handler: ({ event, client }) =>
                    Effect.gen(function* () {
                        if (!roles || !(yield* panelIndex.mayBePanel(event.id))) return
                        yield* handleRoleReaction(roles, config.serverId, client, event, event.userId)
                    }).pipe(Effect.mapError(() => new RoleHandlingError({ stage: "eligibility" }))),
            },
            messageReactionRemoveAll: {
                handler: ({ event }) =>
                    Effect.gen(function* () {
                        if (
                            (event.guildId !== undefined && event.guildId !== config.serverId) ||
                            !roleWorker ||
                            !(yield* panelIndex.mayBePanel(event.id))
                        )
                            return
                        yield* roleWorker.enqueue(event.id)
                    }),
            },
            messageReactionRemoveEmoji: {
                handler: ({ event }) =>
                    Effect.gen(function* () {
                        if (
                            (event.guildId !== undefined && event.guildId !== config.serverId) ||
                            !roleWorker ||
                            !(yield* panelIndex.mayBePanel(event.id))
                        )
                            return
                        yield* roleWorker.enqueue(event.id)
                    }),
            },
        },
    } satisfies Pick<BotOptions<unknown>, "setup" | "events">
    return {
        ...options,
        wake: (kind: ServiceWorkKind, passes?: readonly ServiceDashboardWork[]) =>
            wakers[kind]?.(passes) ?? Effect.void,
        intakeReply: (context: BotEventContext<"messageCreate">, intakeNo: number) =>
            tickets
                ? handleTicketCommand(
                      tickets,
                      publishing,
                      config,
                      { type: "intake-reply", intakeNo, text: context.message.content.trim() },
                      context,
                  )
                : Effect.void,
        botMessages: {
            enabled: () => moderationHints?.botMessages() ?? false,
            handle: (event: "create" | "edit", message: Message, client: Client) =>
                moderation
                    ? containProtection(
                          handleBotProtectionMessage(moderation, config, event, message, client),
                          undefined,
                      )
                    : Effect.void,
        },
    }
}
