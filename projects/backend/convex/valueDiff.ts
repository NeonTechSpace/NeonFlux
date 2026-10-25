import { canonicalBackupJson } from "@neonflux/contracts/backup"

/** One changed leaf. A missing before is a value that was added, and a missing after one that was removed */
export type ValueChange = { path: string; before?: unknown; after?: unknown }

/**
 * Lists whose order means nothing and that hold up to 8,192 IDs each, the expected bots and webhooks of security alerts. Each shows as
 * one row, with the IDs it drops before and the IDs it adds after, so a whole list fits one row and a reorder is no change
 */
export const ID_SETS: readonly string[] = ["expectedBotIds", "expectedWebhookIds"]
// The IDs of a list that ID_SETS names, kept as one leaf
class IdSet {
    readonly ids: readonly unknown[]
    constructor(ids: readonly unknown[]) {
        this.ids = ids
    }
}
const lastKey = (path: string) => path.slice(path.lastIndexOf(".") + 1)

/**
 * The name an identity field gives an entry. A field such as "kind:name" joins several, for lists where one name may repeat across
 * kinds, so the same entry has the same name whatever else the list holds
 */
export function entryName(entry: unknown, field: string): string | number | undefined {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined
    const parts = field.split(":").map((key) => (entry as Record<string, unknown>)[key])
    if (!parts.every((x) => typeof x === "string" || typeof x === "number")) return undefined
    return parts.length === 1 ? (parts[0] as string | number) : parts.join(":")
}
// The field that names a list entry: the first of the given fields that every entry holds, with no two entries alike
function entryNames(value: unknown[], identity: readonly string[]) {
    for (const field of identity) {
        const names = value.map((x) => entryName(x, field))
        if (names.every((x) => x !== undefined) && new Set(names).size === names.length)
            return names as Array<string | number>
    }
    return undefined
}
/** The leaves of a value by path. Objects go by key, and arrays by the entries' names when each entry has its own, otherwise by index. An empty array or object is a leaf */
function leaves(value: unknown, path: string, out: Map<string, unknown>, identity: readonly string[]) {
    if (Array.isArray(value) && ID_SETS.includes(lastKey(path))) out.set(path, new IdSet(value))
    else if (Array.isArray(value) && value.length) {
        const names = entryNames(value, identity)
        value.forEach((x, i) => leaves(x, `${path}[${names ? names[i] : i}]`, out, identity))
    } else if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) {
        for (const [key, x] of Object.entries(value))
            if (x !== undefined) leaves(x, path ? `${path}.${key}` : key, out, identity)
    } else out.set(path, value)
}
/**
 * The differences between two values as leaf rows in path order. A missing before lists every leaf of after, so a new item shows what it
 * brings. List entries are matched by the first identity field that names each of them
 */
export function valueDiff(before: unknown, after: unknown, identity: readonly string[]): ValueChange[] {
    const was = new Map<string, unknown>(),
        now = new Map<string, unknown>()
    if (before !== undefined) leaves(before, "", was, identity)
    if (after !== undefined) leaves(after, "", now, identity)
    return [...new Set([...was.keys(), ...now.keys()])].sort().flatMap((path): ValueChange[] => {
        const a = was.get(path),
            b = now.get(path)
        if (a instanceof IdSet || b instanceof IdSet) {
            const from = a instanceof IdSet ? a.ids : [],
                to = b instanceof IdSet ? b.ids : [],
                kept = new Set(to),
                had = new Set(from),
                gone = from.filter((id) => !kept.has(id)),
                added = to.filter((id) => !had.has(id)),
                both = was.has(path) && now.has(path)
            if (both && !gone.length && !added.length) return []
            return [
                {
                    path,
                    ...(was.has(path) && (!both || gone.length) ? { before: both ? gone : from } : {}),
                    ...(now.has(path) && (!both || added.length) ? { after: both ? added : to } : {}),
                },
            ]
        }
        return !was.has(path) || !now.has(path) || canonicalBackupJson(a) !== canonicalBackupJson(b)
            ? [{ path, ...(was.has(path) ? { before: a } : {}), ...(now.has(path) ? { after: b } : {}) }]
            : []
    })
}
