import assert from "node:assert/strict"
import test from "node:test"
import type { ModerationManageRequest } from "@neonflux/contracts/moderation"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createFixtures, createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted } from "effect"
import { createBotOptions } from "../src/bot.ts"
import { createPrivateDataStore, processPrivateAccessPass } from "../src/private-data.ts"
import { fakeClient } from "./backend-fake.ts"
import { boundary, platform, token } from "./moderation-fixture.ts"

test("Access checks read each waiting viewer fresh with the bot's own token and report ownership, membership and roles, never permissions", async () => {
    const recorded: unknown[] = []
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: Redacted.value(token) }), f = bot.fixtures
        // The viewer is an Administrator who is not the owner, and a second viewer has left the server
        const p = platform(bot, { actorOwner: false, actorPermissions: Permissions.Administrator })
        const absent = f.nextId()
        bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${absent}`, { status: 404, body: { code: "UNKNOWN_MEMBER", message: "Synthetic absent" } })
        let checks = [{ userId: f.ids.user }, { userId: absent }]
        const store = createPrivateDataStore({ url: "https://synthetic.invalid", secret: Redacted.make("synthetic"), serverId: f.ids.guild, client: fakeClient(call => {
            if (call.path === "/private-data/ready") return { checks }
            assert.equal(call.path, "/private-data/record")
            recorded.push(call.body)
            return { recorded: true }
        }) })
        yield* bot.ready()
        yield* processPrivateAccessPass(store, f.ids.guild, bot.client)
        const viewer = { serverId: f.ids.guild, userId: f.ids.user, originServerId: f.ids.guild, isOwner: false, present: true }
        assert.deepEqual(recorded.splice(0), [{ ...viewer, roleIds: [p.actorRole.id] },
            { serverId: f.ids.guild, userId: absent, originServerId: f.ids.guild, isOwner: false, present: false, roleIds: [] }])

        // The next check reads the member again, so a removed role shows at once
        checks = [{ userId: f.ids.user }]
        assert.equal(p.actor.requests().length, 1)
        p.actor.remove()
        const withoutRole = bot.rest.respond(`GET /guilds/${f.ids.guild}/members/${f.ids.user}`, { body: f.member({ roles: [], communication_disabled_until: null }) })
        yield* processPrivateAccessPass(store, f.ids.guild, bot.client)
        assert.equal(withoutRole.requests().length, 1)
        assert.deepEqual(recorded.splice(0), [{ ...viewer, roleIds: [] }])

        // A server read that fails reports the check as failed instead of guessing
        p.guildRoute.remove()
        bot.rest.respond("GET /guilds/:id", { status: 403, body: { code: "MISSING_ACCESS", message: "Synthetic denied" } })
        yield* processPrivateAccessPass(store, f.ids.guild, bot.client)
        assert.deepEqual(recorded.splice(0), [{ serverId: f.ids.guild, userId: f.ids.user, failed: true }])
        assert.equal(bot.failures().length, 0)
    })))
})

test("The owner's check reports ownership", async () => {
    const recorded: unknown[] = []
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: Redacted.value(token) }), f = bot.fixtures
        platform(bot, { actorPermissions: 0n })
        const store = createPrivateDataStore({ url: "https://synthetic.invalid", secret: Redacted.make("synthetic"), serverId: f.ids.guild, client: fakeClient(call => {
            if (call.path === "/private-data/ready") return { checks: [{ userId: f.ids.user }] }
            recorded.push(call.body)
            return { recorded: true }
        }) })
        yield* bot.ready()
        yield* processPrivateAccessPass(store, f.ids.guild, bot.client)
    })))
    assert.equal((recorded[0] as { isOwner: boolean }).isOwner, true)
})

test("!mod private-role sends a verified role or none to the backend and confirms the change", async () => {
    const f = createFixtures()
    const managed: ModerationManageRequest[] = []
    const b = boundary({ manage: (input) => {
        managed.push(input)
        return Effect.succeed(input.operation.type === "private-role" ? { duplicate: false, type: "private-role", roleId: input.operation.roleId } : { duplicate: true })
    } })
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const bot = yield* createTestBot(createBotOptions({ token, serverId: f.ids.guild }, { moderation: b.store }))
        const p = platform(bot)
        yield* bot.ready()
        const say = (content: string) => Effect.gen(function* () {
            const before = p.replies.requests().length
            yield* bot.emit("MESSAGE_CREATE", bot.fixtures.message({ content })).pipe(Effect.andThen(bot.idle()))
            return p.replies.requests().slice(before).map(row => (row.body as { content: string }).content)
        })
        assert.deepEqual(yield* say(`!mod private-role <@&${p.actorRole.id}>`),
            [`Private data role: <@&${p.actorRole.id}>. Members with it and the server owner can view private cases on the website`])
        assert.deepEqual(yield* say("!mod private-role none"), ["Private data role cleared. Only the server owner can view private cases on the website"])
        // A role that is not in the server never reaches the backend
        assert.deepEqual(yield* say(`!mod private-role ${f.nextId()}`), ["NeonFlux couldn't check permissions, the current state or your DMs, so nothing was retried"])
        assert.deepEqual(yield* say("!mod private-role"), ["Check quoting and values. Use !mod help for examples"])
        assert.deepEqual(managed.map(input => [input.operation, input.actor.isOwner]), [[{ type: "private-role", roleId: p.actorRole.id }, true], [{ type: "private-role", roleId: null }, true]])
        assert.equal(bot.failures().length, 0)
    })))
})
