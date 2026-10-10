import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Deferred, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { observeGreetingJoin, observeGreetingMembership } from "../src/welcome-events.ts"
import { performGreetingsGrant, processGreetingsCandidate } from "../src/welcome.ts"
import { parseGreetingsCommand } from "../src/welcome-command.ts"
import { GreetingsStoreError } from "../src/welcome-store.ts"
import { boundary, platform, token } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"
import { greetingsBoundary } from "./welcome-fixture.ts"
import { rolesBoundary } from "./roles-fixture.ts"

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
function greetingsNative(bot: Bot) {
    const p = platform(bot), f = bot.fixtures
    p.replies.remove()
    const sent = bot.rest.respond("POST /channels/:id/messages", (request) => {
        const value = request.body as { content?: string, embeds?: object[] }
        const raw = f.message({ channel_id: request.path.split("/")[2], author: f.botUser(), content: value.content ?? "", embeds: value.embeds?.map(embed => {
            const rich = embed as { fields?: { name: string, value: string, inline?: boolean }[] }
            return { type: "rich", ...embed, ...(rich.fields ? { fields: rich.fields.map(field => ({ ...field, inline: field.inline ?? false })) } : {}) }
        }) ?? [] })
        const { guild_id: _guild, author, ...message } = raw
        const { bot: _bot, ...plainAuthor } = author
        return { body: { ...message, author: plainAuthor } }
    })
    return { ...p, sent }
}
function candidate(remote: ReturnType<typeof greetingsBoundary>, bot: Bot, p: ReturnType<typeof greetingsNative>, joinedAt: string, route: C.GreetingsRoute = "welcome") {
    remote.settings.routes[route] = { revision: 1, enabled: true, timing: "join", templateName: "greeting", templateRevision: 1,
        content: { content: "A uniquely synthetic greeting", embed: { title: "Welcome", fields: [{ name: "Profile", value: "No mentions" }] } }, ...(route === "dm" ? {} : { channelId: bot.fixtures.ids.channel }) }
    const item: C.GreetingsPendingResult["candidates"][number] = { deliveryId: `synthetic_${route}`, route, routeRevision: 1, userId: p.targetId, joinedAt,
        memberGeneration: 1, hasEmbed: true, ...(route === "dm" ? {} : { channelId: bot.fixtures.ids.channel }) }
    remote.candidates.set(item.deliveryId, item); return item
}
const emit = (bot: Bot, content: string) => bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))

test("greeting commands configure exact templates independently and preview only the invoking staff channel", async () => {
    const f = createFixtures(), remote = greetingsBoundary(), publishing = publishingBoundary(), moderation = boundary()
    publishing.drafts.set("template:greeting", { kind: "template", name: "greeting", revision: 3, content: { content: "Welcome {user.name}" },
        canonicalContent: { content: "Welcome {user.name}" }, createdAt: 0, updatedAt: 0 })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, publishing: publishing.store, greetings: remote.store }))
        const p = greetingsNative(bot); yield* bot.ready()
        yield* emit(bot, `!welcome configure greeting <#${f.ids.channel}> verified`)
        yield* emit(bot, "!welcome dm configure greeting join")
        yield* emit(bot, `!goodbye configure greeting <#${f.ids.channel}>`)
        yield* emit(bot, "!welcome module on"); yield* emit(bot, "!welcome dm module on")
        yield* emit(bot, "!welcome rate 12"); yield* emit(bot, "!welcome retention 90")
        yield* emit(bot, "!welcome dm preview")
        assert.equal(remote.settings.routes.welcome.timing, "verified"); assert.equal(remote.settings.routes.dm.timing, "join")
        assert.equal(remote.settings.routes.goodbye.enabled, false); assert.equal(remote.settings.claimsPerMinute, 12)
        const configure = remote.calls.filter(c => c.method === "manage").map(c => c.input as C.GreetingsManageRequest).filter(c => c.operation.type === "configure")
        assert.equal(configure.length, 3); assert.equal(configure.every(c => c.operation.type === "configure" && c.operation.expectedTemplateRevision === 3), true)
        assert.equal(remote.calls.some(c => c.method === "observe" || c.method === "reserve"), false)
        assert.equal(p.open.requests().length, 0)
        for (const request of p.sent.requests()) {
            assert.equal(request.path.split("/")[2], f.ids.channel)
            assert.deepEqual((request.body as { allowed_mentions: object }).allowed_mentions, { parse: [], users: [], roles: [], replied_user: false })
        }
        const welcome = structuredClone(remote.settings.routes.welcome)
        const dmRevision = remote.settings.routes.dm.revision
        yield* emit(bot, "!welcome dm clear")
        assert.deepEqual(remote.settings.routes.welcome, welcome)
        assert.deepEqual(remote.settings.routes.dm, { revision: dmRevision + 1, enabled: false, timing: "join" })
        assert.equal(remote.settings.routes.goodbye.templateName, "greeting")
        yield* emit(bot, "!goodbye clear"); yield* emit(bot, "!welcome clear")
        assert.equal(Object.values(remote.settings.routes).every(route => !route.enabled && route.content === undefined && route.templateName === undefined && route.channelId === undefined), true)
        assert.deepEqual(bot.failures(), [])
    })))
})

test("ordinary greeting mutation is blocked at DEFCON1 while status and disable remain available", async () => {
    const f = createFixtures(), remote = greetingsBoundary(), moderation = boundary(); moderation.current.defcon = 1
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, greetings: remote.store }))
        greetingsNative(bot); yield* bot.ready()
        yield* emit(bot, "!welcome rate 30"); yield* emit(bot, "!welcome preview")
        assert.equal(remote.calls.some(c => c.method === "manage"), false)
        yield* emit(bot, "!welcome module off"); yield* emit(bot, "!welcome dm clear"); yield* emit(bot, "!goodbye clear"); yield* emit(bot, "!welcome clear"); yield* emit(bot, "!goodbye status")
        yield* emit(bot, "!goodbye history")
        assert.equal(remote.calls.filter(c => c.method === "manage").length, 4)
        assert.equal(remote.calls.filter(c => c.method === "query").length, 2)
    })))
})

test("delivery history continues with next where the member's last page of that route ended", async () => {
    const f = createFixtures(), remote = greetingsBoundary(), moderation = boundary(), query = remote.store.query, before: (number | undefined)[] = []
    // The first page has more after it, and the page before delivery 5 is the last
    remote.store.query = (input) => {
        const op = input.operation
        if (op.type !== "deliveries") return query(input)
        before.push(op.beforeDeliveryNo)
        return Effect.succeed({ type: "deliveries", deliveries: [], ...(op.beforeDeliveryNo ? {} : { nextBeforeDeliveryNo: 5 }) })
    }
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, greetings: remote.store }))
        const p = greetingsNative(bot); yield* bot.ready()
        const replies = () => p.sent.requests().map(request => (request.body as { content: string }).content)
        yield* emit(bot, "!welcome dm history")
        assert.equal(replies().at(-1), "No retained greeting deliveries\nNext: !welcome dm history next")
        yield* emit(bot, "!welcome dm history next")
        assert.equal(replies().at(-1), "No retained greeting deliveries")
        yield* emit(bot, "!welcome dm history next")
        assert.equal(replies().at(-1), "There is no next page to show. Send !welcome dm history to start the list again")
        // Each route keeps its own place in the list
        yield* emit(bot, "!welcome history"); yield* emit(bot, "!goodbye history next")
        assert.equal(replies().at(-1), "There is no next page to show. Send !goodbye history to start the list again")
        yield* emit(bot, "!welcome history next")
        assert.deepEqual(before, [undefined, 5, undefined, 5])
        assert.deepEqual(bot.failures(), [])
    })))
})

test("native greeting eligibility completes before reserve and dispatch without postclaim member or channel reads", async () => {
    const f = createFixtures(), remote = greetingsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = greetingsNative(bot)
        const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt
        const item = candidate(remote, bot, p, joinedAt)
        const dispatch = remote.store.dispatch
        remote.store.dispatch = input => Effect.gen(function* () {
            const result = yield* dispatch(input)
            p.target.remove(); p.channel.remove(); p.guildRoute.remove(); p.ownMember.remove(); p.rolesRoute.remove()
            return result
        })
        yield* bot.ready()
        assert.equal(yield* processGreetingsCandidate(remote.store, f.ids.guild, bot.client, item), "sent")
        assert.equal(p.sent.requests().length, 1)
        const saved = remote.outcomes.get(item.deliveryId)!
        assert.equal(saved.outcome, "sent"); assert.equal(saved.channelId, f.ids.channel); assert.ok(saved.messageId)
        assert.equal(remote.calls.some(c => c.method === "manage"), false)
        assert.equal(remote.calls.filter(c => c.method === "dispatch").length, 1)
    })))
})

test("DM channel open and recipient verification remain separate from uncertain delivery and never replay", async () => {
    for (const mismatch of [false, true]) {
        const f = createFixtures(), remote = greetingsBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = greetingsNative(bot)
            const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt
            const item = candidate(remote, bot, p, joinedAt, "dm")
            if (mismatch) { p.open.remove(); bot.rest.respond("POST /users/@me/channels", { body: { id: p.dmId, type: 3, recipients: [f.user({ id: f.nextId() })] } }) }
            p.sent.remove(); const failedSend = bot.rest.respond("POST /channels/:id/messages", { status: 403, body: { message: "Synthetic privacy refusal" } })
            yield* bot.ready(); assert.equal(yield* processGreetingsCandidate(remote.store, f.ids.guild, bot.client, item), "uncertain")
            const grant = remote.grants.get(item.deliveryId)!
            const again = yield* performGreetingsGrant(remote.store, f.ids.guild, bot.client, grant)
            assert.equal(again.recorded, false); assert.equal(failedSend.requests().length, mismatch ? 0 : 1)
            assert.equal(remote.calls.filter(c => c.method === "outcome").length, 1)
        })))
    }
})

test("identity-verified message ID survives canonical mismatch with actual wire metadata omissions", async () => {
    const f = createFixtures(), remote = greetingsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = greetingsNative(bot)
        const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt, item = candidate(remote, bot, p, joinedAt)
        p.sent.remove(); const providerId = f.nextId()
        bot.rest.respond("POST /channels/:id/messages", { body: f.message({ id: providerId, author: f.botUser(), content: "Synthetic changed projection" }) })
        yield* bot.ready(); assert.equal(yield* processGreetingsCandidate(remote.store, f.ids.guild, bot.client, item), "uncertain")
        assert.equal(remote.outcomes.get(item.deliveryId)?.messageId, providerId)
    })))
})

test("invoked native rejection and unusable success are uncertain, local SDK nondispatch is the only failed proof", async () => {
    for (const mode of ["rejected", "response", "input"] as const) {
        const f = createFixtures(), remote = greetingsBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = greetingsNative(bot)
            const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt, item = candidate(remote, bot, p, joinedAt)
            p.sent.remove(); const transport = bot.rest.respond("POST /channels/:id/messages", mode === "rejected" ? { status: 403, body: { message: "Synthetic rejected" } } : { body: {} })
            if (mode === "input") remote.settings.routes.welcome.content = { content: "" }
            yield* bot.ready(); const result = yield* processGreetingsCandidate(remote.store, f.ids.guild, bot.client, item)
            assert.equal(result, mode === "input" ? "failed" : "uncertain")
            assert.equal(transport.requests().length, mode === "input" ? 0 : 1)
            assert.equal(remote.outcomes.get(item.deliveryId)?.noDispatch, mode === "input" ? true : undefined)
        })))
    }
})

test("denied or lost dispatch claim cannot send or finalize a potentially competing invocation", async () => {
    for (const lost of [false, true]) {
        const f = createFixtures(), remote = greetingsBoundary()
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = greetingsNative(bot)
            const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt, item = candidate(remote, bot, p, joinedAt)
            const dispatch = remote.store.dispatch
            remote.store.dispatch = input => lost ? Effect.fail(new GreetingsStoreError({ operation: "dispatch", status: null })) : dispatch(input).pipe(Effect.map(v => ({ ...v, claimed: false })))
            yield* bot.ready(); assert.equal(yield* processGreetingsCandidate(remote.store, f.ids.guild, bot.client, item), "uncertain")
            assert.equal(p.sent.requests().length, 0); assert.equal(remote.outcomes.size, 0)
        })))
    }
})

test("lost delivery acknowledgement preserves the verified provider identity and confirmed native result without replay", async () => {
    const f = createFixtures(), remote = greetingsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = greetingsNative(bot)
        const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt, item = candidate(remote, bot, p, joinedAt)
        const context = { botId: f.ids.bot, botAuthorized: true, observedAt: yield* Clock.currentTimeMillis,
            member: { userId: p.targetId, userName: "Synthetic member", serverName: "Synthetic server", joinedAt, isBot: false, roleIds: [], timeoutUntil: null }, memberAbsent: false, channelId: f.ids.channel }
        const reserved = yield* remote.store.reserve({ serverId: f.ids.guild, ...item, context })
        assert.equal(reserved.status, "reserved"); if (reserved.status !== "reserved") return
        remote.store.outcome = () => Effect.fail(new GreetingsStoreError({ operation: "outcome", status: null }))
        yield* bot.ready(); const result = yield* performGreetingsGrant(remote.store, f.ids.guild, bot.client, reserved.grant)
        assert.equal(result.outcome, "sent"); assert.equal(result.recorded, false); assert.ok(result.messageId)
        assert.equal(result.diagnostic?.stage, "acknowledgement"); assert.equal(p.sent.requests().length, 1)
        assert.equal((yield* performGreetingsGrant(remote.store, f.ids.guild, bot.client, reserved.grant)).recorded, false)
        assert.equal(p.sent.requests().length, 1)
    })))
})

test("known member departure requires actual typed404 and old removal after rejoin observes present instead", async () => {
    const f = createFixtures(), remote = greetingsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { greetings: remote.store })), p = greetingsNative(bot)
        yield* bot.ready(); assert.equal(yield* observeGreetingMembership(remote.store, f.ids.guild, bot.client, p.targetId), false)
        assert.equal(p.target.requests().length, 0)
        const joinedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
        p.target.remove(); let current: string | null = joinedAt, status = 404
        bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => current ? { body: f.member({ user: f.user({ id: p.targetId }), joined_at: current, communication_disabled_until: null }) } : { status, body: { message: "Synthetic absence" } })
        yield* observeGreetingJoin(remote.store, f.ids.guild, bot.client, p.targetId, joinedAt)
        current = null; yield* observeGreetingMembership(remote.store, f.ids.guild, bot.client, p.targetId)
        assert.equal(remote.members.get(p.targetId)?.present, false)
        current = joinedAt.replace(/Z$/, "456Z")
        yield* bot.emit("GUILD_MEMBER_UPDATE", { ...f.member({ user: f.user({ id: p.targetId }), joined_at: current }), guild_id: f.ids.guild }); yield* bot.idle()
        assert.equal(remote.members.get(p.targetId)?.present, false); assert.equal(remote.members.get(p.targetId)?.joinedAt, joinedAt)
        assert.equal(remote.calls.filter(c => c.method === "observe").length, 3)
        current = null; status = 500
        assert.equal((yield* Effect.exit(observeGreetingMembership(remote.store, f.ids.guild, bot.client, p.targetId)))._tag, "Failure")
        assert.equal(remote.members.get(p.targetId)?.present, false)
    })))
})

test("a confirmed departure without a stored join record reports a goodbye with the fetched account name", async () => {
    const f = createFixtures(), remote = greetingsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { greetings: remote.store })), p = greetingsNative(bot)
        yield* bot.ready(); p.target.remove()
        bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, () => ({ status: 404, body: { message: "Synthetic absence" } }))
        bot.rest.respond(`GET /users/${p.targetId}`, { body: bot.fixtures.user({ id: p.targetId, username: "Departed member" }) })
        assert.equal(yield* observeGreetingMembership(remote.store, f.ids.guild, bot.client, p.targetId), false)
        assert.equal(yield* observeGreetingMembership(remote.store, f.ids.guild, bot.client, p.targetId, true), true)
        const observed = remote.calls.find(c => c.method === "observe")?.input as C.GreetingsObserveRequest
        assert.equal(observed.operation.type, "departed")
        if (observed.operation.type === "departed") assert.equal(observed.operation.userName, "Departed member")
        assert.equal(remote.members.get(p.targetId)?.present, false)
    })))
})

test("join protection precedes greeting admission and greeting read failure cannot suppress role or security work", async () => {
    const f = createFixtures(), remote = greetingsBoundary(), moderation = boundary(), roles = rolesBoundary(), order: string[] = []
    moderation.current.securityEnabled = true; moderation.current.joinEnabled = true
    const originalJoin = moderation.store.join
    moderation.store.join = input => originalJoin(input).pipe(Effect.tap(() => Effect.sync(() => { order.push("security") })))
    const observe = remote.store.observe
    remote.store.observe = input => observe(input).pipe(Effect.tap(() => Effect.sync(() => { order.push("greeting") })))
    const policy = roles.store.policy
    roles.store.policy = input => policy(input).pipe(Effect.tap(() => Effect.sync(() => { order.push("roles") })))
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: moderation.store, roles: roles.store, greetings: remote.store })), p = greetingsNative(bot)
        bot.rest.respond(`GET /users/${p.targetId}`, { body: f.user({ id: p.targetId }) })
        const joinedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
        p.target.remove(); const target = bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, { body: f.member({ user: f.user({ id: p.targetId }), joined_at: joinedAt, roles: [p.targetRole.id], communication_disabled_until: null }) })
        yield* bot.ready(); yield* bot.emit("GUILD_MEMBER_ADD", { ...f.member({ user: f.user({ id: p.targetId }), joined_at: joinedAt }), guild_id: f.ids.guild }); yield* bot.idle()
        assert.deepEqual(order, ["security", "greeting", "roles"])
        remote.store.observe = () => Effect.fail(new GreetingsStoreError({ operation: "observe", status: null }))
        target.remove(); bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, { body: f.member({ user: f.user({ id: p.targetId }), joined_at: joinedAt, roles: [p.targetRole.id], communication_disabled_until: null }) })
        yield* bot.emit("GUILD_MEMBER_ADD", { ...f.member({ user: f.user({ id: p.targetId }), joined_at: joinedAt }), guild_id: f.ids.guild }); yield* bot.idle()
        assert.equal(order.filter(v => v === "security").length, 2); assert.equal(order.filter(v => v === "roles").length, 2); assert.deepEqual(bot.failures(), [])
    })))
})

test("join admission retains exact raw epoch and rejects stale actual events without provider reads", async () => {
    const f = createFixtures(), remote = greetingsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = greetingsNative(bot); yield* bot.ready()
        assert.equal(yield* observeGreetingJoin(remote.store, f.ids.guild, bot.client, p.targetId, new Date((yield* Clock.currentTimeMillis) - 900001).toISOString()), false)
        assert.equal(p.target.requests().length, 0)
        const joinedAt = new Date(yield* Clock.currentTimeMillis).toISOString().replace(/Z$/, "12345Z")
        p.target.remove(); bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${p.targetId}`, { body: f.member({ user: f.user({ id: p.targetId }), joined_at: joinedAt, communication_disabled_until: null }) })
        assert.equal(yield* observeGreetingJoin(remote.store, f.ids.guild, bot.client, p.targetId, joinedAt), true)
        const op = (remote.calls.find(c => c.method === "observe")!.input as C.GreetingsObserveRequest).operation
        assert.equal(op.type, "join"); if (op.type === "join") assert.equal(op.eventJoinedAt, joinedAt)
        assert.equal((yield* Effect.exit(observeGreetingJoin(remote.store, f.ids.guild, bot.client, p.targetId, new Date(Date.parse(joinedAt)).toISOString())))._tag, "Failure")
    })))
})

test("interruption after admitted native request leaves the claimed delivery unresolved without outcome or replay", async () => {
    const f = createFixtures(), remote = greetingsBoundary()
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild })), p = greetingsNative(bot), entered = yield* Deferred.make<void>(), held = yield* Deferred.make<void>()
        const joinedAt = (yield* bot.client.members.fetch({ guildId: f.ids.guild, userId: p.targetId })).joinedAt, item = candidate(remote, bot, p, joinedAt)
        p.sent.remove(); const send = bot.rest.respond("POST /channels/:id/messages", async () => { await Effect.runPromise(Deferred.succeed(entered, undefined)); await Effect.runPromise(Deferred.await(held)); return { body: f.message() } })
        yield* bot.ready(); const running = yield* processGreetingsCandidate(remote.store, f.ids.guild, bot.client, item).pipe(Effect.forkChild)
        yield* Deferred.await(entered); yield* Fiber.interrupt(running)
        yield* Deferred.succeed(held, undefined)
        assert.equal(send.requests().length, 1); assert.equal(remote.outcomes.size, 0); assert.equal(remote.claimed.has(item.deliveryId), true)
    })))
})

test("quoted greeting grammar requires explicit timings and never exposes a DM arbitrary target or replay action", () => {
    assert.deepEqual(parseGreetingsCommand("welcome", ["dm", "configure", "rules", "verified"]), { type: "configure", route: "dm", templateName: "rules", timing: "verified" })
    assert.deepEqual(parseGreetingsCommand("welcome", ["clear"]), { type: "clear", route: "welcome" })
    assert.deepEqual(parseGreetingsCommand("welcome", ["dm", "clear"]), { type: "clear", route: "dm" })
    assert.deepEqual(parseGreetingsCommand("goodbye", ["clear"]), { type: "clear", route: "goodbye" })
    assert.ok("error" in parseGreetingsCommand("welcome", ["clear", "all"]))
    assert.deepEqual(parseGreetingsCommand("welcome", ["history"]), { type: "history", route: "welcome" })
    assert.deepEqual(parseGreetingsCommand("welcome", ["dm", "history", "next"]), { type: "history", route: "dm", next: true })
    assert.deepEqual(parseGreetingsCommand("goodbye", ["history", "next"]), { type: "history", route: "goodbye", next: true })
    assert.deepEqual(parseGreetingsCommand("goodbye", ["status", "4"]), { type: "query", route: "goodbye", operation: { type: "delivery", deliveryNo: 4 } })
    for (const args of [["configure", "rules"], ["dm", "preview", "123"], ["replay", "x"], ["rate", "61"], ["retention", "29"], ["history", "4"], ["dm", "history", "next", "next"]]) assert.ok("error" in parseGreetingsCommand("welcome", args))
})
