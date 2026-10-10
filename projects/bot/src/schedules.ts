import type { SchedulesDelivery, SchedulesDeliveryBinding } from "@neonflux/contracts/schedules"
import { equalPublishingContent } from "@neonflux/contracts/publishing-base"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import type { SchedulesStore } from "./schedule-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { readAutomationContext } from "./schedule-permissions.ts"
import { performPublishingGrant } from "./publishing.ts"

export class SchedulesHandlingError extends Data.TaggedError("SchedulesHandlingError")<{ readonly stage: "response" | "grant" }> {}
export const scheduleDeliveryBinding = (d: SchedulesDelivery): SchedulesDeliveryBinding => ({ deliveryId: d.deliveryId, scheduleNo: d.scheduleNo, planRevision: d.planRevision, occurrenceNo: d.occurrenceNo })
export function processScheduleDelivery(store: SchedulesStore, publishing: PublishingStore, serverId: string, client: Client, delivery: SchedulesDelivery) {
    return Effect.gen(function* () {
        if (!["queued", "blocked", "reserved"].includes(delivery.state) || delivery.claimedAt !== undefined) return
        const now = yield* Clock.currentTimeMillis
        // Discovery advances nextCheckAt for fair recovery before returning an admitted due row.
        if (delivery.dueAt > now) return
        const fresh = () => readAutomationContext(client, serverId, delivery.channelId, !!delivery.content.embed)
        const context = yield* fresh()
        const result = yield* store.delivery({ serverId, operation: { type: "reserve", binding: scheduleDeliveryBinding(delivery), context } })
        if (result.type !== "reservation") return yield* Effect.fail(new SchedulesHandlingError({ stage: "response" }))
        if (result.status !== "reserved") return result.status
        const grant = result.grant
        if (grant.source.type !== "schedule-timer" || grant.source.deliveryId !== delivery.deliveryId || grant.source.dueAt !== delivery.dueAt
            || grant.consumer.type !== "schedule" || grant.consumer.scheduleNo !== delivery.scheduleNo || grant.consumer.planRevision !== delivery.planRevision || grant.consumer.occurrenceNo !== delivery.occurrenceNo || grant.consumer.deliveryId !== delivery.deliveryId
            || grant.provenance.type !== "schedule" || grant.provenance.scheduleNo !== delivery.scheduleNo || grant.provenance.planRevision !== delivery.planRevision
            || grant.provenance.source.kind !== delivery.source.kind || grant.provenance.source.name !== delivery.source.name || grant.provenance.source.revision !== delivery.source.revision
            || grant.actorId !== context.botId || grant.botId !== context.botId || grant.channelId !== delivery.channelId || grant.action !== "send"
            || grant.dispatchExpiresAt > (yield* Clock.currentTimeMillis) + 180000
            || !equalPublishingContent(grant.content, delivery.content) || !equalPublishingContent(grant.canonicalContent, delivery.canonicalContent)
            || delivery.state === "reserved" && (grant.postNo !== delivery.postNo || grant.attemptId !== delivery.attemptId))
            return yield* Effect.fail(new SchedulesHandlingError({ stage: "grant" }))
        return yield* performPublishingGrant(publishing, serverId, context.botId, client, grant, fresh)
    })
}
