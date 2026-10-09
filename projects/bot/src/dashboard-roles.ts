import type { DashboardRoleJob } from "@neonflux/backend/dashboard-contracts"
import type { RolesManageResult } from "@neonflux/backend/contracts"
import { Permissions, snowflakes, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Queue, Schema } from "effect"
import type { BotConfig } from "./config.ts"
import { createBackendRequest } from "./backend-http.ts"
import { readRoleAuthority } from "./role-permissions.ts"
import { roleSnapshots } from "./roles.ts"
import { readPublishingAuthority } from "./publishing-permissions.ts"
import { performPublishingGrant } from "./publishing.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { publishingGrantSchema } from "./publishing-store.ts"
import { rolesManageSchema, rolesMappingsSchema, rolesReservationsSchema } from "./roles-store.ts"
import { isDeepStrictEqual } from "node:util"
import { publishingContentSchema } from "./publishing-content.ts"
import { processDashboardMessagesPass } from "./dashboard-messages.ts"
import { processDashboardMetadataPass } from "./dashboard-metadata.ts"
import { processDashboardConfigurationPass, readDashboardHumanIdentity } from "./dashboard-configuration.ts"

const integer = Schema.Number.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0))
const positive = integer.check(Schema.isGreaterThanOrEqualTo(1)), id = Schema.String.check(Schema.makeFilter(v => snowflakes.isValid(v) && v !== "0"))
const key = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/)), name = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,31}$/))
const optional = Schema.optionalKey
const operationSchema = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), patch: Schema.Struct({ panelsEnabled: optional(Schema.Boolean), verificationEnabled: optional(Schema.Boolean), advancedVerificationEnabled: optional(Schema.Boolean),
        autoroleEnabled: optional(Schema.Boolean), humansOnly: optional(Schema.Boolean), autoroleIds: optional(Schema.Array(id).check(Schema.isMaxLength(20), Schema.makeFilter(ids => new Set(ids).size === ids.length))),
        reservations: optional(rolesReservationsSchema) }) }),
    Schema.Struct({ type: Schema.Literal("panel-create"), name, kind: Schema.Literals(["reaction", "verification"]), mappings: rolesMappingsSchema, exclusive: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("panel-update"), name, expectedRevision: positive, patch: Schema.Struct({ enabled: optional(Schema.Boolean), exclusive: optional(Schema.Boolean), mappings: optional(rolesMappingsSchema) }) }),
])
const jobSchema = Schema.Struct({ id: key, actorId: id, section: Schema.Literals(["reaction", "autorole", "verification"]), expectedRevision: integer,
    operation: operationSchema, state: Schema.Literals(["queued", "configured", "applied", "failed", "conflict"]), createdAt: integer, expiresAt: integer, error: optional(Schema.String), publication: optional(Schema.Struct({ channelId: id, content: publishingContentSchema })) })
export type DashboardPanelPublisher = (job: DashboardRoleJob, result: RolesManageResult | null) => Effect.Effect<unknown, unknown>
export function processDashboardRolesPass(config: BotConfig, client: Client, publish?: DashboardPanelPublisher) {
    return Effect.gen(function* () {
        if (!config.backend) return
        const request = createBackendRequest(config.backend), serverId = config.serverId
        const ready = yield* request("/dashboard-roles/ready", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ jobs: Schema.Array(jobSchema).check(Schema.isMaxLength(4), Schema.makeFilter(jobs => new Set(jobs.map(job => job.id)).size === jobs.length)) }), { onExcessProperty: "error" })))
        for (const decoded of ready.jobs) {
            const job = decoded as DashboardRoleJob
            yield* Effect.gen(function* () {
                if ((yield* Clock.currentTimeMillis) >= job.expiresAt) return
                if (job.state === "configured") { if (publish) yield* publish(job, null); return }
                if (job.state !== "queued") return
                const op = job.operation
                const roleIds = op.type === "settings" ? [...new Set([...(op.patch.autoroleIds ?? []), ...(op.patch.reservations ?? []).flatMap(row => row.roleIds)])] : op.type === "panel-create" ? op.mappings.map(mapping => mapping.roleId) : op.type === "panel-update" ? op.patch.mappings?.map(mapping => mapping.roleId) ?? [] : []
                const authority = yield* readRoleAuthority(client, serverId, job.actorId, { configuration: true, roleIds, readOnly: !roleIds.length })
                yield* readDashboardHumanIdentity(client, job.actorId)
                const bits = client.permissions.calculate({ guild: authority.guild, member: authority.actor, roles: authority.roles })
                const managerAuthorized = authority.isOwner || (bits & (Permissions.Administrator | Permissions.ManageGuild)) !== 0n
                if (!managerAuthorized) return yield* Effect.fail(new Error("Dashboard role configuration requires Manage Server"))
                const roles = roleSnapshots(authority)
                if (job.publication) {
                    const channel = yield* client.channels.fetch(job.publication.channelId, { timeoutMs: 5000 })
                    if (channel.guildId !== serverId) return yield* Effect.fail(new Error("Dashboard destination mismatch"))
                }
                const executed = yield* request("/dashboard-roles/execute", { serverId, originServerId: serverId, jobId: job.id, actorId: job.actorId, managerAuthorized,
                    observedAt: yield* Clock.currentTimeMillis, roles }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ job: jobSchema, result: Schema.NullOr(rolesManageSchema) }), { onExcessProperty: "error" })))
                const current = executed.job as DashboardRoleJob
                if (current.id !== job.id || current.actorId !== job.actorId || !isDeepStrictEqual(current.operation, job.operation)) return yield* Effect.fail(new Error("Dashboard role result mismatch"))
                if (current.state === "configured" && publish) yield* publish(current, executed.result as RolesManageResult)
            }).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : request("/dashboard-roles/fail", { serverId, jobId: job.id }).pipe(Effect.catch(() => Effect.void))))
        }
    })
}
export function createDashboardPanelPublisher(config: BotConfig, client: Client, publishing: PublishingStore): DashboardPanelPublisher {
    return (job, result) => Effect.gen(function* () {
        if (!config.backend || !job.publication) return
        const request = createBackendRequest(config.backend), serverId = config.serverId
        const fresh = () => Effect.gen(function* () {
            const authority = yield* readPublishingAuthority(client, serverId, job.actorId, job.publication!.channelId, !!job.publication!.content.embed, false, true)
            const bits = client.permissions.calculate({ guild: authority.guild, member: authority.actor, roles: authority.roles })
            return { authority, dashboardContext: { originServerId: serverId, jobId: job.id, actorId: job.actorId, managerAuthorized: authority.isOwner || (bits & (Permissions.Administrator | Permissions.ManageGuild)) !== 0n,
                observedAt: yield* Clock.currentTimeMillis, botId: authority.botId, channelId: job.publication!.channelId } }
        })
        const initial = yield* fresh()
        const reserved = yield* request("/dashboard-roles/reserve", { serverId, ...initial.dashboardContext }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ grant: Schema.NullOr(publishingGrantSchema), attempt: Schema.Unknown }))))
        if (reserved.grant) {
            yield* performPublishingGrant(publishing, serverId, job.actorId, client, reserved.grant, undefined, fresh)
        }
        const completion = yield* request("/dashboard-roles/complete", { serverId, jobId: job.id }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ job: jobSchema, result: Schema.optionalKey(rolesManageSchema) }))))
        if (completion.job.state === "applied" && completion.result && !completion.result.duplicate && completion.result.type === "panel") {
            // Native reaction seeding is a convenience, never a role grant or binding proof
            const panel = completion.result.panel
            if (panel.published) for (const mapping of panel.mappings) yield* client.messages.addReaction({ id: panel.published.messageId, channelId: panel.published.channelId }, mapping.emoji).pipe(Effect.catch(() => Effect.void))
        }
    })
}
export function startDashboardRolesWorker(config: BotConfig, client: Client, publish?: DashboardPanelPublisher, publishing?: PublishingStore) {
    return Effect.gen(function* () {
        const queue = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" }), notify = () => Queue.offer(queue, undefined).pipe(Effect.asVoid)
        yield* Effect.gen(function* () { for (;;) {
            yield* Queue.take(queue)
            yield* Effect.gen(function* () {
                yield* processDashboardRolesPass(config, client, publish)
                yield* processDashboardMetadataPass(config, client)
                yield* processDashboardConfigurationPass(config, client, publishing)
                if (publishing) yield* processDashboardMessagesPass(config, client, publishing)
            }).pipe(
                Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning("Dashboard configuration paused")))
        } }).pipe(Effect.forkScoped({ startImmediately: true }))
        // The work dispatcher wakes this worker when the backend holds dashboard jobs for this server
        return { notify }
    })
}
