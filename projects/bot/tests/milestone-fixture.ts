import type * as C from "@neonflux/backend/contracts"
import { createFixtures } from "@neontechspace/fluxerly/effect/testing"
import { Effect } from "effect"
import { canonicalPublishingContent } from "../src/publishing-content.ts"
import type { MilestonesStore } from "../src/milestone-store.ts"

export const milestoneNow = Date.parse("2026-01-02T00:00:00Z")
export const milestoneEpoch = "2020-01-02T00:00:00.123456789Z"
export function milestoneRoute(overrides: Partial<C.MilestonesRoute> = {}): C.MilestonesRoute {
    const f = createFixtures(), content: C.PublishingContent = { content: "Celebrate {user} in {server}", embed: { title: "Birthday" } }
    return { kind: "birthday", revision: 2, intentRevision: 1, audienceGeneration: 1, createdBy: f.ids.user, channelId: f.ids.channel, zone: "UTC", time: "00:00", fold: "reject",
        template: { name: "birthday", revision: 3 }, content, canonicalContent: canonicalPublishingContent(content), enabled: true, activatedAt: milestoneNow - 1, createdAt: milestoneNow - 1000, updatedAt: milestoneNow, ...overrides }
}
export function milestoneDelivery(overrides: Partial<C.MilestonesDelivery> = {}): C.MilestonesDelivery {
    const r = milestoneRoute(), f = createFixtures()
    return { deliveryId: "synthetic_milestone_delivery", kind: "birthday", intentRevision: 1, userId: f.ids.user, joinedAt: milestoneEpoch, consentRevision: 1, audienceGeneration: 1, celebrationYear: 2026, completedYears: 0, generation: 1,
        channelId: r.channelId, zone: "UTC", dueAt: milestoneNow, offsetMinutes: 0, state: "queued", nextCheckAt: milestoneNow, ...overrides }
}
export function milestoneGrant(d = milestoneDelivery(), reservedAt = milestoneNow): C.MilestonesDeliveryGrant {
    const f = createFixtures(), { channelId, zone, dueAt, offsetMinutes, state, nextCheckAt, claimedAt, postNo, attemptId, reason, ...binding } = d
    const content: C.PublishingContent = { content: "Celebrate Synthetic @everyone", embed: { title: "Birthday" } }
    return { attemptId: "synthetic_milestone_attempt", postNo: 1, generation: 1, sourceId: `milestone_timer_${d.deliveryId}`, actorId: f.ids.bot, botId: f.ids.bot, channelId: d.channelId, action: "send",
        source: { type: "milestone-timer", deliveryId: d.deliveryId, dueAt: d.dueAt }, provenance: { type: "milestone", kind: d.kind, intentRevision: d.intentRevision, template: { name: "birthday", revision: 3 } },
        consumer: { type: "milestone", ...binding }, content, canonicalContent: canonicalPublishingContent(content), dispatchExpiresAt: reservedAt + 180000, nativeDeadlineMs: 5000 }
}
export function milestonesBoundary(overrides: Partial<MilestonesStore> = {}) {
    const calls: { method: string, input: unknown }[] = [], route = milestoneRoute()
    const record = <A>(method: string, input: unknown, value: A) => Effect.sync(() => { calls.push({ method, input }); return value })
    const store: MilestonesStore = {
        manage: input => record<C.MilestonesManageResult>("manage", input, { duplicate: true }),
        query: input => record<C.MilestonesQueryResult>("query", input, { type: "settings", settings: { enabled: false, revision: 1, activatedAt: 0 }, routes: [route] }),
        personal: input => record<C.MilestonesPersonalResult>("personal", input, input.operation.type === "me" ? { duplicate: false, type: "me", enrollments: [], routes: [route] }
            : input.operation.type === "remove" ? { duplicate: false, type: "removed", removed: 1 } : { duplicate: true }),
        delivery: input => record<C.MilestonesDeliveryResult>("delivery", input, input.operation.type === "list" ? { type: "deliveries", deliveries: [], hasMore: false }
            : input.operation.type === "member-targets" ? { type: "member-targets", targets: [], hasMore: false } : input.operation.type === "reserve" ? { type: "reservation", status: "waiting" } : { type: "progress", recorded: true }),
        ...overrides,
    }
    return { store, calls, route }
}
