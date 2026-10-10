import assert from "node:assert/strict"
import test from "node:test"
import type { SidebarLink, SidebarOperation } from "@neonflux/contracts/sidebar"
import type { DashboardConfigurationJob, DashboardConfigurationReadyJob } from "@neonflux/contracts/dashboard"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { processDashboardConfigurationPass } from "../src/dashboard-configuration.ts"
import { SidebarStoreError, type SidebarStore } from "../src/sidebar-store.ts"
import { mockBackend } from "./backend-fake.ts"

const token = Redacted.make("synthetic-sidebar-test-token"), websiteUrl = "https://dashboard.example.invalid"
const memberId = "6001", adminId = "6003", serverOwnerId = "6009", categoryId = "5002", otherId = "5003"

function memoryStore() {
    let link: SidebarLink | null = null, failNext = false
    const operations: SidebarOperation[] = []
    const store: SidebarStore = {
        get: () => Effect.sync(() => ({ link })),
        manage: input => Effect.suspend(() => {
            operations.push(input.operation)
            if (failNext) { failNext = false; return Effect.fail(new SidebarStoreError({ operation: "manage", status: 409 })) }
            const op = input.operation
            link = op.type === "add" ? { channelId: op.channelId, revision: 1, updatedAt: 0 } : op.type === "remove" ? null : { ...link!, revision: link!.revision + 1 }
            return Effect.succeed({ link })
        }),
    }
    return { store, operations, link: () => link, setLink: (value: SidebarLink | null) => { link = value }, failNext: () => { failNext = true } }
}

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
const segment = (path: string, index: number) => path.split("/")[index]!
function platform(bot: Bot) {
    const f = bot.fixtures, types = new Map<string, number>([[categoryId, 4], [otherId, 0]])
    const botRole = f.role({ position: 20, permissions: Permissions.Administrator.toString() }), adminRole = f.role({ position: 10, permissions: Permissions.Administrator.toString() })
    bot.rest.respond("GET /guilds/:id", { body: f.guild({ owner_id: serverOwnerId }) })
    bot.rest.respond("GET /guilds/:id/roles", { body: [f.role({ id: f.ids.guild, permissions: "0" }), botRole, adminRole] })
    bot.rest.respond("GET /guilds/:id/members/:id", request => {
        const userId = segment(request.path, 4)
        return { body: f.member({ user: userId === f.ids.bot ? f.botUser() : f.user({ id: userId }), roles: userId === f.ids.bot ? [botRole.id] : userId === adminId ? [adminRole.id] : [] }) }
    })
    bot.rest.respond("GET /channels/:id", request => types.has(segment(request.path, 2)) ? { body: f.channel({ id: segment(request.path, 2), type: types.get(segment(request.path, 2))! }) }
        : { status: 404, body: { code: "UNKNOWN_CHANNEL", message: "Unknown Channel" } })
    const create = bot.rest.respond(`POST /guilds/${f.ids.guild}/channels`, request => {
        const id = f.nextId()
        types.set(id, 998)
        return { body: f.channel({ id, type: 998, name: (request.body as { name: string }).name }) }
    })
    const edit = bot.rest.respond("PATCH /channels/:id", request => ({ body: f.channel({ id: segment(request.path, 2), type: 998 }) }))
    const remove = bot.rest.respond("DELETE /channels/:id", request => { types.delete(segment(request.path, 2)); return { status: 204 } })
    const messages = bot.rest.respond("POST /channels/:id/messages", request => ({ body: f.message({ channel_id: segment(request.path, 2), author: f.botUser() }) }))
    return { create, edit, remove, deleted: () => remove.requests().map(request => segment(request.path, 2)), replies: () => messages.requests().map(request => (request.body as { content: string }).content) }
}
const say = (bot: Bot, userId: string, content: string) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content, author: bot.fixtures.user({ id: userId }) }))
function run(website: string | undefined, body: (bot: Bot, native: ReturnType<typeof platform>, memory: ReturnType<typeof memoryStore>) => Effect.Effect<void, unknown>) {
    const f = createFixtures(), memory = memoryStore()
    return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild, ...(website ? { websiteUrl: website } : {}) }, { sidebar: memory.store }))
        const native = platform(bot)
        yield* bot.ready()
        yield* body(bot, native, memory)
    })).pipe(Effect.provide(TestClock.layer())))
}

test("a manager creates a link channel that opens the server's dashboard page, renames it and removes it", async () => {
    await run(websiteUrl, (bot, native, memory) => Effect.gen(function* () {
        const page = `${websiteUrl}/?server=${bot.fixtures.ids.guild}`
        yield* say(bot, memberId, "!sidebar add")
        yield* bot.idle()
        assert.equal(native.create.requests().length, 0)
        yield* say(bot, adminId, `!sidebar add "Dashboard" ${categoryId}`)
        yield* bot.idle()
        assert.deepEqual(native.create.requests()[0]!.body, { type: 998, name: "Dashboard", url: page, parent_id: categoryId })
        const channelId = memory.link()!.channelId
        assert.deepEqual(memory.operations[0], { type: "add", channelId, name: "Dashboard" })
        yield* say(bot, adminId, "!sidebar set Server settings")
        yield* bot.idle()
        assert.deepEqual(native.edit.requests().map(request => [segment(request.path, 2), request.body]), [[channelId, { name: "Server settings", url: page }]])
        yield* say(bot, adminId, "!sidebar remove")
        yield* bot.idle()
        assert.deepEqual(native.deleted(), [channelId])
        assert.equal(memory.link(), null)
        assert.deepEqual(native.replies(), ["Only the server owner or members with Manage Server can manage the dashboard link",
            `Dashboard link <#${channelId}> created. It opens ${page} from the server sidebar`, `Dashboard link <#${channelId}> renamed to Server settings`, "Dashboard link removed"])
    }))
})

test("an add the backend refuses deletes the channel it created, and removal never deletes a channel that is not a link", async () => {
    await run(websiteUrl, (bot, native, memory) => Effect.gen(function* () {
        memory.failNext()
        yield* say(bot, adminId, "!sidebar add")
        yield* bot.idle()
        const created = native.create.requests().length
        assert.equal(created, 1)
        assert.equal(native.deleted().length, 1)
        assert.equal(memory.link(), null)
        // A record that names an ordinary channel forgets it without deleting the channel
        memory.setLink({ channelId: otherId, revision: 1, updatedAt: 0 })
        yield* say(bot, adminId, "!sidebar remove")
        yield* bot.idle()
        assert.equal(native.deleted().length, 1)
        assert.equal(memory.link(), null)
    }))
})

test("without a website address the bot refuses to create a link", async () => {
    await run(undefined, (bot, native) => Effect.gen(function* () {
        yield* say(bot, adminId, "!sidebar add")
        yield* bot.idle()
        assert.equal(native.create.requests().length, 0)
        assert.match(native.replies()[0]!, /NEONFLUX_WEBSITE_URL/)
    }))
})

test("a dashboard add creates the link channel before the backend records it and removes it when the request is not applied", async t => {
    const executions: Record<string, unknown>[] = []
    let outcome: DashboardConfigurationJob["state"] = "conflict"
    const job: DashboardConfigurationReadyJob = { family: "sidebar", operation: { type: "add", name: "Dashboard", categoryId: null }, native: {}, id: "synthetic_sidebar_job", actorId: adminId, expectedConfigRevision: 0, state: "queued", createdAt: 0, expiresAt: 120000 }
    mockBackend(t, (call) => {
        if (call.path === "/dashboard-configuration/ready") return { jobs: [job] }
        assert.equal(call.path, "/dashboard-configuration/execute")
        executions.push(call.body as Record<string, unknown>)
        const { native: _native, ...stored } = job
        return { job: { ...stored, state: outcome } }
    })
    await run(websiteUrl, (bot, native) => Effect.gen(function* () {
        const f = bot.fixtures, config = { token, serverId: f.ids.guild, websiteUrl, backend: { url: "https://synthetic.invalid", secret: Redacted.make("synthetic-backend-secret") } }
        bot.rest.respond("GET /users/@me", { body: f.botUser({ system: false }) })
        bot.rest.respond(`GET /users/${adminId}`, { body: f.user({ id: adminId, bot: false, system: false }) })
        const pass = () => processDashboardConfigurationPass(config, bot.client as unknown as Parameters<typeof processDashboardConfigurationPass>[1])
        yield* pass()
        const first = native.create.requests().length
        assert.equal(first, 1)
        assert.equal(native.deleted().length, 1)
        assert.equal((executions[0]!.context as { channelId: string }).channelId, native.deleted()[0])
        outcome = "applied"
        yield* pass()
        assert.equal(native.create.requests().length, 2)
        assert.equal(native.deleted().length, 1)
    }))
})
