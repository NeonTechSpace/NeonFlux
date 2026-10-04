import type * as C from "@neonflux/backend/contracts"
import { MessageError, MessageOperationError, type BotEventContext, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Exit } from "effect"
import { randomUUID } from "node:crypto"
import type { BotConfig } from "./config.ts"
import { moderationActor } from "./moderation.ts"
import { sourceTimestamp, noMentions } from "./responses.ts"
import { publishingHelp, type PublishingCommand } from "./publishing-command.ts"
import { canonicalPublishingContent, equalPublishingContent, publishingMessageContent } from "./publishing-content.ts"
import { readPublishingAuthority, verifyPublishingMessage } from "./publishing-permissions.ts"
import { publishingErrorMessage, PublishingStoreError, type PublishingStore } from "./publishing-store.ts"
import type { SchedulesStore } from "./schedule-store.ts"
import { handleScheduleCommand } from "./schedule-management.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"

export class PublishingHandlingError extends Data.TaggedError("PublishingHandlingError")<{ readonly stage: "grant" | "snapshot" | "identity" }> {}
const inputContent = (value: C.PublishingContent) => ({ content: value.content, embeds: value.embed ? [value.embed] : [], allowedMentions: noMentions })

type PublishingStage = "grant" | "authorization" | "settings" | "baseline" | "claim" | "native" | "readback" | "acknowledgement"
const publishingFailureClasses = ["MessageError", "MessageOperationError", "ClientClosedError", "PublishingHandlingError", "PublishingPermissionError", "SafetyPermissionError", "PublishingStoreError", "TimeoutError"] as const
const publishingFailureKinds = ["input", "busy", "notFound", "rejected", "network", "response", "timeout", "rateLimit", "unknown"] as const
export interface PublishingDiagnostic {
    readonly stage: PublishingStage
    readonly failureClass: typeof publishingFailureClasses[number] | "Unknown"
    readonly kind?: typeof publishingFailureKinds[number]
    readonly status?: number
    readonly retryAfterMs?: number
    readonly nativeOutcome?: "notDispatched" | "rejected" | "unknown"
    readonly identityField?: "message" | "channel" | "guild" | "author" | "webhook"
}
export interface PublishingIdentityPresence {
    readonly guildSupplied: boolean
    readonly suppliedGuildMatches: boolean
    readonly channelMatches: boolean
    readonly authorMatches: boolean
    readonly reportedBot: boolean
    readonly webhookPresent: boolean
}
export function publishingDiagnostic(stage: PublishingStage, error: unknown): PublishingDiagnostic {
    try {
        const value = error && typeof error === "object" ? error as Record<string, unknown> : {}
        const failureClass = publishingFailureClasses.find((tag) => tag === value._tag) ?? "Unknown"
        const kind = publishingFailureKinds.find((item) => item === (value.kind ?? value.reason))
        const status = typeof value.status === "number" && Number.isInteger(value.status) && value.status >= 100 && value.status <= 599 ? value.status : undefined
        const retryAfterMs = kind === "rateLimit" && status === 429 && typeof value.retryAfterMs === "number"
            && Number.isFinite(value.retryAfterMs) && value.retryAfterMs >= 0 && value.retryAfterMs <= 2147483647 ? value.retryAfterMs : undefined
        const nativeOutcome = (failureClass === "MessageError" || failureClass === "MessageOperationError")
            && (value.outcome === "notDispatched" || value.outcome === "rejected" || value.outcome === "unknown") ? value.outcome : undefined
        const identityField = failureClass === "PublishingPermissionError" ? (["message", "channel", "guild", "author", "webhook"] as const).find((field) => field === value.field) : undefined
        return { stage, failureClass, ...(kind ? { kind } : {}), ...(status !== undefined ? { status } : {}),
            ...(retryAfterMs !== undefined ? { retryAfterMs } : {}), ...(nativeOutcome ? { nativeOutcome } : {}), ...(identityField ? { identityField } : {}) }
    } catch { return { stage, failureClass: "Unknown" } }
}

const consumerContextField = { schedule: "scheduleContext" } as const

export function performPublishingGrant(store: PublishingStore, serverId: string, actorId: string, client: Client, grant: C.PublishingGrant,
    consumerContext?: () => Effect.Effect<C.SchedulesAutomationContext, unknown>) {
    return Effect.gen(function* () {
        let dispatched = false
        let ownsClaim = false
        let claimRequested = false
        let canAbandon = false
        const progress: { stage: PublishingStage, identityPresence?: PublishingIdentityPresence } = { stage: "grant" }
        const claimToken = yield* Effect.sync(() => randomUUID().replaceAll("-", ""))
        let verifiedMessageId: string | undefined
        const write = Effect.gen(function* () {
            if (grant.actorId !== actorId || !["send", "edit"].includes(grant.action)) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            canAbandon = true
            if (!Number.isSafeInteger(grant.dispatchExpiresAt) || grant.nativeDeadlineMs !== 5000
                || (yield* Clock.currentTimeMillis) >= grant.dispatchExpiresAt) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            progress.stage = "authorization"
            const authority = yield* readPublishingAuthority(client, serverId, actorId, grant.channelId, !!grant.content.embed)
            if (authority.botId !== grant.botId) return yield* Effect.fail(new PublishingHandlingError({ stage: "identity" }))
            progress.stage = "settings"
            // Automatic writes act as the bot. Their consumer fence checks the module and publishing switches at claim
            if (actorId !== grant.botId) {
                const settings = yield* store.query({ serverId, actor: moderationActor(authority), operation: { type: "settings" } })
                if (settings.type !== "settings" || !settings.settings.enabled) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            }
            if (grant.action === "edit") {
                progress.stage = "baseline"
                if (!grant.messageId || !grant.expectedContent) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
                const current = yield* client.messages.fetch({ channelId: grant.channelId, id: grant.messageId }, { timeoutMs: 5000 })
                yield* verifyPublishingMessage(current, { serverId, channelId: grant.channelId, messageId: grant.messageId, botId: grant.botId, verifiedChannel: authority.channel! })
                const comparable = publishingMessageContent(current)
                if (!comparable || !equalPublishingContent(comparable, canonicalPublishingContent(grant.expectedContent))) return yield* Effect.fail(new PublishingHandlingError({ stage: "snapshot" }))
            }
            progress.stage = "claim"
            const freshContext = grant.consumer ? consumerContext ? yield* consumerContext() : undefined : undefined
            if (grant.consumer && (!freshContext || freshContext.botId !== actorId || freshContext.channelId !== grant.channelId
                || freshContext.botId !== grant.botId)) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            claimRequested = true
            const claim = yield* store.dispatch({ serverId, postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, claimToken,
                ...(freshContext && grant.consumer ? { [consumerContextField[grant.consumer.type]]: freshContext } : {}) })
            if (!claim.claimed || claim.dispatchExpiresAt !== grant.dispatchExpiresAt || claim.nativeDeadlineMs !== grant.nativeDeadlineMs) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            ownsClaim = true
            if (grant.nativeDeadlineMs !== 5000 || (yield* Clock.currentTimeMillis) >= grant.dispatchExpiresAt) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            progress.stage = "native"
            const nativeBudget = Math.min(grant.nativeDeadlineMs, grant.dispatchExpiresAt - (yield* Clock.currentTimeMillis))
            if (nativeBudget <= 0) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            dispatched = true
            const returned = grant.action === "send"
                ? yield* client.messages.send(grant.channelId, inputContent(grant.content), { timeoutMs: nativeBudget })
                : yield* client.messages.edit({ channelId: grant.channelId, id: grant.messageId! }, inputContent(grant.content), { timeoutMs: nativeBudget })
            progress.stage = "readback"
            progress.identityPresence = { guildSupplied: returned.guildId !== undefined, suppliedGuildMatches: returned.guildId === undefined || returned.guildId === serverId,
                channelMatches: returned.channelId === grant.channelId, authorMatches: returned.author.id === grant.botId,
                reportedBot: returned.author.isBot, webhookPresent: !!returned.webhookId }
            yield* verifyPublishingMessage(returned, { serverId, channelId: grant.channelId, messageId: grant.action === "edit" ? grant.messageId! : returned.id, botId: grant.botId, verifiedChannel: authority.channel! })
            verifiedMessageId = returned.id
            const comparable = publishingMessageContent(returned)
            if (!comparable || !equalPublishingContent(comparable, canonicalPublishingContent(grant.canonicalContent))) return yield* Effect.fail(new PublishingHandlingError({ stage: "snapshot" }))
            return returned.id
        })
        const result = yield* Effect.exit(write)
        if (Exit.isFailure(result) && Cause.hasInterrupts(result.cause)) return yield* Effect.failCause(result.cause)
        const failure = Exit.isFailure(result) ? result.cause.reasons.find((reason) => reason._tag === "Fail" || reason._tag === "Die") : undefined
        const diagnostic = failure ? publishingDiagnostic(progress.stage, failure._tag === "Fail" ? failure.error : undefined) : undefined
        const noDispatch = Exit.isFailure(result) && result.cause.reasons.length > 0 && result.cause.reasons.every((reason) => reason._tag === "Fail"
            && (reason.error instanceof MessageError || reason.error instanceof MessageOperationError) && reason.error.outcome === "notDispatched")
        const unknown = Exit.isFailure(result) && dispatched && !(progress.stage === "native"
            && noDispatch)
        const outcome = Exit.isSuccess(result) ? "sent" : unknown ? "uncertain" : "failed"
        const messageId = Exit.isSuccess(result) ? result.value : unknown ? verifiedMessageId : undefined
        const diagnostics = diagnostic ? [diagnostic] : []
        if (!ownsClaim && (claimRequested || !canAbandon)) return { outcome, acknowledged: false, ...(diagnostics.length ? { diagnostics } : {}) }
        const acknowledged = yield* store.outcome({ serverId, postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation,
            sourceId: grant.sourceId, outcome, ...(ownsClaim ? { claimToken } : {}), ...(messageId ? { messageId } : {}) }).pipe(Effect.match({
                onFailure: (error) => { diagnostics.push(publishingDiagnostic("acknowledgement", error)); return false }, onSuccess: (value) => value.recorded }))
        return { outcome, acknowledged, ...(messageId ? { messageId } : {}), ...(diagnostics.length ? { diagnostics } : {}),
            ...(progress.identityPresence ? { identityPresence: progress.identityPresence } : {}) }
    })
}

export function publishingDraftMessage(draft: C.PublishingDraft) {
    const e = draft.content.embed
    const parts = [`${draft.kind === "template" ? "Template" : "Draft"} ${draft.name}, revision ${draft.revision}`, `Content: ${draft.content.content || "(empty)"}`]
    if (e) {
        for (const field of ["title", "description", "url", "color", "timestamp"] as const) if (e[field] !== undefined) parts.push(`${field}: ${field === "color" ? `#${e.color!.toString(16).padStart(6, "0")}` : e[field]}`)
        if (e.author) parts.push(`Author: ${e.author.name}${e.author.url ? `, URL ${e.author.url}` : ""}${e.author.iconUrl ? `, icon ${e.author.iconUrl}` : ""}`)
        if (e.footer) parts.push(`Footer: ${e.footer.text}${e.footer.iconUrl ? `, icon ${e.footer.iconUrl}` : ""}`)
        for (const field of ["image", "thumbnail"] as const) if (e[field]) parts.push(`${field}: ${e[field]!.url}${e[field]!.description ? `, description ${e[field]!.description}` : ""}`)
        e.fields?.forEach((field,index) => parts.push(`Field ${index + 1}: ${field.name} = ${field.value}${field.inline ? " (inline)" : ""}`))
    }
    return parts.join("\n")
}
function postSource(attempt: C.PublishingAttempt) {
    const p = attempt.provenance
    if (p?.type === "schedule") return `schedule ${p.scheduleNo} plan ${p.planRevision}, frozen ${p.source.kind} ${p.source.name} revision ${p.source.revision}`
    return `${attempt.draftKind} ${attempt.draftName} revision ${attempt.draftRevision}`
}
const postMessage = (post: C.PublishingPost) => `Post ${post.postNo}, generation ${post.generation}: ${post.outcome}`
    + `${post.attempt.noDispatch ? ", no native dispatch" : ""}${post.attempt.resolution ? ", observed baseline resolved, original outcome unchanged" : ""}`
    + `, ${post.attempt.action}, ${postSource(post.attempt)}, channel ${post.channelId}${post.messageId ? `, message ${post.messageId}` : ", message identity unknown"}`

export function handlePublishing(store: PublishingStore, config: BotConfig, command: PublishingCommand | { error: string }, context: BotEventContext<"messageCreate">,
    schedules?: SchedulesStore, scheduleWorker?: { notify: () => Effect.Effect<void> }) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => context.reply({ content, allowedMentions: noMentions }).pipe(Effect.asVoid)
    const chunks = (content: string) => Effect.gen(function* () { for (let i = 0; i < content.length; i += 1900) yield* reply(content.slice(i, i + 1900)) })
    return Effect.gen(function* () {
        if (!("error" in command) && command.type === "schedule") {
            if (!schedules) yield* reply("Schedule persistence is not configured")
            else yield* handleScheduleCommand(schedules, store, config, command.command, context, scheduleWorker)
            return
        }
        const { client, message } = context
        const authority = yield* readPublishingAuthority(client, config.serverId, message.author.id)
        const actor = moderationActor(authority)
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* chunks(withPrefix(publishingHelp, prefix)); return }
        const query = (operation: C.PublishingQueryRequest["operation"]) => store.query({ serverId: config.serverId, actor, operation })
        const createdAt = yield* sourceTimestamp(message)
        const manage = (operation: C.PublishingManageOperation) => store.manage({ serverId: config.serverId, actor, messageId: message.id, createdAt, operation })
        if (command.type === "query") {
            const result = yield* query(command.operation)
            if (result.type === "draft") yield* chunks(publishingDraftMessage(result.draft))
            if (result.type === "drafts") yield* reply(`${result.kind === "template" ? "Templates" : "Drafts"}, page ${result.page}/${result.totalPages}\n${result.drafts.map((d) => `${d.name}, revision ${d.revision}`).join("\n") || "No definitions"}`)
            if (result.type === "post") yield* reply(postMessage(result.post))
            if (result.type === "posts") yield* reply(`${result.posts.map(postMessage).join("\n") || "No tracked posts"}${result.nextBeforePostNo ? `\nNext: ${prefix}publish posts ${result.nextBeforePostNo}` : ""}`)
            if (result.type === "settings") yield* reply(`Publishing: ${result.settings.enabled ? "On" : "Off"}`)
            return
        }
        let result: C.PublishingManageResult
        let expectedDraft: C.PublishingDraft | undefined
        if (command.type === "settings") result = yield* manage({ type: "settings", patch: command.patch })
        else if (command.type === "create") result = yield* manage({ type: "draft-create", kind: command.kind, name: command.name })
        else if (command.type === "resolve") {
            const found = yield* query({ type: "post-show", postNo: command.postNo })
            if (found.type !== "post") return yield* Effect.fail(new PublishingHandlingError({ stage: "identity" }))
            const target = { type: "resolve" as const, postNo: found.post.postNo, expectedGeneration: found.post.generation }
            if (command.outcome === "failed") result = yield* manage({ ...target, outcome: "failed" })
            else {
                const post = found.post, fresh = yield* readPublishingAuthority(client, config.serverId, actor.userId, post.channelId, false, true)
                const native = yield* client.messages.fetch({ channelId: post.channelId, id: command.messageId! }, { timeoutMs: 5000 }).pipe(Effect.option)
                const verified = native._tag === "Some" && fresh.botId === post.botId
                    ? yield* verifyPublishingMessage(native.value, { serverId: config.serverId, channelId: post.channelId, messageId: command.messageId!, botId: fresh.botId, verifiedChannel: fresh.channel! }).pipe(Effect.option)
                    : undefined
                const content = verified?._tag === "Some" ? publishingMessageContent(verified.value) : undefined
                if (!content || !equalPublishingContent(canonicalPublishingContent(content), canonicalPublishingContent(post.attempt.canonicalContent))) {
                    yield* reply(`Message ${command.messageId} is not my message with post ${post.postNo}'s intended content in <#${post.channelId}>. Nothing was resolved`)
                    return
                }
                result = yield* manage({ ...target, outcome: "sent", messageId: command.messageId!, channelId: post.channelId, botId: fresh.botId, content })
            }
        } else if (command.type === "reconcile" || command.type === "forget") {
            const found = yield* query({ type: "post-show", postNo: command.postNo })
            if (found.type !== "post") return yield* Effect.fail(new PublishingHandlingError({ stage: "identity" }))
            const post = found.post
            if (post.consumer) { yield* reply(`Post ${post.postNo} belongs to schedule ${post.consumer.scheduleNo}. Use ${prefix}publish schedule ${command.type} with its current management revision${command.type === "reconcile" ? ` and post ${post.postNo}` : " after the selected occurrences are settled"}`); return }
            if (command.type === "forget") result = yield* manage({ type: "forget", postNo: post.postNo, expectedGeneration: post.generation })
            else {
                if (!post.messageId) { yield* reply("This attempt has no known provider message identity. Reconciliation cannot search for or resend it"); return }
                const fresh = yield* readPublishingAuthority(client, config.serverId, actor.userId, post.channelId, false, true)
                const native = yield* client.messages.fetch({ channelId: post.channelId, id: post.messageId }, { timeoutMs: 5000 })
                yield* verifyPublishingMessage(native, { serverId: config.serverId, channelId: post.channelId, messageId: post.messageId, botId: fresh.botId, verifiedChannel: fresh.channel! })
                if (fresh.botId !== post.botId) return yield* Effect.fail(new PublishingHandlingError({ stage: "identity" }))
                const content = publishingMessageContent(native)
                if (!content) return yield* Effect.fail(new PublishingHandlingError({ stage: "snapshot" }))
                const recorded = yield* store.reconcile({ serverId: config.serverId, actor: moderationActor(fresh), messageId: message.id, createdAt,
                    postNo: post.postNo, attemptId: post.attempt.attemptId, expectedGeneration: post.generation,
                    observation: { observedAt: yield* Clock.currentTimeMillis, messageId: native.id, channelId: native.channelId, botId: native.author.id, content } })
                yield* reply(`Recorded provider observation. ${postMessage(recorded.post)}. This did not resend, edit, or change the recorded attempt outcome`)
                return
            }
        } else {
            const found = yield* query({ type: "draft-show", kind: command.kind, name: command.name })
            if (found.type !== "draft") return yield* Effect.fail(new PublishingHandlingError({ stage: "identity" }))
            expectedDraft = found.draft
            const base = { kind: command.kind, name: command.name, expectedRevision: found.draft.revision }
            if (command.type === "edit") {
                const tracked = yield* query({ type: "post-show", postNo: command.postNo })
                if (tracked.type !== "post") return yield* Effect.fail(new PublishingHandlingError({ stage: "identity" }))
                if (tracked.post.consumer) { yield* reply(`Post ${tracked.post.postNo} belongs to schedule ${tracked.post.consumer.scheduleNo}. Update future delivery intent through ${prefix}publish schedule`); return }
                const fresh = yield* readPublishingAuthority(client, config.serverId, actor.userId, tracked.post.channelId, !!found.draft.content.embed)
                result = yield* manage({ ...base, type: "edit", postNo: command.postNo, expectedGeneration: tracked.post.generation,
                    context: { botId: fresh.botId, channelId: tracked.post.channelId, botAuthorized: fresh.botPermissionAuthorized, actorAuthorized: fresh.nativePermissionAuthorized } })
            } else if (command.operation === "send") {
                const fresh = yield* readPublishingAuthority(client, config.serverId, actor.userId, command.channelId!, !!found.draft.content.embed)
                result = yield* manage({ ...base, type: "send", channelId: command.channelId!, context: { botId: fresh.botId, channelId: command.channelId!, botAuthorized: fresh.botPermissionAuthorized, actorAuthorized: fresh.nativePermissionAuthorized } })
            } else if (command.operation === "clone") result = yield* manage({ ...base, type: "draft-clone", toKind: command.toKind!, toName: command.toName! })
            else if (command.operation === "update") result = yield* manage({ ...base, type: "draft-update", edit: command.edit! })
            else result = yield* manage({ ...base, type: command.operation === "delete" ? "draft-delete" : "preview" })
        }
        if (result.duplicate) return
        if (result.type === "post") {
            if (!expectedDraft || !equalPublishingContent(result.grant.content, expectedDraft.content) || !equalPublishingContent(result.grant.canonicalContent, canonicalPublishingContent(expectedDraft.content))) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            const outcome = yield* performPublishingGrant(store, config.serverId, actor.userId, client, result.grant)
            yield* reply(`Post ${result.post.postNo}: ${outcome.outcome}${outcome.messageId ? `, message ${outcome.messageId}` : ""}${outcome.acknowledged ? "" : ". Outcome acknowledgement was not confirmed"}. Use ${prefix}publish status ${result.post.postNo}. No automatic replay`)
        } else if (result.type === "preview") {
            yield* readPublishingAuthority(client, config.serverId, actor.userId, message.channelId, !!result.draft.content.embed)
            yield* reply(`Preview of ${result.draft.kind} ${result.draft.name}, revision ${result.draft.revision}`)
            yield* context.reply(inputContent(result.draft.content))
        } else if (result.type === "draft") yield* reply(`${result.draft.kind === "template" ? "Template" : "Draft"} ${result.draft.name}, revision ${result.draft.revision}, saved. Use ${prefix}publish ${result.draft.kind === "template" ? "template " : ""}preview ${result.draft.name}`)
        else if (result.type === "deleted") yield* reply(`${result.kind === "template" ? "Template" : "Draft"} ${result.name} deleted. Tracked messages were not deleted`)
        else if (result.type === "forgotten") yield* reply(`Post ${result.postNo} forgotten. The provider message was not deleted`)
        else if (result.type === "resolved") yield* reply(`Resolved. ${postMessage(result.post)}. This did not resend or edit the message`)
        else yield* reply(`Publishing: ${result.settings.enabled ? "On" : "Off"}`)
    }).pipe(Effect.catch((error) => reply(error instanceof PublishingStoreError ? publishingErrorMessage(error) : "I couldn't verify or complete publishing. Inspect the current draft or tracked post before attempting another write")))
}
