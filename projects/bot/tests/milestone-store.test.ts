import assert from "node:assert/strict"
import test, { type TestContext } from "node:test"
import type * as C from "@neonflux/backend/contracts"
import { Effect, Redacted } from "effect"
import { createMilestonesStore } from "../src/milestone-store.ts"
import { createPublishingStore } from "../src/publishing-store.ts"
import { milestoneDeliveryBinding } from "../src/milestones.ts"
import { milestoneDelivery, milestoneEpoch, milestoneGrant, milestoneNow, milestoneRoute } from "./milestone-fixture.ts"

const config = { siteUrl: "https://synthetic-milestones.convex.site", secret: Redacted.make("synthetic-milestones-adapter-secret") }
function fixture(t: TestContext) {
    let response: unknown
    const paths: string[] = []
    t.mock.method(globalThis, "fetch", async (url: URL) => { paths.push(url.pathname); return Response.json(response) })
    return { store: createMilestonesStore(config), publisher: createPublishingStore(config), respond: (value: unknown) => { response = value }, paths }
}
const rejected = <A>(operation: Effect.Effect<A, unknown>) => assert.rejects(Effect.runPromise(operation), /StoreError/)
const d = milestoneDelivery(), route = milestoneRoute()
const owner: C.MilestonesContext = { observedAt: milestoneNow, actor: { userId: route.createdBy, roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }, channelId: d.channelId, botId: milestoneGrant().botId, botAuthorized: true, actorAuthorized: true }
const automation: C.SchedulesAutomationContext = { observedAt: milestoneNow, channelId: d.channelId, botId: owner.botId, botAuthorized: true }
const context: C.MilestonesDeliveryContext = { automation, participant: { observedAt: milestoneNow, channelId: d.channelId, botId: owner.botId, userName: "Synthetic member", serverName: "Synthetic server", member: { userId: d.userId, joinedAt: d.joinedAt, roleIds: [], isBot: false, timeoutUntil: null, canView: true, canReadHistory: true } } }
test("milestone adapter binds exact source/consumer epoch and rejects substituted grants or sensitive discovery fields", async t => {
    const f = fixture(t), request: C.MilestonesDeliveryRequest = { serverId: "123456789012345678", operation: { type: "reserve", binding: milestoneDeliveryBinding(d), context } }, grant = milestoneGrant(d)
    f.respond({ type: "reservation", status: "reserved", grant })
    assert.deepEqual(await Effect.runPromise(f.store.delivery(request)), { type: "reservation", status: "reserved", grant })
    for (const altered of [
        { ...grant, sourceId: "milestone_timer_other" },
        { ...grant, consumer: { ...grant.consumer, joinedAt: "2020-01-02T00:00:00.123456788Z" } },
        { ...grant, provenance: { ...grant.provenance, intentRevision: 9 } },
        { ...grant, consumer: { ...grant.consumer, completedYears: 18 } },
        { ...grant, actorId: "123456789012345699" },
    ]) { f.respond({ type: "reservation", status: "reserved", grant: altered }); await rejected(f.store.delivery(request)) }
    for (const row of [{ ...d, monthDay: "02-29" }, { ...d, content: { content: "Unexpected retained body" } }, { ...d, birthYear: 2000 }]) {
        f.respond({ type: "deliveries", deliveries: [row], hasMore: false })
        await rejected(f.store.delivery({ serverId: request.serverId, operation: { type: "list" } }))
    }
    assert(f.paths.every(path => path === "/milestones/delivery"))
})
test("personal decoder binds destination, raw epoch and route with no birthday field on anniversaries", async t => {
    const f = fixture(t), request: C.MilestonesPersonalRequest = { serverId: "123456789012345678", messageId: "123456789012345679", createdAt: milestoneNow,
        identity: { userId: d.userId, channelId: "123456789012345699", isDirectMessage: true, isBot: false, observedAt: milestoneNow },
        operation: { type: "enroll", kind: "birthday", monthDay: "02-29", confirmChannelId: d.channelId, participant: context.participant } }
    const enrollment: C.MilestonesEnrollment = { kind: "birthday", revision: 1, joinedAt: milestoneEpoch, audienceGeneration: 1, channelId: d.channelId, consentedAt: milestoneNow, monthDay: "02-29", needsReconsent: false }
    f.respond({ duplicate: false, type: "enrollment", enrollment })
    assert.deepEqual(await Effect.runPromise(f.store.personal(request)), { duplicate: false, type: "enrollment", enrollment })
    for (const patch of [{ joinedAt: "2020-01-02T00:00:00.123456788Z" }, { channelId: "123456789012345699" }, { monthDay: "03-01" }, { birthYear: 2000 }, { kind: "anniversary" }, { needsReconsent: true }]) {
        f.respond({ duplicate: false, type: "enrollment", enrollment: { ...enrollment, ...patch } }); await rejected(f.store.personal(request))
    }
    f.respond({ duplicate: false, type: "me", enrollments: [enrollment, enrollment], routes: [route] })
    await rejected(f.store.personal({ ...request, operation: { type: "me" } }))
})
test("due and retained adapters reject nonadvancing or unbound private cursors and member targets", async t => {
    const f = fixture(t), cursor = { cursor: "synthetic_cursor", throughAt: milestoneNow }, serverId = "123456789012345678"
    f.respond({ type: "deliveries", deliveries: [d], hasMore: true, nextCursor: cursor })
    await rejected(f.store.delivery({ serverId, operation: { type: "list", cursor } }))
    f.respond({ type: "deliveries", deliveries: [d], hasMore: false, nextCursor: { cursor: "synthetic_next", throughAt: milestoneNow } })
    await rejected(f.store.delivery({ serverId, operation: { type: "list" } }))
    f.respond({ type: "member-targets", targets: [{ kind: "birthday", userId: "123456789012345699", joinedAt: d.joinedAt, consentRevision: 1, consentedAt: milestoneNow }], hasMore: false })
    await rejected(f.store.delivery({ serverId, operation: { type: "member-targets", userId: d.userId } }))
})
test("shared publisher accepts exact milestone tracking and retains ordinary immutable snapshots", async t => {
    const f = fixture(t), grant = milestoneGrant(d), post: C.PublishingPost = { postNo: grant.postNo, generation: grant.generation, botId: grant.botId, channelId: grant.channelId, outcome: "pending", createdAt: milestoneNow, updatedAt: milestoneNow,
        consumer: grant.consumer, attempt: { ...grant, outcome: "pending", createdAt: milestoneNow } }
    const request: C.PublishingQueryRequest = { serverId: "123456789012345678", actor: owner.actor, operation: { type: "post-show", postNo: 1 } }
    f.respond({ type: "post", post })
    assert.deepEqual(await Effect.runPromise(f.publisher.query(request)), { type: "post", post })
    for (const attempt of [{ ...post.attempt, dispatchExpiresAt: milestoneNow + 180001 }, { ...post.attempt, consumer: { ...grant.consumer, generation: 2 } }, { ...post.attempt, content: { content: "Drift" } }]) {
        f.respond({ type: "post", post: { ...post, attempt } }); await rejected(f.publisher.query(request))
    }
})
