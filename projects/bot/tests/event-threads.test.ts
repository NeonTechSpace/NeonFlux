import assert from "node:assert/strict"
import test from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Effect, type Scope } from "effect"
import { TestClock } from "effect/testing"
import { processEventThread } from "../src/events.ts"
import { processEventsPass } from "../src/event-worker.ts"
import { readCommandChannel } from "../src/fluxerly-next.ts"
import { parseEventCommand } from "../src/event-command.ts"
import { eventsBoundary } from "./event-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"

const controlled = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Effect.scoped(work).pipe(Effect.provide(TestClock.layer())))
const recorded = (calls: { method: string, input: unknown }[]) => calls.filter(c => c.method === "delivery").map(c => (c.input as C.EventsDeliveryRequest).operation)

test("a sent card gets a week-long discussion thread named after the event, recorded by the message's ID", async () => {
    await controlled(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-thread-token" }), f = bot.fixtures, messageId = f.nextId()
        const create = bot.rest.respond(`POST /channels/${f.ids.channel}/messages/${messageId}/threads`, { status: 201, body: f.thread({ id: messageId, parent_id: f.ids.channel, owner_id: f.ids.bot }) })
        const remote = eventsBoundary()
        yield* processEventThread(remote.store, f.ids.guild, bot.client, { eventNo: 1, channelId: f.ids.channel, title: "Gathering", action: "open", messageId })
        assert.deepEqual(create.requests()[0]!.body, { name: "Gathering", auto_archive_duration: 10080 })
        assert.deepEqual(recorded(remote.calls), [{ type: "thread", eventNo: 1, outcome: "opened", threadId: messageId }])
    }))
})

test("a thread an earlier attempt already started is found by the card's ID instead of a second thread", async () => {
    await controlled(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-thread-token" }), f = bot.fixtures, messageId = f.nextId()
        const create = bot.rest.respond(`POST /channels/${f.ids.channel}/messages/${messageId}/threads`, { status: 400, body: { code: "THREAD_ALREADY_CREATED_FOR_MESSAGE", message: "Synthetic existing thread" } })
        bot.rest.respond(`GET /channels/${messageId}`, { body: f.thread({ id: messageId, parent_id: f.ids.channel, owner_id: f.ids.bot }) })
        const remote = eventsBoundary()
        yield* processEventThread(remote.store, f.ids.guild, bot.client, { eventNo: 1, channelId: f.ids.channel, title: "Gathering", action: "open", messageId })
        assert.equal(create.requests().length, 1)
        assert.deepEqual(recorded(remote.calls), [{ type: "thread", eventNo: 1, outcome: "opened", threadId: messageId }])
    }))
})

test("after the event an archived thread is reopened, then archived and locked together, and a deleted one counts as closed", async () => {
    await controlled(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-thread-token" }), f = bot.fixtures
        const thread = f.thread({ parent_id: f.ids.channel, owner_id: f.ids.bot }), archived = { ...thread, thread_metadata: { ...thread.thread_metadata, archived: true } }
        bot.rest.respond(`GET /channels/${thread.id}`, { body: archived })
        const edit = bot.rest.respond(`PATCH /channels/${thread.id}`, { body: thread })
        const remote = eventsBoundary(), missing = f.nextId()
        bot.rest.respond(`GET /channels/${missing}`, { status: 404, body: { code: "UNKNOWN_CHANNEL", message: "Synthetic missing thread" } })
        yield* processEventThread(remote.store, f.ids.guild, bot.client, { eventNo: 1, channelId: f.ids.channel, title: "Gathering", action: "close", threadId: thread.id })
        yield* processEventThread(remote.store, f.ids.guild, bot.client, { eventNo: 2, channelId: f.ids.channel, title: "Other", action: "close", threadId: missing })
        assert.deepEqual(edit.requests().map(r => r.body), [{ archived: false }, { archived: true, locked: true }])
        assert.deepEqual(recorded(remote.calls), [{ type: "thread", eventNo: 1, outcome: "closed" }, { type: "thread", eventNo: 2, outcome: "closed" }])
    }))
})

test("a refused thread waits a minute instead of failing the events pass", async () => {
    await controlled(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-thread-token" }), f = bot.fixtures, messageId = f.nextId()
        bot.rest.respond(`POST /channels/${f.ids.channel}/messages/${messageId}/threads`, { status: 403, body: { code: "MISSING_PERMISSIONS", message: "Synthetic missing permission" } })
        bot.rest.respond(`GET /channels/${messageId}`, { status: 404, body: { code: "UNKNOWN_CHANNEL", message: "Synthetic missing thread" } })
        const work: C.EventsThreadWork = { eventNo: 1, channelId: f.ids.channel, title: "Gathering", action: "open", messageId }
        const remote = eventsBoundary({ delivery: input => Effect.sync(() => { remote.calls.push({ method: "delivery", input }); return input.operation.type === "list" ? { type: "deliveries", deliveries: [], threads: [work] } as const : { type: "progress", recorded: true } as const }) })
        const result = yield* processEventsPass(remote.store, publishingBoundary().store, f.ids.guild, bot.client)
        assert.equal(result.considered, 1)
        assert.deepEqual(recorded(remote.calls).slice(1), [{ type: "thread", eventNo: 1, outcome: "deferred" }])
    }))
})

test("a command in a forum post counts as in the forum, and one in a text channel's thread stays in the thread", async () => {
    await controlled(Effect.gen(function* () {
        const bot = yield* createTestBot({ token: "synthetic-thread-token" }), f = bot.fixtures
        const forum = f.forumChannel(), post = f.thread({ parent_id: forum.id }), side = f.thread({ parent_id: f.ids.channel })
        for (const channel of [forum, post, side, f.channel()]) bot.rest.respond(`GET /channels/${channel.id}`, { body: channel })
        assert.equal(yield* readCommandChannel(bot.client, post.id), forum.id)
        assert.equal(yield* readCommandChannel(bot.client, side.id), side.id)
        assert.equal(yield* readCommandChannel(bot.client, f.ids.channel), f.ids.channel)
    }))
})

test("event discussion threads turn on and off with the settings revision", () => {
    assert.deepEqual(parseEventCommand(["threads", "on", "3"]), { type: "manage", operation: { type: "threads", enabled: true, expectedRevision: 3 } })
    assert.deepEqual(parseEventCommand(["threads", "off", "4"]), { type: "manage", operation: { type: "threads", enabled: false, expectedRevision: 4 } })
    assert("error" in parseEventCommand(["threads", "maybe", "4"]))
})
