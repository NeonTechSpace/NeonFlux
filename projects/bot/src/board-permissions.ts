import {
    ChannelType,
    errors,
    isThreadChannel,
    Permissions,
    type Client,
    type GuildChannel,
} from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { boardMayRepost, type BoardChannel, type BoardRole } from "./board-visibility.ts"
import { readAuthenticatedBotId } from "./safety-permissions.ts"

const NAMED = [
    ["ViewChannel", Permissions.ViewChannel],
    ["ReadMessageHistory", Permissions.ReadMessageHistory],
    ["Administrator", Permissions.Administrator],
] as const
const names = (bits: bigint) => NAMED.flatMap(([name, bit]) => ((bits & bit) === bit ? [name] : []))
const everyone = (id: string, serverId: string) => (id === serverId ? "everyone" : id)

/** A real role in the shape boardMayRepost judges. The everyone role has the server's ID */
export const boardRole = (role: { id: string; permissions: bigint }, serverId: string): BoardRole => ({
    id: everyone(role.id, serverId),
    permissions: names(role.permissions),
})
/** A real channel in that shape. The older nsfw field holds what the category and server decide, and the channel's own override comes first */
export const boardChannel = (channel: GuildChannel, serverId: string, botId: string): BoardChannel => ({
    // NeonFlux's own member overwrite, which a private board needs, opens the channel to no reader
    overwrites: (channel.permissionOverwrites ?? [])
        .filter((row) => row.type === "role" || row.id !== botId)
        .map((row) => ({
            id: row.type === "role" ? everyone(row.id, serverId) : row.id,
            type: row.type,
            allow: names(row.allow),
            deny: names(row.deny),
        })),
    nsfw: channel.nsfwOverride ?? channel.nsfw ?? false,
})

/**
 * Whether a message in a channel may go to a board's channel, read from Fluxer, or from the bot's copies with cached, which an ordinary
 * reaction uses. A thread counts as its parent, except that a private thread never reposts, since its members are not its parent's readers.
 * Answers undefined when Fluxer sent no overwrite list for the source, whose readers are then unknown: Nothing posts, and nothing is removed.
 * Answers channel-gone when the board's channel no longer exists
 */
export function readBoardVisibility(
    client: Client,
    serverId: string,
    sourceChannelId: string,
    boardChannelId: string,
    cached: boolean,
) {
    const channel = (id: string) =>
        cached
            ? client.channels
                  .get(id)
                  .pipe(
                      Effect.flatMap((found) =>
                          found ? Effect.succeed(found) : client.channels.fetch(id, { timeoutMs: 5000 }),
                      ),
                  )
            : client.channels.fetch(id, { timeoutMs: 5000 })
    return Effect.gen(function* () {
        const source = yield* channel(sourceChannelId),
            board = yield* channel(boardChannelId).pipe(
                Effect.catch((error) => (errors.isNotFound(error) ? Effect.succeed(undefined) : Effect.fail(error))),
            )
        if (!board) return "channel-gone" as const
        if (source.guildId !== serverId || board.guildId !== serverId) return false
        if (source.type === ChannelType.PrivateThread) return false
        const judged = isThreadChannel(source) ? yield* channel(source.parentId) : source
        if (!judged.permissionOverwrites) return undefined
        const botId = yield* readAuthenticatedBotId(client)
        const roles =
            (cached ? yield* client.roles.getAll(serverId) : undefined) ??
            (yield* client.roles.fetchAll(serverId, { timeoutMs: 5000 }))
        return boardMayRepost(
            roles.map((role) => boardRole(role, serverId)),
            boardChannel(judged, serverId, botId),
            boardChannel(board, serverId, botId),
        )
    })
}
