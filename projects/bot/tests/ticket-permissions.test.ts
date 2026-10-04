import assert from "node:assert/strict"
import test from "node:test"
import { ChannelType, Permissions } from "@neontechspace/fluxerly/effect"
import { createTestClient, type TestClient } from "@neontechspace/fluxerly/effect/testing"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { nativeTicketOverwrites, readTicketAuthority, snapshotTicketChannel, TicketPermissionError, verifyTicketChannelIdentity, verifyTicketPrivateAuthor } from "../src/ticket-permissions.ts"

function routes(native: TestClient) {
    const f = native.fixtures
    const joinedAt = "2026-10-01T12:00:00.123456789Z"
    const ownerId = f.nextId()
    const everyone = f.role({ id: f.ids.guild, permissions: (Permissions.ViewChannel | Permissions.ReadMessageHistory | Permissions.SendMessages).toString() })
    const botRole = f.role({ position: 10, permissions: (Permissions.ViewChannel | Permissions.ReadMessageHistory | Permissions.SendMessages | Permissions.ManageChannels | Permissions.ManageRoles).toString() })
    const supportRole = f.role({ position: 1, permissions: Permissions.Administrator.toString() })
    const parentId = f.nextId()
    native.rest.respond("GET /users/@me", { body: f.botUser() })
    native.rest.respond(`GET /guilds/${f.ids.guild}`, { body: f.guild({ owner_id: ownerId }) })
    native.rest.respond(`GET /guilds/${f.ids.guild}/roles`, { body: [everyone, botRole, supportRole] })
    native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: f.member({ roles: [], joined_at: joinedAt, communication_disabled_until: null }) })
    native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.bot}`, { body: f.member({ user: f.botUser(), roles: [botRole.id], communication_disabled_until: null }) })
    native.rest.respond(`GET /channels/${f.ids.channel}`, { body: f.channel({ parent_id: null, permission_overwrites: [] }) })
    native.rest.respond(`GET /channels/${parentId}`, { body: f.channel({ id: parentId, type: ChannelType.Category, permission_overwrites: [] }) })
    return { f, joinedAt, ownerId, everyone, botRole, supportRole, parentId }
}

test("ticket metadata reads need fresh human membership but no management permissions or active bot", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f, joinedAt, everyone, botRole, supportRole } = routes(native)
        native.rest.respond(`GET /guilds/${f.ids.guild}/roles`, { body: [everyone, f.role({ id: botRole.id, permissions: "0" }), supportRole] })
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.bot}`, { body: f.member({ user: f.botUser(), roles: [botRole.id], communication_disabled_until: "2099-01-01T00:00:00Z" }) })
        const facts = yield* readTicketAuthority(native.client, f.ids.guild, f.ids.user)
        assert.equal(facts.context.actor.userId, f.ids.user)
        assert.equal(facts.context.actor.joinedAt, joinedAt)
        assert.equal(facts.context.actor.isAdministrator, false)
        assert.equal(facts.context.actor.privateChannelVerified, false)
        assert.equal(facts.context.channel, undefined)
        assert.equal(facts.context.actor.canReadHistory, false)
        assert(Exit.isFailure(yield* Effect.exit(readTicketAuthority(native.client, f.ids.guild, f.ids.user, { botPermission: Permissions.ManageRoles }))))
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { status: 404, body: { message: "Synthetic private membership" } })
        const failure = yield* Effect.exit(readTicketAuthority(native.client, f.ids.guild, f.ids.user))
        assert(Exit.isFailure(failure))
        assert(!JSON.stringify(failure).includes("Synthetic private membership"))
        assert(native.requests().every(request => request.method === "GET"))
    })))
})

test("ticket channel authorization separates guild and channel bits and refreshes all mutable permission facts", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f, botRole, everyone, supportRole } = routes(native)
        const facts = yield* readTicketAuthority(native.client, f.ids.guild, f.ids.user, { channelId: f.ids.channel,
            actorPermission: Permissions.ViewChannel | Permissions.ReadMessageHistory, botPermission: Permissions.ManageRoles })
        assert.equal(facts.context.actor.canReadHistory, true)
        assert.equal(facts.context.actor.canSend, true)
        assert.equal(facts.context.channel?.channelId, f.ids.channel)
        assert.equal(facts.roleSnapshots.find(role => role.roleId === supportRole.id)?.permissions, Permissions.Administrator.toString())
        native.rest.respond(`GET /channels/${f.ids.channel}`, { body: f.channel({ parent_id: null,
            permission_overwrites: [{ id: f.ids.user, type: 1, allow: "0", deny: Permissions.ViewChannel.toString() }] }) })
        assert(Exit.isFailure(yield* Effect.exit(readTicketAuthority(native.client, f.ids.guild, f.ids.user, {
            channelId: f.ids.channel, actorPermission: Permissions.ViewChannel }))))
        native.rest.respond(`GET /channels/${f.ids.channel}`, { body: f.channel({ parent_id: null, permission_overwrites: [] }) })
        native.rest.respond(`GET /guilds/${f.ids.guild}/roles`, { body: [everyone, f.role({ id: botRole.id, permissions: "0" }), supportRole] })
        assert(Exit.isFailure(yield* Effect.exit(readTicketAuthority(native.client, f.ids.guild, f.ids.user, { channelId: f.ids.channel, botPermission: Permissions.ManageRoles }))))
        assert(native.requests().every(request => request.method === "GET"))
    })))
})

test("only exact typed channel404 is an absent observation and never grants mutation or retirement authority", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f } = routes(native)
        const path = `GET /channels/${f.ids.channel}`
        native.rest.respond(path, { status: 404, body: { message: "Synthetic private channel" } })
        const facts = yield* readTicketAuthority(native.client, f.ids.guild, f.ids.user, { channelId: f.ids.channel, allowAbsentChannel: true })
        assert.equal(facts.channelAbsent, true)
        assert.equal(facts.context.channel, undefined)
        assert.equal(facts.context.actor.canView, false)
        assert(!("retired" in facts))
        for (const options of [{ channelId: f.ids.channel }, { channelId: f.ids.channel, allowAbsentChannel: true, botPermission: Permissions.ManageChannels }]) {
            assert(Exit.isFailure(yield* Effect.exit(readTicketAuthority(native.client, f.ids.guild, f.ids.user, options))))
        }
        native.rest.respond(path, { status: 403, body: { message: "Synthetic private forbidden channel" } })
        const forbidden = yield* Effect.exit(readTicketAuthority(native.client, f.ids.guild, f.ids.user, { channelId: f.ids.channel, allowAbsentChannel: true }))
        assert(Exit.isFailure(forbidden))
        assert(forbidden.cause.reasons.some(reason => reason._tag === "Fail" && reason.error instanceof TicketPermissionError && reason.error.status === 403))
        assert(!JSON.stringify(forbidden).includes("Synthetic private"))
    })))
})

test("ticket snapshots preserve every native overwrite bit while unsupported writes remain prohibited", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f } = routes(native)
        const unknown = "9223372036854775808"
        native.rest.respond(`GET /channels/${f.ids.channel}`, { body: f.channel({ parent_id: null, permission_overwrites: [
            { id: f.ids.guild, type: 0, allow: unknown, deny: Permissions.SendMessages.toString() },
            { id: f.ids.user, type: 1, allow: Permissions.ReadMessageHistory.toString(), deny: "0" },
        ] }) })
        const facts = yield* readTicketAuthority(native.client, f.ids.guild, f.ids.user, { channelId: f.ids.channel })
        assert.deepEqual(facts.context.channel?.overwrites.map(o => o.type), ["member", "role"])
        assert.equal(facts.context.channel?.overwrites[1]?.allow, unknown)
        assert(Exit.isFailure(yield* Effect.exit(nativeTicketOverwrites(facts.context.channel!.overwrites))))
        native.rest.respond(`GET /channels/${f.ids.channel}`, { body: f.channel({ parent_id: null, permission_overwrites: [
            { id: f.ids.guild, type: 0, allow: Permissions.ViewChannel.toString(), deny: Permissions.SendMessages.toString() },
        ] }) })
        const observed = yield* native.client.channels.fetch(f.ids.channel)
        const snapshot = yield* snapshotTicketChannel(observed)
        const converted = yield* nativeTicketOverwrites(snapshot.overwrites)
        assert.equal(converted[0]?.allow, Permissions.ViewChannel)
        assert.equal(converted[0]?.deny, Permissions.SendMessages)
        assert(native.requests().every(request => request.method === "GET"))
    })))
})

test("native unavailable fields, wrong channel kinds and cross-server parents never become ticket snapshots", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f, parentId } = routes(native)
        const valid = f.channel({ parent_id: null, permission_overwrites: [] })
        for (const missing of ["name", "parent_id", "permission_overwrites"]) {
            const body = { ...valid } as Record<string, unknown>
            delete body[missing]
            native.rest.respond(`GET /channels/${f.ids.channel}`, { body })
            assert(Exit.isFailure(yield* Effect.exit(readTicketAuthority(native.client, f.ids.guild, f.ids.user, { channelId: f.ids.channel }))), missing)
        }
        native.rest.respond(`GET /channels/${f.ids.channel}`, { body: { ...valid, type: ChannelType.Announcement } })
        assert(Exit.isFailure(yield* Effect.exit(readTicketAuthority(native.client, f.ids.guild, f.ids.user, { channelId: f.ids.channel }))))
        for (const change of [{ type: ChannelType.Text }, { guild_id: f.nextId() }]) {
            native.rest.respond(`GET /channels/${parentId}`, { body: f.channel({ id: parentId, type: ChannelType.Category, permission_overwrites: [], ...change }) })
            assert(Exit.isFailure(yield* Effect.exit(readTicketAuthority(native.client, f.ids.guild, f.ids.user, { parentId }))))
        }
        native.rest.respond(`GET /channels/${parentId}`, { body: f.channel({ id: parentId, type: ChannelType.Category, permission_overwrites: [] }) })
        assert.equal((yield* readTicketAuthority(native.client, f.ids.guild, f.ids.user, { parentId })).context.parentVerified, true)
    })))
})

test("a genuine create response retains independently verified channel identity before incomplete state validation", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f } = routes(native)
        const channelId = f.nextId()
        const created = native.rest.respond(`POST /guilds/${f.ids.guild}/channels`, { body: { id: channelId, guild_id: f.ids.guild, type: ChannelType.Text } })
        const channel = yield* native.client.channels.create(f.ids.guild, { type: ChannelType.Text, name: "ticket-synthetic",
            permissionOverwrites: [{ id: f.ids.guild, type: "role", allow: 0n, deny: Permissions.ViewChannel }] })
        const identity = yield* verifyTicketChannelIdentity(channel, { serverId: f.ids.guild })
        assert.equal(identity.channelId, channelId)
        assert(Exit.isFailure(yield* Effect.exit(snapshotTicketChannel(channel))))
        assert.equal(created.requests().length, 1)
        assert(Exit.isFailure(yield* Effect.exit(verifyTicketChannelIdentity(channel, { serverId: f.nextId() }))))
        assert(Exit.isFailure(yield* Effect.exit(verifyTicketChannelIdentity(channel, { serverId: f.ids.guild, channelId: f.nextId() }))))
    })))
})

test("ticket private author verification accepts only exact authenticated bot and current human one-to-one recipients", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f } = routes(native)
        const id = f.nextId()
        const base = { id, type: 1, last_message_id: null, recipients: [f.user()] }
        native.rest.respond(`GET /channels/${id}`, { body: base })
        assert.equal((yield* verifyTicketPrivateAuthor(native.client, id, f.ids.user)).channel.id, id)
        for (const changes of [{ recipients: [f.user(), f.botUser()] }, { recipients: [f.user(), f.user({ id: f.nextId() })] },
            { recipients: [f.botUser({ id: f.ids.user })] }, { type: 3, owner_id: f.ids.user }, { id: f.nextId() }]) {
            native.rest.respond(`GET /channels/${id}`, { body: { ...base, ...changes } })
            const result = yield* Effect.exit(verifyTicketPrivateAuthor(native.client, id, f.ids.user))
            if (changes.recipients?.length === 2 && changes.recipients[1]?.id === f.ids.bot) assert(Exit.isSuccess(result))
            else assert(Exit.isFailure(result))
        }
        assert(Exit.isFailure(yield* Effect.exit(verifyTicketPrivateAuthor(native.client, id, f.ids.bot))))
    })))
})

test("unknown actor epochs, unavailable timeout facts and authenticated bot actors remain fail-closed", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } })
        const { f } = routes(native)
        assert(Exit.isFailure(yield* Effect.exit(readTicketAuthority(native.client, f.ids.guild, f.ids.bot))))
        const { communication_disabled_until: _deadline, ...unknown } = f.member({ roles: [] })
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: unknown })
        assert(Exit.isFailure(yield* Effect.exit(readTicketAuthority(native.client, f.ids.guild, f.ids.user))))
        native.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: f.member({ joined_at: "invalid", communication_disabled_until: null }) })
        assert(Exit.isFailure(yield* Effect.exit(readTicketAuthority(native.client, f.ids.guild, f.ids.user))))
    })))
})

for (const [sdkDeadline, advance] of [[30000, "5 seconds"], [1000, "1 second"]] as const) {
    test(`ticket channel reads preserve the five-second helper deadline and SDK ${sdkDeadline}ms limit`, async () => {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const native = yield* createTestClient({ rest: { defaultTimeoutMs: sdkDeadline }, logging: { level: "silent" } })
            const { f } = routes(native)
            const entered = Deferred.makeUnsafe<void>()
            const release = Deferred.makeUnsafe<void>()
            native.rest.respond(`GET /channels/${f.ids.channel}`, () => Effect.runPromise(Effect.gen(function* () {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(release)
                return { body: f.channel({ parent_id: null, permission_overwrites: [] }) }
            })))
            const fiber = yield* Effect.forkChild(readTicketAuthority(native.client, f.ids.guild, f.ids.user, { channelId: f.ids.channel }))
            yield* Deferred.await(entered)
            yield* TestClock.adjust(advance)
            const result = yield* Fiber.await(fiber)
            assert(Exit.isFailure(result))
            assert(result.cause.reasons.some(reason => reason._tag === "Fail" && reason.error instanceof TicketPermissionError && reason.error.kind === "timeout"))
            assert(native.requests().every(request => request.method === "GET"))
            yield* Deferred.succeed(release, undefined)
        })).pipe(Effect.provide(TestClock.layer())))
    })

    test(`ticket private-channel reads preserve the five-second helper deadline and SDK ${sdkDeadline}ms limit`, { timeout: 10000 }, async () => {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const native = yield* createTestClient({ rest: { defaultTimeoutMs: sdkDeadline }, logging: { level: "silent" } })
            const { f } = routes(native)
            const dmId = f.nextId()
            const entered = Deferred.makeUnsafe<void>()
            const release = Deferred.makeUnsafe<void>()
            native.rest.respond(`GET /channels/${dmId}`, () => Effect.runPromise(Effect.gen(function* () {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(release)
                return { body: { id: dmId, type: 1, recipients: [f.user()] } }
            })))
            const fiber = yield* Effect.forkChild(verifyTicketPrivateAuthor(native.client, dmId, f.ids.user))
            yield* Deferred.await(entered)
            yield* TestClock.adjust(advance)
            const result = yield* Fiber.await(fiber)
            assert(Exit.isFailure(result))
            assert(result.cause.reasons.some(reason => reason._tag === "Fail" && reason.error instanceof TicketPermissionError
                && reason.error.operation === "private-channel" && reason.error.kind === "timeout"))
            yield* Deferred.succeed(release, undefined)
        })).pipe(Effect.provide(TestClock.layer())))
    })
}
