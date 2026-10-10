import type { SuggestionsState, SuggestionsWorkRow } from "@neonflux/contracts/suggestions"
import { isThreadChannel, type Client, type GuildChannel, type GuildForumChannel, type GuildMediaChannel } from "@neontechspace/fluxerly/effect"
import { Data, Effect } from "effect"
import { fluxerlyNext } from "./fluxerly-next.ts"
import { nativeFix, sentenceList } from "./permission-fix.ts"
import { forumType } from "./publishing-permissions.ts"

// A suggestion in a forum or media channel is a post whose first message is its card, with one status tag that follows its state.
// The tags are ordinary tags, so NeonFlux applies them as the post's creator without Manage Threads
export const suggestionTagNames: Record<SuggestionsState, string> = { "under-review": "Under review", planned: "Planned", completed: "Completed", declined: "Declined", withdrawn: "Withdrawn" }
const statusNames = Object.values(suggestionTagNames)
/** Fluxer allows 20 tags per forum, and 5 on one post */
const FORUM_TAGS = 20, POST_TAGS = 5

/** The bot cannot add or apply a status tag. fix is the sentence that says what to change */
export class SuggestionTagError extends Data.TaggedError("SuggestionTagError")<{ readonly fix: string }> {}

type Forum = GuildForumChannel | GuildMediaChannel
export const isForum = (channel: GuildChannel | undefined): channel is Forum => !!channel && forumType(channel.type)
const tagId = (forum: Forum, name: string) => forum.availableTags?.find(tag => tag.name.toLowerCase() === name.toLowerCase())?.id

/** The forum's tag ID for each named status, adding the tags it lacks while the forum has room. Fails with the fix when NeonFlux cannot */
export function ensureSuggestionTags(client: Client, forum: Forum, names: readonly string[] = statusNames) {
    return Effect.gen(function* () {
        let current = forum
        const missing = names.filter(name => !tagId(current, name))
        const yourself = `or add the tags ${sentenceList(missing)} to <#${forum.id}> yourself`
        const excess = (current.availableTags?.length ?? 0) + missing.length - FORUM_TAGS
        if (excess > 0) return yield* Effect.fail(new SuggestionTagError({
            fix: `Remove ${excess} ${excess === 1 ? "tag" : "tags"} from <#${forum.id}> so NeonFlux can add its status tags, ${yourself}` }))
        for (const name of missing) {
            const updated = yield* client.channels.createForumTag(forum.id, { name }, { timeoutMs: 5000 }).pipe(Effect.mapError(error => new SuggestionTagError({
                fix: `${nativeFix(error, forum.id) ?? `Grant Manage Channels to the NeonFlux role and allow it in <#${forum.id}>`}, ${yourself}` })))
            current = updated
        }
        const ids = new Map(names.map(name => [name, tagId(current, name)]))
        if ([...ids.values()].some(id => !id)) return yield* Effect.fail(new SuggestionTagError({ fix: `Add the tags ${sentenceList(missing)} to <#${forum.id}>` }))
        // Only members who can manage threads may apply a moderated tag, and a refused post would leave its outcome unknown
        const moderated = names.filter(name => current.availableTags?.some(tag => tag.id === ids.get(name) && tag.moderated))
        if (moderated.length) return yield* Effect.fail(new SuggestionTagError({ fix: `Turn off moderation for the tags ${sentenceList(moderated)} in <#${forum.id}>` }))
        return ids as Map<string, string>
    })
}

/** The destination as a forum, from the bot's copy or one channel read, or undefined for any other channel */
export function readSuggestionForum(client: Client, channelId: string) {
    const local = fluxerlyNext(client)
    return local.channels.get(channelId).pipe(Effect.flatMap(known => known ? Effect.succeed(known) : local.channels.fetch(channelId, { timeoutMs: 5000 })),
        Effect.map(channel => isForum(channel) ? channel : undefined))
}

/**
 * Prepare a forum card before it is published: The tags a new post starts with, or for an existing post its status tag, set
 * together with reopening an archived post. Other tags on the post stay. A text channel needs nothing
 */
export function prepareSuggestionPost(client: Client, card: SuggestionsWorkRow) {
    return Effect.gen(function* () {
        const forum = yield* readSuggestionForum(client, card.channelId)
        if (!forum) return undefined
        const ids = yield* ensureSuggestionTags(client, forum, [suggestionTagNames[card.suggestionState]])
        const wanted = ids.get(suggestionTagNames[card.suggestionState])!
        if (!card.threadId) return [wanted]
        const thread = yield* client.channels.fetch(card.threadId, { timeoutMs: 5000 })
        if (!isThreadChannel(thread) || thread.parentId !== forum.id) return yield* Effect.fail(new SuggestionTagError({ fix: `Suggestion #${card.suggestionNo}'s post is no longer in <#${forum.id}>` }))
        const status = new Set(statusNames.map(name => tagId(forum, name)).filter(id => id !== undefined))
        const applied = "appliedTagIds" in thread ? thread.appliedTagIds ?? [] : []
        const tags = [wanted, ...applied.filter(id => !status.has(id))].slice(0, POST_TAGS)
        const changed = tags.length !== applied.length || tags.some(id => !applied.includes(id))
        if (changed || thread.archived) yield* client.threads.edit(thread.id, { ...(thread.archived ? { archived: false } : {}), ...(changed ? { appliedTagIds: tags } : {}) }, { timeoutMs: 5000 })
            .pipe(Effect.mapError(error => new SuggestionTagError({ fix: nativeFix(error, forum.id) ?? `Let NeonFlux change the tags of its posts in <#${forum.id}>` })))
        return undefined
    })
}
