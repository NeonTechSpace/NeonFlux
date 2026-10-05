import { commands, MessageType, type BotOptions, type BotEventContext, type EventName } from "@neontechspace/fluxerly/effect"
import { Cause, Effect, Exit, Redacted, Scope } from "effect"
import type { AfkStore } from "./afk-store.ts"
import { handleAfk } from "./afk.ts"
import type { BotConfig } from "./config.ts"
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
import { configScope, createServerRuntimeRegistry, verifyBackendScope } from "./server-runtime.ts"
import { selectServerCommand, serverReply, validServerId } from "./server-scope.ts"
import { createPrefixReader, handlePrefixCommand, withPrefix, type GeneralSettingsStore } from "./general-settings.ts"
import { createDashboardPanelPublisher, startDashboardRolesWorker } from "./dashboard-roles.ts"

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
}

export function createBotOptions(config: BotConfig, stores: BotStores = {}) {
    const scope = configScope(config)
    const registry = createServerRuntimeRegistry(config)
    const options = new Map([...registry].map(([id, runtime]) => {
        const scopedStores = scope.mode === "single" ? { ...runtime.adapters, ...Object.fromEntries(Object.entries(stores).filter(([, store]) => store !== undefined)) } : runtime.adapters ?? {}
        return [id, createScopedBotOptions(runtime.config, scopedStores)] as const
    }))
    const first = options.values().next().value!
    const events: NonNullable<BotOptions<unknown>["events"]> = {}
    // Each wrapper selects exactly one scoped handler. No unscoped event is broadcast.
    for (const name of Object.keys(first.events) as (keyof typeof first.events)[]) {
        const handler = (context: BotEventContext<EventName>) => {
            const work = Effect.gen(function* () {
                const payload = context.event as unknown as { guildId?: string, channelId?: string, id?: string, content?: string }
                let guildId = payload.guildId ?? (name === "guildUpdate" ? payload.id : undefined)
                if (guildId !== undefined && !registry.has(guildId)) return
                let selected: ReturnType<typeof selectServerCommand>
                if (name === "messageCreate") {
                    const messageContext = context as BotEventContext<"messageCreate">
                    if (messageContext.message.author.isSystem || messageContext.message.webhookId
                        || messageContext.message.type !== MessageType.Default && messageContext.message.type !== MessageType.Reply) return
                    // Selector validation precedes private reads and feature admission.
                    selected = selectServerCommand(messageContext.message.content, scope, guildId)
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
                        if (!validServerId(channel.guild_id) || !registry.has(channel.guild_id) || ![0, 2, 4, 5].includes(channel.type as number)) return
                        guildId = channel.guild_id
                    } else if (name !== "messageCreate" || channel.type !== 1) return
                }
                if (name === "messageCreate") {
                    selected = selectServerCommand(payload.content ?? "", scope, guildId)
                    if (selected && "error" in selected) { yield* (context as BotEventContext<"messageCreate">).reply({ content: selected.error, allowedMentions: noMentions }); return }
                    if (!selected) return
                }
                const serverId = selected && !("error" in selected) ? selected.serverId : guildId
                if (!serverId) return
                const runtime = registry.get(serverId), scoped = options.get(serverId)
                if (!runtime?.active() || !scoped) return
                const event = guildId && payload.guildId === undefined ? { ...context.event, guildId } : context.event
                let routed = { ...context, event }
                if (name === "messageCreate") {
                    const original = context as BotEventContext<"messageCreate">
                    const message = { ...original.message, ...(guildId ? { guildId } : {}), content: selected && !("error" in selected) ? selected.content : original.message.content }
                    const reply: typeof original.reply = (input, settings) => original.reply(scope.mode === "multi" && !guildId
                        ? typeof input === "string" ? serverReply(input, serverId) : { ...input, ...(input.content ? { content: serverReply(input.content, serverId) } : {}) } : input, settings)
                    routed = { ...routed, event: message, message, reply } as typeof routed
                }
                const invoke = scoped.events[name].handler as (value: BotEventContext<EventName>) => Effect.Effect<unknown, unknown>
                yield* invoke(routed)
                })
            return work
        }
        Object.assign(events, { [name]: { concurrency: scope.mode === "multi" ? 2 : 1, ...(scope.mode === "multi" ? { partition: "guild" as const } : {}), handler } })
    }
    return { ...first, ...(scope.mode === "multi" ? { rest: { concurrency: 4, mediaConcurrency: 1, maxQueued: 64, queuedJsonMaxBytes: 4194304 } } : {}), events,
        setup: (client: Parameters<typeof first.setup>[0]) => Effect.gen(function* () {
            yield* verifyBackendScope(config)
            for (const [id, scoped] of options) {
                const runtimeScope = yield* Scope.fork(yield* Effect.scope)
                registry.get(id)!.onRetire(() => { Effect.runFork(Scope.close(runtimeScope, Exit.void).pipe(Effect.andThen(applyDefconPresence(client, registry.get(id)!.config, undefined)), Effect.catchCause(() => Effect.void))) })
                yield* Scope.provide(scoped.setup(client), runtimeScope).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
                    : scope.mode === "single" ? Effect.failCause(cause) : Effect.logWarning(`Server ${id} startup recovery paused`)))
            }
        }) } satisfies BotOptions<unknown>
}

function createScopedBotOptions(config: BotConfig, stores: BotStores) {
    const { afk: store, responses, moderation, publishing, greetings, tickets, leveling: levels, events, schedules, milestones, suggestions, cleanup, metadata,
        backup: backups, general } = stores
    const readPrefix = createPrefixReader(general, config.serverId)
    let metadataWorker: Effect.Success<ReturnType<typeof startMetadataLogsWorker>> | undefined
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
    const unprivilegedActor = (userId: string): ModerationActor => ({ originServerId: config.serverId, userId, roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: false })
    return {
        token: Redacted.value(config.token),
        processSignals: true,
        setup: (client) => Effect.gen(function* () {
            backupScope = yield* Effect.scope
            if (moderation) yield* initializeModeration(moderation, config, client)
            else yield* applyDefconPresence(client, config, 3)
            if (publishing) yield* publishing.observe({ serverId: config.serverId, mode: "restart" })
            if (config.backend) yield* startDashboardRolesWorker(config, client, publishing ? createDashboardPanelPublisher(config, client, publishing) : undefined, publishing)
            if (roles) {
                yield* roles.observe({ serverId: config.serverId, mode: "restart" })
                roleWorker = yield* startRoleReactionWorker(roles, config.serverId, client)
            }
            if (greetings) greetingWorker = yield* startGreetingsWorker(greetings, config.serverId, client)
            if (events && publishing) eventWorker = yield* startEventsWorker(events, publishing, config.serverId, client)
            if (schedules && publishing) scheduleWorker = yield* startSchedulesWorker(schedules, publishing, config.serverId, client)
            if (milestones && publishing) milestoneWorker = yield* startMilestonesWorker(milestones, publishing, config.serverId, client)
            if (suggestions && publishing) suggestionWorker = yield* startSuggestionsWorker(suggestions, publishing, config.serverId, client)
            if (cleanup) cleanupWorker = yield* startCleanupWorker(cleanup, config.serverId, client)
            if (metadata) metadataWorker = yield* startMetadataLogsWorker(metadata, config.serverId, client)
            if (levels) {
                if (roles) levelRewards = yield* startLevelRoleWorker(levels, roles, config.serverId, client)
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
                    const content = message.content.trimStart()
                    const prefix = message.guildId === config.serverId && /^[!$%&*+,.?~^|:/\-]/.test(content) ? yield* readPrefix : "!"
                    // The fixed prefix remains available for recovery and private server selection
                    const invocationPrefix = content.startsWith(prefix) ? prefix : /^!prefix(?:\s|$)/i.test(content) ? "!" : undefined
                    const commandBody = invocationPrefix ? content.slice(invocationPrefix.length) : undefined
                    const command = commandBody !== undefined
                        ? commands.parseQuoted({ message, prefix: invocationPrefix!, source: commandBody }) : undefined
                    const name = commandBody === undefined ? undefined : /^([a-z0-9][a-z0-9_-]*)(?:\s|$)/i.exec(commandBody)?.[1]?.toLowerCase()
                    // Parser usage text names the prefix this command was invoked with
                    const usage = <T,>(parsed: T): T => parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string"
                        ? { ...parsed, error: withPrefix(parsed.error, invocationPrefix!) } : parsed
                    const quotingError = (hint: string) => ({ error: `Check quoting and syntax. Use ${invocationPrefix}${hint}` })
                    if (name === "backup") {
                        // Backups run beside the serial message handler, so a long export never blocks other commands
                        const backup = handleBackupCommand(backups, config, command ? parseBackupCommand(command.args) : { error: "Check quoting and syntax. Use !backup help privately" }, context)
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
                    const greetingName = name === "welcome" || name === "goodbye" ? name : undefined
                    const parsedGreeting = greetingName ? command ? usage(parseGreetingsCommand(greetingName, command.args)) : quotingError(`${greetingName} help for examples`) : undefined
                    const parsedTicket = name === "ticket" ? command ? usage(parseTicketCommand(command.args)) : quotingError("ticket help for examples") : undefined
                    const parsedMilestone = name === "milestone" ? command ? usage(parseMilestoneCommand(command.args)) : quotingError("milestone help in private") : undefined
                    const parsedSuggestion = name === "suggest" ? command ? usage(parseSuggestionCommand(command.args)) : quotingError("suggest help") : undefined
                    const parsedCleanup = name === "cleanup" ? command ? usage(parseCleanupCommand(command.args)) : quotingError("cleanup help") : undefined
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
                        const gateClass = metadataInvocation || name === "ticket" || name === "milestone" || name === "cleanup" ? "critical" : safetyName ? safetyGateClass(safetyName, parsedSafety!) : publishingCritical || roleCritical || levelCritical || parsedGreeting && greetingsCritical(parsedGreeting) || parsedEvent && eventCritical(parsedEvent) || parsedSuggestion && suggestionCritical(parsedSuggestion) ? "critical"
                            : greetingName || roleName && !rolePublic || name === "custom" || name === "auto" || name === "publish" || levelName === "level" || parsedEvent && !eventPublic(parsedEvent) || parsedSuggestion && !("error" in parsedSuggestion) && !suggestionPublic(parsedSuggestion) ? "staff" : "public"
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
                            else if (!command) yield* reply({ content: `Check quoting and syntax. Use ${invocationPrefix}${levelName === "level" ? "level help" : levelName} for examples`, allowedMentions: noMentions })
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
            guildChannelDelete: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("guildChannelDelete", event, client) ?? Effect.void },
            guildChannelUpdateBulk: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("guildChannelUpdateBulk", event, client) ?? Effect.void },
            guildUpdate: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("guildUpdate", event, client) ?? Effect.void },
            guildAuditLogEntryCreate: { concurrency: 1, handler: ({ event, client }) => admitMetadata?.("guildAuditLogEntryCreate", event, client) ?? Effect.void },
            messageReactionAdd: {
                concurrency: 1,
                handler: ({ event, client }) => Effect.gen(function* () {
                    if (!roles) return
                    yield* handleRoleReaction(roles, config.serverId, client, event, event.userId)
                }).pipe(Effect.mapError(() => new RoleHandlingError({ stage: "eligibility" }))),
            },
            messageReactionAddMany: {
                concurrency: 1,
                handler: ({ event, client }) => Effect.gen(function* () {
                    if (!roles) return
                    for (const userId of new Set(event.reactions.map((reaction) => reaction.userId))) {
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
}
