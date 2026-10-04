import {
    commands,
    MessageType,
    type BotOptions,
    type BotEventContext,
    type Client,
    type EventName,
} from "@neontechspace/fluxerly/effect"
import { Cause, Effect, Exit, Redacted, Scope } from "effect"
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
import { readSafetyAuthority, verifyPrivateAuthor } from "./safety-permissions.ts"
import { admitMemberMessage, containProtection, handleProtectionJoin, trackModerationHints } from "./protections.ts"
import type { ModerationActor } from "@neonflux/contracts/shared"
import { configScope, createServerRuntime, type ServerRuntime } from "./server-runtime.ts"
import { selectServerCommand, validServerId, type DeploymentScope } from "./server-scope.ts"
import {
    createPrefixReader,
    forgetPrefix,
    handlePrefixCommand,
    withPrefix,
    type GeneralSettingsStore,
} from "./general-settings.ts"
import { createMessageRevisions } from "./message-revisions.ts"
import { handleHelpAll, helpAllRequest } from "./help.ts"

/** Backend adapters by feature. Omitted stores use the configured backend, and tests pass in-memory replacements */
interface BotStores {
    readonly afk?: AfkStore | undefined
    readonly responses?: ResponseStore | undefined
    readonly moderation?: ModerationStore | undefined
    readonly general?: GeneralSettingsStore | undefined
}

// Every gateway event a server runtime handles. Each is routed to exactly one runtime and never broadcast
const routedEvents = ["messageCreate", "messageUpdate", "guildMemberAdd"] as const satisfies readonly EventName[]
type ScopedBotOptions = ReturnType<typeof createScopedBotOptions>
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
// Compilation fails when a runtime handler is added without routing it, or the reverse
const routedEventsComplete: Same<keyof ScopedBotOptions["events"], (typeof routedEvents)[number]> = true
void routedEventsComplete

// The SDK caches that evaluation reads, kept current by gateway events and bounded across the whole client
const CACHE = {
    guilds: { maxEntries: 5000, maxBytes: 8388608 },
    members: { maxEntries: 20000, maxBytes: 16777216 },
    // The role limit counts the roles of every server together, and a server's role list is complete only while all of them fit
    roles: { maxEntries: 50000, maxBytes: 16777216 },
    channels: { maxEntries: 20000, maxBytes: 33554432 },
} as const

export function createBotOptions(config: BotRootConfig, stores: BotStores = {}) {
    const scope = configScope(config)
    const runtimes = createRuntimeRegistry(config, scope, stores)
    // Says whether a runtime still serves its server as the registry's current entry
    const serving = (entry: RuntimeEntry) =>
        entry.runtime.active() && runtimes.get(entry.runtime.config.serverId) === entry
    // The scope always names the configured server
    const served = (serverId: string) => serverId === scope.serverIds[0]
    const revisions = createMessageRevisions()
    const events: NonNullable<BotOptions<unknown>["events"]> = {}
    const serverEvent = { concurrency: 1 }
    for (const name of routedEvents) {
        const handler = (context: BotEventContext<EventName>) => {
            const work = Effect.gen(function* () {
                const payload = context.event as unknown as {
                    guildId?: string
                    channelId?: string
                    content?: string
                    channelType?: number
                }
                let guildId = payload.guildId
                if (guildId !== undefined && !served(guildId)) return
                // A link preview or another embed-only update changes nothing a feature reads
                if (name === "messageUpdate" && !revisions.changed((context as BotEventContext<"messageUpdate">).event))
                    return
                let selected: string | undefined
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
                        if (!served(channel.guild_id) || ![0, 2, 4, 5, 10, 11, 12].includes(channel.type as number))
                            return
                        guildId = channel.guild_id
                    } else if (name !== "messageCreate" || channel.type !== 1) return
                }
                if (name === "messageCreate") {
                    selected = selectServerCommand(payload.content ?? "", scope, served, guildId)
                    if (!selected) return
                }
                const serverId = selected ?? guildId
                if (!serverId) return
                const runtime = runtimes.get(serverId)
                if (!runtime) return
                const event = guildId && payload.guildId === undefined ? { ...context.event, guildId } : context.event
                let routed = { ...context, event }
                if (name === "messageCreate") {
                    const original = context as BotEventContext<"messageCreate">
                    const message = {
                        ...original.message,
                        ...(guildId ? { guildId } : {}),
                    }
                    routed = { ...routed, event: message, message } as typeof routed
                }
                const invoke = runtime.options.events[name].handler as (
                    value: BotEventContext<EventName>,
                ) => Effect.Effect<unknown, unknown>
                // A retired or replaced runtime ignores the event
                if (!serving(runtime)) return
                yield* invoke(routed)
            })
            return work
        }
        Object.assign(events, {
            [name]: {
                ...serverEvent,
                handler,
            },
        })
    }
    // Every handler is registered before the gateway connects, so automatic filtering asks Fluxer not to send the other
    // dispatch types, such as typing and presence updates
    return {
        token: Redacted.value(config.token),
        processSignals: true,
        events,
        cache: CACHE,
        gateway: { ignoredEvents: "auto" as const },
        setup: (client: Client) =>
            Effect.gen(function* () {
                yield* runtimes.start(client, yield* Effect.scope)
            }),
    } satisfies BotOptions<unknown>
}

interface RuntimeEntry {
    readonly runtime: ServerRuntime
    readonly options: ScopedBotOptions
    started: boolean
    scope?: Scope.Closeable
}

// Server runtimes by ID, for the configured server
function createRuntimeRegistry(root: BotRootConfig, scope: DeploymentScope, stores: BotStores) {
    const entries = new Map<string, RuntimeEntry>()
    let lifetime: { readonly client: Client; readonly scope: Scope.Scope } | undefined

    function register(serverId: string) {
        const existing = entries.get(serverId)
        if (existing) return existing
        const runtime = createServerRuntime(root, serverId, () => retire(entry))
        const injected = Object.fromEntries(Object.entries(stores).filter(([, store]) => store !== undefined))
        const entry: RuntimeEntry = {
            runtime,
            options: createScopedBotOptions(runtime.config, { ...runtime.adapters, ...injected }),
            started: false,
        }
        entries.set(serverId, entry)
        return entry
    }
    // Retiring stops the runtime's backend requests and event routing. Its stored data stays in the backend
    function retire(entry: RuntimeEntry) {
        const serverId = entry.runtime.config.serverId,
            runtimeScope = entry.scope,
            client = lifetime?.client
        if (entries.get(serverId) === entry) entries.delete(serverId)
        entry.runtime.deactivate()
        if (runtimeScope)
            Effect.runFork(
                Scope.close(runtimeScope, Exit.void).pipe(
                    Effect.andThen(client ? applyDefconPresence(client, entry.runtime.config, undefined) : Effect.void),
                    Effect.catchCause(() => Effect.void),
                ),
            )
    }
    // Setup runs in the server's own scope. A setup failure stops the bot
    const start = (entry: RuntimeEntry) =>
        Effect.gen(function* () {
            if (entry.started || !entry.runtime.active() || !lifetime) return
            const { client, scope: rootScope } = lifetime
            entry.started = true
            const runtimeScope = yield* Scope.fork(rootScope)
            entry.scope = runtimeScope
            yield* Scope.provide(entry.options.setup(client), runtimeScope)
        })
    return {
        get: (serverId: string) => entries.get(serverId),
        start: (client: Client, rootScope: Scope.Scope) =>
            Effect.gen(function* () {
                lifetime = { client, scope: rootScope }
                return yield* start(register(scope.serverIds[0]!))
            }),
    }
}

function createScopedBotOptions(config: BotConfig, stores: BotStores) {
    const tracked = stores.moderation && trackModerationHints(stores.moderation),
        moderation = tracked?.store,
        moderationHints = tracked?.hints
    const { afk: store, responses, general } = stores
    const readPrefix = createPrefixReader(general, config.serverId)
    const unprivilegedActor = (userId: string): ModerationActor => ({
        originServerId: config.serverId,
        userId,
        roleIds: [],
        isOwner: false,
        isAdministrator: false,
        nativePermissionAuthorized: false,
    })
    const options = {
        setup: (client) =>
            Effect.gen(function* () {
                // A retired runtime leaves no per-server memory behind
                yield* Effect.addFinalizer(() => Effect.sync(() => forgetPrefix(config.serverId)))
                if (moderation) yield* initializeModeration(moderation, config, client)
                else yield* applyDefconPresence(client, config, 3)
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
                        const content = message.content.trimStart()
                        const prefix =
                            message.guildId === config.serverId && /^[!$%&*+,.?~^|:/\-]/.test(content)
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
                        const name =
                            commandBody === undefined
                                ? undefined
                                : /^([a-z0-9][a-z0-9_-]*)(?:\s|$)/i.exec(commandBody)?.[1]?.toLowerCase()
                        // `!<command> help all [next]` lists the forms a command's help leaves out. It parses and passes the gates as that command's help
                        const helpAll = typed ? helpAllRequest(name, typed.args) : undefined
                        const command = helpAll ? { ...typed!, args: helpAll.helpArgs } : typed
                        // Parser usage text names the prefix this command was invoked with
                        const usage = <T>(parsed: T): T =>
                            parsed &&
                            typeof parsed === "object" &&
                            "error" in parsed &&
                            typeof parsed.error === "string"
                                ? { ...parsed, error: withPrefix(parsed.error, invocationPrefix!) }
                                : parsed
                        const quotingError = (hint: string) => ({
                            error: `${syntaxProblem} Use ${invocationPrefix}${hint}`,
                        })
                        const safetyName = safetyNames.includes(name as SafetyName) ? (name as SafetyName) : undefined
                        const parsedSafety = safetyName
                            ? command
                                ? usage(parseSafetyCommand(safetyName, command.args))
                                : quotingError(`${safetyName} help for examples`)
                            : undefined
                        const privateInvocation = message.guildId !== config.serverId
                        if (privateInvocation) {
                            if (message.guildId !== undefined || !(safetyName && moderation)) return
                            const verified = yield* verifyPrivateAuthor(
                                context.client,
                                message.channelId,
                                message.author.id,
                            ).pipe(
                                Effect.as(true),
                                Effect.catch(() => Effect.succeed(false)),
                            )
                            if (!verified) return
                        }
                        let protectionUnknown = false
                        if (moderation) {
                            // Independent feature handlers apply their own backend authorization.
                            // The moderation read still supplies presence and native message protection.
                            const gateClass = safetyName
                                ? safetyGateClass(safetyName, parsedSafety!)
                                : name === "prefix" || name === "custom" || name === "auto"
                                  ? "staff"
                                  : "public"
                            // DEFCON 3 admits every command whoever sends it, so the author's authority is read before the gate only while the last
                            // answer reported a raised DEFCON, and after a refusal the hint did not expect
                            const privileged = !(gateClass === "public" || gateClass === "appeal")
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
                            if (!gate.allowed || blocked === true) {
                                if (!privateInvocation && store)
                                    yield* handleAfk(store, config.serverId, context, false, prefix)
                                return
                            }
                            // A message protection could not judge gets no public command or reply
                            protectionUnknown = blocked === "unknown" && gateClass === "public"
                        } else if (privateInvocation) return
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
                                        if (helpAll) {
                                            yield* handleHelpAll(config, prefix, helpAll, context)
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
                                        if (responses) yield* handleResponse(responses, config.serverId, context)
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
                        if (context.event.guildId !== config.serverId) return
                        // Join protection's answer carries the settings, so while the last answer reported join checks on, a checked join needs no gate
                        if (moderation) {
                            const tried = moderationHints!.joinProtection()
                            const checked = tried
                                ? yield* containProtection(handleProtectionJoin(moderation, config, context), undefined)
                                : undefined
                            if (!checked) {
                                const gate = yield* moderation.gate({
                                    serverId: config.serverId,
                                    actor: unprivilegedActor(context.event.userId),
                                    command: "public",
                                })
                                if (gate.joinProtectionEnabled && !tried)
                                    yield* containProtection(
                                        handleProtectionJoin(moderation, config, context),
                                        undefined,
                                    )
                            }
                        }
                    }),
            },
        },
    } satisfies Pick<BotOptions<unknown>, "setup" | "events">
    return options
}
