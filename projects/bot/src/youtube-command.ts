import { isYoutubeChannelId, YOUTUBE_CHANNEL_ID_HINT, YOUTUBE_FIND_CHANNEL_ID } from "@neonflux/contracts/youtube"
import { commandId } from "./moderation-command.ts"

export type YoutubeCommand = { type: "help" } | { type: "list" } | { type: "status" } | { type: "add", youtubeChannelId: string, channelId: string }
    | { type: "remove", youtubeChannelId: string } | { type: "test", youtubeChannelId: string }

export const youtubeHelp = [
    "!youtube add <channel-ID> #channel: Post the channel's new uploads in a text, announcement or forum channel. Run it again to change the channel or turn alerts back on",
    "!youtube remove <channel-ID>: Stop the channel's alerts",
    "!youtube list: The YouTube channels this server follows",
    "!youtube status: Each channel's subscription with YouTube, last notification, last post and any problem",
    "!youtube test <channel-ID>: Post a test alert in the channel's alert channel now",
    "Up to 10 channels. Server owner, Administrator or Manage Server",
    "NeonFlux hears about uploads from YouTube's own notifications, without a YouTube API key, so livestreams, premieres and Shorts arrive as ordinary new videos. Videos published before a channel was added are not posted",
    `${YOUTUBE_CHANNEL_ID_HINT}. A link with /channel/UC… works too, but an @handle does not`,
].join("\n")

/** A channel ID, or a YouTube link that contains one. Handles and custom names need YouTube's API to resolve, so they are refused with how to find the ID */
export function youtubeChannelArgument(value: string): { youtubeChannelId: string } | { error: string } {
    const text = value.replace(/^<(.+)>$/, "$1")
    if (isYoutubeChannelId(text)) return { youtubeChannelId: text }
    let url: URL | undefined
    try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`) } catch { url = undefined }
    const youtube = url && url.hostname.toLowerCase().replace(/^(?:www|m)\./, "") === "youtube.com"
    const linked = youtube ? /^\/channel\/([^/]+)(?:\/|$)/.exec(url!.pathname)?.[1] : undefined
    if (linked && isYoutubeChannelId(linked)) return { youtubeChannelId: linked }
    if (text.startsWith("@") || youtube && /^\/(?:@|c\/|user\/)/.test(url!.pathname)) return { error: `NeonFlux needs the channel ID, because without a YouTube API key it cannot look up @handles or custom names. ${YOUTUBE_FIND_CHANNEL_ID}, then send !youtube add UC… #channel` }
    return { error: `That is not a YouTube channel ID. ${YOUTUBE_CHANNEL_ID_HINT}` }
}

export function parseYoutubeCommand(args: readonly string[]): YoutubeCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (!verb || verb === "help" && args.length === 1) return { type: "help" }
    if ((verb === "list" || verb === "status") && args.length === 1) return { type: verb }
    if ((verb === "add" && args.length === 3 || (verb === "remove" || verb === "test") && args.length === 2)) {
        const channel = youtubeChannelArgument(args[1]!)
        if ("error" in channel) return channel
        if (verb !== "add") return { type: verb, youtubeChannelId: channel.youtubeChannelId }
        const channelId = commandId(args[2])
        return channelId ? { type: "add", youtubeChannelId: channel.youtubeChannelId, channelId } : { error: "Name the channel for the alerts, such as !youtube add UC… #videos" }
    }
    return { error: "Check the youtube command syntax. Use !youtube help" }
}
