import { ChannelType, format, Permissions, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { sourceTimestamp } from "./responses.ts"
import { code, duration, notSetUp, replyCard, replyText } from "./reply-style.ts"
import { channelPermissionInput, SafetyPermissionError } from "./safety-permissions.ts"
import { parseStickyCommand, stickyHelp } from "./sticky-command.ts"
import { StickyStoreError, type StickyStore } from "./sticky-store.ts"
import type { StickyRuntime } from "./sticky-worker.ts"

const posting = Permissions.ViewChannel | Permissions.SendMessages
function describe(error: unknown) {
    if (error instanceof StickyStoreError) {
        if (error.status === 404) return "That channel has no sticky message. Check !sticky list"
        if (error.status === 429) return "A server can have at most 5 sticky messages. Remove one first"
        if (error.status === 409) return "Sticky messages changed on the website while this command ran. Check !sticky list and try again"
        if (error.status === 403) return "Only the server owner or members with Manage Server can manage sticky messages"
        if (error.status === 400) return "Check the sticky command values. Use !sticky help"
        return "Sticky messages are unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    return "The sticky command could not be completed"
}
const preview = (content: string) => content.length > 80 ? `${content.slice(0, 80)}…` : content

export function handleStickyCommand(store: StickyStore | undefined, runtime: StickyRuntime | undefined, config: BotConfig, args: readonly string[], context: BotEventContext<"messageCreate">) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, withPrefix(content, prefix))
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store || !runtime) { yield* reply(notSetUp("Sticky messages")); return }
        const command = parseStickyCommand(args)
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(stickyHelp); return }
        const { authority, actor, manager } = yield* readServerManager(client, serverId, message.author.id, command.type === "list" ? undefined : command.channelId)
        if (!manager) { yield* reply("Only the server owner or members with Manage Server can manage sticky messages"); return }
        if (command.type === "list") {
            const stickies = runtime.stickies()
            yield* replyCard(context, serverId, { title: "Sticky messages", footer: `${stickies.length} of 5`,
                description: stickies.map(sticky => `${format.channelMention(sticky.channelId)}: Every ${duration(sticky.intervalSeconds)} at most, "${preview(sticky.content)}"`).join("\n")
                    || `No sticky messages yet. Add one with ${code(`${prefix}sticky add #channel "text"`)}` })
            return
        }
        const manage = (operation: Parameters<StickyStore["manage"]>[0]["operation"]) => sourceTimestamp(message).pipe(Effect.flatMap(createdAt =>
            store.manage({ serverId, originServerId: serverId, messageId: message.id, createdAt, actor, managerAuthorized: true, operation })))
        if (command.type === "remove") {
            const result = yield* manage({ type: "remove", channelId: command.channelId })
            yield* runtime.removed(result.sticky)
            yield* reply(`Sticky message removed from ${format.channelMention(command.channelId)}, and its last copy deleted`)
            return
        }
        const channel = authority.channel
        if (channel?.type !== ChannelType.Text && channel?.type !== ChannelType.Announcement) { yield* reply("Choose a text or announcement channel of this server"); return }
        const botBits = client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, ...channelPermissionInput(authority) })
        if ((botBits & posting) !== posting) { yield* reply(`NeonFlux needs View Channel and Send Messages in ${format.channelMention(command.channelId)}`); return }
        const result = yield* manage(command.type === "add" ? { type: "set", channelId: command.channelId, content: command.content } : { type: "set", channelId: command.channelId, intervalSeconds: command.seconds })
        const posted = yield* runtime.saved(result.sticky)
        yield* reply(`Sticky message saved in ${format.channelMention(command.channelId)}. It reposts at most every ${duration(result.sticky.intervalSeconds)}${posted ? "" : ". NeonFlux could not post it just now, so check its permissions in that channel"}`)
    }).pipe(Effect.catch(error => reply(describe(error))), Effect.asVoid)
}
