import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, test } from "node:test"
import { ConvexError } from "convex/values"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { internal } from "../convex/_generated/api.js"
import { backendRoutes } from "../../bot/src/backend-routes.ts"
import { botCall } from "./bot-service.ts"
import { parseServerScope, requireOrigin } from "../convex/serverScope.ts"
import { backupCapabilities } from "../convex/backupDomain.ts"

const secret = "synthetic-multiserver-backend-secret-0000000000"
const keys = ["NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_IDS", "NEONFLUX_SERVER_ID", "NEONFLUX_BOT_API_SECRET"] as const
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]))
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    process.env.NEONFLUX_SERVER_MODE = "multi"
    process.env.NEONFLUX_BOT_API_SECRET = secret
})
afterEach(() => { for (const key of keys) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key] } })
const single = (serverId: string) => {
    delete process.env.NEONFLUX_SERVER_MODE
    delete process.env.NEONFLUX_SERVER_IDS
    process.env.NEONFLUX_SERVER_ID = serverId
}

const modules = {
    "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/afk.ts": () => import("../convex/afk.ts"),
    "../convex/responses.ts": () => import("../convex/responses.ts"),
    "../convex/generalSettings.ts": () => import("../convex/generalSettings.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"),
    "../convex/greetings.ts": () => import("../convex/greetings.ts"),
    "../convex/greetingLifecycle.ts": () => import("../convex/greetingLifecycle.ts"),
    "../convex/backup.ts": () => import("../convex/backup.ts"),
    "../convex/leveling.ts": () => import("../convex/leveling.ts"),
    "../convex/levelingWork.ts": () => import("../convex/levelingWork.ts"),
    "../convex/installations.ts": () => import("../convex/installations.ts"),
    "../convex/schema.ts": () => import("../convex/schema.ts"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
}
const backend = () => convexTest({ schema, modules, transactionLimits: true })
type Backend = ReturnType<typeof backend>
// The secret the request key is derived from. The default is the configured secret
function installation(t: Backend, operation: "list" | "join" | "leave", body: unknown, keySecret?: string) {
    return botCall(t, `/service/installations/${operation}`, body, keySecret === undefined ? {} : { secret: keySecret })
}
// Multi-mode servers are served only after the bot registers them
async function installed(...serverIds: string[]) {
    const t = backend()
    for (const serverId of serverIds) assert.equal((await installation(t, "join", { serverId })).status, 200)
    return t
}
function post(t: Backend, path: string, body: unknown, serverId?: string, keySecret?: string) {
    return botCall(t, path, body, { serverId, ...(keySecret === undefined ? {} : { secret: keySecret }) })
}
const actor = (serverId: string, owner = true) => ({ originServerId: serverId, userId: "30", roleIds: [], isOwner: owner, isAdministrator: false, nativePermissionAuthorized: true })
function status(expected: number) {
    return (error: unknown) => error instanceof ConvexError && typeof error.data === "object" && error.data !== null && "status" in error.data && error.data.status === expected
}
const settings = (t: Backend) => t.run(ctx => ctx.db.query("moderationSettings").collect())

test("Scope parser trims a single server and accepts multi mode without a server list", () => {
    assert.deepEqual(parseServerScope({ NEONFLUX_SERVER_ID: " 10 " }), { mode: "single", serverIds: ["10"] })
    assert.deepEqual(parseServerScope({ NEONFLUX_SERVER_MODE: "multi" }), { mode: "multi" })
})

test("Scope parser rejects malformed, ambiguous and retired list inputs without echoing them", () => {
    const invalid = [
        {}, { NEONFLUX_SERVER_MODE: "" }, { NEONFLUX_SERVER_MODE: "other", NEONFLUX_SERVER_ID: "10" },
        { NEONFLUX_SERVER_ID: "10", NEONFLUX_SERVER_IDS: "" },
        { NEONFLUX_SERVER_MODE: "multi", NEONFLUX_SERVER_ID: "" }, { NEONFLUX_SERVER_MODE: "multi", NEONFLUX_SERVER_ID: "10" },
        ...["", "10,20", '["10"]', '["9223372036854775808"]'].map(NEONFLUX_SERVER_IDS => ({ NEONFLUX_SERVER_MODE: "multi", NEONFLUX_SERVER_IDS })),
    ]
    for (const env of invalid) {
        assert.throws(() => parseServerScope(env), error => error instanceof Error && !error.message.includes("9223372036854775808") && !error.message.includes("10,20"))
    }
    for (const id of ["", "01", "0", "-1", "1.0", "1e3", "9223372036854775808"]) assert.throws(() => parseServerScope({ NEONFLUX_SERVER_ID: id }))
})

test("Authenticated scope discovery names the mode, and the single server only in single mode", async () => {
    const t = backend()
    assert.equal((await botCall(t, "/service/scope", {}, { secret: null })).status, 401)
    const response = await botCall(t, "/service/scope", {})
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { mode: "multi" })
    single("10")
    assert.deepEqual(await (await botCall(t, "/service/scope", {})).json(), { mode: "single", serverIds: ["10"] })
})

test("Installation routes authenticate, repeat safely and keep removed rows", async tc => {
    let now = Date.parse("2026-01-01T00:00:00Z")
    tc.mock.method(Date, "now", () => now)
    const t = backend(), rows = () => t.run(ctx => ctx.db.query("serverInstallations").collect())
    for (const operation of ["list", "join", "leave"] as const) {
        assert.equal((await installation(t, operation, { serverId: "10" }, "synthetic-wrong-secret-00000000000000000")).status, 401)
        assert.equal((await installation(t, operation, { serverId: "01" })).status, operation === "list" ? 200 : 400)
    }
    assert.deepEqual(await rows(), [])
    // Only the join that starts an installation answers welcome, so the bot posts one install note
    for (let attempt = 0; attempt < 2; attempt++) assert.deepEqual(await (await installation(t, "join", { serverId: "10" })).json(), { serverId: "10", active: true, ...(attempt ? {} : { welcome: true }) })
    assert.deepEqual((await rows()).map(({ serverId, status, joinedAt, removedAt }) => ({ serverId, status, joinedAt, removedAt })), [{ serverId: "10", status: "active", joinedAt: now, removedAt: undefined }])
    const removedAt = now += 1000
    for (let attempt = 0; attempt < 2; attempt++) {
        assert.deepEqual(await (await installation(t, "leave", { serverId: "10" })).json(), { serverId: "10", active: false })
        now += 1000
    }
    assert.deepEqual((await rows()).map(({ status, removedAt }) => ({ status, removedAt })), [{ status: "removed", removedAt }])
    assert.deepEqual(await (await installation(t, "leave", { serverId: "20" })).json(), { serverId: "20", active: false })
    assert.equal((await rows()).length, 1)
    assert.deepEqual(await (await installation(t, "join", { serverId: "10" })).json(), { serverId: "10", active: true, welcome: true })
    assert.deepEqual((await rows()).map(({ status, joinedAt, removedAt }) => ({ status, joinedAt, removedAt })), [{ status: "active", joinedAt: now, removedAt: undefined }])
})

test("Installation listing pages through active servers only", async () => {
    const t = backend(), now = Date.now()
    await t.run(async ctx => {
        for (let index = 1; index <= 501; index++) await ctx.db.insert("serverInstallations", { serverId: String(index), status: "active", joinedAt: now, lastSeenAt: now })
        await ctx.db.insert("serverInstallations", { serverId: "900", status: "removed", joinedAt: now, lastSeenAt: now, removedAt: now })
    })
    const first = await (await installation(t, "list", {})).json() as { serverIds: string[], nextCursor: string | null }
    assert.equal(first.serverIds.length, 500)
    assert.notEqual(first.nextCursor, null)
    const second = await (await installation(t, "list", { cursor: first.nextCursor })).json() as { serverIds: string[], nextCursor: string | null }
    assert.equal(second.nextCursor, null)
    const listed = [...first.serverIds, ...second.serverIds]
    assert.deepEqual(new Set(listed), new Set(Array.from({ length: 501 }, (_, index) => String(index + 1))))
    assert.equal(listed.length, 501)
})

test("Single mode rejects installation routes", async () => {
    single("10")
    const t = backend()
    for (const operation of ["list", "join", "leave"] as const) {
        const response = await installation(t, operation, { serverId: "10" })
        assert.equal(response.status, 404)
        assert.deepEqual(await response.json(), { error: "Server installations require multi mode" })
    }
    assert.deepEqual(await t.run(ctx => ctx.db.query("serverInstallations").collect()), [])
})

const everyModule = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url)).filter(name => name.endsWith(".ts")).map(name => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")], ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const tableCounts = (t: Backend) => t.run(async ctx => {
    const counts: Record<string, number> = {}
    for (const table of Object.keys(schema.tables) as (keyof typeof schema.tables)[]) counts[table] = (await ctx.db.query(table).collect()).length
    return counts
})

test("Every bot route rejects uninstalled and removed servers before domain work and keeps their data", async () => {
    const t = convexTest({ schema, modules: everyModule, transactionLimits: true })
    const routes = Object.keys(backendRoutes).filter(path => !path.startsWith("/service/"))
    assert.ok(routes.length > 90)
    const rejectAll = async (serverId: string) => {
        const before = await tableCounts(t)
        for (const path of routes) {
            const response = await post(t, path, { serverId, userId: "40", reason: "Away", mentionedUserIds: [] }, serverId)
            assert.equal(response.status, 403, path)
            assert.deepEqual(await response.json(), { error: "Server not allowed", code: "NEONFLUX_SCOPE_DENIED" }, path)
        }
        assert.deepEqual(await tableCounts(t), before)
    }
    await rejectAll("30")
    assert.equal((await installation(t, "join", { serverId: "30" })).status, 200)
    assert.equal((await post(t, "/afk/set", { serverId: "30", userId: "40", reason: "Retained" }, "30")).status, 200)
    assert.equal((await installation(t, "leave", { serverId: "30" })).status, 200)
    await rejectAll("30")
    assert.deepEqual((await t.run(ctx => ctx.db.query("afkStatuses").collect())).map(row => [row.serverId, row.reason]), [["30", "Retained"]])
})

test("Every feature family rejects absent, foreign and mismatched server bindings before domain work", async () => {
    const t = await installed("10", "20")
    const paths = ["/afk/set", "/responses/manage", "/moderation/manage", "/appeals/member", "/publishing/manage", "/roles/manage", "/greetings/manage", "/tickets/manage",
        "/levels/manage", "/events/manage", "/schedules/manage", "/milestones/manage", "/suggestions/manage", "/cleanup/manage", "/metadata-logs/manage", "/backup/manage"]
    for (const path of paths) {
        for (const selected of [undefined, "99", "01", "20"]) {
            const result = await post(t, path, { serverId: "10" }, selected)
            assert.equal(result.status, 403, path)
            assert.deepEqual(await result.json(), { error: "Server not allowed", code: "NEONFLUX_SCOPE_DENIED" })
        }
        assert.equal((await post(t, path, null, "99", "synthetic-wrong-secret-00000000000000000")).status, 401)
    }
    assert.deepEqual(await settings(t), [])
})

test("Single mode accepts an omitted header and still binds the body server", async () => {
    single("10")
    const t = backend()
    assert.equal((await post(t, "/afk/set", { serverId: "10", userId: "30", reason: "Single" })).status, 200)
    const wrong = await post(t, "/afk/set", { serverId: "20", userId: "30", reason: "Rejected" })
    assert.deepEqual(await wrong.json(), { error: "Server not allowed", code: "NEONFLUX_SCOPE_DENIED" })
    assert.equal((await post(t, "/afk/set", { serverId: "20" }, "20")).status, 403)
})

test("Admin evidence read from one installed server cannot authorize another", async () => {
    const t = await installed("10", "20"), createdAt = Date.now()
    const request = (messageId: string, who: object) => ({ serverId: "20", messageId, createdAt, actor: who, operation: { type: "settings", patch: { defcon: 1 } } })
    const foreign = await post(t, "/moderation/manage", request("50", actor("10")), "20")
    assert.equal(foreign.status, 403)
    assert.deepEqual(await foreign.json(), { error: "Native evidence server mismatch" })
    const { originServerId: _origin, ...unbound } = actor("20")
    assert.equal((await post(t, "/moderation/manage", request("51", unbound), "20")).status, 403)
    assert.deepEqual(await settings(t), [])
    assert.equal((await post(t, "/moderation/manage", request("52", actor("20")), "20")).status, 200)
    assert.deepEqual((await settings(t)).map(row => [row.serverId, row.config.defcon]), [["20", 1]])
})

test("Foreign origins anywhere in the request reject before state changes", async () => {
    const t = await installed("10", "20"), observedAt = Date.now(), joinedAt = "2020-01-01T00:00:00Z"
    for (const evidence of [
        { originServerId: "10", botId: "40", channelId: "60", botAuthorized: true, actorAuthorized: true },
        { originServerId: "10", userId: "30", joinedAt, roleIds: [], isBot: false },
        [{ originServerId: "10", roleId: "70", permissions: "0", botCanManage: true, actorCanManage: true }],
        { nested: { memberOriginServerId: "10", member: null, memberAbsent: true } },
    ]) {
        const response = await post(t, "/publishing/manage", { serverId: "20", operation: { recipientOwner: evidence } }, "20")
        assert.equal(response.status, 403)
        assert.deepEqual(await response.json(), { error: "Native evidence server mismatch" })
    }
    const absence = { type: "absent", userId: "30", expectedGeneration: 1, joinedAt, observedAt, memberAbsent: true }
    assert.equal((await post(t, "/greetings/observe", { serverId: "20", operation: { ...absence, originServerId: "10" } }, "20")).status, 403)
    assert.deepEqual(await t.run(ctx => ctx.db.query("greetingMembers").collect()), [])
    const accepted = await post(t, "/greetings/observe", { serverId: "20", operation: { ...absence, originServerId: "20" } }, "20")
    assert.equal(accepted.status, 200)
    assert.deepEqual(await accepted.json(), { recorded: false, member: null, admitted: 0 })
})

test("Authority and absence evidence without a read server reject before state changes", async () => {
    const t = await installed("20"), observedAt = Date.now()
    const manage = { serverId: "20", actorId: "30", managerAuthorized: true, prefix: "?", expectedRevision: 0 }
    const unbound = await post(t, "/general/manage", manage, "20")
    assert.equal(unbound.status, 403)
    assert.deepEqual(await unbound.json(), { error: "Native evidence server mismatch" })
    assert.deepEqual(await t.run(ctx => ctx.db.query("generalSettings").collect()), [])
    assert.equal((await post(t, "/general/manage", { ...manage, originServerId: "20" }, "20")).status, 200)
    const absence = { type: "absent", userId: "30", expectedGeneration: 1, joinedAt: "2020-01-01T00:00:00Z", observedAt, memberAbsent: true }
    const originless = await post(t, "/greetings/observe", { serverId: "20", operation: absence }, "20")
    assert.equal(originless.status, 403)
    assert.deepEqual(await originless.json(), { error: "Native evidence server mismatch" })
})

test("Bot automation authority without a read server rejects in multi mode", () => {
    const context = { observedAt: 1, channelId: "40", botId: "50", botAuthorized: true }
    assert.throws(() => requireOrigin({ serverId: "20", context }, "20", true), status(403))
    assert.throws(() => requireOrigin({ serverId: "20", context: { ...context, originServerId: "10" } }, "20", true), status(403))
    assert.doesNotThrow(() => requireOrigin({ serverId: "20", context: { ...context, originServerId: "20" } }, "20", true))
    assert.doesNotThrow(() => requireOrigin({ serverId: "20", context }, "20", false))
})

test("Greeting membership proof binds its read server", async () => {
    const t = await installed("10", "20"), now = Date.now()
    const request = { serverId: "20", deliveryId: "synthetic-delivery", route: "goodbye", routeRevision: 1, userId: "30", joinedAt: "2020-01-01T00:00:00Z", memberGeneration: 1 }
    const context = { originServerId: "20", botId: "40", botAuthorized: true, observedAt: now, member: null, memberAbsent: true, memberOriginServerId: "20", memberUserId: "30", channelId: "60" }
    assert.equal((await post(t, "/greetings/reserve", { ...request, context: { ...context, memberOriginServerId: "10" } }, "20")).status, 403)
    assert.equal((await post(t, "/greetings/reserve", { ...request, context }, "20")).status, 404)
})

test("AFK keeps each server's records apart and internal guards allow only installed servers", async () => {
    const t = await installed("10", "20")
    for (const serverId of ["10", "20"]) assert.equal((await post(t, "/afk/set", { serverId, userId: "30", reason: `Scope ${serverId}` }, serverId)).status, 200)
    assert.equal((await post(t, "/afk/observe", { serverId: "10", userId: "30", mentionedUserIds: [] }, "10")).status, 200)
    const remaining = await t.run(ctx => ctx.db.query("afkStatuses").collect())
    assert.deepEqual(remaining.map(row => [row.serverId, row.reason]), [["20", "Scope 20"]])
    await assert.rejects(t.mutation(internal.afk.setStatus, { serverId: "99", userId: "30", reason: "Rejected" }), status(403))
})

test("Leaving rejects only that server, keeps its data and joining again restores access", async () => {
    const t = await installed("10", "20")
    for (const serverId of ["10", "20"]) await t.mutation(internal.afk.setStatus, { serverId, userId: "30", reason: "Retained" })
    assert.equal((await installation(t, "leave", { serverId: "10" })).status, 200)
    const denied = await post(t, "/afk/observe", { serverId: "10", userId: "30", mentionedUserIds: [] }, "10")
    assert.equal(denied.status, 403)
    assert.equal((await denied.json()).code, "NEONFLUX_SCOPE_DENIED")
    await assert.rejects(t.mutation(internal.afk.setStatus, { serverId: "10", userId: "30", reason: "Rejected" }), status(403))
    assert.equal((await post(t, "/afk/observe", { serverId: "20", userId: "30", mentionedUserIds: [] }, "20")).status, 200)
    assert.deepEqual((await t.run(ctx => ctx.db.query("afkStatuses").collect())).map(row => [row.serverId, row.reason]), [["10", "Retained"]])
    assert.equal((await installation(t, "join", { serverId: "10" })).status, 200)
    assert.equal((await post(t, "/afk/observe", { serverId: "10", userId: "30", mentionedUserIds: [] }, "10")).status, 200)
    assert.deepEqual(await t.run(ctx => ctx.db.query("afkStatuses").collect()), [])
})

test("Owner authority and DEFCON stay independent for the same account and source", async () => {
    const t = await installed("10", "20"), createdAt = Date.now()
    for (const serverId of ["10", "20"]) {
        const operation = { type: "settings", patch: { defcon: serverId === "10" ? 1 : 3 } }
        await t.mutation(internal.moderation.manage, { request: { serverId, messageId: "50", createdAt, actor: actor(serverId), operation } })
    }
    assert.deepEqual((await settings(t)).map(row => [row.serverId, row.config.defcon]).sort(), [["10", 1], ["20", 3]])
    const ordinary = { serverId: "20", messageId: "51", createdAt, actor: actor("20", false), operation: { type: "settings", patch: { defcon: 1 } } }
    await assert.rejects(t.mutation(internal.moderation.manage, { request: ordinary }), status(403))
    assert.equal((await t.run(ctx => ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", "20")).unique()))!.config.defcon, 3)
})

test("Leveling corrections and dirty marks stay with their server for the same account", async tc => {
    const now = Date.parse("2026-01-01T00:00:00Z")
    tc.mock.method(Date, "now", () => now)
    const t = await installed("10", "20"), member = { userId: "30", joinedAt: "2020-01-01T00:00:00Z", roleIds: [], isBot: false, timeoutUntil: null }
    const query = (serverId: string, operation: unknown) => t.query(internal.leveling.query, { request: { serverId, actor: actor(serverId), member, observedAt: now, operation } })
    const work = (serverId: string, operation: unknown) => t.mutation(internal.levelingWork.work, { request: { serverId, operation } })
    const accounts = async (serverId: string) => { const result = await work(serverId, { type: "list" }); assert.equal(result.type, "accounts"); return result.type === "accounts" ? result.accounts : [] }
    for (const serverId of ["10", "20"]) {
        const operation = { type: "adjust", userId: "40", xp: serverId === "10" ? 100 : 200, reason: "Synthetic scoped correction" }
        const result = await t.mutation(internal.leveling.manage, { request: { serverId, messageId: "50", createdAt: now, actor: actor(serverId), operation } })
        assert(!result.duplicate && result.type === "profile")
    }
    const [own, other] = [await accounts("20"), await accounts("10")]
    assert.deepEqual([own.map(row => row.userId), other.map(row => row.userId)], [["40"], ["40"]])
    await work("20", { type: "done", userId: "40", mark: own[0]!.mark, complete: true })
    assert.deepEqual(await accounts("20"), [])
    assert.deepEqual((await accounts("10")).map(row => [row.userId, row.mark]), [["40", other[0]!.mark]])
    for (const [serverId, dirty, xp] of [["10", 1, 100], ["20", 0, 200]] as const) {
        const status = await query(serverId, { type: "status" }), rank = await query(serverId, { type: "rank", userId: "40" })
        assert(status.type === "status" && rank.type === "rank")
        assert.equal(status.dirty, dirty); assert.equal(rank.profile.xp, xp)
    }
})

test("Colliding publishing post numbers cannot claim or finalize a foreign attempt", async tc => {
    const now = Date.parse("2026-01-01T00:00:00Z")
    tc.mock.method(Date, "now", () => now)
    const t = await installed("10", "20")
    const manage = (serverId: string, messageId: string, operation: unknown) => t.mutation(internal.publishing.manage, { request: { serverId, messageId, createdAt: now, actor: actor(serverId), operation } })
    const grants = []
    for (const serverId of ["10", "20"]) {
        const create = await manage(serverId, "100", { type: "draft-create", kind: "draft", name: "same" })
        assert(!create.duplicate && create.type === "draft")
        const update = await manage(serverId, "101", { type: "draft-update", kind: "draft", name: "same", expectedRevision: create.draft.revision, edit: { type: "content", content: `Scope ${serverId}` } })
        assert(!update.duplicate && update.type === "draft")
        const context = { originServerId: serverId, botId: "40", channelId: "60", botAuthorized: true, actorAuthorized: true }
        const send = await manage(serverId, "102", { type: "send", kind: "draft", name: "same", expectedRevision: update.draft.revision, channelId: "60", context })
        assert(!send.duplicate && send.type === "post")
        assert.equal(send.grant.postNo, 1)
        grants.push(send.grant)
    }
    const [own, foreign] = grants
    assert(own && foreign)
    const before = await t.run(ctx => ctx.db.query("publishingAttempts").collect())
    const binding = { serverId: "10", postNo: foreign.postNo, generation: foreign.generation, sourceId: foreign.sourceId, attemptId: foreign.attemptId, claimToken: "a".repeat(32) }
    await assert.rejects(t.mutation(internal.publishing.dispatch, { request: binding }), status(409))
    await assert.rejects(t.mutation(internal.publishing.outcome, { request: { ...binding, outcome: "sent", messageId: "80" } }), status(409))
    assert.deepEqual(await t.run(ctx => ctx.db.query("publishingAttempts").collect()), before)
    await t.mutation(internal.publishing.dispatch, { request: { ...binding, attemptId: own.attemptId } })
    const after = await t.run(ctx => ctx.db.query("publishingAttempts").collect())
    assert.equal(after.find(row => row.serverId === "10")!.dispatchedAt, now)
    assert.equal(after.find(row => row.serverId === "20")!.dispatchedAt, undefined)
})

test("Backup plans stay with the server they were created for", async tc => {
    const now = Date.parse("2026-01-01T00:00:00Z")
    tc.mock.method(Date, "now", () => now)
    const t = await installed("10", "20"), provider = "https://api.example.test"
    const context = (serverId: string) => ({ originServerId: serverId, provider, observedAt: now, ownerId: "30", actorId: "30", actorKind: "human", botId: "40", botKind: "bot",
        ownerJoinedAt: "2020-01-01T00:00:00Z", ownerTimeoutUntil: null, botTimeoutUntil: null, dmChannelId: "90", dmType: 1, recipientIds: ["30"], privateReplyAuthorized: true })
    const manifest = (serverId: string) => ({ version: 1, backupId: "same_backup_id", provider, serverId, selected: ["config"], capturedAt: now,
        observations: { databaseAt: now, structureStartedAt: now, structureFinishedAt: now }, counts: { config: 0, xp: 0, structure: 0, overwrites: 0 },
        exclusions: backupCapabilities().exclusions, config: [], xp: [], structure: [] })
    const source = (serverId: string, messageId = "100") => ({ serverId, messageId, createdAt: now, context: context(serverId) })
    const plans = []
    for (const serverId of ["10", "20"]) {
        const result = await t.mutation(internal.backup.manage, { request: { ...source(serverId), operation: { type: "plan", manifest: manifest(serverId), archiveDigest: "a".repeat(64), native: null } } })
        assert.equal(result.type, "plan")
        if (result.type === "plan") plans.push(result.plan)
    }
    const foreign = plans[0]
    assert(foreign)
    const binding = { planId: foreign.planId, revision: foreign.revision, planHash: foreign.planHash, archiveDigest: foreign.archiveDigest }
    const before = await t.run(ctx => ctx.db.query("backupPlans").collect())
    await assert.rejects(t.query(internal.backup.query, { request: { serverId: "20", context: context("20"), operation: { type: "plan", binding } } }), status(404))
    for (const type of ["confirm", "forget"]) await assert.rejects(t.mutation(internal.backup.manage, { request: { ...source("20", "101"), operation: { type, binding } } }), status(404))
    const crossPlan = { ...source("20", "102"), operation: { type: "plan", manifest: manifest("10"), archiveDigest: "b".repeat(64), native: null } }
    await assert.rejects(t.mutation(internal.backup.manage, { request: crossPlan }), status(403))
    assert.deepEqual(await t.run(ctx => ctx.db.query("backupPlans").collect()), before)
})
