import type { QueryCtx } from "./_generated/server.js"
import type { Doc, TableNames } from "./_generated/dataModel.js"
import { type ServiceWork, ServiceWorkKind } from "@neonflux/contracts/service"
import { isServed } from "./serviceGuard.ts"
import { fail } from "./validation.ts"

export const WORK_KINDS = ServiceWorkKind.literals
export const WORK_ROWS_PER_SOURCE = 100
// A dispatch reads at most this many document bytes across all sources, below Convex's 16 MiB read limit with room for the work
// reads and next due times. Reads come in chunks no larger than what the remaining budget holds at Convex's 1 MiB document limit,
// so a source of large rows continues on the next page instead of failing the whole dispatch
const WORK_READ_BYTES = 12 * 1048576
const MAX_DOCUMENT_BYTES = 1048576
// Where a source the budget left unread starts on the next page: before every row, as no position at all would
const BEGIN: Position = [-1, -1]
const encoder = new TextEncoder()

type Row = { _creationTime: number; serverId: string } & Record<string, unknown>
type Position = [value: number, creationTime: number]
interface Source {
    readonly kind: ServiceWorkKind
    readonly key: string
    readonly table: TableNames
    readonly index: string
    /** Equality values for the leading index fields */
    readonly prefix: readonly (readonly [string, unknown])[]
    /** The index field after the prefix that orders rows by due time */
    readonly order: string
    /** Whether the worker's endpoint would act on this row. Each check mirrors that endpoint's selection */
    readonly work: (ctx: QueryCtx, row: never, now: number) => boolean | Promise<boolean>
}
function source<T extends TableNames>(
    spec: Omit<Source, "table" | "work"> & {
        table: T
        work: (ctx: QueryCtx, row: Doc<T>, now: number) => boolean | Promise<boolean>
    },
): Source {
    return spec as Source
}

// Checks shared by the rows of one dispatch
function dispatchChecks() {
    const cache = new Map<string, Promise<unknown>>()
    const once = <A>(key: string, read: () => Promise<A>) => {
        if (!cache.has(key)) cache.set(key, read())
        return cache.get(key) as Promise<A>
    }
    return {
        once,
    }
}

// Mirrors schedulesDelivery list for due deliveries. Deliveries due later need no visit before their time
async function scheduleWork(ctx: QueryCtx, row: Doc<"scheduleDeliveries">, now: number) {
    if (row.dueAt > now || row.nextCheckAt > now || row.claimedAt !== undefined) return false
    const attempt = row.attemptId ? await ctx.db.get(row.attemptId) : null
    return !attempt || (attempt.outcome === "pending" && attempt.dispatchedAt === undefined)
}

const WORK_SOURCES: readonly Source[] = [
    source({
        kind: "schedules",
        key: "scheduleDeliveries",
        table: "scheduleDeliveries",
        index: "by_global_discovery",
        prefix: [["active", true]],
        order: "nextCheckAt",
        work: scheduleWork,
    }),
]

/** The tables the dispatcher reads, so bot mutations can report the due work their writes create */
export const WORK_TABLES: ReadonlySet<TableNames> = new Set(WORK_SOURCES.map((source) => source.table))
// When a row as written makes its worker due, by the same prefix and order its sources read. Work checks are left to the
// dispatch, so a reported time can only be early
export function rowDueAt(table: TableNames, row: Record<string, unknown>): number | undefined {
    let earliest: number | undefined
    for (const source of WORK_SOURCES) {
        if (source.table !== table || !source.prefix.every(([field, value]) => row[field] === value)) continue
        const at = row[source.order]
        if (typeof at !== "number") continue
        earliest = Math.min(earliest ?? at, at)
    }
    return earliest
}

type Range = {
    eq(field: string, value: unknown): Range
    gt(field: string, value: unknown): Range
    lte(field: string, value: unknown): Range
}
type Rows = {
    withIndex(
        index: string,
        range: (q: Range) => Range,
    ): { take(count: number): Promise<Row[]>; first(): Promise<Row | null> }
}
// Reads at most limit rows of one source in index order, continuing after a position. Each read is one bounded index range
async function scan(ctx: QueryCtx, source: Source, now: number, after: Position | undefined, limit: number) {
    const rows = ctx.db.query(source.table) as unknown as Rows,
        field = source.order
    const prefix = (q: Range) => source.prefix.reduce((range, [name, value]) => range.eq(name, value), q)
    const page: Row[] = []
    if (after)
        page.push(
            ...(await rows
                .withIndex(source.index, (q) => prefix(q).eq(field, after[0]).gt("_creationTime", after[1]))
                .take(limit)),
        )
    if (page.length < limit)
        page.push(
            ...(await rows
                .withIndex(source.index, (q) => (after ? prefix(q).gt(field, after[0]) : prefix(q)).lte(field, now))
                .take(limit - page.length)),
        )
    return page
}

function positions(cursor: string | null): Partial<Record<string, Position>> {
    if (cursor === null) return {}
    let value: unknown
    try {
        value = JSON.parse(cursor)
    } catch {
        fail(400, "Invalid work cursor")
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) fail(400, "Invalid work cursor")
    const keys = new Set(WORK_SOURCES.map((source) => source.key))
    for (const [key, position] of Object.entries(value)) {
        if (!keys.has(key) || !Array.isArray(position) || position.length !== 2 || !position.every(Number.isFinite))
            fail(400, "Invalid work cursor")
    }
    return value as Record<string, Position>
}

// Which servers have work for each bot worker now. Every source is a bounded read of a global index in due order, so idle
// servers cost nothing. Only the configured server is reported. A source that
// filled its page or ran out of read budget continues from the cursor on the next call, so rows of servers
// the bot no longer serves cannot hide others. Later pages of a pass read only the sources the cursor names. A held cursor
// from an earlier pass moves each source this read leaves unfinished to the further of the two positions, so the next
// pages go on with both the older backlog and the new work
export async function dueWork(
    ctx: QueryCtx,
    now: number,
    cursor: string | null,
    held: string | null = null,
): Promise<ServiceWork> {
    const after = positions(cursor),
        older = positions(held),
        checks = dispatchChecks()
    const served = (serverId: string) => checks.once(`served:${serverId}`, () => isServed(serverId))
    const kinds = Object.fromEntries(WORK_KINDS.map((kind) => [kind, [] as string[]])) as Record<
        ServiceWorkKind,
        string[]
    >
    const next: Record<string, Position> = {}
    let budget = WORK_READ_BYTES
    for (const source of WORK_SOURCES) {
        const found = kinds[source.kind],
            start = after[source.key]
        if (cursor !== null && !start) continue
        let last = start,
            read = 0,
            cut = false
        while (read < WORK_ROWS_PER_SOURCE) {
            const chunk = Math.min(WORK_ROWS_PER_SOURCE - read, Math.floor(budget / MAX_DOCUMENT_BYTES))
            // A spent budget leaves the rest of this source for the next call
            if (chunk === 0) {
                cut = true
                break
            }
            const rows = await scan(ctx, source, now, last, chunk)
            for (const row of rows) {
                budget -= encoder.encode(JSON.stringify(row)).length
                if (!found.includes(row.serverId)) {
                    if ((await served(row.serverId)) && (await source.work(ctx, row as never, now))) {
                        found.push(row.serverId)
                    }
                }
                last = [row[source.order] as number, row._creationTime]
                read++
            }
            if (rows.length < chunk) break
        }
        if (cut || read === WORK_ROWS_PER_SOURCE) {
            const position = last ?? BEGIN,
                kept = older[source.key]
            next[source.key] =
                kept && (kept[0] > position[0] || (kept[0] === position[0] && kept[1] > position[1])) ? kept : position
        }
    }
    // The earliest row that becomes due later, one indexed row per timed source, so the bot can sleep until then
    let nextDueAt: number | undefined
    for (const source of WORK_SOURCES) {
        const field = source.order
        const row = await (ctx.db.query(source.table) as unknown as Rows)
            .withIndex(source.index, (q) =>
                source.prefix.reduce((range, [name, value]) => range.eq(name, value), q).gt(field, now),
            )
            .first()
        const at = row?.[field]
        if (typeof at === "number") nextDueAt = Math.min(nextDueAt ?? at, at)
    }
    return {
        kinds,
        cursor: Object.keys(next).length ? JSON.stringify(next) : null,
        nextDueIn: nextDueAt === undefined ? null : nextDueAt - now,
    }
}
