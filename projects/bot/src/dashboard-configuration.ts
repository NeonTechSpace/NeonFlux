import type * as C from "@neonflux/backend/contracts"
import type * as D from "@neonflux/backend/dashboard-contracts"
import { Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Schema } from "effect"
import { isDeepStrictEqual } from "node:util"
import type { BotConfig } from "./config.ts"
import { createBackendRequest } from "./backend-http.ts"
import { dashboardConfigurationJobSchema, dashboardConfigurationReadyJobSchema } from "./dashboard-configuration-schema.ts"
import { readSafetyAuthority, nativeHumanAccount } from "./safety-permissions.ts"
import { cleanupRecord, readCleanupContext } from "./cleanup-permissions.ts"
import { readRoleAuthority } from "./role-permissions.ts"
import { readTicketAuthority } from "./ticket-permissions.ts"
import { readEventsContext } from "./publishing-permissions.ts"
import { readSchedulesContext } from "./schedule-permissions.ts"
import { readWelcomeDestination } from "./welcome-permissions.ts"
import { roleSnapshots } from "./roles.ts"
import { moderationActor } from "./moderation.ts"
import { createEventCalendar } from "./event-calendar.ts"
import { createScheduleCalendar } from "./schedule-calendar.ts"
import { publishingGrantSchema, type PublishingStore } from "./publishing-store.ts"
import { performPublishingGrant } from "./publishing.ts"
import { applyNativeNickname, createGeneralSettingsStore } from "./general-settings.ts"

export function readDashboardHumanIdentity(client: Client, userId: string) {
    return Effect.gen(function* () {
        const response = yield* client.rest.request({ method: "GET", path: `/users/${userId}`, timeoutMs: 5000 })
        const account = cleanupRecord(response.body)
        if (response.status !== 200 || account?.id !== userId || !nativeHumanAccount(account)) return yield* Effect.fail(new Error("Dashboard human identity unavailable"))
    })
}

function resolveCalendar(job: D.DashboardConfigurationReadyJob, now: number): C.EventsCalendar | C.SchedulesCalendar | undefined {
    let calendar: C.EventsCalendar | C.SchedulesCalendar | undefined
    if (job.family === "events" && job.operation.type === "calendar") {
        const intent = job.operation.calendar
        calendar = createEventCalendar(intent.localMinute, intent.zone, intent.durationMinutes, intent.fold, intent.recurrence)
    } else if (job.family === "schedules" && (job.operation.type === "create" || job.operation.type === "calendar")) {
        const intent = job.operation.calendar
        calendar = createScheduleCalendar(intent.localMinute, intent.zone, intent.fold, intent.recurrence)
    }
    if (calendar) {
        const dates = calendar.dates.map(date => "startsAt" in date ? date.startsAt : date.dueAt)
        if (dates.some(date => date <= now || date > now + 180 * 86400000)) throw new Error("Dashboard calendar must remain in the future within 180 days")
    }
    return calendar
}

function nativeProof(config: BotConfig, client: Client, job: D.DashboardConfigurationReadyJob) {
    return Effect.gen(function* () {
        const target = job.native, serverId = config.serverId
        let context: D.DashboardConfigurationExecuteRequest["context"], recipientOwner: D.DashboardConfigurationExecuteRequest["recipientOwner"]
        let roles: C.RolesRoleSnapshot[] | undefined
        const nativeOwner = target.ownerId ?? (["events", "schedules", "milestones"].includes(job.family) && target.channelId
            ? yield* client.guilds.fetch(serverId).pipe(Effect.timeout("5 seconds"), Effect.map(guild => guild.ownerId)) : undefined)
        if (nativeOwner && target.channelId) {
            yield* readDashboardHumanIdentity(client, nativeOwner)
            const proof = job.family === "cleanup" ? yield* readCleanupContext(client, serverId, nativeOwner, target.channelId, true)
                : job.family === "events" ? yield* readEventsContext(client, serverId, nativeOwner, target.channelId, { staff: true, write: true, hasEmbed: target.hasEmbed === true })
                    : yield* readSchedulesContext(client, serverId, nativeOwner, target.channelId, true, target.hasEmbed === true)
            context = proof
            if ("type" in job.operation && job.operation.type === "owner") recipientOwner = proof
        } else if (job.family === "greetings" && target.channelId) {
            yield* readWelcomeDestination(client, serverId, target.channelId, target.hasEmbed === true)
            context = yield* readEventsContext(client, serverId, job.actorId, target.channelId)
        }
        if (job.family === "tickets") {
            const proof = yield* readTicketAuthority(client, serverId, job.actorId, { ...(target.parentId ? { parentId: target.parentId } : {}), roleIds: target.roleIds ?? [] })
            context = proof.context
            if (target.roleIds) roles = proof.roleSnapshots
        } else if (job.family === "leveling" && job.operation.type === "mappings") {
            const authority = yield* readRoleAuthority(client, serverId, job.actorId, { configuration: true, roleIds: target.roleIds ?? [], readOnly: !target.roleIds?.length })
            roles = roleSnapshots(authority)
        }
        const references: D.DashboardConfigurationReference[] = []
        for (const channelId of new Set([...(target.channelIds ?? []), ...(target.channelId ? [target.channelId] : []), ...(target.parentId ? [target.parentId] : [])])) {
            const channel = yield* client.channels.fetch(channelId, { timeoutMs: 5000 })
            if (channel.id !== channelId || channel.guildId !== serverId) return yield* Effect.fail(new Error("Dashboard native reference mismatch"))
            references.push({ id: channelId, type: "channel", serverId, exists: true })
        }
        const authority = yield* readSafetyAuthority(client, serverId, job.actorId)
        yield* readDashboardHumanIdentity(client, job.actorId)
        const botResponse = yield* client.rest.request({ method: "GET", path: "/users/@me", timeoutMs: 5000 }), bot = cleanupRecord(botResponse.body)
        if (botResponse.status !== 200 || bot?.id !== authority.botId || bot.bot !== true || bot.system !== undefined && bot.system !== false)
            return yield* Effect.fail(new Error("Dashboard bot identity unavailable"))
        const bits = client.permissions.calculate({ guild: authority.guild, member: authority.actor, roles: authority.roles })
        const managerAuthorized = authority.isOwner || (bits & (Permissions.Administrator | Permissions.ManageGuild)) !== 0n
        if (!managerAuthorized || target.requiresOwnerAdmin && !authority.isOwner && !authority.isAdmin) return yield* Effect.fail(new Error("Dashboard manager permission revoked"))
        for (const roleId of target.roleIds ?? []) references.push({ id: roleId, type: "role", serverId, exists: authority.roles.some(role => role.id === roleId && role.guildId === serverId) })
        const observedAt = yield* Clock.currentTimeMillis
        const calendar = resolveCalendar(job, observedAt)
        const request: D.DashboardConfigurationExecuteRequest = { serverId, originServerId: authority.guild.id, jobId: job.id, actorId: job.actorId, managerAuthorized, observedAt,
            actor: moderationActor(authority), ...(context ? { context } : {}), ...(recipientOwner ? { recipientOwner } : {}), ...(roles ? { roles } : {}), ...(calendar ? { calendar } : {}), ...(references.length ? { references } : {}) }
        return request
    }).pipe(Effect.timeout("55 seconds"))
}

export function processDashboardConfigurationPass(config: BotConfig, client: Client, publishing?: PublishingStore) {
    return Effect.gen(function* () {
        if (!config.backend) return
        const request = createBackendRequest(config.backend), serverId = config.serverId
        const ready = yield* request("/dashboard-configuration/ready", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({
            jobs: Schema.Array(dashboardConfigurationReadyJobSchema).check(Schema.isMaxLength(4), Schema.makeFilter(jobs => new Set(jobs.map(job => job.id)).size === jobs.length)),
        }), { onExcessProperty: "error" })))
        for (const job of ready.jobs) yield* Effect.gen(function* () {
            if (job.state !== "queued" || (yield* Clock.currentTimeMillis) >= job.expiresAt) return
            const input = yield* nativeProof(config, client, job)
            const result = yield* request("/dashboard-configuration/execute", input).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({
                job: dashboardConfigurationJobSchema, grant: Schema.optionalKey(publishingGrantSchema),
            }), { onExcessProperty: "error" })))
            if (result.job.id !== job.id || result.job.actorId !== job.actorId || result.job.family !== job.family || result.job.expectedConfigRevision !== job.expectedConfigRevision
                || !isDeepStrictEqual(result.job.operation, job.operation) || result.job.state === "queued") return yield* Effect.fail(new Error("Dashboard configuration result mismatch"))
            // The backend recorded the desired nickname, so the bot applies it as itself and reports what Fluxer kept
            if (job.family === "nickname" && result.job.state === "applied") {
                const nickname = job.operation.type === "set" ? job.operation.nickname : null
                yield* createGeneralSettingsStore(config.backend!, serverId).recordNickname(job.expectedConfigRevision + 1, nickname, yield* applyNativeNickname(client, serverId, nickname))
            }
            if (result.grant) {
                if (!publishing || result.job.state !== "applied" || job.family !== "events" || !("eventNo" in job.operation)
                    || !["publish", "calendar", "content", "capacity", "reminders", "template"].includes(job.operation.type) || result.grant.consumer?.type !== "event"
                    || result.grant.consumer.purpose !== "card" || result.grant.consumer.revision !== job.operation.expectedRevision + (job.operation.type === "publish" ? 0 : 1)
                    || result.grant.consumer.eventNo !== job.operation.eventNo || result.grant.actorId !== job.native.ownerId || result.grant.channelId !== job.native.channelId || result.grant.botId !== input.context?.botId
                    || result.grant.source?.type !== "dashboard-configuration" || result.grant.source.jobId !== job.id || result.grant.source.createdAt !== job.createdAt)
                    return yield* Effect.fail(new Error("Dashboard event publishing binding mismatch"))
                const grant = result.grant
                yield* performPublishingGrant(publishing, serverId, grant.actorId, client, grant,
                    () => readEventsContext(client, serverId, grant.actorId, grant.channelId, { staff: true, write: true, hasEmbed: !!grant.content.embed }), undefined,
                    () => nativeProof(config, client, job).pipe(Effect.map(proof => ({ originServerId: proof.originServerId!, jobId: job.id, actorId: job.actorId,
                        managerAuthorized: proof.managerAuthorized, observedAt: proof.observedAt, botId: grant.botId, channelId: grant.channelId }))))
            }
        }).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
            : request("/dashboard-configuration/fail", { serverId, jobId: job.id }).pipe(Effect.catch(() => Effect.void))))
    })
}
