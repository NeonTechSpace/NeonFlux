import assert from "node:assert/strict"
import nodeTest, { type TestContext } from "node:test"
import type * as C from "../contracts.js"
import { adapterFixture } from "./adapter-fixture.ts"
import { insertDocument } from "./schema-documents.ts"
import { createMemberDataStore } from "../../bot/src/member-data-store.ts"

const test = (name: string, body: (t: TestContext) => Promise<void>) => nodeTest(name, { timeout: 30000 }, body)

test("The bot's member data adapter decodes the backend's list, server search, export and delete answers", async t => {
    const f = await adapterFixture(t, {})
    const store = createMemberDataStore(f.config)
    await f.backend.run(async ctx => {
        await ctx.db.insert("afkStatuses", { serverId: "1", userId: "70", reason: "Synthetic away reason", since: 1 })
        await insertDocument(ctx, "moderationAppeals", "1", { userId: "70", appealNo: 1, caseNo: 1, text: "Synthetic appeal", erased: false })
    })
    const list = await f.run<C.MemberDataList>(store.list({ userId: "70" }))
    assert.deepEqual(list.servers[0]!.features.map(item => [item.feature, item.count, item.kept === null]), [["AFK status", 1, true], ["Appeals", 1, false]])
    assert.deepEqual(await f.run<C.MemberDataServerPage>(store.servers({ userId: "70", cursor: null })), { serverIds: ["1"], cursor: null })
    const page = await f.run<C.MemberDataExportPage>(store.export({ userId: "70", serverId: "1", cursor: null }))
    assert.deepEqual(page.records.map(record => record.feature), ["AFK status", "Appeals"])
    assert.equal(page.cursor, null)
    const deleted = await f.run<C.MemberDataDeletePage>(store.delete({ userId: "70", userName: "Synthetic member", serverId: "1", cursor: null }))
    assert.deepEqual([deleted.deleted, deleted.kept.map(item => item.feature), deleted.cursor], [[{ feature: "AFK status", count: 1 }], ["Appeals"], null])
})
