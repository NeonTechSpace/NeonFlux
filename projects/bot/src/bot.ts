import { commands, MessageType, type BotOptions } from "@neontechspace/fluxerly/effect"
import { Cause, Effect, Exit, Redacted } from "effect"
import { createAfkStore, type AfkStore } from "./afk-store.ts"
import { handleAfk } from "./afk.ts"
import type { BotConfig } from "./config.ts"
import { parseManagement } from "./response-command.ts"
import { createResponseStore, type ResponseStore } from "./responses-store.ts"
import { handleManagement, handleResponse, noMentions } from "./responses.ts"
import { createGeneralSettingsStore, createPrefixReader, handlePrefixCommand, withPrefix, type GeneralSettingsStore } from "./general-settings.ts"


/** Backend adapters by feature. Omitted stores use the configured backend, and tests pass in-memory replacements */
export interface BotStores {
    readonly afk?: AfkStore | undefined
    readonly responses?: ResponseStore | undefined
    readonly general?: GeneralSettingsStore | undefined
}

export function createBotOptions(config: BotConfig, stores: BotStores = {}) {
    const backend = config.backend
    const { afk: store = backend && createAfkStore(backend, config.serverId), responses = backend && createResponseStore(backend),
        general = backend && createGeneralSettingsStore(backend, config.serverId) } = stores
    const readPrefix = createPrefixReader(general, config.serverId)
    return {
        token: Redacted.value(config.token),
        processSignals: true,
        events: {
            messageCreate: {
                concurrency: 1,
                handler: (context) => Effect.gen(function* () {
                    const { message, reply } = context
                    if (message.guildId !== config.serverId || message.author.isSystem || message.webhookId
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
                    if (name === "prefix") {
                        yield* handlePrefixCommand(general, config.serverId, command?.args ?? ["invalid quoting"], context)
                        return
                    }
                    const pingExit: Exit.Exit<void, unknown> = name === "ping"
                        ? yield* Effect.exit(reply({ content: "Pong!", allowedMentions: noMentions }).pipe(Effect.asVoid)) : Exit.void
                    if (Exit.isFailure(pingExit) && Cause.hasInterrupts(pingExit.cause)) return yield* Effect.failCause(pingExit.cause)
                    const afkExit: Exit.Exit<void, unknown> = store ? yield* Effect.exit(handleAfk(store, config.serverId, context, prefix)) : Exit.void
                    if (Exit.isFailure(afkExit) && Cause.hasInterrupts(afkExit.cause)) return yield* Effect.failCause(afkExit.cause)
                    const responseExit: Exit.Exit<void, unknown> = yield* Effect.exit(Effect.gen(function* () {
                        if (name === "afk" || name === "ping") return
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
        },
    } satisfies BotOptions<unknown>
}
