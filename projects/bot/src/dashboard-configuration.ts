import type { EventsCalendar } from "@neonflux/contracts/events"
import type { SchedulesCalendar } from "@neonflux/contracts/schedules"
import type { RolesRoleSnapshot } from "@neonflux/contracts/shared"
import { DashboardConfigurationExecuteResult, DashboardConfigurationReadyResult } from "@neonflux/contracts/dashboard"
import type * as D from "@neonflux/contracts/dashboard"
import { Permissions, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Schema } from "effect"
import { isDeepStrictEqual } from "node:util"
import type { BotConfig } from "./config.ts"
import { createBackendRequest } from "./backend-http.ts"
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
import type { PublishingStore } from "./publishing-store.ts"
import { performPublishingGrant } from "./publishing.ts"
import { applyNativeNickname, createGeneralSettingsStore } from "./general-settings.ts"
import { finishVoiceDashboardJob, prepareVoiceDashboardJob } from "./voice-management.ts"
import { rolePickerDisplay } from "./rolepicker-store.ts"
import { prepareSidebarDashboardJob } from "./sidebar-management.ts"
import { createSidebarStore } from "./sidebar-store.ts"
import { prepareMemberListDashboardJob } from "./memberlist-management.ts"
import { stickyRuntimes } from "./sticky-worker.ts"
import { prepareAlertsDashboardJob } from "./alerts-management.ts"
import { alertRuntimes } from "./alerts-worker.ts"
import { helpDeskRuntimes } from "./helpdesk-worker.ts"
import { onboardingRuntimes } from "./onboarding.ts"
import { readChannelParent } from "./fluxerly-next.ts"
import { ensureSuggestionTags, readSuggestionForum, SuggestionTagError } from "./suggestion-forum.ts"

export function readDashboardHumanIdentity(client: Client, userId: string) {
    return Effect.gen(function* () {
        const response = yield* client.rest.request({ method: "GET", path: `/users/${userId}`, timeoutMs: 5000 })
        const account = cleanupRecord(response.body)
        if (response.status !== 200 || account?.id !== userId || !nativeHumanAccount(account)) return yield* Effect.fail(new Error("Dashboard human identity unavailable"))
    })
}

function resolveCalendar(job: D.DashboardConfigurationReadyJob, now: number): EventsCalendar | SchedulesCalendar | undefined {
    let calendar: EventsCalendar | SchedulesCalendar | undefined
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
        let roles: RolesRoleSnapshot[] | undefined
        const nativeOwner = target.ownerId ?? (["events", "schedules", "milestones"].includes(job.family) && target.channelId
            ? yield* client.guilds.fetch(serverId).pipe(Effect.timeout("5 seconds"), Effect.map(guild => guild.ownerId)) : undefined)
        if (nativeOwner && target.channelId) {
            yield* readDashboardHumanIdentity(client, nativeOwner)
            const proof = job.family === "cleanup" ? yield* readCleanupContext(client, serverId, nativeOwner, target.channelId, true)
                : job.family === "events" ? yield* readEventsContext(client, serverId, nativeOwner, target.channelId, { staff: true, write: true, hasEmbed: target.hasEmbed === true, forum: "forum" })
                    : yield* readSchedulesContext(client, serverId, nativeOwner, target.channelId, true, target.hasEmbed === true, job.family === "suggestions" ? "forum" : false)
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
        } else if (job.family === "leveling" && job.operation.type === "mappings" || job.family === "rolepicker" && job.operation.type === "menu-set"
            || job.family === "onboarding" && job.operation.type === "role" && job.operation.roleId !== null) {
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
            actor: moderationActor(authority), ...(context ? { context } : {}), ...(recipientOwner ? { recipientOwner } : {}), ...(roles ? { roles } : {}), ...(calendar ? { calendar } : {}), ...(references.length ? { references } : {}),
            // Role picker saves store the menu roles' current names with the menus
            ...(job.family === "rolepicker" ? { display: rolePickerDisplay(serverId, authority.roles) } : {}) }
        return request
    }).pipe(Effect.timeout("55 seconds"))
}

/** The fix a failed job reports when the bot knows it */
function tagFix(cause: Cause.Cause<unknown>) {
    const failure = cause.reasons.find(reason => reason._tag === "Fail" && reason.error instanceof SuggestionTagError)
    return failure?._tag === "Fail" ? { reason: (failure.error as SuggestionTagError).fix.replace(/<#\d+>/g, "the forum") } : {}
}
export function processDashboardConfigurationPass(config: BotConfig, client: Client, publishing?: PublishingStore) {
    return Effect.gen(function* () {
        if (!config.backend) return
        const request = createBackendRequest(config.backend), serverId = config.serverId
        const ready = yield* request("/dashboard-configuration/ready", { serverId }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(DashboardConfigurationReadyResult, { onExcessProperty: "error" })))
        for (const job of ready.jobs) yield* Effect.gen(function* () {
            if (job.state !== "queued" || (yield* Clock.currentTimeMillis) >= job.expiresAt) return
            const input = yield* nativeProof(config, client, job)
            // A forum destination for suggestions needs its status tags before the first post
            const forum = job.family === "suggestions" && job.operation.type === "configure" ? yield* readSuggestionForum(client, job.operation.channelId) : undefined
            if (forum) yield* ensureSuggestionTags(client, forum)
            const voice = yield* prepareVoiceDashboardJob(client, serverId, job)
            const sidebar = yield* prepareSidebarDashboardJob(client, createSidebarStore(config.backend!), config, job)
            // The member-list order lives only in Fluxer, so it is applied before the backend records the change
            yield* prepareMemberListDashboardJob(client, serverId, job)
            const alerts = yield* prepareAlertsDashboardJob(client, serverId, job)
            const native = voice ?? sidebar ?? alerts
            const result = yield* request("/dashboard-configuration/execute", native?.context ? { ...input, context: native.context } : input).pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(DashboardConfigurationExecuteResult, { onExcessProperty: "error" })), Effect.tapError(() => native?.undo ?? Effect.void))
            if (voice) yield* finishVoiceDashboardJob(serverId, result.job.state, voice)
            if (sidebar && result.job.state !== "applied") yield* sidebar.undo
            // Sticky messages run from memory, so an applied change reloads them and posts or removes copies at once
            if (job.family === "sticky" && result.job.state === "applied") yield* stickyRuntimes.get(serverId)?.reload() ?? Effect.void
            // Security alerts also check in-memory settings
            if (job.family === "alerts" && (job.operation.type === "set" || job.operation.type === "expect") && result.job.state === "applied") yield* alertRuntimes.get(serverId)?.reload() ?? Effect.void
            if (job.family === "helpdesk" && result.job.state === "applied") yield* helpDeskRuntimes.get(serverId)?.reload() ?? Effect.void
            // The newcomer checklist is kept in memory too, so an applied change is read again
            if (job.family === "onboarding" && result.job.state === "applied") yield* (onboardingRuntimes.get(serverId)?.reload() ?? Effect.void).pipe(Effect.catch(() => Effect.void))
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
                    || result.grant.consumer.eventNo !== job.operation.eventNo || result.grant.actorId !== job.native.ownerId || result.grant.channelId !== job.native.channelId && (yield* readChannelParent(client, result.grant.channelId)) !== job.native.channelId || result.grant.botId !== input.context?.botId
                    || result.grant.source?.type !== "dashboard-configuration" || result.grant.source.jobId !== job.id || result.grant.source.createdAt !== job.createdAt)
                    return yield* Effect.fail(new Error("Dashboard event publishing binding mismatch"))
                const grant = result.grant
                yield* performPublishingGrant(publishing, serverId, grant.actorId, client, grant,
                    () => readEventsContext(client, serverId, grant.actorId, grant.channelId, { staff: true, write: true, hasEmbed: !!grant.content.embed, forum: "post" }), undefined,
                    () => nativeProof(config, client, job).pipe(Effect.map(proof => ({ originServerId: proof.originServerId!, jobId: job.id, actorId: job.actorId,
                        managerAuthorized: proof.managerAuthorized, observedAt: proof.observedAt, botId: grant.botId, channelId: grant.channelId }))))
            }
        }).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
            : request("/dashboard-configuration/fail", { serverId, jobId: job.id, ...tagFix(cause) }).pipe(Effect.catch(() => Effect.void))))
    })
}
