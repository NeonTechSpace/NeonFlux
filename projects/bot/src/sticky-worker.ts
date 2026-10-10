import type * as C from "@neonflux/backend/contracts"
import type { Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Context, Effect, Scope, Semaphore } from "effect"
import type { StickyStore } from "./sticky-store.ts"
import { noMentions } from "./responses.ts"
import { readAuthenticatedBotId } from "./safety-permissions.ts"

const loadRetryMs = 60000
/** How many of a channel's newest messages one sweep for unconfirmed sticky copies reads */
export const sweepMessages = 50

export type StickyRuntime = ReturnType<typeof createStickyRuntime>
/** Each running server's sticky runtime, so dashboard changes applied by the bot reach it */
export const stickyRuntimes = new Map<string, StickyRuntime>()

/**
 * Sticky messages for one server. The list is read once at startup and kept in memory, and the bot's own chat and
 * dashboard changes update it, so ordinary messages cost no backend call. A member message in a sticky channel reposts
 * the sticky at once when its interval has passed since the last repost, and otherwise once when it ends. Reposts of
 * one channel run one at a time, and the backend keeps exactly one of two racing copies. Only copies this bot posted are deleted
 */
export function createStickyRuntime(store: StickyStore, serverId: string, allowed: Effect.Effect<boolean>) {
    const stickies = new Map<string, C.StickyMessage>(), locks = new Map<string, Semaphore.Semaphore>()
    const lastPostAt = new Map<string, number>(), scheduled = new Set<string>()
    let loaded = false, lastLoadAt = Number.NEGATIVE_INFINITY
    let client: Client | undefined, scope: Scope.Scope | undefined, services: Context.Context<never> | undefined

    const contained = <A, E, R>(effect: Effect.Effect<A, E, R>, warning: string) => effect.pipe(Effect.asVoid,
        Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.logWarning(warning)))
    const fork = <E, R>(effect: Effect.Effect<void, E, R>, warning: string) => {
        const work = services ? Effect.provideContext(contained(effect, warning), services) : contained(effect, warning)
        return Effect.asVoid(scope ? Effect.forkIn(work, scope) : Effect.forkDetach(work))
    }
    const lock = (channelId: string) => { let found = locks.get(channelId); if (!found) { found = Semaphore.makeUnsafe(1); locks.set(channelId, found) } return found }
    // A message that is already gone counts as deleted
    const deleteCopy = (channelId: string, messageId: string) => contained(client!.messages.delete({ channelId, id: messageId }, { timeoutMs: 5000 }).pipe(
        Effect.catchIf(error => (error as { reason?: unknown }).reason === "notFound", () => Effect.void)), "A previous sticky copy could not be deleted")

    // A send or record that failed may still have left a copy in the channel whose ID NeonFlux never learned, so its text is
    // kept until a sweep reads the channel's newest messages and deletes the bot's own messages with exactly that text
    const unsettled = new Map<string, Set<string>>()
    const unsure = (channelId: string, content: string) => Effect.sync(() => { unsettled.set(channelId, (unsettled.get(channelId) ?? new Set<string>()).add(content)) })
    const sweep = (channelId: string) => Effect.gen(function* () {
        const texts = unsettled.get(channelId)
        if (!texts) return new Set<string>()
        const botId = yield* readAuthenticatedBotId(client!)
        const history = yield* client!.messages.fetchHistory(channelId, { limit: sweepMessages }, { timeoutMs: 5000 })
        unsettled.delete(channelId)
        const copies = history.filter(message => message.author.id === botId && texts.has(message.content)).map(message => message.id)
        for (const id of copies) yield* deleteCopy(channelId, id)
        return new Set(copies)
    }).pipe(Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause)
        : Effect.logWarning("Unconfirmed sticky copies could not be checked. They are checked again before the next repost").pipe(Effect.as(new Set<string>()))))
    // Deletes a sticky's last recorded copy and any unconfirmed ones
    const retire = (channelId: string, messageId: string | null) => lock(channelId).withPermit(Effect.gen(function* () {
        const swept = yield* sweep(channelId)
        if (messageId && !swept.has(messageId)) yield* deleteCopy(channelId, messageId)
    }))

    const load = Effect.gen(function* () {
        lastLoadAt = yield* Clock.currentTimeMillis
        const list = yield* store.list({ serverId })
        stickies.clear()
        for (const sticky of list.stickies) stickies.set(sticky.channelId, sticky)
        loaded = true
    })

    // Removes unconfirmed copies, posts a fresh copy, records it and then deletes the copy before it
    const repost = (channelId: string) => lock(channelId).withPermit(Effect.gen(function* () {
        const sticky = stickies.get(channelId)
        if (!sticky || !client || !(yield* allowed)) return
        lastPostAt.set(channelId, yield* Clock.currentTimeMillis)
        const swept = yield* sweep(channelId)
        const sent = yield* client.messages.send(channelId, { content: sticky.content, allowedMentions: noMentions }, { timeoutMs: 5000 }).pipe(
            Effect.tapError(() => unsure(channelId, sticky.content)))
        // An unknown record may have kept the new copy, so the copy before it stays unconfirmed too
        const recorded = yield* store.posted({ serverId, channelId, revision: sticky.revision, previousMessageId: sticky.messageId, messageId: sent.id }).pipe(
            Effect.tapError(() => unsure(channelId, sticky.content).pipe(Effect.andThen(deleteCopy(channelId, sent.id)))))
        if (!recorded.accepted) {
            // Another repost or a change came first, so this copy goes and the recorded state is kept
            yield* deleteCopy(channelId, sent.id)
            if (recorded.sticky && stickies.has(channelId)) stickies.set(channelId, recorded.sticky)
            else stickies.delete(channelId)
            return
        }
        if (stickies.has(channelId)) stickies.set(channelId, recorded.sticky)
        if (sticky.messageId && !swept.has(sticky.messageId)) yield* deleteCopy(channelId, sticky.messageId)
    }))

    const runtime = {
        serverId,
        start: (native: Client) => Effect.gen(function* () {
            client = native; scope = yield* Effect.scope; services = yield* Effect.context<never>()
            stickyRuntimes.set(serverId, runtime)
            yield* Effect.addFinalizer(() => Effect.sync(() => { if (stickyRuntimes.get(serverId) === runtime) stickyRuntimes.delete(serverId) }))
            yield* contained(load, "Sticky messages could not be loaded. They pause until the backend answers")
        }),
        /** A member's message in a channel. Reposts wait for the interval, so a busy channel gets at most one per interval */
        message: (channelId: string) => Effect.gen(function* () {
            if (!loaded && (yield* Clock.currentTimeMillis) - lastLoadAt >= loadRetryMs) yield* fork(load, "Sticky messages could not be loaded. They pause until the backend answers")
            const sticky = stickies.get(channelId)
            if (!sticky || scheduled.has(channelId)) return
            scheduled.add(channelId)
            const wait = Math.max(0, (lastPostAt.get(channelId) ?? Number.NEGATIVE_INFINITY) + sticky.intervalSeconds * 1000 - (yield* Clock.currentTimeMillis))
            yield* fork(Effect.sleep(wait).pipe(Effect.andThen(Effect.sync(() => { scheduled.delete(channelId) })), Effect.andThen(repost(channelId))), "A sticky message could not be reposted")
        }),
        /** A saved sticky is posted at once, so a new text shows without waiting for the next message. False when that post failed */
        saved: (sticky: C.StickyMessage) => Effect.suspend(() => {
            stickies.set(sticky.channelId, sticky)
            return repost(sticky.channelId).pipe(Effect.as(true), Effect.catchCause(cause => Cause.hasInterrupts(cause) ? Effect.failCause(cause) : Effect.succeed(false)))
        }),
        removed: (sticky: C.StickyMessage) => Effect.gen(function* () {
            stickies.delete(sticky.channelId)
            if (client) yield* retire(sticky.channelId, sticky.messageId)
        }),
        /** After a dashboard change: removed stickies lose their last copy and changed ones are posted again */
        reload: () => contained(Effect.gen(function* () {
            const before = new Map(stickies)
            yield* load
            for (const [channelId, old] of before) if (!stickies.has(channelId)) yield* retire(channelId, old.messageId)
            for (const [channelId, sticky] of stickies) if (before.get(channelId)?.revision !== sticky.revision) yield* contained(repost(channelId), "A sticky message could not be posted")
        }), "Sticky messages could not be refreshed"),
        stickies: () => [...stickies.values()],
    }
    return runtime
}
