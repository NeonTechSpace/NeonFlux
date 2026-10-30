import type { ChannelMemberContext } from "@neonflux/contracts/shared"
import { errors, MemberChunkError, type Client, type GuildMember } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Exit, Semaphore, Stream } from "effect"

export class MemberEvidenceError extends Data.TaggedError("MemberEvidenceError")<{ readonly stage: "identity" }> {}

/** A member read from Fluxer. Evaluation passes cached to use the SDK's member cache, which member events and the member Fluxer attaches to messages and reactions keep current, and reads only on a miss */
export function readNativeMember(
    client: Client,
    serverId: string,
    userId: string,
    options: { allowAbsent?: boolean; cached?: boolean; timeoutMs?: number } = {},
) {
    // Capture the exact read target before dispatch
    const target = Object.freeze({ guildId: serverId, userId })
    const fresh = client.members
        .fetch(target, { timeoutMs: options.timeoutMs ?? 5000 })
        .pipe(
            Effect.catch((error) =>
                options.allowAbsent !== false && errors.isNotFound(error, "member")
                    ? Effect.succeed(undefined)
                    : Effect.fail(error),
            ),
        )
    return (
        options.cached
            ? client.members.get(target).pipe(Effect.flatMap((member) => (member ? Effect.succeed(member) : fresh)))
            : fresh
    ).pipe(
        Effect.flatMap((member) =>
            member && (member.guildId !== target.guildId || member.userId !== target.userId)
                ? Effect.fail(new MemberEvidenceError({ stage: "identity" }))
                : Effect.succeed({ originServerId: target.guildId, userId: target.userId, member }),
        ),
    )
}

// The SDK runs one member stream per client at a time, so the reads of every server wait for each other instead of failing as busy
const memberStreams = new WeakMap<Client, Semaphore.Semaphore>()
/** Members as Fluxer showed them, each with when it was read. An ID left out is unknown, and undefined means Fluxer has no such member */
export type NativeMembers = Map<string, { readonly member: GuildMember | undefined; readonly observedAt: number }>
/**
 * Reads many members of a server at once through the gateway, 100 IDs to a request, which Fluxer allows 12 times per bot every 10 seconds.
 * Fluxer leaves out an ID without saying why, and a stream can stop partway, so such an ID is read once more by its own read. Every request,
 * its wait for Fluxer's limit and its timeout fit within budgetMs of the first answer, so no answer gets older than that. Once the budget is
 * used up nothing more is read, and an ID still unread stays unknown, never absent
 */
export function readNativeMembers(client: Client, serverId: string, userIds: Iterable<string>, budgetMs: number) {
    return Effect.gen(function* () {
        const found: NativeMembers = new Map(),
            ids = [...new Set(userIds)],
            unread: string[] = []
        let lock = memberStreams.get(client)
        if (!lock) memberStreams.set(client, (lock = Semaphore.makeUnsafe(1)))
        let oldest: number | undefined
        // What is left of the budget, which starts with the first answer
        const left = Effect.map(Clock.currentTimeMillis, (now) =>
            oldest === undefined ? Infinity : oldest + budgetMs - now,
        )
        // One read keeps the lock for all its requests and their waits for Fluxer's limit, since two reads that took turns would each
        // get half of it and run out of budget. The budget starts with the first answer, so the wait for the lock does not count
        yield* lock.withPermit(
            Effect.gen(function* () {
                batches: for (let start = 0; start < ids.length; start += 100) {
                    const batch = ids.slice(start, start + 100),
                        wanted = new Set(batch)
                    const stream = (timeoutMs: number) =>
                        client.members.iterateChunks(serverId, { userIds: batch }, { timeoutMs }).pipe(
                            Stream.runForEach((chunk) =>
                                Effect.gen(function* () {
                                    const observedAt = yield* Clock.currentTimeMillis
                                    for (const member of chunk.members) {
                                        if (
                                            chunk.guildId !== serverId ||
                                            member.guildId !== serverId ||
                                            !wanted.has(member.userId)
                                        )
                                            return yield* Effect.fail(new MemberEvidenceError({ stage: "identity" }))
                                        found.set(member.userId, { member, observedAt })
                                        oldest ??= observedAt
                                    }
                                }),
                            ),
                        )
                    // The SDK refuses a request over Fluxer's limit before sending it and says when the next one may go. Members a stream
                    // delivered before it stopped stay read, and the rest of its IDs are read one by one
                    for (;;) {
                        const exit = yield* Effect.exit(
                            Effect.flatMap(left, (rest) =>
                                rest <= 0 ? Effect.succeed(false) : stream(Math.min(30000, rest)).pipe(Effect.as(true)),
                            ),
                        )
                        if (Exit.isSuccess(exit)) {
                            if (!exit.value) break batches
                            break
                        }
                        const error = Cause.squash(exit.cause)
                        if (Cause.hasInterrupts(exit.cause) || error instanceof MemberEvidenceError)
                            return yield* Effect.failCause(exit.cause)
                        if (
                            !(error instanceof MemberChunkError) ||
                            error.reason !== "rateLimit" ||
                            error.retryAfterMs === null
                        )
                            break
                        if (error.retryAfterMs >= (yield* left)) break batches
                        yield* Effect.sleep(`${error.retryAfterMs} millis`)
                    }
                    for (const id of batch) if (!found.has(id)) unread.push(id)
                }
            }),
        )
        for (const id of unread) {
            const rest = yield* left
            if (rest <= 0) break
            const read = yield* Effect.exit(
                readNativeMember(client, serverId, id, { timeoutMs: Math.min(5000, Math.ceil(rest)) }),
            )
            if (Exit.isFailure(read)) {
                if (Cause.hasInterrupts(read.cause) || Cause.squash(read.cause) instanceof MemberEvidenceError)
                    return yield* Effect.failCause(read.cause)
                continue
            }
            const observedAt = yield* Clock.currentTimeMillis
            oldest ??= observedAt
            found.set(id, { member: read.value.member, observedAt })
        }
        return found
    })
}

export function memberFacts(
    member: GuildMember,
    serverId: string,
    userId: string,
): Omit<ChannelMemberContext, "canView" | "canReadHistory"> | undefined {
    if (
        member.guildId !== serverId ||
        member.userId !== userId ||
        member.communicationDisabledUntil === undefined ||
        typeof member.joinedAt !== "string" ||
        member.joinedAt.length > 64 ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(member.joinedAt) ||
        !Number.isFinite(Date.parse(member.joinedAt))
    )
        return
    return {
        originServerId: member.guildId,
        userId,
        joinedAt: member.joinedAt,
        roleIds: [...member.roleIds],
        isBot: member.isBot,
        timeoutUntil: member.communicationDisabledUntil,
    }
}
