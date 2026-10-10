import {
    YOUTUBE_WORK_BATCH,
    type YoutubeDelivery,
    type YoutubeDeliveryContext,
    type YoutubeProblem,
} from "@neonflux/contracts/youtube"
import { ChannelType, format, Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect } from "effect"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { postServerNote } from "./install-note.ts"
import { performPublishingGrant } from "./publishing.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { readAuthenticatedBotId, readSafetyAuthority, SafetyPermissionError } from "./safety-permissions.ts"
import type { YoutubeStore } from "./youtube-store.ts"
import { startSignalledWorker } from "./signalled-worker.ts"

export class YoutubeHandlingError extends Data.TaggedError("YoutubeHandlingError")<{
    readonly stage: "destination" | "response" | "grant"
}> {}
/** Alerts go to text, announcement and forum channels. In a forum each alert becomes its own post */
export const youtubeAlertChannel = (channel: { type: unknown } | undefined) =>
    channel?.type === ChannelType.Text ||
    channel?.type === ChannelType.Announcement ||
    channel?.type === ChannelType.Forum
export const youtubePostPermissions = Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks
/** What stopped alerts in a channel, and its fix */
export const youtubeProblemText = (problem: YoutubeProblem, channelId: string) =>
    problem === "channel"
        ? `NeonFlux cannot find ${format.channelMention(channelId)}, or it is not a text, announcement or forum channel. Choose another channel`
        : `NeonFlux lacks View channel, Send messages or Embed links in ${format.channelMention(channelId)}. Grant them`

/**
 * The bot's fresh read of an alert's destination, acting as itself. A missing channel or a missing permission is a problem NeonFlux
 * reports, while any other failed read, or the bot's own timeout, is retried later
 */
export function readYoutubeDestination(client: Client, serverId: string, channelId: string) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const read = yield* readSafetyAuthority(client, serverId, botId, {
            channelId,
            permission: youtubePostPermissions,
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
        if (!youtubeAlertChannel(authority.channel)) return { problem: "channel" as const }
        if (!authority.botPermissionAuthorized) return { problem: "permission" as const }
        const observedAt = yield* Clock.currentTimeMillis,
            timeout = authority.bot.communicationDisabledUntil
        if (timeout === undefined || (timeout !== null && !(Date.parse(timeout) <= observedAt)))
            return yield* Effect.fail(new YoutubeHandlingError({ stage: "destination" }))
        const context: YoutubeDeliveryContext = {
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
    readYoutubeDestination(client, serverId, channelId).pipe(
        Effect.flatMap((read) =>
            "context" in read
                ? Effect.succeed(read.context)
                : Effect.fail(new YoutubeHandlingError({ stage: "destination" })),
        ),
    )

/** One alert: A missing channel or permission turns its subscription off and tells the server's staff. Otherwise it goes through the publisher, never twice */
export function processYoutubeDelivery(
    store: YoutubeStore,
    publishing: PublishingStore,
    serverId: string,
    client: Client,
    delivery: YoutubeDelivery,
) {
    return Effect.gen(function* () {
        const destination = yield* readYoutubeDestination(client, serverId, delivery.channelId)
        if ("problem" in destination) {
            const result = yield* store.work({
                serverId,
                operation: {
                    type: "blocked",
                    youtubeChannelId: delivery.youtubeChannelId,
                    channelId: delivery.channelId,
                    reason: destination.problem,
                },
            })
            if (result.type === "progress" && result.recorded)
                yield* postServerNote(
                    client,
                    serverId,
                    withPrefix(
                        `YouTube alerts for ${result.title ?? `this channel (\`${delivery.youtubeChannelId}\`)`} are off. ${youtubeProblemText(destination.problem, delivery.channelId)}, then turn them back on with \`!youtube add ${result.title ?? delivery.youtubeChannelId} #channel\``,
                        replyPrefix(serverId, serverId),
                    ),
                ).pipe(
                    Effect.catchCause((cause) =>
                        Cause.hasInterrupts(cause)
                            ? Effect.failCause(cause)
                            : Effect.logWarning("A note about stopped YouTube alerts could not be posted"),
                    ),
                )
            return
        }
        const result = yield* store.work({
            serverId,
            operation: {
                type: "reserve",
                youtubeChannelId: delivery.youtubeChannelId,
                videoId: delivery.videoId,
                context: destination.context,
            },
        })
        if (result.type === "skipped") return
        if (result.type !== "reserved") return yield* Effect.fail(new YoutubeHandlingError({ stage: "response" }))
        const grant = result.grant,
            consumer = grant.consumer
        if (
            consumer?.type !== "youtube" ||
            consumer.youtubeChannelId !== delivery.youtubeChannelId ||
            consumer.videoId !== delivery.videoId ||
            grant.actorId !== grant.botId ||
            grant.botId !== destination.context.botId ||
            grant.channelId !== delivery.channelId ||
            grant.action !== "send"
        )
            return yield* Effect.fail(new YoutubeHandlingError({ stage: "grant" }))
        yield* performPublishingGrant(publishing, serverId, grant.botId, client, grant, () =>
            destinationContext(client, serverId, delivery.channelId),
        )
    })
}

/** Pages of due alerts one pass handles at most */
const PAGES_PER_PASS = 5
export function startYoutubeWorker(store: YoutubeStore, publishing: PublishingStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        // A failed alert waits a minute, so the next page holds other alerts
        const pass = Effect.gen(function* () {
            for (let page = 0; page < PAGES_PER_PASS; page++) {
                const listed = yield* store.work({ serverId, operation: { type: "list" } })
                if (listed.type !== "deliveries")
                    return yield* Effect.fail(new YoutubeHandlingError({ stage: "response" }))
                for (const delivery of listed.deliveries)
                    yield* processYoutubeDelivery(store, publishing, serverId, client, delivery).pipe(
                        Effect.catchCause((cause) =>
                            Cause.hasInterrupts(cause)
                                ? Effect.failCause(cause)
                                : store
                                      .work({
                                          serverId,
                                          operation: {
                                              type: "defer",
                                              youtubeChannelId: delivery.youtubeChannelId,
                                              videoId: delivery.videoId,
                                          },
                                      })
                                      .pipe(Effect.catch(() => Effect.void)),
                        ),
                    )
                if (listed.deliveries.length < YOUTUBE_WORK_BATCH) return
            }
        })
        const { wake } = yield* startSignalledWorker(
            pass,
            Effect.logWarning("YouTube alerts could not be checked. They stay due for the next check"),
        )
        // The work dispatcher wakes this worker once alerts are due
        return { notify: () => wake }
    })
}
