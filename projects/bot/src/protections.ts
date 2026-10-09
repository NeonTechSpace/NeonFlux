import { createHash } from "node:crypto"
import type * as C from "@neonflux/backend/contracts"
import { Permissions, type BotEventContext, type Client, type GuildMember, type Message } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"
import { actionPermission } from "./action-executor.ts"
import type { BotConfig } from "./config.ts"
import { actionContext, applyDefconPresence, performActionGrant } from "./moderation.ts"
import type { ModerationStore } from "./moderation-store.ts"
import { sourceTimestamp } from "./responses.ts"
import { channelPermissionInput, readAuthenticatedBotId, readSafetyAuthority } from "./safety-permissions.ts"

export class ProtectionHandlingError extends Data.TaggedError("ProtectionHandlingError")<{ readonly stage: "identity" | "timestamp" | "context" }> {}

// Protection fails closed for itself: it takes no action on an event it could not verify, and the event's other handlers still run
export function containProtection<A, E, R, B = A>(protection: Effect.Effect<A, E, R>, fallback: B) {
    return protection.pipe(Effect.catch(() => Effect.logWarning("Protection could not verify an event and took no action").pipe(Effect.as(fallback))))
}

function protectionContext(client: Client, serverId: string, userId: string, channelId?: string) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const authority = yield* readSafetyAuthority(client, serverId, botId, { targetId: userId, ...(channelId ? { channelId } : {}) })
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

export function handleProtectionMessage(store: ModerationStore, config: BotConfig, event: "create" | "edit", message: Message, client: Client) {
    return Effect.gen(function* () {
        const createdAt = yield* sourceTimestamp(message)
        const editedAt = event === "edit" && message.editedAt ? Date.parse(message.editedAt) : undefined
        if (event === "edit" && (editedAt === undefined || !Number.isSafeInteger(editedAt))) return yield* Effect.fail(new ProtectionHandlingError({ stage: "timestamp" }))
        const identity = yield* protectionContext(client, config.serverId, message.author.id, message.channelId)
        const result = yield* store.evaluate({
            serverId: config.serverId, messageId: message.id, createdAt, event, ...(editedAt !== undefined ? { editedAt } : {}),
            userId: message.author.id, channelId: message.channelId, roleIds: identity.roleIds, content: message.content,
            contentHash: createHash("sha256").update(message.content).digest("hex"),
            mentionedUserIds: [...new Set((message.mentions ?? []).map((user) => user.id))],
            mentionedRoleIds: message.mentionRoleIds ? [...new Set(message.mentionRoleIds)] : null,
            mentionedEveryone: message.mentionedEveryone ?? null, targetIsStaff: identity.targetIsStaff, context: identity.context,
        })
        if (result.grant) yield* performActionGrant(store, config.serverId, identity.botId, client, result.grant, config, identity.authority)
        return result.blocked
    })
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
        if (result.grant) yield* performActionGrant(store, config.serverId, identity.botId, context.client, result.grant, config, identity.authority)
    })
}
