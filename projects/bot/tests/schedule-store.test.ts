import assert from "node:assert/strict"
import test from "node:test"
import { PublishingGrant, PublishingPost, type PublishingAttempt } from "@neonflux/contracts/publishing-base"
import type { SchedulesAutomationContext, SchedulesContext, SchedulesDeliveryRequest, SchedulesManageOperation, SchedulesManageRequest, SchedulesQueryRequest } from "@neonflux/contracts/schedules"
import { createFixtures } from "@neontechspace/fluxerly/effect/testing"
import { Effect, Redacted, Schema } from "effect"
import { createSchedulesStore } from "../src/schedule-store.ts"
import { deriveServiceKey } from "../src/backend-http.ts"
import { scheduleDefinition, scheduleDelivery, scheduleGrant, scheduleNow } from "./schedule-fixture.ts"
import { mockBackend } from "./backend-fake.ts"

const f = createFixtures(), config = { url: "https://synthetic-schedules.convex.cloud", secret: Redacted.make("synthetic-schedule-secret") }
const context: SchedulesContext = { observedAt: scheduleNow, actor: { userId: f.ids.user, roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }, channelId: f.ids.channel, botId: f.ids.bot, actorAuthorized: true, botAuthorized: true,
    member: { userId: f.ids.user, roleIds: [], joinedAt: "2026-01-01T00:00:00Z", isBot: false, timeoutUntil: null, canView: true, canReadHistory: true } }
test("actual schedule adapter sends exact authenticated shared DTOs and rejects changed source, calendar, management revision and storage leaks", async t => {
    const s = scheduleDefinition({ revision: 1, enabled: false }), operation: SchedulesManageOperation = { type: "create", name: s.name, source: s.source, channelId: s.channelId, calendar: s.calendar }
    const input: SchedulesManageRequest = { serverId: f.ids.guild, context, messageId: f.nextId(), createdAt: scheduleNow, operation }
    let value: unknown = { duplicate: false, type: "schedule", schedule: s }
    mockBackend(t, call => {
        assert.equal(call.path, "/schedules/manage"); assert.deepEqual(call.body, input)
        assert.equal(call.key, Redacted.value(deriveServiceKey(config.secret))); assert(!JSON.stringify(call).includes("synthetic-schedule-secret"))
        return value
    })
    const store = createSchedulesStore(config)
    assert.deepEqual(await Effect.runPromise(store.manage(input)), value)
    for (const changed of [{ ...s, source: { ...s.source, revision: 4 } }, { ...s, revision: 2 }, { ...s, createdBy: f.ids.bot }, { ...s, enabled: true }, { ...s, calendar: { ...s.calendar, fold: "later" } }, { ...s, nativeSecret: "synthetic-forbidden" }, { ...s, canonicalContent: { content: "Changed" } }]) {
        value = { duplicate: false, type: "schedule", schedule: changed }; await assert.rejects(Effect.runPromise(store.manage(input)), /SchedulesStoreError/)
    }
})
test("schedule decoder accepts frozen past instants without recomputing zones and verifies ordered retained pages", async t => {
    const s = scheduleDefinition(), d = scheduleDelivery(), input: SchedulesQueryRequest = { serverId: f.ids.guild, context, operation: { type: "deliveries", scheduleNo: 1 } }
    let value: unknown = { type: "deliveries", deliveries: [d, { ...d, deliveryId: "synthetic_second", occurrenceNo: 2, planRevision: 2 }], nextAfterOccurrenceNo: 2 }
    mockBackend(t, () => value)
    const store = createSchedulesStore(config)
    assert.deepEqual(await Effect.runPromise(store.query(input)), value)
    value = { type: "schedule", schedule: s }
    assert.deepEqual(await Effect.runPromise(store.query({ ...input, operation: { type: "show", scheduleNo: 1 } })), value)
    // A schedule found by name must be the named one
    assert.deepEqual(await Effect.runPromise(store.query({ ...input, operation: { type: "show", name: "news" } })), value)
    await assert.rejects(Effect.runPromise(store.query({ ...input, operation: { type: "show", name: "other" } })), /SchedulesStoreError/)
    for (const changed of [{ type: "deliveries", deliveries: [d, d] }, { type: "deliveries", deliveries: [{ ...d, scheduleNo: 2 }] }, { type: "deliveries", deliveries: [d], nextAfterOccurrenceNo: 2 }, { type: "deliveries", deliveries: [{ ...d, offsetMinutes: 60 }] }]) {
        value = changed; await assert.rejects(Effect.runPromise(store.query(input)), /SchedulesStoreError/)
    }
})
test("schedule reservation decoder binds source consumer provenance and bot identity without human timer fallback", async t => {
    const automation: SchedulesAutomationContext = { observedAt: scheduleNow, channelId: f.ids.channel, botId: f.ids.bot, botAuthorized: true }
    const d = scheduleDelivery(), g = scheduleGrant(d), input: SchedulesDeliveryRequest = { serverId: f.ids.guild, operation: { type: "reserve", binding: { deliveryId: d.deliveryId, scheduleNo: d.scheduleNo, planRevision: d.planRevision, occurrenceNo: d.occurrenceNo }, context: automation } }
    let value: unknown = { type: "reservation", status: "reserved", grant: g }
    mockBackend(t, () => value)
    const store = createSchedulesStore(config)
    assert.deepEqual(await Effect.runPromise(store.delivery(input)), value)
    for (const changed of [{ ...g, sourceId: f.nextId() }, { ...g, actorId: f.ids.user }, { ...g, botId: f.ids.user }, { ...g, source: { ...g.source, deliveryId: "synthetic_other" } }, { ...g, consumer: { ...g.consumer, planRevision: 2 } }, { ...g, consumer: { ...g.consumer, occurrenceNo: 2 } }, { ...g, provenance: { ...g.provenance, scheduleNo: 2 } }, { ...g, draftKind: "draft", draftName: "news", draftRevision: 3 }]) {
        value = { type: "reservation", status: "reserved", grant: changed }; await assert.rejects(Effect.runPromise(store.delivery(input)), /SchedulesStoreError/)
    }
})
test("durable discovery accepts bounded empty scanned pages and rejects unbound or stationary continuation", async t => {
    const cursor = { cursor: "synthetic_page", throughAt: scheduleNow }, input: SchedulesDeliveryRequest = { serverId: f.ids.guild, operation: { type: "list", cursor } }
    let value: unknown = { type: "deliveries", deliveries: [], hasMore: true, nextCursor: { cursor: "synthetic_next", throughAt: scheduleNow } }
    mockBackend(t, () => value)
    const store = createSchedulesStore(config)
    assert.deepEqual(await Effect.runPromise(store.delivery(input)), value)
    for (const changed of [{ type: "deliveries", deliveries: [], hasMore: true }, { type: "deliveries", deliveries: [], hasMore: true, nextCursor: cursor }, { type: "deliveries", deliveries: [], hasMore: false, nextCursor: { cursor: "synthetic_next", throughAt: scheduleNow } }, { type: "deliveries", deliveries: [], hasMore: true, nextCursor: { cursor: "synthetic_next", throughAt: scheduleNow + 1 } }, { type: "deliveries", deliveries: Array.from({ length: 21 }, (_, i) => scheduleDelivery({ deliveryId: `synthetic_${i}`, occurrenceNo: i + 1 })), hasMore: false }]) {
        value = changed; await assert.rejects(Effect.runPromise(store.delivery(input)), /SchedulesStoreError/)
    }
})
test("publishing schedule attempt decoder enforces shortened exact expiry and all explicit branches", () => {
    const g = scheduleGrant(), attempt: PublishingAttempt = { ...g, outcome: "pending", createdAt: scheduleNow }, post: PublishingPost = { postNo: g.postNo, generation: g.generation, channelId: g.channelId, botId: g.botId, consumer: g.consumer, outcome: "pending", createdAt: scheduleNow, updatedAt: scheduleNow, attempt }
    assert.deepEqual(Schema.decodeUnknownSync(PublishingGrant, { onExcessProperty: "error" })(g), g)
    assert.deepEqual(Schema.decodeUnknownSync(PublishingPost, { onExcessProperty: "error" })(post), post)
    for (const changed of [{ ...attempt, dispatchExpiresAt: scheduleNow + 180001 }, { ...attempt, source: { type: "event-timer", deliveryId: g.source.deliveryId, dueAt: scheduleNow } }, { ...attempt, consumer: { ...g.consumer, deliveryId: "synthetic_other" } }, { ...attempt, provenance: { ...g.provenance, planRevision: 2 } }, { ...attempt, dispatchedAt: attempt.dispatchExpiresAt }]) assert.throws(() => Schema.decodeUnknownSync(PublishingPost, { onExcessProperty: "error" })({ ...post, attempt: changed }))
})
