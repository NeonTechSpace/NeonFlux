import {
    TWITCH_LIMIT,
    type TwitchOperation,
    type TwitchSubscription,
    type TwitchView,
} from "@neonflux/contracts/twitch"
import { ChannelType, format, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { sourceTimestamp } from "./responses.ts"
import { ago, code, notSetUp, replyCard, replyText, type Card } from "./reply-style.ts"
import { SafetyPermissionError, channelPermissionInput } from "./safety-permissions.ts"
import { channelIdHint, parseTwitchCommand, twitchHelp, type TwitchTarget } from "./twitch-command.ts"
import { TwitchStoreError, type TwitchStore } from "./twitch-store.ts"
import { readTwitchDestination, twitchAlertChannel, twitchPostPermissions, twitchProblemText } from "./twitch-worker.ts"

const managers = "Only the server owner or members with Manage community can manage Twitch alerts",
    CHANNELS = TWITCH_LIMIT
function describe(error: unknown) {
    if (error instanceof TwitchStoreError) {
        if (error.status === 404) return "This server does not follow that Twitch channel. Check !twitch status"
        if (error.status === 429) return `A server can follow at most ${CHANNELS} Twitch channels. Remove one first`
        if (error.status === 409)
            return "Twitch alerts changed on the website while this command ran. Check !twitch status and try again"
        if (error.status === 403) return managers
        if (error.status === 400) return "Check the twitch command values. Use !twitch help"
        if (error.status === 503)
            return "Twitch alerts are not available right now. The bot operator may not have set them up"
        return "Twitch alerts are unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    return "The twitch command could not be completed"
}
/** A followed channel in a sentence, by the name from its EventSub notification or notifications, or as this channel with its ID until NeonFlux learns it */
export const twitchName = (row: Pick<TwitchSubscription, "twitchChannelId" | "status">) =>
    row.status.title ?? `this channel (${code(row.status.login ?? row.twitchChannelId)})`
/** What staff type to name a followed channel in a command */
const typed = (row: TwitchSubscription) => row.status.login ?? row.twitchChannelId
const fold = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim()
/** The followed channels a command names. Only a name can match several */
const matching = (rows: readonly TwitchSubscription[], target: TwitchTarget) =>
    rows.filter((row) =>
        "name" in target
            ? row.status.title !== undefined && fold(row.status.title) === fold(target.name)
            : row.twitchChannelId === target.twitchChannelId ||
              row.status.login === target.twitchChannelId.replace(/^pending:/, ""),
    )

/** Every followed channel on one line, with one hint for those whose alerts are off. A server follows at most 10, so it needs no pages */
export function twitchChannels(view: TwitchView, prefix: string): Card {
    const rows = view.subscriptions
    if (!rows.length)
        return {
            title: "Twitch channels",
            description: `No Twitch channels yet. ${view.configured ? `Add one with ${code(`${prefix}twitch add <login-or-link> #channel`)}` : "The bot operator has not set up Twitch alerts yet"}`,
        }
    return {
        title: "Twitch channels",
        description: rows
            .map(
                (row) =>
                    `${row.status.title ?? code(row.status.login ?? row.twitchChannelId)} to ${format.channelMention(row.channelId)}: ${row.enabled ? (row.status.hubError ?? "On") : `Off (${row.problem === "permission" ? "missing permission" : "channel gone"})`}`,
            )
            .join("\n"),
        note: rows.some((row) => !row.enabled)
            ? `To turn one back on, grant NeonFlux View channel, Send messages and Embed links in its channel or choose another, then send ${code(`${prefix}twitch add <name> #channel`)}`
            : `See a channel's latest activity with ${code(`${prefix}twitch status <name>`)}${rows.some((row) => !row.status.title) ? ". A channel shows its ID until NeonFlux learns its name from Twitch" : ""}`,
        ...(rows.length >= CHANNELS * 0.8
            ? { footer: `${rows.length} of the ${CHANNELS} channels a server can follow` }
            : {}),
    }
}
/** One followed channel: Where its alerts go and their fix, its latest activity and any trouble reaching Twitch */
export function twitchDetail(row: TwitchSubscription, _now: number, prefix: string): Card {
    const status = row.status,
        when = (value: number | undefined) => (value !== undefined ? ago(value) : "None yet")
    const connection = status.hubError
        ? `${status.hubError}${status.retrying ? ". NeonFlux tries again on its own" : ""}`
        : status.connected
          ? undefined
          : "Waiting for Twitch to confirm"
    return {
        title: status.title ?? "Twitch channel",
        description: `Alerts in ${format.channelMention(row.channelId)}: ${row.enabled ? "On" : `Off. ${twitchProblemText(row.problem ?? "channel", row.channelId)}`}`,
        fields: [
            ["Last notification", when(status.lastNotificationAt)],
            ["Last post", when(status.lastPostAt)],
            ...(status.latestStream
                ? [
                      [
                          "Latest stream",
                          `${status.latestStream.title}, published ${ago(status.latestStream.publishedAt)}`,
                      ] as const,
                  ]
                : []),
            ...(connection ? [["Twitch connection", connection] as const] : []),
        ],
        note: row.enabled
            ? `Send a test alert with ${code(`${prefix}twitch test ${typed(row)}`)} or stop alerts with ${code(`${prefix}twitch remove ${typed(row)}`)}`
            : `Then turn alerts back on with ${code(`${prefix}twitch add ${typed(row)} #channel`)}`,
    }
}

export function handleTwitchCommand(
    store: TwitchStore | undefined,
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
        if (!store) {
            yield* reply(notSetUp("Twitch alerts"))
            return
        }
        const command = parseTwitchCommand(args)
        if ("error" in command) {
            yield* reply(command.error)
            return
        }
        if (command.type === "help") {
            yield* reply(twitchHelp)
            return
        }
        const { authority, actor, manager } = yield* readServerManager(
            client,
            serverId,
            message.author.id,
            command.type === "add" ? command.channelId : undefined,
        )
        if (!manager) {
            yield* reply(managers)
            return
        }
        const target = command.target
        // A name needs the followed channels to find its channel ID, and status shows them
        const view =
            !target || command.type === "status" || "name" in target ? yield* store.query({ serverId }) : undefined
        if (!target) {
            yield* replyCard(context, serverId, twitchChannels(view!, prefix))
            return
        }
        const found = view && matching(view.subscriptions, target)
        if (found && found.length !== 1) {
            yield* reply(
                found.length > 1 && "name" in target
                    ? `Several followed channels are called ${target.name}. Use the channel ID instead`
                    : `This server does not follow ${"name" in target ? `a Twitch channel called ${target.name}` : "that Twitch channel"}. ${command.type === "add" ? `To follow a new streamer, use its Twitch login. ${channelIdHint}` : "Check !twitch status"}`,
            )
            return
        }
        const row = found?.[0],
            twitchChannelId = row?.twitchChannelId ?? ("name" in target ? "" : target.twitchChannelId)
        if (command.type === "status") {
            yield* replyCard(context, serverId, twitchDetail(row!, yield* Clock.currentTimeMillis, prefix))
            return
        }
        const manage = (operation: TwitchOperation) =>
            sourceTimestamp(message).pipe(
                Effect.flatMap((createdAt) =>
                    store.manage({
                        serverId,
                        originServerId: serverId,
                        messageId: message.id,
                        createdAt,
                        actor,
                        managerAuthorized: true,
                        operation,
                    }),
                ),
            )
        if (command.type === "remove") {
            const result = yield* manage({ type: "remove", twitchChannelId })
            yield* reply(`NeonFlux no longer posts live streams from ${twitchName(result.subscription)}`)
            return
        }
        if (command.type === "test") {
            const { sample } = yield* store.query({ serverId, sample: twitchChannelId })
            const destination = yield* readTwitchDestination(client, serverId, sample!.channelId)
            if ("problem" in destination) {
                yield* reply(
                    `The test alert was not posted. ${twitchProblemText(destination.problem, sample!.channelId)}`,
                )
                return
            }
            // A test is not an alert, so it is sent directly and not tracked. The backend labels it as a test
            const input = {
                content: sample!.content.content,
                embeds: sample!.content.embed ? [sample!.content.embed] : [],
            }
            if (destination.forum)
                yield* client.threads.createPost(
                    sample!.channelId,
                    { name: sample!.forumPostName, message: input },
                    { timeoutMs: 5000 },
                )
            else yield* client.messages.send(sample!.channelId, input, { timeoutMs: 5000 })
            yield* reply(`Test alert posted in ${format.channelMention(sample!.channelId)}`)
            return
        }
        const channel = authority.channel
        if (!twitchAlertChannel(channel)) {
            yield* reply("Choose a text, announcement or forum channel of this server for the alerts")
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
                `NeonFlux needs View channel, Send messages and Embed links in ${format.channelMention(command.channelId)}`,
            )
            return
        }
        const result = yield* manage({ type: "add", twitchChannelId, channelId: command.channelId })
        yield* reply(
            `NeonFlux posts live alerts of ${twitchName(result.subscription)} in ${format.channelMention(command.channelId)}${channel?.type === ChannelType.Forum ? ", each as its own forum post" : ""}. Streams published before now are not posted, and the first alert can take a few minutes while Twitch confirms the subscription`,
        )
    }).pipe(
        Effect.catch((error) => reply(describe(error))),
        Effect.asVoid,
    )
}
