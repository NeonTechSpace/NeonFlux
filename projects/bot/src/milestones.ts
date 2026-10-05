import type * as C from "@neonflux/backend/contracts"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Clock, Data, Effect } from "effect"
import { readMilestoneMembership, readMilestoneParticipant } from "./milestone-permissions.ts"
import { readAutomationContext } from "./schedule-permissions.ts"
import { sameMilestoneBinding, type MilestonesStore } from "./milestone-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { performPublishingGrant } from "./publishing.ts"

export class MilestonesHandlingError extends Data.TaggedError("MilestonesHandlingError")<{ readonly stage: "response" | "grant" | "membership" }> {}
export function milestoneDeliveryBinding(delivery: C.MilestonesDeliveryBinding): C.MilestonesDeliveryBinding {
    const { deliveryId, kind, intentRevision, userId, joinedAt, consentRevision, audienceGeneration, celebrationYear, completedYears, generation } = delivery
    return { deliveryId, kind, intentRevision, userId, joinedAt, consentRevision, audienceGeneration, celebrationYear, completedYears, generation }
}
export function milestoneMembershipObservation(facts: Effect.Success<ReturnType<typeof readMilestoneMembership>>): C.MilestonesMembershipObservation {
    return facts.status === "absent" ? { originServerId: facts.originServerId, status: "absent", userId: facts.userId, observedAt: facts.observedAt }
        : { originServerId: facts.originServerId, status: "present", userId: facts.userId, observedAt: facts.observedAt, joinedAt: facts.member.joinedAt }
}
export function processMilestoneDelivery(store: MilestonesStore, publishing: PublishingStore, serverId: string, client: Client, delivery: C.MilestonesDelivery) {
    return Effect.gen(function* () {
        if (!["queued", "blocked", "reserved"].includes(delivery.state) || delivery.claimedAt !== undefined || delivery.dueAt > (yield* Clock.currentTimeMillis)) return
        const binding = milestoneDeliveryBinding(delivery)
        const member = yield* readMilestoneMembership(client, serverId, delivery.userId)
        if (member.status === "absent" || member.member.joinedAt !== delivery.joinedAt) {
            return yield* store.delivery({ serverId, operation: { type: "membership", binding, observation: milestoneMembershipObservation(member) } })
        }
        const fresh = (hasEmbed = false) => Effect.gen(function* () {
            const automation = yield* readAutomationContext(client, serverId, delivery.channelId, hasEmbed)
            const participant = yield* readMilestoneParticipant(client, serverId, delivery.userId, delivery.channelId).pipe(Effect.catch(error => Effect.gen(function* () {
                // A wrapped authorization failure is never absence evidence. Confirm through the typed member boundary.
                const observed = yield* readMilestoneMembership(client, serverId, delivery.userId)
                if (observed.status === "absent" || observed.member.joinedAt !== delivery.joinedAt) yield* store.delivery({ serverId, operation: { type: "membership", binding, observation: milestoneMembershipObservation(observed) } })
                return yield* Effect.fail(error)
            })))
            if (participant.member.joinedAt !== delivery.joinedAt) {
                yield* store.delivery({ serverId, operation: { type: "membership", binding, observation: { originServerId: participant.member.originServerId!, observedAt: participant.observedAt, userId: delivery.userId, status: "present", joinedAt: participant.member.joinedAt } } })
                return yield* Effect.fail(new MilestonesHandlingError({ stage: "membership" }))
            }
            if (participant.botId !== automation.botId) return yield* Effect.fail(new MilestonesHandlingError({ stage: "membership" }))
            return { automation, participant }
        })
        const context = yield* fresh()
        const result = yield* store.delivery({ serverId, operation: { type: "reserve", binding, context } })
        if (result.type !== "reservation") return yield* Effect.fail(new MilestonesHandlingError({ stage: "response" }))
        if (result.status !== "reserved") return result.status
        const g = result.grant
        if (g.source.type !== "milestone-timer" || g.source.deliveryId !== delivery.deliveryId || g.source.dueAt !== delivery.dueAt
            || g.consumer.type !== "milestone" || !sameMilestoneBinding(g.consumer, binding) || g.provenance.type !== "milestone" || g.provenance.kind !== delivery.kind || g.provenance.intentRevision !== delivery.intentRevision
            || g.actorId !== context.automation.botId || g.botId !== context.automation.botId || g.channelId !== delivery.channelId || g.action !== "send"
            || g.dispatchExpiresAt > (yield* Clock.currentTimeMillis) + 180000
            || delivery.state === "reserved" && (g.postNo !== delivery.postNo || g.attemptId !== delivery.attemptId)) return yield* Effect.fail(new MilestonesHandlingError({ stage: "grant" }))
        return yield* performPublishingGrant(publishing, serverId, context.automation.botId, client, g, () => fresh(!!g.content.embed))
    })
}
