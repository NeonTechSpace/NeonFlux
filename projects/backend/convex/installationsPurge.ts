import { v } from "convex/values"
import { internalMutation, type MutationCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import type { DataModel, Doc, TableNames } from "./_generated/dataModel.js"
import { parseServerScope } from "./serverScope.ts"

export const PURGE_AFTER_MS = 30 * 86400000
export const PURGE_ROWS_PER_TABLE = 256
const PURGE_ROWS_PER_RUN = 2048, PURGE_BYTES_PER_RUN = 4 * 1024 * 1024, PURGE_LEASE_MS = 10 * 60000

type ServerTable = Exclude<{ [T in TableNames]: Doc<T> extends { serverId: string } ? T : never }[TableNames], "serverInstallations">
type ServerIndex<T extends TableNames> = { [I in keyof DataModel[T]["indexes"]]: DataModel[T]["indexes"][I] extends readonly ["serverId", ...unknown[]] ? I : never }[keyof DataModel[T]["indexes"]]
// An index starting with serverId for every table that holds one server's rows. Typechecking fails until a new such table is listed
export const PURGE_INDEXES = {
    serverConfigurationRevisions: "by_family", dashboardConfigurationJobs: "by_work", verificationLinks: "by_member", dashboardMessageJobs: "by_work",
    dashboardRoleJobs: "by_work", dashboardSetupJobs: "by_server", dashboardPrivateAccessJobs: "by_member", dashboardBackupPreviewJobs: "by_server", dashboardStructureJobs: "by_member", generalSettings: "by_server", analyticsSettings: "by_server", analyticsChannelDays: "by_channel",
    analyticsMessageDays: "by_server", analyticsDays: "by_bucket", analyticsFlushes: "by_session", memberAccessLists: "by_feature", rolePickerSettings: "by_server", rolePickerSnapshots: "by_member",
    voiceGenerators: "by_channel", voiceRooms: "by_channel", lfgSettings: "by_server", lfgGroups: "by_number", lfgMembers: "by_group", stickyMessages: "by_channel", sidebarLinks: "by_server", alertSettings: "by_server", helpDeskSettings: "by_server", helpDeskAnswers: "by_name", helpDeskPosts: "by_thread", onboardingSettings: "by_server", onboardingCompletions: "by_member", showcaseSettings: "by_server", showcases: "by_number", profileSettings: "by_server", profiles: "by_member", dashboardMetadataJobs: "by_work", backupPlans: "by_server", backupItems: "by_number", backupOrigins: "by_origin",
    metadataLogSettings: "by_server", metadataLogRecords: "by_number", metadataLogAdmissions: "by_server", metadataLogAttempts: "by_binding",
    metadataLogReceipts: "by_source", metadataLogCoreFences: "by_scope", cleanupSettings: "by_server", cleanupPolicies: "by_channel", cleanupSweeps: "by_number",
    cleanupPages: "by_sweep", cleanupTargets: "by_number", cleanupReceipts: "by_source", suggestionSettings: "by_server", suggestions: "by_number",
    suggestionVotes: "by_suggestion_user", suggestionReceipts: "by_source", milestoneSettings: "by_server", milestoneRoutes: "by_kind", milestoneMembers: "by_user",
    milestoneEnrollments: "by_user_kind", milestoneDeliveries: "by_member_active", milestoneReceipts: "by_source", milestoneConsumed: "by_binding",
    scheduleSettings: "by_server", schedules: "by_number", scheduleDeliveries: "by_schedule_occurrence", scheduleReceipts: "by_source", eventSettings: "by_server",
    events: "by_number", eventOccurrences: "by_number", eventRsvps: "by_member", eventReceipts: "by_source", eventDeliveries: "by_event", levelingSettings: "by_server",
    levelingProfiles: "by_user", levelingAwardReceipts: "by_source", levelingManagementReceipts: "by_source", levelingAudits: "by_number", ticketSettings: "by_server",
    ticketCategories: "by_name", ticketIntakes: "by_number", tickets: "by_number", ticketEntries: "by_ticket", ticketAttempts: "by_number", ticketTranscripts: "by_number",
    ticketReceipts: "by_source", ticketRoleProtections: "by_role", greetingSettings: "by_server", greetingMembers: "by_server_user", greetingReceipts: "by_source",
    greetingDeliveries: "by_number", roleSettings: "by_server", rolePanels: "by_server_name", roleAcknowledgments: "by_server_member",
    roleOwnership: "by_server_member_role", roleReferences: "by_configuration_key", roleAttempts: "by_source", roleReceipts: "by_server_message",
    roleParticipationReceipts: "by_source", roleWithdrawals: "by_consumer", roleReactionJobs: "by_server_name", temporaryRoleGrants: "by_member_role", temporaryRoleSettings: "by_server", publishingSettings: "by_server",
    publishingDrafts: "by_server_kind_name", publishingPosts: "by_server_post", publishingAttempts: "by_server_post", publishingReceipts: "by_server_source",
    moderationSettings: "by_server", moderationCases: "by_server_case", moderationReceipts: "by_server_key", automodWindows: "by_server_user_kind_time",
    automodRules: "by_server_name", securityRecoveries: "by_server", securityWatchlist: "by_server_user", moderationAppeals: "by_server_appeal",
    afkStatuses: "by_server_user", responseSettings: "by_server", responseDefinitions: "by_server", responseReceipts: "by_server_message", responseCooldowns: "by_server",
    backupOriginCounts: "by_provider", ticketTranscriptPages: "by_page", levelingLevels: "by_level", auditLogEntries: "by_server",
} as const satisfies { [T in ServerTable]: ServerIndex<T> }
// Tables without serverId. A child belongs to a server through its parent and is deleted before the parent that finds it.
// Dashboard sessions are shared by every server and expire on their own, and the work signal, the retention chain row and monthly usage serve the whole bot
export const PURGE_CHILDREN = { moderationCorrections: { parent: "moderationCases", index: "by_case", field: "caseId" } } as const satisfies
    Partial<Record<TableNames, { parent: ServerTable, index: string, field: string }>>
export const PURGE_SHARED: readonly TableNames[] = ["dashboardSessions", "workSignal", "retentionState", "usageMonths"]

type Row = { _id: string } & Record<string, unknown>
type Rows = { withIndex(index: string, range: (q: { eq(field: string, value: unknown): unknown }) => unknown): AsyncIterable<Row> }
const rows = (ctx: MutationCtx, table: TableNames, index: string, field: string, value: unknown) =>
    (ctx.db.query(table) as unknown as Rows).withIndex(index, q => q.eq(field, value))

// Deletes one bounded batch of a removed server's rows and returns true once none is left. Every run deletes at least one row
async function purgeBatch(ctx: MutationCtx, serverId: string) {
    let deleted = 0, bytes = 0
    const spent = () => deleted >= PURGE_ROWS_PER_RUN || bytes >= PURGE_BYTES_PER_RUN
    // Reads at most limit rows. Each read counts before its row is deleted, so large documents end the run early.
    // more reports a read that stopped at a limit, which may leave rows for the next run
    const take = async (source: AsyncIterable<Row>, limit: number) => {
        const page: Row[] = []
        for await (const row of source) {
            page.push(row)
            bytes += JSON.stringify(row).length
            if (page.length >= limit || deleted + page.length >= PURGE_ROWS_PER_RUN || bytes >= PURGE_BYTES_PER_RUN) return { page, more: true }
        }
        return { page, more: false }
    }
    const remove = async (row: Row) => { await ctx.db.delete(row._id as never); deleted++ }
    const children = Object.entries(PURGE_CHILDREN) as [TableNames, { parent: ServerTable, index: string, field: string }][]
    for (const [table, index] of Object.entries(PURGE_INDEXES) as [ServerTable, string][]) {
        if (spent()) return false
        const parents = await take(rows(ctx, table, index, "serverId", serverId), PURGE_ROWS_PER_TABLE)
        for (const row of parents.page) {
            // Children are found only through their parent, so the parent stays until they are gone
            for (const [child, link] of children) if (link.parent === table) {
                const found = await take(rows(ctx, child, link.index, link.field, row._id), Math.max(1, PURGE_ROWS_PER_RUN - deleted))
                for (const item of found.page) await remove(item)
                if (found.more) return false
            }
            await remove(row)
        }
        if (parents.more) return false
    }
    return true
}

function multiMode() {
    try { return parseServerScope(process.env).mode === "multi" } catch { return false }
}

// Deletes the data of servers removed more than 30 days ago, oldest removal first. The cron starts it, each run deletes one
// bounded batch and schedules the next, and the installation row goes last. A server that joins again stops its purge and
// keeps the rows not yet deleted. Single mode never purges
export const purge = internalMutation({ args: { serverId: v.optional(v.string()) }, handler: async (ctx, { serverId }) => {
    if (!multiMode()) return
    const now = Date.now(), cutoff = now - PURGE_AFTER_MS
    const row = serverId === undefined
        ? await ctx.db.query("serverInstallations").withIndex("by_status_removed", q => q.eq("status", "removed").gte("removedAt", 0).lte("removedAt", cutoff)).first()
        : await ctx.db.query("serverInstallations").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
    if (!row || row.status !== "removed" || row.removedAt === undefined || row.removedAt > cutoff) return
    // Only one purge runs at a time. Its continuations hold the lease, and a stopped purge is resumed once the lease ends
    if (serverId === undefined && (row.purgeLeaseUntil ?? 0) > now) return
    if (await purgeBatch(ctx, row.serverId)) {
        await ctx.db.delete(row._id)
        await ctx.scheduler.runAfter(0, internal.installationsPurge.purge, {})
    } else {
        await ctx.db.patch(row._id, { purgeLeaseUntil: now + PURGE_LEASE_MS })
        await ctx.scheduler.runAfter(0, internal.installationsPurge.purge, { serverId: row.serverId })
    }
} })
