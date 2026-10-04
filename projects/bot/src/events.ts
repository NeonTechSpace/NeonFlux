import type {
    EventsAutomationContext,
    EventsDelivery,
    EventsDeliveryBinding,
    EventsDefinition,
    EventsPromotionJob,
} from "@neonflux/contracts/events"
import { ChannelType, Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect } from "effect"
import { randomUUID } from "node:crypto"
import type { EventsStore } from "./event-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { performPublishingGrant } from "./publishing.ts"
import { ComposerPermissionError, readEventsContext } from "./publishing-permissions.ts"
import { EventsHandlingError } from "./event-management.ts"
import { readNativeMember } from "./member-evidence.ts"
import { memberTimeout, readAuthenticatedBotId, readSafetyAuthority } from "./safety-permissions.ts"

// Automated reminders act as the bot itself with fresh bot permission in the destination
export function readEventsAutomationContext(client: Client, serverId: string, channelId: string) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const permission = Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks
        const authority = yield* readSafetyAuthority(client, serverId, botId, { channelId, permission })
        const observedAt = yield* Clock.currentTimeMillis
        const textChannel =
            authority.channel?.type === ChannelType.Text || authority.channel?.type === ChannelType.Announcement
        const timedOut = memberTimeout(client, authority.bot, observedAt) !== "none"
        if (!authority.botPermissionAuthorized || !textChannel || timedOut)
            return yield* Effect.fail(new ComposerPermissionError({ stage: "destination" }))
        const context: EventsAutomationContext = {
            originServerId: authority.guild.id,
            observedAt,
            channelId,
            botId: authority.botId,
            botAuthorized: true,
        }
        return context
    })
}
export const eventDeliveryBinding = (d: EventsDelivery): EventsDeliveryBinding => ({
    deliveryId: d.deliveryId,
    eventNo: d.eventNo,
    occurrenceNo: d.occurrenceNo,
    revision: d.revision,
    offsetMinutes: d.offsetMinutes,
})
export function processEventDelivery(
    store: EventsStore,
    publishing: PublishingStore,
    serverId: string,
    client: Client,
    delivery: EventsDelivery,
    event: EventsDefinition,
) {
    return Effect.gen(function* () {
        if (!["queued", "blocked", "reserved"].includes(delivery.state)) return
        // The backend lists and reserves only due reminders by its own clock, so the bot's clock never skips one
        if (event.eventNo !== delivery.eventNo)
            return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
        // The backend classifies overdue, started, cancelled or replaced rows before any grant can be claimed.
        const fresh = () => readEventsAutomationContext(client, serverId, event.channelId)
        const reservation = yield* store.delivery({
            serverId,
            operation: { type: "reserve", binding: eventDeliveryBinding(delivery), context: yield* fresh() },
        })
        if (reservation.type !== "reservation")
            return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
        if (reservation.status !== "reserved") return reservation.status
        const grant = reservation.grant
        if (
            delivery.state === "reserved" &&
            (delivery.postNo !== grant.postNo || delivery.attemptId !== grant.attemptId)
        )
            return yield* Effect.fail(new EventsHandlingError({ stage: "grant" }))
        const date = event.calendar?.dates.find((d) => d.startsAt === delivery.startsAt)
        if (
            !date ||
            event.revision !== delivery.revision ||
            grant.source.type !== "event-timer" ||
            grant.source.dueAt !== delivery.dueAt ||
            grant.dispatchExpiresAt > Math.min(delivery.dueAt + 300000, delivery.startsAt)
        )
            return yield* Effect.fail(new EventsHandlingError({ stage: "grant" }))
        // The backend renders the reminder, and the bot publishes the content it granted
        return yield* performPublishingGrant(publishing, serverId, grant.actorId, client, grant, fresh)
    })
}

export function processEventPromotion(store: EventsStore, serverId: string, client: Client, job: EventsPromotionJob) {
    return Effect.gen(function* () {
        const claimToken = yield* Effect.sync(() => randomUUID().replaceAll("-", ""))
        const head = yield* store.work({
            serverId,
            operation: {
                type: "claim",
                eventNo: job.eventNo,
                occurrenceNo: job.occurrenceNo,
                revision: job.revision,
                generation: job.generation,
                claimToken,
            },
        })
        if (head.type !== "head") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
        if (!head.claimed) return
        const binding = head.binding
        const run = Effect.gen(function* () {
            if ((yield* Clock.currentTimeMillis) >= head.leaseExpiresAt) return
            const evidence = yield* readNativeMember(client, serverId, binding.userId)
            if (!evidence.member) {
                if ((yield* Clock.currentTimeMillis) >= head.leaseExpiresAt) return
                return yield* store.work({
                    serverId,
                    operation: {
                        type: "observe",
                        eventNo: binding.eventNo,
                        occurrenceNo: binding.occurrenceNo,
                        revision: binding.revision,
                        generation: binding.generation,
                        userId: evidence.userId,
                        joinedAt: binding.joinedAt,
                        membershipGeneration: binding.membershipGeneration,
                        rsvpRevision: binding.rsvpRevision,
                        originServerId: evidence.originServerId,
                        observedAt: yield* Clock.currentTimeMillis,
                        memberAbsent: true,
                    },
                })
            }
            const context = yield* readEventsContext(client, serverId, binding.userId, job.channelId)
            if ((yield* Clock.currentTimeMillis) >= head.leaseExpiresAt) return
            return yield* store.work({ serverId, operation: { type: "promote", binding, context } })
        })
        return yield* run.pipe(
            Effect.catchCause((cause) =>
                Cause.hasInterrupts(cause)
                    ? Effect.failCause(cause)
                    : store.work({ serverId, operation: { type: "defer", binding } }).pipe(Effect.asVoid),
            ),
        )
    })
}
