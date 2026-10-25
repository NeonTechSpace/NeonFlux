import {
    DashboardMetadataExecuteResult,
    DashboardMetadataReadyResult,
    type DashboardMetadataExecuteRequest,
} from "@neonflux/contracts/dashboard"
import { Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Schema } from "effect"
import { isDeepStrictEqual } from "node:util"
import type { BotConfig } from "./config.ts"
import { createBackendRequest } from "./backend-http.ts"
import { readMetadataLogContext } from "./metadata-log-permissions.ts"
import { nativeHumanAccount, readNativeAccount, readSafetyAuthority } from "./safety-permissions.ts"
import { metadataRechecks } from "./metadata-log-events.ts"
import { causeFix } from "./permission-fix.ts"

export class DashboardMetadataError extends Data.TaggedError("DashboardMetadataError")<{
    readonly stage: "identity" | "result"
}> {}

export function processDashboardMetadataPass(config: BotConfig, client: Client) {
    return Effect.gen(function* () {
        if (!config.backend) return
        const request = createBackendRequest(config.backend),
            serverId = config.serverId
        const ready = yield* request("/dashboard-metadata/ready", { serverId }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(DashboardMetadataReadyResult, { onExcessProperty: "error" })),
        )
        for (const job of ready.jobs) {
            yield* Effect.gen(function* () {
                if (job.state !== "queued" || (yield* Clock.currentTimeMillis) >= job.expiresAt) return
                const authority = yield* readSafetyAuthority(client, serverId, job.actorId)
                const actor = yield* readNativeAccount(client, job.actorId)
                if (actor?.id !== job.actorId || !nativeHumanAccount(actor))
                    return yield* Effect.fail(new DashboardMetadataError({ stage: "identity" }))
                const bits = client.permissions.calculate({
                    guild: authority.guild,
                    member: authority.actor,
                    roles: authority.roles,
                })
                const managerAuthorized =
                    authority.isOwner || (bits & (Permissions.Administrator | Permissions.ManageGuild)) !== 0n
                const op = job.operation
                const owner =
                    op.type === "route" || (op.type === "event-route" && op.enabled)
                        ? yield* readMetadataLogContext(client, serverId, op.ownerId!, op.channelId!)
                        : undefined
                const input: DashboardMetadataExecuteRequest = {
                    serverId,
                    originServerId: authority.guild.id,
                    jobId: job.id,
                    actorId: job.actorId,
                    managerAuthorized,
                    observedAt: yield* Clock.currentTimeMillis,
                    ...(owner ? { recipientOwner: owner.context } : {}),
                }
                const result = yield* request("/dashboard-metadata/execute", input).pipe(
                    Effect.flatMap(
                        Schema.decodeUnknownEffect(DashboardMetadataExecuteResult, { onExcessProperty: "error" }),
                    ),
                )
                if (
                    result.job.id !== job.id ||
                    result.job.actorId !== job.actorId ||
                    result.job.expectedConfigRevision !== job.expectedConfigRevision ||
                    !isDeepStrictEqual(result.job.operation, job.operation) ||
                    result.job.state === "queued" ||
                    (result.job.state === "applied" &&
                        (!result.settings || result.settings.configRevision !== job.expectedConfigRevision + 1))
                )
                    return yield* Effect.fail(new DashboardMetadataError({ stage: "result" }))
                // Gateway admission pauses while logs are off, so an applied change rechecks it
                if (result.job.state === "applied") yield* metadataRechecks.get(serverId)?.() ?? Effect.void
            }).pipe(
                Effect.catchCause((cause) =>
                    Cause.hasInterrupts(cause)
                        ? Effect.failCause(cause)
                        : request("/dashboard-metadata/fail", {
                              serverId,
                              jobId: job.id,
                              ...causeFix(cause, "channelId" in job.operation ? job.operation.channelId : undefined),
                          }).pipe(Effect.catch(() => Effect.void)),
                ),
            )
        }
    })
}
