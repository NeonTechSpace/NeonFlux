import { canonicalBackupJson } from "@neonflux/contracts/backup"

/** One changed leaf. A missing before is a value that was added, and a missing after one that was removed */
export type ValueChange = { path: string; before?: unknown; after?: unknown }

// The field that names a list entry: the first of the given fields that every entry holds, with no two entries alike
function entryNames(value: unknown[], identity: readonly string[]) {
    for (const field of identity) {
        const names = value.map((x) =>
            x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>)[field] : undefined,
        )
        if (names.every((x) => typeof x === "string" || typeof x === "number") && new Set(names).size === names.length)
            return names as Array<string | number>
    }
    return undefined
}
/** The leaves of a value by path. Objects go by key, and arrays by the entries' names when each entry has its own, otherwise by index. An empty array or object is a leaf */
function leaves(value: unknown, path: string, out: Map<string, unknown>, identity: readonly string[]) {
    if (Array.isArray(value) && value.length) {
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
    return [...new Set([...was.keys(), ...now.keys()])]
        .sort()
        .filter(
            (path) =>
                !was.has(path) ||
                !now.has(path) ||
                canonicalBackupJson(was.get(path)) !== canonicalBackupJson(now.get(path)),
        )
        .map((path) => ({
            path,
            ...(was.has(path) ? { before: was.get(path) } : {}),
            ...(now.has(path) ? { after: now.get(path) } : {}),
        }))
}
