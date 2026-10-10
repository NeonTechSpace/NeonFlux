import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc, TableNames } from "./_generated/dataModel.js"
import type { MemberDataCursor, MemberDataDeletePage, MemberDataExportPage, MemberDataList, MemberDataServerCursor, MemberDataServerPage } from "../contracts.js"
import { recordAudit } from "./auditLog.ts"
import { eventCount, wakePromotion } from "./eventsStore.ts"
import { levelingCount, rankProfile } from "./levelingStore.ts"
import { removeMilestoneEnrollment } from "./milestonesStore.ts"
import { forgetSuggestion } from "./suggestionsCleanup.ts"
import { terminalSuggestion } from "./suggestionsDomain.ts"
import { dirtySuggestion, suggestionCount } from "./suggestionsStore.ts"
import { fail, integer, isId } from "./validation.ts"

// Member data rights. Every table that stores data about a member under their user ID is listed here with an index
// that starts with that ID, so a member can view, export and delete it across servers in bounded reads. A table either
// names the rule that keeps it or deletes a row, and a deletion may keep a row that is still in use and say why.
// docs/BACKEND.md lists the decision for each table

type Row = { _id: string, _creationTime: number, serverId: string } & Record<string, unknown>
// A deletion returns how many rows it removed, or why the row stays
type Removal = (ctx: MutationCtx, row: Row) => Promise<number | string>
type Entry = { table: TableNames, field: string, feature: string, view: (row: Row) => Record<string, unknown>, keep?: string, remove?: Removal }
function entry<T extends TableNames>(table: T, field: string, feature: string, view: (row: Doc<T>) => Record<string, unknown>, rule: { keep: string } | { remove: (ctx: MutationCtx, row: Doc<T>) => Promise<number | string> }): Entry {
    return { table, field, feature, view: view as unknown as Entry["view"], ..."keep" in rule ? { keep: rule.keep } : { remove: rule.remove as unknown as Removal } }
}
const deleteRow = { remove: async (ctx: MutationCtx, row: { _id: string }) => { await ctx.db.delete(row._id as never); return 1 } }

const CASES = "Moderation cases protect the server. They are kept for 180 days, and the server owner can erase a case's text"
const IN_PROGRESS = "Still being sent. Delete again once it finishes"
export const MEMBER_DATA: readonly Entry[] = [
    entry("afkStatuses", "userId", "AFK status", row => ({ reason: row.reason, since: row.since }), deleteRow),
    entry("responseCooldowns", "userId", "Custom command cooldowns", row => ({ nextEligibleAt: row.nextEligibleAt }), deleteRow),
    entry("levelingProfiles", "userId", "Leveling XP", row => ({ xp: row.xp, scoreEpoch: row.scoreEpoch, joinedAt: row.joinedAt, lastAwardAt: row.lastAwardAt, correctedAt: row.correctedAt, resetAt: row.resetAt }), { remove: async (ctx, row) => {
        // The profile leaves its level's rank count and the server's profile and reward counts
        await rankProfile(ctx, row, 0, row.scoreEpoch)
        await levelingCount(ctx, row.serverId, "profiles", -1)
        if (row.rewardDueAt !== undefined) await levelingCount(ctx, row.serverId, "dirty", -1)
        await ctx.db.delete(row._id)
        return 1
    } }),
    entry("levelingAwardReceipts", "userId", "Leveling message receipts", row => ({ messageId: row.messageId, createdAt: row.createdAt }), deleteRow),
    entry("levelingAudits", "userId", "Leveling corrections", row => ({ auditNo: row.auditNo, type: row.type, beforeXp: row.beforeXp, afterXp: row.afterXp, reason: row.reason, createdAt: row.createdAt }), deleteRow),
    entry("greetingMembers", "userId", "Greeting membership record", row => ({ userName: row.userName, joinedAt: row.joinedAt, present: row.present, observedAt: row.observedAt }), deleteRow),
    entry("greetingDeliveries", "userId", "Greetings", row => ({ deliveryNo: row.deliveryNo, route: row.route, state: row.state, createdAt: row.createdAt, finishedAt: row.finishedAt }),
        { remove: async (ctx, row) => row.active ? IN_PROGRESS : deleteRow.remove(ctx, row) }),
    entry("roleAcknowledgments", "userId", "Rules acknowledgment", row => ({ panelName: row.panelName, rulesRevision: row.rulesRevision, acknowledgedAt: row.acknowledgedAt, advancedVerified: row.advancedVerified }), deleteRow),
    entry("rolePickerSnapshots", "userId", "Role picker role check", row => ({ roleIds: row.roleIds, observedAt: row.observedAt }), deleteRow),
    entry("milestoneEnrollments", "userId", "Birthday and anniversary enrollment", row => ({ kind: row.kind, monthDay: row.monthDay, joinedAt: row.joinedAt, channelId: row.channelId, consentedAt: row.consentedAt }),
        { remove: async (ctx, row) => { await removeMilestoneEnrollment(ctx, row); return 1 } }),
    entry("milestoneMembers", "userId", "Birthday and anniversary command order", row => ({ acceptedCreatedAt: row.acceptedCreatedAt }), deleteRow),
    entry("milestoneDeliveries", "userId", "Birthday and anniversary posts", row => ({ kind: row.kind, state: row.state, dueAt: row.dueAt, celebrationYear: row.celebrationYear, completedYears: row.completedYears }),
        { keep: "Each post is tied to a message NeonFlux sent in the server. Its record is removed 30 days after posting" }),
    entry("milestoneConsumed", "userId", "Celebrated years", row => ({ kind: row.kind, year: row.year, createdAt: row.createdAt }),
        { keep: "Prevents a second celebration in the same year. Kept for 400 days" }),
    entry("ticketIntakes", "requesterId", "Ticket drafts", row => ({ intakeNo: row.intakeNo, state: row.state, category: row.category.name, answers: row.answers, createdAt: row.createdAt }), deleteRow),
    entry("tickets", "requesterId", "Tickets", row => ({ ticketNo: row.ticketNo, state: row.state, category: row.category.name, answers: row.erased ? [] : row.answers, createdAt: row.createdAt, closedAt: row.closedAt }),
        { keep: "A ticket is a support record shared with staff. Private content of a closed ticket expires after the server's ticket retention, 30 days by default, and staff can erase it sooner" }),
    entry("eventRsvps", "userId", "Event RSVPs", row => ({ eventNo: row.eventNo, occurrenceNo: row.occurrenceNo, choice: row.choice, allocation: row.allocation, createdAt: row.createdAt }), { remove: async (ctx, row) => {
        // A seat or waitlist place is released like a departed member's, so the next member on the waitlist can move up
        const occurrence = await ctx.db.query("eventOccurrences").withIndex("by_number", q => q.eq("serverId", row.serverId).eq("eventNo", row.eventNo).eq("occurrenceNo", row.occurrenceNo)).unique()
        if (occurrence) {
            if (row.allocation !== "none") await wakePromotion(ctx, occurrence, { going: occurrence.going - (row.allocation === "seat" ? 1 : 0), waitlisted: occurrence.waitlisted - (row.allocation === "waitlist" ? 1 : 0) })
            await ctx.db.patch(occurrence._id, { rsvps: Math.max(0, occurrence.rsvps - 1) })
        }
        await ctx.db.delete(row._id)
        await eventCount(ctx, row.serverId, "rsvps", -1)
        return 1
    } }),
    entry("suggestionVotes", "userId", "Suggestion votes", row => ({ suggestionNo: row.suggestionNo, choice: row.choice, acceptedCreatedAt: row.acceptedCreatedAt }), { remove: async (ctx, row) => {
        const suggestion = await ctx.db.query("suggestions").withIndex("by_number", q => q.eq("serverId", row.serverId).eq("suggestionNo", row.suggestionNo)).unique()
        if (suggestion && !suggestion.forgetting) {
            await ctx.db.patch(suggestion._id, { up: suggestion.up - (row.choice === "up" ? 1 : 0), down: suggestion.down - (row.choice === "down" ? 1 : 0), voters: suggestion.voters - 1 })
            await dirtySuggestion(ctx, suggestion)
        }
        await ctx.db.delete(row._id)
        await suggestionCount(ctx, row.serverId, "voters", -1)
        return 1
    } }),
    entry("suggestions", "authorId", "Suggestions", row => ({ suggestionNo: row.suggestionNo, state: row.state, text: row.text, createdAt: row.createdAt }), { remove: async (ctx, row) => {
        // A suggestion already being forgotten is on its way out
        if (row.forgetting) return 0
        if (!terminalSuggestion(row.state)) return "Open suggestions stay while staff review them. Withdraw one with !suggest withdraw, then delete again"
        if (await ctx.db.query("publishingAttempts").withIndex("by_suggestion_unresolved", q => q.eq("serverId", row.serverId).eq("consumer.suggestionNo", row.suggestionNo).eq("unresolved", true)).first()) return IN_PROGRESS
        // Forgetting hides the suggestion at once. Retention finishes what one batch leaves, such as many votes
        await ctx.db.patch(row._id, { cleanupAt: Date.now() })
        return Math.max(1, (await forgetSuggestion(ctx, row)).removed)
    } }),
    entry("moderationCases", "targetId", "Moderation cases", row => ({ caseNo: row.caseNo, action: row.action, reason: row.erased ? undefined : row.reason, createdAt: row.createdAt }), { keep: CASES }),
    entry("moderationAppeals", "userId", "Appeals", row => ({ appealNo: row.appealNo, caseNo: row.caseNo, status: row.status, text: row.erased ? undefined : row.text, createdAt: row.createdAt, decidedAt: row.decidedAt }), { keep: CASES }),
    entry("voiceRooms", "ownerId", "Temporary voice room", row => ({ channelId: row.channelId, createdAt: row.createdAt }), { keep: "Kept while your room exists, and removed when its channel is deleted" }),
    entry("lfgGroups", "hostId", "Groups you host", row => ({ groupNo: row.groupNo, activity: row.activity, size: row.size, note: row.note, startsAt: row.startsAt, expiresAt: row.expiresAt, createdAt: row.createdAt }),
        { keep: "Kept while the group is open and deleted when it starts, is cancelled or expires. Cancel it with !lfg cancel" }),
    // Leaving needs no other change. The group's card shows the new member list at its next update
    entry("lfgMembers", "userId", "Groups you joined", row => ({ groupNo: row.groupNo, joinedAt: row.joinedAt }), deleteRow),
    entry("roleOwnership", "userId", "Roles NeonFlux gave you", row => ({ roleId: row.roleId, status: row.status, owned: row.owned, updatedAt: row.updatedAt }),
        { keep: "NeonFlux removes only roles it can prove it gave, so this stays while you may hold them. Settled history expires after 180 days" }),
    entry("onboardingCompletions", "userId", "Newcomer checklist completion", row => ({ joinedAt: row.joinedAt, completedAt: row.completedAt }), deleteRow),
    entry("temporaryRoleGrants", "userId", "Temporary roles", row => ({ roleId: row.roleId, endsAt: row.endsAt, createdAt: row.createdAt }),
        { keep: "Kept until the role's time ends, so NeonFlux can remove the role, then deleted" }),
]

// Tables with a member's ID that member data rights leave out, and why. A test fails for a table with a top-level userId,
// ownerId, authorId, requesterId or targetId that is in neither list
const SECURITY = "A security record. It keeps its own expiry, and showing it could defeat its purpose"
const ROLE_LEDGER = "Part of the role ledger kept with Roles NeonFlux gave you"
const STAFF = "Names the staff member who runs a server task, not data about them as a member"
export const MEMBER_DATA_EXEMPT: Partial<Record<TableNames, string>> = {
    automodWindows: SECURITY, securityWatchlist: SECURITY, securityRecoveries: SECURITY, verificationLinks: SECURITY,
    roleAttempts: ROLE_LEDGER, roleReferences: ROLE_LEDGER, ticketEntries: "Part of a ticket, kept with it",
    dashboardSessions: "A website sign-in, not server data. It ends at sign-out and after at most eight hours",
    dashboardPrivateAccessJobs: "A website check of the member's own access to private cases. It is deleted within three minutes",
    backupPlans: STAFF, cleanupPolicies: STAFF, cleanupSweeps: STAFF, cleanupTargets: STAFF,
    // Its invite list names each invite's creator as Fluxer shows it to staff, and the next refresh replaces it
    alertSettings: "Server security settings and the invite list staff last read from Fluxer",
}

type Range = { eq(field: string, value: unknown): Range, gt(field: string, value: unknown): Range }
const memberRows = (ctx: QueryCtx | MutationCtx, item: Entry, range: (q: Range) => Range) =>
    (ctx.db.query(item.table) as unknown as { withIndex(index: "by_member_data", range: (q: Range) => Range): { take(count: number): Promise<Row[]> } }).withIndex("by_member_data", range)
const serverRows = (ctx: QueryCtx | MutationCtx, item: Entry, userId: string, serverId: string, after: number, count: number) =>
    memberRows(ctx, item, q => q.eq(item.field, userId).eq("serverId", serverId).gt("_creationTime", after)).take(count)

export function memberDataUser(value: unknown) { if (!isId(value)) fail(400, "Invalid member ID"); return value }
export function memberDataCursor(value: unknown): MemberDataCursor | null {
    if (value === null || value === undefined) return null
    const cursor = value as Partial<MemberDataCursor>
    // after is a creation time, which has fractions of a millisecond
    if (typeof cursor.after !== "number" || !Number.isFinite(cursor.after) || cursor.after < 0) fail(400, "Invalid member data cursor")
    return { table: integer(cursor.table, 0, MEMBER_DATA.length - 1), after: cursor.after }
}

const LIST_LIMIT = 50
/** What is stored about a member, per server and feature. Each table reads at most 51 rows */
export async function memberDataList(ctx: QueryCtx, userId: string): Promise<MemberDataList> {
    const servers = new Map<string, MemberDataList["servers"][number]["features"]>()
    let complete = true
    for (const item of MEMBER_DATA) {
        const found = await memberRows(ctx, item, q => q.eq(item.field, userId)).take(LIST_LIMIT + 1)
        if (found.length > LIST_LIMIT) complete = false
        const counts = new Map<string, number>()
        for (const row of found.slice(0, LIST_LIMIT)) counts.set(row.serverId, (counts.get(row.serverId) ?? 0) + 1)
        for (const [serverId, count] of counts) servers.set(serverId, [...servers.get(serverId) ?? [], { feature: item.feature, count, kept: item.keep ?? null }])
    }
    return { servers: [...servers].sort(([a], [b]) => a.localeCompare(b)).map(([serverId, features]) => ({ serverId, features })), complete }
}

export function memberDataServerCursor(value: unknown): MemberDataServerCursor | null {
    if (value === null || value === undefined) return null
    const cursor = value as Partial<MemberDataServerCursor>
    const after = cursor.after === null ? null : isId(cursor.after) ? cursor.after : fail(400, "Invalid member data cursor")
    return { table: integer(cursor.table, 0, MEMBER_DATA.length - 1), after }
}
const SERVER_READS = 200
/** The servers that hold a member's data. Each read finds the next server of one table, and a call makes at most 200 reads. cursor continues */
export async function memberDataServers(ctx: QueryCtx, userId: string, cursor: MemberDataServerCursor | null): Promise<MemberDataServerPage> {
    const serverIds = new Set<string>()
    let reads = 0
    const page = (next: MemberDataServerCursor | null) => ({ serverIds: [...serverIds].sort((a, b) => a.localeCompare(b)), cursor: next })
    for (let table = cursor?.table ?? 0, after = cursor?.after ?? null; table < MEMBER_DATA.length; table++, after = null) {
        const item = MEMBER_DATA[table]!
        for (;;) {
            if (reads >= SERVER_READS) return page({ table, after })
            reads++
            const from = after
            const [row] = await memberRows(ctx, item, q => from === null ? q.eq(item.field, userId) : q.eq(item.field, userId).gt("serverId", from)).take(1)
            if (!row) break
            serverIds.add(row.serverId)
            after = row.serverId
        }
    }
    return page(null)
}

const EXPORT_RECORDS = 100
/** One page of a member's stored data in one server, in table order. cursor continues the next page */
export async function memberDataExport(ctx: QueryCtx, userId: string, serverId: string, cursor: MemberDataCursor | null): Promise<MemberDataExportPage> {
    const records: MemberDataExportPage["records"] = []
    for (let table = cursor?.table ?? 0, after = cursor?.after ?? 0; table < MEMBER_DATA.length; table++, after = 0) {
        const item = MEMBER_DATA[table]!, room = EXPORT_RECORDS - records.length
        if (!room) return { records, cursor: { table, after } }
        const found = await serverRows(ctx, item, userId, serverId, after, room + 1), page = found.slice(0, room)
        for (const row of page) records.push({ feature: item.feature, data: item.view(row) })
        if (found.length > room) return { records, cursor: { table, after: page.at(-1)!._creationTime } }
    }
    return { records, cursor: null }
}

const DELETE_ROWS = 100, DELETE_READS = 200
/** Deletes up to 100 rows of a member's data in one server and records the deletion in that server's audit log. cursor continues */
export async function memberDataDelete(ctx: MutationCtx, member: { userId: string, name?: string | undefined }, serverId: string, cursor: MemberDataCursor | null): Promise<MemberDataDeletePage> {
    const deleted = new Map<string, number>(), kept = new Map<string, { count: number, reason: string }>()
    let removed = 0, reads = 0, next: MemberDataCursor | null = null
    scan: for (let table = cursor?.table ?? 0, after = cursor?.after ?? 0; table < MEMBER_DATA.length; table++, after = 0) {
        const item = MEMBER_DATA[table]!
        for (;;) {
            if (removed >= DELETE_ROWS || reads >= DELETE_READS) { next = { table, after }; break scan }
            const want = Math.min(50, DELETE_READS - reads), found = await serverRows(ctx, item, member.userId, serverId, after, want)
            reads += found.length
            for (const row of found) {
                after = row._creationTime
                const result = item.keep ?? await item.remove!(ctx, row)
                if (typeof result === "string") kept.set(item.feature, { count: (kept.get(item.feature)?.count ?? 0) + 1, reason: result })
                else if (result > 0) { removed += result; deleted.set(item.feature, (deleted.get(item.feature) ?? 0) + 1) }
                if (removed >= DELETE_ROWS) { next = { table, after }; break scan }
            }
            if (found.length < want) break
        }
    }
    const total = [...deleted.values()].reduce((sum, count) => sum + count, 0)
    if (total) await recordAudit(ctx, serverId, { userId: member.userId, name: member.name, source: "command" }, { kind: "member-data-deleted", feature: "member-data", setting: "delete own data",
        summary: `Deleted ${total} ${total === 1 ? "record" : "records"}: ${[...deleted].map(([feature, count]) => `${feature} ${count}`).join(", ")}` })
    return { deleted: [...deleted].map(([feature, count]) => ({ feature, count })), kept: [...kept].map(([feature, value]) => ({ feature, ...value })), cursor: next }
}
