import { StructureLayout, structureOrdered, type StructureApply, type StructureChannel, type StructureEntry } from "@neonflux/contracts/structure"
import type { StructureChange, StructureItem, StructureOutcome, StructurePlace } from "../dashboard-contracts.js"
import { decode, fail } from "./validation.ts"

// The server structure as plain lists, and the one diff and three-way merge that both the website's preview and a save use, so a
// preview cannot drift from what a save does. A structure lists categories and channels in sibling order: top-level entries in
// order, each category followed by its channels. Siblings are the entries with the same parent, so moves name their place by
// parent and the sibling right before, as Fluxer's reorder does

export { STRUCTURE_ARCHIVED, STRUCTURE_CHANGES, STRUCTURE_CHANNELS, STRUCTURE_THREADS, threadParents } from "@neonflux/contracts/structure"

function entries(value: unknown): StructureEntry[] {
    const layout = decode(StructureLayout, value, "Invalid structure")
    if (!structureOrdered(layout)) fail(400, "Invalid structure order")
    return layout
}
/** The website's starting structure and draft. A draft keeps every channel and its type, and changes only names, parents and order */
export function structureDraft(base: unknown, draft: unknown) {
    const before = entries(base), after = entries(draft), types = new Map(before.map(entry => [entry.id, entry.type]))
    if (after.length !== before.length || after.some(entry => types.get(entry.id) !== entry.type)) fail(400, "The draft must keep every channel")
    return { base: before, draft: after }
}
/** Each entry's parent and the sibling right before it */
function places(layout: readonly StructureEntry[]) {
    const out = new Map<string, { parentId: string | null, afterId: string | null }>(), last = new Map<string | null, string>()
    for (const entry of layout) { out.set(entry.id, { parentId: entry.parentId, afterId: last.get(entry.parentId) ?? null }); last.set(entry.parentId, entry.id) }
    return out
}
/** Positions of one longest increasing run, earliest first on ties */
function longestIncreasing(values: readonly number[]) {
    const length = values.map(() => 1), previous = values.map(() => -1)
    let best = -1
    values.forEach((value, i) => {
        for (let j = 0; j < i; j++) if (values[j]! < value && length[j]! + 1 > length[i]!) { length[i] = length[j]! + 1; previous[i] = j }
        if (best < 0 || length[i]! > length[best]!) best = i
    })
    const keep = new Set<number>()
    for (let i = best; i >= 0; i = previous[i]!) keep.add(i)
    return keep
}
/**
 * The channels that other moved relative to base: those with another parent, and within each parent the fewest channels whose
 * moves explain the new order. Channels that exist in only one of the two are neither moved nor in the way
 */
export function movedChannels(base: readonly StructureEntry[], other: readonly StructureEntry[]) {
    const before = new Map(base.map((entry, index) => [entry.id, { entry, index }])), moved = new Set<string>(), groups = new Map<string | null, string[]>()
    for (const entry of other) {
        const was = before.get(entry.id)
        if (!was) continue
        if (was.entry.parentId !== entry.parentId) moved.add(entry.id)
        else groups.set(entry.parentId, [...groups.get(entry.parentId) ?? [], entry.id])
    }
    for (const ids of groups.values()) {
        const keep = longestIncreasing(ids.map(id => before.get(id)!.index))
        ids.forEach((id, index) => { if (!keep.has(index)) moved.add(id) })
    }
    return moved
}
/** What a draft changes, in the draft's order: a rename when the name differs and a move when the channel moved */
export function structureChanges(base: readonly StructureEntry[], draft: readonly StructureEntry[]): StructureChange[] {
    const before = new Map(base.map(entry => [entry.id, entry])), after = new Map(draft.map(entry => [entry.id, entry]))
    const from = places(base), to = places(draft), moved = movedChannels(base, draft)
    const place = (names: Map<string, StructureEntry>, at: { parentId: string | null, afterId: string | null }): StructurePlace => ({ ...at,
        parentName: at.parentId === null ? null : names.get(at.parentId)!.name, afterName: at.afterId === null ? null : names.get(at.afterId)!.name })
    const changes: StructureChange[] = []
    for (const entry of draft) {
        const old = before.get(entry.id)!
        if (old.name !== entry.name) changes.push({ type: "rename", channelId: entry.id, from: old.name, to: entry.name })
        if (moved.has(entry.id)) changes.push({ type: "move", channelId: entry.id, name: entry.name, from: place(before, from.get(entry.id)!), to: place(after, to.get(entry.id)!) })
    }
    return changes
}

/**
 * The three-way merge of a draft with the structure it started from and the current one. Each change applies when the current
 * structure still matches the start, is skipped when it already matches the draft and conflicts when another change touched the
 * same name or place. A change to a channel that is gone, or a move into a category that is gone, is blocked, and a change in a
 * channel the manager cannot manage is refused. Applied moves say where to write them, after the nearest earlier draft sibling
 * that will share the new parent
 */
export function structureMerge(base: readonly StructureEntry[], draft: readonly StructureEntry[], current: readonly StructureChannel[]): Array<StructureItem & { apply?: StructureApply }> {
    const now = new Map(current.map(entry => [entry.id, entry])), here = places(current), theirs = movedChannels(base, current)
    const items: Array<StructureItem & { apply?: StructureApply }> = structureChanges(base, draft).map((change, index) => {
        const decide = (disposition: StructureItem["disposition"], reason: string | null = null) => ({ itemNo: index + 1, change, disposition, reason })
        const channel = now.get(change.channelId)
        if (!channel) return decide("blocked", "The channel was deleted, or you can no longer see it")
        if (change.type === "rename") {
            if (channel.name === change.to) return decide("skip", "It already has this name")
            if (!channel.manage) return decide("refused", "You need Manage Channels in this channel")
            return channel.name === change.from ? decide("apply") : decide("conflict", `It was renamed to ${channel.name} since your draft started`)
        }
        if (change.to.parentId !== null && now.get(change.to.parentId)?.type !== "category") return decide("blocked", `The category ${change.to.parentName} was deleted, or you can no longer see it`)
        const at = here.get(channel.id)!
        if (at.parentId === change.to.parentId && at.afterId === change.to.afterId) return decide("skip", "It is already in this place")
        if (!channel.manage) return decide("refused", "You need Manage Channels in this channel")
        return theirs.has(channel.id) ? decide("conflict", "It was moved since your draft started") : decide("apply")
    })
    const moving = new Map(items.flatMap(item => item.disposition === "apply" && item.change.type === "move" ? [[item.change.channelId, item.change.to.parentId] as const] : []))
    for (const item of items) {
        if (item.disposition !== "apply") continue
        const change = item.change
        if (change.type === "rename") { item.apply = { itemNo: item.itemNo, type: "rename", channelId: change.channelId, name: change.to }; continue }
        const siblings = draft.filter(entry => entry.parentId === change.to.parentId).map(entry => entry.id), parent = (id: string) => moving.has(id) ? moving.get(id) : now.get(id)?.parentId
        const preceding = siblings.slice(0, siblings.indexOf(change.channelId)).reverse().find(id => now.has(id) && parent(id) === change.to.parentId) ?? null
        item.apply = { itemNo: item.itemNo, type: "move", channelId: change.channelId, parentId: change.to.parentId, precedingSiblingId: preceding }
    }
    return items
}

/** An audit entry for a change that was applied or may have been, naming channels and never message content */
export function structureAudit(change: StructureChange, outcome: StructureOutcome) {
    const unknown = outcome === "uncertain" ? ", outcome unknown" : ""
    if (change.type === "rename") return { setting: `rename ${change.from}`, summary: `name: ${change.from} → ${change.to}${unknown}` }
    const where = (place: StructurePlace) => `${place.parentName ?? "top level"}, ${place.afterName === null ? "first" : `after ${place.afterName}`}`
    return { setting: `move ${change.name}`, summary: `${where(change.from)} → ${where(change.to)}${unknown}` }
}
