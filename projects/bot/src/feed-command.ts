import {
    FEED_ACCOUNT_HINTS,
    FEED_LIMIT,
    FEED_PROVIDERS,
    feedAccountKey,
    type FeedProvider,
} from "@neonflux/contracts/feeds"
import { commands } from "@neontechspace/fluxerly/effect"
import { argument } from "./command-arguments.ts"

/** A followed account as a command names it: Its handle or display name, optionally after its service when two share a name */
export type FeedTarget = { name: string; provider?: FeedProvider }
export type FeedCommand =
    | { type: "help" }
    | { type: "status"; target?: FeedTarget }
    | { type: "remove"; target: FeedTarget }
    | { type: "test"; target: FeedTarget }
    | { type: "add"; provider: FeedProvider; accountId: string; channelId: string }

export const feedHelp = [
    `!feed add bluesky <handle-or-link> #channel: Post a Bluesky account's new posts there, up to ${FEED_LIMIT} accounts. Run it again to move or restart its posts`,
    "!feed add x <username-or-link> #channel: The same for an X account, where this NeonFlux has an X key",
    "!feed remove <name>: Stop following an account, named by its handle or display name",
    "!feed status [name]: Which accounts this server follows, or one account's latest activity",
    "!feed test <name>: Post a test post now",
    "Own posts and quote posts go out. Reposts, replies and sensitive posts do not, and nothing published before the follow is posted",
].join("\n")

const isProvider = (value: string | undefined): value is FeedProvider =>
    (FEED_PROVIDERS as readonly string[]).includes(value ?? "")
const syntax = { error: "Check the feed command syntax. Use !feed help" }
function feedTarget(words: readonly string[]): FeedTarget | { error: string } {
    if (words.some((word) => /^<[@#]/.test(word))) return syntax
    const first = words[0]?.toLowerCase()
    return isProvider(first) && words.length > 1
        ? { name: words.slice(1).join(" "), provider: first }
        : { name: words.join(" ") }
}

export function parseFeedCommand(args: readonly string[]): FeedCommand | { error: string } {
    const verb = args[0]?.toLowerCase()
    if (verb === "help" && args.length === 1) return { type: "help" }
    if (!verb || (verb === "status" && args.length === 1)) return { type: "status" }
    if (verb === "add") {
        const provider = args[1]?.toLowerCase()
        if (!isProvider(provider))
            return { error: "Name the service first, such as !feed add bluesky <handle> #channel" }
        if (args.length !== 4) return syntax
        const channelId = commands.parseArgument(args[3], argument.channel)
        if (!channelId) return { error: "Name the channel for the posts, such as !feed add bluesky <handle> #news" }
        const accountId = feedAccountKey(provider, args[2]!)
        return accountId ? { type: "add", provider, accountId, channelId } : { error: FEED_ACCOUNT_HINTS[provider] }
    }
    if ((verb !== "status" && verb !== "remove" && verb !== "test") || args.length < 2) return syntax
    const target = feedTarget(args.slice(1))
    return "error" in target ? target : { type: verb, target }
}
