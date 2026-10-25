import type { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Deferred, Duration, Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"

type Bot = Effect.Success<ReturnType<typeof createTestBot>>
/** One gateway member request the bot sent, numbered from 0 in the order it was sent */
export type MemberRequest = {
    readonly guildId: string
    readonly userIds: readonly string[]
    readonly nonce: string
    readonly index: number
}
/** One GUILD_MEMBERS_CHUNK reply to a request, the only chunk of its answer unless extra says otherwise */
export const memberChunk = (request: MemberRequest, members: readonly object[], extra: object = {}) => ({
    guild_id: request.guildId,
    members,
    chunk_index: 0,
    chunk_count: 1,
    nonce: request.nonce,
    ...extra,
})
/**
 * Answers the bot's gateway member requests with the chunks answer returns, as Fluxer does. An answer the test holds back is an effect,
 * such as one that waits on a waiting clock. By default every requested member is left out, so the bot reads each by its ID from the test's
 * REST responders. It watches the commands the bot sent until the test's scope closes
 */
export function answerMemberRequests(
    bot: Bot,
    answer: (request: MemberRequest) => readonly object[] | Effect.Effect<readonly object[]> = (request) => [
        memberChunk(request, []),
    ],
) {
    return Effect.gen(function* () {
        let seen = 0
        for (;;) {
            const sent = bot.commands().filter((command) => command.op === 8)
            for (; seen < sent.length; seen++) {
                const d = sent[seen]!.d as { guild_id: string; user_ids: string[]; nonce: string },
                    chunks = answer({ guildId: d.guild_id, userIds: d.user_ids, nonce: d.nonce, index: seen })
                for (const chunk of Effect.isEffect(chunks) ? yield* chunks : chunks)
                    yield* bot.emit("GUILD_MEMBERS_CHUNK", chunk)
            }
            yield* Effect.yieldNow
        }
    }).pipe(Effect.forkScoped)
}

/**
 * Runs works side by side on a clock only the test moves. A work sees the test clock's time, and its sleeps, like the waits of answers the
 * test holds back, wait until every running work waits. Then the test clock moves to the earliest wake, which moves the SDK's own timers
 * too, so every read happens at a time the test fixed however the works interleave. Needs TestClock.layer from before the bot was made
 */
export const waitingClock = TestClock.testClockWith((testClock) =>
    Effect.sync(() => {
        const waits: { readonly at: number; readonly done: Deferred.Deferred<void> }[] = []
        /** Waits ms, counted as the wait of the work that this blocks. A wait that is interrupted, such as a timeout that lost, no longer counts */
        const wait = (ms: number) =>
            Effect.suspend(() => {
                const entry = { at: testClock.currentTimeMillisUnsafe() + ms, done: Deferred.makeUnsafe<void>() }
                waits.push(entry)
                return Deferred.await(entry.done).pipe(
                    Effect.onInterrupt(() =>
                        Effect.sync(() => {
                            const index = waits.indexOf(entry)
                            if (index >= 0) waits.splice(index, 1)
                        }),
                    ),
                )
            })
        const clock: Clock.Clock = {
            currentTimeMillisUnsafe: () => testClock.currentTimeMillisUnsafe(),
            currentTimeMillis: testClock.currentTimeMillis,
            monotonicTimeNanosUnsafe: () => testClock.monotonicTimeNanosUnsafe(),
            monotonicTimeNanos: testClock.monotonicTimeNanos,
            currentTimeNanosUnsafe: () => testClock.currentTimeNanosUnsafe(),
            currentTimeNanos: testClock.currentTimeNanos,
            sleep: (duration) => wait(Duration.toMillis(duration)),
        }
        const run = <A, E>(works: readonly Effect.Effect<A, E>[]) =>
            Effect.gen(function* () {
                let active = works.length
                const fibers: Fiber.Fiber<A, E>[] = []
                for (const work of works)
                    fibers.push(
                        yield* work.pipe(
                            Effect.provideService(Clock.Clock, clock),
                            Effect.ensuring(Effect.sync(() => active--)),
                            Effect.forkChild,
                        ),
                    )
                while (active > 0) {
                    yield* Effect.yieldNow
                    if (!waits.length || waits.length < active) continue
                    const at = Math.min(...waits.map((entry) => entry.at)),
                        now = testClock.currentTimeMillisUnsafe()
                    if (at > now) yield* testClock.adjust(at - now)
                    for (const entry of waits.splice(0).filter((entry) => {
                        if (entry.at > at) return true
                        Deferred.doneUnsafe(entry.done, Effect.void)
                        return false
                    }))
                        waits.push(entry)
                }
                return yield* Fiber.joinAll(fibers)
            })
        return { wait, run, now: () => testClock.currentTimeMillisUnsafe() }
    }),
)
