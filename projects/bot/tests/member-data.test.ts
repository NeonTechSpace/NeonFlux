import assert from "node:assert/strict"
import test from "node:test"
import type {
    MemberDataDeletePage,
    MemberDataExportPage,
    MemberDataServerCursor,
    MemberDataServerPage,
} from "@neonflux/contracts/member-data"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { parseMemberDataCommand } from "../src/member-data-command.ts"
import type { MemberDataStore } from "../src/member-data-store.ts"
import { levelingForgets } from "../src/leveling.ts"

const token = Redacted.make("synthetic-neonflux-test-token")

test("!mydata parses listing with next, one server and delete by list number or server ID, export and help", () => {
    assert.deepEqual(parseMemberDataCommand("!mydata"), { type: "list" })
    assert.deepEqual(parseMemberDataCommand("!mydata next"), { type: "list", next: true })
    assert.deepEqual(parseMemberDataCommand("!mydata 2"), { type: "show", number: 2 })
    assert.deepEqual(parseMemberDataCommand("!mydata help"), { type: "help" })
    assert.deepEqual(parseMemberDataCommand("!mydata export"), { type: "export" })
    assert.deepEqual(parseMemberDataCommand("!mydata export 123456789012345678"), {
        type: "export",
        serverId: "123456789012345678",
    })
    assert.deepEqual(parseMemberDataCommand("!mydata delete 1"), { type: "delete", number: 1, confirm: false })
    assert.deepEqual(parseMemberDataCommand("!MYDATA DELETE 1 CONFIRM"), { type: "delete", number: 1, confirm: true })
    // A server the list did not reach is named by its ID
    assert.deepEqual(parseMemberDataCommand("!mydata 123456789012345678"), {
        type: "show",
        serverId: "123456789012345678",
    })
    assert.deepEqual(parseMemberDataCommand("!mydata delete 123456789012345678 confirm"), {
        type: "delete",
        serverId: "123456789012345678",
        confirm: true,
    })
    for (const content of [
        "!mydata delete",
        "!mydata delete server",
        "!mydata delete 0",
        "!mydata delete 1 now",
        "!mydata 1 2",
        "!mydata export x",
        "!mydata wipe",
        "!mydata list extra words here",
    ]) {
        assert.ok("error" in parseMemberDataCommand(content), content)
    }
})

function memberDataStore(
    servers: (cursor: MemberDataServerCursor | null) => MemberDataServerPage = () => ({
        serverIds: ["10"],
        cursor: null,
    }),
    listed = ["10"],
    complete = true,
) {
    const calls: Array<{ operation: string; input: Record<string, unknown> }> = []
    let remaining = 150
    const store: MemberDataStore = {
        list: (input) =>
            Effect.sync(() => {
                calls.push({ operation: "list", input })
                return {
                    complete,
                    servers: listed
                        .filter((serverId) => input.serverId === undefined || serverId === input.serverId)
                        .map((serverId) => ({
                            serverId,
                            features: [
                                { feature: "Leveling XP", count: 1, kept: null },
                                { feature: "Moderation cases", count: 2, kept: "Moderation cases protect the server" },
                            ],
                        })),
                }
            }),
        servers: (input) =>
            Effect.sync(() => {
                calls.push({ operation: "servers", input })
                return servers(input.cursor)
            }),
        export: (input) =>
            Effect.sync((): MemberDataExportPage => {
                calls.push({ operation: "export", input })
                return input.cursor
                    ? { records: [{ feature: "Leveling XP", data: { xp: 400 } }], cursor: null }
                    : { records: [{ feature: "AFK status", data: { reason: "Away" } }], cursor: { table: 3, after: 1 } }
            }),
        delete: (input) =>
            Effect.sync((): MemberDataDeletePage => {
                calls.push({ operation: "delete", input })
                const count = Math.min(100, remaining)
                remaining -= count
                return {
                    deleted: [{ feature: "Leveling message receipts", count }],
                    kept: [{ feature: "Moderation cases", count: 2, reason: "Moderation cases protect the server" }],
                    cursor: remaining ? { table: 3, after: 2 } : null,
                }
            }),
    }
    return { store, calls }
}

test("!mydata in a private conversation lists, exports and deletes only after confirmation, and group conversations get nothing", async () => {
    const { store, calls } = memberDataStore()
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: "10" }, { memberData: store }))
                yield* bot.ready()
                const dmId = bot.fixtures.nextId(),
                    groupId = bot.fixtures.nextId()
                bot.rest.respond(`GET /channels/${dmId}`, {
                    body: { id: dmId, type: 1, recipients: [bot.fixtures.user()], last_message_id: null },
                })
                bot.rest.respond(`GET /channels/${groupId}`, {
                    body: {
                        id: groupId,
                        type: 3,
                        owner_id: bot.fixtures.ids.user,
                        recipients: [bot.fixtures.user(), bot.fixtures.user({ id: bot.fixtures.nextId() })],
                        last_message_id: null,
                    },
                })
                const sent = bot.rest.respond("POST /channels/:id/messages", (request) => ({
                    body: bot.fixtures.message({ channel_id: request.path.split("/")[2]! }),
                }))
                const say = (channelId: string, content: string) =>
                    Effect.gen(function* () {
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

                // A number means nothing before a list numbered the servers
                assert.equal(
                    text(yield* say(dmId, "!mydata 1")),
                    "Send !mydata first, then pick a server by its number",
                )
                type Embed = {
                    title: string
                    description: string
                    fields?: { name: string; value: string }[]
                    footer: { text: string }
                }
                const embed = (request: { body: unknown } | undefined) =>
                    (request!.body as { embeds: Embed[] }).embeds[0]!
                const list = embed(yield* say(dmId, "!mydata"))
                assert.deepEqual(
                    [list.title, list.description, list.fields],
                    [
                        "Your NeonFlux data",
                        "1. **Unknown server**: 3 records\n`!mydata <number>` shows one server and how to delete there. `!mydata export` sends a copy",
                        undefined,
                    ],
                )
                assert.match(list.footer.text, /^Security records/)
                assert.deepEqual(calls.at(-1), { operation: "list", input: { userId: bot.fixtures.ids.user } })
                const one = embed(yield* say(dmId, "!mydata 1"))
                assert.deepEqual(
                    [one.description, one.fields],
                    [
                        "**Unknown server**: 3 records\n`!mydata delete 1` shows what deleting removes, then asks you to confirm",
                        [
                            { name: "Deleting removes", value: "Leveling XP (1)" },
                            { name: "Kept", value: "Moderation cases (2): Moderation cases protect the server" },
                        ],
                    ],
                )
                assert.equal(
                    text(yield* say(dmId, "!mydata 2")),
                    "Your last list has no server 2. Send !mydata to see it again",
                )

                const exported = yield* say(dmId, "!mydata export")
                assert.deepEqual(
                    exported!.files.map((file) => [file.filename, file.contentType]),
                    [["neonflux-my-data.json", "application/json"]],
                )
                assert.ok(exported!.files[0]!.size > 0)
                assert.deepEqual(
                    calls.filter((call) => call.operation === "export").map((call) => call.input.cursor),
                    [null, { table: 3, after: 1 }],
                )

                // A confirmation needs the preview of that same server first, and a newer list asks for the preview again
                assert.equal(
                    text(yield* say(dmId, "!mydata delete 1 confirm")),
                    "Send `!mydata delete 1` first to see what it deletes",
                )
                const preview = text(yield* say(dmId, "!mydata delete 1"))
                assert.match(
                    preview,
                    /^Deleting your data in \*\*Unknown server\*\* removes:\n- Leveling XP\nIt keeps:\n- Moderation cases: Moderation cases protect the server/,
                )
                assert.match(preview, /\nConfirm: `!mydata delete 1 confirm`$/)
                yield* say(dmId, "!mydata")
                assert.equal(
                    text(yield* say(dmId, "!mydata delete 1 confirm")),
                    "Send `!mydata delete 1` first to see what it deletes",
                )
                assert.equal(calls.filter((call) => call.operation === "delete").length, 0)

                yield* say(dmId, "!mydata delete 1")
                const done = text(yield* say(dmId, "!mydata delete 1 confirm"))
                assert.deepEqual(
                    calls
                        .filter((call) => call.operation === "delete")
                        .map((call) => [call.input.serverId, call.input.cursor, call.input.userName]),
                    [
                        ["10", null, bot.fixtures.user().username],
                        ["10", { table: 3, after: 2 }, bot.fixtures.user().username],
                    ],
                )
                assert.match(
                    done,
                    /^Deleted in \*\*Unknown server\*\*:\n- Leveling message receipts: 150\nKept:\n- Moderation cases: 4\. Moderation cases protect the server/,
                )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("!mydata shows and deletes a server by its ID when no list reached it, counting only that server", async () => {
    const omitted = "123456789012345678"
    const { store, calls } = memberDataStore(undefined, ["10", omitted])
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: "10" }, { memberData: store }))
                yield* bot.ready()
                const dmId = bot.fixtures.nextId()
                bot.rest.respond(`GET /channels/${dmId}`, {
                    body: { id: dmId, type: 1, recipients: [bot.fixtures.user()], last_message_id: null },
                })
                const sent = bot.rest.respond("POST /channels/:id/messages", (request) => ({
                    body: bot.fixtures.message({ channel_id: request.path.split("/")[2]! }),
                }))
                const say = (content: string) =>
                    Effect.gen(function* () {
                        const message = { ...bot.fixtures.message({ content, channel_id: dmId }) }
                        delete message.guild_id
                        yield* bot.emit("MESSAGE_CREATE", message)
                        yield* bot.idle()
                        return sent.requests().at(-1)!.body as {
                            content?: string
                            embeds?: { description: string }[]
                        }
                    })
                const shown = (yield* say(`!mydata ${omitted}`)).embeds![0]!
                assert.match(
                    shown.description,
                    /^\*\*Unknown server\*\*: 3 records\n`!mydata delete 123456789012345678`/,
                )
                assert.deepEqual(calls.at(-1), {
                    operation: "list",
                    input: { userId: bot.fixtures.ids.user, serverId: omitted },
                })
                // Confirming needs the preview of that same server first
                assert.equal(
                    (yield* say(`!mydata delete ${omitted} confirm`)).content,
                    `Send \`!mydata delete ${omitted}\` first to see what it deletes`,
                )
                assert.match(
                    (yield* say(`!mydata delete ${omitted}`)).content!,
                    /Confirm: `!mydata delete 123456789012345678 confirm`$/,
                )
                // The server's XP wait for the member goes with their data
                const forgotten: string[] = []
                levelingForgets.set(omitted, (userId) => void forgotten.push(userId))
                yield* Effect.addFinalizer(() => Effect.sync(() => levelingForgets.delete(omitted)))
                assert.match((yield* say(`!mydata delete ${omitted} confirm`)).content!, /^Deleted in /)
                assert.deepEqual(forgotten, [bot.fixtures.ids.user])
                assert.deepEqual(
                    calls.filter((call) => call.operation === "delete").map((call) => call.input.serverId),
                    [omitted, omitted],
                )
                // A server the bot is in but the author has no data in stays unnamed
                const secret = "223456789012345678"
                yield* bot.emit(
                    "GUILD_CREATE",
                    bot.fixtures.guildCreate({ guild: { id: secret, name: "Secret" }, channels: [] }),
                )
                yield* bot.idle()
                for (const content of [`!mydata ${secret}`, `!mydata delete ${secret}`])
                    assert.equal(
                        (yield* say(content)).content,
                        "NeonFlux stores nothing about you in that server that it can list",
                    )
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("!mydata numbers servers ten to a page and next continues the numbering", async () => {
    const servers = Array.from({ length: 12 }, (_, i) => String(20 + i))
    const { store, calls } = memberDataStore(undefined, servers)
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: "10" }, { memberData: store }))
                yield* bot.ready()
                const dmId = bot.fixtures.nextId()
                bot.rest.respond(`GET /channels/${dmId}`, {
                    body: { id: dmId, type: 1, recipients: [bot.fixtures.user()], last_message_id: null },
                })
                const sent = bot.rest.respond("POST /channels/:id/messages", (request) => ({
                    body: bot.fixtures.message({ channel_id: request.path.split("/")[2]! }),
                }))
                const say = (content: string) =>
                    Effect.gen(function* () {
                        const message = { ...bot.fixtures.message({ content, channel_id: dmId }) }
                        delete message.guild_id
                        yield* bot.emit("MESSAGE_CREATE", message)
                        yield* bot.idle()
                        return sent.requests().at(-1)!.body as {
                            content?: string
                            embeds?: { description: string; fields?: { name: string; value: string }[] }[]
                        }
                    })
                const first = (yield* say("!mydata")).embeds![0]!
                assert.deepEqual(
                    first.description
                        .split("\n")
                        .filter((line) => /^\d+\. /.test(line))
                        .map((line) => line.split(".")[0]),
                    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
                )
                assert.deepEqual(first.fields, [{ name: "Next", value: "`!mydata next`" }])
                const second = (yield* say("!mydata next")).embeds![0]!
                assert.deepEqual(
                    second.description
                        .split("\n")
                        .filter((line) => /^\d+\. /.test(line))
                        .map((line) => line.split(".")[0]),
                    ["11", "12"],
                )
                assert.equal(
                    (yield* say("!mydata next")).content,
                    "There is no next page to show. Send !mydata to start the list again",
                )
                // Number 12 is the twelfth server of the list
                yield* say("!mydata delete 12")
                assert.match((yield* say("!mydata delete 12 confirm")).content!, /^Deleted in/)
                assert.equal(calls.find((call) => call.operation === "delete")!.input.serverId, "31")
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

test("!mydata marks every count of an incomplete list as a lower bound and says a server can be missing", async () => {
    const { store } = memberDataStore(undefined, ["20", "21"], false)
    await Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: "10" }, { memberData: store }))
                yield* bot.ready()
                const dmId = bot.fixtures.nextId()
                bot.rest.respond(`GET /channels/${dmId}`, {
                    body: { id: dmId, type: 1, recipients: [bot.fixtures.user()], last_message_id: null },
                })
                const sent = bot.rest.respond("POST /channels/:id/messages", (request) => ({
                    body: bot.fixtures.message({ channel_id: request.path.split("/")[2]! }),
                }))
                const message = { ...bot.fixtures.message({ content: "!mydata", channel_id: dmId }) }
                delete message.guild_id
                yield* bot.emit("MESSAGE_CREATE", message)
                yield* bot.idle()
                const card = (sent.requests().at(-1)!.body as { embeds: { description: string }[] }).embeds[0]!
                const lines = card.description.split("\n")
                assert.equal(lines.filter((line) => /: 3 or more records$/.test(line)).length, 2)
                assert.match(card.description, /Counts stop at 50 rows of a kind, so they can be low/)
                assert.equal(bot.failures().length, 0)
            }),
        ),
    )
})

/** Sends !mydata export in the member's private conversation and answers the bot's reply text */
const exportInPrivate = (store: MemberDataStore) =>
    Effect.runPromise(
        Effect.scoped(
            Effect.gen(function* () {
                const bot = yield* createTestBot(createBotOptions({ token, serverId: "10" }, { memberData: store }))
                yield* bot.ready()
                const dmId = bot.fixtures.nextId()
                bot.rest.respond(`GET /channels/${dmId}`, {
                    body: { id: dmId, type: 1, recipients: [bot.fixtures.user()], last_message_id: null },
                })
                const sent = bot.rest.respond("POST /channels/:id/messages", (request) => ({
                    body: bot.fixtures.message({ channel_id: request.path.split("/")[2]! }),
                }))
                const message = { ...bot.fixtures.message({ content: "!mydata export", channel_id: dmId }) }
                delete message.guild_id
                yield* bot.emit("MESSAGE_CREATE", message)
                yield* bot.idle()
                return (sent.requests().at(-1)!.body as { content: string }).content
            }),
        ),
    )

test("!mydata export searches every table for servers in bounded calls and says when that search stopped short", async () => {
    // The listing missed server 11, which only the second search call reaches
    const paged = memberDataStore((cursor) =>
        cursor ? { serverIds: ["11", "10"], cursor: null } : { serverIds: ["10"], cursor: { table: 0, after: "10" } },
    )
    assert.equal(
        await exportInPrivate(paged.store),
        "Your NeonFlux data. It holds what NeonFlux stores under your user ID in each server",
    )
    assert.deepEqual(
        paged.calls.filter((call) => call.operation === "servers").map((call) => call.input.cursor),
        [null, { table: 0, after: "10" }],
    )
    assert.deepEqual(
        paged.calls.filter((call) => call.operation === "export").map((call) => call.input.serverId),
        ["10", "10", "11", "11"],
    )
    // A search that has not finished after 20 calls exports what it found and says servers may be missing
    const endless = memberDataStore(() => ({ serverIds: ["10"], cursor: { table: 1, after: "10" } }))
    assert.equal(
        await exportInPrivate(endless.store),
        "The search for servers that hold your data stopped after 20 rounds, so servers it did not reach are missing. Export such a server with `!mydata export <server ID>`",
    )
    assert.equal(endless.calls.filter((call) => call.operation === "servers").length, 20)
})

test("!mydata export stops at 50 backend pages, exports no empty server entry and says how many records it read", async () => {
    const ids = Array.from({ length: 60 }, (_, index) => String(1000 + index)),
        { store, calls } = memberDataStore(() => ({ serverIds: ids, cursor: null }))
    const single: MemberDataStore = {
        ...store,
        export: (input) =>
            Effect.sync((): MemberDataExportPage => {
                calls.push({ operation: "export", input })
                return { records: [{ feature: "AFK status", data: { reason: "Away" } }], cursor: null }
            }),
    }
    assert.equal(
        await exportInPrivate(single),
        "This export stopped after 50 records. The file marks the servers it cut short and lists the ones it did not reach. Export a server it did not reach with `!mydata export <server ID>`",
    )
    assert.deepEqual(
        calls.filter((call) => call.operation === "export").map((call) => call.input.serverId),
        ids.slice(0, 50),
    )
})
