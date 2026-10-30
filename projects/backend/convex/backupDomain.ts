import {
    BackupConfigObject,
    canonicalBackupJson,
    BackupContext,
    BackupStructureObject,
    BackupXpObject,
    type BackupLiveChannel,
    type BackupManifestHeader,
    type BackupMove,
    type BackupNativeProof,
} from "@neonflux/contracts/backup"
import { movedChannels, places } from "@neonflux/contracts/structure"
import { rule } from "./moderationDomain.ts"
import { publishingContent } from "./publishingDomain.ts"
import * as responses from "./responseDomain.ts"
import { levelMappings } from "./levelingDomain.ts"
import { autoroleIds } from "./rolesDomain.ts"
import { greetingTemplate } from "./greetingsDomain.ts"
import { ticketQuestions } from "./ticketDomain.ts"
import { milestoneCivil, validateMilestoneTemplate } from "./milestonesDomain.ts"
import { onboardingSteps } from "./onboardingDomain.ts"
import { civilRestart } from "./civilDomain.ts"
import { validateEventCalendar } from "./eventsDomain.ts"
import { eventsReminderMaxMinutes, eventsReminderProblem } from "@neonflux/contracts/events"
import { validateScheduleCalendar } from "./schedulesDomain.ts"
import { isHelpDeskAnswerName } from "@neonflux/contracts/helpdesk"
import { isVoiceTemplate } from "@neonflux/contracts/voice"
import { decode, fail, text } from "./validation.ts"
import { valueDiff } from "./valueDiff.ts"

export {
    BACKUP_PLAN_MS,
    backupChannelSemantic,
    backupConfigIdentity,
    canonicalBackupJson,
} from "@neonflux/contracts/backup"
export const BACKUP_RETENTION = 604800000,
    BACKUP_DISPATCH_MS = 120000,
    BACKUP_SETTLE_MS = 10000
export async function backupHash(value: unknown) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalBackupJson(value)))
    return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")
}
/** The owner, the actor and the private one-to-one DM, read by the bot within the last minute */
export function backupContext(value: unknown, now = Date.now()): BackupContext {
    const context = decode(BackupContext, value),
        { ownerId, recipientIds } = context
    if (context.observedAt < Math.max(0, now - 60000) || context.observedAt > now + 1000)
        fail(400, "Stale backup evidence")
    if (
        context.actorId !== ownerId ||
        ownerId === context.botId ||
        !context.privateReplyAuthorized ||
        recipientIds.length !== 1 ||
        recipientIds[0] !== ownerId
    )
        fail(403, "Fresh actual Owner and private one-to-one DM required")
    if (
        Date.parse(context.ownerJoinedAt) > context.observedAt + 1000 ||
        [context.ownerTimeoutUntil, context.botTimeoutUntil].some((x) => x !== null && Date.parse(x) > now)
    )
        fail(403, "Backup participant restricted")
    return context
}
/** What a restored setting must also meet of its feature's own rules, beyond its shape */
export function backupConfigRule(item: BackupConfigObject) {
    switch (item.family) {
        case "response":
            if (responses.name(item.value.name) !== item.value.name) fail(400, "Noncanonical response identity")
            responses.reply(item.value.reply)
            break
        case "automod":
            if (canonicalBackupJson(rule(item.value)) !== canonicalBackupJson(item.value))
                fail(400, "Noncanonical automod rule")
            break
        case "draft":
            publishingContent(item.value.content)
            break
        case "roles":
            if (autoroleIds(item.value).length > 1000)
                fail(400, "Autorole configuration supports at most 1000 distinct roles")
            break
        case "greetings":
            for (const route of ["welcome", "dm", "goodbye"] as const) {
                const content = item.value.routes[route].content
                if (content !== undefined) greetingTemplate(content, route)
            }
            break
        case "ticketCategory": {
            if (item.value.description !== "") text(item.value.description, 1000)
            ticketQuestions(item.value.questions)
            for (const reply of item.value.cannedReplies) publishingContent(reply.content)
            break
        }
        case "leveling":
            if (canonicalBackupJson(levelMappings(item.value.mappings)) !== canonicalBackupJson(item.value.mappings))
                fail(400, "Noncanonical leveling mappings")
            break
        case "milestoneRoute": {
            const { zone, time, fold, content, kind } = item.value
            milestoneCivil({ zone, time, fold })
            validateMilestoneTemplate(publishingContent(content), kind)
            break
        }
        case "event":
            if (item.value.template) publishingContent(item.value.template.content)
            break
        case "schedule":
            publishingContent(item.value.content)
            break
        case "voiceGenerator":
            if (!isVoiceTemplate(item.value.template)) fail(400, "Invalid voice room name template")
            break
        case "rolepicker": {
            const roleIds = item.value.menus.flatMap((menu) => menu.roleIds)
            if (new Set(roleIds).size !== roleIds.length) fail(400, "A role can belong to only one menu")
            break
        }
        case "temproles":
            if (
                new Set(item.value.roles.map((role) => role.roleId)).size !== item.value.roles.length ||
                item.value.roles.some(
                    (role) =>
                        role.defaultSeconds !== undefined &&
                        role.maxSeconds !== undefined &&
                        role.defaultSeconds > role.maxSeconds,
                )
            )
                fail(400, "Invalid temporary role defaults")
            break
        case "onboarding":
            onboardingSteps(item.value.steps)
            break
        case "helpdeskAnswer":
            if (!isHelpDeskAnswerName(item.value.name)) fail(400, "Invalid saved answer name")
            break
        // Their shape is all their rules. A new family is listed here or above, so none is restored unchecked by accident
        case "access":
        case "alerts":
        case "analytics":
        case "cleanup":
        case "cleanupPolicy":
        case "events":
        case "general":
        case "helpdesk":
        case "lfg":
        case "metadata":
        case "milestones":
        case "moderation":
        case "panel":
        case "profile":
        case "publishing":
        case "responses":
        case "schedules":
        case "showcase":
        case "sticky":
        case "suggestions":
        case "tickets":
        case "youtube":
            break
    }
}
export function backupConfig(value: unknown): BackupConfigObject {
    const item = decode(BackupConfigObject, value)
    backupConfigRule(item)
    return item
}
/** The differences between two values as leaf rows in path order, with list entries matched by name */
export const backupDiff = (before: unknown, after: unknown) => valueDiff(before, after, ["name"])
/** Whether a path ends in an on/off switch, such as enabled, customEnabled or routes[2].enabled, or names a security alert or its action */
export const backupSwitchPath = (path: string, family?: string) =>
    /(^|\.)([a-z]\w*Enabled|enabled)$/.test(path) ||
    (family === "alerts" &&
        /^(invites|bots|webhooks|privileges|impersonation|kickBots|deleteWebhooks|removePermissions)$/.test(path))
/**
 * A setting with the optional values an archive may leave out filled in with what absent means, so a server that never set them and one that
 * set them to their defaults compare equal. Only identity and the shown changes use it
 */
export function backupNormalized(item: BackupConfigObject): BackupConfigObject {
    switch (item.family) {
        case "roles":
            return {
                ...item,
                value: {
                    ...item.value,
                    advancedVerificationEnabled: item.value.advancedVerificationEnabled ?? false,
                    reservations: item.value.reservations ?? [],
                },
            }
        case "moderation":
            return { ...item, value: { ...item.value, caseRetentionDays: item.value.caseRetentionDays ?? null } }
        case "events":
            return { ...item, value: { ...item.value, threads: item.value.threads ?? false } }
        case "general":
            return { ...item, value: { ...item.value, replyStyle: item.value.replyStyle ?? "embed" } }
        // Expected bots and webhooks are sets, so the same IDs in another order are no change
        case "alerts":
            return {
                ...item,
                value: {
                    ...item.value,
                    expectedBotIds: [...item.value.expectedBotIds].sort(),
                    expectedWebhookIds: [...item.value.expectedWebhookIds].sort(),
                },
            }
        default:
            return item
    }
}
/** Whether every date of a calendar is ahead and within the feature's own horizon, so the feature accepts the calendar now */
const ahead = (check: () => unknown) => {
    try {
        check()
        return true
    } catch {
        return false
    }
}
/** An event with dates that are ahead, its repeat begun again at its next date, or without a calendar once no date is left */
function eventDates(
    item: Extract<BackupConfigObject, { family: "event" }>,
    calendar: NonNullable<Extract<BackupConfigObject, { family: "event" }>["value"]["calendar"]>,
    now: number,
): Extract<BackupConfigObject, { family: "event" }> {
    if (ahead(() => validateEventCalendar(calendar, now))) return item
    const restart = civilRestart(calendar, calendar.dates[0]!.startsAt, now),
        restarted = restart && {
            ...calendar,
            ...restart,
            dates: restart.dates.map((date) => ({
                localMinute: date.localMinute,
                startsAt: date.instantAt,
                endsAt: date.instantAt + calendar.durationMinutes * 60000,
                offsetMinutes: date.offsetMinutes,
            })),
        }
    if (restarted && ahead(() => validateEventCalendar(restarted, now)))
        return { ...item, value: { ...item.value, calendar: restarted } }
    const { calendar: _calendar, ...value } = item.value
    return { ...item, value }
}
/**
 * What restoring a setting leaves on the server. An archive without leveling's levelUp keeps the server's current level-up messages, as
 * the restore does, so the preview's comparison, shown changes and desired hash use the current value in its place. A restore never posts
 * for a date that passed, so an event or a schedule that is on whose first date has started begins its repeat again at its next date, with a
 * count reduced to the dates left. Once no date is left, an event returns without a calendar and a schedule paused. An event keeps only
 * the reminders that come for every date of its calendar, as `!event` and the dashboard require, and leaves out a longer one
 */
export function backupTarget(
    item: BackupConfigObject,
    current: BackupConfigObject | null,
    now = Date.now(),
): BackupConfigObject {
    if (item.family === "event" && item.value.calendar) {
        const dated = eventDates(item, item.value.calendar, now),
            calendar = dated.value.calendar
        if (!calendar || !eventsReminderProblem(calendar, dated.value.reminderOffsets)) return dated
        const max = eventsReminderMaxMinutes(calendar)
        return {
            ...dated,
            value: { ...dated.value, reminderOffsets: dated.value.reminderOffsets.filter((offset) => offset <= max) },
        }
    }
    if (item.family === "schedule" && item.value.enabled) {
        const calendar = item.value.calendar
        if (ahead(() => validateScheduleCalendar(calendar, now))) return item
        const restart = civilRestart(calendar, calendar.dates[0]!.dueAt, now),
            restarted = restart && {
                ...calendar,
                ...restart,
                dates: restart.dates.map((date) => ({
                    localMinute: date.localMinute,
                    dueAt: date.instantAt,
                    offsetMinutes: date.offsetMinutes,
                })),
            }
        return restarted && ahead(() => validateScheduleCalendar(restarted, now))
            ? { ...item, value: { ...item.value, calendar: restarted } }
            : { ...item, value: { ...item.value, enabled: false } }
    }
    return item.family === "leveling" &&
        item.value.levelUp === undefined &&
        current?.family === "leveling" &&
        current.value.levelUp !== undefined
        ? { ...item, value: { ...item.value, levelUp: current.value.levelUp } }
        : item
}
/**
 * The fewest moves that put the server's channels in the archive's order. channels is the server's list in Fluxer's order, and positions
 * gives each archived channel, by the ID it has now, its place in the archive. Each category, and the top level, keeps the places its archived
 * channels hold now, and those places are filled in the archive's order, so a channel the archive does not hold keeps its place. fixed names
 * the channels NeonFlux cannot move, which a move is not put on when another channel explains it as well
 */
export function backupOrderMoves(
    channels: readonly Pick<BackupLiveChannel, "id" | "parentId">[],
    positions: ReadonlyMap<string, number>,
    fixed: (id: string) => boolean = () => false,
): BackupMove[] {
    const base = channels.map(({ id, parentId }) => ({ id, parentId })),
        groups = new Map<string | null, string[]>()
    for (const entry of base)
        if (positions.has(entry.id)) groups.set(entry.parentId, [...(groups.get(entry.parentId) ?? []), entry.id])
    for (const ids of groups.values()) ids.sort((a, b) => positions.get(a)! - positions.get(b)!)
    const taken = new Map<string | null, number>()
    const target = base.map((entry) => {
        if (!positions.has(entry.id)) return entry
        const index = taken.get(entry.parentId) ?? 0
        taken.set(entry.parentId, index + 1)
        return { id: groups.get(entry.parentId)![index]!, parentId: entry.parentId }
    })
    const moved = movedChannels(base, target, fixed),
        at = places(target)
    return target
        .filter((entry) => moved.has(entry.id))
        .map((entry) => ({ id: entry.id, parentId: entry.parentId, precedingSiblingId: at.get(entry.id)!.afterId }))
}
export const backupXp = (value: unknown): BackupXpObject => decode(BackupXpObject, value)
export const backupStructure = (value: unknown): BackupStructureObject => decode(BackupStructureObject, value)
/** A decoded archive header's capture time, which may not lie ahead of the backend's clock */
export function backupHeader(header: BackupManifestHeader, now = Date.now()): BackupManifestHeader {
    if (header.capturedAt > now + 60000) fail(400, "Invalid backup capture time")
    return header
}
/** Fresh native evidence of the request's server, read for the context's owner and bot */
export function backupNativeProof(
    proof: BackupNativeProof,
    serverId: string,
    context: BackupContext,
): BackupNativeProof {
    const now = Date.now(),
        fresh = (at: number) => {
            if (at < Math.max(0, now - 60000) || at > now + 1000) fail(400, "Stale native evidence")
        }
    fresh(proof.observedAt)
    if (proof.serverId !== serverId || proof.ownerId !== context.ownerId || proof.botId !== context.botId)
        fail(403, "Native evidence identity mismatch")
    for (const reference of proof.references) {
        if (reference.serverId !== serverId) fail(400, "Invalid native reference")
        fresh(reference.observedAt)
    }
    for (const observation of proof.observations) fresh(observation.observedAt)
    // Plan items hash an observation without the server it was read from
    return {
        ...proof,
        observations: proof.observations.map(({ originServerId: _origin, ...observation }) => observation),
    }
}
