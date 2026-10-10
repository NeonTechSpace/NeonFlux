import type * as C from "@neonflux/backend/contracts"
import { format, MessageOperationError, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { suggestionHelp, suggestionPublic, suggestionCritical, type SuggestionCommand } from "./suggestion-command.ts"
import { SuggestionsStoreError, type SuggestionsStore } from "./suggestion-store.ts"
import { readSuggestionParticipant, readSuggestionDestination } from "./suggestion-permissions.ts"
import { SuggestionsHandlingError } from "./suggestions.ts"
import { ensureSuggestionTags, readSuggestionForum } from "./suggestion-forum.ts"
import { readChannelParent, readCommandChannel } from "./fluxerly-next.ts"
import { publishingMessageContent } from "./publishing-content.ts"
import { verifyPublishingMessage } from "./publishing-permissions.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { sourceTimestamp } from "./responses.ts"
import { ago, code, onOff, replyCard, replyText, usage, type Card } from "./reply-style.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"

export const stateNames: Record<C.SuggestionsState, string> = { "under-review": "Under review", planned: "Planned", completed: "Completed", declined: "Declined", withdrawn: "Withdrawn" }
const votes = (s: C.SuggestionsDefinition) => `${s.up} up, ${s.down} down`
/** Where the public card stands, in words. A forum destination gives each suggestion its own post */
const cardStatus = (s: C.SuggestionsDefinition, prefix: string) => {
    const where = format.channelMention(s.threadId ?? s.channelId)
    return s.forgetting ? "Being removed" : s.cardState === "blocked" ? `Could not be posted in ${where}. Run ${code(`${prefix}recovery`)} for the fix`
        : s.cardState === "current" && !s.cardStale ? `Up to date in ${where}` : `Updating in ${where}`
}
export const suggestionCard = (s: C.SuggestionsDefinition, prefix: string): Card => ({ title: `Suggestion #${s.suggestionNo}`, description: s.text, fields: [
    ["Status", stateNames[s.state]], ["Author", format.userMention(s.authorId)], ["Votes", votes(s)],
    ...(s.reason ? [["Reason", s.reason] as const] : []),
    ...(s.statusBy ? [["Changed", `By ${format.userMention(s.statusBy)}${s.statusAt !== undefined ? ` ${ago(s.statusAt)}` : ""}`] as const] : []),
    ["Card", cardStatus(s, prefix)]] })
const postStatus = (post: C.PublishingPost, s: C.SuggestionsDefinition, prefix: string) => post.outcome === "sent" ? `Posted in ${format.channelMention(post.channelId)}`
    : post.outcome === "pending" ? `Sending to ${format.channelMention(post.channelId)}` : post.outcome === "failed" ? `Could not be posted in ${format.channelMention(post.channelId)}. Run ${code(`${prefix}recovery`)} for the fix`
    : `Not confirmed yet, and NeonFlux does not resend it on its own. ${post.messageId ? `Run ${code(`${prefix}suggest reconcile ${s.suggestionNo} confirm`)}, or ${code(`${prefix}suggest replace ${s.suggestionNo} confirm`)} if the message is gone`
        : `The message is unknown, so check ${format.channelMention(post.channelId)}`}`
export function handleSuggestionCommand(store: SuggestionsStore, config: BotConfig, command: SuggestionCommand | { error: string }, context: BotEventContext<"messageCreate">, worker?: { notify: () => Effect.Effect<void, unknown> }) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, content), card = (value: Card) => replyCard(context, config.serverId, value)
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(withPrefix(suggestionHelp, prefix)); return }
        // A command in any post of a forum destination counts as in the forum
        const here = yield* readCommandChannel(client, message.channelId)
        const fresh = (channelId = here) => readSuggestionParticipant(client, serverId, message.author.id, channelId, !suggestionPublic(command), suggestionCritical(command))
        const query = (operation: C.SuggestionsQueryRequest["operation"]) => fresh().pipe(Effect.flatMap(context => store.query({ serverId, context, operation })))
        // Chat changes apply to the current revision, read right before the write, so the last of two changes wins
        const settingsRevision = query({ type: "settings" }).pipe(Effect.flatMap(found => found.type === "settings" ? Effect.succeed(found.settings.revision) : Effect.fail(new SuggestionsHandlingError({ stage: "response" }))))
        const suggestionRevision = (type: "show" | "publication", suggestionNo: number) => query({ type, suggestionNo }).pipe(Effect.flatMap(found => "suggestion" in found ? Effect.succeed(found.suggestion.revision) : Effect.fail(new SuggestionsHandlingError({ stage: "response" }))))
        if (command.type === "show" || command.type === "mine" || command.type === "list" || command.type === "settings" || command.type === "publication") {
            const list = command.type === "list" ? `${prefix}suggest list${command.state ? ` ${command.state}` : ""}` : "", key = pageKey(serverId, message, "suggest", "list", command.type === "list" ? command.state : undefined)
            const before = command.type === "list" && command.next ? nextPosition<number>(key) : undefined
            if (command.type === "list" && command.next && before === undefined) { yield* reply(noNextPage(list)); return }
            const operation: C.SuggestionsQueryRequest["operation"] = command.type === "list" ? { type: "list", ...(command.state ? { state: command.state } : {}), ...(before ? { beforeSuggestionNo: before } : {}) } : command
            const found = yield* query(operation)
            if ("suggestion" in found && found.suggestion.channelId !== here || found.type === "suggestions" && found.suggestions.some(s => s.channelId !== here)) return yield* Effect.fail(new SuggestionsHandlingError({ stage: "identity" }))
            if (found.type === "settings") {
                const s = found.settings
                yield* card({ title: "Suggestions", fields: [["Status", onOff(s.enabled)], ["Channel", s.channelId ? format.channelMention(s.channelId) : `Not set. Run ${code(`${prefix}suggest configure #channel`)}`],
                    ["Suggestions", usage(s.suggestions, 1000)], ...(s.voters >= 8000 ? [["Voters", usage(s.voters, 10000)] as const] : []),
                    ...(s.dirty ? [["Cards updating", String(s.dirty)] as const] : []), ...(s.blocked ? [["Cards that could not be posted", `${s.blocked}. Run ${code(`${prefix}recovery`)} for the fix`] as const] : [])] })
            } else if (found.type === "suggestions") {
                rememberPosition(key, found.nextBeforeSuggestionNo)
                yield* card({ title: command.type === "list" && command.state ? `${stateNames[command.state]} suggestions` : "Suggestions",
                    description: found.suggestions.length ? found.suggestions.map(s => `**#${s.suggestionNo}** ${stateNames[s.state]}, ${votes(s)}: ${s.text.length > 80 ? `${s.text.slice(0, 79)}…` : s.text}`).join("\n") : "No suggestions yet",
                    fields: found.nextBeforeSuggestionNo ? [["Next", code(`${list} next`)]] : [] })
            }
            else if (found.type === "vote") yield* reply(found.vote ? `You voted ${found.vote.choice} on suggestion #${found.suggestion.suggestionNo}` : `You have not voted on suggestion #${found.suggestion.suggestionNo}`)
            else if (found.type === "publication") {
                const detail = suggestionCard(found.suggestion, prefix)
                yield* card({ ...detail, title: `${detail.title} card`, fields: [...detail.fields!, ["Post", found.post ? postStatus(found.post, found.suggestion, prefix) : "Not posted yet"]] })
            }
            else if (found.type === "suggestion") yield* card(suggestionCard(found.suggestion, prefix))
            return
        }
        if ((command.type === "withdraw" || command.type === "forget" || command.type === "replace" || command.type === "reconcile") && !command.confirmed) {
            yield* fresh()
            yield* reply(`${command.type === "forget" ? "Forgetting removes this suggestion's stored data in steps. Posted messages stay" : command.type === "withdraw" ? "Withdrawing is final. The public card keeps the suggestion's text"
                : command.type === "reconcile" ? "This checks the posted card in Fluxer and records what it finds" : "This posts the card again only when Fluxer confirms the old message is gone"}\nConfirm: ${code(`${prefix}suggest ${command.type} ${command.suggestionNo} confirm`)}`)
            return
        }
        const createdAt = yield* sourceTimestamp(message)
        const member = (operation: C.SuggestionsMemberRequest["operation"]) => fresh().pipe(Effect.flatMap(context => store.member({ serverId, context, messageId: message.id, createdAt, operation })))
        const manage = (operation: C.SuggestionsManageOperation, channelId = here) => fresh(channelId).pipe(Effect.flatMap(context => store.manage({ serverId, context, messageId: message.id, createdAt, operation })))
        if (command.type === "submit" || command.type === "vote" || command.type === "withdraw") {
            let operation: C.SuggestionsMemberRequest["operation"]
            if (command.type === "vote") operation = { type: "vote", suggestionNo: command.suggestionNo, choice: command.vote }
            else if (command.type === "withdraw") operation = { type: "withdraw", suggestionNo: command.suggestionNo, expectedRevision: yield* suggestionRevision("show", command.suggestionNo), confirm: true }
            else operation = command
            const result = yield* member(operation)
            const s = result.suggestion
            if (!result.duplicate) { if (worker) yield* worker.notify(); yield* reply(result.type === "vote" ? result.accepted ? `Vote counted. Suggestion #${s.suggestionNo} has ${votes(s)}` : `Your vote on suggestion #${s.suggestionNo} was not counted`
                : command.type === "withdraw" ? `Suggestion #${s.suggestionNo} withdrawn` : `Suggestion #${s.suggestionNo} submitted. Its card appears in ${format.channelMention(s.threadId ?? s.channelId)} shortly`) }
            return
        }
        let operation: C.SuggestionsManageOperation, channelId = here
        if (command.type === "configure") {
            yield* readSuggestionDestination(client, serverId, message.author.id, command.channelId)
            // A forum destination needs its status tags before the first post
            const forum = yield* readSuggestionForum(client, command.channelId)
            if (forum) {
                const fix = yield* ensureSuggestionTags(client, forum).pipe(Effect.as(undefined), Effect.catchTag("SuggestionTagError", error => Effect.succeed(error.fix)))
                if (fix) { yield* reply(`Suggestions need status tags in ${format.channelMention(forum.id)}. ${fix}`); return }
            }
            operation = { type: "configure", expectedRevision: yield* settingsRevision, channelId: command.channelId }; channelId = command.channelId
        } else if (command.type === "enable" || command.type === "disable") operation = { type: "settings", expectedRevision: yield* settingsRevision, enabled: command.type === "enable" }
        else if (command.type === "status") operation = { ...command, expectedRevision: yield* suggestionRevision("show", command.suggestionNo) }
        // Publication still reads a suggestion whose forgetting has started
        else if (command.type === "forget") operation = { type: "forget", suggestionNo: command.suggestionNo, expectedRevision: yield* suggestionRevision("publication", command.suggestionNo), confirm: true }
        else {
            // The card's revision and generation come from this fresh read, and the known message is verified below
            const found = yield* query({ type: "publication", suggestionNo: command.suggestionNo })
            if (found.type !== "publication" || !found.post?.messageId || found.suggestion.channelId !== here || found.post.channelId !== here && (yield* readChannelParent(client, found.post.channelId)) !== here || found.post.consumer?.type !== "suggestion-card" || found.post.consumer.suggestionNo !== command.suggestionNo || found.post.consumer.cardGeneration !== found.suggestion.cardGeneration) return yield* Effect.fail(new SuggestionsHandlingError({ stage: "identity" }))
            const post = found.post
            const authority = yield* readSafetyAuthority(client, serverId, message.author.id, { channelId: post.channelId })
            if (!authority.channel || authority.botId !== post.botId) return yield* Effect.fail(new SuggestionsHandlingError({ stage: "identity" }))
            const binding: C.SuggestionsPostBinding = { suggestionNo: command.suggestionNo, expectedRevision: found.suggestion.revision, cardGeneration: found.suggestion.cardGeneration, postNo: post.postNo, attemptId: post.attempt.attemptId, expectedGeneration: post.generation }
            const native = yield* client.messages.fetch({ channelId: post.channelId, id: post.messageId! }, { timeoutMs: 5000 }).pipe(Effect.catch(e => command.type === "replace" && e instanceof MessageOperationError && e.reason === "notFound" && e.status === 404 ? Effect.succeed(undefined) : Effect.fail(e)))
            if (command.type === "replace") {
                if (native) { yield* reply(`The card for suggestion #${command.suggestionNo} is still posted, so it was not replaced`); return }
                operation = { type: "replace", ...binding, confirm: true, observation: { originServerId: config.serverId, status: "absent", observedAt: yield* Clock.currentTimeMillis, messageId: post.messageId!, channelId: post.channelId, botId: post.botId } }
            } else {
                if (!native) return yield* Effect.fail(new SuggestionsHandlingError({ stage: "identity" }))
                yield* verifyPublishingMessage(native, { serverId, channelId: post.channelId, messageId: post.messageId!, botId: post.botId, verifiedChannel: authority.channel })
                const content = publishingMessageContent(native)
                if (!content) return yield* Effect.fail(new SuggestionsHandlingError({ stage: "identity" }))
                operation = { type: "reconcile", ...binding, observation: { originServerId: config.serverId, observedAt: yield* Clock.currentTimeMillis, messageId: native.id, channelId: native.channelId, botId: native.author.id, content } }
            }
        }
        const result = yield* manage(operation, channelId)
        if (result.duplicate) return
        if (worker) yield* worker.notify()
        if (result.type === "settings") {
            const where = result.settings.channelId ? ` in ${format.channelMention(result.settings.channelId)}` : `. Set a channel with ${code(`${prefix}suggest configure #channel`)}`
            yield* reply(command.type === "configure" ? `Suggestions now go to ${format.channelMention(command.channelId)}` : result.settings.enabled ? `Suggestions are on${where}` : "Suggestions are off")
        }
        else if (result.type === "forgotten") yield* reply(result.complete ? `Suggestion #${result.suggestionNo} forgotten, ${result.removed} record${result.removed === 1 ? "" : "s"} removed. Posted messages stay`
            : `Removed ${result.removed} record${result.removed === 1 ? "" : "s"} of suggestion #${result.suggestionNo} so far\nContinue: ${code(`${prefix}suggest forget ${result.suggestionNo} confirm`)}`)
        else if (command.type === "status") yield* reply(`Suggestion #${command.suggestionNo} is now ${stateNames[command.state].toLowerCase()}`)
        else yield* card(suggestionCard(result.suggestion, prefix))
    }).pipe(Effect.catch(error => reply(error instanceof SuggestionsStoreError ? error.status === 409 ? "The suggestion changed while this command ran, or suggestions are full. Send the command again"
        : error.status === 403 ? "You can't do that here. Check that suggestions are on and that you can see this channel" : "The change could not be confirmed. Check the suggestion before you try again"
        : "NeonFlux could not check your access, the suggestion channel or the posted card, so nothing changed")))
}
