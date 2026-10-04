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
import { containProtection, handleProtectionJoin, handleProtectionMessage } from "./protections.ts"
import type { ModerationActor } from "@neonflux/backend/contracts"
import { createPublishingStore, type PublishingStore } from "./publishing-store.ts"
import { parsePublishingCommand } from "./publishing-command.ts"
import { handlePublishing } from "./publishing.ts"
import { createRolesStore, type RolesStore } from "./roles-store.ts"
import { parseRoleCommand, type RoleCommandName } from "./role-command.ts"
import { handleRoleCommand } from "./role-management.ts"
import { handleRoleReaction, handleRoleJoin, RoleHandlingError } from "./roles.ts"
import { startRoleReactionWorker } from "./role-reconciliation.ts"
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
    readonly schedules?: SchedulesStore | undefined
    readonly general?: GeneralSettingsStore | undefined
}

export function createBotOptions(config: BotConfig, stores: BotStores = {}) {
    const backend = config.backend
    const { afk: store = backend && createAfkStore(backend, config.serverId), responses = backend && createResponseStore(backend), moderation = backend && createModerationStore(backend),
        publishing = backend && createPublishingStore(backend),
        schedules = backend && createSchedulesStore(backend), general = backend && createGeneralSettingsStore(backend, config.serverId) } = stores
    const readPrefix = createPrefixReader(general, config.serverId)
    let scheduleWorker: Effect.Success<ReturnType<typeof startSchedulesWorker>> | undefined
    const roles = stores.roles ?? (backend ? createRolesStore(backend) : undefined)
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
                        const gateClass = safetyName ? safetyGateClass(safetyName, parsedSafety!) : publishingCritical || roleCritical ? "critical"
                            : roleName && !rolePublic || name === "custom" || name === "auto" || name === "publish" ? "staff" : "public"
                        const actor = gateClass === "public" || gateClass === "appeal" ? unprivilegedActor(message.author.id)
                            : moderationActor(yield* readSafetyAuthority(context.client, config.serverId, message.author.id))
                        const gate = yield* moderation.gate({ serverId: config.serverId, actor, command: gateClass })
                        yield* applyDefconPresence(context.client, config, gate.defcon)
                        const blocked = !privateInvocation && gate.messageProtectionEnabled
                            ? yield* containProtection(handleProtectionMessage(moderation, config, "create", message, context.client), "unknown" as const) : false
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
                    const afkExit: Exit.Exit<void, unknown> = store && !privateInvocation ? yield* Effect.exit(handleAfk(store, config.serverId, context, true, prefix)) : Exit.void
                    if (Exit.isFailure(afkExit) && Cause.hasInterrupts(afkExit.cause)) return yield* Effect.failCause(afkExit.cause)
                    const responseExit: Exit.Exit<void, unknown> = yield* Effect.exit(Effect.gen(function* () {
                        if (name === "afk" || name === "ping") return
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
                    if (!moderation || event.guildId !== config.serverId || event.author.isSystem || event.webhookId
                        || (event.type !== MessageType.Default && event.type !== MessageType.Reply)) return
                    const gate = yield* moderation.gate({ serverId: config.serverId, actor: unprivilegedActor(event.author.id), command: "public" })
                    if (gate.messageProtectionEnabled) yield* containProtection(handleProtectionMessage(moderation, config, "edit", event, client), false)
                }),
            },
            guildMemberAdd: {
                concurrency: 1,
                handler: (context) => Effect.gen(function* () {
                    if (context.event.guildId !== config.serverId) return
                    const gate = moderation ? yield* moderation.gate({ serverId: config.serverId, actor: unprivilegedActor(context.event.userId), command: "public" }) : undefined
                    if (moderation && gate?.joinProtectionEnabled) yield* containProtection(handleProtectionJoin(moderation, config, context), undefined)
                    if (roles && (!gate || gate.allowed)) {
                        yield* handleRoleJoin(roles, config.serverId, context.client, context.event.userId, context.event.joinedAt)
                            .pipe(Effect.mapError(() => new RoleHandlingError({ stage: "eligibility" })))
                    }
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
