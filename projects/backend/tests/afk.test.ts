import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { internal } from "../convex/_generated/api.js"

const serverId = "10"
const secret = "synthetic-neonflux-test-secret-000000000000"
const originalServerId = process.env.NEONFLUX_SERVER_ID
const originalSecret = process.env.NEONFLUX_BOT_API_SECRET

const modules = {
    "../convex/afk.ts": () => import("../convex/afk.ts"),
    "../convex/http.ts": () => import("../convex/http.ts"),
    "../convex/schema.ts": () => import("../convex/schema.ts"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
}

function backend() {
    return convexTest({ schema, modules, transactionLimits: true })
}

type Backend = ReturnType<typeof backend>

function post(t: Backend, operation: "set" | "observe", body: unknown, authorization = `Bearer ${secret}`) {
    return t.fetch(`/afk/${operation}`, {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    })
}

async function expectJson(response: Response, status: number, body: unknown) {
    assert.equal(response.status, status)
    assert.equal(response.headers.get("Cache-Control"), "no-store")
    assert.deepEqual(await response.json(), body)
}

async function statuses(t: Backend) {
    return t.run((ctx) => ctx.db.query("afkStatuses").collect())
}

beforeEach(() => {
    process.env.NEONFLUX_SERVER_ID = serverId
    process.env.NEONFLUX_BOT_API_SECRET = secret
})

afterEach(() => {
    if (originalServerId === undefined) delete process.env.NEONFLUX_SERVER_ID
    else process.env.NEONFLUX_SERVER_ID = originalServerId
    if (originalSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET
    else process.env.NEONFLUX_BOT_API_SECRET = originalSecret
})

test("Rejects unauthenticated requests before parsing their body", async () => {
    const t = backend()
    for (const operation of ["set", "observe"] as const) {
        for (const authorization of ["", "Bearer wrong-synthetic-secret", secret]) {
            const response = await t.fetch(`/afk/${operation}`, {
                method: "POST", headers: { Authorization: authorization }, body: "not json",
            })
            await expectJson(response, 401, { error: "Unauthorized" })
        }
    }
    assert.deepEqual(await statuses(t), [])
})

test("Rejects missing, short, or invalid deployment configuration without exposing values", async () => {
    const t = backend()
    for (const config of [
        { server: "", secret },
        { server: "01", secret },
        { server: "9223372036854775808", secret },
        { server: serverId, secret: "" },
        { server: serverId, secret: "synthetic-short" },
    ]) {
        process.env.NEONFLUX_SERVER_ID = config.server
        process.env.NEONFLUX_BOT_API_SECRET = config.secret
        for (const operation of ["set", "observe"] as const) {
            await expectJson(await post(t, operation, null), 503, { error: "Backend not configured" })
        }
    }
    assert.deepEqual(await statuses(t), [])
})

test("Rejects malformed, oversized, and non-object JSON bodies", async () => {
    const t = backend()
    for (const operation of ["set", "observe"] as const) {
        for (const body of ["{", "undefined"]) {
            await expectJson(await t.fetch(`/afk/${operation}`, {
                method: "POST", headers: { Authorization: `Bearer ${secret}` }, body,
            }), 400, { error: "Invalid JSON" })
        }
        for (const body of [null, [], "synthetic body", 42, true]) {
            await expectJson(await post(t, operation, body), 400, { error: "Invalid request" })
        }
        await expectJson(await t.fetch(`/afk/${operation}`, {
            method: "POST", headers: { Authorization: `Bearer ${secret}` }, body: "x".repeat(4097),
        }), 413, { error: "Request too large" })
    }
    assert.deepEqual(await statuses(t), [])
})

test("Restricts both operations to the configured server", async () => {
    const t = backend()
    for (const operation of ["set", "observe"] as const) {
        for (const otherServer of [undefined, "11", 10, "010"]) {
            await expectJson(await post(t, operation, {
                serverId: otherServer, userId: "20", reason: "Away", mentionedUserIds: [],
            }), 403, { error: "Server not allowed" })
        }
    }
    assert.deepEqual(await statuses(t), [])
})

test("Accepts only canonical positive signed 64-bit member IDs", async () => {
    const t = backend()
    for (const operation of ["set", "observe"] as const) {
        for (const userId of [undefined, 20, "", "0", "01", "-1", "1.0", " 1", "1 ", "9223372036854775808", "100000000000000000000"]) {
            await expectJson(await post(t, operation, {
                serverId, userId, reason: "Away", mentionedUserIds: [],
            }), 400, { error: "Invalid member ID" })
        }
    }
    const response = await post(t, "set", { serverId, userId: "9223372036854775807", reason: "Away" })
    assert.equal(response.status, 200)
    assert.equal((await statuses(t))[0]?.userId, "9223372036854775807")
})

test("Trims away messages and bounds their stored UTF-16 length", async () => {
    const t = backend()
    for (const reason of [undefined, null, 1, "", " \r\n\t ", "x".repeat(201), "🙂".repeat(101)]) {
        await expectJson(await post(t, "set", { serverId, userId: "20", reason }), 400, {
            error: "Away messages must contain 1 to 200 characters",
        })
    }
    for (const reason of ["x".repeat(200), "🙂".repeat(100)]) {
        const response = await post(t, "set", { serverId, userId: "20", reason: `  ${reason}  ` })
        assert.equal(response.status, 200)
        const stored = await statuses(t)
        assert.equal(stored.length, 1)
        assert.equal(stored[0]?.reason, reason)
    }
})

test("Sets and replaces one active status with a fresh backend timestamp", async (ctx) => {
    let now = 1700000000000
    ctx.mock.method(Date, "now", () => now)
    const t = backend()
    await expectJson(await post(t, "set", { serverId, userId: "20", reason: "  Lunch  " }), 200, {
        userId: "20", reason: "Lunch", since: 1700000000000,
    })
    const first = (await statuses(t))[0]
    now = 1700000001000
    await expectJson(await post(t, "set", { serverId, userId: "20", reason: "Working" }), 200, {
        userId: "20", reason: "Working", since: 1700000001000,
    })
    const current = await statuses(t)
    assert.equal(current.length, 1)
    assert.equal(current[0]?._id, first?._id)
    assert.equal(current[0]?.reason, "Working")
})

test("Clears the sender and returns only unique active mentions in supplied order", async (ctx) => {
    ctx.mock.method(Date, "now", () => 1700000000000)
    const t = backend()
    for (const userId of ["20", "21", "22"]) {
        assert.equal((await post(t, "set", { serverId, userId, reason: `Away ${userId}` })).status, 200)
    }
    await expectJson(await post(t, "observe", {
        serverId, userId: "20", mentionedUserIds: ["22", "20", "21", "22", "23"],
    }), 200, {
        cleared: true,
        statuses: [
            { userId: "22", reason: "Away 22", since: 1700000000000 },
            { userId: "21", reason: "Away 21", since: 1700000000000 },
        ],
    })
    assert.deepEqual((await statuses(t)).map((row) => row.userId).sort(), ["21", "22"])
    await expectJson(await post(t, "observe", { serverId, userId: "20", mentionedUserIds: [] }), 200, {
        cleared: false, statuses: [],
    })
})

test("Invalid mentions leave the sender's active status unchanged", async () => {
    const t = backend()
    assert.equal((await post(t, "set", { serverId, userId: "20", reason: "Away" })).status, 200)
    for (const mentionedUserIds of [undefined, null, "21", [21], ["0"], ["01"], ["9223372036854775808"], ["21", "21", "21", "21", "21", "21"]]) {
        await expectJson(await post(t, "observe", { serverId, userId: "20", mentionedUserIds }), 400, {
            error: "Invalid mentions",
        })
        assert.equal((await statuses(t)).length, 1)
    }
})

test("Observe cannot read or remove another server's rows", async () => {
    const t = backend()
    await t.run(async (ctx) => {
        await ctx.db.insert("afkStatuses", { serverId: "11", userId: "20", reason: "Other sender", since: 1 })
        await ctx.db.insert("afkStatuses", { serverId: "11", userId: "21", reason: "Other mention", since: 1 })
    })
    await expectJson(await post(t, "observe", { serverId, userId: "20", mentionedUserIds: ["21"] }), 200, {
        cleared: false, statuses: [],
    })
    assert.equal((await statuses(t)).length, 2)
    const anotherBackend = backend()
    assert.deepEqual(await statuses(anotherBackend), [])
})

test("Returning deletes the active record without retaining request bodies", async () => {
    const t = backend()
    assert.equal((await post(t, "set", { serverId, userId: "20", reason: "Away", message: "Synthetic extra body" })).status, 200)
    const row = (await statuses(t))[0]
    assert.deepEqual(Object.keys(row ?? {}).sort(), ["_creationTime", "_id", "reason", "serverId", "since", "userId"])
    await expectJson(await post(t, "observe", { serverId, userId: "20", mentionedUserIds: [], message: "Synthetic return body" }), 200, {
        cleared: true, statuses: [],
    })
    assert.deepEqual(await statuses(t), [])
})

test("AFK domain bounds also apply to trusted internal mutation callers", async () => {
    const t = backend()
    for (const request of [
        { serverId, userId: "01", reason: "Away" },
        { serverId, userId: "20", reason: " " },
        { serverId, userId: "20", reason: "x".repeat(201) },
        { serverId: "11", userId: "20", reason: "Away" },
    ]) await assert.rejects(t.mutation(internal.afk.setStatus, request))
    assert.equal((await post(t, "set", { serverId, userId: "20", reason: "Away" })).status, 200)
    for (const mentionedUserIds of [["01"], Array(6).fill("21")]) {
        await assert.rejects(t.mutation(internal.afk.observeMessage, { serverId, userId: "20", mentionedUserIds }))
        assert.equal((await statuses(t)).length, 1)
    }
    const updated = await t.mutation(internal.afk.setStatus, { serverId, userId: "20", reason: "  Lunch  " })
    assert.equal(updated.reason, "Lunch")
})
