import { createHash } from "node:crypto"
import {
    moderationGate,
    type ModerationActionContext,
    type ModerationActionType,
    type ModerationGateRequest,
    type ModerationGateResult,
    type ModerationSettings,
} from "@neonflux/contracts/moderation"
import {
    permissionBits,
    isThreadChannel,
    type BotEventContext,
    type Client,
    type GuildMember,
    type Message,
} from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"
import { actionPermission } from "./action-executor.ts"
import type { BotConfig } from "./config.ts"
import { actionContext, applyDefconPresence, performActionGrant } from "./moderation.ts"
import type { ModerationStore } from "./moderation-store.ts"
import { sourceTimestamp } from "./responses.ts"
import {
    channelPermissionInput,
    readAuthenticatedBotId,
    readSafetyAuthority,
    type SafetyAuthority,
} from "./safety-permissions.ts"
import { warnFailure } from "./contained.ts"

class ProtectionHandlingError extends Data.TaggedError("ProtectionHandlingError")<{
    readonly stage: "identity" | "timestamp" | "context"
}> {}

// Protection fails closed for itself: it takes no action on an event it could not verify, and the event's other handlers still run
export function containProtection<A, E, R, B = A>(protection: Effect.Effect<A, E, R>, fallback: B) {
    return protection.pipe(
        Effect.catch((error) =>
            warnFailure("Protection could not verify an event and took no action", error).pipe(Effect.as(fallback)),
        ),
    )
}

// Evaluation uses the bot's cached server data. A granted action reads Fluxer again before it acts
function protectionContext(client: Client, serverId: string, userId: string, channelId?: string) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const authority = yield* readSafetyAuthority(client, serverId, botId, {
            targetId: userId,
            ...(channelId ? { channelId } : {}),
            cached: true,
        })
        const target = authority.target
        if (!target) return yield* Effect.fail(new ProtectionHandlingError({ stage: "identity" }))
        const bits = yield* Effect.try(() =>
            client.permissions.calculate({
                guild: authority.guild,
                member: authority.bot,
                roles: authority.roles,
                ...channelPermissionInput(authority),
            }),
        )
        const targetBits = yield* Effect.try(() =>
            client.permissions.calculate({ guild: authority.guild, member: target, roles: authority.roles }),
        )
        const actions: ModerationActionType[] = ["log", "warn", "delete", "timeout", "quarantine"]
        const botAuthorizedActions = actions.filter((action) => {
            const permission = actionPermission(action)
            return permission === undefined || (bits & permission) === permission
        })
        const context: ModerationActionContext = { ...actionContext(authority), botAuthorizedActions }
        const targetIsStaff =
            target.userId === authority.guild.ownerId || permissionBits.has(targetBits, "Administrator")
        return {
            authority,
            target,
            botId,
            context,
            roleIds: [...new Set([serverId, ...target.roleIds])],
            targetIsStaff,
        }
    }).pipe(Effect.mapError(() => new ProtectionHandlingError({ stage: "context" })))
}

// What evaluation reads from the message itself, checked before any read
function messageFacts(config: BotConfig, event: "create" | "edit", message: Message) {
    return Effect.gen(function* () {
        const createdAt = yield* sourceTimestamp(message)
        const editedAt = event === "edit" && message.editedAt ? Date.parse(message.editedAt) : undefined
        if (event === "edit" && (editedAt === undefined || !Number.isSafeInteger(editedAt)))
            return yield* Effect.fail(new ProtectionHandlingError({ stage: "timestamp" }))
        return {
            serverId: config.serverId,
            messageId: message.id,
            createdAt,
            event,
            ...(editedAt !== undefined ? { editedAt } : {}),
            userId: message.author.id,
            channelId: message.channelId,
            content: message.content,
            contentHash: createHash("sha256").update(message.content).digest("hex"),
            mentionedUserIds: [...new Set((message.mentions ?? []).map((user) => user.id))],
            mentionedRoleIds: message.mentionRoleIds ? [...new Set(message.mentionRoleIds)] : null,
            mentionedEveryone: message.mentionedEveryone ?? null,
        }
    })
}
// The permission read already holds the channel, so a thread's parent costs nothing more
const parent = (channel: SafetyAuthority["channel"]) =>
    isThreadChannel(channel) ? { parentChannelId: channel.parentId } : {}

type GateRequest = Omit<ModerationGateRequest, "serverId">

function evaluateMemberMessage(
    store: ModerationStore,
    config: BotConfig,
    event: "create" | "edit",
    message: Message,
    client: Client,
    gate?: GateRequest,
) {
    return Effect.gen(function* () {
        const facts = yield* messageFacts(config, event, message)
        const identity = yield* protectionContext(client, config.serverId, message.author.id, message.channelId)
        const result = yield* store.evaluate({
            ...facts,
            ...parent(identity.authority.channel),
            roleIds: identity.roleIds,
            targetIsStaff: identity.targetIsStaff,
            context: identity.context,
            ...(gate ? { gate } : {}),
        })
        return { result, botId: identity.botId }
    })
}
const grantOf = (
    store: ModerationStore,
    config: BotConfig,
    client: Client,
    { result, botId }: Effect.Success<ReturnType<typeof evaluateMemberMessage>>,
) =>
    result.grant
        ? performActionGrant(store, config.serverId, botId, client, result.grant, config).pipe(
              Effect.as(result.blocked),
          )
        : Effect.succeed(result.blocked)

function handleProtectionMessage(
    store: ModerationStore,
    config: BotConfig,
    event: "create" | "edit",
    message: Message,
    client: Client,
) {
    return evaluateMemberMessage(store, config, event, message, client).pipe(
        Effect.flatMap((evaluated) => grantOf(store, config, client, evaluated)),
    )
}

/**
 * The gate answer for a member's message and, while message protection is on, the protection verdict. While the last answer
 * reported protection on, one evaluation answers both. Otherwise the gate answers alone, and a stale hint costs one more call,
 * never a skipped check. A protection that could not judge the message reports unknown, as containProtection does
 */
export function admitMemberMessage(
    store: ModerationStore,
    hints: ModerationHints,
    config: BotConfig,
    event: "create" | "edit",
    message: Message,
    client: Client,
    gate: GateRequest,
    protect = true,
) {
    return Effect.gen(function* () {
        const tried = protect && hints.messageProtection()
        if (tried) {
            const evaluated = yield* containProtection(
                evaluateMemberMessage(store, config, event, message, client, gate),
                undefined,
            )
            if (evaluated) {
                const blocked = yield* containProtection(grantOf(store, config, client, evaluated), "unknown" as const)
                return {
                    gate: evaluated.result.gate ?? (yield* store.gate({ serverId: config.serverId, ...gate })),
                    blocked,
                }
            }
        }
        const answer = yield* store.gate({ serverId: config.serverId, ...gate })
        const blocked =
            !protect || !answer.messageProtectionEnabled
                ? false
                : tried
                  ? ("unknown" as const)
                  : yield* containProtection(
                        handleProtectionMessage(store, config, event, message, client),
                        "unknown" as const,
                    )
        return { gate: answer, blocked }
    })
}

/**
 * Automod for a message from a webhook or another bot. NeonFlux's own messages are never evaluated. It reads no member, since
 * a webhook has none, and a granted action can only log or delete the message
 */
export function handleBotProtectionMessage(
    store: ModerationStore,
    config: BotConfig,
    event: "create" | "edit",
    message: Message,
    client: Client,
) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        if (message.author.id === botId) return
        const facts = yield* messageFacts(config, event, message)
        const authority = yield* readSafetyAuthority(client, config.serverId, botId, {
            channelId: message.channelId,
            cached: true,
        })
        const bits = yield* Effect.try(() =>
            client.permissions.calculate({
                guild: authority.guild,
                member: authority.bot,
                roles: authority.roles,
                ...channelPermissionInput(authority),
            }),
        )
        const botAuthorizedActions = (["log", "delete"] as const).filter(
            (action) => (bits & (actionPermission(action) ?? 0n)) === (actionPermission(action) ?? 0n),
        )
        const result = yield* store.evaluate({
            ...facts,
            ...parent(authority.channel),
            roleIds: [],
            targetIsStaff: false,
            author: message.webhookId ? "webhook" : "bot",
            context: { ...actionContext(authority), botAuthorizedActions },
        })
        if (result.grant) yield* performActionGrant(store, config.serverId, botId, client, result.grant, config)
    })
}

/** What the last moderation answer reported. Undefined until the first answer */
export interface ModerationHints {
    readonly botMessages: () => boolean
    readonly messageProtection: () => boolean
    readonly joinProtection: () => boolean
    readonly defcon: () => 1 | 2 | 3 | undefined
}

/**
 * The gate flags and DEFCON level as the server's startup observation, each gate, evaluation and join answer and each chat
 * settings change report them. A bot message costs no backend call while bot message checks are off, and the other hints only
 * choose which call answers first, since every member message and join still asks the backend. A change made on the dashboard
 * applies from the server's next answer
 */
export function trackModerationHints(store: ModerationStore) {
    let gate: ModerationGateResult | undefined
    const learn = (answer: ModerationGateResult | undefined) =>
        Effect.sync(() => {
            if (answer) gate = answer
        })
    const settings = (value: ModerationSettings) => learn(moderationGate(value, "public"))
    const tracked: ModerationStore = {
        ...store,
        evaluate: (input) => store.evaluate(input).pipe(Effect.tap((result) => learn(result.gate))),
        observe: (input) => store.observe(input).pipe(Effect.tap((result) => settings(result.settings))),
        join: (input) => store.join(input).pipe(Effect.tap((result) => settings(result.settings))),
        gate: (input) => store.gate(input).pipe(Effect.tap(learn)),
        manage: (input) =>
            store
                .manage(input)
                .pipe(
                    Effect.tap((result) =>
                        !result.duplicate && result.type === "settings" ? settings(result.settings) : Effect.void,
                    ),
                ),
    }
    const hints: ModerationHints = {
        botMessages: () => gate?.botMessageProtectionEnabled ?? false,
        messageProtection: () => gate?.messageProtectionEnabled ?? true,
        joinProtection: () => gate?.joinProtectionEnabled ?? true,
        defcon: () => gate?.defcon,
    }
    return { hints, store: tracked }
}

/** Join protection for a new member. Its answer carries the settings, which are undefined when the member was not checked */
export function handleProtectionJoin(
    store: ModerationStore,
    config: BotConfig,
    context: BotEventContext<"guildMemberAdd">,
): Effect.Effect<ModerationSettings | undefined, unknown> {
    return Effect.gen(function* () {
        const member: GuildMember = context.event
        if (member.guildId !== config.serverId) return
        const user = yield* context.client.users.fetch(member.userId, { timeoutMs: 5000 })
        if (user.id !== member.userId) return yield* Effect.fail(new ProtectionHandlingError({ stage: "identity" }))
        if (user.isBot || user.isSystem) return
        const joinedAt = Date.parse(member.joinedAt)
        if (!Number.isSafeInteger(joinedAt) || joinedAt < 0)
            return yield* Effect.fail(new ProtectionHandlingError({ stage: "timestamp" }))
        const identity = yield* protectionContext(context.client, config.serverId, member.userId)
        const result = yield* store.join({
            serverId: config.serverId,
            userId: member.userId,
            joinedAt,
            targetIsStaff: identity.targetIsStaff,
            context: identity.context,
        })
        yield* applyDefconPresence(context.client, config, result.settings.defcon)
        if (result.grant)
            yield* performActionGrant(store, config.serverId, identity.botId, context.client, result.grant, config)
        return result.settings
    })
}
