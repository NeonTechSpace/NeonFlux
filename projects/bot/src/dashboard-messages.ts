import { DashboardMessageCompleteResult, DashboardMessageReadyResult, DashboardPublishingReserveResult } from "@neonflux/contracts/dashboard"
import { Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Schema, Struct } from "effect"
import type { BotConfig } from "./config.ts"
import { createBackendRequest } from "./backend-http.ts"
import { readPublishingAuthority } from "./publishing-permissions.ts"
import { performPublishingGrant } from "./publishing.ts"
import type { PublishingStore } from "./publishing-store.ts"

// The bot reads only the grant. A reserved attempt is never sent again
const reserveResult = DashboardPublishingReserveResult.mapFields(Struct.pick(["grant"]))
export function processDashboardMessagesPass(config: BotConfig, client: Client, publishing: PublishingStore) {
    return Effect.gen(function* () {
        if (!config.backend) return
        const request = createBackendRequest(config.backend), serverId = config.serverId
        const ready = yield* request("/dashboard-messages/ready", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(DashboardMessageReadyResult)))
        for (const job of ready.jobs) {
            yield* Effect.gen(function* () {
                // Existing attempts are observed, never reserved or dispatched again after restart
                if (job.state === "reserved") {
                    yield* request("/dashboard-messages/complete", { serverId, jobId: job.id }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(DashboardMessageCompleteResult)))
                    return
                }
                if ((yield* Clock.currentTimeMillis) >= job.expiresAt) return
                const fresh = () => Effect.gen(function* () {
                    const authority = yield* readPublishingAuthority(client, serverId, job.actorId, job.channelId, !!job.content.embed, false, true)
                    const bits = client.permissions.calculate({ guild: authority.guild, member: authority.actor, roles: authority.roles })
                    return { authority, dashboardContext: { originServerId: serverId, jobId: job.id, actorId: job.actorId,
                        managerAuthorized: authority.isOwner || (bits & (Permissions.Administrator | Permissions.ManageGuild)) !== 0n,
                        observedAt: yield* Clock.currentTimeMillis, botId: authority.botId, channelId: job.channelId } }
                })
                const initial = yield* fresh()
                const reserved = yield* request("/dashboard-messages/reserve", { serverId, ...initial.dashboardContext }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(reserveResult)))
                if (reserved.grant) yield* performPublishingGrant(publishing, serverId, job.actorId, client, reserved.grant, undefined, fresh)
                yield* request("/dashboard-messages/complete", { serverId, jobId: job.id }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(DashboardMessageCompleteResult)))
            }).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : request("/dashboard-messages/fail", { serverId, jobId: job.id }).pipe(Effect.catch(() => Effect.void))))
        }
    })
}
