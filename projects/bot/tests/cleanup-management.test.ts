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
    const calls: C.CleanupManageRequest[] = []
    const settings: C.CleanupSettings = { enabled: false, revision: 1, policies: 1, retainedTargets: 0, retainedSweeps: 0, receipts: 0, targetCapacity: 10000, quotaPaused: false }
    const policy: C.CleanupPolicy = { channelId: f.ids.channel, revision: 1, enabled: false, ageMs: 86400000, ownerId: f.ids.user, excludedAuthorIds: [], excludedMessageIds: [], nextCheckAt: 0 }
    const store: CleanupStore = {
        query: input => Effect.succeed(input.operation.type === "settings" ? { type: "settings", settings } : { type: "policy", policy }),
        work: input => Effect.succeed(input.operation.type === "list" ? { type: "policies", policies: [], hasMore: false, settings } : { type: "progress", recorded: true, complete: true }),
        manage: input => Effect.sync(() => { calls.push(input); const op = input.operation
            if (op.type === "enable") { policy.enabled = op.enabled; policy.revision++ }
            return { duplicate: false, type: "policy", policy } as C.CleanupManageResult
        }),
    }
    return { store, calls, policy }
}
const options = (store: CleanupStore, moderation?: ReturnType<typeof boundary>["store"]) => createBotOptions({ token, serverId: f.ids.guild }, { moderation, cleanup: store })
test("gateway cleanup namespace warns before explicit enable and preserves mention suppression", async () => {
    const r = remote()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(r.store)), p = platform(bot)
        bot.rest.respond(`GET /users/${f.ids.user}`, { body: bot.fixtures.user({ bot: false, system: false }) })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!cleanup enable <#${f.ids.channel}> 1` })); const warning = yield* p.replies.next(); yield* bot.idle()
        assert.match((warning.body as { content: string }).content, /existing messages older/); assert.equal(r.calls.length, 0)
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!cleanup enable ${f.ids.channel} 1 confirm` })); yield* p.replies.next(); yield* bot.idle()
        assert.equal(r.calls.length, 1); assert.deepEqual(r.calls[0]!.operation, { type: "enable", channelId: f.ids.channel, expectedRevision: 1, enabled: true, confirm: true })
        assert.equal(r.calls[0]!.context.actor.userId, f.ids.user); assert.equal(r.calls[0]!.context.actorKind, "human")
        assert(p.replies.requests().every(req => { assert.deepEqual((req.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false }); return true }))
        const before = r.calls.length
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ guild_id: undefined, channel_id: p.dmId, content: `!cleanup disable ${f.ids.channel} 2` })); yield* bot.idle()
        assert.equal(r.calls.length, before); assert.equal(bot.failures().length, 0)
    })))
})
test("current staff can disable cleanup while manual moderation is off at DEFCON 2", async () => {
    const r = remote(), moderation = boundary()
    moderation.current.manualModerationEnabled = false
    moderation.store.gate = () => Effect.succeed({ allowed: false, defcon: 2, messageProtectionEnabled: false, joinProtectionEnabled: false })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(r.store, moderation.store)), p = platform(bot, { targetPermissions: Permissions.Administrator })
        bot.rest.respond(`GET /users/${f.ids.user}`, { body: bot.fixtures.user({ bot: false, system: false }) })
        bot.rest.respond(`GET /users/${p.targetId}`, { body: bot.fixtures.user({ id: p.targetId, bot: false, system: false }) })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!cleanup disable ${f.ids.channel} 1` })); yield* p.replies.next(); yield* bot.idle()
        assert.equal(r.calls.length, 1); assert.equal(r.calls[0]!.context.actor.userId, f.ids.user)
        assert.deepEqual(r.calls[0]!.operation, { type: "enable", channelId: f.ids.channel, expectedRevision: 1, enabled: false })
        assert.equal(bot.failures().length, 0)
    })))
})
