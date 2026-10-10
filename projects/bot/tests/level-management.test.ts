import assert from "node:assert/strict"
import test from "node:test"
import type { LevelingAudit, LevelingManageRequest, LevelingQueryRequest, LevelingSettings } from "@neonflux/contracts/leveling"
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
            const input = read.input as LevelingQueryRequest
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
        const confirm = (preview.body as { content: string }).content.split("\nConfirm: `")[1]!.slice(0, -1)
        assert.equal(confirm, `!level reset member 123456789012345679 Member's \\"request\\" don't confirm`)
        assert.equal(remote.calls.some(c => c.method === "manage"), false)
        // The printed command confirms the same scope and reason
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: confirm })); yield* p.replies.next(); yield* bot.idle()
        assert.deepEqual((remote.calls.find(c => c.method === "manage")!.input as LevelingManageRequest).operation,
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
            // A text reply as its content, and a card as its title, description and fields
            const body = sent.body as { content?: string, embeds?: { title: string, description?: string, fields?: { name: string, value: string }[] }[] }
            return body.content ?? JSON.stringify(body.embeds![0])
        })
        yield* bot.ready()
        assert.deepEqual(JSON.parse(yield* say("!leaderboard")), ({ color: 0x5560e6, title: "Message XP leaderboard", description: `<@${f.ids.user}>: Level 4, 2,000 XP`, fields: [{ name: "Next", value: "`!leaderboard next`" }] }))
        assert.doesNotMatch(yield* say("!leaderboard next"), /Next/)
        assert.equal(yield* say("!leaderboard next"), "There is no next page to show. Send !leaderboard to start the list again")
        const operations = (type: string) => remote.calls.filter(c => c.method === "query").map(c => (c.input as LevelingQueryRequest).operation).filter(op => op.type === type)
        assert.deepEqual(operations("leaderboard"), [{ type: "leaderboard" }, { type: "leaderboard", cursor }])
        // A server reset refuses the remembered position, which is then forgotten
        yield* say("!leaderboard"); reset = true
        assert.match(yield* say("!leaderboard next"), /Leveling changed while this command ran/)
        assert.equal(yield* say("!leaderboard next"), "There is no next page to show. Send !leaderboard to start the list again")
        assert.deepEqual(JSON.parse(yield* say("!level audit")), ({ color: 0x5560e6, title: "XP changes by staff", description: "No XP changes by staff yet", fields: [{ name: "Next", value: "`!level audit next`" }] }))
        assert.doesNotMatch(yield* say("!level audit next"), /Next/)
        assert.equal(yield* say("!level audit next"), "There is no next page to show. Send !level audit to start the list again")
        assert.deepEqual(operations("audits"), [{ type: "audits" }, { type: "audits", beforeAuditNo: 7 }])
        assert.equal(bot.failures().length, 0)
    })))
})

type Body = { content?: string, embeds?: { title: string, description?: string, fields?: { name: string, value: string }[], footer?: { text: string } }[] }

test("an audit page shows each reason clipped to one short line", async () => {
    const f = createFixtures(), reason = `Requested by the member\n${"x".repeat(300)}`
    const audits = Array.from({ length: 10 }, (_, i): LevelingAudit => ({ auditNo: 10 - i, actorId: f.ids.user, userId: "123456789012345679", beforeXp: 0, afterXp: 100, reason, createdAt: 1700000000000, type: "adjust", scoreEpoch: 1 }))
    const remote = levelsBoundary({ query: () => Effect.succeed({ type: "audits", audits }) })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { leveling: remote.store })), p = platform(bot)
        const say = (content: string) => Effect.gen(function* () {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); const sent = yield* p.replies.next(); yield* bot.idle()
            return sent.body as Body
        })
        yield* bot.ready()
        const page = (yield* say("!level audit")).embeds![0]!, lines = page.description!.split("\n")
        assert.equal(lines.length, 10)
        for (const line of lines) {
            const clipped = line.split(". Reason: ")[1]!
            assert(clipped.length <= 80); assert(clipped.startsWith("Requested by the member xxx")); assert(clipped.endsWith("…"))
        }
        assert.equal(page.fields, undefined)
        assert.equal(bot.failures().length, 0)
    })))
})

test("the config shows counts and one hint, and each list pages at ten with next", async () => {
    const f = createFixtures(), remote = levelsBoundary()
    const ids = (from: bigint, count: number) => Array.from({ length: count }, (_, i) => String(from + BigInt(i)))
    const channels = ids(200000000000000000n, 50), roles = ids(300000000000000000n, 50), rewards = ids(400000000000000000n, 20)
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { leveling: remote.store })), p = platform(bot)
        const say = (content: string) => Effect.gen(function* () {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); const sent = yield* p.replies.next(); yield* bot.idle()
            return sent.body as Body
        })
        yield* bot.ready()
        // Nothing to list, so no hint
        assert.deepEqual((yield* say("!level config")).embeds, [{ color: 0x5560e6, title: "Leveling", fields: [{ name: "Status", value: "Off" }, { name: "Rate", value: "15 XP at most every 1 minute" },
            { name: "Excluded channels", value: "None" }, { name: "Excluded roles", value: "None" }, { name: "Role rewards", value: "None" }] }])
        // The largest config still shows five counts and one hint
        Object.assign(remote.settings, { enabled: true, excludedChannelIds: channels, excludedRoleIds: roles, mappings: rewards.map((roleId, i) => ({ level: i + 1, roleId })) })
        assert.deepEqual((yield* say("!level config")).embeds, [{ color: 0x5560e6, title: "Leveling", description: "Send `!level config channels`, `roles` or `rewards` to see one list",
            fields: [{ name: "Status", value: "On" }, { name: "Rate", value: "15 XP at most every 1 minute" }, { name: "Excluded channels", value: "50 of 50" }, { name: "Excluded roles", value: "50 of 50" }, { name: "Role rewards", value: "20 of 20" }] }])
        for (let page = 0; page < 5; page++) {
            const shown = (yield* say(`!level config channels${page ? " next" : ""}`)).embeds![0]!
            assert.equal(shown.title, "Excluded channels")
            assert.equal(shown.description, channels.slice(page * 10, page * 10 + 10).map(id => `<#${id}>`).join("\n"))
            assert.deepEqual(shown.fields, page < 4 ? [{ name: "Next", value: "`!level config channels next`" }] : undefined)
        }
        assert.equal((yield* say("!level config channels next")).content, "There is no next page to show. Send !level config channels to start the list again")
        assert.equal((yield* say("!level config roles next")).content, "There is no next page to show. Send !level config roles to start the list again")
        const reward = (yield* say("!level config rewards")).embeds![0]!
        assert.deepEqual(reward, { color: 0x5560e6, title: "Role rewards", description: rewards.slice(0, 10).map((id, i) => `Level ${i + 1}: <@&${id}>`).join("\n"),
            fields: [{ name: "Next", value: "`!level config rewards next`" }], footer: { text: "Members keep every reward up to their level" } })
        // A list that shrank since the last page shows its last page
        Object.assign(remote.settings, { excludedRoleIds: [], mappings: rewards.slice(0, 3).map((roleId, i) => ({ level: i + 1, roleId })) })
        assert.equal((yield* say("!level config rewards next")).embeds![0]!.description, rewards.slice(0, 3).map((id, i) => `Level ${i + 1}: <@&${id}>`).join("\n"))
        assert.deepEqual((yield* say("!level config roles")).embeds, [{ color: 0x5560e6, title: "Excluded roles", description: "Leveling counts members with any role" }])
        assert(remote.calls.every(c => c.method === "query" && (c.input as LevelingQueryRequest).operation.type === "settings"))
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
        const calls = remote.calls.filter(c => c.method === "manage").map(c => c.input as LevelingManageRequest)
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

test("a settings change answers with one line that names the setting and its new value", async () => {
    const f = createFixtures()
    let settings: LevelingSettings | undefined
    const remote = levelsBoundary({ manage: input => Effect.sync(() => {
        if (input.operation.type === "settings") Object.assign(settings!, input.operation.patch)
        return { duplicate: false as const, type: "settings" as const, settings: structuredClone(settings!) }
    }) })
    settings = remote.settings
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { leveling: remote.store })), p = platform(bot)
        yield* bot.ready()
        const many = Array.from({ length: 50 }, (_, index) => String(123456789012345000n + BigInt(index))).join(" ")
        for (const content of ["!level module on", "!level rate 20 120", `!level exclude channels <#${f.ids.channel}>`, "!level exclude roles none", `!level exclude roles ${many}`]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); yield* p.replies.next(); yield* bot.idle()
        }
        assert.deepEqual(p.replies.requests().map(r => (r.body as { content: string }).content), ["Leveling is on", "Members now earn 20 XP at most every 2 minutes",
            `Leveling now skips messages in <#${f.ids.channel}>`, "Leveling now counts members with any role", "Leveling now skips members with 50 roles"])
        assert.equal(bot.failures().length, 0)
    })))
})

test("mapping commands bind the current mapping revision and fresh safe-role authority", async () => {
    const f = createFixtures(), remote = levelsBoundary({ manage: () => Effect.succeed({ duplicate: true }) })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { leveling: remote.store })), p = nativeRoles(bot)
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!level map 1 <@&${p.role.id}>` })); yield* p.send.next(); yield* bot.idle()
        const calls = remote.calls.filter(c => c.method === "manage").map(c => c.input as LevelingManageRequest)
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
        assert.match(replies[3]!, /Send the command again/)
        assert.equal(remote.calls.filter(c => c.method === "manage").length, 1)
        assert.equal(bot.failures().length, 0)
    })))
})
