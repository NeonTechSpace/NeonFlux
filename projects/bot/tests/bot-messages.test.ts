import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { parseSafetyCommand } from "../src/moderation-command.ts"
import { settingsCard } from "../src/moderation-format.ts"
import { boundary, platform, token } from "./moderation-fixture.ts"

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const emit = (bot: Bot, content: string, overrides = {}) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content, ...overrides })).pipe(Effect.andThen(bot.idle()))
const evaluated = (calls: { method: string, input: unknown }[]) => calls.filter((call) => call.method === "evaluate").map((call) => call.input as C.ModerationEvaluateRequest)

test("webhook and other bots' messages cost no backend call while bot message checks are off, and a member message's gate turns them on", async () => {
    const f = createFixtures()
    const b = boundary()
    b.current.automodEnabled = true
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        platform(bot)
        yield* bot.ready()
        const baseline = b.calls.length
        const hook = bot.fixtures.nextId(), other = bot.fixtures.user({ id: bot.fixtures.nextId(), bot: true })
        yield* emit(bot, "spam", { webhook_id: hook, author: bot.fixtures.user({ id: hook, bot: true }) })
        yield* emit(bot, "spam", { author: other })
        yield* bot.emit("MESSAGE_UPDATE", bot.fixtures.message({ content: "edited spam", author: other, edited_timestamp: "2026-10-04T01:00:00.000Z" })).pipe(Effect.andThen(bot.idle()))
        assert.equal(b.calls.length, baseline)
        // The dashboard turned the check on. The next member message's gate reports it
        b.current.automodBotMessagesEnabled = true
        yield* emit(bot, "hello")
        const before = evaluated(b.calls).length
        yield* emit(bot, "spam", { author: other })
        assert.deepEqual(evaluated(b.calls).slice(before).map((input) => [input.author, input.userId]), [["bot", other.id]])
        assert.equal(bot.failures().length, 0)
    })))
})

test("a checked webhook message is evaluated without a member read, a granted deletion removes it, and NeonFlux's own messages are never evaluated", async () => {
    const f = createFixtures()
    const b = boundary({ evaluate: (input) => {
        b.calls.push({ method: "evaluate", input })
        const grant: C.ModerationActionGrant = { actionId: "synthetic_case_id", caseNo: 1, sourceId: input.messageId, action: "delete", channelId: input.channelId, messageIds: [input.messageId], reason: "Automod test" }
        return Effect.succeed({ duplicate: false, blocked: true, grant, case: { ...grant, origin: "automod", createdAt: input.createdAt, expiresAt: input.createdAt + 1, outcome: "pending",
            logOutcome: "none", notificationOutcome: "none", erased: false, voided: false, corrections: [] } })
    } })
    b.current.automodEnabled = true
    b.current.automodBotMessagesEnabled = true
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        const deletes = bot.rest.respond("DELETE /channels/:id/messages/:id", { status: 204 })
        yield* bot.ready()
        const hook = bot.fixtures.nextId()
        const message = bot.fixtures.message({ content: "spam", webhook_id: hook, author: bot.fixtures.user({ id: hook }) })
        yield* bot.emit("MESSAGE_CREATE", message).pipe(Effect.andThen(bot.idle()))
        const [input] = evaluated(b.calls)
        assert.equal(input?.author, "webhook")
        assert.equal(input?.userId, hook)
        assert.deepEqual(input?.roleIds, [])
        assert.equal(input?.context.targetProtected, false)
        assert.deepEqual(input?.context.botAuthorizedActions, ["log", "delete"])
        assert.deepEqual(deletes.requests().map((request) => request.path), [`/channels/${f.ids.channel}/messages/${message.id}`])
        // No member was read for the webhook, and nobody was told about it
        assert.equal(p.actor.requests().length + p.target.requests().length + p.replies.requests().length, 0)
        yield* emit(bot, "spam", { author: bot.fixtures.botUser() })
        assert.equal(evaluated(b.calls).length, 1)
        assert.equal(bot.failures().length, 0)
    })))
})

test("turning bot message checks on in chat applies to the very next webhook message, and status shows the switch", async () => {
    const f = createFixtures()
    const b = boundary({ manage: (input) => {
        b.calls.push({ method: "manage", input })
        if (input.operation.type === "settings") Object.assign(b.current, input.operation.patch)
        return Effect.succeed({ duplicate: false, type: "settings", settings: b.current })
    } })
    b.current.automodEnabled = true
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        platform(bot)
        yield* bot.ready()
        yield* emit(bot, "!automod bots on")
        const hook = bot.fixtures.nextId()
        yield* emit(bot, "spam", { webhook_id: hook, author: bot.fixtures.user({ id: hook, bot: true }) })
        assert.deepEqual(evaluated(b.calls).filter((input) => input.author).map((input) => input.userId), [hook])
        assert.equal(bot.failures().length, 0)
    })))
    assert.deepEqual(settingsCard(b.current, "automod", (feature, rest) => `!${feature} ${rest}`).fields!.find(([label]) => label === "Bot and webhook messages"), ["Bot and webhook messages", "Checked"])

})

test("automod commands turn bot message checks on and off and create rolling and deceptive-link rules with their defaults", () => {
    assert.deepEqual(parseSafetyCommand("automod", ["bots", "on"]), { kind: "manage", operation: { type: "settings", patch: { automodBotMessagesEnabled: true } } })
    assert.deepEqual(parseSafetyCommand("automod", ["bots", "off"]), { kind: "manage", operation: { type: "settings", patch: { automodBotMessagesEnabled: false } } })
    const created = (type: string) => {
        const parsed = parseSafetyCommand("automod", ["create", "rule", type, "timeout"])
        return "kind" in parsed && parsed.kind === "manage" && parsed.operation.type === "rule-create" ? [parsed.operation.rule.threshold, parsed.operation.rule.windowSeconds] : parsed
    }
    assert.deepEqual(created("mention-rate"), [10, 30])
    assert.deepEqual(created("link-rate"), [6, 30])
    assert.deepEqual(created("deceptive-links"), [1, 10])
    assert.ok("error" in parseSafetyCommand("automod", ["create", "rule", "lookalikes", "timeout"]))
})
