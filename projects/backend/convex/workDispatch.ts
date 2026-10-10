import type { QueryCtx } from "./_generated/server.js"
import type { Doc, TableNames } from "./_generated/dataModel.js"
import type { ServiceWork, ServiceWorkKind } from "../contracts.js"
import { configuredServerScope } from "./serverScope.ts"
import { isInstalled } from "./installations.ts"
import { cleanupSettings } from "./cleanupStore.ts"
import { eventSettings, lifecycle } from "./eventsStore.ts"
import { suggestionSettings } from "./suggestionsStore.ts"
import { publisherSettings } from "./schedulesStore.ts"
import { readRolesSettings } from "./rolesStore.ts"
import { fail } from "./validation.ts"

export const WORK_KINDS = ["dashboard", "verification", "events", "schedules", "milestones", "suggestions", "cleanup", "metadata", "temproles", "helpdesk", "lfg", "youtube", "levels"] as const satisfies readonly ServiceWorkKind[]
export const WORK_SERVERS_PER_KIND = 100
export const WORK_ROWS_PER_SOURCE = 100

// The states in which the bot still has to act on a dashboard job. Every dashboard job table must be listed, and every
// job family stored in a listed table is covered through its state
type DashboardJobTable = Extract<TableNames, `dashboard${string}Jobs`>
export const DASHBOARD_JOB_STATES = {
    dashboardConfigurationJobs: ["queued"],
    dashboardMessageJobs: ["queued", "reserved"],
    dashboardMetadataJobs: ["queued"],
    dashboardRoleJobs: ["queued", "configured"],
    dashboardSetupJobs: ["queued"],
    dashboardPrivateAccessJobs: ["queued"],
    dashboardBackupPreviewJobs: ["queued"],
    dashboardStructureJobs: ["queued"],
} as const satisfies { [T in DashboardJobTable]: readonly Doc<T>["state"][] }

type Row = { _creationTime: number, serverId: string } & Record<string, unknown>
type Position = [value: number, creationTime: number]
type Settings = ReturnType<typeof serverSettings>
interface Source {
    readonly kind: ServiceWorkKind
    readonly key: string
    readonly table: TableNames
    readonly index: string
    /** Equality values for the leading index fields */
    readonly prefix: readonly (readonly [string, unknown])[]
    /** The index field after the prefix that orders rows by due time. Without it rows follow creation order */
    readonly order?: string
    readonly min?: number
    /** Only rows whose order value has passed are due */
    readonly due?: boolean
    /** Whether the server's settings let its worker act */
    readonly gate?: (settings: Settings, serverId: string) => Promise<boolean>
    /** Whether the worker's endpoint would act on this row. Each check mirrors that endpoint's selection */
    readonly work?: (ctx: QueryCtx, row: never, now: number) => boolean | Promise<boolean>
}
function source<T extends TableNames>(spec: Omit<Source, "table" | "work"> & { table: T, work?: (ctx: QueryCtx, row: Doc<T>, now: number) => boolean | Promise<boolean> }): Source {
    return spec as Source
}

// Settings reads shared by every gate in one dispatch
function serverSettings(ctx: QueryCtx) {
    const cache = new Map<string, Promise<unknown>>()
    const once = <A>(key: string, read: () => Promise<A>) => {
        if (!cache.has(key)) cache.set(key, read())
        return cache.get(key) as Promise<A>
    }
    return {
        defcon: (serverId: string) => once(`moderation:${serverId}`, async () => (await ctx.db.query("moderationSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique())?.config.defcon ?? 3),
        cleanup: (serverId: string) => once(`cleanup:${serverId}`, () => cleanupSettings(ctx, serverId)),
        events: (serverId: string) => once(`events:${serverId}`, () => eventSettings(ctx, serverId)),
        suggestions: (serverId: string) => once(`suggestions:${serverId}`, () => suggestionSettings(ctx, serverId)),
        publishing: (serverId: string) => once(`publishing:${serverId}`, () => publisherSettings(ctx, serverId)),
        roles: (serverId: string) => once(`roles:${serverId}`, () => readRolesSettings(ctx, serverId)),
        once,
    }
}

// Mirrors eventsDelivery list: claimed or dispatched attempts wait, expired attempts age and late reminders close
async function eventDeliveryWork(ctx: QueryCtx, row: Doc<"eventDeliveries">, now: number) {
    const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
    if (attempt && (attempt.outcome !== "pending" || attempt.dispatchedAt !== undefined)) return false
    if (attempt && now >= attempt.dispatchExpiresAt) return true
    return now >= Math.min(row.dueAt + 300000, row.startsAt) || row.dueAt <= now
}
// Mirrors eventsWork list: closed occurrences end their work, and open ones wait for their lease and a live event
async function eventPromotionWork(ctx: QueryCtx, row: Doc<"eventOccurrences">, now: number) {
    if (lifecycle({ ...row.date, state: row.state }, now) !== "open") return true
    if ((row.leaseExpiresAt ?? 0) > now) return false
    const event = await ctx.db.query("events").withIndex("by_number", q => q.eq("serverId", row.serverId).eq("eventNo", row.eventNo)).unique()
    return event?.revision === row.revision && !event.forgetting && event.state !== "cancelled"
}
// Mirrors schedulesDelivery list for due deliveries. Deliveries due later need no visit before their time
async function scheduleWork(ctx: QueryCtx, row: Doc<"scheduleDeliveries">, now: number) {
    if (row.nextCheckAt > now || row.claimedAt !== undefined) return false
    const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
    return !attempt || attempt.outcome === "pending" && attempt.dispatchedAt === undefined
}
const eventsEnabled = async (settings: Settings, serverId: string) => (await settings.events(serverId))?.enabled === true && await settings.defcon(serverId) === 3

const dashboardSources = (Object.entries(DASHBOARD_JOB_STATES) as [DashboardJobTable, readonly string[]][]).flatMap(([table, states]) => states.map(state => source({
    kind: "dashboard", key: `${table}.${state}`, table, index: "by_state", prefix: [["state", state]], order: "createdAt",
    // Expired jobs are failed or completed by their scheduled expiry
    work: (_ctx, row, now) => row.expiresAt > now,
})))
export const WORK_SOURCES: readonly Source[] = [
    ...dashboardSources,
    ...(["solved", "redeemed"] as const).map(status => source({ kind: "verification", key: `verificationLinks.${status}`, table: "verificationLinks", index: "by_global_ready",
        prefix: [["status", status], ["deliveryOutcome", undefined]], order: "createdAt",
        gate: async (settings, serverId) => {
            const config = (await settings.roles(serverId))?.config
            return !!config?.verificationEnabled && !!config.advancedVerificationEnabled && await settings.defcon(serverId) === 3
        } })),
    ...(["queued", "blocked", "reserved"] as const).map(state => source({ kind: "events", key: `eventDeliveries.${state}`, table: "eventDeliveries", index: "by_global_due",
        prefix: [["state", state], ["claimedAt", undefined]], order: "nextCheckAt", due: true, work: eventDeliveryWork })),
    source({ kind: "events", key: "eventOccurrences", table: "eventOccurrences", index: "by_global_work", prefix: [["workActive", true]], order: "nextCheckAt", due: true,
        gate: eventsEnabled, work: eventPromotionWork }),
    // Discussion threads to start on a sent card or to close after the event, as eventsDelivery's threads list selects them
    source({ kind: "events", key: "events.threads", table: "events", index: "by_global_thread_due", prefix: [], order: "threadDueAt", min: 0, due: true, gate: eventsEnabled }),
    source({ kind: "schedules", key: "scheduleDeliveries", table: "scheduleDeliveries", index: "by_global_due", prefix: [["active", true]], order: "dueAt", due: true, work: scheduleWork }),
    source({ kind: "milestones", key: "milestoneEnrollments", table: "milestoneEnrollments", index: "by_global_discovery", prefix: [], order: "nextCheckAt", due: true }),
    source({ kind: "suggestions", key: "suggestions", table: "suggestions", index: "by_global_work", prefix: [["dirty", true]], order: "nextCheckAt", due: true,
        gate: async (settings, serverId) => (await settings.suggestions(serverId))?.enabled === true && (await settings.publishing(serverId))?.enabled !== false,
        work: (_ctx, row, now) => !row.forgetting && (row.historyExpiresAt === undefined || now < row.historyExpiresAt) }),
    source({ kind: "cleanup", key: "cleanupPolicies", table: "cleanupPolicies", index: "by_global_due", prefix: [["enabled", true]], order: "nextCheckAt", due: true,
        gate: async (settings, serverId) => (await settings.cleanup(serverId))?.enabled === true && await settings.defcon(serverId) !== 1 }),
    source({ kind: "metadata", key: "metadataLogRecords", table: "metadataLogRecords", index: "by_global_work", prefix: [["actionable", true]], order: "nextCheckAt", due: true }),
    source({ kind: "levels", key: "levelingProfiles", table: "levelingProfiles", index: "by_global_reward_due", prefix: [], order: "rewardDueAt", min: 0, due: true }),
    source({ kind: "levels", key: "levelingSettings", table: "levelingSettings", index: "by_sweep", prefix: [["sweepPending", true]] }),
    // Ended grants are removed at every DEFCON level, and a grant with a problem waits for its retry time
    source({ kind: "temproles", key: "temporaryRoleGrants", table: "temporaryRoleGrants", index: "by_global_due", prefix: [], order: "nextCheckAt", due: true }),
    source({ kind: "helpdesk", key: "helpDeskPosts", table: "helpDeskPosts", index: "by_global_due", prefix: [], order: "nudgeAt", due: true }),
    source({ kind: "helpdesk", key: "helpDeskSettings", table: "helpDeskSettings", index: "by_guard_due", prefix: [], order: "guardDueAt", min: 0, due: true }),
    // Open groups close when their time runs out, also while the feature is off
    source({ kind: "lfg", key: "lfgGroups", table: "lfgGroups", index: "by_global_expiry", prefix: [], order: "expiresAt", due: true }),
    // New YouTube alerts wait while publishing is off or DEFCON is below 3
    source({ kind: "youtube", key: "youtubeDeliveries", table: "youtubeDeliveries", index: "by_global_due", prefix: [["state", "queued"]], order: "nextCheckAt", due: true,
        gate: async (settings, serverId) => (await settings.publishing(serverId))?.enabled !== false && await settings.defcon(serverId) === 3 }),
]

/** The tables the dispatcher reads, so bot mutations can report the due work their writes create */
export const WORK_TABLES: ReadonlySet<TableNames> = new Set(WORK_SOURCES.map(source => source.table))
// When a row as written makes its worker due, by the same prefix and order its sources read. A source without a due order
// lists its rows at once. Gates and work checks are left to the dispatch, so a reported time can only be early
export function rowDueAt(table: TableNames, row: Record<string, unknown>, now: number): number | undefined {
    let earliest: number | undefined
    for (const source of WORK_SOURCES) {
        if (source.table !== table || !source.prefix.every(([field, value]) => row[field] === value)) continue
        const at = source.due && source.order ? row[source.order] : now
        if (typeof at !== "number" || source.min !== undefined && at < source.min) continue
        earliest = Math.min(earliest ?? at, at)
    }
    return earliest
}

type Range = { eq(field: string, value: unknown): Range, gt(field: string, value: unknown): Range, gte(field: string, value: unknown): Range, lte(field: string, value: unknown): Range }
type Rows = { withIndex(index: string, range: (q: Range) => Range): { take(count: number): Promise<Row[]>, first(): Promise<Row | null> } }
// Reads at most limit rows of one source in index order, continuing after a position. Each read is one bounded index range
async function scan(ctx: QueryCtx, source: Source, now: number, after: Position | undefined, limit: number) {
    const rows = ctx.db.query(source.table) as unknown as Rows, field = source.order
    const prefix = (q: Range) => source.prefix.reduce((range, [name, value]) => range.eq(name, value), q)
    const page: Row[] = []
    if (after && field) page.push(...await rows.withIndex(source.index, q => prefix(q).eq(field, after[0]).gt("_creationTime", after[1])).take(limit))
    if (page.length < limit) page.push(...await rows.withIndex(source.index, q => {
        const range = prefix(q)
        if (!field) return after ? range.gt("_creationTime", after[1]) : range
        const from = after ? range.gt(field, after[0]) : source.min !== undefined ? range.gte(field, source.min) : range
        return source.due ? from.lte(field, now) : from
    }).take(limit - page.length))
    return page
}

function positions(cursor: string | null): Partial<Record<string, Position>> {
    if (cursor === null) return {}
    let value: unknown
    try { value = JSON.parse(cursor) } catch { fail(400, "Invalid work cursor") }
    if (value === null || typeof value !== "object" || Array.isArray(value)) fail(400, "Invalid work cursor")
    const keys = new Set(WORK_SOURCES.map(source => source.key))
    for (const [key, position] of Object.entries(value)) {
        if (!keys.has(key) || !Array.isArray(position) || position.length !== 2 || !position.every(Number.isFinite)) fail(400, "Invalid work cursor")
    }
    return value as Record<string, Position>
}

// Which servers have work for each bot worker now. Every source is a bounded read of a global index in due order, so idle
// servers cost nothing. Only active installations, or the configured server in single mode, are reported. A source that
// filled its page continues from the cursor on the next call, so rows of servers the bot no longer serves cannot hide others
export async function dueWork(ctx: QueryCtx, now: number, cursor: string | null): Promise<ServiceWork> {
    const scope = configuredServerScope(), after = positions(cursor), settings = serverSettings(ctx)
    const served = (serverId: string) => settings.once(`served:${serverId}`, async () => scope.mode === "single" ? serverId === scope.serverIds[0] : isInstalled(ctx, serverId))
    const kinds = Object.fromEntries(WORK_KINDS.map(kind => [kind, [] as string[]])) as Record<ServiceWorkKind, string[]>
    const next: Record<string, Position> = {}
    for (const source of WORK_SOURCES) {
        const found = kinds[source.kind], start = after[source.key]
        if (found.length >= WORK_SERVERS_PER_KIND) { if (start) next[source.key] = start; continue }
        const rows = await scan(ctx, source, now, start, WORK_ROWS_PER_SOURCE)
        let last = start, cut = false
        for (const row of rows) {
            if (!found.includes(row.serverId)) {
                // A full kind leaves this row for the next call
                if (found.length >= WORK_SERVERS_PER_KIND) { cut = true; break }
                const gate = source.gate
                if (await served(row.serverId) && (!gate || await settings.once(`${source.key}:${row.serverId}`, () => gate(settings, row.serverId)))
                    && (!source.work || await source.work(ctx, row as never, now))) found.push(row.serverId)
            }
            last = [source.order ? row[source.order] as number : 0, row._creationTime]
        }
        if ((cut || rows.length === WORK_ROWS_PER_SOURCE) && last) next[source.key] = last
    }
    // The earliest row that becomes due later, one indexed row per timed source, so the bot can sleep until then
    let nextDueAt: number | undefined
    for (const source of WORK_SOURCES) {
        const field = source.order
        if (!source.due || !field) continue
        const row = await (ctx.db.query(source.table) as unknown as Rows).withIndex(source.index, q => source.prefix.reduce((range, [name, value]) => range.eq(name, value), q).gt(field, now)).first()
        const at = row?.[field]
        if (typeof at === "number") nextDueAt = Math.min(nextDueAt ?? at, at)
    }
    return { kinds, cursor: Object.keys(next).length ? JSON.stringify(next) : null, nextDueIn: nextDueAt === undefined ? null : nextDueAt - now }
}
