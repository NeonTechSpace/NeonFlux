import type * as C from "@neonflux/backend/contracts"
import { MessageOperationError, type BotEventContext } from "@neontechspace/fluxerly/effect"
import { Clock, Effect } from "effect"
import type { BotConfig } from "./config.ts"
import { suggestionHelp, suggestionPublic, suggestionCritical, type SuggestionCommand } from "./suggestion-command.ts"
import { SuggestionsStoreError, type SuggestionsStore } from "./suggestion-store.ts"
import { readSuggestionParticipant, readSuggestionDestination } from "./suggestion-permissions.ts"
import { SuggestionsHandlingError } from "./suggestions.ts"
import { publishingMessageContent } from "./publishing-content.ts"
import { verifyPublishingMessage } from "./publishing-permissions.ts"
import { readSafetyAuthority } from "./safety-permissions.ts"
import { noMentions, sourceTimestamp } from "./responses.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"

export const suggestionDetail = (s: C.SuggestionsDefinition) => [`Suggestion ${s.suggestionNo}: ${s.state}, revision ${s.revision}`, s.text,
    `Author ${s.authorId}. Up ${s.up}, down ${s.down}`,
    ...(s.reason ? [`Status reason: ${s.reason}${s.statusBy ? `\nChanged by ${s.statusBy}${s.statusAt !== undefined ? ` at ${new Date(s.statusAt).toISOString()}` : ""}` : ""}`] : []),
    `Card ${s.cardState}${s.cardStale ? ", stale" : ""}, desired ${s.desiredRevision}, published ${s.publishedRevision}, card generation ${s.cardGeneration}${s.postNo ? `, tracked post ${s.postNo}` : ""}${s.forgetting ? ", forgetting in progress" : ""}`].join("\n")
export function handleSuggestionCommand(store: SuggestionsStore, config: BotConfig, command: SuggestionCommand | { error: string }, context: BotEventContext<"messageCreate">, worker?: { notify: () => Effect.Effect<void, unknown> }) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => Effect.gen(function* () { for (let i = 0; i < content.length; i += 1900) yield* context.reply({ content: content.slice(i, i + 1900), allowedMentions: noMentions }) })
    return Effect.gen(function* () {
        const { message, client } = context, serverId = config.serverId
        if (message.guildId !== serverId) return
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(withPrefix(suggestionHelp, prefix)); return }
        const fresh = (channelId = message.channelId) => readSuggestionParticipant(client, serverId, message.author.id, channelId, !suggestionPublic(command), suggestionCritical(command))
        const query = (operation: C.SuggestionsQueryRequest["operation"]) => fresh().pipe(Effect.flatMap(context => store.query({ serverId, context, operation })))
        if (command.type === "show" || command.type === "mine" || command.type === "list" || command.type === "settings" || command.type === "publication") {
            const operation: C.SuggestionsQueryRequest["operation"] = command.type === "list" ? { type: "list", ...(command.state ? { state: command.state } : {}), ...(command.cursor ? { beforeSuggestionNo: Number(command.cursor) } : {}) } : command
            const found = yield* query(operation)
            if ("suggestion" in found && found.suggestion.channelId !== message.channelId || found.type === "suggestions" && found.suggestions.some(s => s.channelId !== message.channelId)) return yield* Effect.fail(new SuggestionsHandlingError({ stage: "identity" }))
            if (found.type === "settings") yield* reply(`Suggestions ${found.settings.enabled ? "On" : "Off"}, settings revision ${found.settings.revision}, destination ${found.settings.channelId ?? "Unset"}\n${found.settings.suggestions}/1000 suggestions, ${found.settings.voters}/10000 voter rows, ${found.settings.dirty} dirty, ${found.settings.blocked} blocked`)
            else if (found.type === "suggestions") yield* reply([...found.suggestions.map(s => `Suggestion ${s.suggestionNo}: ${s.state}, revision ${s.revision}, up ${s.up}, down ${s.down}${s.cardStale ? ", card stale" : ""}`), ...(found.suggestions.length ? [] : ["No retained suggestions in this destination"]), ...(found.nextBeforeSuggestionNo ? [`Next: ${prefix}suggest list ${command.type === "list" && command.state ? `${command.state} ` : ""}${found.nextBeforeSuggestionNo}`] : [])].join("\n"))
            else if (found.type === "vote") yield* reply(`Your recorded vote: ${found.vote?.choice ?? "None"}`)
            else if (found.type === "publication") yield* reply(`${suggestionDetail(found.suggestion)}${found.post ? `\nPost generation ${found.post.generation}, attempt ${found.post.attempt.attemptId}, outcome ${found.post.outcome}${found.post.messageId ? `, message ${found.post.messageId}` : ", message identity unknown"}. No automatic replay` : "\nNo tracked card yet"}`)
            else if (found.type === "suggestion") yield* reply(suggestionDetail(found.suggestion))
            return
        }
        if ((command.type === "withdraw" || command.type === "forget" || command.type === "replace" || command.type === "reconcile") && !command.confirmed) {
            yield* fresh()
            yield* reply(`${command.type === "forget" ? "Forgetting removes settled backend feature data in bounded pages. Native messages remain" : command.type === "withdraw" ? "Withdrawal is final. The public card keeps the proposition" : "Recovery requires an exact known card and fresh provider evidence"}\nConfirm: ${prefix}suggest ${command.type} ${command.suggestionNo} ${command.expectedRevision}${"expectedGeneration" in command ? ` ${command.expectedGeneration}` : ""} confirm`)
            return
        }
        const createdAt = yield* sourceTimestamp(message)
        const member = (operation: C.SuggestionsMemberRequest["operation"]) => fresh().pipe(Effect.flatMap(context => store.member({ serverId, context, messageId: message.id, createdAt, operation })))
        const manage = (operation: C.SuggestionsManageOperation, channelId = message.channelId) => fresh(channelId).pipe(Effect.flatMap(context => store.manage({ serverId, context, messageId: message.id, createdAt, operation })))
        if (command.type === "submit" || command.type === "vote" || command.type === "withdraw") {
            let operation: C.SuggestionsMemberRequest["operation"]
            if (command.type === "vote") operation = { type: "vote", suggestionNo: command.suggestionNo, choice: command.vote }
            else if (command.type === "withdraw") operation = { type: "withdraw", suggestionNo: command.suggestionNo, expectedRevision: command.expectedRevision, confirm: true }
            else operation = command
            const result = yield* member(operation)
            if (!result.duplicate) { if (worker) yield* worker.notify(); yield* reply(result.type === "vote" ? `Vote ${result.accepted ? "Accepted" : "Not accepted"}. Up ${result.suggestion.up}, down ${result.suggestion.down}. Card ${result.suggestion.cardStale ? "Synchronization pending" : "Current"}` : suggestionDetail(result.suggestion)) }
            return
        }
        let operation: C.SuggestionsManageOperation, channelId = message.channelId
        if (command.type === "configure") {
            yield* readSuggestionDestination(client, serverId, message.author.id, command.channelId)
            operation = command; channelId = command.channelId
        } else if (command.type === "enable" || command.type === "disable") operation = { type: "settings", expectedRevision: command.expectedRevision, enabled: command.type === "enable" }
        else if (command.type === "status") operation = command
        else if (command.type === "forget") operation = { type: "forget", suggestionNo: command.suggestionNo, expectedRevision: command.expectedRevision, confirm: true }
        else {
            const found = yield* query({ type: "publication", suggestionNo: command.suggestionNo })
            if (found.type !== "publication" || !found.post?.messageId || found.suggestion.channelId !== message.channelId || found.post.channelId !== message.channelId || found.post.consumer?.type !== "suggestion-card" || found.post.consumer.suggestionNo !== command.suggestionNo || found.post.consumer.cardGeneration !== command.expectedGeneration || found.suggestion.cardGeneration !== command.expectedGeneration || found.suggestion.revision !== command.expectedRevision) return yield* Effect.fail(new SuggestionsHandlingError({ stage: "identity" }))
            const post = found.post
            const authority = yield* readSafetyAuthority(client, serverId, message.author.id, { channelId: post.channelId })
            if (!authority.channel || authority.botId !== post.botId) return yield* Effect.fail(new SuggestionsHandlingError({ stage: "identity" }))
            const binding: C.SuggestionsPostBinding = { suggestionNo: command.suggestionNo, expectedRevision: command.expectedRevision, cardGeneration: command.expectedGeneration, postNo: post.postNo, attemptId: post.attempt.attemptId, expectedGeneration: post.generation }
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
        if (result.type === "settings") yield* reply(`Suggestions ${result.settings.enabled ? "On" : "Off"}, settings revision ${result.settings.revision}`)
        else if (result.type === "forgotten") yield* reply(`Removed ${result.removed} records. ${result.complete ? "Forgetting complete. Native messages remain" : `Continue: ${prefix}suggest forget ${result.suggestionNo} ${result.revision} confirm`}`)
        else yield* reply(suggestionDetail(result.suggestion))
    }).pipe(Effect.catch(error => reply(error instanceof SuggestionsStoreError ? error.status === 409 ? "Suggestion changed, is blocked or reached capacity. Read current status before using a new command" : error.status === 403 ? "Suggestion operation denied by current membership, visibility or module policy" : "Suggestion persistence was not confirmed. Inspect current state before another command" : "I couldn't verify current membership, destination or exact card evidence. No replacement was authorized")))
}
