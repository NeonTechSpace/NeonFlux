import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect } from "effect"
import { createBotOptions } from "../src/bot.ts"
import type { CleanupStore } from "../src/cleanup-store.ts"
import { boundary, platform, token } from "./moderation-fixture.ts"

const f = createFixtures()
function remote() {
    const calls: C.CleanupManageRequest[] = [], queries: C.CleanupQueryRequest["operation"][] = []
    const settings: C.CleanupSettings = { enabled: false, revision: 3, policies: 1, retainedTargets: 0, retainedSweeps: 0, receipts: 0, targetCapacity: 10000, quotaPaused: false }
    const policy: C.CleanupPolicy = { channelId: f.ids.channel, revision: 1, enabled: false, ageMs: 86400000, ownerId: f.ids.user, excludedAuthorIds: [], excludedMessageIds: [], nextCheckAt: 0 }
    const policies = [policy]
    const store: CleanupStore = {
        query: input => Effect.sync((): C.CleanupQueryResult => { queries.push(input.operation); const op = input.operation
            if (op.type === "settings") return { type: "settings", settings }
            if (op.type === "list") return { type: "policies", policies }
            if (op.type === "status") return { type: "status", settings, policy, sweep: null, page: null, targets: [], ...(op.beforeTargetNo ? {} : { nextBeforeTargetNo: 7 }) }
            return { type: "policy", policy }
        }),
        work: input => Effect.succeed(input.operation.type === "list" ? { type: "policies", policies: [], hasMore: false, settings } : { type: "progress", recorded: true, complete: true }),
        manage: input => Effect.sync(() => { calls.push(input); const op = input.operation
            if (op.type === "enable") { policy.enabled = op.enabled; policy.revision++ }
            return { duplicate: false, type: "policy", policy } as C.CleanupManageResult
        }),
    }
    return { store, calls, queries, policy, policies }
}
const options = (store: CleanupStore, moderation?: ReturnType<typeof boundary>["store"]) => createBotOptions({ token, serverId: f.ids.guild }, { moderation, cleanup: store })
test("gateway cleanup namespace warns before explicit enable and preserves mention suppression", async () => {
    const r = remote()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(r.store)), p = platform(bot)
        bot.rest.respond(`GET /users/${f.ids.user}`, { body: bot.fixtures.user({ bot: false, system: false }) })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!cleanup enable <#${f.ids.channel}>` })); const warning = yield* p.replies.next(); yield* bot.idle()
        assert.match((warning.body as { content: string }).content, /existing messages older[^]*\nConfirm: !cleanup enable \d+ confirm$/); assert.equal(r.calls.length, 0); assert.equal(r.queries.length, 0)
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!cleanup enable ${f.ids.channel} confirm` })); yield* p.replies.next(); yield* bot.idle()
        // The policy revision comes from the list read right before the write
        assert.deepEqual(r.queries, [{ type: "list" }])
        assert.equal(r.calls.length, 1); assert.deepEqual(r.calls[0]!.operation, { type: "enable", channelId: f.ids.channel, expectedRevision: 1, enabled: true, confirm: true })
        assert.equal(r.calls[0]!.context.actor.userId, f.ids.user); assert.equal(r.calls[0]!.context.actorKind, "human")
        assert(p.replies.requests().every(req => { assert.deepEqual((req.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false }); return true }))
        const before = r.calls.length
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ guild_id: undefined, channel_id: p.dmId, content: `!cleanup disable ${f.ids.channel}` })); yield* bot.idle()
        assert.equal(r.calls.length, before); assert.equal(bot.failures().length, 0)
    })))
})
test("current staff can disable cleanup while manual moderation is off at DEFCON 2", async () => {
    const r = remote(), moderation = boundary()
    moderation.current.manualModerationEnabled = false
    moderation.store.gate = () => Effect.succeed({ allowed: false, defcon: 2, messageProtectionEnabled: false, joinProtectionEnabled: false, botMessageProtectionEnabled: false })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(r.store, moderation.store)), p = platform(bot, { targetPermissions: Permissions.Administrator })
        bot.rest.respond(`GET /users/${f.ids.user}`, { body: bot.fixtures.user({ bot: false, system: false }) })
        bot.rest.respond(`GET /users/${p.targetId}`, { body: bot.fixtures.user({ id: p.targetId, bot: false, system: false }) })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!cleanup disable ${f.ids.channel}` })); yield* p.replies.next(); yield* bot.idle()
        assert.equal(r.calls.length, 1); assert.equal(r.calls[0]!.context.actor.userId, f.ids.user)
        assert.deepEqual(r.calls[0]!.operation, { type: "enable", channelId: f.ids.channel, expectedRevision: 1, enabled: false })
        assert.equal(bot.failures().length, 0)
    })))
})
test("a new policy starts from revision 0 and the module and exclusions use the current revisions", async () => {
    const r = remote()
    r.policies.length = 0
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(r.store)), p = platform(bot)
        bot.rest.respond(`GET /users/${f.ids.user}`, { body: bot.fixtures.user({ bot: false, system: false }) })
        yield* bot.ready()
        for (const content of [`!cleanup configure <#${f.ids.channel}> 30d`, "!cleanup module on", `!cleanup exclude <#${f.ids.channel}> author add <@${f.ids.user}>`]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); yield* p.replies.next(); yield* bot.idle()
            if (content.includes("configure")) r.policies.push(r.policy)
        }
        assert.deepEqual(r.queries, [{ type: "list" }, { type: "settings" }, { type: "list" }])
        assert.deepEqual(r.calls.map(c => c.operation), [{ type: "configure", channelId: f.ids.channel, ageMs: 2592000000, expectedRevision: 0 }, { type: "module", enabled: true, expectedRevision: 3 },
            { type: "exclude", channelId: f.ids.channel, kind: "author", add: true, id: f.ids.user, expectedRevision: 1 }])
        assert.equal(bot.failures().length, 0)
    })))
})
test("channel status pages targets with next and says when no next page is remembered", async () => {
    const r = remote()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(r.store)), p = platform(bot)
        bot.rest.respond(`GET /users/${f.ids.user}`, { body: bot.fixtures.user({ bot: false, system: false }) })
        yield* bot.ready()
        const send = (content: string) => Effect.gen(function* () { yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); const reply = yield* p.replies.next(); yield* bot.idle(); return (reply.body as { content: string }).content })
        assert.match(yield* send(`!cleanup status <#${f.ids.channel}>`), new RegExp(`\\nNext: !cleanup status ${f.ids.channel} next$`))
        assert.doesNotMatch(yield* send(`!cleanup status ${f.ids.channel} next`), /Next:/)
        assert.equal(yield* send(`!cleanup status ${f.ids.channel} next`), `There is no next page to show. Send !cleanup status ${f.ids.channel} to start the list again`)
        assert.deepEqual(r.queries, [{ type: "status", channelId: f.ids.channel }, { type: "status", channelId: f.ids.channel, beforeTargetNo: 7 }])
        assert.equal(bot.failures().length, 0)
    })))
})
