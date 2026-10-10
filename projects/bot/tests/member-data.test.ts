import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { parseMemberDataCommand } from "../src/member-data-command.ts"
import type { MemberDataStore } from "../src/member-data-store.ts"

const token = Redacted.make("synthetic-neonflux-test-token")

test("!mydata parses listing, export, delete with a confirmation step and help", () => {
    assert.deepEqual(parseMemberDataCommand("!mydata"), { type: "list" })
    assert.deepEqual(parseMemberDataCommand("!mydata help"), { type: "help" })
    assert.deepEqual(parseMemberDataCommand("!mydata export"), { type: "export" })
    assert.deepEqual(parseMemberDataCommand("!mydata export 123456789012345678"), { type: "export", serverId: "123456789012345678" })
    assert.deepEqual(parseMemberDataCommand("!mydata delete 123456789012345678"), { type: "delete", serverId: "123456789012345678", confirm: false })
    assert.deepEqual(parseMemberDataCommand("!MYDATA DELETE 123456789012345678 CONFIRM"), { type: "delete", serverId: "123456789012345678", confirm: true })
    for (const content of ["!mydata delete", "!mydata delete server", "!mydata delete 123456789012345678 now", "!mydata export x", "!mydata wipe", "!mydata list extra words here"]) {
        assert.ok("error" in parseMemberDataCommand(content), content)
    }
})

function memberDataStore(servers: (cursor: C.MemberDataServerCursor | null) => C.MemberDataServerPage = () => ({ serverIds: ["10"], cursor: null })) {
    const calls: Array<{ operation: string, input: Record<string, unknown> }> = []
    let remaining = 150
    const store: MemberDataStore = {
        list: input => Effect.sync(() => {
            calls.push({ operation: "list", input })
            return { complete: true, servers: [{ serverId: "10", features: [{ feature: "Leveling XP", count: 1, kept: null }, { feature: "Moderation cases", count: 2, kept: "Moderation cases protect the server" }] }] }
        }),
        servers: input => Effect.sync(() => { calls.push({ operation: "servers", input }); return servers(input.cursor) }),
        export: input => Effect.sync((): C.MemberDataExportPage => {
            calls.push({ operation: "export", input })
            return input.cursor ? { records: [{ feature: "Leveling XP", data: { xp: 400 } }], cursor: null } : { records: [{ feature: "AFK status", data: { reason: "Away" } }], cursor: { table: 3, after: 1 } }
        }),
        delete: input => Effect.sync((): C.MemberDataDeletePage => {
            calls.push({ operation: "delete", input })
            const count = Math.min(100, remaining)
            remaining -= count
            return { deleted: [{ feature: "Leveling message receipts", count }], kept: [{ feature: "Moderation cases", count: 2, reason: "Moderation cases protect the server" }],
                cursor: remaining ? { table: 3, after: 2 } : null }
        }),
    }
    return { store, calls }
}

test("!mydata in a private conversation lists, exports and deletes only after confirmation, and group conversations get nothing", async () => {
    const { store, calls } = memberDataStore()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: "10" }, { memberData: store }))
        yield* bot.ready()
        const dmId = bot.fixtures.nextId(), groupId = bot.fixtures.nextId()
        bot.rest.respond(`GET /channels/${dmId}`, { body: { id: dmId, type: 1, recipients: [bot.fixtures.user()], last_message_id: null } })
        bot.rest.respond(`GET /channels/${groupId}`, { body: { id: groupId, type: 3, owner_id: bot.fixtures.ids.user, recipients: [bot.fixtures.user(), bot.fixtures.user({ id: bot.fixtures.nextId() })], last_message_id: null } })
        const sent = bot.rest.respond("POST /channels/:id/messages", request => ({ body: bot.fixtures.message({ channel_id: request.path.split("/")[2]! }) }))
        const say = (channelId: string, content: string) => Effect.gen(function* () {
            const message = { ...bot.fixtures.message({ content, channel_id: channelId }) }
            delete message.guild_id
            yield* bot.emit("MESSAGE_CREATE", message)
            yield* bot.idle()
            return sent.requests().at(-1)
        })
        const text = (request: { body: unknown } | undefined) => (request?.body as { content: string }).content

        yield* say(groupId, "!mydata")
        assert.equal(calls.length, 0)
        assert.equal(sent.requests().length, 0)

        const list = text(yield* say(dmId, "!mydata"))
        assert.match(list, /Server 10\n- Leveling XP: 1\n- Moderation cases: 2, kept: Moderation cases protect the server/)
        assert.deepEqual(calls.at(-1), { operation: "list", input: { userId: bot.fixtures.ids.user } })

        const exported = yield* say(dmId, "!mydata export")
        assert.deepEqual(exported!.files.map(file => [file.filename, file.contentType]), [["neonflux-my-data.json", "application/json"]])
        assert.ok(exported!.files[0]!.size > 0)
        assert.deepEqual(calls.filter(call => call.operation === "export").map(call => call.input.cursor), [null, { table: 3, after: 1 }])

        const preview = text(yield* say(dmId, "!mydata delete 10"))
        assert.match(preview, /removes:\n- Leveling XP\nIt keeps:\n- Moderation cases: Moderation cases protect the server/)
        assert.match(preview, /!mydata delete 10 confirm/)
        assert.equal(calls.filter(call => call.operation === "delete").length, 0)

        const done = text(yield* say(dmId, "!mydata delete 10 confirm"))
        assert.deepEqual(calls.filter(call => call.operation === "delete").map(call => [call.input.serverId, call.input.cursor, call.input.userName]),
            [["10", null, bot.fixtures.user().username], ["10", { table: 3, after: 2 }, bot.fixtures.user().username]])
        assert.match(done, /Deleted in server 10:\n- Leveling message receipts: 150\nKept:\n- Moderation cases: 4\. Moderation cases protect the server/)
        assert.equal(bot.failures().length, 0)
    })))
})

/** Sends !mydata export in the member's private conversation and answers the bot's reply text */
const exportInPrivate = (store: MemberDataStore) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const bot = yield* createTestBot(createBotOptions({ token, serverId: "10" }, { memberData: store }))
    yield* bot.ready()
    const dmId = bot.fixtures.nextId()
    bot.rest.respond(`GET /channels/${dmId}`, { body: { id: dmId, type: 1, recipients: [bot.fixtures.user()], last_message_id: null } })
    const sent = bot.rest.respond("POST /channels/:id/messages", request => ({ body: bot.fixtures.message({ channel_id: request.path.split("/")[2]! }) }))
    const message = { ...bot.fixtures.message({ content: "!mydata export", channel_id: dmId }) }
    delete message.guild_id
    yield* bot.emit("MESSAGE_CREATE", message)
    yield* bot.idle()
    return (sent.requests().at(-1)!.body as { content: string }).content
})))

test("!mydata export searches every table for servers in bounded calls and says when that search stopped short", async () => {
    // The listing missed server 11, which only the second search call reaches
    const paged = memberDataStore(cursor => cursor ? { serverIds: ["11", "10"], cursor: null } : { serverIds: ["10"], cursor: { table: 0, after: "10" } })
    assert.equal(await exportInPrivate(paged.store), "Your NeonFlux data. It holds what NeonFlux stores under your user ID in each server")
    assert.deepEqual(paged.calls.filter(call => call.operation === "servers").map(call => call.input.cursor), [null, { table: 0, after: "10" }])
    assert.deepEqual(paged.calls.filter(call => call.operation === "export").map(call => call.input.serverId), ["10", "10", "11", "11"])
    // A search that has not finished after 20 calls exports what it found and says servers may be missing
    const endless = memberDataStore(() => ({ serverIds: ["10"], cursor: { table: 1, after: "10" } }))
    assert.equal(await exportInPrivate(endless.store),
        "The search for servers that hold your data stopped after 20 rounds, so servers it did not reach are missing. Export such a server with !mydata export <server ID>")
    assert.equal(endless.calls.filter(call => call.operation === "servers").length, 20)
})
