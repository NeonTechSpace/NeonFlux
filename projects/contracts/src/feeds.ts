import { Schema } from "effect"
import { Id, List, Millis, origin } from "./common.ts"
import { ModerationActor } from "./shared.ts"
import { isFeedAccountId, PublishingContent, PublishingFeedConsumer, PublishingGrant } from "./publishing-base.ts"
export { feedSourceId, isFeedAccountId, isFeedItemId } from "./publishing-base.ts"

// Bluesky and X feeds, see docs/BOT.md#bluesky-and-x-feeds

/** A server follows at most ten accounts, and a work pass lists at most ten due posts */
export const FEED_LIMIT = 10,
    FEED_WORK_BATCH = 10
export const FeedProvider = PublishingFeedConsumer.fields.provider
export type FeedProvider = typeof FeedProvider.Type
export const FEED_PROVIDERS = ["bluesky", "x"] as const satisfies readonly FeedProvider[]
export const feedProviderNames: Record<FeedProvider, string> = { bluesky: "Bluesky", x: "X" }
export const FEED_ACCOUNT_HINTS: Record<FeedProvider, string> = {
    bluesky: "Enter a Bluesky handle or a bsky.app/profile/<handle> link",
    x: "Enter an X username or an x.com/<username> link",
}
const optional = Schema.optionalKey
const stored = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))

const blueskyHandle = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    xUsername = /^[a-z0-9_]{1,15}$/,
    HANDLE_MAX = 100
const pendingAccount = /^pending:([a-z0-9._-]{1,100})$/
/** An account as a follow names it: Its stable ID, or pending:<handle> until the backend looks the handle up */
export const isFeedAccountKey = (value: string) => isFeedAccountId(value) || pendingAccount.test(value)
export const FeedAccountKey = Schema.String.check(Schema.makeFilter(isFeedAccountKey))
/** A follow's name among a backup's items, which are tokens */
export const feedAccountToken = (provider: FeedProvider, key: string) =>
    `${provider}_${key.replace(/[^a-zA-Z0-9-]/g, "_")}`
/** The handle in a pending account key, or undefined for a stable ID */
export const feedPendingHandle = (key: string) => pendingAccount.exec(key)?.[1]
function linkedAccount(provider: FeedProvider, text: string) {
    let url: URL
    try {
        url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    } catch {
        return undefined
    }
    const host = url.hostname.toLowerCase().replace(/^(?:www|mobile)\./, "")
    if (url.username || url.password) return undefined
    if (provider === "bluesky")
        return host === "bsky.app" ? /^\/profile\/([^/]+)(?:\/.*)?$/.exec(url.pathname)?.[1] : undefined
    return host === "x.com" || host === "twitter.com"
        ? /^\/@?([A-Za-z0-9_]{1,15})(?:\/.*)?$/.exec(url.pathname)?.[1]
        : undefined
}
/**
 * The account key a typed handle or link names, or undefined when it names none. A Bluesky name without a dot means its bsky.social handle,
 * as the app shows it, and a Bluesky DID is already the stable ID. X usernames stay pending, since a numeric username is not a user ID
 */
export function feedAccountKey(provider: FeedProvider, value: string): string | undefined {
    const typed = value
        .trim()
        .replace(/^<(.+)>$/, "$1")
        .replace(/^@/, "")
    const looksLinked = /^https?:\/\//i.test(typed) || typed.includes("/")
    const named = looksLinked ? linkedAccount(provider, typed) : typed
    if (!named) return undefined
    let text: string
    try {
        text = decodeURIComponent(named).toLowerCase()
    } catch {
        return undefined
    }
    if (provider === "x") return xUsername.test(text) ? `pending:${text}` : undefined
    if (isFeedAccountId(text) && text.startsWith("did:")) return text
    const handle = text.includes(".") ? text : `${text}.bsky.social`
    return handle.length <= HANDLE_MAX && blueskyHandle.test(handle) ? `pending:${handle}` : undefined
}

/** Why NeonFlux turned a follow off: Its destination channel is gone, or NeonFlux cannot post there */
export const FeedProblem = Schema.Literals(["channel", "permission"])
export type FeedProblem = typeof FeedProblem.Type
/** The source's state as every server following it sees it. error is why posts may be missed, and stopped means NeonFlux stopped trying */
export const FeedStatus = Schema.Struct({
    handle: optional(stored(253)),
    name: optional(stored(256)),
    stopped: optional(Schema.Boolean),
    error: optional(stored(300)),
    lastReadAt: optional(Millis),
    lastItemAt: optional(Millis),
    lastPostAt: optional(Millis),
})
export type FeedStatus = typeof FeedStatus.Type
/** One followed account and where its posts go. The account is pending:<handle> until the backend looks it up */
export const FeedSubscription = Schema.Struct({
    provider: FeedProvider,
    accountId: FeedAccountKey,
    channelId: Id,
    enabled: Schema.Boolean,
    problem: optional(FeedProblem),
    createdAt: Millis,
    status: FeedStatus,
})
export type FeedSubscription = typeof FeedSubscription.Type
/** xConfigured is whether this deployment holds an X key, and xPaused that it spent its monthly X reads. Subscriptions are sorted by provider and account */
export const FeedView = Schema.Struct({
    xConfigured: Schema.Boolean,
    xPaused: Schema.Boolean,
    subscriptions: List(FeedSubscription, FEED_LIMIT),
})
export type FeedView = typeof FeedView.Type
/** Add follows an account or, for one already followed, changes its destination and turns it back on */
export const FeedOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("add"), provider: FeedProvider, accountId: FeedAccountKey, channelId: Id }),
    Schema.Struct({ type: Schema.Literal("remove"), provider: FeedProvider, accountId: FeedAccountKey }),
])
export type FeedOperation = typeof FeedOperation.Type
/** Chat changes carry the server manager's fresh native authority, like sticky messages */
export const FeedManageRequest = Schema.Struct({
    ...origin,
    serverId: Id,
    messageId: Id,
    createdAt: Millis,
    actor: ModerationActor,
    managerAuthorized: Schema.Literal(true),
    operation: FeedOperation,
})
export type FeedManageRequest = typeof FeedManageRequest.Type
export const FeedManageResult = Schema.Struct({
    type: Schema.Literals(["added", "removed"]),
    subscription: FeedSubscription,
})
export type FeedManageResult = typeof FeedManageResult.Type
/** sample asks for a test post of one followed account, built like a real post from its latest post or a placeholder */
export const FeedQueryRequest = Schema.Struct({
    serverId: Id,
    sample: optional(Schema.Struct({ provider: FeedProvider, accountId: FeedAccountKey })),
})
export type FeedQueryRequest = typeof FeedQueryRequest.Type
export const FeedQueryResult = Schema.Struct({
    ...FeedView.fields,
    sample: optional(Schema.Struct({ channelId: Id, content: PublishingContent, forumPostName: stored(100) })),
})
export type FeedQueryResult = typeof FeedQueryResult.Type
/** The bot's fresh read of a post's destination, acting as itself */
export const FeedDeliveryContext = Schema.Struct({
    ...origin,
    observedAt: Millis,
    channelId: Id,
    botId: Id,
    botAuthorized: Schema.Literal(true),
})
export type FeedDeliveryContext = typeof FeedDeliveryContext.Type
const { accountId, itemId } = PublishingFeedConsumer.fields
/** A post that waits for the bot, with its follow's current destination */
export const FeedDelivery = Schema.Struct({ provider: FeedProvider, accountId, itemId, channelId: Id })
export type FeedDelivery = typeof FeedDelivery.Type
/**
 * list returns up to ten due posts. reserve claims one for the publisher. defer waits a minute after a failed read, and blocked turns a
 * follow off because its destination is gone or NeonFlux cannot post there. channelId names the destination the bot read
 */
export const FeedWorkOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("list") }),
    Schema.Struct({
        type: Schema.Literal("reserve"),
        provider: FeedProvider,
        accountId,
        itemId,
        context: FeedDeliveryContext,
    }),
    Schema.Struct({ type: Schema.Literal("defer"), provider: FeedProvider, accountId, itemId }),
    Schema.Struct({
        type: Schema.Literal("blocked"),
        provider: FeedProvider,
        accountId,
        channelId: Id,
        reason: FeedProblem,
    }),
])
export type FeedWorkOperation = typeof FeedWorkOperation.Type
export const FeedWorkRequest = Schema.Struct({ serverId: Id, operation: FeedWorkOperation })
export type FeedWorkRequest = typeof FeedWorkRequest.Type
/**
 * skipped means the post will not be sent, for example because its follow is off or it is a day old. recorded is false when nothing
 * changed. A recorded blocked report names the account, so the staff note can use it
 */
export const FeedWorkResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("deliveries"), deliveries: List(FeedDelivery, FEED_WORK_BATCH) }),
    Schema.Struct({ type: Schema.Literal("reserved"), grant: PublishingGrant }),
    Schema.Struct({ type: Schema.Literal("skipped") }),
    Schema.Struct({ type: Schema.Literal("progress"), recorded: Schema.Boolean, name: optional(stored(256)) }),
])
export type FeedWorkResult = typeof FeedWorkResult.Type
