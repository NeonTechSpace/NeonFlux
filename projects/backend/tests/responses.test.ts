import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "node:test"
import type { TestContext } from "node:test"
import { convexTest } from "convex-test"
import type { ResponseDefinition, ResponseEvaluateRequest, ResponseEvaluateResult, ResponseManageResult } from "../contracts.js"
import schema from "../convex/schema.ts"
import { internal } from "../convex/_generated/api.js"
import { CLEANUP_BATCH, RECEIPT_RETENTION } from "../convex/responseDomain.ts"

const serverId = "10"
const secret = "synthetic-response-api-secret-0000000000000"
const originalServer = process.env.NEONFLUX_SERVER_ID
const originalSecret = process.env.NEONFLUX_BOT_API_SECRET
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"),
    "../convex/http.ts": () => import("../convex/http.ts"),
    "../convex/afk.ts": () => import("../convex/afk.ts"),
    "../convex/responses.ts": () => import("../convex/responses.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}

beforeEach(() => {
    process.env.NEONFLUX_SERVER_ID = serverId
    process.env.NEONFLUX_BOT_API_SECRET = secret
})
afterEach(() => {
    if (originalServer === undefined) delete process.env.NEONFLUX_SERVER_ID
    else process.env.NEONFLUX_SERVER_ID = originalServer
    if (originalSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET
    else process.env.NEONFLUX_BOT_API_SECRET = originalSecret
})

function fixture(ctx: TestContext) {
    let now = 1700000000000
    let sequence = 1000
    ctx.mock.method(Date, "now", () => now)
    const t = convexTest({ schema, modules, transactionLimits: true })
    const post = (path: string, body: unknown, authorization = `Bearer ${secret}`) => t.fetch(path, {
        method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify(body),
    })
    const management = (operation: unknown, kind: "custom" | "auto" = "custom", extras: Record<string, unknown> = {}) => ({
        serverId, messageId: String(++sequence), createdAt: now, actorId: "20", adminAuthorized: true, kind, operation, ...extras,
    })
    const event = (content: string, extras: Partial<ResponseEvaluateRequest> = {}): ResponseEvaluateRequest => ({
        serverId, messageId: String(++sequence), createdAt: now, channelId: "30", userId: "20", userName: "Synthetic User", roleIds: [], content, ...extras,
    })
    const manage = async (operation: unknown, kind: "custom" | "auto" = "custom") => read<ResponseManageResult>(await post("/responses/manage", management(operation, kind)))
    const create = async (name: string, kind: "custom" | "auto" = "custom", extras: Record<string, unknown> = {}): Promise<ResponseDefinition> => {
        const result = await manage({ type: "create", name, reply: { type: "text", text: "Reply" }, ...(kind === "auto" ? { trigger: { mode: "exact", text: "Hello" } } : {}), ...extras }, kind)
        assert.ok(!result.duplicate && result.type === "definition")
        return result.definition
    }
    const evaluate = async (content: string, extras: Partial<ResponseEvaluateRequest> = {}) => read<ResponseEvaluateResult>(await post("/responses/evaluate", event(content, extras)))
    return { t, post, management, event, manage, create, evaluate, now: () => now, advance: (ms: number) => { now += ms } }
}

async function read<T>(response: Response): Promise<T> {
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("Cache-Control"), "no-store")
    return await response.json() as T
}

async function error(response: Response, status: number, message: string) {
    assert.equal(response.status, status)
    assert.equal(response.headers.get("Cache-Control"), "no-store")
    assert.deepEqual(await response.json(), { error: message })
}

test("All response routes authenticate before body parsing and hide invalid configuration", async (ctx) => {
    const f = fixture(ctx)
    for (const path of ["/responses/manage", "/responses/evaluate"]) {
        await error(await f.t.fetch(path, { method: "POST", body: "private synthetic malformed body" }), 401, "Unauthorized")
        await error(await f.post(path, null), 400, "Invalid request")
        const denied = await f.post(path, { serverId: "11" })
        assert.equal(denied.status, 403)
        assert.deepEqual(await denied.json(), { error: "Server not allowed" })
    }
    process.env.NEONFLUX_BOT_API_SECRET = "synthetic-short"
    await error(await f.post("/responses/manage", null), 503, "Backend not configured")
})

test("Management requires trusted current admin authority and fresh canonical event identity", async (ctx) => {
    const f = fixture(ctx)
    for (const adminAuthorized of [false, undefined, "true", 1]) {
        await error(await f.post("/responses/manage", f.management({ type: "list" }, "custom", { adminAuthorized })), 403, "Administrator permission required")
    }
    for (const extras of [{ messageId: "01" }, { actorId: "0" }]) {
        await error(await f.post("/responses/manage", f.management({ type: "list" }, "custom", extras)), 400, "Invalid request")
    }
    for (const createdAt of [f.now() - 15 * 60 * 1000 - 1, f.now() + 60001, -1, 1.5]) {
        await error(await f.post("/responses/manage", f.management({ type: "list" }, "custom", { createdAt })), 400, "Invalid source event")
    }
    assert.equal((await f.t.run(c => c.db.query("responseReceipts").collect())).length, 0)
})

test("Create, show, update, list, disable, enable and delete preserve canonical definitions", async (ctx) => {
    const f = fixture(ctx)
    const created = await f.create("  Salute  ")
    assert.deepEqual(created, { kind: "custom", name: "salute", reply: { type: "text", text: "Reply" }, channelIds: [], roleIds: [], cooldownSeconds: 5, priority: 0, enabled: true, createdAt: f.now(), updatedAt: f.now() })
    const embed = { type: "embed", embed: { title: " Hello ", description: "Details for {user.name}", color: 0xffffff } }
    for (const op of [
        { type: "update", name: "salute", field: "response", reply: embed },
        { type: "update", name: "salute", field: "channels", channelIds: ["30", "30", "31"] },
        { type: "update", name: "salute", field: "roles", roleIds: ["40", "40"] },
        { type: "update", name: "salute", field: "cooldown", cooldownSeconds: 3600 },
        { type: "disable", name: "salute" },
    ]) assert.ok(!(await f.manage(op)).duplicate)
    const shown = await f.manage({ type: "show", name: "SALUTE" })
    assert.ok(!shown.duplicate && shown.type === "definition")
    assert.deepEqual(shown.definition.reply, embed)
    assert.deepEqual(shown.definition.channelIds, ["30", "31"])
    assert.deepEqual(shown.definition.roleIds, ["40"])
    assert.equal(shown.definition.enabled, false)
    assert.equal(shown.definition.cooldownSeconds, 3600)
    await f.manage({ type: "enable", name: "salute" })
    const listed = await f.manage({ type: "list" })
    assert.ok(!listed.duplicate && listed.type === "list")
    assert.equal(listed.moduleEnabled, true)
    assert.equal(listed.definitions[0]?.enabled, true)
    assert.deepEqual(await f.manage({ type: "delete", name: "salute" }), { duplicate: false, type: "deleted", kind: "custom", name: "salute" })
    await error(await f.post("/responses/manage", f.management({ type: "show", name: "salute" })), 404, "Definition not found")
})

test("Listing is sorted and paged and names are unique per kind with a combined definition limit", async (ctx) => {
    const f = fixture(ctx)
    for (let i = 11; i >= 1; i--) await f.create(`rule${String(i).padStart(3, "0")}`)
    const page = await f.manage({ type: "list", page: 2 })
    assert.ok(!page.duplicate && page.type === "list")
    assert.equal(page.total, 11)
    assert.equal(page.totalPages, 2)
    assert.equal(page.definitions[0]?.name, "rule011")
    await error(await f.post("/responses/manage", f.management({ type: "list", page: 3 })), 400, "Invalid request")
    await error(await f.post("/responses/manage", f.management({ type: "create", name: "RULE001", reply: { type: "text", text: "Second" } })), 409, "Definition already exists")
    await f.create("rule001", "auto")
    for (let i = 12; i <= 99; i++) await f.create(`rule${String(i).padStart(3, "0")}`)
    await error(await f.post("/responses/manage", f.management({ type: "create", name: "overflow", reply: { type: "text", text: "Reply" } })), 429, "Definition limit reached")
})

test("Domain validation rejects reserved names, scripts, unknown templates and oversized values", async (ctx) => {
    const f = fixture(ctx)
    for (const name of ["ping", "afk", "custom", "auto", "welcome", "goodbye", "ticket", "With Space", "x".repeat(33), "-bad"]) {
        await error(await f.post("/responses/manage", f.management({ type: "create", name, reply: { type: "text", text: "Reply" } })), 400, "Invalid definition")
    }
    for (const reply of [
        { type: "text", text: " " }, { type: "text", text: "x".repeat(2001) }, { type: "text", text: "{unknown}" },
        { type: "script", text: "Synthetic script" },
        { type: "embed", embed: { title: "x".repeat(257), description: "Description" } },
        { type: "embed", embed: { title: "", description: "x".repeat(4001) } },
        { type: "embed", embed: { title: "", description: " " } },
        { type: "embed", embed: { title: "", description: "Description", color: -1 } },
        { type: "embed", embed: { title: "", description: "Description", color: 0x1000000 } },
    ]) await error(await f.post("/responses/manage", f.management({ type: "create", name: "valid", reply })), 400, "Invalid definition")
    await f.create("valid")
    for (const operation of [
        { type: "update", name: "valid", field: "channels", channelIds: Array(21).fill("30") },
        { type: "update", name: "valid", field: "roles", roleIds: ["01"] },
        { type: "update", name: "valid", field: "cooldown", cooldownSeconds: 3601 },
        { type: "update", name: "valid", field: "cooldown", cooldownSeconds: 0.5 },
        { type: "update", name: "valid", field: "priority", priority: 1 },
    ]) await error(await f.post("/responses/manage", f.management(operation)), 400, "Invalid definition")
    for (const trigger of [{ mode: "regex", text: "Hello" }, { mode: "exact", text: " " }, { mode: "contains", text: "x".repeat(201) }]) {
        await error(await f.post("/responses/manage", f.management({ type: "create", name: "automatic", reply: { type: "text", text: "Reply" }, trigger }, "auto")), 400, "Invalid definition")
    }
    assert.equal((await f.t.run(c => c.db.query("responseDefinitions").collect())).length, 1)
})

test("Validators remain authoritative when called through internal mutation entry points", async (ctx) => {
    const f = fixture(ctx)
    await assert.rejects(f.t.mutation(internal.responses.manage, { request: f.management({ type: "create", name: "bad", reply: { type: "text", text: "{secret}" } }) }))
    await assert.rejects(f.t.mutation(internal.responses.manage, { request: f.management({ type: "list" }, "custom", { adminAuthorized: false }) }))
    assert.deepEqual(await f.t.run(c => c.db.query("responseDefinitions").collect()), [])
})

test("Custom commands match a whole first token and render only supported templates once", async (ctx) => {
    const f = fixture(ctx)
    await f.create("greet", "custom", { reply: { type: "text", text: "{user.name}|{user.id}|{user.mention}|{channel.id}|{server.id}|{args}" } })
    assert.deepEqual(await f.evaluate("!greeting"), { send: false })
    const reply = await f.evaluate("  !GREET   arbitrary {user.id} <@999>  ", { userName: "Name {server.id}" })
    assert.ok(reply.send)
    assert.equal(reply.ruleName, "greet")
    assert.deepEqual(reply.reply, { type: "text", text: "Name {server.id}|20|<@20>|30|10|arbitrary {user.id} <@999>" })
})

test("Automatic ordering uses priority, exact mode, then stable name and excludes every prefix message", async (ctx) => {
    const f = fixture(ctx)
    await f.create("zexact", "auto")
    await f.create("contains", "auto", { trigger: { mode: "contains", text: "  hello  " } })
    await f.create("aexact", "auto")
    const first = await f.evaluate(" HELLO ")
    assert.ok(first.send)
    assert.equal(first.ruleName, "aexact")
    await f.manage({ type: "update", name: "contains", field: "priority", priority: 100 }, "auto")
    const second = await f.evaluate("Hello", { userId: "21" })
    assert.ok(second.send)
    assert.equal(second.ruleName, "contains")
    for (const content of ["!unknown Hello", " !unknown Hello", "!", "\n!ping Hello"]) assert.deepEqual(await f.evaluate(content), { send: false })
    await f.manage({ type: "update", name: "contains", field: "trigger", trigger: { mode: "exact", text: "Changed" } }, "auto")
    await f.manage({ type: "disable", name: "zexact" }, "auto")
    await f.manage({ type: "disable", name: "aexact" }, "auto")
    assert.deepEqual(await f.evaluate("Hello", { userId: "22" }), { send: false })
    const changed = await f.evaluate("changed", { userId: "22" })
    assert.ok(changed.send)
    assert.equal(changed.ruleName, "contains")
})

test("Channel and any-role scopes apply together in the backend", async (ctx) => {
    const f = fixture(ctx)
    await f.create("scoped")
    await f.manage({ type: "update", name: "scoped", field: "channels", channelIds: ["30"] })
    await f.manage({ type: "update", name: "scoped", field: "roles", roleIds: ["40", "41"] })
    assert.deepEqual(await f.evaluate("!scoped", { channelId: "31", roleIds: ["40"] }), { send: false })
    assert.deepEqual(await f.evaluate("!scoped", { roleIds: [] }), { send: false })
    assert.deepEqual(await f.evaluate("!scoped", { roleIds: ["42"] }), { send: false })
    assert.equal((await f.evaluate("!scoped", { roleIds: ["41"] })).send, true)
    await f.manage({ type: "update", name: "scoped", field: "channels", channelIds: [] })
    await f.manage({ type: "update", name: "scoped", field: "roles", roleIds: [] })
    assert.equal((await f.evaluate("!scoped", { channelId: "99", userId: "22" })).send, true)
})

test("Both module switches preserve definitions and management remains available while off", async (ctx) => {
    const f = fixture(ctx)
    await f.create("customrule")
    await f.create("automatic", "auto")
    for (const kind of ["custom", "auto"] as const) await f.manage({ type: "module", enabled: false }, kind)
    assert.deepEqual(await f.evaluate("!customrule"), { send: false })
    assert.deepEqual(await f.evaluate("Hello"), { send: false })
    const result = await f.manage({ type: "list" })
    assert.ok(!result.duplicate && result.type === "list")
    assert.equal(result.total, 1)
    assert.equal(result.moduleEnabled, false)
    await f.manage({ type: "update", name: "customrule", field: "response", reply: { type: "text", text: "Changed while off" } })
    await f.manage({ type: "module", enabled: true })
    const response = await f.evaluate("!customrule")
    assert.ok(response.send)
    assert.deepEqual(response.reply, { type: "text", text: "Changed while off" })
})

test("Rendered bounds are checked after substitutions for text and embed fields", async (ctx) => {
    const f = fixture(ctx)
    await f.create("args", "custom", { reply: { type: "text", text: "{args}" } })
    await error(await f.post("/responses/evaluate", f.event(`!args ${"x".repeat(2001)}`)), 400, "Rendered response exceeds limits")
    await f.create("embed", "auto", { reply: { type: "embed", embed: { title: "{user.name}{user.name}", description: "{args}Description", color: 1 } } })
    await error(await f.post("/responses/evaluate", f.event("Hello", { userName: "n".repeat(200) })), 400, "Rendered response exceeds limits")
    await f.manage({ type: "update", name: "embed", field: "response", reply: { type: "embed", embed: { title: "{user.name}", description: "{args}Description", color: 1 } } }, "auto")
    const rendered = await f.evaluate("hello")
    assert.ok(rendered.send)
    assert.deepEqual(rendered.reply, { type: "embed", embed: { title: "Synthetic User", description: "Description", color: 1 } })
})

test("Stored and rendered required fields must remain nonempty after SDK field normalization", async (ctx) => {
    const f = fixture(ctx)
    for (const reply of [
        { type: "text", text: " \u000c\u202e " },
        { type: "embed", embed: { title: "Title", description: "\u202e" } },
    ]) await error(await f.post("/responses/manage", f.management({ type: "create", name: "normalized", reply })), 400, "Invalid definition")
    await f.create("normalized", "custom", { reply: { type: "text", text: "{user.name}" } })
    await error(await f.post("/responses/manage", f.management({ type: "update", name: "normalized", field: "response", reply: { type: "text", text: "\u202e" } })), 400, "Invalid definition")
    await error(await f.post("/responses/evaluate", f.event("!normalized", { userName: "\u202e" })), 400, "Rendered response exceeds limits")
    await f.manage({ type: "update", name: "normalized", field: "response", reply: { type: "embed", embed: { title: "", description: "{user.name}" } } })
    await error(await f.post("/responses/evaluate", f.event("!normalized", { userName: "\u202e" })), 400, "Rendered response exceeds limits")
    for (const mode of ["exact", "contains"]) {
        await error(await f.post("/responses/manage", f.management({ type: "create", name: "trigger-normalized", trigger: { mode, text: " \u000c\u202e " }, reply: { type: "text", text: "Reply" } }, "auto")), 400, "Invalid definition")
    }
    await f.create("trigger-normalized", "auto")
    await error(await f.post("/responses/manage", f.management({ type: "update", name: "trigger-normalized", field: "trigger", trigger: { mode: "exact", text: "\u202e" } }, "auto")), 400, "Invalid definition")
})

test("Immutable event receipts prevent lost-response retries and concurrent duplicate evaluations", async (ctx) => {
    const f = fixture(ctx)
    await f.create("once")
    await f.manage({ type: "update", name: "once", field: "cooldown", cooldownSeconds: 0 })
    const event = f.event("!once")
    const results = await Promise.all([f.post("/responses/evaluate", event), f.post("/responses/evaluate", event)])
    const values = await Promise.all(results.map(r => read<ResponseEvaluateResult>(r)))
    assert.equal(values.filter(v => v.send).length, 1)
    assert.deepEqual(await read(await f.post("/responses/evaluate", event)), { send: false })
    const receipts = await f.t.run(c => c.db.query("responseReceipts").collect())
    assert.equal(receipts.filter(r => r.messageId === event.messageId).length, 1)
    assert.ok(receipts.every(r => !Object.keys(r).some(k => ["content", "userName", "roleIds", "reply"].includes(k))))
})

test("Management replay stays duplicate after delete and recreate and after a module switch", async (ctx) => {
    const f = fixture(ctx)
    const create = f.management({ type: "create", name: "original", reply: { type: "text", text: "Original" } })
    assert.equal((await read<ResponseManageResult>(await f.post("/responses/manage", create))).duplicate, false)
    await f.manage({ type: "delete", name: "original" })
    await f.create("original", "custom", { reply: { type: "text", text: "Replacement" } })
    assert.deepEqual(await read(await f.post("/responses/manage", create)), { duplicate: true })
    const module = f.management({ type: "module", enabled: false })
    await f.post("/responses/manage", module)
    await f.manage({ type: "module", enabled: true })
    assert.deepEqual(await read(await f.post("/responses/manage", module)), { duplicate: true })
    const shown = await f.manage({ type: "show", name: "original" })
    assert.ok(!shown.duplicate && shown.type === "definition")
    assert.deepEqual(shown.definition.reply, { type: "text", text: "Replacement" })
})

test("Cooldown is per definition and user across channels", async (ctx) => {
    const f = fixture(ctx)
    await f.create("cool")
    const event = f.event("!cool")
    assert.equal((await read<ResponseEvaluateResult>(await f.post("/responses/evaluate", event))).send, true)
    assert.deepEqual(await f.evaluate("!cool", { channelId: "31" }), { send: false })
    assert.equal((await f.evaluate("!cool", { channelId: "31", userId: "21" })).send, true)
    f.advance(4999)
    assert.deepEqual(await f.evaluate("!cool"), { send: false })
    f.advance(1)
    assert.equal((await f.evaluate("!cool")).send, true)
    assert.deepEqual(await read(await f.post("/responses/evaluate", event)), { send: false })
})

test("Delete preserves receipts and AFK records and old cooldowns do not bind a recreated definition", async (ctx) => {
    const f = fixture(ctx)
    await f.create("delete")
    const event = f.event("!delete")
    assert.equal((await read<ResponseEvaluateResult>(await f.post("/responses/evaluate", event))).send, true)
    await f.t.run(c => c.db.insert("afkStatuses", { serverId, userId: "20", reason: "Synthetic AFK", since: f.now() }))
    await f.manage({ type: "delete", name: "delete" })
    await f.create("delete")
    assert.deepEqual(await read(await f.post("/responses/evaluate", event)), { send: false })
    assert.equal((await f.evaluate("!delete")).send, true)
    assert.equal((await f.t.run(c => c.db.query("afkStatuses").collect())).length, 1)
})

test("Cleanup expires receipts and cooldowns in bounded batches", async (ctx) => {
    const f = fixture(ctx)
    await f.create("expiry")
    const event = f.event("!expiry")
    assert.equal((await read<ResponseEvaluateResult>(await f.post("/responses/evaluate", event))).send, true)
    f.advance(5000)
    const first = await f.t.mutation(internal.responses.cleanup, {})
    assert.deepEqual(first, { receiptsDeleted: 0, cooldownsDeleted: 1 })
    f.advance(RECEIPT_RETENTION)
    const second = await f.t.mutation(internal.responses.cleanup, {})
    assert.deepEqual(second, { receiptsDeleted: 2, cooldownsDeleted: 0 })
    await error(await f.post("/responses/evaluate", event), 400, "Invalid source event")
    await f.t.run(async c => {
        for (let i = 0; i <= CLEANUP_BATCH; i++) await c.db.insert("responseReceipts", { serverId, messageId: String(5000 + i), expiresAt: 2 })
    })
    const scheduled: (() => void)[] = []
    const originalSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((callback: () => void) => {
        scheduled.push(callback)
        return {}
    }) as unknown as typeof setTimeout
    ctx.after(() => { globalThis.setTimeout = originalSetTimeout })
    assert.equal((await f.t.mutation(internal.responses.cleanup, {})).receiptsDeleted, CLEANUP_BATCH)
    assert.equal(scheduled.length, 1)
    scheduled.shift()!()
    await f.t.finishInProgressScheduledFunctions()
    assert.equal((await f.t.run(c => c.db.query("responseReceipts").collect())).length, 0)
})

test("No-match and module-off receipts prevent configuration changes from resurrecting an event", async (ctx) => {
    const f = fixture(ctx)
    const noMatch = f.event("!future")
    assert.deepEqual(await read(await f.post("/responses/evaluate", noMatch)), { send: false })
    await f.create("future")
    assert.deepEqual(await read(await f.post("/responses/evaluate", noMatch)), { send: false })
    await f.manage({ type: "module", enabled: false })
    const disabled = f.event("!future")
    assert.deepEqual(await read(await f.post("/responses/evaluate", disabled)), { send: false })
    await f.manage({ type: "module", enabled: true })
    assert.deepEqual(await read(await f.post("/responses/evaluate", disabled)), { send: false })
    assert.equal((await f.evaluate("!future")).send, true)
})
