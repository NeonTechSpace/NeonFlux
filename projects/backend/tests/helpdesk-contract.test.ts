import assert from "node:assert/strict"
import test from "node:test"
import { adapterFixture } from "./adapter-fixture.ts"
import { createHelpDeskStore, HelpDeskStoreError } from "../../bot/src/helpdesk-store.ts"
import { createSetupStore } from "../../bot/src/setup-check.ts"

const modules = { "../convex/helpDesk.ts": () => import("../convex/helpDesk.ts"), "../convex/setupCheck.ts": () => import("../convex/setupCheck.ts") }

test("help desk and setup adapters round trip through the real HTTP boundary", async t => {
    const f = await adapterFixture(t, modules)
    const run = (effect: unknown): Promise<any> => f.run(effect)
    const actor = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
    const chat = (authorized: "manager" | "staff") => ({ ...f.source(), originServerId: "1", actor, authorized })
    const store = createHelpDeskStore(f.config)
    assert.equal((await run(store.get({ serverId: "1" }))).settings.solvedTag, "Solved")
    assert.deepEqual((await run(store.manage({ ...chat("manager"), operation: { type: "forum-add", channelId: "50" } }))).settings.forumIds, ["50"])
    await f.reject(store.manage({ ...chat("staff"), operation: { type: "forum-add", channelId: "51" } }), HelpDeskStoreError, 403)
    assert.equal((await run(store.manage({ ...chat("staff"), operation: { type: "answer-set", name: "logs", title: "Logs", content: "Send logs" } }))).answer.name, "logs")
    assert.equal((await run(store.answers({ serverId: "1", name: "logs" }))).answers[0].content, "Send logs")
    assert.deepEqual(await run(store.opened({ serverId: "1", threadId: "70", forumId: "50" })), { recorded: true })
    assert.deepEqual(await run(store.work({ serverId: "1" })), { nudges: [], more: false, guard: null })
    assert.deepEqual(await run(store.guard({ serverId: "1", activeThreads: 950, more: false })), { warn: false })
    // The bot decodes every overview section the backend reports, including the help desk
    const status = await run(createSetupStore(f.config).status("1"))
    assert.equal(status.sections.find((section: { id: string }) => section.id === "helpdesk").state, "on")
    t.diagnostic(`${f.calls.length} real in-process HTTP calls, no real network`)
})
