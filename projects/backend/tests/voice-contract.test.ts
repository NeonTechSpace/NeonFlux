import assert from "node:assert/strict"
import test from "node:test"
import { adapterFixture } from "./adapter-fixture.ts"
import { createVoiceStore, VoiceStoreError } from "../../bot/src/voice-store.ts"

const modules = { "../convex/voice.ts": () => import("../convex/voice.ts") }

test("voice adapter round trips generators, rooms and authority through the real HTTP boundary", async t => {
    const f = await adapterFixture(t, modules)
    const store = createVoiceStore(f.config), run = (effect: unknown): Promise<any> => f.run(effect)
    const owner = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
    const member = { ...owner, userId: "20", isOwner: false, nativePermissionAuthorized: false }
    const manage = (operation: any, actor = owner) => store.manage({ ...f.source(), actor, operation })
    const generator = (await run(manage({ type: "generator-add", channelId: "50", channelName: "Join to create", categoryId: "40", template: "{owner}'s room", userLimit: 3, region: "eu-west" }))).generator
    assert.deepEqual([generator.channelId, generator.userLimit, generator.region, generator.revision], ["50", 3, "eu-west", 1])
    assert.equal((await run(manage({ type: "generator-set", channelId: "50", patch: { template: "{owner} plays", userLimit: null } }))).generator.template, "{owner} plays")
    const room = (await run(store.rooms({ serverId: "1", operation: { type: "create", channelId: "100", ownerId: "20", generatorChannelId: "50" } }))).room
    assert.deepEqual(room, { channelId: "100", ownerId: "20", generatorChannelId: "50", createdAt: f.now() })
    const state = await run(store.query({ serverId: "1", operation: { type: "state" } }))
    assert.equal(state.generators.length, 1); assert.deepEqual(state.rooms, [room])
    const authority = await run(store.query({ serverId: "1", operation: { type: "authority", actor: member } }))
    assert.deepEqual([authority.staff, authority.room, authority.rooms], [false, room, 1])
    assert.deepEqual(await run(store.rooms({ serverId: "1", operation: { type: "forget", channelId: "100" } })), { type: "forgotten", room: true, generator: false })
    assert.deepEqual(await run(manage({ type: "generator-remove", channelId: "50" })), { type: "removed", channelId: "50" })

    await f.reject(manage({ type: "generator-add", channelId: "51", channelName: "Join", categoryId: null, template: "Room", userLimit: null, region: null }, member), VoiceStoreError, 403)
    await f.reject(manage({ type: "generator-remove", channelId: "50" }), VoiceStoreError, 404)
    await f.reject(createVoiceStore(f.wrongConfig).query({ serverId: "1", operation: { type: "state" } }), VoiceStoreError, 401)
    assert.deepEqual(f.calls.slice(-3).map(call => call.status), [403, 404, 401])
    t.diagnostic(`${f.calls.length} real in-process HTTP calls, no real network`)
})
