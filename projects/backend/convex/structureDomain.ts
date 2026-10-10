import {
    StructureLayout,
    movedChannels,
    places,
    structureChanges,
    structureOrdered,
    type StructureApply,
    type StructureChange,
    type StructureChannel,
    type StructureEntry,
    type StructurePlace,
} from "@neonflux/contracts/structure"
import type { StructureItem, StructureOutcome } from "../dashboard-contracts.js"
import { decode, fail } from "./validation.ts"

// The server structure as plain lists, and the three-way merge that both the website's preview and a save use, so a preview
// cannot drift from what a save does. The diff they start from is in the contracts, where the website's live view shares it.
// A structure lists categories and channels in sibling order: top-level entries in order, each category followed by its
// channels. Siblings are the entries with the same parent, so moves name their place by parent and the sibling right before,
// as Fluxer's reorder does

function entries(value: unknown): StructureEntry[] {
    const layout = decode(StructureLayout, value, "Invalid structure")
    if (!structureOrdered(layout)) fail(400, "Invalid structure order")
    return layout
}
/** The website's starting structure and draft. A draft keeps every channel and its type, and changes only names, parents and order */
export function structureDraft(base: unknown, draft: unknown) {
    const before = entries(base),
        after = entries(draft),
        types = new Map(before.map((entry) => [entry.id, entry.type]))
    if (after.length !== before.length || after.some((entry) => types.get(entry.id) !== entry.type))
        fail(400, "The draft must keep every channel")
    return { base: before, draft: after }
}
/**
 * The three-way merge of a draft with the structure it started from and the current one. Each change applies when the current
 * structure still matches the start, is skipped when it already matches the draft and conflicts when another change touched the
 * same name or place. A change to a channel that is gone, or a move into a category that is gone, is blocked, and a change in a
 * channel the manager cannot manage is refused. Applied moves say where to write them, after the nearest earlier draft sibling
 * that will share the new parent
 */
export function structureMerge(
    base: readonly StructureEntry[],
    draft: readonly StructureEntry[],
    current: readonly StructureChannel[],
): Array<StructureItem & { apply?: StructureApply }> {
    const now = new Map(current.map((entry) => [entry.id, entry])),
        here = places(current),
        theirs = movedChannels(base, current)
    const items: Array<StructureItem & { apply?: StructureApply }> = structureChanges(
        base,
        draft,
        (id) => !now.get(id)?.manage,
    ).map((change, index) => {
        const decide = (disposition: StructureItem["disposition"], reason: string | null = null) => ({
            itemNo: index + 1,
            change,
            disposition,
            reason,
        })
        const channel = now.get(change.channelId)
        if (!channel) return decide("blocked", "The channel was deleted, or you can no longer see it")
        if (change.type === "rename") {
            if (channel.name === change.to) return decide("skip", "It already has this name")
            if (!channel.manage) return decide("refused", "You need Manage channels in this channel")
            return channel.name === change.from
                ? decide("apply")
                : decide("conflict", `It was renamed to ${channel.name} since your draft started`)
        }
        if (change.to.parentId !== null && now.get(change.to.parentId)?.type !== "category")
            return decide("blocked", `The category ${change.to.parentName} was deleted, or you can no longer see it`)
        const at = here.get(channel.id)!
        if (at.parentId === change.to.parentId && at.afterId === change.to.afterId)
            return decide("skip", "It is already in this place")
        if (!channel.manage) return decide("refused", "You need Manage channels in this channel")
        return theirs.has(channel.id) ? decide("conflict", "It was moved since your draft started") : decide("apply")
    })
    const moving = new Map(
        items.flatMap((item) =>
            item.disposition === "apply" && item.change.type === "move"
                ? [[item.change.channelId, item.change.to.parentId] as const]
                : [],
        ),
    )
    for (const item of items) {
        if (item.disposition !== "apply") continue
        const change = item.change
        if (change.type === "rename") {
            item.apply = { itemNo: item.itemNo, type: "rename", channelId: change.channelId, name: change.to }
            continue
        }
        const siblings = draft.filter((entry) => entry.parentId === change.to.parentId).map((entry) => entry.id),
            parent = (id: string) => (moving.has(id) ? moving.get(id) : now.get(id)?.parentId)
        const preceding =
            siblings
                .slice(0, siblings.indexOf(change.channelId))
                .reverse()
                .find((id) => now.has(id) && parent(id) === change.to.parentId) ?? null
        item.apply = {
            itemNo: item.itemNo,
            type: "move",
            channelId: change.channelId,
            parentId: change.to.parentId,
            precedingSiblingId: preceding,
        }
    }
    return items
}

/** An audit entry for a change that was applied or may have been, naming channels and never message content */
export function structureAudit(change: StructureChange, outcome: StructureOutcome) {
    const unknown = outcome === "uncertain" ? ", outcome unknown" : ""
    if (change.type === "rename")
        return { setting: `rename ${change.from}`, summary: `name: ${change.from} → ${change.to}${unknown}` }
    const where = (place: StructurePlace) =>
        `${place.parentName ?? "top level"}, ${place.afterName === null ? "first" : `after ${place.afterName}`}`
    return { setting: `move ${change.name}`, summary: `${where(change.from)} → ${where(change.to)}${unknown}` }
}
