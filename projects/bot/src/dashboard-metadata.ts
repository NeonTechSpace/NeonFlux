import { DashboardMetadataExecuteResult, DashboardMetadataReadyResult, type DashboardMetadataExecuteRequest } from "@neonflux/contracts/dashboard"
import { Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Schema } from "effect"
import { isDeepStrictEqual } from "node:util"
import type { BotConfig } from "./config.ts"
import { createBackendRequest } from "./backend-http.ts"
import { cleanupRecord } from "./cleanup-permissions.ts"
import { metadataHumanAccount, readMetadataLogContext } from "./metadata-log-permissions.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"

export function processDashboardMetadataPass(config: BotConfig, client: Client) {
    return Effect.gen(function* () {
        if (!config.backend) return
        const request = createBackendRequest(config.backend), serverId = config.serverId
        const ready = yield* request("/dashboard-metadata/ready", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(DashboardMetadataReadyResult, { onExcessProperty: "error" })))
        for (const job of ready.jobs) {
            yield* Effect.gen(function* () {
                if (job.state !== "queued" || (yield* Clock.currentTimeMillis) >= job.expiresAt) return
                const authority = yield* readSafetyAuthority(client, serverId, job.actorId)
                const raw = yield* client.rest.request({ method: "GET", path: `/users/${job.actorId}`, timeoutMs: 5000 })
                const actor = cleanupRecord(raw.body)
                if (raw.status !== 200 || actor?.id !== job.actorId || !metadataHumanAccount(actor)) return yield* Effect.fail(new Error("Dashboard manager identity unavailable"))
                const bits = client.permissions.calculate({ guild: authority.guild, member: authority.actor, roles: authority.roles })
                const managerAuthorized = authority.isOwner || (bits & (Permissions.Administrator | Permissions.ManageGuild)) !== 0n
                const op = job.operation
                const owner = op.type === "route" || op.type === "event-route" && op.enabled
                    ? yield* readMetadataLogContext(client, serverId, op.ownerId!, op.channelId!) : undefined
                const input: DashboardMetadataExecuteRequest = { serverId, originServerId: authority.guild.id, jobId: job.id, actorId: job.actorId,
                    managerAuthorized, observedAt: yield* Clock.currentTimeMillis, ...(owner ? { recipientOwner: owner.context } : {}) }
                const result = yield* request("/dashboard-metadata/execute", input).pipe(Effect.flatMap(Schema.decodeUnknownEffect(DashboardMetadataExecuteResult, { onExcessProperty: "error" })))
                if (result.job.id !== job.id || result.job.actorId !== job.actorId || result.job.expectedConfigRevision !== job.expectedConfigRevision
                    || !isDeepStrictEqual(result.job.operation, job.operation) || result.job.state === "queued"
                    || result.job.state === "applied" && (!result.settings || result.settings.configRevision !== job.expectedConfigRevision + 1))
                    return yield* Effect.fail(new Error("Dashboard metadata result mismatch"))
            }).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
                : request("/dashboard-metadata/fail", { serverId, jobId: job.id }).pipe(Effect.catch(() => Effect.void))))
        }
    })
}
