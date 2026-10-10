import { createHash } from "node:crypto"
import type * as C from "@neonflux/backend/contracts"
import { isThreadChannel, Permissions, type BotEventContext, type Client, type GuildMember, type Message } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"
import { actionPermission } from "./action-executor.ts"
import type { BotConfig } from "./config.ts"
import { actionContext, applyDefconPresence, performActionGrant } from "./moderation.ts"
import type { ModerationStore } from "./moderation-store.ts"
import { sourceTimestamp } from "./responses.ts"
import { channelPermissionInput, readAuthenticatedBotId, readSafetyAuthority, type SafetyAuthority } from "./safety-permissions.ts"

export class ProtectionHandlingError extends Data.TaggedError("ProtectionHandlingError")<{ readonly stage: "identity" | "timestamp" | "context" }> {}

// Protection fails closed for itself: it takes no action on an event it could not verify, and the event's other handlers still run
export function containProtection<A, E, R, B = A>(protection: Effect.Effect<A, E, R>, fallback: B) {
    return protection.pipe(Effect.catch(() => Effect.logWarning("Protection could not verify an event and took no action").pipe(Effect.as(fallback))))
}

// Evaluation uses the bot's cached server data. A granted action reads Fluxer again before it acts
function protectionContext(client: Client, serverId: string, userId: string, channelId?: string) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const authority = yield* readSafetyAuthority(client, serverId, botId, { targetId: userId, ...(channelId ? { channelId } : {}), cached: true })
        const target = authority.target
        if (!target) return yield* Effect.fail(new ProtectionHandlingError({ stage: "identity" }))
        const bits = yield* Effect.try(() => client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, ...channelPermissionInput(authority) }))
        const targetBits = yield* Effect.try(() => client.permissions.calculate({ guild: authority.guild, member: target, roles: authority.roles }))
        const actions: C.ModerationActionType[] = ["log", "warn", "delete", "timeout", "quarantine"]
        const botAuthorizedActions = actions.filter((action) => {
            const permission = actionPermission(action)
            return permission === undefined || (bits & permission) === permission
        })
        const context: C.ModerationActionContext = { ...actionContext(authority), botAuthorizedActions }
        const targetIsStaff = target.userId === authority.guild.ownerId || (targetBits & Permissions.Administrator) !== 0n
        return { authority, target, botId, context, roleIds: [...new Set([serverId, ...target.roleIds])], targetIsStaff }
    }).pipe(Effect.mapError(() => new ProtectionHandlingError({ stage: "context" })))
}

// What evaluation reads from the message itself, checked before any read
function messageFacts(config: BotConfig, event: "create" | "edit", message: Message) {
    return Effect.gen(function* () {
        const createdAt = yield* sourceTimestamp(message)
        const editedAt = event === "edit" && message.editedAt ? Date.parse(message.editedAt) : undefined
        if (event === "edit" && (editedAt === undefined || !Number.isSafeInteger(editedAt))) return yield* Effect.fail(new ProtectionHandlingError({ stage: "timestamp" }))
        return {
            serverId: config.serverId, messageId: message.id, createdAt, event, ...(editedAt !== undefined ? { editedAt } : {}),
            userId: message.author.id, channelId: message.channelId, content: message.content,
            contentHash: createHash("sha256").update(message.content).digest("hex"),
            mentionedUserIds: [...new Set((message.mentions ?? []).map((user) => user.id))],
            mentionedRoleIds: message.mentionRoleIds ? [...new Set(message.mentionRoleIds)] : null,
            mentionedEveryone: message.mentionedEveryone ?? null,
        }
    })
}
// The permission read already holds the channel, so a thread's parent costs nothing more
const parent = (channel: SafetyAuthority["channel"]) => isThreadChannel(channel) ? { parentChannelId: channel.parentId } : {}

export function handleProtectionMessage(store: ModerationStore, config: BotConfig, event: "create" | "edit", message: Message, client: Client) {
    return Effect.gen(function* () {
        const facts = yield* messageFacts(config, event, message)
        const identity = yield* protectionContext(client, config.serverId, message.author.id, message.channelId)
        const result = yield* store.evaluate({ ...facts, ...parent(identity.authority.channel), roleIds: identity.roleIds, targetIsStaff: identity.targetIsStaff, context: identity.context })
        if (result.grant) yield* performActionGrant(store, config.serverId, identity.botId, client, result.grant, config)
        return result.blocked
    })
}

/**
 * Automod for a message from a webhook or another bot. NeonFlux's own messages are never evaluated. It reads no member, since
 * a webhook has none, and a granted action can only log or delete the message
 */
export function handleBotProtectionMessage(store: ModerationStore, config: BotConfig, event: "create" | "edit", message: Message, client: Client) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        if (message.author.id === botId) return
        const facts = yield* messageFacts(config, event, message)
        const authority = yield* readSafetyAuthority(client, config.serverId, botId, { channelId: message.channelId, cached: true })
        const bits = yield* Effect.try(() => client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, ...channelPermissionInput(authority) }))
        const botAuthorizedActions = (["log", "delete"] as const).filter((action) => (bits & (actionPermission(action) ?? 0n)) === (actionPermission(action) ?? 0n))
        const result = yield* store.evaluate({ ...facts, ...parent(authority.channel), roleIds: [], targetIsStaff: false, author: message.webhookId ? "webhook" : "bot",
            context: { ...actionContext(authority), botAuthorizedActions } })
        if (result.grant) yield* performActionGrant(store, config.serverId, botId, client, result.grant, config)
    })
}

/**
 * Whether automod checks a server's bot and webhook messages, as the server's startup observation, each gate answer and each
 * chat settings change report it. A bot message then costs no backend call while the check is off. A change made on the
 * dashboard applies from the server's next member message or command
 */
export function trackBotMessageChecks(store: ModerationStore) {
    let enabled = false
    const learn = (settings: C.ModerationSettings) => Effect.sync(() => { enabled = settings.automodEnabled && settings.automodBotMessagesEnabled })
    const tracked: ModerationStore = {
        query: (input) => store.query(input), evaluate: (input) => store.evaluate(input), dispatch: (input) => store.dispatch(input), outcome: (input) => store.outcome(input),
        logOutcome: (input) => store.logOutcome(input), noticeOutcome: (input) => store.noticeOutcome(input), reconcile: (input) => store.reconcile(input),
        memberAppeal: (input) => store.memberAppeal(input), staffAppeal: (input) => store.staffAppeal(input),
        observe: (input) => store.observe(input).pipe(Effect.tap((result) => learn(result.settings))),
        join: (input) => store.join(input).pipe(Effect.tap((result) => learn(result.settings))),
        gate: (input) => store.gate(input).pipe(Effect.tap((result) => Effect.sync(() => { enabled = result.botMessageProtectionEnabled }))),
        manage: (input) => store.manage(input).pipe(Effect.tap((result) => !result.duplicate && result.type === "settings" ? learn(result.settings) : Effect.void)),
    }
    return { enabled: () => enabled, store: tracked }
}

export function handleProtectionJoin(store: ModerationStore, config: BotConfig, context: BotEventContext<"guildMemberAdd">) {
    return Effect.gen(function* () {
        const member: GuildMember = context.event
        if (member.guildId !== config.serverId) return
        const user = yield* context.client.users.fetch(member.userId, { timeoutMs: 5000 })
        if (user.id !== member.userId) return yield* Effect.fail(new ProtectionHandlingError({ stage: "identity" }))
        if (user.isBot || user.isSystem) return
        const joinedAt = Date.parse(member.joinedAt)
        if (!Number.isSafeInteger(joinedAt) || joinedAt < 0) return yield* Effect.fail(new ProtectionHandlingError({ stage: "timestamp" }))
        const identity = yield* protectionContext(context.client, config.serverId, member.userId)
        const result = yield* store.join({ serverId: config.serverId, userId: member.userId, joinedAt, targetIsStaff: identity.targetIsStaff, context: identity.context })
        yield* applyDefconPresence(context.client, config, result.settings.defcon)
        if (result.grant) yield* performActionGrant(store, config.serverId, identity.botId, context.client, result.grant, config)
    })
}
