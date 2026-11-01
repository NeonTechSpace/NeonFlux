import { FEED_WORK_BATCH, type FeedDelivery } from "@neonflux/contracts/feeds"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Data, Effect } from "effect"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { postServerNote } from "./install-note.ts"
import { performPublishingGrant } from "./publishing.ts"
import type { PublishingStore } from "./publishing-store.ts"
import type { FeedStore } from "./feed-store.ts"
import { startSignalledWorker } from "./signalled-worker.ts"
import { warnFailure } from "./contained.ts"
// Alerts and feed posts have the same destinations and need the same permissions
import { readTwitchDestination, twitchProblemText } from "./twitch-worker.ts"

export class FeedHandlingError extends Data.TaggedError("FeedHandlingError")<{
    readonly stage: "destination" | "response" | "grant"
}> {}
const destinationContext = (client: Client, serverId: string, channelId: string) =>
    readTwitchDestination(client, serverId, channelId).pipe(
        Effect.flatMap((read) =>
            "context" in read
                ? Effect.succeed(read.context)
                : Effect.fail(new FeedHandlingError({ stage: "destination" })),
        ),
    )

/** One post: A missing channel or permission turns its follow off and tells the server's staff. Otherwise it goes through the publisher, never twice */
export function processFeedDelivery(
    store: FeedStore,
    publishing: PublishingStore,
    serverId: string,
    client: Client,
    delivery: FeedDelivery,
) {
    return Effect.gen(function* () {
        const { provider, accountId, itemId, channelId } = delivery,
            destination = yield* readTwitchDestination(client, serverId, channelId)
        if ("problem" in destination) {
            const result = yield* store.work({
                serverId,
                operation: { type: "blocked", provider, accountId, channelId, reason: destination.problem },
            })
            if (result.type === "progress" && result.recorded)
                yield* postServerNote(
                    client,
                    serverId,
                    withPrefix(
                        `Feed posts of ${result.name ?? "a followed account"} are off. ${twitchProblemText(destination.problem, channelId)}, then turn them back on with \`!feed add ${provider} ${result.name ?? "<handle>"} #channel\``,
                        replyPrefix(serverId, serverId),
                    ),
                ).pipe(
                    Effect.catchCause((cause) =>
                        Cause.hasInterrupts(cause)
                            ? Effect.failCause(cause)
                            : warnFailure("A note about stopped feed posts could not be posted", cause),
                    ),
                )
            return
        }
        const result = yield* store.work({
            serverId,
            operation: { type: "reserve", provider, accountId, itemId, context: destination.context },
        })
        if (result.type === "skipped") return
        if (result.type !== "reserved") return yield* Effect.fail(new FeedHandlingError({ stage: "response" }))
        const grant = result.grant,
            consumer = grant.consumer
        if (
            consumer?.type !== "feed" ||
            consumer.provider !== provider ||
            consumer.accountId !== accountId ||
            consumer.itemId !== itemId ||
            grant.actorId !== grant.botId ||
            grant.botId !== destination.context.botId ||
            grant.channelId !== channelId ||
            grant.action !== "send"
        )
            return yield* Effect.fail(new FeedHandlingError({ stage: "grant" }))
        yield* performPublishingGrant(publishing, serverId, grant.botId, client, grant, () =>
            destinationContext(client, serverId, channelId),
        )
    })
}

/** Pages of due posts one pass handles at most */
const PAGES_PER_PASS = 5
export function startFeedWorker(store: FeedStore, publishing: PublishingStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        // A failed post waits a minute, so the next page holds other posts
        const pass = Effect.gen(function* () {
            for (let page = 0; page < PAGES_PER_PASS; page++) {
                const listed = yield* store.work({ serverId, operation: { type: "list" } })
                if (listed.type !== "deliveries")
                    return yield* Effect.fail(new FeedHandlingError({ stage: "response" }))
                for (const delivery of listed.deliveries)
                    yield* processFeedDelivery(store, publishing, serverId, client, delivery).pipe(
                        Effect.catchCause((cause) =>
                            Cause.hasInterrupts(cause)
                                ? Effect.failCause(cause)
                                : store
                                      .work({
                                          serverId,
                                          operation: {
                                              type: "defer",
                                              provider: delivery.provider,
                                              accountId: delivery.accountId,
                                              itemId: delivery.itemId,
                                          },
                                      })
                                      .pipe(Effect.catch(() => Effect.void)),
                        ),
                    )
                if (listed.deliveries.length < FEED_WORK_BATCH) return
            }
        })
        const { wake } = yield* startSignalledWorker(
            pass,
            Effect.logWarning("Feed posts could not be checked. They stay due for the next check"),
        )
        // The work dispatcher wakes this worker once posts are due
        return { notify: () => wake }
    })
}
