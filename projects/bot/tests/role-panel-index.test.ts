import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { createPanelIndex, panelIndexTtlMs } from "../src/role-panel-index.ts"
import { boundary, token } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { rolesBoundary } from "./roles-fixture.ts"
import { nativeRoles, savedPanel } from "./roles-native-fixture.ts"

const published = (messageId: string) => ({ name: `panel${messageId}`, kind: "reaction", revision: 1, enabled: true, exclusive: false, mappings: [], withdrawing: false,
    published: { revision: 1, publishedAt: 0, postNo: 1, postGeneration: 1, channelId: "1", messageId, botId: "2", content: { content: "Panel" }, mappings: [], exclusive: false } }) as C.RolesPanel
const list = (...panels: C.RolesPanel[]) => Effect.succeed({ panels })

test("a learned panel list answers until it expires, and a change forgets it and any read that overlapped it", async () => {
    await Effect.runPromise(Effect.gen(function* () {
        const index = createPanelIndex()
        assert.equal(yield* index.mayBePanel("10"), true)
        yield* index.learn(list(published("10"), { ...published("11"), published: undefined } as unknown as C.RolesPanel))
        assert.equal(yield* index.mayBePanel("10"), true)
        assert.equal(yield* index.mayBePanel("11"), false)
        assert.equal(yield* index.mayBePanel("12"), false)
        yield* TestClock.adjust(panelIndexTtlMs)
        assert.equal(yield* index.mayBePanel("12"), true)
        yield* index.learn(list(published("10")))
        assert.equal(yield* index.mayBePanel("12"), false)
        // A read that starts before a change and answers during it is not learned, and neither is one during the change
        const reading = yield* Deferred.make<void>(), entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), answer = yield* Deferred.make<void>()
        const overlapping = yield* Effect.forkChild(index.learn(Deferred.succeed(reading, undefined).pipe(Effect.andThen(Deferred.await(answer)), Effect.andThen(list(published("10"))))))
        yield* Deferred.await(reading)
        const change = yield* Effect.forkChild(index.change(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))))
        yield* Deferred.await(entered)
        assert.equal(yield* index.mayBePanel("12"), true)
        yield* index.learn(list(published("10")))
        assert.equal(yield* index.mayBePanel("12"), true)
        yield* Deferred.succeed(answer, undefined); yield* Fiber.join(overlapping)
        assert.equal(yield* index.mayBePanel("12"), true)
        yield* Deferred.succeed(release, undefined); yield* Fiber.join(change)
        assert.equal(yield* index.mayBePanel("12"), true)
        yield* index.learn(list(published("10")))
        assert.equal(yield* index.mayBePanel("12"), false)
    }).pipe(Effect.provide(TestClock.layer())))
})

test("reactions on other messages skip every read once the panel list is known, and a panel published by command is still served", async () => {
    const f = createFixtures(), publishing = publishingBoundary(), remote = rolesBoundary(publishing.store)
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: boundary().store, publishing: publishing.store, roles: remote.store }))
        const p = nativeRoles(bot)
        bot.rest.respond(request => new URL(request.url).pathname.endsWith("/users"), { body: { items: [{ id: p.targetId, username: "Synthetic reactor" }], has_more: false, next_after: null } })
        yield* bot.ready()
        const run = (content: string) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))
        const react = (messageId: string) => bot.emit("MESSAGE_REACTION_ADD", { guild_id: f.ids.guild, channel_id: f.ids.channel, message_id: messageId, user_id: p.targetId, emoji: { name: "✅" } }).pipe(Effect.andThen(bot.idle()))
        for (const command of ["!roles module on", "!publish create colors", '!publish set colors content "Choose a role"', "!roles create colors toggle",`!roles map colors ✅ <@&${p.role.id}>`]) yield* run(command)
        // The first reaction reads the panel list, the second needs nothing
        yield* react(f.nextId())
        const reads = bot.requests().length, calls = remote.calls.length
        yield* react(f.nextId())
        assert.equal(bot.requests().length, reads)
        assert.equal(remote.calls.length, calls)
        // Publishing reads the list before it binds the new message, and the bind forgets that list
        yield* run(`!roles publish colors <#${f.ids.channel}> colors`)
        const panel = remote.panels.get("colors")!
        assert.ok(panel?.published, p.send.requests().map(request => (request.body as { content: string }).content).join("\n"))
        yield* react(panel.published.messageId)
        assert.equal(p.add.requests().length, 1)
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("a panel the bot did not see published is served once the learned list expires", async () => {
    const f = createFixtures(), remote = rolesBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: boundary().store, roles: remote.store }))
        const p = nativeRoles(bot)
        remote.current.panelsEnabled = true
        bot.rest.respond(request => new URL(request.url).pathname.endsWith("/users"), { body: { items: [{ id: p.targetId, username: "Synthetic reactor" }], has_more: false, next_after: null } })
        yield* bot.ready()
        const react = (messageId: string) => bot.emit("MESSAGE_REACTION_ADD", { guild_id: f.ids.guild, channel_id: f.ids.channel, message_id: messageId, user_id: p.targetId, emoji: { name: "✅" } }).pipe(Effect.andThen(bot.idle()))
        yield* react(f.nextId())
        const panel = savedPanel(bot, p, remote)
        yield* react(panel.published!.messageId)
        assert.equal(p.add.requests().length, 0)
        yield* TestClock.adjust(panelIndexTtlMs)
        yield* react(panel.published!.messageId)
        assert.equal(p.add.requests().length, 1)
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
})
