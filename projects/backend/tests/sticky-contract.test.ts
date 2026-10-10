import assert from "node:assert/strict"
import test from "node:test"
import { adapterFixture } from "./adapter-fixture.ts"
import { createStickyStore, StickyStoreError } from "../../bot/src/sticky-store.ts"
import { createSidebarStore, SidebarStoreError } from "../../bot/src/sidebar-store.ts"
import { createMemberListStore, MemberListStoreError } from "../../bot/src/memberlist-store.ts"

const modules = { "../convex/sticky.ts": () => import("../convex/sticky.ts"), "../convex/sidebar.ts": () => import("../convex/sidebar.ts"), "../convex/memberList.ts": () => import("../convex/memberList.ts") }

test("sticky, dashboard link and member list adapters round trip through the real HTTP boundary", async t => {
    const f = await adapterFixture(t, modules)
    const run = (effect: unknown): Promise<any> => f.run(effect)
    const actor = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
    const chat = () => ({ ...f.source(), originServerId: "1", actor, managerAuthorized: true as const })
    const sticky = createStickyStore(f.config), sidebar = createSidebarStore(f.config), memberList = createMemberListStore(f.config)
    const saved = (await run(sticky.manage({ ...chat(), operation: { type: "set", channelId: "50", content: "Rules" } }))).sticky
    assert.deepEqual([saved.channelId, saved.intervalSeconds, saved.messageId, saved.revision], ["50", 30, null, 1])
    assert.equal((await run(sticky.posted({ serverId: "1", channelId: "50", revision: 1, previousMessageId: null, messageId: "70" }))).accepted, true)
    assert.equal((await run(sticky.list({ serverId: "1" }))).stickies[0].messageId, "70")
    assert.equal((await run(sticky.manage({ ...chat(), operation: { type: "remove", channelId: "50" } }))).sticky.messageId, "70")
    await f.reject(sticky.manage({ ...chat(), operation: { type: "remove", channelId: "50" } }), StickyStoreError, 404)

    assert.equal((await run(sidebar.manage({ ...chat(), operation: { type: "add", channelId: "60", name: "Dashboard" } }))).link.channelId, "60")
    assert.equal((await run(sidebar.get({ serverId: "1" }))).link.revision, 1)
    await f.reject(sidebar.manage({ ...chat(), operation: { type: "add", channelId: "61", name: "Dashboard" } }), SidebarStoreError, 409)

    assert.deepEqual(await run(memberList.manage({ ...chat(), operation: { type: "set", roleIds: ["40", "41"] } })), { revision: 1 })
    await f.reject(memberList.manage({ ...chat(), actor: { ...actor, isOwner: false }, operation: { type: "reset" } }), MemberListStoreError, 403)
    t.diagnostic(`${f.calls.length} real in-process HTTP calls, no real network`)
})
