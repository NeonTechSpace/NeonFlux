import type { ResponseManageRequest, ResponseReply } from "@neonflux/contracts/responses"
import { permissionBits, type BotEventContext, type GuildRole, type Message } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"
import {
    managementResultMessage,
    testResultCard,
    type AutoTestCommand,
    type ManagementCommand,
} from "./response-command.ts"
import { managementErrorMessage, type ResponseStore } from "./responses-store.ts"
import { readChannelParent } from "./channel-parents.ts"
import { readNativeMember } from "./member-evidence.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { replyPrefix } from "./general-settings.ts"
import { replyCard, replyText } from "./reply-style.ts"

class ResponseHandlingError extends Data.TaggedError("ResponseHandlingError")<{
    readonly stage: "authorization" | "membership" | "channel" | "timestamp" | "send"
}> {}

export function sourceTimestamp(message: Message) {
    return Effect.try({
        try: () => {
            if (
                !message.createdAt ||
                !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(message.createdAt)
            ) {
                throw new Error("Missing or invalid timestamp")
            }
            const time = Date.parse(message.createdAt)
            if (!Number.isSafeInteger(time) || time < 0) throw new Error("Invalid timestamp")
            return time
        },
        catch: () => new ResponseHandlingError({ stage: "timestamp" }),
    })
}

export function handleManagement(
    store: ResponseStore,
    serverId: string,
    command: ManagementCommand | AutoTestCommand,
    context: BotEventContext<"messageCreate">,
) {
    return Effect.gen(function* () {
        const { message, client } = context,
            prefix = replyPrefix(serverId, message.guildId)
        const respond = (content: string) => replyText(context, content)
        const authorization = yield* Effect.gen(function* () {
            const guild = yield* client.guilds.fetch(serverId)
            const member = yield* client.members.fetch({ guildId: serverId, userId: message.author.id })
            const roles = yield* client.roles.fetchAll(serverId)
            if (guild.id !== serverId || member.guildId !== serverId || member.userId !== message.author.id) {
                return yield* Effect.fail(new ResponseHandlingError({ stage: "authorization" }))
            }
            const bits = yield* Effect.try(() => client.permissions.calculate({ guild, member, roles }))
            return {
                adminAuthorized: guild.ownerId === message.author.id || permissionBits.has(bits, "Administrator"),
                roles,
                roleIds: member.roleIds,
            }
        }).pipe(
            Effect.timeout("5 seconds"),
            Effect.mapError(() => new ResponseHandlingError({ stage: "authorization" })),
            Effect.match({ onFailure: () => undefined, onSuccess: (value) => value }),
        )
        if (!authorization) {
            yield* respond("NeonFlux couldn't verify your current server permissions, so nothing was changed")
            return
        }
        if (!authorization.adminAuthorized) {
            yield* respond("Only the server owner or an administrator can manage responses")
            return
        }
        if (command.kind === "auto-test") {
            // The sample is tried as if this member had sent it in this channel, with their current roles
            const parentChannelId = yield* readChannelParent(client, message.channelId).pipe(
                Effect.mapError(() => new ResponseHandlingError({ stage: "channel" })),
            )
            const tested: ResponseManageRequest = {
                serverId,
                messageId: message.id,
                createdAt: yield* sourceTimestamp(message),
                actorId: message.author.id,
                originServerId: serverId,
                adminAuthorized: true,
                kind: "auto",
                operation: {
                    type: "test",
                    text: command.text,
                    channelId: message.channelId,
                    ...(parentChannelId ? { parentChannelId } : {}),
                    roleIds: [serverId, ...authorization.roleIds],
                },
            }
            yield* store.manage(tested).pipe(
                Effect.matchEffect({
                    onFailure: (error) => respond(managementErrorMessage(error)),
                    onSuccess: (result) =>
                        result.duplicate || result.type !== "test"
                            ? Effect.void
                            : replyCard(context, serverId, testResultCard(result, prefix)),
                }),
            )
            return
        }
        const scopeError = yield* validateScopes(command, serverId, authorization.roles, context)
        if (scopeError) {
            yield* respond(scopeError)
            return
        }
        const key = pageKey(serverId, message, command.kind, "list"),
            page = command.next ? nextPosition<number>(key) : undefined
        if (command.next && page === undefined) {
            yield* respond(noNextPage(`${prefix}${command.kind} list`))
            return
        }
        const managed: ManagementCommand =
            page === undefined ? command : { kind: command.kind, operation: { type: "list", page } }
        const createdAt = yield* sourceTimestamp(message)
        const request: ResponseManageRequest = {
            serverId,
            messageId: message.id,
            createdAt,
            actorId: message.author.id,
            originServerId: serverId,
            adminAuthorized: true,
            ...managed,
        }
        yield* store.manage(request).pipe(
            Effect.matchEffect({
                onFailure: (error) => respond(managementErrorMessage(error)),
                onSuccess: (result) => {
                    if (!result.duplicate && result.type === "list")
                        rememberPosition(key, result.page < result.totalPages ? result.page + 1 : undefined)
                    const content = managementResultMessage(result, command.operation, prefix)
                    return content === undefined
                        ? Effect.void
                        : typeof content === "string"
                          ? respond(content)
                          : replyCard(context, serverId, content)
                },
            }),
        )
    })
}

function validateScopes(
    command: ManagementCommand,
    serverId: string,
    roles: readonly GuildRole[],
    context: BotEventContext<"messageCreate">,
) {
    return Effect.gen(function* () {
        const operation = command.operation
        if (operation.type !== "update") return undefined
        if (operation.field === "roles") {
            return operation.roleIds.some((id) => !roles.some((role) => role.id === id && role.guildId === serverId))
                ? "Every selected role must exist in this server. No configuration was changed"
                : undefined
        }
        if (operation.field !== "channels") return undefined
        for (const id of operation.channelIds) {
            const valid = yield* context.client.channels
                .fetch(id, { timeoutMs: 5000 })
                .pipe(Effect.match({ onFailure: () => false, onSuccess: (channel) => channel.guildId === serverId }))
            if (!valid)
                return "Every selected channel must exist in this server and be visible to the bot. No configuration was changed"
        }
        return undefined
    })
}

function nativeReply(reply: ResponseReply) {
    return reply.type === "text" ? { content: reply.text } : { embeds: [reply.embed] }
}

export function handleResponse(store: ResponseStore, serverId: string, context: BotEventContext<"messageCreate">) {
    return Effect.gen(function* () {
        const { message, client, reply } = context
        const createdAt = yield* sourceTimestamp(message)
        // Channel restrictions treat a thread as its parent channel too
        const parentChannelId = yield* readChannelParent(client, message.channelId).pipe(
            Effect.mapError(() => new ResponseHandlingError({ stage: "channel" })),
        )
        const request = {
            serverId,
            messageId: message.id,
            createdAt,
            channelId: message.channelId,
            ...(parentChannelId ? { parentChannelId } : {}),
            userId: message.author.id,
            userName: message.author.username,
            content: message.content,
        }
        // Most messages match nothing. The member is needed only when a definition could reply, and the author's member from the message event or a member event keeps the cached copy current
        let result = yield* store.evaluate(request)
        if (!result.send && "memberRequired" in result) {
            const member = yield* readNativeMember(client, serverId, message.author.id, {
                allowAbsent: false,
                cached: true,
            }).pipe(
                Effect.flatMap((evidence) =>
                    evidence.member
                        ? Effect.succeed(evidence.member)
                        : Effect.fail(new ResponseHandlingError({ stage: "membership" })),
                ),
                Effect.mapError(() => new ResponseHandlingError({ stage: "membership" })),
            )
            result = yield* store.evaluate({ ...request, roleIds: [serverId, ...member.roleIds] })
        }
        if (!result.send) return "defined" in result
        // The backend reservation stays consumed, so a redelivered message never replies twice
        yield* reply(nativeReply(result.reply)).pipe(
            Effect.mapError(() => new ResponseHandlingError({ stage: "send" })),
        )
        return true
    })
}
