import type { SuggestionsCardIndexEntry } from "@neonflux/contracts/suggestions"
import type { Client, MessageReference, ReactionEmoji } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Effect, Exit } from "effect"
import { panelIndexTtlMs } from "./role-panel-index.ts"
import { targetedReactionPresent } from "./role-permissions.ts"
import { withRoleMember } from "./roles.ts"
import { readAuthenticatedBotId } from "./safety-permissions.ts"
import { readSuggestionParticipant } from "./suggestion-permissions.ts"
import { SuggestionsStoreError, type SuggestionsStore } from "./suggestion-store.ts"
import { SuggestionsHandlingError } from "./suggestions.ts"

/** The two reactions a card offers. Any other emoji on a card is no vote */
export const suggestionEmojis = { up: "👍", down: "👎" } as const
type Choice = keyof typeof suggestionEmojis
const choiceOf = (emoji: ReactionEmoji): Choice | undefined =>
    emoji.id !== undefined ? undefined : emoji.name === "👍" ? "up" : emoji.name === "👎" ? "down" : undefined
const other = (choice: Choice): Choice => (choice === "up" ? "down" : "up")
/** A recount run counts at most 100 reactors whose vote differs, and next goes on where it stopped */
export const SUGGESTION_RECOUNT_REACTORS = 100
/** Where a recount goes on: The emoji it reads, the last reactor of it already handled, when the recount began and what its runs counted so far */
export type SuggestionRecountPosition = {
    choice: Choice
    after?: string
    startedAt: number
    added: number
    cleared: number
    evaluated: number
}

// The posted cards of one server's open suggestions, learned from the backend and kept as long as the role panel list.
// A 👍 or 👎 on any other message then needs no member or backend read. A newly sent card or a staff change forgets it
type CardIndex = { cards?: Map<string, SuggestionsCardIndexEntry>; learnedAt: number; generation: number }
const indexes = new WeakMap<Client, Map<string, CardIndex>>()
function cardIndex(client: Client, serverId: string) {
    let servers = indexes.get(client)
    if (!servers) indexes.set(client, (servers = new Map()))
    let index = servers.get(serverId)
    if (!index) servers.set(serverId, (index = { learnedAt: 0, generation: 0 }))
    return index
}
/** Forgets the learned cards, so the next vote reaction reads them again */
export function forgetSuggestionCards(client: Client, serverId: string) {
    const index = cardIndex(client, serverId)
    delete index.cards
    index.generation++
}
function findCard(store: SuggestionsStore, client: Client, serverId: string, messageId: string) {
    return Effect.gen(function* () {
        const index = cardIndex(client, serverId),
            now = yield* Clock.currentTimeMillis
        if (index.cards && now - index.learnedAt < panelIndexTtlMs) return index.cards.get(messageId)
        const started = index.generation
        const cards = new Map<string, SuggestionsCardIndexEntry>()
        let cursor: string | undefined
        do {
            const found = yield* store.work({
                serverId,
                operation: { type: "card-index", ...(cursor ? { cursor } : {}) },
            })
            if (found.type !== "card-index")
                return yield* Effect.fail(new SuggestionsHandlingError({ stage: "response" }))
            for (const card of found.cards) cards.set(card.messageId, card)
            cursor = found.cursor
        } while (cursor)
        if (started === index.generation) {
            index.cards = cards
            index.learnedAt = now
        }
        return cards.get(messageId)
    })
}

/** Adds the bot's 👍 and 👎 to a card. A failure leaves the card as it is, since members can still react or vote by command */
export function seedSuggestionReactions(client: Client, message: MessageReference) {
    return Effect.forEach(
        [suggestionEmojis.up, suggestionEmojis.down],
        (emoji) => client.messages.addReaction(message, emoji).pipe(Effect.catch(() => Effect.void)),
        { discard: true },
    )
}

/**
 * Reads which of 👍 and 👎 the member holds on the card now and votes for it, one vote of the member at a time. A vote changes no role, so
 * its line is apart from the member's role work and never waits for an autorole pass. added names the reaction that was just added: When
 * the member holds both, that one becomes the vote and the bot removes the other once. A removal or a recount while both are held changes
 * nothing. A definitive refusal of an added reaction removes it once. Answers whether a vote was written
 */
function applyCardReactions(
    store: SuggestionsStore,
    serverId: string,
    client: Client,
    card: SuggestionsCardIndexEntry,
    userId: string,
    added?: Choice,
) {
    return withRoleMember(
        client,
        userId,
        Effect.gen(function* () {
            if (userId === (yield* readAuthenticatedBotId(client))) return false
            const message = { id: card.messageId, channelId: card.cardChannelId }
            const up = yield* targetedReactionPresent(client, message, suggestionEmojis.up, userId),
                down = yield* targetedReactionPresent(client, message, suggestionEmojis.down, userId)
            if (up && down && !added) return false
            const choice = up && down ? added! : up ? "up" : down ? "down" : "clear"
            const refuse =
                added && choice === added
                    ? client.messages.removeUserReaction(message, suggestionEmojis[added], userId).pipe(
                          Effect.catch(() => Effect.void),
                          Effect.as(false),
                      )
                    : Effect.succeed(false)
            // Exactly the command's checks, read from the bot's cached copies like a role panel reaction
            const context = yield* readSuggestionParticipant(
                client,
                serverId,
                userId,
                card.channelId,
                false,
                false,
                true,
            )
            const result = yield* store
                .reaction({ serverId, context, channelId: card.cardChannelId, messageId: card.messageId, choice })
                .pipe(
                    Effect.catch((error) =>
                        error instanceof SuggestionsStoreError && (error.status === 403 || error.status === 429)
                            ? refuse
                            : Effect.fail(error),
                    ),
                )
            if (typeof result === "boolean") return false
            if (result.type === "not-card") {
                forgetSuggestionCards(client, serverId)
                return false
            }
            if (result.accepted && up && down && added)
                yield* client.messages
                    .removeUserReaction(message, suggestionEmojis[other(added)], userId)
                    .pipe(Effect.catch(() => Effect.void))
            return result.accepted
        }).pipe(
            // A member the bot may not count, such as one who can no longer see the channel, loses an added reaction
            Effect.catchTag("SuggestionsPermissionError", () =>
                added
                    ? client.messages
                          .removeUserReaction(
                              { id: card.messageId, channelId: card.cardChannelId },
                              suggestionEmojis[added],
                              userId,
                          )
                          .pipe(
                              Effect.catch(() => Effect.void),
                              Effect.as(false),
                          )
                    : Effect.succeed(false),
            ),
        ),
        `suggestions:${serverId}`,
    )
}

/** A 👍 or 👎 added or removed on a message. Only a card in the learned index costs any read */
export function handleSuggestionReaction(
    store: SuggestionsStore,
    serverId: string,
    client: Client,
    event: MessageReference & { guildId?: string; userId: string; emoji: ReactionEmoji },
    added: boolean,
) {
    return Effect.gen(function* () {
        const choice = choiceOf(event.emoji)
        if (!choice || (event.guildId !== undefined && event.guildId !== serverId)) return
        const card = yield* findCard(store, client, serverId, event.id)
        if (!card || card.cardChannelId !== event.channelId) return
        yield* applyCardReactions(store, serverId, client, card, event.userId, added ? choice : undefined)
    })
}

/** Every reaction, or every reaction of one emoji, was cleared from a message. On a card the reaction votes it held clear, and the bot adds its own two again */
export function handleSuggestionReactionsCleared(
    store: SuggestionsStore,
    serverId: string,
    client: Client,
    event: MessageReference & { guildId?: string; emoji?: ReactionEmoji },
) {
    return Effect.gen(function* () {
        const choice = event.emoji ? choiceOf(event.emoji) : "all"
        if (!choice || (event.guildId !== undefined && event.guildId !== serverId)) return
        const card = yield* findCard(store, client, serverId, event.id)
        if (!card || card.cardChannelId !== event.channelId) return
        const observedAt = yield* Clock.currentTimeMillis
        let cursor: string | undefined
        do {
            const done = yield* store.work({
                serverId,
                operation: {
                    type: "reactions-cleared",
                    channelId: card.cardChannelId,
                    messageId: card.messageId,
                    choice,
                    observedAt,
                    ...(cursor ? { cursor } : {}),
                },
            })
            cursor = done.type === "progress" ? done.cursor : undefined
        } while (cursor)
        yield* seedSuggestionReactions(client, { id: card.messageId, channelId: card.cardChannelId })
    })
}

/**
 * Makes a card's reaction votes match its reactions: The bot adds its own two, reads everyone holding 👍 and then 👎 a
 * page of 100 at a time and counts the reactors whose vote differs. Once an emoji is read to the end, reaction votes for
 * it that no page confirmed since the recount began are cleared. A command vote stays until its member changes a
 * reaction. A run stops after 100 counted reactors and answers next, where another run goes on, so a reactor that
 * cannot be counted is not tried again in the same recount
 */
export function recountSuggestion(
    store: SuggestionsStore,
    serverId: string,
    client: Client,
    card: SuggestionsCardIndexEntry,
    position?: SuggestionRecountPosition,
) {
    return Effect.gen(function* () {
        const message = { id: card.messageId, channelId: card.cardChannelId }
        yield* seedSuggestionReactions(client, message)
        const startedAt = position?.startedAt ?? (yield* Clock.currentTimeMillis)
        // The totals carry over from earlier runs, so the last run answers for the whole recount. run counts this run's reactors
        let choice = position?.choice ?? "up",
            after = position?.after,
            added = position?.added ?? 0,
            cleared = position?.cleared ?? 0,
            evaluated = position?.evaluated ?? 0,
            run = 0
        for (;;) {
            const found = yield* client.messages.fetchReactionUsers(
                message,
                suggestionEmojis[choice],
                { limit: 100, ...(after ? { after } : {}) },
                { timeoutMs: 5000 },
            )
            const present = found.items.flatMap((user) => (user.isBot ? [] : [user.id]))
            if (present.length) {
                const synced = yield* store.work({
                    serverId,
                    operation: {
                        type: "reaction-sync",
                        suggestionNo: card.suggestionNo,
                        choice,
                        present,
                        observedAt: yield* Clock.currentTimeMillis,
                    },
                })
                if (synced.type !== "reaction-sync")
                    return yield* Effect.fail(new SuggestionsHandlingError({ stage: "response" }))
                for (const userId of synced.differing) {
                    if (run === SUGGESTION_RECOUNT_REACTORS)
                        return {
                            added,
                            cleared,
                            evaluated,
                            next: { choice, after, startedAt, added, cleared, evaluated },
                        }
                    // A reactor who left or cannot be read is skipped, and the rest are still counted
                    const counted = yield* Effect.exit(applyCardReactions(store, serverId, client, card, userId))
                    if (Exit.isFailure(counted) && Cause.hasInterrupts(counted.cause))
                        return yield* Effect.failCause(counted.cause)
                    if (Exit.isSuccess(counted) && counted.value) added++
                    evaluated++
                    run++
                    // Fluxer lists reactors in ID order, so the next run reads on after the last one handled
                    after = userId
                }
            }
            if (found.hasMore && found.nextAfter) {
                after = found.nextAfter
                continue
            }
            let cursor: string | undefined
            do {
                const swept = yield* store.work({
                    serverId,
                    operation: {
                        type: "reaction-sweep",
                        suggestionNo: card.suggestionNo,
                        choice,
                        before: startedAt,
                        ...(cursor ? { cursor } : {}),
                    },
                })
                if (swept.type !== "reaction-sweep")
                    return yield* Effect.fail(new SuggestionsHandlingError({ stage: "response" }))
                cleared += swept.cleared
                cursor = swept.cursor
            } while (cursor)
            if (choice === "down") return { added, cleared, evaluated }
            choice = "down"
            after = undefined
        }
    })
}
