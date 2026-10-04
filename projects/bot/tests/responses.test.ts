import assert from "node:assert/strict"
import test from "node:test"
import type { ResponseDefinition, ResponseManageRequest } from "@neonflux/backend/contracts"
import { Permissions, MessageType } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Redacted } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { ResponseStoreError, type ResponseStore } from "../src/responses-store.ts"

const token = Redacted.make("synthetic-neonflux-test-token")

function managementStore() {
    const definitions = new Map<string, ResponseDefinition>()
    const calls: ResponseManageRequest[] = []
    const modules = { custom: true, auto: true }
    const store: ResponseStore = {
        manage: (request) => Effect.gen(function* () {
            calls.push(request)
            const { kind, operation } = request
            const key = "name" in operation ? `${kind}:${operation.name}` : ""
            if (operation.type === "module") {
                modules[kind] = operation.enabled
                return { duplicate: false, type: "module", kind, enabled: operation.enabled }
            }
            if (operation.type === "list") {
                const items = [...definitions.values()].filter((definition) => definition.kind === kind)
                return { duplicate: false, type: "list", kind, page: operation.page ?? 1, totalPages: 1, total: items.length, moduleEnabled: modules[kind], definitions: items }
            }
            if (operation.type === "create") {
                if (definitions.has(key)) return yield* Effect.fail(new ResponseStoreError({ operation: "manage", status: 409 }))
                const definition: ResponseDefinition = {
                    kind, name: operation.name, reply: operation.reply,
                    ...("trigger" in operation ? { trigger: operation.trigger } : {}),
                    channelIds: [], roleIds: [], cooldownSeconds: 5, priority: 0, enabled: true, createdAt: 1, updatedAt: 1,
                }
                definitions.set(key, definition)
            }
            const definition = definitions.get(key)
            if (!definition) return yield* Effect.fail(new ResponseStoreError({ operation: "manage", status: 404 }))
            if (operation.type === "delete") { definitions.delete(key); return { duplicate: false, type: "deleted", kind, name: operation.name } }
            if (operation.type === "enable" || operation.type === "disable") definition.enabled = operation.type === "enable"
            if (operation.type === "update") {
                switch (operation.field) {
                    case "response": definition.reply = operation.reply; break
                    case "channels": definition.channelIds = operation.channelIds; break
                    case "roles": definition.roleIds = operation.roleIds; break
                    case "cooldown": definition.cooldownSeconds = operation.cooldownSeconds; break
                    case "trigger": definition.trigger = operation.trigger; break
                    case "priority": definition.priority = operation.priority; break
                }
            }
            return { duplicate: false, type: "definition", definition: { ...definition } }
        }),
        evaluate: () => Effect.succeed({ send: false }),
    }
    return { store, definitions, calls, modules }
}

function platformFixtures(bot: Effect.Success<ReturnType<typeof createTestBot>>, admin = "owner") {
    const { fixtures } = bot
    const role = fixtures.role({ permissions: admin === "administrator" ? Permissions.Administrator.toString() : "0" })
    const guild = fixtures.guild({ owner_id: admin === "owner" ? fixtures.ids.user : fixtures.nextId() })
    const member = fixtures.member({ roles: [role.id] })
    const guildRoute = bot.rest.respond("GET /guilds/:id", { body: guild })
    const memberRoute = bot.rest.respond("GET /guilds/:id/members/:id", { body: member })
    const rolesRoute = bot.rest.respond("GET /guilds/:id/roles", {
        body: [fixtures.role({ id: fixtures.ids.guild, permissions: "0" }), role],
    })
    bot.rest.respond("GET /channels/:id", { body: fixtures.channel() })
    const replies = bot.rest.respond("POST /channels/:id/messages", { body: fixtures.message() })
    return { role, guildRoute, memberRoute, rolesRoute, replies }
}

test("owner management uses native quoted grammar for full CRUD, embeds, scopes, paging and module toggles", async () => {
    const fixtures = createFixtures()
    const boundary = managementStore()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }, { responses: boundary.store }))
        const platform = platformFixtures(bot)
        yield* bot.ready()
        const commands = [
            '!custom create Rules text "Read {channel.id}"',
            '!custom update rules response embed "Server rules" "Read the rules" "#3d66b8"',
            `!custom update rules channels <#${bot.fixtures.ids.channel}>`,
            `!custom update rules roles <@&${platform.role.id}>`,
            "!custom update rules cooldown 30", "!custom disable rules", "!custom show rules", "!custom enable rules",
            "!custom module off", "!custom show rules", "!custom list 1", "!custom module on", "!custom delete rules",
            '!auto create greeting exact "hello there" text "Welcome {user.mention}"',
            '!auto update greeting trigger contains "hello"', "!auto update greeting priority 10",
            "!auto update greeting channels all", "!auto update greeting roles all", "!auto update greeting cooldown 0",
            '!auto update greeting response text "Hi"', "!auto disable greeting", "!auto enable greeting",
            "!auto show greeting", "!auto list", "!auto module off", "!auto module on", "!auto delete greeting",
        ]
        for (const content of commands) {
            const incoming = bot.fixtures.message({ content })
            yield* bot.emit("MESSAGE_CREATE", incoming)
            yield* bot.idle()
            assert.equal(boundary.calls.at(-1)?.createdAt, Date.parse(incoming.timestamp!))
            assert.equal(boundary.calls.at(-1)?.adminAuthorized, true)
            assert.equal(boundary.calls.at(-1)?.actorId, bot.fixtures.ids.user)
        }
        assert.equal(boundary.definitions.size, 0)
        assert.equal(platform.guildRoute.requests().length, commands.length)
        assert.equal(platform.memberRoute.requests().length, commands.length)
        assert.equal(platform.rolesRoute.requests().length, commands.length)
        assert.equal(platform.replies.requests().length, commands.length)
        for (const request of platform.replies.requests()) {
            const body = request.body as { content: string, allowed_mentions: unknown }
            assert.ok(body.content.length <= 2000)
            assert.ok(!body.content.startsWith("{"))
            assert.deepEqual(body.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        }
        assert.equal(bot.failures().length, 0)
    })))
})

test("current Administrator authorizes management and a fresh downgrade immediately denies it", async () => {
    const fixtures = createFixtures()
    const boundary = managementStore()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }, { responses: boundary.store }))
        const platform = platformFixtures(bot, "administrator")
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: '!custom create rules text "Read rules"' }))
        yield* bot.idle()
        assert.equal(boundary.calls.length, 1)
        platform.rolesRoute.remove()
        bot.rest.respond("GET /guilds/:id/roles", { body: [bot.fixtures.role({ id: fixtures.ids.guild, permissions: "0" }), { ...platform.role, permissions: "0" }] })
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!custom delete rules" }))
        yield* bot.idle()
        assert.equal(boundary.calls.length, 1)
        assert.ok(boundary.definitions.has("custom:rules"))
        assert.match((platform.replies.requests().at(-1)!.body as { content: string }).content, /owner or an administrator/)
        assert.equal(bot.failures().length, 0)
    })))
})

test("permission lookup failures, missing roles and cross-server scopes fail closed", async () => {
    const fixtures = createFixtures()
    const boundary = managementStore()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }, { responses: boundary.store }))
        const platform = platformFixtures(bot)
        const denied = bot.rest.respond("GET /guilds/:id", { status: 403, body: { code: "MISSING_PERMISSIONS", message: "Denied" } })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!custom list" }))
        yield* bot.idle()
        assert.equal(boundary.calls.length, 0)
        assert.match((platform.replies.requests().at(-1)!.body as { content: string }).content, /couldn't verify/)
        denied.remove()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!custom update rules roles <@&${bot.fixtures.nextId()}>` }))
        yield* bot.idle()
        bot.rest.respond("GET /channels/:id", { body: bot.fixtures.channel({ guild_id: bot.fixtures.nextId() }) })
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!custom update rules channels <#${bot.fixtures.ids.channel}>` }))
        yield* bot.idle()
        assert.equal(boundary.calls.length, 0)
        assert.match((platform.replies.requests().at(-1)!.body as { content: string }).content, /channel must exist in this server/)
        assert.equal(bot.failures().length, 0)
    })))
})

test("reserved names, duplicate definitions, malformed quoting, unknown updates and help never evaluate responses", async () => {
    const fixtures = createFixtures()
    const boundary = managementStore()
    let evaluations = 0
    const store: ResponseStore = { ...boundary.store, evaluate: () => Effect.sync(() => { evaluations++; return { send: false } as const }) }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }, { responses: store }))
        const platform = platformFixtures(bot)
        yield* bot.ready()
        for (const content of [
            '!custom create ping text "collision"', '!auto create afk exact "hello" text "collision"',
            '!custom create Welcome text "collision"', '!custom create goodbye text "collision"', '!custom create ticket text "collision"',
            '!auto create ticket exact "hello" text "collision"',
            '!custom create rules text "Read rules"', '!custom create rules text "Again"',
            '!custom create bad text "unclosed', "!auto update x priority 101", "!custom update x priority 1", "!custom help", "!auto help",
        ]) { yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); yield* bot.idle() }
        assert.equal(boundary.calls.length, 2)
        assert.equal(evaluations, 0)
        assert.ok(platform.replies.requests().some((request) => /already exists/.test((request.body as { content: string }).content)))
        for (const request of platform.replies.requests()) assert.ok((request.body as { content: string }).content.length <= 2000)
        assert.equal(bot.failures().length, 0)
    })))
})

test("duplicate management receipts suppress a second acknowledgement", async () => {
    const fixtures = createFixtures()
    let manages = 0
    const store: ResponseStore = {
        ...managementStore().store,
        manage: () => Effect.sync(() => { manages++; return { duplicate: true } as const }),
    }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }, { responses: store }))
        const platform = platformFixtures(bot)
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!custom module off" }))
        yield* bot.idle()
        assert.equal(manages, 1)
        assert.equal(platform.replies.requests().length, 0)
        assert.equal(bot.failures().length, 0)
    })))
})

test("evaluation supplies fresh roles, source timestamp and raw content and sends one safe text or embed", async () => {
    const fixtures = createFixtures()
    const requests: Array<Parameters<ResponseStore["evaluate"]>[0]> = []
    const store: ResponseStore = {
        ...managementStore().store,
        evaluate: (request) => Effect.sync(() => {
            requests.push(request)
            return request.content.startsWith("!rules")
                ? { send: true, messageId: request.messageId, ruleName: "rules", reply: { type: "text", text: "@everyone <@123456789012345678>" } } as const
                : { send: true, messageId: request.messageId, ruleName: "greeting", reply: { type: "embed", embed: { title: "Hi", description: "@everyone", color: 0x123456 } } } as const
        }),
    }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }, { responses: store }))
        const platform = platformFixtures(bot)
        yield* bot.ready()
        const first = bot.fixtures.message({ content: '!rules   "raw args"  end' })
        yield* bot.emit("MESSAGE_CREATE", first)
        yield* bot.idle()
        const nextRole = bot.fixtures.nextId()
        bot.rest.respond("GET /guilds/:id/members/:id", { body: bot.fixtures.member({ roles: [nextRole] }) })
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "hello" }))
        yield* bot.idle()
        assert.equal(requests[0]?.createdAt, Date.parse(first.timestamp!))
        assert.equal(requests[0]?.content, first.content)
        assert.deepEqual(requests[0]?.roleIds, [fixtures.ids.guild, platform.role.id])
        assert.deepEqual(requests[1]?.roleIds, [fixtures.ids.guild, nextRole])
        assert.equal(platform.memberRoute.requests().length, 1)
        assert.equal(platform.replies.requests().length, 2)
        const embedBody = platform.replies.requests()[1]!.body as { embeds: unknown, allowed_mentions: unknown }
        assert.deepEqual(embedBody.embeds, [{ title: "Hi", description: "@everyone", color: 0x123456 }])
        for (const request of platform.replies.requests()) assert.deepEqual((request.body as { allowed_mentions: unknown }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        assert.equal(bot.failures().length, 0)
    })))
})

test("missing membership fails closed and built-ins never invoke dynamic evaluation", async () => {
    const fixtures = createFixtures()
    let evaluations = 0
    const store: ResponseStore = { ...managementStore().store, evaluate: () => Effect.sync(() => { evaluations++; return { send: false } as const }) }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ ...createBotOptions({ token, serverId: fixtures.ids.guild }, { responses: store }), logging: { dedupe: false } })
        const platform = platformFixtures(bot)
        const denied = bot.rest.respond("GET /guilds/:id/members/:id", { status: 404, body: { code: "UNKNOWN_MEMBER", message: "Missing" } })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "hello" }))
        yield* bot.idle()
        assert.equal(evaluations, 0)
        assert.equal(bot.failures().length, 1)
        denied.remove()
        for (const content of ["!ping", "!afk", "!custom help", "!auto help"]) { yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); yield* bot.idle() }
        assert.equal(evaluations, 0)
        assert.ok(platform.replies.requests().some((request) => (request.body as { content: string }).content === "Pong!"))
        assert.equal(bot.failures().length, 1)
    })))
})

test("bots, webhooks, DMs, other servers, system events and edits invoke neither management nor evaluation", async () => {
    const fixtures = createFixtures()
    let evaluations = 0
    const boundary = managementStore()
    const store: ResponseStore = { ...boundary.store, evaluate: () => Effect.sync(() => { evaluations++; return { send: false } as const }) }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }, { responses: store }))
        const platform = platformFixtures(bot)
        yield* bot.ready()
        const direct = { ...bot.fixtures.message({ content: "!custom list", channel_id: bot.fixtures.nextId() }) }
        bot.rest.respond(`GET /channels/${direct.channel_id}`, { body: { id: direct.channel_id, type: 1, recipients: [bot.fixtures.user()], last_message_id: null } })
        delete direct.guild_id
        for (const message of [
            bot.fixtures.message({ content: "!custom list", author: bot.fixtures.botUser() }),
            bot.fixtures.message({ content: "hello", webhook_id: bot.fixtures.nextId() }), direct,
            bot.fixtures.message({ content: "!custom list", guild_id: bot.fixtures.nextId() }),
            bot.fixtures.message({ content: "hello", type: MessageType.UserJoin }),
        ]) yield* bot.emit("MESSAGE_CREATE", message)
        yield* bot.emit("MESSAGE_UPDATE", bot.fixtures.message({ content: "hello" }))
        yield* bot.idle()
        assert.equal(boundary.calls.length, 0)
        assert.equal(evaluations, 0)
        assert.equal(platform.replies.requests().length, 0)
        assert.equal(bot.failures().length, 0)
    })))
})

test("serialized configuration writes finish before a queued custom invocation evaluates", async () => {
    const fixtures = createFixtures()
    const boundary = managementStore()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const started = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const order: string[] = []
        const store: ResponseStore = {
            ...boundary.store,
            manage: (request) => Effect.gen(function* () {
                order.push("manage started")
                yield* Deferred.succeed(started, undefined)
                yield* Deferred.await(release)
                const result = yield* boundary.store.manage(request)
                order.push("manage finished")
                return result
            }),
            evaluate: () => Effect.sync(() => { order.push("evaluate"); assert.ok(boundary.definitions.has("custom:rules")); return { send: false } as const }),
        }
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }, { responses: store }))
        platformFixtures(bot)
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: '!custom create rules text "Read"' }))
        yield* Deferred.await(started)
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!rules" }))
        yield* Deferred.succeed(release, undefined)
        yield* bot.idle()
        assert.deepEqual(order, ["manage started", "manage finished", "evaluate"])
        assert.equal(bot.failures().length, 0)
    })))
})

test("confirmed rejected sends consume the reserved attempt and never retry the application reply", async () => {
    const fixtures = createFixtures()
    let evaluations = 0
    const store: ResponseStore = {
        ...managementStore().store,
        evaluate: (request) => Effect.sync(() => { evaluations++; return evaluations === 1 ? { send: true, messageId: request.messageId, ruleName: "greeting", reply: { type: "text", text: "Hi" } } as const : { send: false } as const }),
    }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }, { responses: store }))
        platformFixtures(bot)
        const rejected = bot.rest.respond("POST /channels/:id/messages", { status: 403, body: { code: "MISSING_PERMISSIONS", message: "Denied" } })
        yield* bot.ready()
        const source = bot.fixtures.message({ content: "hello" })
        yield* bot.emit("MESSAGE_CREATE", source)
        yield* bot.idle()
        assert.equal(rejected.requests().length, 1)
        assert.equal(bot.failures().length, 1)
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "hello" }))
        yield* bot.idle()
        assert.equal(rejected.requests().length, 1)
    })))
})

test("an uncertain native send is reported once without replaying the response", async () => {
    const fixtures = createFixtures()
    const store: ResponseStore = {
        ...managementStore().store,
        evaluate: (request) => Effect.succeed({ send: true, messageId: request.messageId, ruleName: "greeting", reply: { type: "text", text: "Hi" } }),
    }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }, { responses: store }))
        platformFixtures(bot)
        const failed = bot.rest.respond("POST /channels/:id/messages", () => { throw new Error("Synthetic network disconnect") })
        yield* bot.ready()
        const source = bot.fixtures.message({ content: "hello" })
        yield* bot.emit("MESSAGE_CREATE", source)
        yield* bot.idle()
        assert.equal(failed.requests().length, 1)
        assert.ok(bot.failures().some((failure) => failure.code === "events.handlerFailed"))
    })))
})

test("AFK return clearing runs before management and management is never dynamically evaluated", async () => {
    const fixtures = createFixtures()
    const boundary = managementStore()
    const order: string[] = []
    let away = false
    const store: ResponseStore = { ...boundary.store, manage: (request) => Effect.gen(function* () { order.push("manage"); return yield* boundary.store.manage(request) }) }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }, { afk: {
            set: (userId, reason) => Effect.sync(() => { away = true; return { userId, reason, since: 1 } }),
            observe: () => Effect.sync(() => { order.push("observe"); const cleared = away; away = false; return { cleared, statuses: [] } }),
        }, responses: store }))
        const platform = platformFixtures(bot)
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!afk Away" }))
        yield* bot.idle()
        assert.equal(away, true)
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: '!custom create rules text "Read"' }))
        yield* bot.idle()
        assert.deepEqual(order, ["observe", "manage"])
        assert.equal(away, false)
        assert.equal(platform.replies.requests().length, 3)
        assert.equal(bot.failures().length, 0)
    })))
})

test("ping replies before a blocked AFK observation, then clears away status after release", async () => {
    const fixtures = createFixtures()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const observed = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        let away = true
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }, { afk: {
            set: (userId, reason) => Effect.succeed({ userId, reason, since: 1 }),
            observe: () => Effect.gen(function* () {
                yield* Deferred.succeed(observed, undefined)
                yield* Deferred.await(release)
                const cleared = away
                away = false
                return { cleared, statuses: [] }
            }),
        } }))
        const replies = bot.rest.respond("POST /channels/:id/messages", { body: bot.fixtures.message() })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "!ping" }))
        yield* Deferred.await(observed)
        assert.equal(replies.requests().length, 1)
        assert.equal((replies.requests()[0]!.body as { content: string }).content, "Pong!")
        assert.equal(away, true)
        yield* Deferred.succeed(release, undefined)
        yield* bot.idle()
        assert.equal(away, false)
        assert.equal(replies.requests().length, 2)
        assert.equal(bot.failures().length, 0)
    })))
})

test("shutdown interruption does not replay an in-flight reserved send", async () => {
    const fixtures = createFixtures()
    const store: ResponseStore = {
        ...managementStore().store,
        evaluate: (request) => Effect.succeed({ send: true, messageId: request.messageId, ruleName: "greeting", reply: { type: "text", text: "Hi" } }),
    }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const release = yield* Deferred.make<void>()
        const bot = yield* createTestBot(createBotOptions({ token, serverId: fixtures.ids.guild }, { responses: store }))
        platformFixtures(bot)
        const pending = bot.rest.respond("POST /channels/:id/messages", async () => {
            await Effect.runPromise(Deferred.succeed(entered, undefined))
            await Effect.runPromise(Deferred.await(release))
            return { body: bot.fixtures.message() }
        })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "hello" }))
        yield* Deferred.await(entered)
        assert.equal(pending.requests().length, 1)
        yield* bot.client.shutdown({ drainMs: 0 })
        yield* Deferred.succeed(release, undefined)
        assert.equal(bot.client.state, "Closed")
        assert.equal(pending.requests().length, 1)
        assert.equal(bot.failures().length, 0)
    })))
})
