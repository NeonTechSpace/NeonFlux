import type * as C from "@neonflux/backend/contracts"
import { MessageOperationError, type BotEventContext } from "@neontechspace/fluxerly/effect"
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
import { noMentions, sourceTimestamp } from "./responses.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"

export const suggestionDetail = (s: C.SuggestionsDefinition) => [`Suggestion ${s.suggestionNo}: ${s.state}`, s.text,
    `Author ${s.authorId}. Up ${s.up}, down ${s.down}`,
    ...(s.reason ? [`Status reason: ${s.reason}${s.statusBy ? `\nChanged by ${s.statusBy}${s.statusAt !== undefined ? ` at ${new Date(s.statusAt).toISOString()}` : ""}` : ""}`] : []),
    `Card ${s.cardState}${s.cardStale ? ", stale" : ""}${s.postNo ? `, tracked post ${s.postNo}` : ""}${s.forgetting ? ", forgetting in progress" : ""}`].join("\n")
export function handleSuggestionCommand(store: SuggestionsStore, config: BotConfig, command: SuggestionCommand | { error: string }, context: BotEventContext<"messageCreate">, worker?: { notify: () => Effect.Effect<void, unknown> }) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => Effect.gen(function* () { for (let i = 0; i < content.length; i += 1900) yield* context.reply({ content: content.slice(i, i + 1900), allowedMentions: noMentions }) })
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
            if (found.type === "settings") yield* reply(`Suggestions ${found.settings.enabled ? "On" : "Off"}, destination ${found.settings.channelId ?? "Unset"}\n${found.settings.suggestions}/1000 suggestions, ${found.settings.voters}/10000 voter rows, ${found.settings.dirty} dirty, ${found.settings.blocked} blocked`)
            else if (found.type === "suggestions") {
                rememberPosition(key, found.nextBeforeSuggestionNo)
                yield* reply([...found.suggestions.map(s => `Suggestion ${s.suggestionNo}: ${s.state}, up ${s.up}, down ${s.down}${s.cardStale ? ", card stale" : ""}`), ...(found.suggestions.length ? [] : ["No retained suggestions in this destination"]), ...(found.nextBeforeSuggestionNo ? [`Next: ${list} next`] : [])].join("\n"))
            }
            else if (found.type === "vote") yield* reply(`Your recorded vote: ${found.vote?.choice ?? "None"}`)
            else if (found.type === "publication") yield* reply(`${suggestionDetail(found.suggestion)}${found.post ? `\nPost generation ${found.post.generation}, attempt ${found.post.attempt.attemptId}, outcome ${found.post.outcome}${found.post.messageId ? `, message ${found.post.messageId}` : ", message identity unknown"}. No automatic replay` : "\nNo tracked card yet"}`)
            else if (found.type === "suggestion") yield* reply(suggestionDetail(found.suggestion))
            return
        }
        if ((command.type === "withdraw" || command.type === "forget" || command.type === "replace" || command.type === "reconcile") && !command.confirmed) {
            yield* fresh()
            yield* reply(`${command.type === "forget" ? "Forgetting removes settled backend feature data in bounded pages. Native messages remain" : command.type === "withdraw" ? "Withdrawal is final. The public card keeps the proposition" : "Recovery requires an exact known card and fresh provider evidence"}\nConfirm: ${prefix}suggest ${command.type} ${command.suggestionNo} confirm`)
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
            if (!result.duplicate) { if (worker) yield* worker.notify(); yield* reply(result.type === "vote" ? `Vote ${result.accepted ? "Accepted" : "Not accepted"}. Up ${result.suggestion.up}, down ${result.suggestion.down}. Card ${result.suggestion.cardStale ? "Synchronization pending" : "Current"}` : suggestionDetail(result.suggestion)) }
            return
        }
        let operation: C.SuggestionsManageOperation, channelId = here
        if (command.type === "configure") {
            yield* readSuggestionDestination(client, serverId, message.author.id, command.channelId)
            // A forum destination needs its status tags before the first post
            const forum = yield* readSuggestionForum(client, command.channelId)
            if (forum) {
                const fix = yield* ensureSuggestionTags(client, forum).pipe(Effect.as(undefined), Effect.catchTag("SuggestionTagError", error => Effect.succeed(error.fix)))
                if (fix) { yield* reply(`Suggestions need status tags in <#${forum.id}>. ${fix}`); return }
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
                if (native) { yield* reply("The exact card is present. Replacement requires typed confirmed absence"); return }
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
        if (result.type === "settings") yield* reply(`Suggestions ${result.settings.enabled ? "On" : "Off"}, destination ${result.settings.channelId ?? "Unset"}`)
        else if (result.type === "forgotten") yield* reply(`Removed ${result.removed} records. ${result.complete ? "Forgetting complete. Native messages remain" : `Continue: ${prefix}suggest forget ${result.suggestionNo} confirm`}`)
        else yield* reply(suggestionDetail(result.suggestion))
    }).pipe(Effect.catch(error => reply(error instanceof SuggestionsStoreError ? error.status === 409 ? "The suggestion changed while this command ran, is blocked or reached capacity. Send the command again" : error.status === 403 ? "Suggestion operation denied by current membership, visibility or module policy" : "Suggestion persistence was not confirmed. Inspect current state before another command" : "I couldn't verify current membership, destination or exact card evidence. No replacement was authorized")))
}
