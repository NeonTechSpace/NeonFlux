import type * as C from "@neonflux/backend/contracts"
import { ChannelType, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { SafetyPermissionError, channelPermissionInput } from "./safety-permissions.ts"
import { parseYoutubeCommand, youtubeHelp } from "./youtube-command.ts"
import { YoutubeStoreError, type YoutubeStore } from "./youtube-store.ts"
import { readYoutubeDestination, youtubeAlertChannel, youtubePostPermissions, youtubeProblemText } from "./youtube-worker.ts"

const managers = "Only the server owner or members with Manage Server can manage YouTube alerts"
function describe(error: unknown) {
    if (error instanceof YoutubeStoreError) {
        if (error.status === 404) return "This server does not follow that YouTube channel. Check !youtube list"
        if (error.status === 429) return "A server can follow at most 10 YouTube channels. Remove one first"
        if (error.status === 409) return "YouTube alerts changed on the website while this command ran. Check !youtube list and try again"
        if (error.status === 403) return managers
        if (error.status === 400) return "Check the youtube command values. Use !youtube help"
        if (error.status === 503) return "YouTube alerts are not available right now. This NeonFlux deployment may not be set up for them"
        return "YouTube alerts are unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    return "The youtube command could not be completed"
}
const time = (at: number) => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`
const name = (row: C.YoutubeSubscription) => row.status.title ? `${row.status.title} (${row.youtubeChannelId})` : row.youtubeChannelId
/** One followed channel: Its alert channel, whether alerts are on, its subscription with YouTube and its latest activity */
export function youtubeStatusLine(row: C.YoutubeSubscription, now: number, detailed: boolean) {
    const state = row.enabled ? "On" : `Off: ${youtubeProblemText(row.problem ?? "channel", row.channelId)}, then run !youtube add ${row.youtubeChannelId} #channel`
    if (!detailed) return `${name(row)} in <#${row.channelId}>: ${state}`
    const status = row.status
    const hub = status.hubError ? `YouTube subscription failing: ${status.hubError}. NeonFlux asks again on its own`
        : status.subscribedUntil !== undefined && status.subscribedUntil > now ? `Subscribed with YouTube until ${time(status.subscribedUntil)}` : "Waiting for YouTube to confirm the subscription"
    return [`${name(row)} in <#${row.channelId}>: ${state}`, hub, `Last notification: ${status.lastNotificationAt !== undefined ? time(status.lastNotificationAt) : "none yet"}`,
        `Last post: ${status.lastPostAt !== undefined ? time(status.lastPostAt) : "none yet"}`, ...(status.latestVideo ? [`Newest video: ${status.latestVideo.title}, published ${time(status.latestVideo.publishedAt)}`] : [])].join("\n")
}

export function handleYoutubeCommand(store: YoutubeStore | undefined, config: BotConfig, args: readonly string[], context: BotEventContext<"messageCreate">) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => context.reply({ content: withPrefix(content, prefix), allowedMentions: noMentions })
    // Replies fit Fluxer's message limit, one channel never split across two
    const replies = (heading: string, items: string[]) => Effect.gen(function* () {
        let page = heading
        for (const item of items) {
            if (page.length + item.length + 2 > 1900) { yield* reply(page); page = item }
            else page += `\n\n${item}`
        }
        yield* reply(page)
    })
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store) { yield* reply("YouTube alert persistence is not configured"); return }
        const command = parseYoutubeCommand(args)
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(youtubeHelp); return }
        const { authority, actor, manager } = yield* readServerManager(client, serverId, message.author.id, command.type === "add" ? command.channelId : undefined)
        if (!manager) { yield* reply(managers); return }
        if (command.type === "list" || command.type === "status") {
            const view = yield* store.query({ serverId }), now = yield* Clock.currentTimeMillis
            if (!view.subscriptions.length) { yield* reply(`This server follows no YouTube channels. Add one with !youtube add <channel-ID> #channel${view.configured ? "" : ". YouTube alerts are not available on this NeonFlux deployment yet"}`); return }
            yield* replies(`YouTube channels ${view.subscriptions.length}/10`, view.subscriptions.map(row => youtubeStatusLine(row, now, command.type === "status")))
            return
        }
        const manage = (operation: C.YoutubeOperation) => sourceTimestamp(message).pipe(Effect.flatMap(createdAt =>
            store.manage({ serverId, originServerId: serverId, messageId: message.id, createdAt, actor, managerAuthorized: true, operation })))
        if (command.type === "remove") {
            const result = yield* manage({ type: "remove", youtubeChannelId: command.youtubeChannelId })
            yield* reply(`NeonFlux no longer posts uploads of ${name(result.subscription)}`)
            return
        }
        if (command.type === "test") {
            const { sample } = yield* store.query({ serverId, sample: command.youtubeChannelId })
            const destination = yield* readYoutubeDestination(client, serverId, sample!.channelId)
            if ("problem" in destination) { yield* reply(`The test alert was not posted. ${youtubeProblemText(destination.problem, sample!.channelId)}`); return }
            // A test is not an alert, so it is sent directly and not tracked
            const input = { content: sample!.content.content, embeds: sample!.content.embed ? [sample!.content.embed] : [], allowedMentions: noMentions }
            if (destination.forum) yield* client.threads.createPost(sample!.channelId, { name: sample!.forumPostName, message: input }, { timeoutMs: 5000 })
            else yield* client.messages.send(sample!.channelId, input, { timeoutMs: 5000 })
            yield* reply(`Test alert posted in <#${sample!.channelId}>`)
            return
        }
        const channel = authority.channel
        if (!youtubeAlertChannel(channel)) { yield* reply("Choose a text, announcement or forum channel of this server for the alerts"); return }
        const bits = client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, ...channelPermissionInput(authority) })
        if ((bits & youtubePostPermissions) !== youtubePostPermissions) { yield* reply(`NeonFlux needs View Channel, Send Messages and Embed Links in <#${command.channelId}>`); return }
        const result = yield* manage({ type: "add", youtubeChannelId: command.youtubeChannelId, channelId: command.channelId })
        yield* reply(`NeonFlux posts new uploads of ${name(result.subscription)} in <#${command.channelId}>${channel?.type === ChannelType.Forum ? ", each as its own forum post" : ""}. Videos published before now are not posted, and the first alert can take a few minutes while YouTube confirms the subscription`)
    }).pipe(Effect.catch(error => reply(describe(error))), Effect.asVoid)
}
