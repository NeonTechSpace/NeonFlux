import type * as C from "@neonflux/backend/contracts"
import { createFixtures } from "@neontechspace/fluxerly/effect/testing"
import { Effect } from "effect"
import { createScheduleCalendar } from "../src/schedule-calendar.ts"
import { canonicalPublishingContent } from "../src/publishing-content.ts"
import type { SchedulesStore } from "../src/schedule-store.ts"

export const scheduleNow = Date.parse("2026-01-02T00:00:00Z")
export function scheduleDefinition(overrides: Partial<C.SchedulesDefinition> = {}): C.SchedulesDefinition {
    const f = createFixtures(), content: C.PublishingContent = { content: "Frozen @everyone", embed: { title: "Announcement" } }
    return { scheduleNo: 1, name: "news", revision: 2, planRevision: 1, createdBy: f.ids.user, channelId: f.ids.channel,
        source: { kind: "draft", name: "news", revision: 3 }, content, canonicalContent: canonicalPublishingContent(content), calendar: createScheduleCalendar("2026-01-02T00:00", "UTC", "reject"),
        enabled: true, cancelled: false, activatedAt: scheduleNow - 1, createdAt: scheduleNow - 1000, updatedAt: scheduleNow, ...overrides }
}
export function scheduleDelivery(overrides: Partial<C.SchedulesDelivery> = {}): C.SchedulesDelivery {
    const s = scheduleDefinition()
    return { deliveryId: "synthetic_schedule_delivery", scheduleNo: s.scheduleNo, planRevision: s.planRevision, occurrenceNo: 1, source: s.source, content: s.content, canonicalContent: s.canonicalContent,
        channelId: s.channelId, zone: s.calendar.zone, ...s.calendar.dates[0]!, state: "queued", nextCheckAt: scheduleNow, ...overrides }
}
export function scheduleGrant(delivery = scheduleDelivery(), reservedAt = scheduleNow): C.SchedulesDeliveryGrant {
    const f = createFixtures()
    return { attemptId: "synthetic_schedule_attempt", postNo: 1, generation: 1, sourceId: `schedule_timer_${delivery.deliveryId}`, actorId: f.ids.bot, botId: f.ids.bot, channelId: delivery.channelId, action: "send",
        source: { type: "schedule-timer", deliveryId: delivery.deliveryId, dueAt: delivery.dueAt }, provenance: { type: "schedule", scheduleNo: delivery.scheduleNo, planRevision: delivery.planRevision, source: delivery.source },
        consumer: { type: "schedule", deliveryId: delivery.deliveryId, scheduleNo: delivery.scheduleNo, planRevision: delivery.planRevision, occurrenceNo: delivery.occurrenceNo }, content: delivery.content, canonicalContent: delivery.canonicalContent,
        dispatchExpiresAt: reservedAt + 180000, nativeDeadlineMs: 5000 }
}
export function schedulesBoundary(overrides: Partial<SchedulesStore> = {}) {
    const calls: { method: string, input: unknown }[] = [], schedule = scheduleDefinition()
    const record = <A>(method: string, input: unknown, value: A) => Effect.sync(() => { calls.push({ method, input }); return value })
    const store: SchedulesStore = {
        manage: input => record<C.SchedulesManageResult>("manage", input, { duplicate: true }),
        query: input => {
            const op = input.operation
            return record<C.SchedulesQueryResult>("query", input, op.type === "show" ? { type: "schedule", schedule } : op.type === "list" ? { type: "schedules", schedules: [schedule] }
                : op.type === "deliveries" ? { type: "deliveries", deliveries: [] } : op.type === "settings" ? { type: "settings", settings: { enabled: false, revision: 1, activatedAt: 0 } }
                    : { type: "status", settings: { enabled: false, revision: 1, activatedAt: 0 }, definitions: 1, deliveries: 1, receipts: 0, publishing: { enabled: true }, limits: { definitions: 50, deliveries: 200, receipts: 1000 } })
        },
        delivery: input => record<C.SchedulesDeliveryResult>("delivery", input, input.operation.type === "list" ? { type: "deliveries", deliveries: [], hasMore: false }
            : input.operation.type === "defer" ? { type: "progress", recorded: true } : { type: "reservation", status: "waiting" }),
        ...overrides,
    }
    return { store, calls, schedule }
}
