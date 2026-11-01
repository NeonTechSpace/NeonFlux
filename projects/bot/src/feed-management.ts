import {
    FEED_LIMIT,
    feedPendingHandle,
    feedProviderNames,
    type FeedOperation,
    type FeedSubscription,
    type FeedView,
} from "@neonflux/contracts/feeds"
import { ChannelType, format, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { feedHelp, parseFeedCommand, type FeedTarget } from "./feed-command.ts"
import { FeedStoreError, type FeedStore } from "./feed-store.ts"
import { readServerManager, replyPrefix, withPrefix } from "./general-settings.ts"
import { sourceTimestamp } from "./responses.ts"
import { ago, code, notSetUp, replyCard, replyText, type Card } from "./reply-style.ts"
import { SafetyPermissionError, channelPermissionInput } from "./safety-permissions.ts"
import { readTwitchDestination, twitchAlertChannel, twitchPostPermissions, twitchProblemText } from "./twitch-worker.ts"

const managers = "Only the server owner or members with Manage community can manage feeds"
function describe(error: unknown) {
    if (error instanceof FeedStoreError) {
        if (error.status === 404) return "This server does not follow that account. Check !feed status"
        if (error.status === 429) return `A server can follow at most ${FEED_LIMIT} accounts. Remove one first`
        if (error.status === 507) return "NeonFlux follows as many accounts as it can right now. Try again later"
        if (error.status === 409)
            return "Feeds changed on the website while this command ran. Check !feed status and try again"
        if (error.status === 403) return managers
        if (error.status === 400) return "Check the feed command values. Use !feed help"
        if (error.status === 503) return "X feeds are not available here. The bot operator has not set up an X key"
        return "Feeds are unavailable right now. Try again shortly"
    }
    if (error instanceof SafetyPermissionError) return "Current permissions could not be read. Try again shortly"
    return "The feed command could not be completed"
}
/** What staff type to name a followed account in a command */
const typed = (row: FeedSubscription) => row.status.handle ?? feedPendingHandle(row.accountId) ?? row.accountId
/** A followed account in a sentence, by its display name once a read gave one */
export const feedName = (row: FeedSubscription) => row.status.name ?? code(typed(row))
const fold = (name: string) => name.toLowerCase().replace(/^@/, "").replace(/\s+/g, " ").trim()
/** The followed accounts a command names. A display name can match several */
const matching = (rows: readonly FeedSubscription[], target: FeedTarget) => {
    const name = fold(target.name),
        named = (row: FeedSubscription) =>
            fold(typed(row)) === name ||
            row.accountId === name ||
            (!!row.status.name && fold(row.status.name) === name) ||
            // The add command takes a Bluesky name without a dot as its .bsky.social handle, so the others do too
            (row.provider === "bluesky" && fold(typed(row)) === `${name}.bsky.social`)
    const found = rows.filter((row) => named(row) && (!target.provider || row.provider === target.provider))
    // A display name that starts with a service's name reads as that service first
    return found.length || !target.provider
        ? found
        : rows.filter((row) => fold(`${target.provider} ${target.name}`) === fold(row.status.name ?? ""))
}
/** Without an X key nothing reads an X account, whatever its follow says */
const NO_X_KEY = "This NeonFlux has no X key, so NeonFlux does not read this account"
type FeedKey = Pick<FeedView, "xConfigured" | "xPaused">
const xOff = (row: FeedSubscription, view: FeedKey) => row.provider === "x" && !view.xConfigured
const state = (row: FeedSubscription, view: FeedKey) =>
    row.enabled
        ? xOff(row, view)
            ? "Off (no X key)"
            : (row.status.error ?? "On")
        : `Off (${row.problem === "permission" ? "missing permission" : "channel gone"})`

/** Every followed account on one line. A server follows at most 10, so it needs no pages */
export function feedAccounts(view: FeedView, prefix: string): Card {
    const rows = view.subscriptions,
        adding = code(`${prefix}feed add bluesky <handle> #channel`)
    const paused = view.xPaused && rows.some((row) => row.provider === "x")
    if (!rows.length) return { title: "Feeds", description: `No followed accounts yet. Add one with ${adding}` }
    return {
        title: "Feeds",
        description: rows
            .map(
                (row) =>
                    `${feedProviderNames[row.provider]} ${feedName(row)} to ${format.channelMention(row.channelId)}: ${state(row, view)}`,
            )
            .join("\n"),
        note: paused
            ? "This NeonFlux used its X reads for this month, so X accounts wait for the next month"
            : rows.some((row) => !row.enabled)
              ? `To turn one back on, grant NeonFlux View channel, Send messages and Embed links in its channel or choose another, then send ${adding}`
              : `See an account's latest activity with ${code(`${prefix}feed status <name>`)}`,
        ...(rows.length >= FEED_LIMIT * 0.8
            ? { footer: `${rows.length} of the ${FEED_LIMIT} accounts a server can follow` }
            : {}),
    }
}
/** One followed account: Where its posts go and their fix, its latest activity and any trouble reading it */
export function feedDetail(row: FeedSubscription, view: FeedKey, prefix: string): Card {
    const { status } = row,
        when = (value: number | undefined) => (value !== undefined ? ago(value) : "None yet"),
        service = feedProviderNames[row.provider]
    const trouble = xOff(row, view)
        ? NO_X_KEY
        : status.error
          ? `${status.error}${status.stopped ? "" : ". NeonFlux tries again on its own"}`
          : view.xPaused && row.provider === "x"
            ? "This NeonFlux used its X reads for this month, so this account waits for the next month"
            : undefined
    return {
        title: status.name ?? status.handle ?? `${service} account`,
        description: `Posts in ${format.channelMention(row.channelId)}: ${!row.enabled ? `Off. ${twitchProblemText(row.problem ?? "channel", row.channelId)}` : xOff(row, view) ? "Off" : "On"}`,
        fields: [
            ["Last check", when(status.lastReadAt)],
            ["Latest post", when(status.lastItemAt)],
            ["Last sent here", when(status.lastPostAt)],
            ...(trouble ? [["Problem", trouble] as const] : []),
        ],
        note: row.enabled
            ? `Send a test post with ${code(`${prefix}feed test ${typed(row)}`)} or stop with ${code(`${prefix}feed remove ${typed(row)}`)}`
            : `Then turn it back on with ${code(`${prefix}feed add ${row.provider} ${typed(row)} #channel`)}`,
    }
}

export function handleFeedCommand(
    store: FeedStore | undefined,
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
            yield* reply(notSetUp("Feeds"))
            return
        }
        const command = parseFeedCommand(args)
        if ("error" in command) {
            yield* reply(command.error)
            return
        }
        if (command.type === "help") {
            yield* reply(feedHelp)
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
        const manage = (operation: FeedOperation) =>
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
        if (command.type === "add") {
            const channel = authority.channel
            if (!twitchAlertChannel(channel)) {
                yield* reply("Choose a text, announcement or forum channel of this server for the posts")
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
            const { subscription } = yield* manage({
                type: "add",
                provider: command.provider,
                accountId: command.accountId,
                channelId: command.channelId,
            })
            yield* reply(
                `NeonFlux posts new ${feedProviderNames[command.provider]} posts of ${feedName(subscription)} in ${format.channelMention(command.channelId)}${channel?.type === ChannelType.Forum ? ", each as its own forum post" : ""}. Nothing published before now is posted, and the first check can take a few minutes`,
            )
            return
        }
        const view = yield* store.query({ serverId }),
            target = command.target
        if (!target) {
            yield* replyCard(context, serverId, feedAccounts(view, prefix))
            return
        }
        const found = matching(view.subscriptions, target)
        if (found.length !== 1) {
            yield* reply(
                found.length
                    ? `Several followed accounts are called ${target.name}. Name the service too, such as !feed ${command.type} x ${target.name}`
                    : `This server does not follow an account called ${target.name}. Check !feed status`,
            )
            return
        }
        const row = found[0]!
        if (command.type === "status") {
            yield* replyCard(context, serverId, feedDetail(row, view, prefix))
            return
        }
        if (command.type === "remove") {
            const result = yield* manage({ type: "remove", provider: row.provider, accountId: row.accountId })
            yield* reply(
                `NeonFlux no longer posts ${feedProviderNames[row.provider]} posts of ${feedName(result.subscription)}`,
            )
            return
        }
        const { sample } = yield* store.query({
            serverId,
            sample: { provider: row.provider, accountId: row.accountId },
        })
        const destination = yield* readTwitchDestination(client, serverId, sample!.channelId)
        if ("problem" in destination) {
            yield* reply(`The test post was not sent. ${twitchProblemText(destination.problem, sample!.channelId)}`)
            return
        }
        // A test is not a real post, so it is sent directly and not tracked. The backend labels it as a test
        const input = { content: sample!.content.content, embeds: sample!.content.embed ? [sample!.content.embed] : [] }
        if (destination.forum)
            yield* client.threads.createPost(
                sample!.channelId,
                { name: sample!.forumPostName, message: input },
                { timeoutMs: 5000 },
            )
        else yield* client.messages.send(sample!.channelId, input, { timeoutMs: 5000 })
        yield* reply(`Test post sent in ${format.channelMention(sample!.channelId)}`)
    }).pipe(
        Effect.catch((error) => reply(describe(error))),
        Effect.asVoid,
    )
}
