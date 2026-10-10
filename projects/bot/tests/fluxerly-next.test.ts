// The local stand-ins for Fluxerly cache reads: what makes a server's role list complete, what keeps roles and channels
// current and what forgets them. Unknown always means a Fluxer read
import assert from "node:assert/strict"
import test from "node:test"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { createBotOptions } from "../src/bot.ts"
import { fluxerlyNext, rememberRole } from "../src/fluxerly-next.ts"
import { readSafetyAuthority } from "../src/safety-permissions.ts"
import { platform, token } from "./moderation-fixture.ts"

const createBot = () => createTestBot(createBotOptions({ token, serverId: "1456074443980800001" }))
type Bot = Effect.Success<ReturnType<typeof createBot>>
const run = (body: (bot: Bot, p: ReturnType<typeof platform>, local: ReturnType<typeof fluxerlyNext>) => Effect.Effect<void, unknown>) =>
    Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createBot()
        const p = platform(bot)
        yield* bot.ready()
        yield* body(bot, p, fluxerlyNext(bot.client))
        assert.equal(bot.failures().length, 0)
    })).pipe(Effect.provide(TestClock.layer())))
const roleIds = (local: ReturnType<typeof fluxerlyNext>, serverId: string) => local.roles.getAll(serverId).pipe(Effect.map(roles => roles?.map(role => role.id)))

test("a server's role list becomes complete from a full read, follows role events and is forgotten when the server becomes unavailable", async () => {
    await run((bot, p, local) => Effect.gen(function* () {
        const serverId = bot.fixtures.ids.guild
        assert.equal(yield* roleIds(local, serverId), undefined)
        yield* local.roles.fetchAll(serverId)
        assert.deepEqual(yield* roleIds(local, serverId), p.roles.map(role => role.id))
        const added = bot.fixtures.role({ position: 4 })
        yield* bot.emit("GUILD_ROLE_CREATE", { guild_id: serverId, role: added })
        yield* bot.emit("GUILD_ROLE_UPDATE", { guild_id: serverId, role: { ...p.targetRole, permissions: Permissions.KickMembers.toString() } })
        yield* bot.emit("GUILD_ROLE_DELETE", { guild_id: serverId, role_id: p.actorRole.id })
        yield* bot.idle()
        const roles = (yield* local.roles.getAll(serverId))!
        assert.deepEqual(roles.map(role => role.id), [serverId, p.botRole.id, p.targetRole.id, added.id])
        assert.equal(roles.find(role => role.id === p.targetRole.id)!.permissions, Permissions.KickMembers)
        assert.equal(p.rolesRoute.requests().length, 1)
        yield* bot.emit("GUILD_DELETE", { id: serverId, unavailable: true })
        yield* bot.idle()
        assert.equal(yield* roleIds(local, serverId), undefined)
        // Becoming available again forgets a list read while the server was away
        yield* local.roles.fetchAll(serverId)
        yield* bot.emit("GUILD_CREATE", bot.fixtures.guildCreate())
        yield* bot.idle()
        assert.equal(yield* roleIds(local, serverId), undefined)
    }))
})

test("a role read that overlapped a role event is used once but not kept", async () => {
    await run((bot, p, local) => Effect.gen(function* () {
        const serverId = bot.fixtures.ids.guild
        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })
        const read = bot.rest.respond("GET /guilds/:id/roles", async () => { await gate; return { body: p.roles } })
        const fetched = yield* Effect.forkChild(local.roles.fetchAll(serverId))
        yield* read.next()
        rememberRole(bot.client, { ...p.targetRole, guildId: serverId, permissions: Permissions.KickMembers } as never)
        release()
        assert.equal((yield* Fiber.join(fetched)).length, p.roles.length)
        assert.equal(yield* roleIds(local, serverId), undefined)
    }))
})

test("channel and thread snapshots follow channel events, and category and bulk changes forget the server's channels", async () => {
    await run((bot, p, local) => Effect.gen(function* () {
        const f = bot.fixtures, serverId = f.ids.guild, text = f.ids.channel
        const thread = f.thread({ parent_id: text }), other = f.channel({ id: f.nextId() }), category = f.channel({ id: f.nextId(), type: 4 })
        bot.rest.respond(`GET /channels/${thread.id}`, { body: thread })
        bot.rest.respond(`GET /channels/${other.id}`, { body: other })
        const held = (id: string) => local.channels.get(id).pipe(Effect.map(channel => channel !== undefined))
        for (const id of [text, thread.id, other.id]) yield* local.channels.fetch(id)
        // A change replaces the kept snapshot without a read
        yield* bot.emit("CHANNEL_UPDATE", f.channel({ topic: "Changed" }))
        yield* bot.idle()
        assert.equal(((yield* local.channels.get(text)) as { topic?: string | null }).topic, "Changed")
        // A deleted channel takes its threads
        yield* bot.emit("CHANNEL_DELETE", f.channel())
        yield* bot.idle()
        assert.deepEqual([yield* held(text), yield* held(thread.id), yield* held(other.id)], [false, false, true])
        yield* bot.emit("CHANNEL_UPDATE", category)
        yield* bot.idle()
        assert.equal(yield* held(other.id), false)
        yield* local.channels.fetch(other.id)
        yield* bot.emit("CHANNEL_UPDATE_BULK", { guild_id: serverId, channels: [other] })
        yield* bot.idle()
        assert.equal(yield* held(other.id), false)
        assert.equal(p.channel.requests().length, 1)
    }))
})

test("a lost gateway connection forgets every server's roles and channels", async () => {
    await run((bot, _, local) => Effect.gen(function* () {
        const serverId = bot.fixtures.ids.guild
        yield* local.roles.fetchAll(serverId)
        yield* local.channels.fetch(bot.fixtures.ids.channel)
        yield* bot.disconnect()
        yield* TestClock.adjust("2 minutes")
        yield* bot.idle()
        assert.equal(bot.counters().reconnects, 1)
        assert.equal(yield* roleIds(local, serverId), undefined)
        assert.equal(yield* local.channels.get(bot.fixtures.ids.channel), undefined)
    }))
})

test("evaluation reads each input once and then cached copies, rereads roles a member holds unknown, and actions always read Fluxer", async () => {
    await run((bot, p, local) => Effect.gen(function* () {
        const f = bot.fixtures, serverId = f.ids.guild
        const reads = () => [p.guildRoute, p.rolesRoute, p.actor, p.ownMember, p.channel].map(route => route.requests().length)
        const evaluate = readSafetyAuthority(bot.client, serverId, f.ids.user, { channelId: f.ids.channel, cached: true })
        assert.equal((yield* evaluate).isOwner, true)
        assert.deepEqual(reads(), [1, 1, 1, 1, 1])
        // The bot's own member comes from the member cache
        assert.equal((yield* local.members.getSelf(serverId))?.userId, f.ids.bot)
        yield* evaluate
        assert.deepEqual(reads(), [1, 1, 1, 1, 1])
        // A member update naming a role the kept list lacks shows that the list missed a change
        const unseen = f.role({ position: 5, permissions: Permissions.BanMembers.toString() })
        p.rolesRoute.remove()
        const roles = bot.rest.respond("GET /guilds/:id/roles", { body: [...p.roles, unseen] })
        yield* bot.emit("GUILD_MEMBER_UPDATE", f.member({ roles: [p.actorRole.id, unseen.id], communication_disabled_until: null }))
        yield* bot.idle()
        assert.equal((yield* evaluate).roles.some(role => role.id === unseen.id), true)
        assert.equal(roles.requests().length, 1)
        assert.deepEqual(reads().slice(2), [1, 1, 1])
        // Without cached, as for an action, every input is read again
        yield* readSafetyAuthority(bot.client, serverId, f.ids.user, { channelId: f.ids.channel })
        assert.deepEqual([...reads().slice(0, 1), roles.requests().length, ...reads().slice(2)], [2, 2, 2, 2, 2])
    }))
})
