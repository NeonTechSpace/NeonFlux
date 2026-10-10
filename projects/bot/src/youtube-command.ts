import { YOUTUBE_LIMIT, isYoutubeChannelId, YOUTUBE_CHANNEL_ID_HINT, YOUTUBE_FIND_CHANNEL_ID } from "@neonflux/contracts/youtube"
import { commandId } from "./moderation-command.ts"

/** A YouTube channel by its ID, or by the name YouTube gave a channel the server follows */
export type YoutubeTarget = { youtubeChannelId: string } | { name: string }
export type YoutubeCommand = { type: "help" } | { type: "status", target?: YoutubeTarget } | { type: "remove", target: YoutubeTarget } | { type: "test", target: YoutubeTarget } | { type: "add", target: YoutubeTarget, channelId: string }

export const channelIdHint = YOUTUBE_CHANNEL_ID_HINT
export const youtubeHelp = [
    `!youtube add <channel-ID> #channel: Post a YouTube channel's new uploads there, up to ${YOUTUBE_LIMIT} channels. Run it again to move or restart alerts`,
    "!youtube remove <name>: Stop following a channel, named by its YouTube name or ID",
    "!youtube status [name]: Whether alerts are on, or one channel's latest activity",
    "!youtube test <name>: Post a test alert now",
    channelIdHint,
    "Livestreams, premieres and Shorts arrive as ordinary new videos",
].join("\n")

/**
 * A channel ID, or a YouTube link that contains one. Handles and custom names need YouTube's API to resolve, so they are refused with how
 * to find the ID. Plain words give undefined, because they may name a followed channel
 */
export function youtubeChannelArgument(value: string): { youtubeChannelId: string } | { error: string } | undefined {
    const text = value.replace(/^<(.+)>$/, "$1")
    if (isYoutubeChannelId(text)) return { youtubeChannelId: text }
    let url: URL | undefined
    try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`) } catch { url = undefined }
    const youtube = url && url.hostname.toLowerCase().replace(/^(?:www|m)\./, "") === "youtube.com"
    const linked = youtube ? /^\/channel\/([^/]+)(?:\/|$)/.exec(url!.pathname)?.[1] : undefined
    if (linked && isYoutubeChannelId(linked)) return { youtubeChannelId: linked }
    if (text.startsWith("@") || youtube && /^\/(?:@|c\/|user\/)/.test(url!.pathname)) return { error: `NeonFlux needs the channel ID, because without a YouTube API key it cannot look up @handles or custom names. ${YOUTUBE_FIND_CHANNEL_ID}, then send !youtube add UC… #channel` }
    return youtube || /^https?:\/\//i.test(text) ? { error: `That is not a YouTube channel link. ${channelIdHint}` } : undefined
}

const syntax = { error: "Check the youtube command syntax. Use !youtube help" }
/** A channel ID or link, or a followed channel's name, which may have spaces. An ID or a mention among other words is a syntax error */
function youtubeTarget(words: readonly string[]): YoutubeTarget | { error: string } {
    const parsed = words.map(youtubeChannelArgument)
    if (words.length === 1 && parsed[0]) return parsed[0]
    return parsed.some(Boolean) || words.some(word => /^<[@#]/.test(word)) ? syntax : { name: words.join(" ") }
}

export function parseYoutubeCommand(args: readonly string[]): YoutubeCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (verb === "help" && args.length === 1) return { type: "help" }
    if (!verb || verb === "status" && args.length === 1) return { type: "status" }
    if (verb !== "status" && verb !== "remove" && verb !== "test" && verb !== "add" || args.length < (verb === "add" ? 3 : 2)) return syntax
    const channelId = verb === "add" ? commandId(args.at(-1)) : undefined
    if (verb === "add" && !channelId) return { error: "Name the channel for the alerts, such as !youtube add UC… #videos" }
    const target = youtubeTarget(args.slice(1, verb === "add" ? -1 : undefined))
    if ("error" in target) return target
    return verb === "add" ? { type: "add", target, channelId: channelId! } : { type: verb, target }
}
