import assert from "node:assert/strict"
import test from "node:test"
import { ChannelType, Permissions } from "@neontechspace/fluxerly/effect"
import { createTestClient, type TestClient } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { readWelcomeDestination, readWelcomeMember, verifyWelcomeMessage, verifyWelcomePrivateChannel, WelcomePermissionError } from "../src/welcome-permissions.ts"

function routes(native: TestClient) {
    const f = native.fixtures
    const joinedAt = "2026-10-01T12:00:00.123456789Z"
    const everyone = f.role({ id: f.ids.guild, permissions: "0" })
    const botRole = f.role({ permissions: (Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks).toString() })
    const self = native.rest.respond("GET /users/@me", { body: f.botUser() })
    native.rest.respond(`GET /guilds/${f.ids.guild}`, { body: f.guild({ owner_id: f.ids.user }) })
    native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.bot}`, { body: f.member({ user: f.botUser(), roles: [botRole.id], communication_disabled_until: null }) })
    native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: f.member({ joined_at: joinedAt, roles: [], communication_disabled_until: null }) })
    native.rest.respond(`GET /guilds/${f.ids.guild}/roles`, { body: [everyone, botRole] })
    native.rest.respond(`GET /channels/${f.ids.channel}`, { body: f.channel() })
    return { f, joinedAt, everyone, botRole, self }
}

test("greeting reads preserve current human epoch and need only message permissions, including for an owner", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f, joinedAt, self } = routes(native)
        const member = yield* readWelcomeMember(native.client, f.ids.guild, f.ids.user, { expectedJoinedAt: joinedAt })
        assert.equal(member.context?.joinedAt, joinedAt)
        assert.equal(member.context?.userId, f.ids.user)
        assert.equal(member.memberAbsent, false)
        const destination = yield* readWelcomeDestination(native.client, f.ids.guild, f.ids.channel, true)
        assert.equal(destination.botAuthorized, true)
        assert.equal(destination.channel.id, f.ids.channel)
        assert.equal(self.requests().length, 2)
        assert(native.requests().every(request => request.method === "GET"))
    })))
})

test("greeting eligibility never reuses native membership or destination permission snapshots", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f, joinedAt, botRole, everyone } = routes(native)
        yield* readWelcomeMember(native.client, f.ids.guild, f.ids.user, { expectedJoinedAt: joinedAt })
        yield* readWelcomeDestination(native.client, f.ids.guild, f.ids.channel)
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: f.member({ joined_at: "2026-10-01T12:00:00.123456788Z" }) })
        assert(Exit.isFailure(yield* Effect.exit(readWelcomeMember(native.client, f.ids.guild, f.ids.user, { expectedJoinedAt: joinedAt }))))
        native.rest.respond(`GET /guilds/${f.ids.guild}/roles`, { body: [everyone, f.role({ id: botRole.id, permissions: "0" })] })
        assert(Exit.isFailure(yield* Effect.exit(readWelcomeDestination(native.client, f.ids.guild, f.ids.channel))))
        assert(native.requests().every(request => request.method === "GET"))
    })))
})

test("only an explicit typed member404 proves absence, while read failures retain no private body", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f } = routes(native)
        const path = `GET /guilds/${f.ids.guild}/members/${f.ids.user}`
        native.rest.respond(path, { status: 404, body: { message: "Synthetic private missing-member body" } })
        const absent = yield* readWelcomeMember(native.client, f.ids.guild, f.ids.user, { allowAbsent: true })
        assert.equal(absent.memberAbsent, true)
        assert.equal(absent.context, null)
        assert.equal(absent.memberOriginServerId, f.ids.guild)
        assert.equal(absent.memberUserId, f.ids.user)
        assert(Exit.isFailure(yield* Effect.exit(readWelcomeMember(native.client, f.ids.guild, f.ids.user))))
        native.rest.respond(path, { status: 403, body: { message: "Synthetic private forbidden-member body" } })
        const forbidden = yield* Effect.exit(readWelcomeMember(native.client, f.ids.guild, f.ids.user, { allowAbsent: true }))
        assert(Exit.isFailure(forbidden))
        assert(forbidden.cause.reasons.some(reason => reason._tag === "Fail" && reason.error instanceof WelcomePermissionError && reason.error.status === 403))
        assert(!JSON.stringify(forbidden).includes("Synthetic private"))
    })))
})

test("bot identities never become human greeting recipients and raw equivalent epoch spellings are distinct", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f, joinedAt } = routes(native)
        assert(Exit.isFailure(yield* Effect.exit(readWelcomeMember(native.client, f.ids.guild, f.ids.bot))))
        assert(Exit.isFailure(yield* Effect.exit(readWelcomeMember(native.client, f.ids.guild, f.ids.user, { expectedJoinedAt: "2026-10-01T12:00:00.123456789+00:00" }))))
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: f.member({ user: f.botUser({ id: f.ids.user }), joined_at: joinedAt }) })
        assert(Exit.isFailure(yield* Effect.exit(readWelcomeMember(native.client, f.ids.guild, f.ids.user))))
        assert(native.requests().every(request => request.method === "GET"))
    })))
})

test("destination checks enforce channel overwrites, embeds, channel kind and the bot timeout", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f, botRole, everyone } = routes(native)
        native.rest.respond(`GET /channels/${f.ids.channel}`, { body: f.channel({ type: ChannelType.Announcement }) })
        yield* readWelcomeDestination(native.client, f.ids.guild, f.ids.channel, true)
        native.rest.respond(`GET /guilds/${f.ids.guild}/roles`, { body: [everyone, f.role({ id: botRole.id, permissions: (Permissions.ViewChannel | Permissions.SendMessages).toString() })] })
        yield* readWelcomeDestination(native.client, f.ids.guild, f.ids.channel)
        assert(Exit.isFailure(yield* Effect.exit(readWelcomeDestination(native.client, f.ids.guild, f.ids.channel, true))))
        native.rest.respond(`GET /channels/${f.ids.channel}`, { body: f.channel({ permission_overwrites: [{ id: f.ids.bot, type: 1, allow: "0", deny: Permissions.SendMessages.toString() }] }) })
        assert(Exit.isFailure(yield* Effect.exit(readWelcomeDestination(native.client, f.ids.guild, f.ids.channel))))
        native.rest.respond(`GET /channels/${f.ids.channel}`, { body: f.channel({ type: ChannelType.Voice }) })
        assert(Exit.isFailure(yield* Effect.exit(readWelcomeDestination(native.client, f.ids.guild, f.ids.channel))))
        native.rest.respond(`GET /channels/${f.ids.channel}`, { body: f.channel() })
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.bot}`, { body: f.member({ user: f.botUser(), roles: [botRole.id], communication_disabled_until: "2099-01-01T00:00:00Z" }) })
        assert(Exit.isFailure(yield* Effect.exit(readWelcomeDestination(native.client, f.ids.guild, f.ids.channel))))
    })))
})

test("private greeting channels bind the exact human and authenticated bot through actual SDK wire replies", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f } = routes(native)
        const id = f.nextId()
        const base = { id, type: 1, recipients: [f.user()], last_message_id: null }
        for (const recipients of [[f.user()], [f.user(), f.botUser()]]) {
            native.rest.respond(`GET /channels/${id}`, { body: { ...base, recipients } })
            const channel = yield* native.client.directMessages.fetch(id)
            assert.equal((yield* verifyWelcomePrivateChannel(channel, f.ids.user, f.ids.bot)).id, id)
        }
        for (const changes of [{ recipients: [f.user({ id: f.nextId() })] },
            { recipients: [f.user(), f.user({ id: f.nextId() })] },
            { recipients: [f.botUser({ id: f.ids.user })] },
            { type: 3, owner_id: f.ids.user, recipients: [f.user()] }]) {
            native.rest.respond(`GET /channels/${id}`, { body: { ...base, ...changes } })
            assert(Exit.isFailure(yield* Effect.exit(native.client.directMessages.fetch(id).pipe(Effect.flatMap(channel => verifyWelcomePrivateChannel(channel, f.ids.user, f.ids.bot))))))
        }
    })))
})

test("omitted or invalid timeout observations never become proof of greeting eligibility", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f, joinedAt, botRole } = routes(native)
        const { communication_disabled_until: _memberTimeout, ...unknownMember } = f.member({ joined_at: joinedAt })
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: unknownMember })
        assert(Exit.isFailure(yield* Effect.exit(readWelcomeMember(native.client, f.ids.guild, f.ids.user))))
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: f.member({ joined_at: joinedAt, communication_disabled_until: null }) })
        const { communication_disabled_until: _botTimeout, ...unknownBot } = f.member({ user: f.botUser(), roles: [botRole.id] })
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.bot}`, { body: unknownBot })
        assert(Exit.isFailure(yield* Effect.exit(readWelcomeMember(native.client, f.ids.guild, f.ids.user))))
        assert(Exit.isFailure(yield* Effect.exit(readWelcomeDestination(native.client, f.ids.guild, f.ids.channel))))
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.bot}`, { body: { ...unknownBot, communication_disabled_until: "not-a-deadline" } })
        assert(Exit.isFailure(yield* Effect.exit(readWelcomeMember(native.client, f.ids.guild, f.ids.user))))
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.bot}`, { body: { ...unknownBot, communication_disabled_until: "2099-01-01T00:00:00Z" } })
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { status: 404, body: { message: "Synthetic missing member" } })
        assert(Exit.isFailure(yield* Effect.exit(readWelcomeMember(native.client, f.ids.guild, f.ids.user, { allowAbsent: true }))))
        assert(native.requests().every(request => request.method === "GET"))
    })))
})

test("member observation time stays bound to its native read rather than later destination reads", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f } = routes(native)
        const member = yield* readWelcomeMember(native.client, f.ids.guild, f.ids.user)
        yield* TestClock.adjust("40 seconds")
        const destination = yield* readWelcomeDestination(native.client, f.ids.guild, f.ids.channel)
        assert.equal(destination.observedAt - member.observedAt, 40_000)
        assert.equal(member.context?.userId, f.ids.user)
    })).pipe(Effect.provide(TestClock.layer())))
})

test("returned native message identity accepts omitted optional metadata but never a foreign author, channel, guild or webhook", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f } = routes(native)
        for (const variation of ["omitted", "guild", "author", "channel", "webhook", "unproved"] as const) {
            const raw = f.message({ author: f.botUser(), content: "Synthetic greeting" })
            const { guild_id: _guild, ...withoutGuild } = raw
            const { bot: _bot, ...author } = raw.author
            const body: { id: string, author: Record<string, unknown>, [key: string]: unknown } = { ...withoutGuild, author }
            if (variation === "guild") body.guild_id = f.nextId()
            if (variation === "author") body.author.id = f.nextId()
            if (variation === "channel") body.channel_id = f.nextId()
            if (variation === "webhook") body.webhook_id = f.nextId()
            native.rest.respond(`GET /channels/${f.ids.channel}/messages/${body.id}`, { body })
            const result = yield* Effect.exit(native.client.messages.fetch({ channelId: f.ids.channel, id: body.id }).pipe(Effect.flatMap(message =>
                verifyWelcomeMessage(message, { botId: f.ids.bot, channelId: f.ids.channel, messageId: body.id,
                    serverId: f.ids.guild, ...(variation !== "unproved" ? { verifiedChannel: { id: f.ids.channel, guildId: f.ids.guild } } : {}) }))))
            if (variation === "omitted") { assert(Exit.isSuccess(result)); assert.equal(result.value.id, body.id) }
            else assert(Exit.isFailure(result), variation)
        }
    })))
})

for (const [label, sdkDeadline, advance] of [["five-second greeting read bound", 10_000, "5 seconds"], ["shorter native SDK read deadline", 1_000, "1 second"]] as const) {
    test(label, async () => {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const native = yield* createTestClient({ rest: { defaultTimeoutMs: sdkDeadline }, logging: { level: "silent" } })
            const { f } = routes(native)
            const entered = Deferred.makeUnsafe<void>()
            const release = Deferred.makeUnsafe<void>()
            native.rest.respond("GET /users/@me", () => Effect.runPromise(Effect.gen(function* () {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(release)
                return { body: f.botUser() }
            })))
            const fiber = yield* Effect.forkChild(readWelcomeMember(native.client, f.ids.guild, f.ids.user))
            yield* Deferred.await(entered)
            yield* TestClock.adjust(advance)
            const result = yield* Fiber.await(fiber)
            assert(Exit.isFailure(result))
            assert(result.cause.reasons.some(reason => reason._tag === "Fail" && reason.error instanceof WelcomePermissionError && reason.error.kind === "timeout"))
            assert.equal(native.requests().length, 1)
            yield* Deferred.succeed(release, undefined)
        })).pipe(Effect.provide(TestClock.layer())))
    })
}
