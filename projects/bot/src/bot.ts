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
import { createGeneralSettingsStore, createPrefixReader, handlePrefixCommand, withPrefix, type GeneralSettingsStore } from "./general-settings.ts"


/** Backend adapters by feature. Omitted stores use the configured backend, and tests pass in-memory replacements */
export interface BotStores {
    readonly afk?: AfkStore | undefined
    readonly responses?: ResponseStore | undefined
    readonly moderation?: ModerationStore | undefined
    readonly general?: GeneralSettingsStore | undefined
}

export function createBotOptions(config: BotConfig, stores: BotStores = {}) {
    const backend = config.backend
    const { afk: store = backend && createAfkStore(backend, config.serverId), responses = backend && createResponseStore(backend), moderation = backend && createModerationStore(backend),
        general = backend && createGeneralSettingsStore(backend, config.serverId) } = stores
    const readPrefix = createPrefixReader(general, config.serverId)
    const unprivilegedActor = (userId: string): ModerationActor => ({ userId, roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: false })
    return {
        token: Redacted.value(config.token),
        processSignals: true,
        setup: (client) => Effect.gen(function* () {
            if (moderation) yield* initializeModeration(moderation, config, client)
            else yield* applyDefconPresence(client, config, 3)
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
                    const privateInvocation = message.guildId !== config.serverId
                    if (privateInvocation) {
                        if (message.guildId !== undefined || !(safetyName && moderation)) return
                        const verified = yield* verifyPrivateAuthor(context.client, message.channelId, message.author.id).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)))
                        if (!verified) return
                    }
                    let protectionUnknown = false
                    if (moderation) {
                        // Independent feature handlers apply their own backend authorization and DEFCON policy.
                        // The moderation read still supplies presence and native message protection.
                        const gateClass = safetyName ? safetyGateClass(safetyName, parsedSafety!)
                            : name === "custom" || name === "auto" ? "staff" : "public"
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
                }),
            },
        },
    } satisfies BotOptions<unknown>
}
