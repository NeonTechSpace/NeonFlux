import type { ResponseManageRequest, ResponseReply } from "@neonflux/backend/contracts"
import { Permissions, type BotEventContext, type GuildRole, type Message } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"
import { managementResultMessage, type ManagementCommand } from "./response-command.ts"
import { managementErrorMessage, type ResponseStore } from "./responses-store.ts"

export const noMentions = { users: [], roles: [], everyone: false, repliedUser: false } as const

export class ResponseHandlingError extends Data.TaggedError("ResponseHandlingError")<{
    readonly stage: "authorization" | "membership" | "timestamp" | "send"
}> {}

export function sourceTimestamp(message: Message) {
    return Effect.try({
        try: () => {
            if (!message.createdAt || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(message.createdAt)) {
                throw new Error("Missing or invalid timestamp")
            }
            const time = Date.parse(message.createdAt)
            if (!Number.isSafeInteger(time) || time < 0) throw new Error("Invalid timestamp")
            return time
        },
        catch: () => new ResponseHandlingError({ stage: "timestamp" }),
    })
}

export function handleManagement(store: ResponseStore, serverId: string, command: ManagementCommand, context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        const { message, client, reply } = context
        const respond = (content: string) => reply({ content, allowedMentions: noMentions })
        const authorization = yield* Effect.gen(function* () {
            const guild = yield* client.guilds.fetch(serverId)
            const member = yield* client.members.fetch({ guildId: serverId, userId: message.author.id })
            const roles = yield* client.roles.fetchAll(serverId)
            if (guild.id !== serverId || member.guildId !== serverId || member.userId !== message.author.id) {
                return yield* Effect.fail(new ResponseHandlingError({ stage: "authorization" }))
            }
            const bits = yield* Effect.try(() => client.permissions.calculate({ guild, member, roles }))
            return { adminAuthorized: guild.ownerId === message.author.id || (bits & Permissions.Administrator) !== 0n, roles }
        }).pipe(
            Effect.timeout("5 seconds"),
            Effect.mapError(() => new ResponseHandlingError({ stage: "authorization" })),
            Effect.match({ onFailure: () => undefined, onSuccess: (value) => value }),
        )
        if (!authorization) {
            yield* respond("I couldn't verify your current server permissions. No response configuration was changed")
            return
        }
        if (!authorization.adminAuthorized) {
            yield* respond("Only the server owner or an administrator can manage responses")
            return
        }
        const scopeError = yield* validateScopes(command, serverId, authorization.roles, context)
        if (scopeError) { yield* respond(scopeError); return }
        const createdAt = yield* sourceTimestamp(message)
        const request: ResponseManageRequest = {
            serverId, messageId: message.id, createdAt, actorId: message.author.id,
            originServerId: serverId, adminAuthorized: true, ...command,
        }
        yield* store.manage(request).pipe(
            Effect.matchEffect({
                onFailure: (error) => respond(managementErrorMessage(error)),
                onSuccess: (result) => {
                    const content = managementResultMessage(result)
                    return content ? respond(content) : Effect.void
                },
            }),
        )
    })
}

function validateScopes(command: ManagementCommand, serverId: string, roles: readonly GuildRole[], context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        const operation = command.operation
        if (operation.type !== "update") return undefined
        if (operation.field === "roles") {
            return operation.roleIds.some((id) => !roles.some((role) => role.id === id && role.guildId === serverId))
                ? "Every selected role must exist in this server. No configuration was changed" : undefined
        }
        if (operation.field !== "channels") return undefined
        for (const id of operation.channelIds) {
            const valid = yield* context.client.channels.fetch(id, { timeoutMs: 5000 }).pipe(
                Effect.match({ onFailure: () => false, onSuccess: (channel) => channel.guildId === serverId }),
            )
            if (!valid) return "Every selected channel must exist in this server and be visible to the bot. No configuration was changed"
        }
        return undefined
    })
}

function nativeReply(reply: ResponseReply) {
    return reply.type === "text" ? { content: reply.text, allowedMentions: noMentions }
        : { embeds: [reply.embed], allowedMentions: noMentions }
}

export function handleResponse(store: ResponseStore, serverId: string, context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        const { message, client, reply } = context
        const createdAt = yield* sourceTimestamp(message)
        const member = yield* client.members.fetch({ guildId: serverId, userId: message.author.id }, { timeoutMs: 5000 }).pipe(
            Effect.mapError(() => new ResponseHandlingError({ stage: "membership" })),
        )
        if (member.guildId !== serverId || member.userId !== message.author.id) {
            return yield* Effect.fail(new ResponseHandlingError({ stage: "membership" }))
        }
        const result = yield* store.evaluate({
            serverId, messageId: message.id, createdAt, channelId: message.channelId,
            userId: message.author.id, userName: message.author.username,
            roleIds: [serverId, ...member.roleIds], content: message.content,
        })
        if (!result.send) return
        // The backend reservation stays consumed, so a redelivered message never replies twice
        yield* reply(nativeReply(result.reply)).pipe(Effect.mapError(() => new ResponseHandlingError({ stage: "send" })))
    })
}
