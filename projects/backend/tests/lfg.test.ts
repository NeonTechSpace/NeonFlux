import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { botCall } from "./bot-service.ts"

const prior = { ...process.env }, now = Date.parse("2026-01-01T00:00:00Z"), secret = "synthetic-lfg-test-secret-not-a-credential-00000"
let clock = now
beforeEach(() => {
    clock = now
    mock.timers.enable({ apis: ["setTimeout"] }); mock.method(Date, "now", () => clock)
    process.env.NEONFLUX_SERVER_ID = "10"; process.env.NEONFLUX_BOT_API_SECRET = secret
    delete process.env.NEONFLUX_SERVER_MODE; delete process.env.NEONFLUX_SERVER_IDS
})
afterEach(() => {
    mock.restoreAll(); mock.timers.reset()
    for (const key of ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_IDS", "NEONFLUX_BOT_API_SECRET"]) if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key]
})
const modules = Object.fromEntries(["lfg", "voice", "botService", "_generated/api", "_generated/server"]
    .map(name => [`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`, () => import(`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`)]))
const member = (userId: string) => ({ originServerId: "10", userId, roleIds: [], isOwner: false, isAdministrator: false, nativePermissionAuthorized: false })
const manager = { ...member("99"), isOwner: true, nativePermissionAuthorized: true }
const host = "21", other = "22", third = "23"

async function fixture() {
    const t = convexTest({ schema, modules, transactionLimits: true }); let sequence = 1000
    const post = async (path: string, body: unknown, expected = 200) => {
        const response = await botCall(t, path, body)
        const result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result)); assert(!JSON.stringify(result).includes(secret))
        return result
    }
    const manage = (operation: unknown, who: ReturnType<typeof member> = member(host), expected = 200) =>
        post("/lfg/manage", { serverId: "10", messageId: String(++sequence), createdAt: clock, actor: who, managerAuthorized: who === manager, operation }, expected)
    const settings = (patch: Record<string, unknown>, expected = 200) => manage({ type: "settings", patch }, manager, expected)
    const generator = (channelId = "50") => t.run(async ctx => { await ctx.db.insert("voiceGenerators", { serverId: "10", channelId, categoryId: "40", template: "{owner}'s room", userLimit: null, region: null, revision: 1, createdAt: now, updatedAt: now }) })
    const create = (who = host, fields: Record<string, unknown> = {}) => manage({ type: "create", activity: "Deep Rock", size: 3, ...fields }, member(who))
    const count = (table: "lfgGroups" | "lfgMembers" | "voiceRooms" | "auditLogEntries") => t.run(async ctx => (await ctx.db.query(table).collect()).length)
    const ready = async () => { await generator(); await settings({ enabled: true, channelId: "60", generatorChannelId: "50" }) }
    return { t, post, manage, settings, generator, create, count, ready }
}

test("Settings need a manager, check their bounds and generator, and share one audited revision", async () => {
    const f = await fixture()
    await f.manage({ type: "settings", patch: { enabled: true } }, member(host), 403)
    for (const patch of [{}, { expiryMinutes: 9 }, { expiryMinutes: 1441 }, { maxSize: 1 }, { maxSize: 26 }, { memberGroups: 6 }, { serverGroups: 51 }, { enabled: "yes" }]) await f.settings(patch, 400)
    // A generator is checked when it is chosen
    await f.settings({ generatorChannelId: "50" }, 404)
    await f.generator()
    const saved = await f.settings({ enabled: true, channelId: "60", generatorChannelId: "50", maxSize: 5 })
    assert.deepEqual(saved, { type: "settings", revision: 1, settings: { enabled: true, channelId: "60", generatorChannelId: "50", expiryMinutes: 60, maxSize: 5, memberGroups: 1, serverGroups: 20 } })
    assert.equal((await f.settings({ generatorChannelId: null })).revision, 2)
    assert.equal(await f.count("auditLogEntries"), 2)
    const listed = await f.post("/lfg/query", { serverId: "10", operation: { type: "list" } })
    assert.deepEqual([listed.revision, listed.settings.generatorChannelId, listed.groups], [2, null, []])
})

test("Groups follow the size and open group limits, and members join and leave", async () => {
    const f = await fixture()
    assert.deepEqual(await f.create(), { type: "refused", reason: "off" })
    await f.ready()
    assert.deepEqual(await f.create(host, { size: 11 }), { type: "refused", reason: "size", limit: 10 })
    const { group } = await f.create(host, { note: "Haz 5", startsInMinutes: 30 })
    // An open group with a start time stays open for the expiry time after it
    assert.deepEqual(group, { groupNo: 1, hostId: host, activity: "Deep Rock", size: 3, note: "Haz 5", startsAt: now + 1800000, channelId: "60", messageId: null, memberIds: [host], expiresAt: now + 5400000, createdAt: now })
    assert.deepEqual(await f.create(), { type: "refused", reason: "member-limit", limit: 1 })
    await f.settings({ serverGroups: 2 })
    assert.equal((await f.create(other)).group.groupNo, 2)
    assert.deepEqual(await f.create(third), { type: "refused", reason: "server-limit", limit: 2 })
    for (const invalid of [{ activity: "" }, { activity: "x".repeat(51) }, { activity: "Two\nlines" }, { size: 1 }, { note: "x".repeat(201) }, { startsInMinutes: 10081 }]) await f.manage({ type: "create", activity: "Game", size: 3, ...invalid }, member(third), 400)

    assert.deepEqual(await f.manage({ type: "join", groupNo: 1 }), { type: "refused", reason: "joined" })
    assert.deepEqual((await f.manage({ type: "join", groupNo: 1 }, member(other))).group.memberIds, [host, other])
    assert.deepEqual(await f.manage({ type: "join", groupNo: 1 }, member(other)), { type: "refused", reason: "joined" })
    assert.deepEqual(await f.manage({ type: "leave", groupNo: 1 }), { type: "refused", reason: "host" })
    assert.deepEqual(await f.manage({ type: "leave", groupNo: 1 }, member(third)), { type: "refused", reason: "not-joined" })
    assert.deepEqual((await f.manage({ type: "leave", groupNo: 1 }, member(other))).group.memberIds, [host])
    assert.deepEqual((await f.manage({ type: "card", groupNo: 1, messageId: "700" })).group.messageId, "700")
    assert.deepEqual(await f.manage({ type: "join", groupNo: 9 }), { type: "refused", reason: "missing" })

    // Only the host or a manager cancels, and a cancelled group leaves no rows
    await f.manage({ type: "join", groupNo: 1 }, member(third))
    assert.deepEqual(await f.manage({ type: "cancel", groupNo: 1 }, member(third)), { type: "refused", reason: "permission" })
    const closed = await f.manage({ type: "cancel", groupNo: 1 }, manager)
    assert.deepEqual([closed.type, closed.group.memberIds, closed.group.messageId], ["closed", [host, third], "700"])
    assert.deepEqual([await f.count("lfgGroups"), await f.count("lfgMembers")], [1, 0])
})

test("A full group or its host starts it, and the room is recorded as the host's temporary voice room", async () => {
    const f = await fixture()
    await f.ready()
    await f.create()
    await f.manage({ type: "join", groupNo: 1 }, member(other))
    const preview = await f.post("/lfg/query", { serverId: "10", operation: { type: "start", groupNo: 1 } })
    assert.deepEqual([preview.group.memberIds, preview.generator.channelId, preview.generator.categoryId], [[host, other], "50", "40"])
    assert.deepEqual(await f.manage({ type: "start", groupNo: 1, channelId: "800" }, member(other)), { type: "refused", reason: "permission" })
    // The last free seat fills the group, and then any member may start it
    await f.manage({ type: "join", groupNo: 1 }, member(third))
    assert.deepEqual(await f.manage({ type: "join", groupNo: 1 }, member("24")), { type: "refused", reason: "full" })
    const started = await f.manage({ type: "start", groupNo: 1, channelId: "800" }, member(third))
    assert.deepEqual([started.type, started.created, started.room, started.group.memberIds], ["started", true, { channelId: "800", ownerId: host, generatorChannelId: "50", createdAt: now }, [host, other, third]])
    assert.deepEqual([await f.count("lfgGroups"), await f.count("lfgMembers"), await f.count("voiceRooms")], [0, 0, 1])
    assert.deepEqual(await f.manage({ type: "start", groupNo: 1, channelId: "801" }), { type: "refused", reason: "missing" })

    // A host who already owns a room keeps it for the next group, so the new channel is not recorded
    await f.create()
    const again = await f.manage({ type: "start", groupNo: 2, channelId: "802" })
    assert.deepEqual([again.type, again.created, again.room.channelId], ["started", false, "800"])
    assert.equal(await f.count("voiceRooms"), 1)

    // A removed generator stops rooms, and the group stays open
    await f.create(other)
    await f.t.run(async ctx => { for (const row of await ctx.db.query("voiceGenerators").collect()) await ctx.db.delete(row._id) })
    assert.deepEqual(await f.manage({ type: "start", groupNo: 3, channelId: "803" }, member(other)), { type: "refused", reason: "generator" })
    // Turning the feature off pauses joining and starting
    await f.settings({ enabled: false })
    assert.deepEqual(await f.manage({ type: "join", groupNo: 3 }), { type: "refused", reason: "off" })
    assert.deepEqual(await f.manage({ type: "start", groupNo: 3, channelId: "803" }, member(other)), { type: "refused", reason: "off" })
    assert.equal(await f.count("lfgGroups"), 1)
})

test("Groups close when their time runs out, ten per work request", async () => {
    const f = await fixture()
    await f.ready()
    await f.settings({ memberGroups: 5, serverGroups: 50 })
    for (let index = 0; index < 12; index++) await f.create(String(30 + Math.floor(index / 5)))
    await f.manage({ type: "join", groupNo: 1 }, member(other))
    assert.deepEqual(await f.post("/lfg/work", { serverId: "10" }), { groups: [] })
    clock = now + 3600000
    assert.deepEqual(await f.manage({ type: "join", groupNo: 2 }, member(other)), { type: "refused", reason: "missing" })
    const first = await f.post("/lfg/work", { serverId: "10" })
    assert.equal(first.groups.length, 10)
    assert.deepEqual(first.groups[0].memberIds, ["30", other])
    assert.equal((await f.post("/lfg/work", { serverId: "10" })).groups.length, 2)
    assert.deepEqual([await f.count("lfgGroups"), await f.count("lfgMembers")], [0, 0])
})
