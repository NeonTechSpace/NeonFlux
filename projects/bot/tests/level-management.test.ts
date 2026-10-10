import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { levelsBoundary, levelProfile } from "./level-fixture.ts"
import { platform, token } from "./moderation-fixture.ts"
import { nativeRoles } from "./roles-native-fixture.ts"
import { LevelingStoreError } from "../src/level-store.ts"

test("native rank and leaderboard commands use fresh member evidence and suppress all mentions", async () => {
    const f = createFixtures(), remote = levelsBoundary({ query: input => input.operation.type === "rank"
        ? Effect.succeed({ type: "rank", profile: levelProfile(input.operation.userId ?? input.actor.userId, 100000000), rank: { type: "outside-top-1000" } })
        : Effect.succeed({ type: "leaderboard", profiles: [levelProfile(f.ids.user, 1234)] }) })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { leveling: remote.store })), p = platform(bot)
        yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!rank" }))
        const card = yield* p.replies.next(); yield* bot.idle()
        const body = card.body as { content: string, embeds: { fields: { value: string }[] }[], allowed_mentions: { parse: string[], users: string[], roles: string[], replied_user: boolean } }
        assert.match(body.embeds[0]!.fields[2]!.value, /Outside the top 1000/)
        assert.doesNotMatch(JSON.stringify(body), /epoch|revision/i)
        assert.deepEqual(body.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!leaderboard" })); yield* p.replies.next(); yield* bot.idle()
        const reads = remote.calls.filter(c => c.method === "query")
        assert.equal(reads.length, 2)
        for (const read of reads) {
            const input = read.input as C.LevelingQueryRequest
            assert.equal(input.member.userId, f.ids.user); assert.equal(input.member.isBot, false)
            assert.equal(input.member.joinedAt, "2026-01-01T00:00:00.000Z")
            assert(input.observedAt > 0)
        }
        assert.equal(p.actor.requests().length, 2)
        assert.equal(bot.failures().length, 0)
    })))
})

test("management remains owner/admin only and reset preview makes no backend change", async () => {
    const f = createFixtures(), remote = levelsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { leveling: remote.store })), p = platform(bot, { actorOwner: false, actorPermissions: 0n })
        yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!level module on" }))
        const denied = yield* p.replies.next(); yield* bot.idle()
        assert.match((denied.body as { content: string }).content, /Only the server owner/)
        assert.equal(remote.calls.some(c => c.method === "manage"), false)
        p.actor.remove(); bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: bot.fixtures.member({ roles: [p.actorRole.id], communication_disabled_until: null }) })
        p.guildRoute.remove(); bot.rest.respond("GET /guilds/:id", { body: bot.fixtures.guild({ owner_id: f.ids.user }) })
        // The reason needs no quotes. A double quote in it is escaped, and an apostrophe inside a word is plain text
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!level reset member 123456789012345679 Member's \\"request\\" don't` }))
        const preview = yield* p.replies.next(); yield* bot.idle()
        const confirm = (preview.body as { content: string }).content.split("Confirm this exact scope with: ")[1]!
        assert.equal(confirm, `!level reset member 123456789012345679 Member's \\"request\\" don't confirm`)
        assert.equal(remote.calls.some(c => c.method === "manage"), false)
        // The printed command confirms the same scope and reason
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: confirm })); yield* p.replies.next(); yield* bot.idle()
        assert.deepEqual((remote.calls.find(c => c.method === "manage")!.input as C.LevelingManageRequest).operation,
            { type: "reset-member", userId: "123456789012345679", confirm: "reset-member", reason: `Member's "request" don't` })
    })))
})

test("the leaderboard and the audit list page with next from where the last reply ended", async () => {
    const f = createFixtures(), cursor = { xp: 1234, userId: "123456789012345679", scoreEpoch: 1 }
    let reset = false
    const remote = levelsBoundary({ query: input => {
        const op = input.operation
        if (op.type === "leaderboard") return reset && op.cursor ? Effect.fail(new LevelingStoreError({ operation: "query", status: 409 }))
            : Effect.succeed({ type: "leaderboard", profiles: [levelProfile(f.ids.user, op.cursor ? 100 : 2000)], ...(op.cursor ? {} : { nextCursor: cursor }) })
        return Effect.succeed({ type: "audits", audits: [], ...(op.type === "audits" && op.beforeAuditNo === undefined ? { nextBeforeAuditNo: 7 } : {}) })
    } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { leveling: remote.store })), p = platform(bot)
        const say = (content: string) => Effect.gen(function* () {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); const sent = yield* p.replies.next(); yield* bot.idle()
            return (sent.body as { content: string }).content
        })
        yield* bot.ready()
        assert.match(yield* say("!leaderboard"), /\nNext: !leaderboard next$/)
        assert.doesNotMatch(yield* say("!leaderboard next"), /Next/)
        assert.equal(yield* say("!leaderboard next"), "There is no next page to show. Send !leaderboard to start the list again")
        const operations = (type: string) => remote.calls.filter(c => c.method === "query").map(c => (c.input as C.LevelingQueryRequest).operation).filter(op => op.type === type)
        assert.deepEqual(operations("leaderboard"), [{ type: "leaderboard" }, { type: "leaderboard", cursor }])
        // A server reset refuses the remembered position, which is then forgotten
        yield* say("!leaderboard"); reset = true
        assert.match(yield* say("!leaderboard next"), /Leveling state changed/)
        assert.equal(yield* say("!leaderboard next"), "There is no next page to show. Send !leaderboard to start the list again")
        assert.match(yield* say("!level audit"), /\nNext: !level audit next$/)
        assert.doesNotMatch(yield* say("!level audit next"), /Next/)
        assert.equal(yield* say("!level audit next"), "There is no next page to show. Send !level audit to start the list again")
        assert.deepEqual(operations("audits"), [{ type: "audits" }, { type: "audits", beforeAuditNo: 7 }])
        assert.equal(bot.failures().length, 0)
    })))
})

test("confirmed resets, corrections and settings bind source, scope, current revision and exact confirmation", async () => {
    const f = createFixtures(), remote = levelsBoundary({ manage: () => Effect.succeed({ duplicate: true }) })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { leveling: remote.store })), p = platform(bot)
        yield* bot.ready()
        const commands = [
            "!level reset member 123456789012345679 Requested reset confirm",
            "!level reset server Requested reset confirm",
            "!level correct 123456789012345679 1500 Correction for lost XP",
            "!level rate 15 60",
        ]
        for (const content of commands) { yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); yield* p.replies.next(); yield* bot.idle() }
        const calls = remote.calls.filter(c => c.method === "manage").map(c => c.input as C.LevelingManageRequest)
        assert.equal(calls.length, 4)
        assert.deepEqual(calls[0]!.operation, { type: "reset-member", userId: "123456789012345679", confirm: "reset-member", reason: "Requested reset" })
        assert.deepEqual(calls[1]!.operation, { type: "reset-server", confirm: "reset-server", reason: "Requested reset" })
        assert.deepEqual(calls[2]!.operation, { type: "adjust", userId: "123456789012345679", xp: 1500, reason: "Correction for lost XP" })
        // The bot reads the current settings revision itself.
        assert.deepEqual(calls[3]!.operation, { type: "settings", expectedRevision: remote.settings.revision, patch: { xpPerMessage: 15, cooldownSeconds: 60 } })
        assert.equal(new Set(calls.map(c => c.messageId)).size, 4)
        assert(calls.every(c => c.createdAt > 0 && c.actor.isOwner))
        assert.equal(bot.failures().length, 0)
    })))
})

test("mapping commands bind the current mapping revision and fresh safe-role authority", async () => {
    const f = createFixtures(), remote = levelsBoundary({ manage: () => Effect.succeed({ duplicate: true }) })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { leveling: remote.store })), p = nativeRoles(bot)
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!level map 1 <@&${p.role.id}>` })); yield* p.send.next(); yield* bot.idle()
        const calls = remote.calls.filter(c => c.method === "manage").map(c => c.input as C.LevelingManageRequest)
        assert.equal(calls.length, 1)
        const operation = calls[0]!.operation
        assert.equal(operation.type, "mappings")
        if (operation.type === "mappings") {
            assert.equal(operation.expectedMappingRevision, 1)
            assert.deepEqual(operation.mappings, [{ level: 1, roleId: p.role.id }])
            assert(operation.roles.some(r => r.roleId === p.role.id && r.actorCanManage && r.botCanManage))
        }
        assert.equal(p.add.requests().length, 0)
    })))
})

test("reserved malformed leveling commands do not fall through and HTTP 409 gives actionable recovery", async () => {
    const f = createFixtures(), remote = levelsBoundary({ manage: () => Effect.fail(new LevelingStoreError({ operation: "manage", status: 409 })) })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { leveling: remote.store })), p = platform(bot)
        yield* bot.ready()
        for (const content of ['!level rate "broken', "!rank 0", "!leaderboard garbage", "!level module on"]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); yield* p.replies.next(); yield* bot.idle()
        }
        const replies = p.replies.requests().map(r => (r.body as { content: string }).content)
        assert.equal(replies[0], "A double quote was opened but never closed. Use !level help for examples"); assert.match(replies[1]!, /!rank/); assert.match(replies[2]!, /!leaderboard/)
        assert.match(replies[3]!, /Repeat the command/)
        assert.equal(remote.calls.filter(c => c.method === "manage").length, 1)
        assert.equal(bot.failures().length, 0)
    })))
})
