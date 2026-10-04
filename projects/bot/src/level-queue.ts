import { Clock, Effect, Queue } from "effect"

export const levelQueueCapacity = 1000
export const levelMaxAgeMs = 600000
export function createLevelQueue<A extends { userId: string, createdAt: number }>() {
    return Effect.gen(function* () {
        const queue = yield* Queue.make<A>({ capacity: levelQueueCapacity, strategy: "dropping" })
        const pending = new Set<string>()
        yield* Effect.addFinalizer(() => Queue.shutdown(queue).pipe(Effect.andThen(Effect.sync(() => pending.clear()))))
        return {
            offer: (candidate: A) => Effect.gen(function* () {
                const now = yield* Clock.currentTimeMillis
                if (candidate.createdAt < now - levelMaxAgeMs || candidate.createdAt > now + 60000
                    || pending.has(candidate.userId) || pending.size >= levelQueueCapacity) return false
                pending.add(candidate.userId)
                const accepted = yield* Queue.offer(queue, candidate)
                if (!accepted) pending.delete(candidate.userId)
                return accepted
            }).pipe(Effect.uninterruptible),
            take: Queue.take(queue),
            release: (candidate: A) => Effect.sync(() => { pending.delete(candidate.userId) }),
            size: () => pending.size,
        }
    })
}
