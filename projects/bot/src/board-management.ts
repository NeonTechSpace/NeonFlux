import {
    BOARD_LIMIT,
    BOARD_IGNORE_LIMIT,
    type Board,
    type BoardDetail,
    type BoardOperation,
    type BoardView,
} from "@neonflux/contracts/boards"
import { ChannelType, format, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { boardHelp, parseBoardCommand } from "./board-command.ts"
import { BoardStoreError, type BoardStore } from "./board-store.ts"
import { boardProblemText, type BoardRuntime } from "./board-worker.ts"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { sourceTimestamp } from "./responses.ts"
import { code, notSetUp, onOff, replyCard, replyText, type Card } from "./reply-style.ts"
import { SafetyPermissionError, channelPermissionInput } from "./safety-permissions.ts"
import { twitchPostPermissions } from "./twitch-worker.ts"

const managers = "Only the server owner or members with Manage community can manage boards"
function describe(error: unknown) {
    if (error instanceof BoardStoreError) {
        if (error.status === 404) return "This server has no board with that name. Check !board list"
        if (error.status === 429) return `A server can have at most ${BOARD_LIMIT} boards. Remove one first`
        if (error.status === 413)
            return `A board can ignore at most ${BOARD_IGNORE_LIMIT} channels. Take one back first`
        if (error.status === 409)
            return "A board with that name already exists, or boards changed on the website while this command ran. Check !board list"
        if (error.status === 403) return managers
        if (error.status === 400) return "Check the board command values. Use !board help"
        return "Boards are unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    return "The board command could not be completed"
}
const status = (board: Board, prefix: string) =>
    board.problem
        ? `stopped. ${boardProblemText(board.problem, board.channelId)}, then send ${code(`${prefix}board set ${board.name} channel #channel`)}`
        : "on"

/** Every board on one line. A server has at most five, so it needs no pages */
export function boardList(view: BoardView, prefix: string): Card {
    if (!view.boards.length)
        return {
            title: "Boards",
            description: `No boards yet. Add one with ${code(`${prefix}board add stars ⭐ #starboard`)}`,
        }
    return {
        title: "Boards",
        description: [
            ...(view.enabled ? [] : ["Boards are off, so nothing is reposted"]),
            ...view.boards.map(
                (board) =>
                    `${board.name}: ${board.emoji} at ${board.threshold} in ${format.channelMention(board.channelId)}, ${status(board, prefix)}`,
            ),
        ].join("\n"),
        note: `See a board's settings with ${code(`${prefix}board show <name>`)}`,
    }
}
/** One board's settings and what it holds */
export function boardCard(board: Board, detail: BoardDetail | undefined, prefix: string): Card {
    return {
        title: `Board ${board.name}`,
        fields: [
            ["Emoji", `${board.emoji} at ${board.threshold} ${board.threshold === 1 ? "reaction" : "reactions"}`],
            ["Channel", format.channelMention(board.channelId)],
            ["Author's own reaction counts", onOff(board.selfReactions)],
            ["Bots and webhooks", onOff(board.bots)],
            [
                "Ignored channels",
                board.ignoredChannelIds.length
                    ? board.ignoredChannelIds.map((id) => format.channelMention(id)).join(", ")
                    : "None",
            ],
            ["Posts", `${board.posted}${detail?.waiting ? `, ${detail.waiting} waiting` : ""}`],
            ...(detail?.uncertain ? [["Not confirmed", `${detail.uncertain} posts`] as const] : []),
            ...(board.problem ? [["Problem", boardProblemText(board.problem, board.channelId)] as const] : []),
        ],
        note: `Change it with ${code(`${prefix}board set ${board.name} threshold <number>`)}`,
    }
}

export function handleBoardCommand(
    store: BoardStore | undefined,
    runtime: BoardRuntime | undefined,
    config: BotConfig,
    args: readonly string[],
    context: BotEventContext<"messageCreate">,
) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, withPrefix(content, prefix))
    return Effect.gen(function* () {
        const { message, client } = context,
            serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store || !runtime) {
            yield* reply(notSetUp("Boards"))
            return
        }
        const command = parseBoardCommand(args)
        if ("error" in command) {
            yield* reply(command.error)
            return
        }
        if (command.type === "help") {
            yield* reply(boardHelp)
            return
        }
        const target =
            command.type === "add"
                ? command.channelId
                : command.type === "set" && "channelId" in command.setting
                  ? command.setting.channelId
                  : undefined
        const { authority, actor, manager } = yield* readServerManager(client, serverId, message.author.id, target)
        if (!manager) {
            yield* reply(managers)
            return
        }
        if (command.type === "list" || command.type === "show") {
            const found = yield* store.query({
                serverId,
                ...(command.type === "show" ? { detail: command.name } : {}),
            })
            const board = command.type === "show" && found.boards.find((row) => row.name === command.name)
            yield* replyCard(
                context,
                serverId,
                board ? boardCard(board, found.detail, prefix) : boardList(found, prefix),
            )
            return
        }
        if (target) {
            const channel = authority.channel
            if (channel?.type !== ChannelType.Text && channel?.type !== ChannelType.Announcement) {
                yield* reply("Choose a text or announcement channel of this server for the board")
                return
            }
            const bits = client.permissions.calculate({
                guild: authority.guild,
                member: authority.bot,
                roles: authority.roles,
                ...channelPermissionInput(authority),
            })
            if ((bits & twitchPostPermissions) !== twitchPostPermissions) {
                yield* reply(
                    `NeonFlux needs View channel, Send messages and Embed links in ${format.channelMention(target)}`,
                )
                return
            }
        }
        const operation: BoardOperation =
            command.type === "set"
                ? { type: "set", name: command.name, ...command.setting }
                : (command as BoardOperation)
        const view = yield* store.manage({
            serverId,
            originServerId: serverId,
            messageId: message.id,
            createdAt: yield* sourceTimestamp(message),
            actor,
            managerAuthorized: true,
            operation,
        })
        yield* runtime.changed(view)
        const saved = view.boards.find((board) => "name" in command && board.name === command.name)
        const channelOf = (board: Board) => format.channelMention(board.channelId)
        yield* reply(
            command.type === "module"
                ? command.enabled
                    ? "Boards are on"
                    : "Boards are off. Nothing is reposted, and their posts stay"
                : command.type === "remove"
                  ? `Board ${command.name} is removed. Its posts stay in their channel`
                  : !saved
                    ? "Boards changed while this command ran. Check !board list"
                    : command.type === "add"
                      ? `Board ${saved.name} saved. A message with ${saved.threshold} ${saved.emoji} goes to ${channelOf(saved)}${view.enabled ? "" : `. Boards are off, so turn them on with ${code(`${prefix}board module on`)}`}`
                      : command.type === "ignore"
                        ? `Board ${saved.name} ${command.ignored ? "leaves out" : "takes in"} ${format.channelMention(command.channelId)}`
                        : `Board ${saved.name} saved: ${saved.emoji} at ${saved.threshold} in ${channelOf(saved)}`,
        )
    }).pipe(
        Effect.catch((error) => reply(describe(error))),
        Effect.asVoid,
    )
}
