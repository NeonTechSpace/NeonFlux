import {
    TWITCH_WORK_BATCH,
    type TwitchDelivery,
    type TwitchDeliveryContext,
    type TwitchProblem,
} from "@neonflux/contracts/twitch"
import { ChannelType, format, Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect } from "effect"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { postServerNote } from "./install-note.ts"
import { performPublishingGrant } from "./publishing.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { readAuthenticatedBotId, readSafetyAuthority, SafetyPermissionError } from "./safety-permissions.ts"
import type { TwitchStore } from "./twitch-store.ts"
import { startSignalledWorker } from "./signalled-worker.ts"
import { warnFailure } from "./contained.ts"

export class TwitchHandlingError extends Data.TaggedError("TwitchHandlingError")<{
    readonly stage: "destination" | "response" | "grant"
}> {}
/** Alerts go to text, announcement and forum channels. In a forum each alert becomes its own post */
export const twitchAlertChannel = (channel: { type: unknown } | undefined) =>
    channel?.type === ChannelType.Text ||
    channel?.type === ChannelType.Announcement ||
    channel?.type === ChannelType.Forum
export const twitchPostPermissions = Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks
/** What stopped alerts in a channel, and its fix */
export const twitchProblemText = (problem: TwitchProblem, channelId: string) =>
    problem === "channel"
        ? `NeonFlux cannot find ${format.channelMention(channelId)}, or it is not a text, announcement or forum channel. Choose another channel`
        : `NeonFlux lacks View channel, Send messages or Embed links in ${format.channelMention(channelId)}. Grant them`

/**
 * The bot's fresh read of an alert's destination, acting as itself. A missing channel or a missing permission is a problem NeonFlux
 * reports, while any other failed read, or the bot's own timeout, is retried later
 */
export function readTwitchDestination(client: Client, serverId: string, channelId: string) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const read = yield* readSafetyAuthority(client, serverId, botId, {
            channelId,
            permission: twitchPostPermissions,
        }).pipe(
            Effect.map((authority) => ({ authority })),
            Effect.catch((error) =>
                error instanceof SafetyPermissionError &&
                (error.stage === "channel" ||
                    (error.operation === "channel" && (error.notFound || error.status === 403)))
                    ? Effect.succeed({ problem: error.status === 403 ? ("permission" as const) : ("channel" as const) })
                    : Effect.fail(error),
            ),
        )
        if ("problem" in read) return { problem: read.problem }
        const { authority } = read
        if (!twitchAlertChannel(authority.channel)) return { problem: "channel" as const }
        if (!authority.botPermissionAuthorized) return { problem: "permission" as const }
        const observedAt = yield* Clock.currentTimeMillis,
            timeout = authority.bot.communicationDisabledUntil
        if (timeout === undefined || (timeout !== null && !(Date.parse(timeout) <= observedAt)))
            return yield* Effect.fail(new TwitchHandlingError({ stage: "destination" }))
        const context: TwitchDeliveryContext = {
            originServerId: authority.guild.id,
            observedAt,
            channelId,
            botId: authority.botId,
            botAuthorized: true,
        }
        return { context, forum: authority.channel?.type === ChannelType.Forum }
    })
}
const destinationContext = (client: Client, serverId: string, channelId: string) =>
    readTwitchDestination(client, serverId, channelId).pipe(
        Effect.flatMap((read) =>
            "context" in read
                ? Effect.succeed(read.context)
                : Effect.fail(new TwitchHandlingError({ stage: "destination" })),
        ),
    )

/** One alert: A missing channel or permission turns its subscription off and tells the server's staff. Otherwise it goes through the publisher, never twice */
export function processTwitchDelivery(
    store: TwitchStore,
    publishing: PublishingStore,
    serverId: string,
    client: Client,
    delivery: TwitchDelivery,
) {
    return Effect.gen(function* () {
        const destination = yield* readTwitchDestination(client, serverId, delivery.channelId)
        if ("problem" in destination) {
            const result = yield* store.work({
                serverId,
                operation: {
                    type: "blocked",
                    twitchChannelId: delivery.twitchChannelId,
                    channelId: delivery.channelId,
                    reason: destination.problem,
                },
            })
            if (result.type === "progress" && result.recorded)
                yield* postServerNote(
                    client,
                    serverId,
                    withPrefix(
                        `Twitch alerts for ${result.title ?? `this channel (\`${delivery.twitchChannelId}\`)`} are off. ${twitchProblemText(destination.problem, delivery.channelId)}, then turn them back on with \`!twitch add ${result.title ?? delivery.twitchChannelId} #channel\``,
                        replyPrefix(serverId, serverId),
                    ),
                ).pipe(
                    Effect.catchCause((cause) =>
                        Cause.hasInterrupts(cause)
                            ? Effect.failCause(cause)
                            : warnFailure("A note about stopped Twitch alerts could not be posted", cause),
                    ),
                )
            return
        }
        const result = yield* store.work({
            serverId,
            operation: {
                type: "reserve",
                twitchChannelId: delivery.twitchChannelId,
                streamId: delivery.streamId,
                context: destination.context,
            },
        })
        if (result.type === "skipped") return
        if (result.type !== "reserved") return yield* Effect.fail(new TwitchHandlingError({ stage: "response" }))
        const grant = result.grant,
            consumer = grant.consumer
        if (
            consumer?.type !== "twitch" ||
            consumer.twitchChannelId !== delivery.twitchChannelId ||
            consumer.streamId !== delivery.streamId ||
            grant.actorId !== grant.botId ||
            grant.botId !== destination.context.botId ||
            grant.channelId !== delivery.channelId ||
            grant.action !== "send"
        )
            return yield* Effect.fail(new TwitchHandlingError({ stage: "grant" }))
        yield* performPublishingGrant(publishing, serverId, grant.botId, client, grant, () =>
            destinationContext(client, serverId, delivery.channelId),
        )
    })
}

/** Pages of due alerts one pass handles at most */
const PAGES_PER_PASS = 5
export function startTwitchWorker(store: TwitchStore, publishing: PublishingStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        // A failed alert waits a minute, so the next page holds other alerts
        const pass = Effect.gen(function* () {
            for (let page = 0; page < PAGES_PER_PASS; page++) {
                const listed = yield* store.work({ serverId, operation: { type: "list" } })
                if (listed.type !== "deliveries")
                    return yield* Effect.fail(new TwitchHandlingError({ stage: "response" }))
                for (const delivery of listed.deliveries)
                    yield* processTwitchDelivery(store, publishing, serverId, client, delivery).pipe(
                        Effect.catchCause((cause) =>
                            Cause.hasInterrupts(cause)
                                ? Effect.failCause(cause)
                                : store
                                      .work({
                                          serverId,
                                          operation: {
                                              type: "defer",
                                              twitchChannelId: delivery.twitchChannelId,
                                              streamId: delivery.streamId,
                                          },
                                      })
                                      .pipe(Effect.catch(() => Effect.void)),
                        ),
                    )
                if (listed.deliveries.length < TWITCH_WORK_BATCH) return
            }
        })
        const { wake } = yield* startSignalledWorker(
            pass,
            Effect.logWarning("Twitch alerts could not be checked. They stay due for the next check"),
        )
        // The work dispatcher wakes this worker once alerts are due
        return { notify: () => wake }
    })
}
