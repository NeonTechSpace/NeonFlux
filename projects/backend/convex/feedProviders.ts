import type { FeedProvider } from "@neonflux/contracts/feeds"
import { blueskyConnection, blueskyItemPosted } from "./feedBluesky.ts"
import type { FeedConnection } from "./feedRead.ts"
import { xConnection, xItemPosted } from "./feedX.ts"

/** Each provider's connection. All else about feeds is shared */
export const feedConnections: Record<FeedProvider, FeedConnection> = { bluesky: blueskyConnection, x: xConnection }
/** Whether NeonFlux posts one provider item, see the provider's own rules. The detector evals score this */
export const feedItemPosted = (provider: FeedProvider, account: string, item: unknown) =>
    provider === "bluesky" ? blueskyItemPosted(account, item) : xItemPosted(account, item)
