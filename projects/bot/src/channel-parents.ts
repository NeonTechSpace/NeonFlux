import { ChannelType, isThreadChannel, type Client } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"
import { noticeThread, threadForgets } from "./thread-memory.ts"

// Parents come from the SDK's channel cache, which channel and thread events keep current, and a channel it does not hold costs one
// read. Either way the thread is taught to thread memory
export class ChannelParentError extends Data.TaggedError("ChannelParentError")<{}> {}

function readKnownChannel(client: Client, channelId: string) {
    return Effect.suspend(() => {
        const forgets = threadForgets(client)
        return client.channels.get(channelId).pipe(
            Effect.flatMap((known) =>
                known
                    ? Effect.succeed(known)
                    : client.channels
                          .fetch(channelId, { timeoutMs: 5000 })
                          .pipe(
                              Effect.flatMap((channel) =>
                                  channel.id === channelId
                                      ? Effect.succeed(channel)
                                      : Effect.fail(new ChannelParentError()),
                              ),
                          ),
            ),
            Effect.tap((channel) => Effect.sync(() => noticeThread(client, channel, forgets))),
        )
    })
}
/** The parent channel of a thread, or undefined for any other channel. A channel the bot does not hold costs one channel read */
export function readChannelParent(client: Client, channelId: string) {
    return readKnownChannel(client, channelId).pipe(
        Effect.map((channel) => (isThreadChannel(channel) ? channel.parentId : undefined)),
    )
}
/** The forum or media channel that holds a post, so a command in any post counts as in its forum. Any other channel is itself */
export function readCommandChannel(client: Client, channelId: string) {
    return readKnownChannel(client, channelId).pipe(
        Effect.flatMap((channel) =>
            !isThreadChannel(channel)
                ? Effect.succeed(channelId)
                : readKnownChannel(client, channel.parentId).pipe(
                      Effect.map((parent) =>
                          parent.type === ChannelType.Forum || parent.type === ChannelType.Media
                              ? parent.id
                              : channelId,
                      ),
                  ),
        ),
    )
}
