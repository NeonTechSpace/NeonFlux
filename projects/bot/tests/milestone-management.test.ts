import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { parseManagement } from "../src/response-command.ts"
import { platform, boundary, token } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { milestoneDelivery, milestoneEpoch, milestonesBoundary } from "./milestone-fixture.ts"
import type { GeneralSettingsStore } from "../src/general-settings.ts"

function options(remote: ReturnType<typeof milestonesBoundary>, publishing = publishingBoundary(), moderation?: ReturnType<typeof boundary>) {
    const f = createFixtures()
    return createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation?.store, publishing: publishing.store, milestones: remote.store })
}
function direct(bot: Effect.Success<ReturnType<typeof createTestBot>>, channelId: string, content: string) {
    const message = bot.fixtures.message({ channel_id: channelId, content })
    Reflect.deleteProperty(message, "guild_id")
    return message
}
test("authenticated personal me and removal work after server departure with DEFCON1 and no owner proof", async () => {
    const remote = milestonesBoundary(), moderation = boundary(); moderation.current.defcon = 1
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote, publishingBoundary(), moderation)), p = platform(bot)
        p.actor.remove()
        const absent = bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${bot.fixtures.ids.user}`, { status: 404, body: { message: "Synthetic departed member" } })
        yield* bot.ready()
        for (const content of ["!milestone me", "!milestone remove birthday"]) {
            yield* bot.emit("MESSAGE_CREATE", direct(bot, p.dmId, content)); yield* p.replies.next(); yield* bot.idle()
        }
        const calls = remote.calls.filter(c => c.method === "personal").map(c => c.input as C.MilestonesPersonalRequest)
        assert.deepEqual(calls.map(c => c.operation.type), ["me", "remove"])
        assert(calls.every(c => c.identity.userId === bot.fixtures.ids.user && c.identity.channelId === p.dmId && c.serverId === bot.fixtures.ids.guild))
        assert.equal(absent.requests().length, 0)
        assert.equal(p.actor.requests().length, 0)
        assert(p.replies.requests().every(r => r.path === `/channels/${p.dmId}/messages`))
        assert.equal(bot.failures().length, 0)
    })))
})
test("public birthday submission receives only private instructions and never persists or publicly echoes month/day", async () => {
    const remote = milestonesBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote)), p = platform(bot), f = bot.fixtures
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", f.message({ content: `!milestone birthday set 02-29 confirm <#${f.ids.channel}>` }))
        const response = yield* p.replies.next(); yield* bot.idle()
        assert.equal(response.path, `/channels/${p.dmId}/messages`)
        assert(!(response.body as { content: string }).content.includes("02-29"))
        assert(!remote.calls.some(c => c.method === "personal" || c.method === "manage"))
        assert.equal(bot.failures().length, 0)
    })))
})
test("personal enrollment uses actual DM identity and fresh destination/member raw epoch without staff ownership", async () => {
    const remote = milestonesBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote)), p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.ReadMessageHistory })
        p.actor.remove()
        bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${bot.fixtures.ids.user}`, { body: bot.fixtures.member({ roles: [p.actorRole.id], joined_at: milestoneEpoch, communication_disabled_until: null }) })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", direct(bot, p.dmId, `!milestone birthday set 02-29 confirm <#${bot.fixtures.ids.channel}>`)); yield* p.replies.next(); yield* bot.idle()
        const input = remote.calls.find(c => c.method === "personal")!.input as C.MilestonesPersonalRequest
        assert.equal(input.operation.type, "enroll"); assert.equal(input.identity.userId, bot.fixtures.ids.user)
        if (input.operation.type !== "enroll") return
        assert.equal(input.operation.participant.member.userId, input.identity.userId)
        assert.equal(input.operation.participant.member.joinedAt, milestoneEpoch)
        assert.equal(input.operation.confirmChannelId, bot.fixtures.ids.channel)
        assert.equal(input.operation.participant.channelId, bot.fixtures.ids.channel)
        assert(!remote.calls.some(c => c.method === "manage"))
        assert.equal(bot.failures().length, 0)
    })))
})
test("personal enrollment resolves a unique channel name and rejects missing names privately", async () => {
    const remote = milestonesBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote)), p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ViewChannel | Permissions.ReadMessageHistory })
        p.actor.remove()
        bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/members/${bot.fixtures.ids.user}`, { body: bot.fixtures.member({ roles: [p.actorRole.id], joined_at: milestoneEpoch, communication_disabled_until: null }) })
        bot.rest.respond(`GET /guilds/${bot.fixtures.ids.guild}/channels`, { body: [bot.fixtures.channel({ name: "celebrations" })] })
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", direct(bot, p.dmId, "!milestone birthday set 02-29 confirm #missing"))
        const missing = yield* p.replies.next(); yield* bot.idle()
        assert.match((missing.body as { content: string }).content, /No text or announcement channel is named #missing/)
        assert(!remote.calls.some(c => c.method === "personal"))
        yield* bot.emit("MESSAGE_CREATE", direct(bot, p.dmId, "!milestone birthday set 02-29 confirm #Celebrations")); yield* p.replies.next(); yield* bot.idle()
        const input = remote.calls.find(c => c.method === "personal")!.input as C.MilestonesPersonalRequest
        assert.equal(input.operation.type === "enroll" && input.operation.confirmChannelId, bot.fixtures.ids.channel)
        assert.equal(bot.failures().length, 0)
    })))
})
test("forged group DM has no personal effects or replies and milestone is reserved from custom commands", async () => {
    const remote = milestonesBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote)), p = platform(bot)
        p.privateFetch.remove()
        bot.rest.respond(`GET /channels/${p.dmId}`, { body: { id: p.dmId, type: 3, recipients: [bot.fixtures.user(), bot.fixtures.user({ id: p.targetId })], last_message_id: null } })
        yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", direct(bot, p.dmId, "!milestone remove")); yield* bot.idle()
        assert(!remote.calls.some(c => c.method === "personal"))
        assert.equal(p.replies.requests().length, 0)
        assert.equal(bot.failures().length, 0)
        assert("error" in parseManagement("custom", ["create", "milestone", "body"]))
    })))
})
test("first route configuration binds the current plain template revision without requiring embed permission", async () => {
    const remote = milestonesBoundary({ query: () => Effect.succeed({ type: "settings", settings: { enabled: false, revision: 1, activatedAt: 0 }, routes: [] }) }), publishing = publishingBoundary(), f = createFixtures()
    publishing.drafts.set("template:birthday", { kind: "template", name: "birthday", revision: 3, content: { content: "Celebrate {user}" }, canonicalContent: { content: "Celebrate {user}" }, createdAt: 1, updatedAt: 1 })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote, publishing)), p = platform(bot, { botPermissions: Permissions.ViewChannel | Permissions.SendMessages | Permissions.ReadMessageHistory })
        yield* bot.ready(); yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: `!milestone configure birthday <#${f.ids.channel}> UTC 09:00 reject template birthday` })); yield* p.replies.next(); yield* bot.idle()
        const input = remote.calls.find(c => c.method === "manage")!.input as C.MilestonesManageRequest
        assert(input.operation.type === "configure")
        // A route never configured has revision 0, and the template's revision comes from its current draft
        assert.equal(input.operation.expectedRevision, 0); assert.deepEqual(input.operation.template, { name: "birthday", revision: 3 })
        assert.equal(input.context.channelId, f.ids.channel)
        assert(input.context.botAuthorized && input.context.actorAuthorized)
        assert(p.replies.requests().every(r => r.path === `/channels/${p.dmId}/messages`))
        assert.equal(bot.failures().length, 0)
    })))
})
test("staff module and route changes read the current revisions right before the write", async () => {
    const remote = milestonesBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote)), p = platform(bot)
        yield* bot.ready()
        for (const content of ["!milestone module off", "!milestone enable birthday", "!milestone disable anniversary"]) {
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); yield* p.replies.next(); yield* bot.idle()
        }
        assert.deepEqual(remote.calls.map(c => c.method), ["query", "manage", "query", "manage", "query", "manage"])
        // The configured birthday route has revision 2, and the anniversary route was never configured
        assert.deepEqual(remote.calls.filter(c => c.method === "manage").map(c => (c.input as C.MilestonesManageRequest).operation),
            [{ type: "settings", expectedRevision: 1, enabled: false }, { type: "enable", kind: "birthday", expectedRevision: 2 }, { type: "disable", kind: "anniversary", expectedRevision: 0 }])
        assert.equal(bot.failures().length, 0)
    })))
})
test("delivery status pages with next and says when no next page is remembered", async () => {
    const cursors: (string | undefined)[] = []
    const remote = milestonesBoundary({ query: input => Effect.sync((): C.MilestonesQueryResult => {
        if (input.operation.type !== "deliveries") return { type: "settings", settings: { enabled: false, revision: 1, activatedAt: 0 }, routes: [] }
        cursors.push(input.operation.cursor)
        return input.operation.cursor ? { type: "deliveries", deliveries: [] } : { type: "deliveries", deliveries: [milestoneDelivery()], nextCursor: "synthetic_cursor" }
    }) })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(options(remote)), p = platform(bot)
        yield* bot.ready()
        const send = (content: string) => Effect.gen(function* () { yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })); const reply = yield* p.replies.next(); yield* bot.idle(); return (reply.body as { content: string }).content })
        assert.match(yield* send("!milestone status birthday"), /^Next: !milestone status birthday next$/m)
        assert.match(yield* send("!milestone status anniversary next"), /There is no next page to show\. Send !milestone status anniversary to start the list again/)
        assert.doesNotMatch(yield* send("!milestone status birthday next"), /Next:/)
        assert.match(yield* send("!milestone status birthday next"), /Send !milestone status birthday to start the list again/)
        assert.deepEqual(cursors, [undefined, "synthetic_cursor"])
        assert.equal(bot.failures().length, 0)
    })))
})
test("milestone instructions sent to the DM print the fixed ! even when the server uses another prefix", async () => {
    const remote = milestonesBoundary(), f = createFixtures()
    const general: GeneralSettingsStore = { get: () => Effect.succeed({ prefix: "?", revision: 1 }), set: () => Effect.die("unused"), nickname: () => Effect.die("unused"), setNickname: () => Effect.die("unused"), recordNickname: () => Effect.die("unused") }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { publishing: publishingBoundary().store, milestones: remote.store, general })), p = platform(bot)
        yield* bot.ready()
        yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content: "?milestone help" }))
        const response = yield* p.replies.next(); yield* bot.idle()
        assert.equal(response.path, `/channels/${p.dmId}/messages`)
        const content = (response.body as { content: string }).content
        assert.match(content, /!milestone/)
        assert.doesNotMatch(content, /\?milestone/)
        assert.equal(bot.failures().length, 0)
    })))
})
