import { Schema } from "effect"
import { Id, Int, List, Millis, STRUCTURE_CHANNELS, Str, origin } from "./common.ts"

// The server structure editor's requests between the bot and the backend, see docs/BACKEND.md#server-structure-editor

export const STRUCTURE_THREADS = 1000
export const STRUCTURE_ARCHIVED = 100
/** Changes one save may make */
export const STRUCTURE_CHANGES = 100
/** Waiting requests the bot answers in one pass */
export const STRUCTURE_JOBS = 10
/** Channel kinds the structure editor shows. Threads are listed apart, as children of their channel */
export const StructureChannelType = Schema.Literals([
    "category",
    "text",
    "voice",
    "announcement",
    "forum",
    "media",
    "link",
])
export type StructureChannelType = typeof StructureChannelType.Type
/** Channel types that hold threads */
export const threadParents = new Set<string>([
    "text",
    "announcement",
    "forum",
    "media",
] satisfies StructureChannelType[])
const name = Str(100).check(Schema.makeFilter((value: string) => value.trim() !== ""))
const unique = (items: ReadonlyArray<{ readonly id: string }>) =>
    new Set(items.map((item) => item.id)).size === items.length

/** A category or channel. A structure lists them in sibling order: top-level entries by position, each category followed by its channels. parentId is null at the top level */
export const StructureEntry = Schema.Struct({ id: Id, type: StructureChannelType, name, parentId: Schema.NullOr(Id) })
export type StructureEntry = typeof StructureEntry.Type
/** A channel as the bot read it for one manager, who can see it. manage is whether that manager has Manage channels in it */
export const StructureChannel = Schema.Struct({ ...StructureEntry.fields, manage: Schema.Boolean })
export type StructureChannel = typeof StructureChannel.Type
/** Whether a structure keeps sibling order: a top-level entry starts a run, and only a category's own channels may follow it before the next top-level entry */
export function structureOrdered(entries: readonly StructureEntry[]) {
    let category: string | null = null
    return entries.every(({ id, type, parentId }) => {
        if (parentId === null) {
            category = type === "category" ? id : null
            return true
        }
        return type !== "category" && parentId === category
    })
}
/** The website's starting structure or draft, whose sibling order the backend checks apart */
export const StructureLayout = List(StructureEntry, STRUCTURE_CHANNELS).check(Schema.makeFilter(unique))
export type StructureLayout = typeof StructureLayout.Type
/** A structure as the bot read it for one manager */
export const StructureChannels = List(StructureChannel, STRUCTURE_CHANNELS).check(
    Schema.makeFilter((value) => unique(value) && structureOrdered(value)),
)
export type StructureChannels = typeof StructureChannels.Type
/** A thread under its channel. Private threads are listed only when the bot can see them and the manager can manage threads in the channel */
export const StructureThread = Schema.Struct({
    id: Id,
    parentId: Id,
    name,
    private: Schema.Boolean,
    archived: Schema.Boolean,
})
export type StructureThread = typeof StructureThread.Type
const read = {
    channels: StructureChannels,
    threads: List(StructureThread, STRUCTURE_THREADS),
    threadsTruncated: Schema.Boolean,
}
// Each thread is listed once, under a channel of the read that holds threads
const threadsUnder = Schema.makeFilter(
    (value: { readonly channels: readonly StructureChannel[]; readonly threads: readonly StructureThread[] }) => {
        const holders = new Set(
            value.channels.filter((channel) => threadParents.has(channel.type)).map((channel) => channel.id),
        )
        return unique(value.threads) && value.threads.every((thread) => holders.has(thread.parentId))
    },
)
/** One read of the server for one manager. threadsTruncated is true when the server had more active threads than are listed */
export type StructureRead = StructureReadAnswer & { readonly readAt: number }
/** A read as the bot answers it. The backend adds readAt */
export const StructureReadAnswer = Schema.Struct(read).check(threadsUnder)
export type StructureReadAnswer = typeof StructureReadAnswer.Type
/** One page of a channel's closed threads */
export const StructureThreadPage = Schema.Struct({
    channelId: Id,
    threads: List(StructureThread, STRUCTURE_ARCHIVED),
    more: Schema.Boolean,
}).check(
    Schema.makeFilter(
        (page) => unique(page.threads) && page.threads.every((thread) => thread.parentId === page.channelId),
    ),
)
export type StructureThreadPage = typeof StructureThreadPage.Type

export const StructureWork = Schema.Union([
    Schema.Struct({ type: Schema.Literal("read") }),
    Schema.Struct({ type: Schema.Literal("threads"), channelId: Id }),
    Schema.Struct({ type: Schema.Literal("save") }),
])
export type StructureWork = typeof StructureWork.Type
/** A waiting request for the bot */
export const StructureReadyJob = Schema.Struct({ userId: Id, requestedAt: Millis, work: StructureWork })
export type StructureReadyJob = typeof StructureReadyJob.Type
export const StructureReadyRequest = Schema.Struct({ serverId: Id })
export type StructureReadyRequest = typeof StructureReadyRequest.Type
export const StructureReadyResult = Schema.Struct({ jobs: List(StructureReadyJob, STRUCTURE_JOBS) })
export type StructureReadyResult = typeof StructureReadyResult.Type

// The waiting request a bot request answers
const job = { serverId: Id, userId: Id, requestedAt: Millis }
/**
 * A read or a closed thread page for a waiting request, or why the bot could not answer it: access when the manager is no longer a
 * member and error when a Fluxer read failed. Facts about what the manager can see must name this server in originServerId
 */
export const StructureAnswerRequest = Schema.Union([
    Schema.Struct({ ...origin, ...job, work: Schema.Literal("read"), read: StructureReadAnswer }),
    Schema.Struct({ ...origin, ...job, work: Schema.Literal("threads"), threads: StructureThreadPage }),
    Schema.Struct({
        ...job,
        work: Schema.Literals(["read", "threads", "save"]),
        failure: Schema.Literals(["access", "error"]),
    }),
])
export type StructureAnswerRequest = typeof StructureAnswerRequest.Type
/** recorded is false for a request that no longer waits */
export const StructureAnswerResult = Schema.Struct({ recorded: Schema.Boolean })
export type StructureAnswerResult = typeof StructureAnswerResult.Type
/** The bot claims a waiting save with the structure it just read for the manager */
export const StructureClaimRequest = Schema.Struct({ ...origin, ...job, current: StructureChannels })
export type StructureClaimRequest = typeof StructureClaimRequest.Type
/** What a claimed save asks the bot to write, in order: a rename, or a move into parentId right after precedingSiblingId */
export const StructureApply = Schema.Union([
    Schema.Struct({ itemNo: Int(), type: Schema.Literal("rename"), channelId: Id, name: Str(100) }),
    Schema.Struct({
        itemNo: Int(),
        type: Schema.Literal("move"),
        channelId: Id,
        parentId: Schema.NullOr(Id),
        precedingSiblingId: Schema.NullOr(Id),
    }),
])
export type StructureApply = typeof StructureApply.Type
/** claimed is false when the save is gone or another claim took it. The bot writes nothing after applyUntil */
export const StructureClaim = Schema.Struct({
    claimed: Schema.Boolean,
    applyUntil: Millis,
    apply: List(StructureApply, STRUCTURE_CHANGES),
})
export type StructureClaim = typeof StructureClaim.Type
/** The outcome of one change the bot was asked to write. failed changed nothing, and uncertain may have changed the server */
export const StructureWriteResult = Schema.Struct({
    itemNo: Int(1, STRUCTURE_CHANGES),
    outcome: Schema.Literals(["applied", "failed", "uncertain"]),
    reason: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300))),
})
export type StructureWriteResult = typeof StructureWriteResult.Type
/** The outcome of every change of a claimed save */
export const StructureRecordRequest = Schema.Struct({ ...job, results: List(StructureWriteResult, STRUCTURE_CHANGES) })
export type StructureRecordRequest = typeof StructureRecordRequest.Type
export const StructureRecordResult = Schema.Struct({ recorded: Schema.Boolean })
export type StructureRecordResult = typeof StructureRecordResult.Type
/** A channel was created, changed, deleted or reordered */
export const StructureChangedRequest = Schema.Struct({ serverId: Id })
export type StructureChangedRequest = typeof StructureChangedRequest.Type
/** How many editors' reads were marked out of date */
export const StructureChangedResult = Schema.Struct({ marked: Int() })
export type StructureChangedResult = typeof StructureChangedResult.Type

// What a draft changes, worked out the same way for the website's live view, the backend's preview and a save, so they cannot drift

/** A place in the structure: the category, or null for the top level, and the sibling right before, or null for first */
export interface StructurePlace {
    parentId: string | null
    parentName: string | null
    afterId: string | null
    afterName: string | null
}
/** One change a draft makes to the structure it started from. Names come from that structure and the draft, so a change describes itself */
export type StructureChange =
    | { type: "rename"; channelId: string; from: string; to: string }
    | { type: "move"; channelId: string; name: string; from: StructurePlace; to: StructurePlace }
/** Each entry's parent and the sibling right before it */
export function places(layout: readonly Pick<StructureEntry, "id" | "parentId">[]) {
    const out = new Map<string, { parentId: string | null; afterId: string | null }>(),
        last = new Map<string | null, string>()
    for (const entry of layout) {
        out.set(entry.id, { parentId: entry.parentId, afterId: last.get(entry.parentId) ?? null })
        last.set(entry.parentId, entry.id)
    }
    return out
}
/** Positions of one increasing run with the most weight, earliest first on ties */
function heaviestIncreasing(values: readonly number[], weight: (index: number) => number) {
    const score = values.map((_, i) => weight(i)),
        previous = values.map(() => -1)
    let best = -1
    values.forEach((value, i) => {
        for (let j = 0; j < i; j++)
            if (values[j]! < value && score[j]! + weight(i) > score[i]!) {
                score[i] = score[j]! + weight(i)
                previous[i] = j
            }
        if (best < 0 || score[i]! > score[best]!) best = i
    })
    const keep = new Set<number>()
    for (let i = best; i >= 0; i = previous[i]!) keep.add(i)
    return keep
}
/**
 * The channels that other moved relative to base: those with another parent, and within each parent the fewest channels whose
 * moves explain the new order. Among equally few, the moved ones are channels the manager can change, so a channel moved up past
 * a fixed one is the one that moved. Channels that exist in only one of the two are neither moved nor in the way
 */
export function movedChannels(
    base: readonly Pick<StructureEntry, "id" | "parentId">[],
    other: readonly Pick<StructureEntry, "id" | "parentId">[],
    fixed: (id: string) => boolean = () => false,
) {
    const before = new Map(base.map((entry, index) => [entry.id, { entry, index }])),
        moved = new Set<string>(),
        groups = new Map<string | null, string[]>()
    for (const entry of other) {
        const was = before.get(entry.id)
        if (!was) continue
        if (was.entry.parentId !== entry.parentId) moved.add(entry.id)
        else groups.set(entry.parentId, [...(groups.get(entry.parentId) ?? []), entry.id])
    }
    for (const ids of groups.values()) {
        // One more kept channel outweighs every fixed one kept, so the run stays as long as it can be
        const keep = heaviestIncreasing(
            ids.map((id) => before.get(id)!.index),
            (index) => ids.length + 1 + (fixed(ids[index]!) ? 1 : 0),
        )
        ids.forEach((id, index) => {
            if (!keep.has(index)) moved.add(id)
        })
    }
    return moved
}
/**
 * What a draft changes, in the draft's order: a rename when the name differs and a move when the channel moved. fixed names the
 * channels the manager cannot change, which a move is not blamed on when another channel explains it as well
 */
export function structureChanges(
    base: readonly StructureEntry[],
    draft: readonly StructureEntry[],
    fixed?: (id: string) => boolean,
): StructureChange[] {
    const before = new Map(base.map((entry) => [entry.id, entry])),
        after = new Map(draft.map((entry) => [entry.id, entry]))
    const from = places(base),
        to = places(draft),
        moved = movedChannels(base, draft, fixed)
    const place = (
        names: Map<string, StructureEntry>,
        at: { parentId: string | null; afterId: string | null },
    ): StructurePlace => ({
        ...at,
        parentName: at.parentId === null ? null : names.get(at.parentId)!.name,
        afterName: at.afterId === null ? null : names.get(at.afterId)!.name,
    })
    const changes: StructureChange[] = []
    for (const entry of draft) {
        const old = before.get(entry.id)!
        if (old.name !== entry.name)
            changes.push({ type: "rename", channelId: entry.id, from: old.name, to: entry.name })
        if (moved.has(entry.id))
            changes.push({
                type: "move",
                channelId: entry.id,
                name: entry.name,
                from: place(before, from.get(entry.id)!),
                to: place(after, to.get(entry.id)!),
            })
    }
    return changes
}
