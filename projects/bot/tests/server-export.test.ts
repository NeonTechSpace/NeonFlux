import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { serverExportParts } from "../src/server-export.ts"
import type { ServerExportStore } from "../src/server-export-store.ts"
import { platform, token } from "./moderation-fixture.ts"

const f = createFixtures()
const levels = (from: number, count: number): C.ServerExportLevel[] => Array.from({ length: count }, (_, i) => ({ userId: String(100000000000000000n + BigInt(from + i)), xp: 400, level: 2 }))
const pages = (): C.ServerExportPage[] => [
    { section: "settings", family: "general", data: { prefix: "!", nickname: null }, cursor: "2" },
    { section: "settings", family: "moderation", data: { settings: { appealsEnabled: true }, watchlist: [{ userId: "1" }], rules: [] }, cursor: "3" },
    // A later page of a family carries only the list it continues
    { section: "settings", family: "moderation", data: { watchlist: [{ userId: "2" }] }, cursor: "4" },
    { section: "levels", levels: levels(0, 500), cursor: "5" },
    { section: "levels", levels: levels(500, 500), cursor: "6" },
    { section: "cases", cases: [{ caseNo: 1, action: "warn", origin: "manual", reason: null, outcome: "succeeded", voided: false, erased: true, createdAt: 1, corrections: [] }], cursor: "7" },
    { section: "appeals", appeals: [], cursor: null },
]

test("Export parts merge a family's continuing lists, split large exports into complete files under the part size and keep every record once", () => {
    const partBytes = 64 * 1024, parts = serverExportParts(f.ids.guild, 1, partBytes), files: C.ServerExportFile[] = []
    for (const page of pages()) { const full = parts.add(page); if (full) files.push(full) }
    files.push(parts.finish())
    assert.ok(files.length > 1)
    assert.deepEqual(files.map(file => [file.part, file.lastPart]), files.map((_, i) => [i + 1, i === files.length - 1]))
    for (const file of files) {
        assert.ok(Buffer.byteLength(JSON.stringify(file, null, 2)) <= partBytes, `part ${file.part}`)
        assert.deepEqual([file.format, file.version, file.serverId, file.exportedAt], ["neonflux-server-export", 1, f.ids.guild, 1])
    }
    assert.deepEqual(files[0]!.settings.moderation, { settings: { appealsEnabled: true }, watchlist: [{ userId: "1" }, { userId: "2" }], rules: [] })
    const all = files.flatMap(file => file.levels.map(row => row.userId))
    assert.deepEqual([all.length, new Set(all).size], [1000, 1000])
    assert.deepEqual(files.flatMap(file => file.cases.map(row => row.caseNo)), [1])
    // A small export is one file
    const small = serverExportParts(f.ids.guild, 1)
    assert.equal(pages().map(page => small.add(page)).filter(Boolean).length, 0)
    assert.equal(small.finish().levels.length, 1000)
})

function exportStore() {
    const calls: Array<{ operation: string, input: { context: C.BackupContext, cursor?: string | null } }> = []
    const store: ServerExportStore = {
        start: input => Effect.sync(() => { calls.push({ operation: "start", input }); return { version: 1 as const } }),
        page: input => Effect.sync(() => { calls.push({ operation: "page", input }); return pages()[input.cursor === null ? 0 : Number(input.cursor) - 1]! }),
    }
    return { store, calls }
}

test("!export sends the owner the server's data as one JSON file in a DM, gives the server a private hint and stays silent for anyone else", async () => {
    const { store, calls } = exportStore()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { serverExport: store })), p = platform(bot)
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!export" }))
        yield* bot.idle()
        assert.match((p.replies.requests()[0]!.body as { content: string }).content, /one-to-one DM with NeonFlux\. Only the server owner/)
        assert.equal(calls.length, 0)

        const message = { ...bot.fixtures.message({ channel_id: p.dmId, content: "!export" }) }
        delete message.guild_id
        yield* bot.emit("MESSAGE_CREATE", message)
        // Exports run beside the serial message handler, so wait for the reply itself
        yield* p.replies.next(); yield* bot.idle()
        const sent = p.replies.requests()[1]!
        assert.deepEqual(sent.files.map(file => [file.filename, file.contentType]), [[`neonflux-server-export-${f.ids.guild}.json`, "application/json"]])
        assert.match((sent.body as { content: string }).content, /readable JSON/)
        assert.deepEqual(calls.map(call => [call.operation, call.input.cursor]), [["start", undefined], ...[null, "2", "3", "4", "5", "6", "7"].map(cursor => ["page", cursor])])
        assert.ok(calls.every(call => call.input.context.ownerId === f.ids.user && call.input.context.dmChannelId === p.dmId))

        yield* bot.emit("MESSAGE_CREATE", { ...message, id: bot.fixtures.nextId(), content: "!export help" })
        yield* p.replies.next(); yield* bot.idle()
        assert.match((p.replies.requests()[2]!.body as { content: string }).content, /separate from !backup/)

        p.guildRoute.remove()
        bot.rest.respond(`GET /guilds/${f.ids.guild}`, { body: bot.fixtures.guild({ owner_id: bot.fixtures.nextId() }) })
        yield* bot.emit("MESSAGE_CREATE", { ...message, id: bot.fixtures.nextId() })
        yield* bot.idle()
        assert.equal(p.replies.requests().length, 3)
        assert.equal(calls.length, 8)
        assert.equal(bot.failures().length, 0)
    })))
})
