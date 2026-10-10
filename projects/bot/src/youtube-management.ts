import type { YoutubeOperation, YoutubeSubscription, YoutubeView } from "@neonflux/contracts/youtube"
import { ChannelType, format, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { ago, code, notSetUp, replyCard, replyText, type Card } from "./reply-style.ts"
import { SafetyPermissionError, channelPermissionInput } from "./safety-permissions.ts"
import { channelIdHint, parseYoutubeCommand, youtubeHelp, type YoutubeTarget } from "./youtube-command.ts"
import { YoutubeStoreError, type YoutubeStore } from "./youtube-store.ts"
import { readYoutubeDestination, youtubeAlertChannel, youtubePostPermissions, youtubeProblemText } from "./youtube-worker.ts"

const managers = "Only the server owner or members with Manage Server can manage YouTube alerts", CHANNELS = 10
function describe(error: unknown) {
    if (error instanceof YoutubeStoreError) {
        if (error.status === 404) return "This server does not follow that YouTube channel. Check !youtube status"
        if (error.status === 429) return `A server can follow at most ${CHANNELS} YouTube channels. Remove one first`
        if (error.status === 409) return "YouTube alerts changed on the website while this command ran. Check !youtube status and try again"
        if (error.status === 403) return managers
        if (error.status === 400) return "Check the youtube command values. Use !youtube help"
        if (error.status === 503) return "YouTube alerts are not available right now. The bot operator may not have set them up"
        return "YouTube alerts are unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    return "The youtube command could not be completed"
}
/** A followed channel in a sentence, by the name from its public feed or notifications, or as this channel with its ID until NeonFlux learns it */
export const youtubeName = (row: Pick<YoutubeSubscription, "youtubeChannelId" | "status">) => row.status.title ?? `this channel (${code(row.youtubeChannelId)})`
/** What staff type to name a followed channel in a command */
const typed = (row: YoutubeSubscription) => row.status.title ?? row.youtubeChannelId
const fold = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim()
/** The followed channels a command names. Only a name can match several */
const matching = (rows: readonly YoutubeSubscription[], target: YoutubeTarget) => rows.filter(row =>
    "name" in target ? row.status.title !== undefined && fold(row.status.title) === fold(target.name) : row.youtubeChannelId === target.youtubeChannelId)

/** Every followed channel on one line, with one hint for those whose alerts are off. A server follows at most 10, so it needs no pages */
export function youtubeChannels(view: YoutubeView, prefix: string): Card {
    const rows = view.subscriptions
    if (!rows.length) return { title: "YouTube channels", description: `No YouTube channels yet. ${view.configured ? `Add one with ${code(`${prefix}youtube add <channel-ID> #channel`)}` : "The bot operator has not set up YouTube alerts yet"}` }
    return { title: "YouTube channels",
        description: rows.map(row => `${row.status.title ?? code(row.youtubeChannelId)} to ${format.channelMention(row.channelId)}: ${row.enabled ? "On" : `Off (${row.problem === "permission" ? "missing permission" : "channel gone"})`}`).join("\n"),
        note: rows.some(row => !row.enabled) ? `To turn one back on, grant NeonFlux View Channel, Send Messages and Embed Links in its channel or choose another, then send ${code(`${prefix}youtube add <name> #channel`)}`
            : `See a channel's latest activity with ${code(`${prefix}youtube status <name>`)}${rows.some(row => !row.status.title) ? ". A channel shows its ID until NeonFlux learns its name from YouTube" : ""}`,
        ...rows.length >= CHANNELS * 0.8 ? { footer: `${rows.length} of the ${CHANNELS} channels a server can follow` } : {} }
}
/** One followed channel: Where its alerts go and their fix, its latest activity and any trouble reaching YouTube */
export function youtubeDetail(row: YoutubeSubscription, now: number, prefix: string): Card {
    const status = row.status, when = (value: number | undefined) => value !== undefined ? ago(value) : "None yet"
    const connection = status.hubError ? `${status.hubError}. NeonFlux tries again on its own` : status.subscribedUntil !== undefined && status.subscribedUntil > now ? undefined : "Waiting for YouTube to confirm"
    return { title: status.title ?? "YouTube channel", description: `Alerts in ${format.channelMention(row.channelId)}: ${row.enabled ? "On" : `Off. ${youtubeProblemText(row.problem ?? "channel", row.channelId)}`}`,
        fields: [["Last notification", when(status.lastNotificationAt)], ["Last post", when(status.lastPostAt)],
            ...status.latestVideo ? [["Newest video", `${status.latestVideo.title}, published ${ago(status.latestVideo.publishedAt)}`] as const] : [], ...connection ? [["YouTube connection", connection] as const] : []],
        note: row.enabled ? `Send a test alert with ${code(`${prefix}youtube test ${typed(row)}`)} or stop alerts with ${code(`${prefix}youtube remove ${typed(row)}`)}`
            : `Then turn alerts back on with ${code(`${prefix}youtube add ${typed(row)} #channel`)}` }
}

export function handleYoutubeCommand(store: YoutubeStore | undefined, config: BotConfig, args: readonly string[], context: BotEventContext<"messageCreate">) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, withPrefix(content, prefix))
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if (!store) { yield* reply(notSetUp("YouTube alerts")); return }
        const command = parseYoutubeCommand(args)
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(youtubeHelp); return }
        const { authority, actor, manager } = yield* readServerManager(client, serverId, message.author.id, command.type === "add" ? command.channelId : undefined)
        if (!manager) { yield* reply(managers); return }
        const target = command.target
        // A name needs the followed channels to find its channel ID, and status shows them
        const view = !target || command.type === "status" || "name" in target ? yield* store.query({ serverId }) : undefined
        if (!target) { yield* replyCard(context, serverId, youtubeChannels(view!, prefix)); return }
        const found = view && matching(view.subscriptions, target)
        if (found && found.length !== 1) {
            yield* reply(found.length > 1 && "name" in target ? `Several followed channels are called ${target.name}. Use the channel ID instead`
                : `This server does not follow ${"name" in target ? `a YouTube channel called ${target.name}` : "that YouTube channel"}. ${command.type === "add" ? `To follow a new channel, use its channel ID. ${channelIdHint}` : "Check !youtube status"}`)
            return
        }
        const row = found?.[0], youtubeChannelId = row?.youtubeChannelId ?? ("name" in target ? "" : target.youtubeChannelId)
        if (command.type === "status") { yield* replyCard(context, serverId, youtubeDetail(row!, yield* Clock.currentTimeMillis, prefix)); return }
        const manage = (operation: YoutubeOperation) => sourceTimestamp(message).pipe(Effect.flatMap(createdAt =>
            store.manage({ serverId, originServerId: serverId, messageId: message.id, createdAt, actor, managerAuthorized: true, operation })))
        if (command.type === "remove") {
            const result = yield* manage({ type: "remove", youtubeChannelId })
            yield* reply(`NeonFlux no longer posts uploads of ${youtubeName(result.subscription)}`)
            return
        }
        if (command.type === "test") {
            const { sample } = yield* store.query({ serverId, sample: youtubeChannelId })
            const destination = yield* readYoutubeDestination(client, serverId, sample!.channelId)
            if ("problem" in destination) { yield* reply(`The test alert was not posted. ${youtubeProblemText(destination.problem, sample!.channelId)}`); return }
            // A test is not an alert, so it is sent directly and not tracked. The backend labels it as a test
            const input = { content: sample!.content.content, embeds: sample!.content.embed ? [sample!.content.embed] : [], allowedMentions: noMentions }
            if (destination.forum) yield* client.threads.createPost(sample!.channelId, { name: sample!.forumPostName, message: input }, { timeoutMs: 5000 })
            else yield* client.messages.send(sample!.channelId, input, { timeoutMs: 5000 })
            yield* reply(`Test alert posted in ${format.channelMention(sample!.channelId)}`)
            return
        }
        const channel = authority.channel
        if (!youtubeAlertChannel(channel)) { yield* reply("Choose a text, announcement or forum channel of this server for the alerts"); return }
        const bits = client.permissions.calculate({ guild: authority.guild, member: authority.bot, roles: authority.roles, ...channelPermissionInput(authority) })
        if ((bits & youtubePostPermissions) !== youtubePostPermissions) { yield* reply(`NeonFlux needs View Channel, Send Messages and Embed Links in ${format.channelMention(command.channelId)}`); return }
        const result = yield* manage({ type: "add", youtubeChannelId, channelId: command.channelId })
        yield* reply(`NeonFlux posts new uploads of ${youtubeName(result.subscription)} in ${format.channelMention(command.channelId)}${channel?.type === ChannelType.Forum ? ", each as its own forum post" : ""}. Videos published before now are not posted, and the first alert can take a few minutes while YouTube confirms the subscription`)
    }).pipe(Effect.catch(error => reply(describe(error))), Effect.asVoid)
}
