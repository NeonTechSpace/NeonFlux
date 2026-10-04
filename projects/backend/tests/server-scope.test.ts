import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, test } from "node:test"
import { ConvexError } from "convex/values"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { internal } from "../convex/_generated/api.js"
import { backendRoutes } from "../../bot/src/backend-routes.ts"
import { botCall } from "./bot-service.ts"
import { requireOrigin } from "../convex/serverScope.ts"
import { parseServerScope } from "@neonflux/contracts/service"

const secret = "synthetic-server-scope-backend-secret-000000000"
const keys = ["NEONFLUX_SERVER_ID", "NEONFLUX_BOT_API_SECRET"] as const
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
beforeEach(() => {
    for (const key of keys) delete process.env[key]
    process.env.NEONFLUX_BOT_API_SECRET = secret
})
afterEach(() => {
    for (const key of keys) {
        if (original[key] === undefined) delete process.env[key]
        else process.env[key] = original[key]
    }
})
const configureServer = (serverId: string) => {
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
    "../convex/schema.ts": () => import("../convex/schema.ts"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
}
const backend = () => convexTest({ schema, modules, transactionLimits: true })
type Backend = ReturnType<typeof backend>
function post(t: Backend, path: string, body: unknown, serverId?: string, keySecret?: string) {
    return botCall(t, path, body, { serverId, ...(keySecret === undefined ? {} : { secret: keySecret }) })
}
const actor = (serverId: string, owner = true) => ({
    originServerId: serverId,
    userId: "30",
    roleIds: [],
    isOwner: owner,
    isAdministrator: false,
    nativePermissionAuthorized: true,
})
function status(expected: number) {
    return (error: unknown) =>
        error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data !== null &&
        "status" in error.data &&
        error.data.status === expected
}
const settings = (t: Backend) => t.run((ctx) => ctx.db.query("moderationSettings").collect())

test("Scope parser trims a single server", () => {
    assert.deepEqual(parseServerScope({ NEONFLUX_SERVER_ID: " 10 " }), { serverIds: ["10"] })
})

test("Scope parser rejects malformed inputs without echoing them", () => {
    const invalid = [{}, { NEONFLUX_SERVER_ID: "" }, { NEONFLUX_SERVER_ID: "synthetic-server" }]
    for (const env of invalid) {
        assert.throws(
            () => parseServerScope(env),
            (error) => error instanceof Error && !error.message.includes("synthetic-server"),
        )
    }
    for (const id of ["", "01", "0", "-1", "1.0", "1e3", "9223372036854775808"])
        assert.throws(() => parseServerScope({ NEONFLUX_SERVER_ID: id }))
})

test("Authenticated scope discovery names the single server", async () => {
    configureServer("10")
    const t = backend()
    assert.equal((await botCall(t, "/service/scope", {}, { secret: null })).status, 401)
    const response = await botCall(t, "/service/scope", {})
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { serverIds: ["10"] })
})

test("Invalid scope settings answer 503 and log the variable to fix without its value", async (tc) => {
    const t = backend(),
        logged: string[] = []
    tc.mock.method(console, "error", (message: unknown) => {
        logged.push(String(message))
    })
    for (const [name, value] of [["NEONFLUX_SERVER_ID", "synthetic-private-server"]] as const) {
        process.env[name] = value
        const response = await botCall(t, "/service/scope", {})
        assert.equal(response.status, 503)
        assert.deepEqual(await response.json(), { error: "Backend not configured" })
        assert.match(logged.at(-1)!, new RegExp(name))
        assert.ok(!logged.at(-1)!.includes(value))
        delete process.env[name]
    }
})

const everyModule = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")],
    ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const tableCounts = (t: Backend) =>
    t.run(async (ctx) => {
        const counts: Record<string, number> = {}
        for (const table of Object.keys(schema.tables) as (keyof typeof schema.tables)[])
            counts[table] = (await ctx.db.query(table).collect()).length
        return counts
    })

test("Every bot route rejects other servers before domain work", async () => {
    configureServer("10")
    const t = convexTest({ schema, modules: everyModule, transactionLimits: true })
    const routes = Object.keys(backendRoutes).filter((path) => !path.startsWith("/service/"))
    assert.ok(routes.length > 43)
    const rejectAll = async (serverId: string) => {
        const before = await tableCounts(t)
        for (const path of routes) {
            const response = await post(
                t,
                path,
                { serverId, userId: "40", reason: "Away", mentionedUserIds: [] },
                serverId,
            )
            assert.equal(response.status, 403, path)
            assert.deepEqual(
                await response.json(),
                { error: "Server not allowed", code: "NEONFLUX_SCOPE_DENIED" },
                path,
            )
        }
        assert.deepEqual(await tableCounts(t), before)
    }
    await rejectAll("30")
})

test("Every feature family rejects absent, foreign and mismatched server bindings before domain work", async () => {
    configureServer("10")
    const t = backend()
    const paths = [
        "/afk/set",
        "/responses/manage",
        "/moderation/manage",
        "/appeals/member",
        "/publishing/manage",
        "/roles/manage",
        "/greetings/manage",
        "/schedules/manage",
    ]
    for (const path of paths) {
        for (const selected of [undefined, "99", "01", "20"]) {
            const result = await post(t, path, { serverId: "20" }, selected)
            assert.equal(result.status, 403, path)
            assert.deepEqual(await result.json(), { error: "Server not allowed", code: "NEONFLUX_SCOPE_DENIED" })
        }
        assert.equal((await post(t, path, null, "99", "synthetic-wrong-secret-00000000000000000")).status, 401)
    }
    assert.deepEqual(await settings(t), [])
})

test("An omitted header still binds the body server", async () => {
    configureServer("10")
    const t = backend()
    assert.equal((await post(t, "/afk/set", { serverId: "10", userId: "30", reason: "Single" })).status, 200)
    const wrong = await post(t, "/afk/set", { serverId: "20", userId: "30", reason: "Rejected" })
    assert.deepEqual(await wrong.json(), { error: "Server not allowed", code: "NEONFLUX_SCOPE_DENIED" })
    assert.equal((await post(t, "/afk/set", { serverId: "20" }, "20")).status, 403)
})

test("Admin evidence read from another server cannot authorize this one", async () => {
    configureServer("20")
    const t = backend(),
        createdAt = Date.now()
    const request = (messageId: string, who: object) => ({
        serverId: "20",
        messageId,
        createdAt,
        actor: who,
        operation: { type: "settings", patch: { defcon: 1 } },
    })
    const foreign = await post(t, "/moderation/manage", request("50", actor("10")), "20")
    assert.equal(foreign.status, 403)
    assert.deepEqual(await foreign.json(), { error: "Native evidence server mismatch" })
    assert.deepEqual(await settings(t), [])
    assert.equal((await post(t, "/moderation/manage", request("52", actor("20")), "20")).status, 200)
    assert.deepEqual(
        (await settings(t)).map((row) => [row.serverId, row.config.defcon]),
        [["20", 1]],
    )
})

test("Foreign origins anywhere in the request reject before state changes", async () => {
    configureServer("20")
    const t = backend(),
        observedAt = Date.now(),
        joinedAt = "2020-01-01T00:00:00Z"
    for (const evidence of [
        { originServerId: "10", channelId: "60" },
        { originServerId: "10", userId: "30" },
        [{ originServerId: "10", roleId: "70" }],
        { nested: { originServerId: "10" } },
        { nested: { memberOriginServerId: "10" } },
    ]) {
        const response = await post(t, "/responses/manage", { serverId: "20", operation: { evidence } }, "20")
        assert.equal(response.status, 403)
        assert.deepEqual(await response.json(), { error: "Native evidence server mismatch" })
    }
    const absence = { type: "absent", userId: "30", expectedGeneration: 1, joinedAt, observedAt, memberAbsent: true }
    assert.equal(
        (await post(t, "/greetings/observe", { serverId: "20", operation: { ...absence, originServerId: "10" } }, "20"))
            .status,
        403,
    )
    assert.deepEqual(await t.run((ctx) => ctx.db.query("greetingMembers").collect()), [])
    const accepted = await post(
        t,
        "/greetings/observe",
        { serverId: "20", operation: { ...absence, originServerId: "20" } },
        "20",
    )
    assert.equal(accepted.status, 200)
    assert.deepEqual(await accepted.json(), { recorded: false, member: null, admitted: 0 })
})

test("Bot automation authority read from another server rejects", () => {
    const context = { observedAt: 1, channelId: "40", botId: "50", botAuthorized: true }
    assert.throws(
        () => requireOrigin({ serverId: "20", context: { ...context, originServerId: "10" } }, "20"),
        status(403),
    )
    assert.doesNotThrow(() => requireOrigin({ serverId: "20", context: { ...context, originServerId: "20" } }, "20"))
})

test("Greeting membership proof binds its read server", async () => {
    configureServer("20")
    const t = backend(),
        now = Date.now()
    const request = {
        serverId: "20",
        deliveryId: "synthetic-delivery",
        route: "goodbye",
        routeRevision: 1,
        userId: "30",
        joinedAt: "2020-01-01T00:00:00Z",
        memberGeneration: 1,
    }
    const context = {
        originServerId: "20",
        botId: "40",
        botAuthorized: true,
        observedAt: now,
        member: null,
        memberAbsent: true,
        memberOriginServerId: "20",
        memberUserId: "30",
        channelId: "60",
    }
    assert.equal(
        (await post(t, "/greetings/reserve", { ...request, context: { ...context, memberOriginServerId: "10" } }, "20"))
            .status,
        403,
    )
    assert.equal((await post(t, "/greetings/reserve", { ...request, context }, "20")).status, 404)
})

test("Internal guards allow only the configured server", async () => {
    configureServer("10")
    const t = backend()
    await assert.rejects(
        t.mutation(internal.afk.setStatus, { request: { serverId: "99", userId: "30", reason: "Rejected" } }),
        status(403),
    )
})
