import {
    structureChanges,
    type StructureChange,
    type StructureEntry,
    type StructurePlace,
} from "@neonflux/contracts/structure"

const where = (place: StructurePlace) =>
    `${place.parentName ?? "the top level"}, ${place.afterName === null ? "first" : `after ${place.afterName}`}`
/** The change in words, as the last save lists it */
export const changeText = (change: StructureChange) =>
    change.type === "rename"
        ? `Rename ${change.from} to ${change.to}`
        : `Move ${change.name} from ${where(change.from)} to ${where(change.to)}`

/**
 * The changed entries of a draft in its order, each with marks that say what changed, such as "was Chat" or "moved from Chat, after
 * general to Info, first". fixed names the channels the manager cannot change, as the save's merge does
 */
export function diffRows(
    base: readonly StructureEntry[],
    draft: readonly StructureEntry[],
    fixed?: (id: string) => boolean,
) {
    const rows = new Map<string, string[]>()
    for (const change of structureChanges(base, draft, fixed))
        rows.set(change.channelId, [
            ...(rows.get(change.channelId) ?? []),
            change.type === "rename" ? `was ${change.from}` : `moved from ${where(change.from)} to ${where(change.to)}`,
        ])
    return [...rows].map(([id, marks]) => ({ id, marks }))
}
