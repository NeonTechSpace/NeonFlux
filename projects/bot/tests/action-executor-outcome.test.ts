import assert from "node:assert/strict"
import test from "node:test"
import type { ModerationActionGrant } from "@neonflux/contracts/moderation"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Cause, Effect, Exit, Fiber } from "effect"
import { executeAction } from "../src/action-executor.ts"
import { platform } from "./moderation-fixture.ts"

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
function timeoutGrant(bot: Bot, targetId: string, durationSeconds = 60): ModerationActionGrant {
    return { actionId: "synthetic_timeout", caseNo: 1, sourceId: bot.fixtures.nextId(),
        action: "timeout", reason: "Synthetic reason", targetId, durationSeconds, expectedTimeoutUntil: null }
}

test("native action failures distinguish proven local non-dispatch from rejection, transport and unusable success", async () => {
    for (const variation of ["local", "rejection", "server", "response", "network"] as const) {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-executor-token" })
            const p = platform(bot)
            const write = bot.rest.respond(`PATCH /guilds/${bot.fixtures.ids.guild}/members/${p.targetId}`, () => {
                if (variation === "network") throw new Error("Synthetic private transport failure")
                return variation === "rejection" ? { status: 403, body: { message: "Synthetic private rejection" } }
                    : variation === "server" ? { status: 500, body: { message: "Synthetic private server failure" } }
                    : variation === "response" ? { status: 200, body: { private: "Synthetic unusable response" } }
                    : { body: bot.fixtures.member({ user: bot.fixtures.user({ id: p.targetId }), communication_disabled_until: null }) }
            })
            const result = yield* executeAction(bot.client, bot.fixtures.ids.guild, bot.fixtures.ids.user, timeoutGrant(bot, p.targetId, variation === "local" ? -1 : 60), Effect.void)
            assert.deepEqual(result, { outcome: variation === "local" ? "failed" : "uncertain" })
            assert.equal(write.requests().length, variation === "local" ? 0 : 1)
            assert.ok(!JSON.stringify(result).includes("Synthetic private"))
        })))
    }
})

test("native client closure after a recorded action request preserves uncertainty without another dispatch", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-executor-close-token" })
        const p = platform(bot)
        const write = bot.rest.respond(`PATCH /guilds/${bot.fixtures.ids.guild}/members/${p.targetId}`, () => new Promise<never>(() => {}))
        const action = yield* Effect.forkChild(executeAction(bot.client, bot.fixtures.ids.guild, bot.fixtures.ids.user, timeoutGrant(bot, p.targetId), Effect.void))
        yield* write.next()
        yield* bot.client.shutdown()
        assert.deepEqual(yield* Fiber.join(action), { outcome: "uncertain" })
        assert.equal(write.requests().length, 1)
    })))
})

test("a failed native expiry lookup cannot replace an already successful ban outcome", async () => {
    for (const variation of ["rejection", "response", "rateLimit"] as const) {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-executor-ban-token" })
            const p = platform(bot)
            const write = bot.rest.respond(`PUT /guilds/${bot.fixtures.ids.guild}/bans/${p.targetId}`, { status: 204 })
            const read = bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/bans`, variation === "rejection"
                ? { status: 403, body: { message: "Synthetic private expiry rejection" } }
                : variation === "rateLimit" ? { status: 429, headers: { "retry-after": "6" }, body: { retry_after: 6, global: false } }
                : { status: 200, body: { private: "Synthetic unusable expiry response" } })
            const selected = { ...timeoutGrant(bot, p.targetId), action: "ban" as const }
            assert.deepEqual(yield* executeAction(bot.client, bot.fixtures.ids.guild, bot.fixtures.ids.user, selected, Effect.void), { outcome: "succeeded" })
            assert.equal(write.requests().length, 1)
            assert.equal(read.requests().length, 1)
        })))
    }
})

test("native action cancellation after dispatch stays interrupted and does not invent a failed or successful outcome", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-executor-interrupt-token" })
        const p = platform(bot)
        const write = bot.rest.respond(`PATCH /guilds/${bot.fixtures.ids.guild}/members/${p.targetId}`, () => new Promise<never>(() => {}))
        const action = yield* Effect.forkChild(executeAction(bot.client, bot.fixtures.ids.guild, bot.fixtures.ids.user, timeoutGrant(bot, p.targetId), Effect.void))
        yield* write.next()
        yield* Fiber.interrupt(action)
        const result = yield* Fiber.await(action)
        assert.ok(Exit.isFailure(result))
        assert.ok(Cause.hasInterrupts(result.cause))
        assert.equal(write.requests().length, 1)
    })))
})
