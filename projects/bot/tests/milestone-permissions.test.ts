import assert from "node:assert/strict"
import test from "node:test"
import { createTestClient } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Exit } from "effect"
import { readMilestoneMembership, verifyMilestonePrivateAuthor } from "../src/milestone-permissions.ts"

test("milestone membership preserves raw submillisecond epoch and only typed provider404 proves absence", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } }), f = native.fixtures
        const path = `GET /guilds/${f.ids.guild}/members/${f.ids.user}`, raw = "2020-02-29T00:00:00.123456789+00:00"
        native.rest.respond(path, { body: f.member({ joined_at: raw, communication_disabled_until: null }) })
        const present = yield* readMilestoneMembership(native.client, f.ids.guild, f.ids.user)
        assert.equal(present.status, "present"); if (present.status === "present") assert.equal(present.member.joinedAt, raw)
        native.rest.respond(path, { status: 404, body: { message: "Synthetic absence" } })
        assert.equal((yield* readMilestoneMembership(native.client, f.ids.guild, f.ids.user)).status, "absent")
        for (const status of [403, 500]) {
            native.rest.respond(path, { status, body: { message: "Synthetic unavailable" } })
            assert(Exit.isFailure(yield* Effect.exit(readMilestoneMembership(native.client, f.ids.guild, f.ids.user))))
        }
        native.rest.respond(path, { body: f.member({ user: f.user({ id: f.nextId() }), joined_at: raw, communication_disabled_until: null }) })
        assert(Exit.isFailure(yield* Effect.exit(readMilestoneMembership(native.client, f.ids.guild, f.ids.user))))
        assert(native.requests().every(request => request.method === "GET"))
    })))
})
test("milestone private authentication requires exact one-to-one human and works without guild membership", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const native = yield* createTestClient({ logging: { level: "silent" } }), f = native.fixtures, channelId = f.nextId()
        native.rest.respond("GET /users/@me", { body: f.botUser() })
        const dm = { id: channelId, type: 1, recipients: [f.user()], last_message_id: null }
        native.rest.respond(`GET /channels/${channelId}`, { body: dm })
        const verified = yield* verifyMilestonePrivateAuthor(native.client, channelId, f.ids.user)
        assert.equal(verified.botId, f.ids.bot)
        for (const recipients of [[f.user(), f.user({ id: f.nextId() })], [f.user(), f.botUser({ id: f.nextId() })], [f.user(), f.user()], [f.botUser()]]) {
            native.rest.respond(`GET /channels/${channelId}`, { body: { ...dm, recipients } })
            assert(Exit.isFailure(yield* Effect.exit(verifyMilestonePrivateAuthor(native.client, channelId, f.ids.user))))
        }
        assert(!native.requests().some(request => request.path.startsWith("/guilds/")))
        assert(native.requests().every(request => request.method === "GET"))
    })))
})
