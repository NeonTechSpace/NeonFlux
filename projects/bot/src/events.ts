import type * as C from "@neonflux/backend/contracts"
import { ChannelType, Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect } from "effect"
import { randomUUID } from "node:crypto"
import type { EventsStore } from "./event-store.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { performPublishingGrant } from "./publishing.ts"
import { EventsPermissionError, readEventsContext } from "./publishing-permissions.ts"
import { EventsHandlingError } from "./event-management.ts"
import { renderEventContent } from "./event-render.ts"
import { canonicalPublishingContent, equalPublishingContent } from "./publishing-content.ts"
import { readNativeMember } from "./member-evidence.ts"
import { readAuthenticatedBotId, readSafetyAuthority } from "./safety-permissions.ts"

// Automated reminders act as the bot itself with fresh bot permission in the destination
export function readEventsAutomationContext(client: Client, serverId: string, channelId: string) {
    return Effect.gen(function* () {
        const botId = yield* readAuthenticatedBotId(client)
        const permission = Permissions.ViewChannel | Permissions.SendMessages | Permissions.EmbedLinks
        const authority = yield* readSafetyAuthority(client, serverId, botId, { channelId, permission })
        const observedAt = yield* Clock.currentTimeMillis, timeout = authority.bot.communicationDisabledUntil
        const textChannel = authority.channel?.type === ChannelType.Text || authority.channel?.type === ChannelType.Announcement
        const timedOut = timeout === undefined || timeout !== null && !(Date.parse(timeout) <= observedAt)
        if (!authority.botPermissionAuthorized || !textChannel || timedOut) return yield* Effect.fail(new EventsPermissionError({ stage: "destination" }))
        const context: C.EventsAutomationContext = { originServerId: authority.guild.id, observedAt, channelId, botId: authority.botId, botAuthorized: true }
        return context
    })
}
export const eventDeliveryBinding = (d: C.EventsDelivery): C.EventsDeliveryBinding => ({ deliveryId: d.deliveryId, eventNo: d.eventNo, occurrenceNo: d.occurrenceNo, revision: d.revision, offsetMinutes: d.offsetMinutes })
export function processEventDelivery(store: EventsStore, publishing: PublishingStore, serverId: string, client: Client, delivery: C.EventsDelivery, event: C.EventsDefinition) {
    return Effect.gen(function* () {
        if (!["queued", "blocked", "reserved"].includes(delivery.state)) return
        const now = yield* Clock.currentTimeMillis
        if (delivery.dueAt > now || delivery.nextCheckAt > now) return
        if (event.eventNo !== delivery.eventNo) return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
        // The backend classifies overdue, started, cancelled or replaced rows before any grant can be claimed.
        const fresh = () => readEventsAutomationContext(client, serverId, event.channelId)
        const reservation = yield* store.delivery({ serverId, operation: { type: "reserve", binding: eventDeliveryBinding(delivery), context: yield* fresh() } })
        if (reservation.type !== "reservation") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
        if (reservation.status !== "reserved") return reservation.status
        const grant = reservation.grant
        if (delivery.state === "reserved" && (delivery.postNo !== grant.postNo || delivery.attemptId !== grant.attemptId)) return yield* Effect.fail(new EventsHandlingError({ stage: "grant" }))
        const date = event.calendar?.dates.find(d => d.startsAt === delivery.startsAt)
        if (!date || event.revision !== delivery.revision || grant.source.type !== "event-timer" || grant.source.dueAt !== delivery.dueAt
            || grant.dispatchExpiresAt > Math.min((yield* Clock.currentTimeMillis) + 180000, delivery.dueAt + 300000, delivery.startsAt)) return yield* Effect.fail(new EventsHandlingError({ stage: "grant" }))
        const content = renderEventContent(event, date)
        if (!equalPublishingContent(content, grant.content) || !equalPublishingContent(canonicalPublishingContent(content), grant.canonicalContent)) return yield* Effect.fail(new EventsHandlingError({ stage: "grant" }))
        return yield* performPublishingGrant(publishing, serverId, grant.actorId, client, grant, fresh)
    })
}

export function processEventPromotion(store: EventsStore, serverId: string, client: Client, job: C.EventsPromotionJob, event: Pick<C.EventsDefinition, "eventNo" | "channelId"> = job) {
    return Effect.gen(function* () {
        if (event.eventNo !== job.eventNo) return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
        const claimToken = yield* Effect.sync(() => randomUUID().replaceAll("-", ""))
        const head = yield* store.work({ serverId, operation: { type: "claim", eventNo: job.eventNo, occurrenceNo: job.occurrenceNo, revision: job.revision, generation: job.generation, claimToken } })
        if (head.type !== "head") return yield* Effect.fail(new EventsHandlingError({ stage: "response" }))
        if (!head.claimed) return
        const binding = head.binding
        const run = Effect.gen(function* () {
            if ((yield* Clock.currentTimeMillis) >= head.leaseExpiresAt) return
            const evidence = yield* readNativeMember(client, serverId, binding.userId)
            if (!evidence.member) {
                if ((yield* Clock.currentTimeMillis) >= head.leaseExpiresAt) return
                return yield* store.work({ serverId, operation: { type: "observe", eventNo: binding.eventNo, occurrenceNo: binding.occurrenceNo, revision: binding.revision,
                    generation: binding.generation, userId: evidence.userId, joinedAt: binding.joinedAt, membershipGeneration: binding.membershipGeneration, rsvpRevision: binding.rsvpRevision, originServerId: evidence.originServerId, observedAt: yield* Clock.currentTimeMillis, memberAbsent: true } })
            }
            const context = yield* readEventsContext(client, serverId, binding.userId, event.channelId)
            if ((yield* Clock.currentTimeMillis) >= head.leaseExpiresAt) return
            return yield* store.work({ serverId, operation: { type: "promote", binding, context } })
        })
        return yield* run.pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
            : store.work({ serverId, operation: { type: "defer", binding } }).pipe(Effect.asVoid)))
    })
}
