import assert from "node:assert/strict"
import test from "node:test"
import { blueskyConnection } from "../convex/feedBluesky.ts"
import { renderFeedPost, feedAuthorName, feedProfileUrl, planFeedRead } from "../convex/feedDomain.ts"

// Reads the real public Bluesky API, so it runs only when asked: NEONFLUX_FEED_LIVE=1 node --test tests/feed-bluesky-live.test.ts
// NEONFLUX_FEED_HANDLE picks another account than Bluesky's own. The aggregate check skips it and needs no network
const live = process.env.NEONFLUX_FEED_LIVE === "1"
const handle = process.env.NEONFLUX_FEED_HANDLE ?? "bsky.app"

test(
    "A real Bluesky handle resolves, its feed reads, selection runs and one post renders",
    { skip: !live },
    async () => {
        const account = await blueskyConnection.resolve(`pending:${handle}`)
        assert.equal(account.kind, "account")
        if (account.kind !== "account") return
        assert.match(account.accountId, /^did:/)
        const read = await blueskyConnection.read({ accountId: account.accountId, handle: account.handle })
        assert.equal(read.kind, "items", JSON.stringify(read))
        if (read.kind !== "items") return
        const now = Date.now(),
            selected = read.items.filter((item) => item.posted)
        assert.ok(selected.length > 0, "The account has at least one post that selection keeps")
        assert.equal(planFeedRead(undefined, read.items, now).post.length, 0, "A first read posts nothing")
        const item = selected[0]!,
            post = renderFeedPost(
                "bluesky",
                feedAuthorName({ handle: account.handle, ...(account.name ? { name: account.name } : {}) }, "Bluesky"),
                feedProfileUrl("bluesky", account.accountId, account.handle),
                item,
            )
        assert.equal(post.content.embed?.footer?.text, "Bluesky")
        assert.match(post.content.embed?.url ?? "", /^https:\/\/bsky\.app\/profile\/did:[^/]+\/post\/[a-z2-7]{13}$/)
        console.log(
            JSON.stringify(
                {
                    did: account.accountId,
                    handle: account.handle,
                    name: account.name,
                    items: read.items.length,
                    selected: selected.length,
                    embed: post.content.embed,
                    forumPostName: post.forumPostName,
                },
                null,
                2,
            ),
        )
        const missing = await blueskyConnection.resolve("pending:this-handle-does-not-exist-zz.bsky.social")
        assert.equal(missing.kind, "missing")
    },
)
