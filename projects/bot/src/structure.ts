import {
    STRUCTURE_ARCHIVED,
    STRUCTURE_THREADS,
    places,
    threadParents,
    type StructureApply,
    type StructureChannel,
    type StructureChannelType,
    type StructureReadyJob,
    type StructureWriteResult,
} from "@neonflux/contracts/structure"
import { errors, ChannelType, Permissions, type Client, type GuildChannel } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Exit } from "effect"
import { fixSentence, nativeFix } from "./permission-fix.ts"
import { readSafetyAuthority, SafetyPermissionError } from "./safety-permissions.ts"
import type { StructureStore } from "./structure-store.ts"
import { clip } from "./reply-style.ts"

// The website's server structure editor. The bot reads the server for the manager who asked, with its own token, and lists only what
// that manager can see. A save is claimed in the backend before anything is written, and each write that Fluxer does not confirm is
// reported as uncertain and never repeated

const kinds: Partial<Record<string, StructureChannelType>> = {
    [ChannelType.Category]: "category",
    [ChannelType.Text]: "text",
    [ChannelType.Voice]: "voice",
    [ChannelType.Announcement]: "announcement",
    [ChannelType.Forum]: "forum",
    [ChannelType.Media]: "media",
    [ChannelType.Link]: "link",
}
const AUDIT = "NeonFlux structure editor"
const label = (name: string | undefined, id: string) => clip(name?.trim() ? name : id, 100, "")
const has = (bits: bigint, permission: bigint) => (bits & permission) === permission
// Fluxer orders siblings by position, and channels with the same position by ID
const order = (a: GuildChannel, b: GuildChannel) =>
    (a.position ?? 0) - (b.position ?? 0) || (BigInt(a.id) < BigInt(b.id) ? -1 : 1)
/**
 * The server's categories and channels in sibling order, each with its parent, as the read and the backend list them. A backup reads the
 * same order, so its places match what the structure editor shows
 */
export function sorted(channels: readonly GuildChannel[]) {
    const ids = new Set(channels.map((channel) => channel.id))
    const parentOf = (channel: GuildChannel) =>
        channel.type !== ChannelType.Category && channel.parentId && ids.has(channel.parentId) ? channel.parentId : null
    return channels
        .filter((channel) => parentOf(channel) === null)
        .sort(order)
        .flatMap((top) => [top, ...channels.filter((channel) => parentOf(channel) === top.id).sort(order)])
        .map((channel) => ({ channel, parentId: parentOf(channel) }))
}

/**
 * The structure one manager can see: categories and channels they can view, a hidden category only when it holds one they can view,
 * and active threads of those channels. A private thread is listed when the bot can see it and the manager can manage threads in its
 * channel. botManages names the channels the bot may change
 */
export function readStructure(client: Client, serverId: string, userId: string, withThreads = true) {
    return Effect.gen(function* () {
        const { guild, roles, actor, bot } = yield* readSafetyAuthority(client, serverId, userId)
        const all = (yield* client.channels.fetchAll(serverId, { timeoutMs: 5000 })).filter(
            (channel) => channel.guildId === serverId && kinds[channel.type] !== undefined,
        )
        const actorBits = new Map(
            all.map((channel) => [channel.id, client.permissions.calculate({ guild, member: actor, roles, channel })]),
        )
        const sees = (channel: GuildChannel) => has(actorBits.get(channel.id)!, Permissions.ViewChannel)
        const shown = all.filter(
            (channel) =>
                sees(channel) ||
                (channel.type === ChannelType.Category &&
                    all.some((child) => child.parentId === channel.id && sees(child))),
        )
        const channels: StructureChannel[] = sorted(shown).map(({ channel, parentId }) => ({
            id: channel.id,
            type: kinds[channel.type]!,
            name: label(channel.name, channel.id),
            parentId,
            manage: has(actorBits.get(channel.id)!, Permissions.ViewChannel | Permissions.ManageChannels),
        }))
        const botManages = new Set(
            all
                .filter((channel) =>
                    has(
                        client.permissions.calculate({ guild, member: bot, roles, channel }),
                        Permissions.ViewChannel | Permissions.ManageChannels,
                    ),
                )
                .map((channel) => channel.id),
        )
        const parents = new Map(
            channels
                .filter((channel) => threadParents.has(channel.type))
                .map((channel) => [channel.id, has(actorBits.get(channel.id)!, Permissions.ManageThreads)]),
        )
        const threads = withThreads
            ? (yield* client.threads.fetchActive(serverId, { timeoutMs: 5000 })).filter(
                  (thread) =>
                      parents.has(thread.parentId) &&
                      (thread.type !== ChannelType.PrivateThread || parents.get(thread.parentId)),
              )
            : []
        return {
            read: {
                channels,
                threadsTruncated: threads.length > STRUCTURE_THREADS,
                threads: threads.slice(0, STRUCTURE_THREADS).map((thread) => ({
                    id: thread.id,
                    parentId: thread.parentId,
                    name: label(thread.name, thread.id),
                    private: thread.type === ChannelType.PrivateThread,
                    archived: thread.archived,
                })),
            },
            botManages,
        }
    })
}

/** One page of a channel's closed threads, newest archived first. Private ones need Manage threads for both the bot and the manager */
export function readClosedThreads(client: Client, serverId: string, userId: string, channelId: string) {
    return Effect.gen(function* () {
        const { guild, roles, actor, bot } = yield* readSafetyAuthority(client, serverId, userId)
        const channel = yield* client.channels.fetch(channelId, { timeoutMs: 5000 })
        const actorBits =
            channel.guildId === serverId ? client.permissions.calculate({ guild, member: actor, roles, channel }) : 0n
        if (!has(actorBits, Permissions.ViewChannel) || !threadParents.has(kinds[channel.type] ?? ""))
            return { channelId, threads: [], more: false }
        const pages = [
            yield* client.threads.fetchArchived(
                channelId,
                { scope: "public", limit: STRUCTURE_ARCHIVED },
                { timeoutMs: 5000 },
            ),
        ]
        if (
            channel.type === ChannelType.Text &&
            has(actorBits, Permissions.ManageThreads) &&
            has(client.permissions.calculate({ guild, member: bot, roles, channel }), Permissions.ManageThreads)
        ) {
            pages.push(
                yield* client.threads.fetchArchived(
                    channelId,
                    { scope: "private", limit: STRUCTURE_ARCHIVED },
                    { timeoutMs: 5000 },
                ),
            )
        }
        const threads = pages
            .flatMap((page) => page.threads)
            .filter((thread) => thread.parentId === channelId)
            .sort((a, b) => b.archiveTimestamp.localeCompare(a.archiveTimestamp))
        return {
            channelId,
            threads: threads.slice(0, STRUCTURE_ARCHIVED).map((thread) => ({
                id: thread.id,
                parentId: channelId,
                name: label(thread.name, thread.id),
                private: thread.type === ChannelType.PrivateThread,
                archived: true,
            })),
            more: threads.length > STRUCTURE_ARCHIVED || pages.some((page) => page.hasMore),
        }
    })
}

const errorOf = (exit: Exit.Exit<unknown, unknown>) =>
    Exit.isFailure(exit) ? exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error : undefined
const UNCONFIRMED = "Fluxer did not confirm this change. Check the server before saving it again"
// A write that never left, or that Fluxer refused, changed nothing. Anything else may have changed the server
function written(
    exit: Exit.Exit<unknown, unknown>,
    itemNo: number,
    channelId: string,
    refusal: string,
): StructureWriteResult {
    if (Exit.isSuccess(exit)) return { itemNo, outcome: "applied" }
    const outcome = errors.outcome(exit.cause)
    if (outcome === "notDispatched" || outcome === "rejected")
        return { itemNo, outcome: "failed", reason: nativeFix(errorOf(exit), channelId) ?? refusal }
    return { itemNo, outcome: "uncertain", reason: UNCONFIRMED }
}

/**
 * Writes a claimed save: renames one at a time, then every move in one reorder, which Fluxer applies in order. A refused reorder may
 * have moved some channels, so the bot reads the channels again and reports each move by where it is
 */
export function applyStructure(
    client: Client,
    serverId: string,
    claim: { applyUntil: number; apply: readonly StructureApply[] },
    botManages: ReadonlySet<string>,
) {
    return Effect.gen(function* () {
        const results: StructureWriteResult[] = []
        const budget = Effect.map(Clock.currentTimeMillis, (now) => Math.min(5000, claim.applyUntil - now))
        const allowed = (write: StructureApply) => {
            if (botManages.has(write.channelId)) return true
            results.push({
                itemNo: write.itemNo,
                outcome: "failed",
                reason: fixSentence({ permissions: ["ManageChannels"], channelId: write.channelId }),
            })
            return false
        }
        const late = (write: StructureApply) =>
            results.push({
                itemNo: write.itemNo,
                outcome: "failed",
                reason: "The save ran out of time before this change. Save it again",
            })
        for (const write of claim.apply) {
            if (write.type !== "rename" || !allowed(write)) continue
            const timeoutMs = yield* budget
            if (timeoutMs <= 0) {
                late(write)
                continue
            }
            results.push(
                written(
                    yield* Effect.exit(
                        client.channels.edit(write.channelId, { name: write.name }, { timeoutMs, auditReason: AUDIT }),
                    ),
                    write.itemNo,
                    write.channelId,
                    "Fluxer refused the new name",
                ),
            )
        }
        const moves = claim.apply.filter(
            (write): write is Extract<StructureApply, { type: "move" }> => write.type === "move" && allowed(write),
        )
        if (!moves.length) return results
        const timeoutMs = yield* budget
        if (timeoutMs <= 0) {
            moves.forEach(late)
            return results
        }
        const exit = yield* Effect.exit(
            client.channels.reorder(
                serverId,
                moves.map((write) => ({
                    id: write.channelId,
                    parentId: write.parentId,
                    precedingSiblingId: write.precedingSiblingId,
                })),
                { timeoutMs, auditReason: AUDIT },
            ),
        )
        if (!Exit.isFailure(exit) || errors.outcome(exit.cause) !== "rejected") {
            results.push(
                ...moves.map((write) => written(exit, write.itemNo, write.channelId, "Fluxer refused the move")),
            )
            return results
        }
        const observed = yield* Effect.exit(client.channels.fetchAll(serverId, { timeoutMs: 5000 }))
        const at = Exit.isSuccess(observed)
            ? places(
                  sorted(
                      observed.value.filter(
                          (channel) => channel.guildId === serverId && kinds[channel.type] !== undefined,
                      ),
                  ).map(({ channel, parentId }) => ({ id: channel.id, parentId })),
              )
            : undefined
        for (const write of moves) {
            const place = at?.get(write.channelId)
            results.push(
                !at
                    ? { itemNo: write.itemNo, outcome: "uncertain", reason: UNCONFIRMED }
                    : place?.parentId === write.parentId && place.afterId === write.precedingSiblingId
                      ? { itemNo: write.itemNo, outcome: "applied" }
                      : written(exit, write.itemNo, write.channelId, "Fluxer refused the move"),
            )
        }
        return results
    })
}

// A manager who left the server cannot be read
const answerFailure = (cause: Cause.Cause<unknown>) =>
    cause.reasons.some(
        (reason) =>
            reason._tag === "Fail" &&
            reason.error instanceof SafetyPermissionError &&
            reason.error.operation === "actor" &&
            reason.error.notFound,
    )
        ? ("access" as const)
        : ("error" as const)
function runJob(store: StructureStore, serverId: string, client: Client, job: StructureReadyJob) {
    return Effect.gen(function* () {
        if (job.work.type === "read") {
            yield* store.answer(serverId, job, { read: (yield* readStructure(client, serverId, job.userId)).read })
            return
        }
        if (job.work.type === "threads") {
            yield* store.answer(serverId, job, {
                threads: yield* readClosedThreads(client, serverId, job.userId, job.work.channelId),
            })
            return
        }
        const { read, botManages } = yield* readStructure(client, serverId, job.userId, false)
        const claim = yield* store.claim(serverId, job, read.channels)
        // Another pass or a lost answer may already hold the claim, so nothing is written twice
        if (!claim.claimed) return
        yield* store.record(serverId, job, yield* applyStructure(client, serverId, claim, botManages))
    }).pipe(
        Effect.catchCause((cause) =>
            Cause.hasInterrupts(cause)
                ? Effect.failCause(cause)
                : // A save that was claimed no longer waits, so the backend drops this answer and the save turns uncertain unless recorded
                  store.answer(serverId, job, { failure: answerFailure(cause) }).pipe(Effect.catch(() => Effect.void)),
        ),
    )
}
/** The structure editor's waiting requests for this server, each answered with the bot's own reads */
export function processStructurePass(store: StructureStore, serverId: string, client: Client) {
    return Effect.gen(function* () {
        for (const job of (yield* store.ready(serverId)).jobs) yield* runJob(store, serverId, client, job)
    })
}
