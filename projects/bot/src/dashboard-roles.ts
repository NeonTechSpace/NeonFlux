import { DashboardPublishingReserveResult, DashboardRoleCompleteResult, DashboardRoleExecuteResult, DashboardRoleReadyResult, type DashboardRoleJob } from "@neonflux/contracts/dashboard"
import type { RolesManageResult } from "@neonflux/contracts/roles"
import { Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Queue, Schema, Struct } from "effect"
import type { BotConfig } from "./config.ts"
import { createBackendRequest } from "./backend-http.ts"
import { readRoleAuthority } from "./role-permissions.ts"
import { roleSnapshots } from "./roles.ts"
import { readPublishingAuthority } from "./publishing-permissions.ts"
import { performPublishingGrant } from "./publishing.ts"
import type { PublishingStore } from "./publishing-store.ts"
import { isDeepStrictEqual } from "node:util"
import { processDashboardMessagesPass } from "./dashboard-messages.ts"
import { processDashboardMetadataPass } from "./dashboard-metadata.ts"
import { processDashboardConfigurationPass, readDashboardHumanIdentity } from "./dashboard-configuration.ts"

// The bot reads only the grant. A reserved attempt is never sent again
const reserveResult = DashboardPublishingReserveResult.mapFields(Struct.pick(["grant"]))
export type DashboardPanelPublisher = (job: DashboardRoleJob, result: RolesManageResult | null) => Effect.Effect<unknown, unknown>
export function processDashboardRolesPass(config: BotConfig, client: Client, publish?: DashboardPanelPublisher) {
    return Effect.gen(function* () {
        if (!config.backend) return
        const request = createBackendRequest(config.backend), serverId = config.serverId
        const ready = yield* request("/dashboard-roles/ready", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(DashboardRoleReadyResult, { onExcessProperty: "error" })))
        for (const job of ready.jobs) {
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
                    observedAt: yield* Clock.currentTimeMillis, roles }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(DashboardRoleExecuteResult, { onExcessProperty: "error" })))
                const current = executed.job
                if (current.id !== job.id || current.actorId !== job.actorId || !isDeepStrictEqual(current.operation, job.operation)) return yield* Effect.fail(new Error("Dashboard role result mismatch"))
                if (current.state === "configured" && publish) yield* publish(current, executed.result)
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
        const reserved = yield* request("/dashboard-roles/reserve", { serverId, ...initial.dashboardContext }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(reserveResult)))
        if (reserved.grant) {
            yield* performPublishingGrant(publishing, serverId, job.actorId, client, reserved.grant, undefined, fresh)
        }
        const completion = yield* request("/dashboard-roles/complete", { serverId, jobId: job.id }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(DashboardRoleCompleteResult)))
        if (completion.job.state === "applied" && completion.result && !completion.result.duplicate && completion.result.type === "panel") {
            // Native reaction seeding is a convenience, never a role grant or binding proof
            const panel = completion.result.panel
            if (panel.published) for (const mapping of panel.mappings) yield* client.messages.addReaction({ id: panel.published.messageId, channelId: panel.published.channelId }, mapping.emoji).pipe(Effect.catch(() => Effect.void))
        }
    })
}
/** memberRequests runs the role picker's member requests, which share the dashboard job tables and so the dashboard wake */
export function startDashboardRolesWorker(config: BotConfig, client: Client, publish?: DashboardPanelPublisher, publishing?: PublishingStore, memberRequests?: Effect.Effect<void, unknown>,
    setupChecks?: Effect.Effect<void, unknown>, privateChecks?: Effect.Effect<void, unknown>, backupPreviews?: Effect.Effect<void, unknown>, showcaseRequests?: Effect.Effect<void, unknown>, profileRequests?: Effect.Effect<void, unknown>,
    structureJobs?: Effect.Effect<void, unknown>) {
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
            // A failing manager pass never holds back member requests
            if (memberRequests) yield* memberRequests.pipe(
                Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning("Role picker requests paused")))
            if (setupChecks) yield* setupChecks.pipe(
                Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning("Dashboard permission check paused")))
            if (privateChecks) yield* privateChecks.pipe(
                Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning("Private case access checks paused")))
            if (backupPreviews) yield* backupPreviews.pipe(
                Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning("Backup preview refresh paused")))
            if (showcaseRequests) yield* showcaseRequests.pipe(
                Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning("Showcase requests paused")))
            if (profileRequests) yield* profileRequests.pipe(
                Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning("Profile requests paused")))
            if (structureJobs) yield* structureJobs.pipe(
                Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning("Server structure requests paused")))
        } }).pipe(Effect.forkScoped({ startImmediately: true }))
        // The work dispatcher wakes this worker when the backend holds dashboard jobs for this server
        return { notify }
    })
}
