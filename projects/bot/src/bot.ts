import { commands, MessageType, type BotOptions } from "@neontechspace/fluxerly/effect"
import { Cause, Effect, Exit, Redacted } from "effect"
import { createAfkStore, type AfkStore } from "./afk-store.ts"
import { handleAfk } from "./afk.ts"
import type { BotConfig } from "./config.ts"
import { parseManagement } from "./response-command.ts"
import { createResponseStore, type ResponseStore } from "./responses-store.ts"
import { handleManagement, handleResponse, noMentions } from "./responses.ts"
import { createModerationStore, type ModerationStore } from "./moderation-store.ts"
import { handleSafetyCommand, initializeModeration, moderationActor, applyDefconPresence } from "./moderation.ts"
import { parseSafetyCommand, safetyGateClass, safetyNames, type SafetyName } from "./moderation-command.ts"
import { readSafetyAuthority, verifyPrivateAuthor } from "./safety-permissions.ts"
import { admitMemberMessage, containProtection, handleProtectionJoin, trackModerationHints } from "./protections.ts"
import { moderationGate } from "@neonflux/contracts/moderation"
import type { ModerationActor } from "@neonflux/contracts/shared"
import { createPublishingStore, type PublishingStore } from "./publishing-store.ts"
import { parsePublishingCommand } from "./publishing-command.ts"
import { handlePublishing } from "./publishing.ts"
import { createRolesStore, type RolesStore } from "./roles-store.ts"
import type { RolesSettings } from "@neonflux/contracts/roles"
import { parseRoleCommand, type RoleCommandName } from "./role-command.ts"
import { handleRoleCommand } from "./role-management.ts"
import { handleRoleReaction, handleRoleJoin, RoleHandlingError } from "./roles.ts"
import { startRoleReactionWorker } from "./role-reconciliation.ts"
import { createGreetingsStore, type GreetingsStore } from "./welcome-store.ts"
import { parseGreetingsCommand, greetingsCritical } from "./welcome-command.ts"
import { handleGreetingsCommand } from "./welcome-management.ts"
import { startGreetingsWorker } from "./welcome-worker.ts"
import { observeGreetingJoin, observeGreetingMembership } from "./welcome-events.ts"
import { createSchedulesStore, type SchedulesStore } from "./schedule-store.ts"
import { scheduleCritical } from "./schedule-command.ts"
import { startSchedulesWorker } from "./schedule-worker.ts"
import { createGeneralSettingsStore, createPrefixReader, handlePrefixCommand, withPrefix, type GeneralSettingsStore } from "./general-settings.ts"


/** Backend adapters by feature. Omitted stores use the configured backend, and tests pass in-memory replacements */
export interface BotStores {
    readonly afk?: AfkStore | undefined
    readonly responses?: ResponseStore | undefined
    readonly moderation?: ModerationStore | undefined
    readonly publishing?: PublishingStore | undefined
    readonly roles?: RolesStore | undefined
    readonly greetings?: GreetingsStore | undefined
    readonly schedules?: SchedulesStore | undefined
    readonly general?: GeneralSettingsStore | undefined
}

export function createBotOptions(config: BotConfig, stores: BotStores = {}) {
    const backend = config.backend
    const { afk: store = backend && createAfkStore(backend, config.serverId), responses = backend && createResponseStore(backend), moderation: moderationStore = backend && createModerationStore(backend),
        publishing = backend && createPublishingStore(backend), greetings = backend && createGreetingsStore(backend),
        schedules = backend && createSchedulesStore(backend), general = backend && createGeneralSettingsStore(backend, config.serverId) } = stores
    const tracked = moderationStore && trackModerationHints(moderationStore), moderation = tracked?.store, moderationHints = tracked?.hints
    const readPrefix = createPrefixReader(general, config.serverId)
    let scheduleWorker: Effect.Success<ReturnType<typeof startSchedulesWorker>> | undefined
    let greetingWorker: Effect.Success<ReturnType<typeof startGreetingsWorker>> | undefined
    const roleBackend = stores.roles ?? (backend ? createRolesStore(backend) : undefined)
    // A member event wakes greeting discovery only when its observation recorded a change, so one that changed nothing costs no discovery
    const wake = (userId?: string) => greetingWorker?.notify(userId) ?? Effect.void
    // Whether the last policy or member answer had autorole or rules verification on. Only an answer sets it, so a stale value costs reads, never a skipped join
    let joinWork = false
    const learnJoin = (settings: RolesSettings) => Effect.sync(() => { joinWork = settings.autoroleEnabled || settings.verificationEnabled })
    const roles: RolesStore | undefined = roleBackend && greetings ? {
        manage: (input) => roleBackend.manage(input),
        query: (input) => roleBackend.query(input),
        memberQuery: (input) => roleBackend.memberQuery(input).pipe(Effect.tap(result => learnJoin(result.settings))),
        policy: (input) => roleBackend.policy(input).pipe(Effect.tap(result => learnJoin(result.settings))),
        reactionJobs: (input) => roleBackend.reactionJobs(input),
        dispatch: (input) => roleBackend.dispatch(input),
        observe: (input) => roleBackend.observe(input),
        evaluate: (input) => roleBackend.evaluate(input).pipe(Effect.tap(() => wake(input.context.userId))),
        outcome: (input) => roleBackend.outcome(input).pipe(Effect.tap((value) => value.recorded ? wake() : Effect.void)),
        reconcile: (input) => roleBackend.reconcile(input).pipe(Effect.tap((value) => value.recorded ? wake(input.observation.userId) : Effect.void)),
    } : roleBackend
    let roleWorker: Effect.Success<ReturnType<typeof startRoleReactionWorker>> | undefined
    const unprivilegedActor = (userId: string): ModerationActor => ({ userId, roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: false })
    return {
        token: Redacted.value(config.token),
        processSignals: true,
        setup: (client) => Effect.gen(function* () {
            if (moderation) yield* initializeModeration(moderation, config, client)
            else yield* applyDefconPresence(client, config, 3)
            if (publishing) yield* publishing.observe({ serverId: config.serverId, mode: "restart" })
            if (roles) {
                yield* roles.observe({ serverId: config.serverId, mode: "restart" })
                roleWorker = yield* startRoleReactionWorker(roles, config.serverId, client)
            }
            if (greetings) greetingWorker = yield* startGreetingsWorker(greetings, config.serverId, client)
            if (schedules && publishing) scheduleWorker = yield* startSchedulesWorker(schedules, publishing, config.serverId, client)
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
                    // The fixed prefix remains available for recovery
                    const invocationPrefix = content.startsWith(prefix) ? prefix : /^!prefix(?:\s|$)/i.test(content) ? "!" : undefined
                    const commandBody = invocationPrefix ? content.slice(invocationPrefix.length) : undefined
                    const command = commandBody !== undefined
                        ? commands.parseQuoted({ message, prefix: invocationPrefix!, source: commandBody }) : undefined
                    const name = commandBody === undefined ? undefined : /^([a-z0-9][a-z0-9_-]*)(?:\s|$)/i.exec(commandBody)?.[1]?.toLowerCase()
                    // Parser usage text names the prefix this command was invoked with
                    const usage = <T,>(parsed: T): T => parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string"
                        ? { ...parsed, error: withPrefix(parsed.error, invocationPrefix!) } : parsed
                    const quotingError = (hint: string) => ({ error: `Check quoting and syntax. Use ${invocationPrefix}${hint}` })
                    const safetyName = safetyNames.includes(name as SafetyName) ? name as SafetyName : undefined
                    const parsedSafety = safetyName ? command ? usage(parseSafetyCommand(safetyName, command.args)) : quotingError(`${safetyName} help for examples`) : undefined
                    const parsedPublishing = name === "publish" ? command ? usage(parsePublishingCommand(command.args)) : quotingError("publish help for examples") : undefined
                    const roleName = ["roles", "verify", "autorole"].includes(name ?? "") ? name as RoleCommandName : undefined
                    const parsedRoles = roleName ? command ? usage(parseRoleCommand(roleName, command.args)) : quotingError(`${roleName} help for examples`) : undefined
                    const greetingName = name === "welcome" || name === "goodbye" ? name : undefined
                    const parsedGreeting = greetingName ? command ? usage(parseGreetingsCommand(greetingName, command.args)) : quotingError(`${greetingName} help for examples`) : undefined
                    const privateInvocation = message.guildId !== config.serverId
                    if (privateInvocation) {
                        if (message.guildId !== undefined || !(safetyName && moderation)) return
                        const verified = yield* verifyPrivateAuthor(context.client, message.channelId, message.author.id).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)))
                        if (!verified) return
                    }
                    let protectionUnknown = false
                    if (moderation) {
                        const publishingCritical = parsedPublishing && !("error" in parsedPublishing) && (parsedPublishing.type === "settings" && parsedPublishing.patch.enabled === false
                            || parsedPublishing.type === "reconcile" || parsedPublishing.type === "query" && ["settings", "post-show", "post-list"].includes(parsedPublishing.operation.type)
                            || parsedPublishing.type === "schedule" && scheduleCritical(parsedPublishing.command))
                        const roleCritical = parsedRoles && !("error" in parsedRoles) && (parsedRoles.type === "status" || parsedRoles.type === "jobs" || parsedRoles.type === "resume"
                            || parsedRoles.type === "module" && !parsedRoles.enabled || parsedRoles.type === "member")
                        const rolePublic = parsedRoles && !("error" in parsedRoles) && (parsedRoles.type === "verify" || parsedRoles.type === "choose")
                        // Independent feature handlers apply their own backend authorization and DEFCON policy.
                        // The moderation read still supplies presence and native message protection.
                        const gateClass = safetyName ? safetyGateClass(safetyName, parsedSafety!) : publishingCritical || roleCritical || parsedGreeting && greetingsCritical(parsedGreeting) ? "critical"
                            : greetingName || roleName && !rolePublic || name === "custom" || name === "auto" || name === "publish" ? "staff" : "public"
                        // DEFCON 3 admits every command whoever sends it, so the author's authority is read before the gate only while the last
                        // answer reported a raised DEFCON, and after a refusal the hint did not expect
                        const privileged = !(gateClass === "public" || gateClass === "appeal")
                        const authority = readSafetyAuthority(context.client, config.serverId, message.author.id).pipe(Effect.map(moderationActor))
                        const read = privileged && moderationHints!.defcon() !== 3
                        const admitted = yield* admitMemberMessage(moderation, moderationHints!, config, "create", message, context.client,
                            { actor: read ? yield* authority : unprivilegedActor(message.author.id), command: gateClass }, !privateInvocation)
                        const gate = privileged && !read && !admitted.gate.allowed ? yield* moderation.gate({ serverId: config.serverId, actor: yield* authority, command: gateClass }) : admitted.gate
                        const blocked = admitted.blocked
                        yield* applyDefconPresence(context.client, config, gate.defcon)
                        if (!gate.allowed || blocked === true) {
                            if (!privateInvocation && store) yield* handleAfk(store, config.serverId, context, false, prefix)
                            return
                        }
                        // A message protection could not judge gets no public command or reply
                        protectionUnknown = blocked === "unknown" && gateClass === "public"
                    } else if (privateInvocation) return
                    if (!privateInvocation && name === "prefix" && !protectionUnknown) {
                        yield* handlePrefixCommand(general, config.serverId, command?.args ?? ["invalid quoting"], context)
                        return
                    }
                    if (protectionUnknown) {
                        if (store) yield* handleAfk(store, config.serverId, context, false, prefix)
                        return
                    }
                    const pingExit: Exit.Exit<void, unknown> = name === "ping"
                        ? yield* Effect.exit(reply({ content: "Pong!", allowedMentions: noMentions }).pipe(Effect.asVoid)) : Exit.void
                    if (Exit.isFailure(pingExit) && Cause.hasInterrupts(pingExit.cause)) return yield* Effect.failCause(pingExit.cause)
                    // AFK and responses are independent, so their backend calls run side by side and each keeps its own failure
                    const afk: Effect.Effect<void, unknown> = store && !privateInvocation ? handleAfk(store, config.serverId, context, true, prefix) : Effect.void
                    const [afkExit, responseExit] = yield* Effect.all([Effect.exit(afk), Effect.exit(Effect.gen(function* () {
                        if (name === "afk" || name === "ping") return
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
                    }))], { concurrency: 2 })
                    for (const outcome of [afkExit, responseExit]) if (Exit.isFailure(outcome) && Cause.hasInterrupts(outcome.cause)) return yield* Effect.failCause(outcome.cause)
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
                    if (!moderation || event.guildId !== config.serverId || event.author.isSystem || event.webhookId
                        || (event.type !== MessageType.Default && event.type !== MessageType.Reply)) return
                    yield* admitMemberMessage(moderation, moderationHints!, config, "edit", event, client, { actor: unprivilegedActor(event.author.id), command: "public" })
                }),
            },
            guildMemberAdd: {
                concurrency: 1,
                handler: (context) => Effect.gen(function* () {
                    if (context.event.guildId !== config.serverId) return
                    // Join protection's answer carries the settings, so while the last answer reported join checks on, a checked join needs no gate
                    let allowed = true
                    if (moderation) {
                        const tried = moderationHints!.joinProtection()
                        const checked = tried ? yield* containProtection(handleProtectionJoin(moderation, config, context), undefined) : undefined
                        if (checked) allowed = moderationGate(checked, "public").allowed
                        else {
                            const gate = yield* moderation.gate({ serverId: config.serverId, actor: unprivilegedActor(context.event.userId), command: "public" })
                            allowed = gate.allowed
                            if (gate.joinProtectionEnabled && !tried) yield* containProtection(handleProtectionJoin(moderation, config, context), undefined)
                        }
                    }
                    if (greetings) yield* observeGreetingJoin(greetings, config.serverId, context.client, context.event.userId, context.event.joinedAt)
                        .pipe(Effect.flatMap(recorded => recorded ? wake(context.event.userId) : Effect.void), Effect.catchCause((cause) => Cause.hasInterrupts(cause)
                            ? Effect.failCause(cause) : Effect.logWarning("Greeting admission could not be verified. Existing join protection and role handling remain independent")))
                    if (roles && allowed) {
                        yield* handleRoleJoin(roles, config.serverId, context.client, context.event.userId, context.event.joinedAt, () => joinWork)
                            .pipe(Effect.mapError(() => new RoleHandlingError({ stage: "eligibility" })))
                    }
                }),
            },
            guildMemberRemove: {
                concurrency: 1,
                handler: ({ event, client }) => Effect.gen(function* () {
                    if (event.guildId !== config.serverId) return
                    if (greetings) yield* observeGreetingMembership(greetings, config.serverId, client, event.userId, true).pipe(Effect.flatMap(recorded => recorded ? wake(event.userId) : Effect.void))
                }),
            },
            guildMemberUpdate: {
                concurrency: 1,
                handler: ({ event, client }) => Effect.gen(function* () {
                    if (event.guildId !== config.serverId) return
                    if (greetings) yield* observeGreetingMembership(greetings, config.serverId, client, event.userId).pipe(Effect.flatMap(recorded => recorded ? wake(event.userId) : Effect.void))
                }),
            },
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
