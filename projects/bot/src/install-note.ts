import { ChannelType, Permissions, type Client, type GuildChannel } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import { noMentions } from "./responses.ts"
import { readAuthenticatedBotId, readSafetyAuthority } from "./safety-permissions.ts"

/** The note the bot posts once when it is added to a server */
export function installNote(serverId: string, prefix: string, websiteUrl: string | undefined) {
    return [
        "Thanks for adding NeonFlux, a free bot for moderation, roles, tickets, welcome messages, leveling, events and more",
        `Send ${prefix}help to see the commands you can use, and ${prefix}setup to see what to set up next`,
        ...(websiteUrl ? [`Configure it on the dashboard: ${websiteUrl}/?server=${serverId}`] : []),
    ].join("\n")
}

/** Post the note in the system channel if the bot may send there, otherwise in the first text channel it can send in, otherwise nowhere */
export function postInstallNote(client: Client, serverId: string, prefix: string, websiteUrl: string | undefined) {
    return Effect.gen(function* () {
        const { guild, roles, bot } = yield* readSafetyAuthority(client, serverId, yield* readAuthenticatedBotId(client))
        const channels = yield* client.channels.fetchAll(serverId, { timeoutMs: 5000 })
        const needed = Permissions.ViewChannel | Permissions.SendMessages
        const writable = (channel: GuildChannel) => channel.type === ChannelType.Text && (client.permissions.calculate({ guild, member: bot, roles, channel }) & needed) === needed
        const system = channels.find(channel => channel.id === guild.systemChannelId)
        const target = system && writable(system) ? system
            : channels.filter(writable).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || (BigInt(a.id) < BigInt(b.id) ? -1 : 1))[0]
        if (target) yield* client.messages.send(target.id, { content: installNote(serverId, prefix, websiteUrl), allowedMentions: noMentions }, { timeoutMs: 5000 })
    })
}
