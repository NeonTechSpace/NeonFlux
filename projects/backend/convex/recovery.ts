import { v } from "convex/values"
import { query, type QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import type { RecoveryEntry, RecoveryInbox, RecoverySource, SetupProblem } from "../dashboard-contracts.js"
import { serviceQuery } from "./installations.ts"
import { dashboardSession } from "./dashboard.ts"
import { readSetupSections } from "./setupCheck.ts"
import { config as moderationConfig, readSettings as readModeration } from "./moderationStore.ts"
import { readHelpDesk } from "./helpDesk.ts"
import { TEMPORARY_ROLE_KEY } from "./temporaryRolesStore.ts"
import { ONBOARDING_ROLE_KEY } from "./onboardingDomain.ts"
import { object, requireId } from "./validation.ts"
import { youtubeSource, youtubeSubscriptions } from "./youtubeStore.ts"

// The recovery inbox: failed, stuck or uncertain work that a feature already records, the features that are on but cannot act and the
// problems of the latest permission check. It adds no tracking of its own. Each source reads at most RECOVERY_SCAN rows through its
// own index and shows its newest RECOVERY_PER_SOURCE entries, and the inbox shows at most RECOVERY_LIMIT entries
export const RECOVERY_SCAN = 50
export const RECOVERY_PER_SOURCE = 10
export const RECOVERY_LIMIT = 100
/** Failures that nothing can resolve anymore stay in the inbox this long, so it shows what needs attention now */
export const RECOVERY_SETTLED_MS = 7 * 86400000

type Work = Extract<RecoveryEntry, { kind: "work" }>
const work = (source: RecoverySource, summary: string, next: string, at?: number): Work => ({ kind: "work", source, ...(at !== undefined ? { at } : {}), summary, next })
const newest = <T>(rows: T[], at: (row: T) => number) => rows.sort((a, b) => at(b) - at(a)).slice(0, RECOVERY_PER_SOURCE)
const retried = "NeonFlux tries again every 10 minutes"

// Posts of every feature go through the publisher, whose attempts keep an unknown outcome open until it is reconciled or resolved
async function publishingEntry(ctx: QueryCtx, attempt: Doc<"publishingAttempts">): Promise<Work> {
    const consumer = attempt.consumer, post = attempt.postNo, unknown = attempt.outcome === "uncertain", subject = consumer ? `Post ${post}` : "It"
    // A send to a forum or media channel creates a forum post, whose thread is known once Fluxer answered
    const done = `${attempt.action === "send" ? "sent" : "edited"}${attempt.threadId ? ` in forum post ${attempt.threadId}` : attempt.forumPostName ? " as a forum post" : ""}`
    const outcome = unknown ? `NeonFlux could not confirm whether ${subject.toLowerCase()} was ${done}` : `${subject} could not be ${done}, and nothing changed`
    if (!consumer) return work("publishing", `Post ${post}: ${outcome}`,
        unknown ? `!publish reconcile ${post}, or record what happened with !publish resolve ${post} sent <message-id> or !publish resolve ${post} failed` : `!publish status ${post}, then send or edit it again`, attempt.createdAt)
    if (consumer.type === "schedule") {
        // Schedule commands name the schedule, so its row is read once by number. A forgotten schedule has nothing left to recheck
        const schedule = await ctx.db.query("schedules").withIndex("by_number", q => q.eq("serverId", attempt.serverId).eq("scheduleNo", consumer.scheduleNo)).unique()
        return work("schedules", `Schedule ${schedule?.name ?? consumer.scheduleNo}, delivery ${consumer.occurrenceNo}: ${outcome}`, !schedule ? "The schedule was forgotten, so NeonFlux cannot recheck the post. Check the channel in Fluxer if it matters"
            : unknown ? `!publish schedule reconcile ${schedule.name} ${post}` : `!publish schedule status ${schedule.name}`, attempt.createdAt)
    }
    if (consumer.type === "event") {
        // Event commands name the event, so its row is read once by number. A forgotten event has nothing left to recheck
        const event = await ctx.db.query("events").withIndex("by_number", q => q.eq("serverId", attempt.serverId).eq("eventNo", consumer.eventNo)).unique()
        return work("events", `Event ${event?.name ?? consumer.eventNo} ${consumer.purpose}: ${outcome}`, !event ? "The event was forgotten, so NeonFlux cannot recheck the post. Check the channel in Fluxer if it matters"
            : unknown ? `!event reconcile ${event.name} ${post}` : `!event status ${event.name}`, attempt.createdAt)
    }
    if (consumer.type === "milestone") return work("milestones", `${consumer.kind === "birthday" ? "Birthday" : "Anniversary"} post for member ${consumer.userId}: ${outcome}`,
        unknown ? `!milestone reconcile ${consumer.kind} ${post}` : `!milestone status ${consumer.kind}`, attempt.createdAt)
    if (consumer.type === "youtube") return work("youtube", `YouTube alert ${post} for video ${consumer.videoId}: ${outcome}`,
        unknown ? `!publish reconcile ${post}, or record what happened with !publish resolve ${post} sent <message-id> or !publish resolve ${post} failed. NeonFlux never posts an alert twice` : "!youtube status shows the channel's alerts", attempt.createdAt)
    return work("suggestions", `Suggestion ${consumer.suggestionNo} card: ${outcome}`, `!suggest publication ${consumer.suggestionNo}, then !suggest reconcile ${consumer.suggestionNo}`, attempt.createdAt)
}

async function readPublishing(ctx: QueryCtx, serverId: string, now: number) {
    const unknown = await ctx.db.query("publishingAttempts").withIndex("by_pending", q => q.eq("serverId", serverId).eq("outcome", "uncertain")).order("desc").take(RECOVERY_SCAN)
    const failed = await ctx.db.query("publishingAttempts").withIndex("by_pending", q => q.eq("serverId", serverId).eq("outcome", "failed").gt("createdAt", now - RECOVERY_SETTLED_MS)).order("desc").take(RECOVERY_PER_SOURCE)
    return Promise.all(newest([...unknown.filter(attempt => attempt.unresolved), ...failed], attempt => attempt.createdAt).map(attempt => publishingEntry(ctx, attempt)))
}

async function readRoles(ctx: QueryCtx, serverId: string) {
    const attempts = (await ctx.db.query("roleAttempts").withIndex("by_server_pending", q => q.eq("serverId", serverId).eq("outcome", "uncertain")).order("desc").take(RECOVERY_SCAN))
        .filter(attempt => attempt.observationAt === undefined)
    const entries: Work[] = []
    for (const attempt of newest(attempts, attempt => attempt.createdAt)) {
        const key = attempt.consumerKey, user = attempt.userId, panel = /^panel:(.+):\d+$/.exec(key)?.[1]
        const kind = panel ? (await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", serverId).eq("name", panel)).unique())?.kind : undefined
        const next = panel ? kind === "verification" ? `!verify reconcile ${user}` : `!roles reconcile ${panel} ${user}` : key.startsWith("autorole:") ? `!autorole reconcile ${user}`
            : key === TEMPORARY_ROLE_KEY ? `!temprole reconcile ${user}` : key === "level" ? `!level reconcile ${user}`
                : key === ONBOARDING_ROLE_KEY ? "NeonFlux never repeats the completion role. Check the member's roles in Fluxer and give the role by hand if it is missing"
                : "The role picker never repeats a role change. Check the member's roles in Fluxer, and the member can claim or drop the role again"
        entries.push(work("roles", `Member ${user}: NeonFlux could not confirm whether it ${attempt.action === "add" ? "gave" : "removed"} role ${attempt.roleId}`, next, attempt.createdAt))
    }
    const withdrawals = (await ctx.db.query("roleWithdrawals").withIndex("by_consumer", q => q.eq("serverId", serverId)).take(RECOVERY_SCAN)).filter(row => row.status === "blocked")
    for (const row of newest(withdrawals, row => row.createdAt)) {
        const panel = /^panel:(.+):\d+$/.exec(row.consumerKey)?.[1]
        const kind = panel ? (await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", serverId).eq("name", panel)).unique())?.kind : undefined
        const command = !panel ? "!autorole" : kind === "verification" ? "!verify" : "!roles"
        entries.push(work("roles", `${panel ? `Panel ${panel}` : "Autorole"}: Taking back its roles stopped at a role change that needs a check`, `${command} next ${row._id}`, row.createdAt))
    }
    return entries
}

const temporaryProblems: Record<NonNullable<Doc<"temporaryRoleGrants">["problem"]>, [string, string]> = {
    permission: ["NeonFlux lacks Manage Roles", `Grant Manage Roles to the NeonFlux role. ${retried}`],
    role: ["the role ranks at or above NeonFlux's highest role", `Move the NeonFlux role above the role. ${retried}`],
    refused: ["Fluxer refused the change", `!health names missing permissions. ${retried}`],
    unavailable: ["Fluxer could not be read", retried],
    uncertain: ["NeonFlux could not confirm the last role change", ""],
}
async function readTemporaryRoles(ctx: QueryCtx, serverId: string, now: number) {
    const grants = (await ctx.db.query("temporaryRoleGrants").withIndex("by_server_due", q => q.eq("serverId", serverId)).take(RECOVERY_SCAN)).filter(grant => grant.problem !== undefined)
    // A removal problem dates from the end time, and an unconfirmed grant or renewal from its last change
    const at = (grant: Doc<"temporaryRoleGrants">) => grant.endsAt <= now ? grant.endsAt : grant.updatedAt
    return newest(grants, at).map(grant => {
        const [why, next] = temporaryProblems[grant.problem!]
        return work("temproles", `Temporary role ${grant.roleId} of member ${grant.userId}: ${why}`, next || `!temprole reconcile ${grant.userId}`, at(grant))
    })
}

async function readTickets(ctx: QueryCtx, serverId: string) {
    const tickets = (await ctx.db.query("tickets").withIndex("by_number", q => q.eq("serverId", serverId)).order("desc").take(RECOVERY_SCAN)).filter(ticket => ticket.state === "uncertain").slice(0, RECOVERY_PER_SOURCE)
    const entries: Work[] = []
    for (const ticket of tickets) {
        const attempt = ticket.currentAttemptId ? await ctx.db.get(ticket.currentAttemptId) : null, operation = ticket.transition ?? "create"
        entries.push(work("tickets", `Ticket ${ticket.ticketNo}: NeonFlux could not confirm whether its ${operation === "create" ? "channel was created" : `${operation} finished`}`,
            `!ticket reconcile ${ticket.ticketNo}${ticket.channelId ? "" : `, or !ticket abandon ${ticket.ticketNo} if no channel was created`}`, attempt?.createdAt ?? ticket.createdAt))
    }
    return entries
}

async function readCleanup(ctx: QueryCtx, serverId: string) {
    const targets = await ctx.db.query("cleanupTargets").withIndex("by_recovery_unresolved", q => q.eq("serverId", serverId).eq("replayBlocked", true).eq("expiresAt", undefined)).order("desc").take(RECOVERY_PER_SOURCE)
    const entries = targets.map(target => work("cleanup", `Cleanup in channel ${target.channelId}: ${target.state === "failed" ? `Deleting message ${target.messageId} failed` : `NeonFlux could not confirm whether message ${target.messageId} was deleted`}`,
        "!cleanup status #channel shows it. NeonFlux never repeats a deletion, so check the message yourself", target.updatedAt))
    const policies = (await ctx.db.query("cleanupPolicies").withIndex("by_due", q => q.eq("serverId", serverId).eq("enabled", true)).take(RECOVERY_SCAN)).filter(policy => policy.blockedReason)
    return [...policies.slice(0, RECOVERY_PER_SOURCE).map(policy => work("cleanup", `Cleanup in channel ${policy.channelId} is blocked: ${policy.blockedReason}`,
        "Give NeonFlux View Channel, Read Message History and Manage Messages in that channel, or fix what the reason names. It checks again on its own")), ...entries]
}

const greetingCommands = { welcome: "!welcome", dm: "!welcome dm", goodbye: "!goodbye" } as const
async function readGreetings(ctx: QueryCtx, serverId: string, now: number) {
    const rows = (await ctx.db.query("greetingDeliveries").withIndex("by_server", q => q.eq("serverId", serverId)).order("desc").take(RECOVERY_SCAN))
        .filter(row => row.state === "uncertain" || row.state === "failed" && row.createdAt > now - RECOVERY_SETTLED_MS)
    return newest(rows, row => row.createdAt).map(row => work("greetings", `${row.route === "dm" ? "DM greeting" : row.route === "welcome" ? "Welcome" : "Goodbye"} ${row.deliveryNo} for member ${row.userId}: ${row.state === "failed"
        ? `Not sent${row.reason ? `, ${row.reason}` : ""}` : "NeonFlux could not confirm whether it was sent"}`, `${greetingCommands[row.route]} status ${row.deliveryNo}. NeonFlux never sends a greeting twice`, row.finishedAt ?? row.createdAt))
}

async function readBlockedDeliveries(ctx: QueryCtx, serverId: string) {
    const permissions = "Give NeonFlux View Channel, Send Messages and Embed Links in that channel. It tries again on its own"
    const schedules = (await ctx.db.query("scheduleDeliveries").withIndex("by_discovery", q => q.eq("serverId", serverId).eq("active", true)).take(RECOVERY_SCAN)).filter(row => row.state === "blocked")
    const milestones: Doc<"milestoneDeliveries">[] = []
    for (const kind of ["birthday", "anniversary"] as const) milestones.push(...(await ctx.db.query("milestoneDeliveries").withIndex("by_route", q => q.eq("serverId", serverId).eq("kind", kind)).order("desc").take(RECOVERY_SCAN / 2))
        .filter(row => row.active && row.state === "blocked"))
    // Schedule commands name the schedule, so each entry reads its schedule's row once by number
    const scheduleName = async (scheduleNo: number) => (await ctx.db.query("schedules").withIndex("by_number", q => q.eq("serverId", serverId).eq("scheduleNo", scheduleNo)).unique())?.name ?? scheduleNo
    return [...await Promise.all(newest(schedules, row => row.dueAt).map(async row => work("schedules", `Schedule ${await scheduleName(row.scheduleNo)}, delivery ${row.occurrenceNo} is waiting: NeonFlux cannot post in channel ${row.channelId}`, permissions, row.dueAt))),
        ...newest(milestones, row => row.dueAt).map(row => work("milestones", `${row.kind === "birthday" ? "Birthday" : "Anniversary"} post for member ${row.userId} is waiting: NeonFlux cannot post in channel ${row.channelId}`, permissions, row.dueAt))]
}

// Followed channels NeonFlux turned off, with the fix, and channels whose subscription at YouTube's hub keeps failing
async function readYoutube(ctx: QueryCtx, serverId: string) {
    const entries: Work[] = []
    for (const row of await youtubeSubscriptions(ctx, serverId)) {
        const source = await youtubeSource(ctx, row.youtubeChannelId), name = source?.title ?? row.youtubeChannelId, hubError = source?.lastError
        const again = `then turn the alerts back on with !youtube add ${row.youtubeChannelId} #channel`
        if (row.problem === "channel") entries.push(work("youtube", `YouTube alerts for ${name} are off: Their channel ${row.channelId} is gone or cannot hold alerts`, `Choose a text, announcement or forum channel, ${again}`, row.updatedAt))
        else if (row.problem === "permission") entries.push(work("youtube", `YouTube alerts for ${name} are off: NeonFlux cannot post in channel ${row.channelId}`,
            `Give NeonFlux View Channel, Send Messages and Embed Links in that channel, ${again}`, row.updatedAt))
        else if (hubError) entries.push(work("youtube", `YouTube alerts for ${name} may miss videos: ${hubError}`, "NeonFlux asks YouTube again on its own, waiting longer after each failure. !youtube status shows the latest attempt"))
    }
    return entries
}

async function readCurrent(ctx: QueryCtx, serverId: string, now: number) {
    // Custom commands and autoresponders start on, so having none yet is not a problem
    const entries: RecoveryEntry[] = (await readSetupSections(ctx, serverId)).filter(section => section.state === "setup" && section.id !== "custom" && section.id !== "auto")
        .map(section => ({ kind: "feature", feature: section.id }))
    const defcon = moderationConfig(await readModeration(ctx, serverId)).defcon
    if (defcon < 3) entries.push(work("defcon", `DEFCON ${defcon} is active, so NeonFlux pauses automatic posts and other automation`, "!defcon status, then !defcon set 3 once the threat has passed"))
    // Metadata logs count their failed and unknown deliveries, security alerts among them, so the inbox reads one row
    const logs = await ctx.db.query("metadataLogSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (logs && logs.failed + logs.uncertain > 0) entries.push(work("logs", `Metadata logs: ${logs.failed} ${logs.failed === 1 ? "delivery" : "deliveries"} failed and ${logs.uncertain} ${logs.uncertain === 1 ? "has" : "have"} an unknown outcome. Security alerts are delivered the same way`,
        "!logs events list, then !logs delivery show <record> or !logs delivery reconcile <record>"))
    const helpDesk = await readHelpDesk(ctx, serverId)
    if (helpDesk?.warnedAt !== undefined && helpDesk.warnedAt > now - RECOVERY_SETTLED_MS) entries.push(work("helpdesk", "The server neared Fluxer's limit of 1,000 active threads",
        "Close or archive old forum posts, or let NeonFlux apply each channel's auto-archive time with !helpdesk archive on", helpDesk.warnedAt))
    const check = await ctx.db.query("dashboardSetupJobs").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (check?.state === "done" && check.checkedAt !== undefined) entries.push(...(check.problems as SetupProblem[]).map(problem => ({ kind: "setup" as const, at: check.checkedAt!, problem })))
    return entries
}

/** Every source's entries, current state first and then newest first */
export async function readRecoveryInbox(ctx: QueryCtx, serverId: string): Promise<RecoveryInbox> {
    const now = Date.now()
    const entries = [...await readCurrent(ctx, serverId, now), ...await readPublishing(ctx, serverId, now), ...await readRoles(ctx, serverId), ...await readTemporaryRoles(ctx, serverId, now),
        ...await readTickets(ctx, serverId), ...await readCleanup(ctx, serverId), ...await readGreetings(ctx, serverId, now), ...await readBlockedDeliveries(ctx, serverId), ...await readYoutube(ctx, serverId)]
    const at = (entry: RecoveryEntry) => entry.kind === "feature" ? Number.MAX_SAFE_INTEGER : entry.at ?? Number.MAX_SAFE_INTEGER
    entries.sort((a, b) => at(b) - at(a))
    return { serverId, entries: entries.slice(0, RECOVERY_LIMIT), truncated: entries.length > RECOVERY_LIMIT }
}

/** What !recovery lists */
export const list = serviceQuery({ args: { request: v.any() }, handler: (ctx, { request }) => readRecoveryInbox(ctx, requireId(object(request).serverId)) })
/** The dashboard's recovery inbox, for server managers */
export const inbox = query({ args: { sessionToken: v.string(), serverId: v.string() }, handler: async (ctx, { sessionToken, serverId }): Promise<RecoveryInbox> => {
    await dashboardSession(ctx, sessionToken, serverId)
    return readRecoveryInbox(ctx, serverId)
} })
