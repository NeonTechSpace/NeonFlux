import type { DashboardMetadataExecuteRequest } from "@neonflux/backend/dashboard-contracts"
import { Permissions, snowflakes, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Schema } from "effect"
import { isDeepStrictEqual } from "node:util"
import type { BotConfig } from "./config.ts"
import { createBackendRequest } from "./backend-http.ts"
import { cleanupRecord } from "./cleanup-permissions.ts"
import { metadataLogCategories, metadataLogEventSelectors } from "./metadata-log-command.ts"
import { metadataHumanAccount, readMetadataLogContext } from "./metadata-log-permissions.ts"
import { metadataLogSettingsSchema } from "./metadata-log-store.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"

const n = Schema.Number.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0))
const key = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
const id = Schema.String.check(Schema.makeFilter(value => snowflakes.isValid(value) && value !== "0"))
const ids = Schema.mutable(Schema.Array(id)).check(Schema.isMaxLength(50), Schema.makeFilter(value => new Set(value).size === value.length))
const category = Schema.Literals(metadataLogCategories), eventType = Schema.Literals(metadataLogEventSelectors)
const operation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("module"), expectedRevision: n, enabled: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("channels"), expectedRevision: n, messageChannelIds: ids, excludedChannelIds: ids }),
    Schema.Struct({ type: Schema.Literal("route"), category, expectedRevision: n, enabled: Schema.Boolean, channelId: id, ownerId: id }),
    Schema.Struct({ type: Schema.Literal("clear"), category, expectedRevision: n }),
    Schema.Struct({ type: Schema.Literal("event-route"), eventType, expectedRevision: n, enabled: Schema.Boolean, channelId: Schema.optionalKey(id), ownerId: Schema.optionalKey(id) })
        .check(Schema.makeFilter(value => value.enabled ? !!value.channelId && !!value.ownerId : value.channelId === undefined && value.ownerId === undefined)),
    Schema.Struct({ type: Schema.Literal("event-clear"), eventType, expectedRevision: n }),
])
export const dashboardMetadataJobSchema = Schema.Struct({ id: key, actorId: id, expectedConfigRevision: n, operation,
    state: Schema.Literals(["queued", "applied", "failed", "conflict"]), createdAt: n, expiresAt: n, error: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(512))) })

export function processDashboardMetadataPass(config: BotConfig, client: Client) {
    return Effect.gen(function* () {
        if (!config.backend) return
        const request = createBackendRequest(config.backend), serverId = config.serverId
        const ready = yield* request("/dashboard-metadata/ready", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({
            jobs: Schema.Array(dashboardMetadataJobSchema).check(Schema.isMaxLength(4), Schema.makeFilter(jobs => new Set(jobs.map(job => job.id)).size === jobs.length)),
        }), { onExcessProperty: "error" })))
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
                const result = yield* request("/dashboard-metadata/execute", input).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({
                    job: dashboardMetadataJobSchema, settings: Schema.NullOr(metadataLogSettingsSchema),
                }), { onExcessProperty: "error" })))
                if (result.job.id !== job.id || result.job.actorId !== job.actorId || result.job.expectedConfigRevision !== job.expectedConfigRevision
                    || !isDeepStrictEqual(result.job.operation, job.operation) || result.job.state === "queued"
                    || result.job.state === "applied" && (!result.settings || result.settings.configRevision !== job.expectedConfigRevision + 1))
                    return yield* Effect.fail(new Error("Dashboard metadata result mismatch"))
            }).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
                : request("/dashboard-metadata/fail", { serverId, jobId: job.id }).pipe(Effect.catch(() => Effect.void))))
        }
    })
}
