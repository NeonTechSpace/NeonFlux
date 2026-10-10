import { useEffect, useRef, useState } from "react"
import type { ConvexReactClient } from "convex/react"
import type {
    DashboardConfigurationCollection,
    DashboardConfigurationCursors,
    DashboardConfigurationFamily,
    DashboardConfigurationSnapshot,
} from "@neonflux/backend/dashboard-contracts"
import { dashboardApi } from "./dashboard-api"

function unique<T>(rows: T[], key: (row: T) => string): T[] {
    return [...new Map(rows.map((row) => [key(row), row])).values()]
}
type FamilyData<F extends DashboardConfigurationFamily> = Extract<DashboardConfigurationSnapshot, { family: F }>["data"]
type RowIdentities = {
    [F in DashboardConfigurationFamily]?: {
        [K in keyof FamilyData<F> & DashboardConfigurationCollection]: (
            row: FamilyData<F>[K] extends readonly (infer Row)[] ? Row : never,
        ) => string
    }
}
/** The collections each family pages, with what identifies a row in each. Page merging and removed-row retention read it */
const rowIdentities = {
    responses: { definitions: (row) => `${row.kind}:${row.name}` },
    moderation: { rules: (row) => `rule:${row.name}`, watchlist: (row) => `watchlist:${row.userId}` },
    publishing: { drafts: (row) => `${row.kind}:${row.name}` },
    tickets: { categories: (row) => row.name },
    milestones: { routes: (row) => row.kind },
    cleanup: { policies: (row) => row.channelId },
    events: { events: (row) => String(row.eventNo) },
    schedules: { schedules: (row) => String(row.scheduleNo) },
} satisfies RowIdentities
/** The identities of a family's paged collections, by collection name */
export const identitiesOf = (family: DashboardConfigurationFamily) =>
    (rowIdentities as Partial<Record<string, Record<string, (row: any) => string>>>)[family]
/** A snapshot's data by collection name */
const collectionsOf = (snapshot: DashboardConfigurationSnapshot) => snapshot.data as Record<string, unknown[]>
function mergePages(
    first: DashboardConfigurationSnapshot,
    all: DashboardConfigurationSnapshot[],
): DashboardConfigurationSnapshot {
    const identities = identitiesOf(first.family)
    if (!identities) return first
    const data = { ...first.data } as Record<string, unknown[]>
    for (const [collection, identity] of Object.entries(identities))
        data[collection] = unique(
            all.flatMap((page) => (page.family === first.family ? collectionsOf(page)[collection]! : [])),
            identity,
        )
    return { ...first, data } as DashboardConfigurationSnapshot
}
/** The most later pages of one collection that stay loaded and live beside the first page. Loading another drops the earliest of them */
export const PAGE_WINDOW = 4
// A collection's loaded later pages: from is the cursor of the earliest one, or undefined when they follow the first page
type PageWindow = { from?: string | undefined; pages: number }
export function useConfigurationState(
    client: ConvexReactClient,
    sessionToken: string,
    serverId: string,
    family: DashboardConfigurationFamily,
) {
    const [remote, setRemote] = useState<DashboardConfigurationSnapshot>(),
        [error, setError] = useState(false)
    const [windows, setWindows] = useState<Partial<Record<DashboardConfigurationCollection, PageWindow>>>({}),
        [loadingPage, setLoadingPage] = useState(false)
    // The cursor of each loaded later page, so the window can move one page on
    const chains = useRef<Partial<Record<DashboardConfigurationCollection, string[]>>>({})
    const key = JSON.stringify(windows)
    useEffect(() => {
        setRemote(undefined)
        setError(false)
        setWindows({})
        setLoadingPage(false)
    }, [serverId, family])
    useEffect(() => {
        let disposed = false,
            pending = false
        const subscriptions = new Map<
            string,
            { watch: ReturnType<ConvexReactClient["watchQuery"]>; unsubscribe?: () => void }
        >()
        function schedule() {
            if (!disposed && !pending) {
                pending = true
                queueMicrotask(() => {
                    pending = false
                    if (!disposed) update()
                })
            }
        }
        function read(cursors: DashboardConfigurationCursors, used: Set<string>) {
            const id = JSON.stringify(cursors)
            used.add(id)
            let subscription = subscriptions.get(id)
            if (!subscription) {
                const watch = client.watchQuery(dashboardApi.configurationSnapshot, {
                    sessionToken,
                    serverId,
                    family,
                    ...(Object.keys(cursors).length ? { cursors } : {}),
                })
                subscription = { watch }
                subscriptions.set(id, subscription)
                subscription.unsubscribe = watch.onUpdate(schedule)
            }
            const result = subscription.watch.localQueryResult() as DashboardConfigurationSnapshot | undefined
            if (result && (result.family !== family || result.serverId !== serverId))
                throw new Error("Configuration scope changed")
            return result
        }
        function update() {
            try {
                const used = new Set<string>(),
                    first = read({}, used)
                if (!first) return
                const all = [first],
                    nextCursors: DashboardConfigurationCursors = { ...first.nextCursors },
                    cursors: typeof chains.current = {}
                for (const collection of Object.keys(windows) as DashboardConfigurationCollection[]) {
                    const window = windows[collection]!,
                        chain: string[] = (cursors[collection] = [])
                    let cursor = window.from ?? first.nextCursors?.[collection]
                    for (let depth = 0; depth < window.pages; depth++) {
                        if (!cursor) {
                            delete nextCursors[collection]
                            break
                        }
                        const result = read({ [collection]: cursor }, used)
                        if (!result || result.configRevision !== first.configRevision) {
                            setLoadingPage(true)
                            return
                        }
                        all.push(result)
                        chain.push(cursor)
                        cursor = result.nextCursors?.[collection]
                        if (cursor) nextCursors[collection] = cursor
                        else delete nextCursors[collection]
                    }
                }
                chains.current = cursors
                for (const [id, subscription] of subscriptions)
                    if (!used.has(id)) {
                        subscription.unsubscribe?.()
                        subscriptions.delete(id)
                    }
                setRemote({ ...mergePages(first, all), nextCursors })
                setLoadingPage(false)
                setError(false)
            } catch {
                setError(true)
                setLoadingPage(false)
            }
        }
        update()
        return () => {
            disposed = true
            subscriptions.forEach((subscription) => subscription.unsubscribe?.())
        }
    }, [client, sessionToken, serverId, family, key])
    function loadPage(collection: DashboardConfigurationCollection, cursor?: string) {
        if (!cursor || loadingPage || cursor !== remote?.nextCursors?.[collection]) return
        setLoadingPage(true)
        setWindows((current) => {
            const window = current[collection] ?? { pages: 0 }
            // A full window moves on by one page, so loaded pages, and their live queries, stay bounded
            return {
                ...current,
                [collection]:
                    window.pages < PAGE_WINDOW
                        ? { ...window, pages: window.pages + 1 }
                        : { from: chains.current[collection]?.[1] ?? cursor, pages: window.pages },
            }
        })
    }
    /** Shows a collection from its first page again */
    function firstPages(collection: DashboardConfigurationCollection) {
        setWindows(({ [collection]: _, ...rest }) => rest)
    }
    // Collections whose earlier later pages were dropped from the window
    const skipped = (Object.keys(windows) as DashboardConfigurationCollection[]).filter(
        (collection) => windows[collection]?.from !== undefined,
    )
    // start changes only when a window moves or returns to the first page, which removes rows on purpose
    return {
        remote,
        error,
        loadingPage,
        loadPage,
        skipped,
        firstPages,
        start: JSON.stringify(skipped.map((collection) => [collection, windows[collection]!.from])),
    }
}
