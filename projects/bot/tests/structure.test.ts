import assert from "node:assert/strict"
import test from "node:test"
import type { StructureApply, StructureChannel, StructureChannelType, StructureWork } from "@neonflux/contracts/structure"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { processStructurePass } from "../src/structure.ts"
import { createStructureStore } from "../src/structure-store.ts"
import { fakeClient, type BackendCall } from "./backend-fake.ts"
import { platform, token } from "./moderation-fixture.ts"

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
// Chat holds lounge and the help forum, Info holds rules and a staff channel the manager cannot view, and welcome sits at the top level.
// The manager may view every other channel and manage all but welcome, and NeonFlux may not manage lounge
function server(bot: Bot) {
    const f = bot.fixtures, p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.ManageChannels | Permissions.ManageGuild,
        botPermissions: Permissions.ViewChannel | Permissions.ManageChannels | Permissions.ReadMessageHistory | Permissions.ManageThreads })
    const ids = { chat: f.nextId(), lounge: f.nextId(), help: f.nextId(), info: f.nextId(), rules: f.nextId(), staff: f.nextId(), welcome: f.nextId() }
    const deny = (id: string, bits: bigint) => ({ id, type: 0, allow: "0", deny: bits.toString() })
    let channels: unknown[] = [
        f.channel({ id: ids.info, type: 4, name: "Info", position: 1 }), f.channel({ id: ids.rules, name: "rules", position: 0, parent_id: ids.info }),
        f.channel({ id: ids.staff, name: "staff", position: 1, parent_id: ids.info, permission_overwrites: [deny(p.actorRole.id, Permissions.ViewChannel)] }),
        f.channel({ id: ids.chat, type: 4, name: "Chat", position: 0 }), f.channel({ id: ids.lounge, type: 2, name: "lounge", position: 0, parent_id: ids.chat, permission_overwrites: [deny(p.botRole.id, Permissions.ManageChannels)] }),
        f.forumChannel({ id: ids.help, name: "help", position: 1, parent_id: ids.chat }),
        f.channel({ id: ids.welcome, name: "welcome", position: 2, permission_overwrites: [deny(p.actorRole.id, Permissions.ManageChannels)] }),
    ]
    const list = bot.rest.respond(`GET /guilds/${f.ids.guild}/channels`, () => ({ body: channels }))
    const threads = { open: f.thread({ name: "plans", parent_id: ids.rules }), secret: f.thread({ type: 12, name: "secret", parent_id: ids.rules }), hidden: f.thread({ name: "pay", parent_id: ids.staff }) }
    bot.rest.respond(`GET /guilds/${f.ids.guild}/threads/active`, { body: { threads: Object.values(threads), members: [] } })
    return { f, p, ids, threads, list, setChannels: (next: unknown[]) => { channels = next } }
}
function backend(serverId: string, answers: Partial<Record<string, (call: BackendCall) => unknown>>) {
    const calls: BackendCall[] = []
    const store = createStructureStore({ url: "https://synthetic.invalid", secret: Redacted.make("synthetic-structure-secret"), serverId, client: fakeClient(call => {
        calls.push(call)
        const answer = answers[call.path]
        assert(answer, `unexpected ${call.path}`)
        return answer(call)
    }) })
    return { store, calls, bodies: (path: string) => calls.filter(call => call.path === path).map(call => call.body) }
}
const job = (userId: string, work: StructureWork) => ({ jobs: [{ userId, requestedAt: 5, work }] })

test("A read lists what the manager can see in sibling order, with active threads and private threads only for those who manage threads", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: Redacted.value(token) }), { f, ids, threads } = server(bot)
        const b = backend(f.ids.guild, { "/structure/ready": () => job(f.ids.user, { type: "read" }), "/structure/answer": () => ({ recorded: true }) })
        yield* bot.ready()
        yield* processStructurePass(b.store, f.ids.guild, bot.client)
        const channel = (id: string, type: StructureChannelType, name: string, parentId: string | null, manage = true) => ({ id, type, name, parentId, manage })
        assert.deepEqual(b.bodies("/structure/answer"), [{ serverId: f.ids.guild, originServerId: f.ids.guild, userId: f.ids.user, requestedAt: 5, work: "read", read: {
            channels: [channel(ids.chat, "category", "Chat", null), channel(ids.lounge, "voice", "lounge", ids.chat), channel(ids.help, "forum", "help", ids.chat),
                channel(ids.info, "category", "Info", null), channel(ids.rules, "text", "rules", ids.info), channel(ids.welcome, "text", "welcome", null, false)],
            threads: [{ id: threads.open.id, parentId: ids.rules, name: "plans", private: false, archived: false }], threadsTruncated: false } }])
        assert.equal(bot.failures().length, 0)
    })))
})

test("A claimed save renames, then moves in one reorder with the bot's token, and a channel NeonFlux cannot manage names the fix", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: Redacted.value(token) }), { f, ids } = server(bot)
        const apply: StructureApply[] = [{ itemNo: 1, type: "rename", channelId: ids.rules, name: "read-me" }, { itemNo: 2, type: "move", channelId: ids.help, parentId: ids.info, precedingSiblingId: ids.rules },
            { itemNo: 3, type: "move", channelId: ids.lounge, parentId: null, precedingSiblingId: null }]
        const b = backend(f.ids.guild, { "/structure/ready": () => job(f.ids.user, { type: "save" }), "/structure/claim": () => ({ claimed: true, applyUntil: Date.now() + 60000, apply }),
            "/structure/record": () => ({ recorded: true }) })
        const rename = bot.rest.respond(`PATCH /channels/${ids.rules}`, request => ({ body: f.channel({ id: ids.rules, name: (request.body as { name: string }).name, parent_id: ids.info }) }))
        const reorder = bot.rest.respond(`PATCH /guilds/${f.ids.guild}/channels`, { status: 204 })
        yield* bot.ready()
        yield* processStructurePass(b.store, f.ids.guild, bot.client)
        // The claim carries the fresh read the backend merges with, without threads
        const [claim] = b.bodies("/structure/claim") as Array<{ originServerId: string, current: StructureChannel[] }>
        assert.equal(claim!.originServerId, f.ids.guild)
        assert.deepEqual(claim!.current.map(row => [row.name, row.manage]), [["Chat", true], ["lounge", true], ["help", true], ["Info", true], ["rules", true], ["welcome", false]])
        assert.deepEqual(rename.requests().map(request => request.body), [{ name: "read-me" }])
        assert.deepEqual(reorder.requests().map(request => request.body), [[{ id: ids.help, parent_id: ids.info, preceding_sibling_id: ids.rules }]])
        assert.deepEqual(b.bodies("/structure/record"), [{ serverId: f.ids.guild, userId: f.ids.user, requestedAt: 5, results: [{ itemNo: 1, outcome: "applied" },
            { itemNo: 3, outcome: "failed", reason: `Grant Manage Channels to the NeonFlux role and allow it in <#${ids.lounge}>` }, { itemNo: 2, outcome: "applied" }] }])
        assert.equal(bot.failures().length, 0)
    })))
})

test("A save the bot could not claim writes nothing, and a save whose read fails reports it without a claim", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: Redacted.value(token) }), { f, p, ids } = server(bot)
        const b = backend(f.ids.guild, { "/structure/ready": () => job(f.ids.user, { type: "save" }), "/structure/claim": () => ({ claimed: false, applyUntil: 0, apply: [] }),
            "/structure/answer": () => ({ recorded: true }) })
        const rename = bot.rest.respond(`PATCH /channels/${ids.rules}`, { body: f.channel({ id: ids.rules }) })
        yield* bot.ready()
        yield* processStructurePass(b.store, f.ids.guild, bot.client)
        assert.deepEqual([b.bodies("/structure/claim").length, b.bodies("/structure/record").length, rename.requests().length], [1, 0, 0])
        // A manager who left the server cannot be read, so nothing is claimed
        p.actor.remove()
        bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { status: 404, body: { code: "UNKNOWN_MEMBER", message: "Synthetic absent" } })
        yield* processStructurePass(b.store, f.ids.guild, bot.client)
        assert.equal(b.bodies("/structure/claim").length, 1)
        assert.deepEqual(b.bodies("/structure/answer"), [{ serverId: f.ids.guild, userId: f.ids.user, requestedAt: 5, work: "save", failure: "access" }])
    })))
})

test("A rename Fluxer does not confirm is uncertain, and after a refused reorder each move is reported by where the channel is", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: Redacted.value(token) }), { f, ids, setChannels } = server(bot)
        const apply: StructureApply[] = [{ itemNo: 1, type: "rename", channelId: ids.rules, name: "read-me" }, { itemNo: 2, type: "move", channelId: ids.welcome, parentId: null, precedingSiblingId: null },
            { itemNo: 3, type: "move", channelId: ids.help, parentId: ids.info, precedingSiblingId: ids.rules }]
        const b = backend(f.ids.guild, { "/structure/ready": () => job(f.ids.user, { type: "save" }), "/structure/claim": () => ({ claimed: true, applyUntil: Date.now() + 60000, apply }),
            "/structure/record": () => ({ recorded: true }) })
        // The rename answer is unusable, so Fluxer may have applied it
        bot.rest.respond(`PATCH /channels/${ids.rules}`, { body: { unusable: true } })
        // Fluxer moved welcome first and then refused the second move
        bot.rest.respond(`PATCH /guilds/${f.ids.guild}/channels`, () => {
            setChannels([f.channel({ id: ids.welcome, name: "welcome", position: 0 }), f.channel({ id: ids.chat, type: 4, name: "Chat", position: 1 }),
                f.forumChannel({ id: ids.help, name: "help", position: 0, parent_id: ids.chat }), f.channel({ id: ids.info, type: 4, name: "Info", position: 2 }),
                f.channel({ id: ids.rules, name: "rules", position: 0, parent_id: ids.info })])
            return { status: 403, body: { code: "MISSING_PERMISSIONS", message: "Synthetic refusal" } }
        })
        yield* bot.ready()
        yield* processStructurePass(b.store, f.ids.guild, bot.client)
        const [record] = b.bodies("/structure/record") as Array<{ results: Array<{ itemNo: number, outcome: string, reason?: string }> }>
        assert.deepEqual(record!.results.map(result => [result.itemNo, result.outcome]), [[1, "uncertain"], [2, "applied"], [3, "failed"]])
        assert.equal(record!.results[0]!.reason, "Fluxer did not confirm this change. Check the server before saving it again")
        assert.match(record!.results[2]!.reason!, /^(Grant Manage Channels to the NeonFlux role|Fluxer refused the move)/)
    })))
})

test("The first channel change after a read tells the backend once, and the next read arms it again", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const f = createFixtures()
        const b = backend(f.ids.guild, { "/structure/answer": () => ({ recorded: true }), "/structure/changed": () => ({ marked: 1 }) })
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { structure: b.store }))
        platform(bot)
        yield* bot.ready()
        const read = { channels: [], threads: [], threadsTruncated: false }, waiting = { userId: f.ids.user, requestedAt: 5, work: { type: "read" as const } }
        // Without a read, channel events cost no backend request
        yield* bot.emit("CHANNEL_UPDATE", f.channel({ topic: "Changed" })).pipe(Effect.andThen(bot.idle()))
        assert.equal(b.bodies("/structure/changed").length, 0)
        yield* b.store.answer(f.ids.guild, waiting, { read })
        yield* bot.emit("CHANNEL_UPDATE", f.channel({ topic: "Changed again" })).pipe(Effect.andThen(bot.idle()))
        yield* bot.emit("CHANNEL_CREATE", f.channel({ id: f.nextId(), name: "new" })).pipe(Effect.andThen(bot.idle()))
        assert.deepEqual(b.bodies("/structure/changed"), [{ serverId: f.ids.guild }])
        yield* b.store.answer(f.ids.guild, waiting, { read })
        yield* bot.emit("CHANNEL_DELETE", f.channel()).pipe(Effect.andThen(bot.idle()))
        assert.equal(b.bodies("/structure/changed").length, 2)
        assert.equal(bot.failures().length, 0)
    })))
})
