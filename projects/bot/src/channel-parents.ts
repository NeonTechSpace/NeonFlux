import { isThreadChannel, type Client } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"

// Parents come from the SDK's channel cache, which channel and thread events keep current, and a channel it does not hold
// costs one read
export class ChannelParentError extends Data.TaggedError("ChannelParentError")<{}> {}

function readKnownChannel(client: Client, channelId: string) {
    return client.channels
        .get(channelId)
        .pipe(
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
        )
}
/** The parent channel of a thread, or undefined for any other channel. A channel the bot does not hold costs one channel read */
export function readChannelParent(client: Client, channelId: string) {
    return readKnownChannel(client, channelId).pipe(
        Effect.map((channel) => (isThreadChannel(channel) ? channel.parentId : undefined)),
    )
}
