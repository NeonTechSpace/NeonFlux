import {
    TWITCH_LIMIT,
    twitchLoginKey,
    isTwitchChannelId,
    twitchLink,
    TWITCH_CHANNEL_ID_HINT,
} from "@neonflux/contracts/twitch"
import { commands } from "@neontechspace/fluxerly/effect"
import { argument } from "./command-arguments.ts"

/** A Twitch channel by its ID, or by the name Twitch gave a channel the server follows */
export type TwitchTarget = { twitchChannelId: string } | { name: string }
export type TwitchCommand =
    | { type: "help" }
    | { type: "status"; target?: TwitchTarget }
    | { type: "remove"; target: TwitchTarget }
    | { type: "test"; target: TwitchTarget }
    | { type: "add"; target: TwitchTarget; channelId: string }

export const channelIdHint = TWITCH_CHANNEL_ID_HINT
export const twitchHelp = [
    `!twitch add <login-or-link> #channel: Post a Twitch streamer's live alerts there, up to ${TWITCH_LIMIT} channels. Run it again to move or restart alerts`,
    "!twitch remove <name>: Stop following a channel, named by its Twitch login or display name",
    "!twitch status [name]: Whether alerts are on, or one channel's latest activity",
    "!twitch test <name>: Post a test alert now",
    channelIdHint,
    "Alerts arrive only when the streamer starts their next live stream",
].join("\n")

/** A login or a Twitch channel link, normalized to lowercase */
export function twitchChannelArgument(value: string): { twitchChannelId: string } | { error: string } | undefined {
    const text = value.replace(/^<(.+)>$/, "$1").toLowerCase()
    const link = twitchLink(text)
    if (link?.twitchChannelId) return { twitchChannelId: twitchLoginKey(link.twitchChannelId) }
    if (isTwitchChannelId(text)) return { twitchChannelId: twitchLoginKey(text) }
    return link || /^https?:\/\//i.test(text) ? { error: channelIdHint } : undefined
}

const syntax = { error: "Check the twitch command syntax. Use !twitch help" }
/** A channel ID or link, or a followed channel's name, which may have spaces. An ID or a mention among other words is a syntax error */
function twitchTarget(words: readonly string[]): TwitchTarget | { error: string } {
    const parsed = words.map(twitchChannelArgument)
    if (words.length === 1 && parsed[0]) return parsed[0]
    return words.some((word) => /^<[@#]|https?:|twitch\.tv/i.test(word)) ? syntax : { name: words.join(" ") }
}

export function parseTwitchCommand(args: readonly string[]): TwitchCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (verb === "help" && args.length === 1) return { type: "help" }
    if (!verb || (verb === "status" && args.length === 1)) return { type: "status" }
    if (
        (verb !== "status" && verb !== "remove" && verb !== "test" && verb !== "add") ||
        args.length < (verb === "add" ? 3 : 2)
    )
        return syntax
    const channelId = verb === "add" ? commands.parseArgument(args.at(-1), argument.channel) : undefined
    if (verb === "add" && !channelId)
        return { error: "Name the channel for the alerts, such as !twitch add streamer #streams" }
    const target = twitchTarget(args.slice(1, verb === "add" ? -1 : undefined))
    if ("error" in target) return target
    return verb === "add" ? { type: "add", target, channelId: channelId! } : { type: verb, target }
}
