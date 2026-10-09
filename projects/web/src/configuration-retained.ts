import type {
    DashboardConfigurationFamily,
    DashboardConfigurationSnapshot,
} from "@neonflux/backend/dashboard-contracts"
import { identitiesOf } from "./configuration-live"

// One list of a family's data: how to read its rows, how to put rows back and what identifies a row
interface List {
    rows: (data: any) => unknown[]
    put: (data: any, rows: unknown[]) => unknown
    identity: (row: any) => string
}
const top = (key: string, identity: List["identity"]): List => ({
    rows: (data) => data[key],
    put: (data, rows) => ({ ...data, [key]: rows }),
    identity,
})
const inSettings = (key: string, identity: List["identity"]): List => ({
    rows: (data) => data.settings[key],
    put: (data, rows) => ({ ...data, settings: { ...data.settings, [key]: rows } }),
    identity,
})
/** Lists that are not paged, whose removed rows are kept like those of the paged collections */
const unpaged: Partial<Record<DashboardConfigurationFamily, List[]>> = {
    rolepicker: [inSettings("menus", (menu) => `menu:${menu.name}`)],
    voice: [top("generators", (generator) => `generator:${generator.channelId}`)],
}

/** Adds the rows that left the snapshot back while keep says one of their forms holds an unsaved edit */
export function preserveRemovedDefinitions(
    current: DashboardConfigurationSnapshot,
    previous: DashboardConfigurationSnapshot | undefined,
    keep: (row: string) => boolean,
): { view: DashboardConfigurationSnapshot; missing: string[] } {
    const lists = [
        ...Object.entries(identitiesOf(current.family) ?? {}).map(([key, identity]) => top(key, identity)),
        ...(unpaged[current.family] ?? []),
    ]
    if (!previous || !lists.length || current.serverId !== previous.serverId || current.family !== previous.family)
        return { view: current, missing: [] }
    let data: unknown = current.data
    const missing: string[] = []
    for (const { rows, put, identity } of lists) {
        const ids = new Set(rows(data).map(identity)),
            removed = rows(previous.data).filter((row) => !ids.has(identity(row)) && keep(identity(row)))
        data = put(data, [...rows(data), ...removed])
        missing.push(...removed.map(identity))
    }
    return { view: { ...current, data } as DashboardConfigurationSnapshot, missing }
}
