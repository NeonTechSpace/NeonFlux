import type * as C from "@neonflux/backend/contracts"
import { ChannelOperationError, format, isThreadChannel, MessageError, MessageOperationError, type BotEventContext, type Client } from "@neontechspace/fluxerly/effect"
import { Cause, Clock, Data, Effect, Exit } from "effect"
import { randomUUID } from "node:crypto"
import type { BotConfig } from "./config.ts"
import { moderationActor } from "./moderation.ts"
import { sourceTimestamp, noMentions } from "./responses.ts"
import { publishingHelp, type PublishingCommand } from "./publishing-command.ts"
import { canonicalPublishingContent, equalPublishingContent, publishingMessageContent } from "./publishing-content.ts"
import { forumType, readEventsContext, readPublishingAuthority, verifyPublishingMessage } from "./publishing-permissions.ts"
import { publishingErrorMessage, PublishingStoreError, type PublishingStore } from "./publishing-store.ts"
import type { EventsStore } from "./event-store.ts"
import type { SchedulesStore } from "./schedule-store.ts"
import { handleScheduleCommand } from "./schedule-management.ts"
import { readSchedulesContext } from "./schedule-permissions.ts"
import { replyPrefix, withPrefix } from "./general-settings.ts"
import { nextPosition, noNextPage, pageKey, rememberPosition } from "./paging.ts"
import { code, notSetUp, onOff, replyCard, replyText, snippet, type Card } from "./reply-style.ts"

export class PublishingHandlingError extends Data.TaggedError("PublishingHandlingError")<{ readonly stage: "grant" | "snapshot" | "identity" }> {}
const inputContent = (value: C.PublishingContent) => ({ content: value.content, embeds: value.embed ? [value.embed] : [], allowedMentions: noMentions })

type PublishingStage = "grant" | "authorization" | "settings" | "baseline" | "claim" | "native" | "readback" | "acknowledgement"
const publishingFailureClasses = ["MessageError", "MessageOperationError", "ChannelOperationError", "ClientClosedError", "PublishingHandlingError", "PublishingPermissionError", "SafetyPermissionError", "PublishingStoreError", "TimeoutError"] as const
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
        const nativeOutcome = (failureClass === "MessageError" || failureClass === "MessageOperationError" || failureClass === "ChannelOperationError")
            && (value.outcome === "notDispatched" || value.outcome === "rejected" || value.outcome === "unknown") ? value.outcome : undefined
        const identityField = failureClass === "PublishingPermissionError" ? (["message", "channel", "guild", "author", "webhook"] as const).find((field) => field === value.field) : undefined
        return { stage, failureClass, ...(kind ? { kind } : {}), ...(status !== undefined ? { status } : {}),
            ...(retryAfterMs !== undefined ? { retryAfterMs } : {}), ...(nativeOutcome ? { nativeOutcome } : {}), ...(identityField ? { identityField } : {}) }
    } catch { return { stage, failureClass: "Unknown" } }
}

const consumerContextField = { event: "eventContext", schedule: "scheduleContext", milestone: "milestoneContext", "suggestion-card": "suggestionContext", youtube: "youtubeContext" } as const

export function performPublishingGrant(store: PublishingStore, serverId: string, actorId: string, client: Client, grant: C.PublishingGrant,
    consumerContext?: () => Effect.Effect<C.EventsContext | C.SchedulesAutomationContext | C.MilestonesDeliveryContext | C.SuggestionsCardContext | C.YoutubeDeliveryContext, unknown>,
    dashboardAuthority?: () => Effect.Effect<{ authority: Effect.Success<ReturnType<typeof readPublishingAuthority>>, dashboardContext: C.DashboardPublishingContext }, unknown>,
    configurationAuthority?: () => Effect.Effect<C.DashboardPublishingContext, unknown>, appliedTagIds?: readonly string[]) {
    return Effect.gen(function* () {
        // Suggestion and event cards may live in a forum: A send there creates a post, and an edit finds the card in that post. YouTube alerts are only sent
        const forum = grant.consumer?.type === "suggestion-card" || grant.consumer?.type === "event" ? "post" as const : grant.consumer?.type === "youtube" ? "forum" as const : false
        let dispatched = false
        let ownsClaim = false
        let claimRequested = false
        let canAbandon = false
        const progress: { stage: PublishingStage, identityPresence?: PublishingIdentityPresence } = { stage: "grant" }
        const claimToken = yield* Effect.sync(() => randomUUID().replaceAll("-", ""))
        let verifiedMessageId: string | undefined, createdThreadId: string | undefined
        const write = Effect.gen(function* () {
            if (grant.actorId !== actorId || !["send", "edit"].includes(grant.action)) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            canAbandon = true
            if (!Number.isSafeInteger(grant.dispatchExpiresAt) || grant.nativeDeadlineMs !== 5000
                || (yield* Clock.currentTimeMillis) >= grant.dispatchExpiresAt) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            progress.stage = "authorization"
            const dashboard = (grant.source?.type === "dashboard-role" || grant.source?.type === "dashboard-message") && dashboardAuthority ? yield* dashboardAuthority() : undefined
            if ((grant.source?.type === "dashboard-role" || grant.source?.type === "dashboard-message") && (!dashboard || dashboard.dashboardContext.jobId !== grant.source.jobId
                || dashboard.dashboardContext.actorId !== actorId || dashboard.dashboardContext.channelId !== grant.channelId
                || dashboard.dashboardContext.botId !== grant.botId || dashboard.dashboardContext.managerAuthorized !== true)) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            const authority = dashboard?.authority ?? (yield* readPublishingAuthority(client, serverId, actorId, grant.channelId, !!grant.content.embed, false, false, forum))
            if (authority.botId !== grant.botId) return yield* Effect.fail(new PublishingHandlingError({ stage: "identity" }))
            const createsPost = forumType(authority.channel!.type)
            if (createsPost && (grant.action !== "send" || grant.forumPostName === undefined)) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            progress.stage = "settings"
            // Automatic writes act as the bot. Their consumer fence checks the module and publishing switches at claim
            if (!dashboard && actorId !== grant.botId) {
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
                // An archived post accepts no edits, so its creator reopens it first. Reopening twice changes nothing
                const channel = authority.channel
                if (channel && isThreadChannel(channel) && channel.archived) yield* client.threads.edit(channel.id, { archived: false }, { timeoutMs: 5000 })
            }
            progress.stage = "claim"
            const freshContext = grant.consumer ? consumerContext ? yield* consumerContext() : undefined : undefined
            const actorContext = freshContext && ("automation" in freshContext ? freshContext.automation : freshContext)
            if (grant.consumer && (!actorContext || ("actor" in actorContext ? actorContext.actor.userId : actorContext.botId) !== actorId || actorContext.channelId !== grant.channelId
                || actorContext.botId !== grant.botId || (grant.consumer.type === "milestone") !== (freshContext !== undefined && "automation" in freshContext))) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            const configuration = grant.source?.type === "dashboard-configuration" && configurationAuthority ? yield* configurationAuthority() : undefined
            if (grant.source?.type === "dashboard-configuration" && (!configuration || configuration.jobId !== grant.source.jobId
                || configuration.channelId !== grant.channelId || configuration.botId !== grant.botId || configuration.managerAuthorized !== true
                || configuration.originServerId !== serverId)) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            claimRequested = true
            const claim = yield* store.dispatch({ serverId, postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, claimToken,
                ...(configuration ? { dashboardContext: configuration } : dashboard ? { dashboardContext: dashboard.dashboardContext } : {}),
                ...(freshContext && grant.consumer ? { [consumerContextField[grant.consumer.type]]: freshContext } : {}) })
            if (!claim.claimed || claim.dispatchExpiresAt !== grant.dispatchExpiresAt || claim.nativeDeadlineMs !== grant.nativeDeadlineMs) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            ownsClaim = true
            if (grant.nativeDeadlineMs !== 5000 || (yield* Clock.currentTimeMillis) >= grant.dispatchExpiresAt) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            progress.stage = "native"
            const nativeBudget = Math.min(grant.nativeDeadlineMs, grant.dispatchExpiresAt - (yield* Clock.currentTimeMillis))
            if (nativeBudget <= 0) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            dispatched = true
            // In a forum or media channel the content becomes the first message of a new post
            const post = createsPost ? yield* client.threads.createPost(grant.channelId, { name: grant.forumPostName!, message: inputContent(grant.content),
                ...(appliedTagIds?.length ? { appliedTagIds } : {}) }, { timeoutMs: nativeBudget }) : undefined
            const returned = post ? post.message : grant.action === "send"
                ? yield* client.messages.send(grant.channelId, inputContent(grant.content), { timeoutMs: nativeBudget })
                : yield* client.messages.edit({ channelId: grant.channelId, id: grant.messageId! }, inputContent(grant.content), { timeoutMs: nativeBudget })
            progress.stage = "readback"
            const messageChannelId = post ? post.thread.id : grant.channelId
            progress.identityPresence = { guildSupplied: returned.guildId !== undefined, suppliedGuildMatches: returned.guildId === undefined || returned.guildId === serverId,
                channelMatches: returned.channelId === messageChannelId, authorMatches: returned.author.id === grant.botId,
                reportedBot: returned.author.isBot, webhookPresent: !!returned.webhookId }
            if (post && (post.thread.parentId !== grant.channelId || post.thread.guildId !== serverId)) return yield* Effect.fail(new PublishingHandlingError({ stage: "identity" }))
            yield* verifyPublishingMessage(returned, { serverId, channelId: messageChannelId, messageId: grant.action === "edit" ? grant.messageId! : returned.id, botId: grant.botId,
                verifiedChannel: post ? post.thread : authority.channel! })
            verifiedMessageId = returned.id
            if (post) createdThreadId = post.thread.id
            const comparable = publishingMessageContent(returned)
            if (!comparable || !equalPublishingContent(comparable, canonicalPublishingContent(grant.canonicalContent))) return yield* Effect.fail(new PublishingHandlingError({ stage: "snapshot" }))
            return returned.id
        })
        const result = yield* Effect.exit(write)
        if (Exit.isFailure(result) && Cause.hasInterrupts(result.cause)) return yield* Effect.failCause(result.cause)
        const failure = Exit.isFailure(result) ? result.cause.reasons.find((reason) => reason._tag === "Fail" || reason._tag === "Die") : undefined
        const diagnostic = failure ? publishingDiagnostic(progress.stage, failure._tag === "Fail" ? failure.error : undefined) : undefined
        const noDispatch = Exit.isFailure(result) && result.cause.reasons.length > 0 && result.cause.reasons.every((reason) => reason._tag === "Fail"
            && (reason.error instanceof MessageError || reason.error instanceof MessageOperationError || reason.error instanceof ChannelOperationError) && reason.error.outcome === "notDispatched")
        const unknown = Exit.isFailure(result) && dispatched && !(progress.stage === "native"
            && noDispatch)
        const outcome = Exit.isSuccess(result) ? "sent" : unknown ? "uncertain" : "failed"
        const messageId = Exit.isSuccess(result) ? result.value : unknown ? verifiedMessageId : undefined
        const diagnostics = diagnostic ? [diagnostic] : []
        if (!ownsClaim && (claimRequested || !canAbandon)) return { outcome, acknowledged: false, ...(diagnostics.length ? { diagnostics } : {}) }
        const acknowledged = yield* store.outcome({ serverId, postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation,
            sourceId: grant.sourceId, outcome, ...(ownsClaim ? { claimToken } : {}), ...(messageId ? { messageId, ...(createdThreadId ? { threadId: createdThreadId } : {}) } : {}) }).pipe(Effect.match({
                onFailure: (error) => { diagnostics.push(publishingDiagnostic("acknowledgement", error)); return false }, onSuccess: (value) => value.recorded }))
        return { outcome, acknowledged, ...(messageId ? { messageId } : {}), ...(diagnostics.length ? { diagnostics } : {}),
            ...(progress.identityPresence ? { identityPresence: progress.identityPresence } : {}) }
    })
}

/** The parts a post's embed has, in one line, such as title, description, 3 fields, image */
export function embedParts(embed: C.PublishingContent["embed"]) {
    if (!embed) return "None"
    const fields = embed.fields?.length ?? 0
    return [embed.title && "title", embed.description && "description", fields && `${fields} field${fields === 1 ? "" : "s"}`, embed.image && "image", embed.thumbnail && "thumbnail",
        embed.author && "author", embed.footer && "footer", embed.url && "link", embed.color !== undefined && "colour", embed.timestamp && "timestamp"].filter(Boolean).join(", ") || "Empty"
}
/** A draft or template in short: The start of its message text and its embed's parts. The whole post shows with preview */
export function publishingDraftCard(draft: Pick<C.PublishingDraft, "kind" | "name" | "content">, prefix: string): Card {
    const text = draft.content.content
    return { title: `${draft.kind === "template" ? "Template" : "Draft"} ${draft.name}`,
        fields: [["Message text", text ? snippet(text, 80) : "None"], ["Embed", embedParts(draft.content.embed)]],
        note: `See the whole post with ${code(`${prefix}publish ${draft.kind === "template" ? "template " : ""}preview ${draft.name}`)}` }
}
function postSource(post: C.PublishingPost, prefix: string) {
    const p = post.attempt.provenance, c = post.consumer
    if (c?.type === "suggestion-card") return `The card of suggestion #${c.suggestionNo}`
    if (p?.type === "event") return c?.type === "event" && c.purpose === "reminder" ? "An event reminder" : "An event card"
    if (p?.type === "schedule") return `Schedule post from ${p.source.kind} ${p.source.name}`
    if (p?.type === "milestone") return `${p.kind === "birthday" ? "Birthday" : "Anniversary"} celebration`
    if (p?.type === "showcase") return `Showcase #${p.showcaseNo}`
    if (p?.type === "youtube") return "YouTube alert"
    if (p?.type === "dashboard-role") return `Role panel ${p.panelName}`
    if (p?.type === "dashboard-message") return "Dashboard message"
    return post.attempt.draftName ? `${post.attempt.draftKind === "template" ? "Template" : "Draft"} ${post.attempt.draftName}` : `Sent with ${prefix}publish`
}
/** Where a post stands, in words. An unconfirmed post names the command that checks it */
export const postState = (post: Pick<C.PublishingPost, "outcome" | "channelId">, check: string) => {
    const where = format.channelMention(post.channelId)
    return post.outcome === "sent" ? `Posted in ${where}` : post.outcome === "pending" ? `Sending to ${where}` : post.outcome === "failed" ? `Could not be posted in ${where}` : `Not confirmed yet, run ${check}`
}
/** The reply once NeonFlux sent or edited a post, or could not say whether it did */
export const grantOutcome = (outcome: { outcome: string, acknowledged: boolean }, label: string, grant: Pick<C.PublishingGrant, "channelId" | "action">, check: string, status: string) => {
    const where = format.channelMention(grant.channelId), done = grant.action === "edit" ? "updated" : "posted"
    return `${outcome.outcome === "sent" ? `${label} is ${done} in ${where}` : outcome.outcome === "failed" ? `${label} could not be ${done} in ${where}` : `${label} is not confirmed yet, run ${check}`}`
        + `${outcome.acknowledged ? "" : `. NeonFlux could not record the result, so check it with ${status}`}`
}
/** What a check of a post's message found. A check records what Fluxer shows and never sends, edits or deletes */
export function checkedPost(post: C.PublishingPost, label: string) {
    const matched = post.attempt.resolution?.matched, where = format.channelMention(post.channelId)
    return `${matched === "intended" || !matched && post.outcome === "sent" ? `${label} is confirmed in ${where}` : matched === "previous" ? `${label} still shows its earlier content in ${where}, so the last change did not arrive`
        : post.outcome === "uncertain" ? `${label} could not be confirmed, because its message in ${where} does not match what NeonFlux sent` : `${label} was checked. ${postState(post, "")}`}. Nothing was sent, edited or deleted`
}
export const unknownMessage = (post: Pick<C.PublishingPost, "postNo">) => `NeonFlux does not know which message post #${post.postNo} is, so it cannot check it. Nothing was sent again`

export function handlePublishing(store: PublishingStore, config: BotConfig, command: PublishingCommand | { error: string }, context: BotEventContext<"messageCreate">,
    schedules?: SchedulesStore, scheduleWorker?: { notify: () => Effect.Effect<void> }, events?: EventsStore) {
    const prefix = replyPrefix(config.serverId, context.message.guildId)
    const reply = (content: string) => replyText(context, content), card = (value: Card) => replyCard(context, config.serverId, value)
    // An unconfirmed post is checked with reconcile, which names the owning feature's command. A plain post whose message is unknown is settled by hand
    const resolve = (postNo: number) => `${code(`${prefix}publish resolve ${postNo} sent <message-id>`)} or ${code(`${prefix}publish resolve ${postNo} failed`)}`
    const check = (post: C.PublishingPost) => post.messageId || post.consumer ? code(`${prefix}publish reconcile ${post.postNo}`) : resolve(post.postNo)
    // A list line says only that a post is not confirmed. One note under the list names the commands that settle it
    const postLine = (post: C.PublishingPost) => `**#${post.postNo}** ${postSource(post, prefix)}: ${post.outcome === "uncertain" ? "Not confirmed yet" : postState(post, "")}`
    return Effect.gen(function* () {
        if (!("error" in command) && command.type === "schedule") {
            if (!schedules) yield* reply(notSetUp("Scheduled posts"))
            else yield* handleScheduleCommand(schedules, store, config, command.command, context, scheduleWorker)
            return
        }
        const { client, message } = context
        const authority = yield* readPublishingAuthority(client, config.serverId, message.author.id)
        const actor = moderationActor(authority)
        if ("error" in command) { yield* reply(command.error); return }
        if (command.type === "help") { yield* reply(withPrefix(publishingHelp, prefix)); return }
        const query = (operation: C.PublishingQueryRequest["operation"]) => store.query({ serverId: config.serverId, actor, operation })
        const createdAt = yield* sourceTimestamp(message)
        const manage = (operation: C.PublishingManageOperation) => store.manage({ serverId: config.serverId, actor, messageId: message.id, createdAt, operation })
        // Schedule commands name the schedule, so a reply about a scheduled post reads its schedule's name
        const scheduleName = (scheduleNo: number) => !schedules ? Effect.succeed(String(scheduleNo)) : readSchedulesContext(client, config.serverId, actor.userId, message.channelId).pipe(
            Effect.flatMap(context => schedules.query({ serverId: config.serverId, context, operation: { type: "show", scheduleNo } })), Effect.map(result => result.type === "schedule" ? result.schedule.name : String(scheduleNo)))
        // Event commands name the event too. Without a readable name the reply shows a placeholder, since a number would be read as a name
        const eventName = (eventNo: number) => !events ? Effect.succeed(undefined) : readEventsContext(client, config.serverId, actor.userId, message.channelId, { staff: true, forum: "post" }).pipe(
            Effect.flatMap(context => events.query({ serverId: config.serverId, context, operation: { type: "show", eventNo } })),
            Effect.map(result => result.type === "event" ? result.event.name : undefined), Effect.catch(() => Effect.succeed(undefined)))
        if (command.type === "query") {
            // Draft, template and post lists page with next, which continues where this member's last page of that list ended
            const op = command.operation, start = op.type === "draft-list" ? `!publish ${op.kind === "template" ? "template " : ""}list` : "!publish posts", key = pageKey(config.serverId, message, start)
            const position = command.next ? nextPosition<number>(key) : 0
            if (position === undefined) { yield* reply(withPrefix(noNextPage(start), prefix)); return }
            const result = yield* query(!position ? op : op.type === "draft-list" ? { ...op, page: position } : { type: "post-list", beforePostNo: position })
            const next = (more: unknown): NonNullable<Card["fields"]> => more ? [["Next", code(`${withPrefix(start, prefix)} next`)]] : []
            if (result.type === "draft") yield* card(publishingDraftCard(result.draft, prefix))
            if (result.type === "drafts") {
                const kind = result.kind === "template" ? "templates" : "drafts"
                rememberPosition(key, result.page < result.totalPages ? result.page + 1 : undefined)
                yield* card({ title: result.kind === "template" ? "Templates" : "Drafts", description: result.drafts.map(d => d.name).join("\n") || `No ${kind} yet`,
                    fields: next(result.page < result.totalPages) })
            }
            if (result.type === "post") yield* card({ title: `Post #${result.post.postNo}`, fields: [["From", postSource(result.post, prefix)], ["Status", postState(result.post, check(result.post))]] })
            if (result.type === "posts") {
                rememberPosition(key, result.nextBeforePostNo)
                yield* card({ title: "Posts", description: result.posts.map(postLine).join("\n") || "No posts yet", fields: next(result.nextBeforePostNo),
                    ...(result.posts.some(post => post.outcome === "uncertain") ? { note: `Check a post that is not confirmed with ${code(`${prefix}publish reconcile <post>`)}, `
                        + `or record it with ${code(`${prefix}publish resolve <post> sent <message-id>|failed`)} when NeonFlux does not know its message` } : {}) })
            }
            if (result.type === "settings") yield* card({ title: "Publishing", fields: [["Status", onOff(result.settings.enabled)]] })
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
                    yield* reply(`Message ${command.messageId} in ${format.channelMention(post.channelId)} is not NeonFlux's message with post #${post.postNo}'s content, so nothing changed`)
                    return
                }
                result = yield* manage({ ...target, outcome: "sent", messageId: command.messageId!, channelId: post.channelId, botId: fresh.botId, content })
            }
        } else if (command.type === "reconcile" || command.type === "forget") {
            const found = yield* query({ type: "post-show", postNo: command.postNo })
            if (found.type !== "post") return yield* Effect.fail(new PublishingHandlingError({ stage: "identity" }))
            const post = found.post
            if (post.consumer?.type === "suggestion-card") { yield* reply(`Post #${post.postNo} is the card of suggestion #${post.consumer.suggestionNo}. Use ${code(`${prefix}suggest publication ${post.consumer.suggestionNo}`)}`); return }
            // A YouTube alert is reconciled like any post, and NeonFlux forgets it on its own 30 days after it was posted
            if (post.consumer?.type === "youtube" && command.type === "forget") { yield* reply(`Post #${post.postNo} is a YouTube alert. NeonFlux forgets it on its own 30 days after the video's notification`); return }
            const schedule = post.consumer?.type === "schedule" ? yield* scheduleName(post.consumer.scheduleNo) : undefined
            const event = post.consumer?.type === "event" ? yield* eventName(post.consumer.eventNo) : undefined
            if (post.consumer && post.consumer.type !== "youtube") { yield* reply(post.consumer.type === "schedule" ? `Post #${post.postNo} belongs to schedule ${schedule}. Use ${code(`${prefix}publish schedule ${command.type} ${schedule}${command.type === "reconcile" ? ` ${post.postNo}` : ""}`)}${command.type === "forget" ? " once its posts are settled" : ""}`
                : post.consumer.type === "milestone" ? `Post #${post.postNo} is a ${post.consumer.kind} celebration. Use ${code(`!milestone ${command.type} ${post.consumer.kind} ${post.postNo}${command.type === "forget" ? " confirm" : ""}`)} in a DM with NeonFlux`
                : `Post #${post.postNo} belongs to ${event ? `event ${event}` : "an event"}. Use ${code(`${prefix}event ${command.type} ${event ?? "<name>"}${command.type === "reconcile" ? ` ${post.postNo}` : ""}`)}${command.type === "forget" ? " once its posts are settled" : ""}`); return }
            if (command.type === "forget") result = yield* manage({ type: "forget", postNo: post.postNo, expectedGeneration: post.generation })
            else {
                if (!post.messageId) { yield* reply(`${unknownMessage(post)}${post.consumer ? "" : `. If you find it in ${format.channelMention(post.channelId)}, run ${resolve(post.postNo)}`}`); return }
                const fresh = yield* readPublishingAuthority(client, config.serverId, actor.userId, post.channelId, false, true)
                const native = yield* client.messages.fetch({ channelId: post.channelId, id: post.messageId }, { timeoutMs: 5000 })
                yield* verifyPublishingMessage(native, { serverId: config.serverId, channelId: post.channelId, messageId: post.messageId, botId: fresh.botId, verifiedChannel: fresh.channel! })
                if (fresh.botId !== post.botId) return yield* Effect.fail(new PublishingHandlingError({ stage: "identity" }))
                const content = publishingMessageContent(native)
                if (!content) return yield* Effect.fail(new PublishingHandlingError({ stage: "snapshot" }))
                const recorded = yield* store.reconcile({ serverId: config.serverId, actor: moderationActor(fresh), messageId: message.id, createdAt,
                    postNo: post.postNo, attemptId: post.attempt.attemptId, expectedGeneration: post.generation,
                    observation: { originServerId: config.serverId, observedAt: yield* Clock.currentTimeMillis, messageId: native.id, channelId: native.channelId, botId: native.author.id, content } })
                yield* reply(checkedPost(recorded.post, `Post #${post.postNo}`))
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
                if (tracked.post.consumer?.type === "suggestion-card") { yield* reply(`Post #${tracked.post.postNo} is the card of suggestion #${tracked.post.consumer.suggestionNo}, which changes with the suggestion`); return }
                if (tracked.post.consumer?.type === "youtube") { yield* reply(`Post #${tracked.post.postNo} is a YouTube alert, which NeonFlux does not edit`); return }
                const schedule = tracked.post.consumer?.type === "schedule" ? yield* scheduleName(tracked.post.consumer.scheduleNo) : undefined
                const event = tracked.post.consumer?.type === "event" ? yield* eventName(tracked.post.consumer.eventNo) : undefined
                if (tracked.post.consumer) { yield* reply(tracked.post.consumer.type === "schedule" ? `Post #${tracked.post.postNo} belongs to schedule ${schedule}. Change its later posts with ${code(`${prefix}publish schedule update ${schedule} content …`)}`
                    : tracked.post.consumer.type === "milestone" ? `Post #${tracked.post.postNo} is a ${tracked.post.consumer.kind} celebration. Change later ones with ${code(`${prefix}milestone configure`)}`
                    : `Post #${tracked.post.postNo} belongs to ${event ? `event ${event}` : "an event"}. Change the event with ${code(`${prefix}event`)}, and its card follows`); return }
                const fresh = yield* readPublishingAuthority(client, config.serverId, actor.userId, tracked.post.channelId, !!found.draft.content.embed)
                result = yield* manage({ ...base, type: "edit", postNo: command.postNo, expectedGeneration: tracked.post.generation,
                    context: { originServerId: fresh.guild.id, botId: fresh.botId, channelId: tracked.post.channelId, botAuthorized: fresh.botPermissionAuthorized, actorAuthorized: fresh.nativePermissionAuthorized } })
            } else if (command.operation === "send") {
                const fresh = yield* readPublishingAuthority(client, config.serverId, actor.userId, command.channelId!, !!found.draft.content.embed)
                result = yield* manage({ ...base, type: "send", channelId: command.channelId!, context: { originServerId: fresh.guild.id, botId: fresh.botId, channelId: command.channelId!, botAuthorized: fresh.botPermissionAuthorized, actorAuthorized: fresh.nativePermissionAuthorized } })
            } else if (command.operation === "clone") result = yield* manage({ ...base, type: "draft-clone", toKind: command.toKind!, toName: command.toName! })
            else if (command.operation === "update") result = yield* manage({ ...base, type: "draft-update", edit: command.edit! })
            else result = yield* manage({ ...base, type: command.operation === "delete" ? "draft-delete" : "preview" })
        }
        if (result.duplicate) return
        if (result.type === "post") {
            if (!expectedDraft || !equalPublishingContent(result.grant.content, expectedDraft.content) || !equalPublishingContent(result.grant.canonicalContent, canonicalPublishingContent(expectedDraft.content))) return yield* Effect.fail(new PublishingHandlingError({ stage: "grant" }))
            const outcome = yield* performPublishingGrant(store, config.serverId, actor.userId, client, result.grant)
            const postNo = result.post.postNo
            yield* reply(grantOutcome(outcome, `Post #${postNo}`, result.grant, outcome.messageId ? code(`${prefix}publish reconcile ${postNo}`) : resolve(postNo), code(`${prefix}publish status ${postNo}`)))
        } else if (result.type === "preview") {
            yield* readPublishingAuthority(client, config.serverId, actor.userId, message.channelId, !!result.draft.content.embed)
            yield* reply(`Preview of ${result.draft.kind} ${result.draft.name}:`)
            yield* context.reply(inputContent(result.draft.content))
        } else if (result.type === "draft") yield* reply(`${result.draft.kind === "template" ? "Template" : "Draft"} ${result.draft.name} saved. Preview it with ${code(`${prefix}publish ${result.draft.kind === "template" ? "template " : ""}preview ${result.draft.name}`)}`)
        else if (result.type === "deleted") yield* reply(`${result.kind === "template" ? "Template" : "Draft"} ${result.name} deleted. Posted messages stay`)
        else if (result.type === "forgotten") yield* reply(`Post #${result.postNo} forgotten. Its message stays`)
        else if (result.type === "resolved") yield* reply(`Post #${result.post.postNo} is now recorded as ${result.post.outcome === "sent" ? `posted in ${format.channelMention(result.post.channelId)}` : "not posted"}. Nothing was sent or edited`)
        else yield* reply(`Publishing is ${result.settings.enabled ? "on" : "off"}`)
    }).pipe(Effect.catch((error) => reply(error instanceof PublishingStoreError ? publishingErrorMessage(error) : "NeonFlux could not check your access, the channel or the post. Check the draft or post before you try again")))
}
