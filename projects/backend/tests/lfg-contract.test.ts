import assert from "node:assert/strict"
import test from "node:test"
import { adapterFixture } from "./adapter-fixture.ts"
import { createLfgStore, LfgStoreError } from "../../bot/src/lfg-store.ts"
import { createVoiceStore } from "../../bot/src/voice-store.ts"

const modules = { "../convex/lfg.ts": () => import("../convex/lfg.ts"), "../convex/voice.ts": () => import("../convex/voice.ts") }

test("looking for group adapter round trips settings, groups, rooms and expiry through the real HTTP boundary", async t => {
    const f = await adapterFixture(t, modules)
    const store = createLfgStore(f.config), voice = createVoiceStore(f.config), run = (effect: unknown): Promise<any> => f.run(effect)
    const owner = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
    const member = (userId: string) => ({ ...owner, userId, isOwner: false, nativePermissionAuthorized: false })
    const manage = (operation: any, actor = member("20"), managerAuthorized = false) => store.manage({ ...f.source(), originServerId: "1", actor, managerAuthorized, operation })
    await run(voice.manage({ ...f.source(), actor: owner, operation: { type: "generator-add", channelId: "50", channelName: "Join to create", categoryId: "40", template: "{owner}'s room", userLimit: null, region: null } }))
    assert.equal((await run(manage({ type: "settings", patch: { enabled: true, channelId: "60", generatorChannelId: "50" } }, owner, true))).settings.generatorChannelId, "50")
    const group = (await run(manage({ type: "create", activity: "Deep Rock", size: 2, note: "mics on" }))).group
    assert.deepEqual([group.groupNo, group.memberIds, group.note, group.messageId], [1, ["20"], "mics on", null])
    assert.equal((await run(manage({ type: "card", groupNo: 1, messageId: "700" }))).group.messageId, "700")
    assert.deepEqual((await run(manage({ type: "join", groupNo: 1 }, member("21")))).group.memberIds, ["20", "21"])
    const preview = await run(store.query({ serverId: "1", operation: { type: "start", groupNo: 1 } }))
    assert.deepEqual([preview.group.groupNo, preview.generator.channelId], [1, "50"])
    const started = await run(manage({ type: "start", groupNo: 1, channelId: "800" }, member("21")))
    assert.deepEqual([started.type, started.created, started.room.ownerId], ["started", true, "20"])
    assert.deepEqual(await run(manage({ type: "join", groupNo: 1 }, member("22"))), { type: "refused", reason: "missing" })

    await run(manage({ type: "create", activity: "Chess", size: 2 }, member("23")))
    assert.equal((await run(store.query({ serverId: "1", operation: { type: "list" } }))).groups.length, 1)
    f.advance(3600000)
    assert.deepEqual((await run(store.work({ serverId: "1" }))).groups.map((row: { activity: string }) => row.activity), ["Chess"])
    await f.reject(manage({ type: "settings", patch: { enabled: false } }), LfgStoreError, 403)
    await f.reject(createLfgStore(f.wrongConfig).work({ serverId: "1" }), LfgStoreError, 401)
    t.diagnostic(`${f.calls.length} real in-process HTTP calls, no real network`)
})
