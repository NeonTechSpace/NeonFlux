import { Schema } from "effect"
import { Id, Int, IsoTime, List, Millis, Token, isId, origin } from "./common.ts"

// Message content and the publishing grants, attempts and posts that every posting feature shares

export const publishingText = (value: string) => value.replace(/[\u000c\u202e]/g, "").trim()
const text = (max: number, empty = false) => Schema.String.check(Schema.makeFilter((value: string) => value.length <= max && (empty || !!publishingText(value))))
const url = Schema.String.check(Schema.makeFilter((value: string) => {
    try { const parsed = new URL(value); return value.length <= 2048 && parsed.href.length <= 2048 && ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password } catch { return false }
}))
const timestamp = Schema.String.check(Schema.makeFilter((value: string) => {
    const match = /^(\d{4})-(\d\d)-(\d\d)T\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.exec(value)
    if (!match || value.length > 128 || !Number.isFinite(Date.parse(value))) return false
    const month = Number(match[2]), day = Number(match[3])
    const year = Number(match[1]), leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
    return month >= 1 && month <= 12 && day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!
}))
const optional = Schema.optionalKey
/** A lowercase draft, template or panel name */
export const PublishingName = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,31}$/))

export const PublishingEmbedField = Schema.Struct({ name: text(256), value: text(1024, true), inline: optional(Schema.Boolean) })
export type PublishingEmbedField = typeof PublishingEmbedField.Type
/** Fluxer's embed limits, with at most 6000 characters of text in all */
export const PublishingEmbed = Schema.Struct({
    title: optional(text(256, true)), description: optional(text(4096, true).check(Schema.makeFilter((value: string) => value === "" || !!publishingText(value)))), url: optional(url),
    color: optional(Int(0, 0xffffff)), timestamp: optional(timestamp),
    author: optional(Schema.Struct({ name: text(256), url: optional(url), iconUrl: optional(url) })),
    footer: optional(Schema.Struct({ text: text(2048), iconUrl: optional(url) })),
    image: optional(Schema.Struct({ url, description: optional(text(4096)) })),
    thumbnail: optional(Schema.Struct({ url, description: optional(text(4096)) })),
    fields: optional(List(PublishingEmbedField, 25)),
}).check(Schema.makeFilter((value) => [value.title ?? "", value.description ?? "", value.author?.name ?? "", value.footer?.text ?? "", value.image?.description ?? "",
    value.thumbnail?.description ?? "", ...(value.fields ?? []).flatMap((field) => [field.name, field.value])].reduce((sum, value) => sum + value.length, 0) <= 6000))
export type PublishingEmbed = typeof PublishingEmbed.Type
export const PublishingContent = Schema.Struct({ content: text(2000, true), embed: optional(PublishingEmbed) })
export type PublishingContent = typeof PublishingContent.Type
export const PublishingKind = Schema.Literals(["draft", "template"])
export type PublishingKind = typeof PublishingKind.Type
export const PublishingOutcome = Schema.Literals(["pending", "sent", "failed", "uncertain"])
export type PublishingOutcome = typeof PublishingOutcome.Type

/** Content as Fluxer stores it: trimmed text, absolute URLs, ISO timestamps and an embed color */
export function canonicalPublishingContent(value: PublishingContent): PublishingContent {
    const result: PublishingContent = { content: publishingText(value.content) }
    const input = value.embed
    if (!input) return result
    const embed: { -readonly [K in keyof PublishingEmbed]: PublishingEmbed[K] } = {}
    for (const field of ["title", "description"] as const) if (input[field] !== undefined && publishingText(input[field]!)) embed[field] = publishingText(input[field]!)
    if (input.url !== undefined) embed.url = new URL(input.url).href
    if (input.color !== undefined) embed.color = input.color
    if (input.timestamp !== undefined) embed.timestamp = new Date(input.timestamp).toISOString()
    if (input.author) embed.author = { name: publishingText(input.author.name), ...(input.author.url !== undefined ? { url: new URL(input.author.url).href } : {}), ...(input.author.iconUrl !== undefined ? { iconUrl: new URL(input.author.iconUrl).href } : {}) }
    if (input.footer) embed.footer = { text: publishingText(input.footer.text), ...(input.footer.iconUrl !== undefined ? { iconUrl: new URL(input.footer.iconUrl).href } : {}) }
    for (const field of ["image", "thumbnail"] as const) if (input[field]) embed[field] = { url: new URL(input[field]!.url).href, ...(input[field]!.description !== undefined ? { description: publishingText(input[field]!.description!) } : {}) }
    if (input.fields?.length) embed.fields = input.fields.map((field) => ({ name: publishingText(field.name), value: publishingText(field.value), ...(field.inline ? { inline: true } : {}) }))
    return Object.keys(embed).length ? { ...result, embed: { color: embed.color ?? 0, ...embed } } : result
}
export function equalPublishingContent(actual: PublishingContent, expected: PublishingContent) {
    const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => [k,normalize(v)])) : value
    return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected))
}
const equalUnknown = (left: unknown, right: unknown) => equalPublishingContent(left as PublishingContent, right as PublishingContent)

export const PublishingObservation = Schema.Struct({ ...origin, observedAt: Millis, messageId: Id, channelId: Id, botId: Id, content: PublishingContent })
export type PublishingObservation = typeof PublishingObservation.Type
export const PublishingResolution = Schema.Struct({ attemptId: Token, generation: Int(1), sourceId: Token, observedAt: Millis, matched: Schema.Literals(["intended", "previous"]) })
export type PublishingResolution = typeof PublishingResolution.Type

// Bindings of the features that post through publishing
export const SuggestionsCardBinding = Schema.Struct({ suggestionNo: Int(1), cardGeneration: Int(1), desiredRevision: Int(1) })
export type SuggestionsCardBinding = typeof SuggestionsCardBinding.Type
export const MilestonesKind = Schema.Literals(["birthday", "anniversary"])
export type MilestonesKind = typeof MilestonesKind.Type
export const MilestonesTemplateSource = Schema.Struct({ name: PublishingName, revision: Int(1) })
export type MilestonesTemplateSource = typeof MilestonesTemplateSource.Type
export const SchedulesContentSource = Schema.Struct({ kind: PublishingKind, name: PublishingName, revision: Int(1) })
export type SchedulesContentSource = typeof SchedulesContentSource.Type
export const MilestonesDeliveryBinding = Schema.Struct({ deliveryId: Token, kind: MilestonesKind, intentRevision: Int(1), userId: Id, joinedAt: IsoTime, consentRevision: Int(1),
    audienceGeneration: Int(1), celebrationYear: Int(100, 9999), completedYears: Int(0, 9999), generation: Int(1) })
export type MilestonesDeliveryBinding = typeof MilestonesDeliveryBinding.Type

export const PublishingYoutubeConsumer = Schema.Struct({ type: Schema.Literal("youtube"), youtubeChannelId: Schema.String.check(Schema.isPattern(/^UC[A-Za-z0-9_-]{22}$/)),
    videoId: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{11}$/)) })
export type PublishingYoutubeConsumer = typeof PublishingYoutubeConsumer.Type
export const PublishingSuggestionConsumer = Schema.Struct({ type: Schema.Literal("suggestion-card"), ...SuggestionsCardBinding.fields })
export type PublishingSuggestionConsumer = typeof PublishingSuggestionConsumer.Type
export const PublishingMilestoneConsumer = Schema.Struct({ type: Schema.Literal("milestone"), ...MilestonesDeliveryBinding.fields })
    .check(Schema.makeFilter(v => v.kind === "birthday" ? v.completedYears === 0 : v.completedYears >= 1))
export type PublishingMilestoneConsumer = typeof PublishingMilestoneConsumer.Type
export const PublishingEventConsumer = Schema.Struct({ type: Schema.Literal("event"), eventNo: Int(1), revision: Int(1), purpose: Schema.Literals(["card", "reminder"]),
    occurrenceNo: optional(Int(1)), offsetMinutes: optional(Int(1, 10080)), deliveryId: optional(Token) }).check(Schema.makeFilter(v => v.purpose === "card"
        ? v.occurrenceNo === undefined && v.offsetMinutes === undefined && v.deliveryId === undefined
        : v.occurrenceNo !== undefined && v.offsetMinutes !== undefined && v.deliveryId !== undefined))
export type PublishingEventConsumer = typeof PublishingEventConsumer.Type
export const PublishingScheduleConsumer = Schema.Struct({ type: Schema.Literal("schedule"), scheduleNo: Int(1), planRevision: Int(1), occurrenceNo: Int(1), deliveryId: Token })
export type PublishingScheduleConsumer = typeof PublishingScheduleConsumer.Type
export const PublishingConsumer = Schema.Union([PublishingEventConsumer, PublishingScheduleConsumer, PublishingMilestoneConsumer, PublishingSuggestionConsumer, PublishingYoutubeConsumer])
export type PublishingConsumer = typeof PublishingConsumer.Type

export const PublishingSource = Schema.Union([
    PublishingYoutubeConsumer,
    Schema.Struct({ type: Schema.Literal("dashboard-message"), jobId: Token, createdAt: Millis }),
    Schema.Struct({ type: Schema.Literal("showcase"), jobId: Token, createdAt: Millis }),
    Schema.Struct({ type: Schema.Literal("dashboard-role"), jobId: Token, createdAt: Millis }),
    Schema.Struct({ type: Schema.Literal("dashboard-configuration"), jobId: Token, family: Schema.Literal("events"), createdAt: Millis }),
    PublishingSuggestionConsumer,
    Schema.Struct({ type: Schema.Literal("human"), messageId: Id, createdAt: Millis }),
    Schema.Struct({ type: Schema.Literal("event-timer"), deliveryId: Token, dueAt: Millis }),
    Schema.Struct({ type: Schema.Literal("schedule-timer"), deliveryId: Token, dueAt: Millis }),
    Schema.Struct({ type: Schema.Literal("milestone-timer"), deliveryId: Token, dueAt: Millis }),
])
export type PublishingSource = typeof PublishingSource.Type
export const PublishingProvenance = Schema.Union([
    PublishingYoutubeConsumer,
    Schema.Struct({ type: Schema.Literal("dashboard-message"), jobId: Token }),
    Schema.Struct({ type: Schema.Literal("showcase"), showcaseNo: Int(1) }),
    Schema.Struct({ type: Schema.Literal("dashboard-role"), jobId: Token, panelName: PublishingName, panelRevision: Int(1) }),
    PublishingSuggestionConsumer,
    Schema.Struct({ type: Schema.Literal("draft"), kind: PublishingKind, name: PublishingName, revision: Int(1) }),
    Schema.Struct({ type: Schema.Literal("event"), eventNo: Int(1), revision: Int(1), template: optional(Schema.Struct({ name: PublishingName, revision: Int(1) })) }),
    Schema.Struct({ type: Schema.Literal("schedule"), scheduleNo: Int(1), planRevision: Int(1), source: SchedulesContentSource }),
    Schema.Struct({ type: Schema.Literal("milestone"), kind: MilestonesKind, intentRevision: Int(1), template: MilestonesTemplateSource }),
])
export type PublishingProvenance = typeof PublishingProvenance.Type

/** The fields of a grant to post or edit one message. An attempt adds its outcome */
export const publishingGrantFields = {
    attemptId: Token, postNo: Int(1), generation: Int(1), sourceId: Token, actorId: Id, botId: Id,
    action: Schema.Literals(["send", "edit"]), channelId: Id, messageId: optional(Id),
    draftKind: optional(PublishingKind), draftName: optional(PublishingName), draftRevision: optional(Int(1)),
    source: optional(PublishingSource), provenance: optional(PublishingProvenance), consumer: optional(PublishingConsumer),
    content: PublishingContent, canonicalContent: PublishingContent, expectedContent: optional(PublishingContent),
    /** A send to a forum or media channel creates a post with this name, whose first message is the content. threadId is the post it created */
    forumPostName: optional(Schema.String.check(Schema.makeFilter((value: string) => value.trim().length > 0 && value.length <= 100))), threadId: optional(Id),
    dispatchExpiresAt: Int(1), nativeDeadlineMs: Schema.Literal(5000),
}
type GrantFields = Schema.Struct<typeof publishingGrantFields>["Type"]
const canonical = (value: { content: PublishingContent, canonicalContent: PublishingContent }) => equalPublishingContent(value.canonicalContent, canonicalPublishingContent(value.content))
// The provenance of a grant must match its source, consumer and source ID
function boundProvenance(v: GrantFields) {
    if (v.provenance?.type === "youtube") return v.action === "send" && equalUnknown(v.source, v.provenance) && equalUnknown(v.consumer, v.provenance)
        && v.sourceId === `youtube_${v.provenance.youtubeChannelId}_${v.provenance.videoId}` && v.draftKind === undefined && v.draftName === undefined && v.draftRevision === undefined
    if (v.provenance?.type === "dashboard-message") return v.source?.type === "dashboard-message" && v.source.jobId === v.provenance.jobId
        && v.sourceId === `dashboard_message_${v.source.jobId}` && v.action === "send" && !v.consumer && v.draftKind === undefined
    if (v.provenance?.type === "showcase") return v.source?.type === "showcase" && v.sourceId === `showcase_${v.source.jobId}` && !v.consumer && v.draftKind === undefined
    if (v.provenance?.type === "dashboard-role") return v.source?.type === "dashboard-role" && v.source.jobId === v.provenance.jobId
        && v.sourceId === `dashboard_${v.source.jobId}` && v.action === "send" && !v.consumer && v.draftKind === undefined
    if (v.provenance?.type === "suggestion-card") return v.source?.type === "suggestion-card" && v.consumer?.type === "suggestion-card"
        && v.source.suggestionNo === v.consumer.suggestionNo && v.source.cardGeneration === v.consumer.cardGeneration && v.source.desiredRevision === v.consumer.desiredRevision
        && v.provenance.suggestionNo === v.consumer.suggestionNo && v.provenance.cardGeneration === v.consumer.cardGeneration && v.provenance.desiredRevision === v.consumer.desiredRevision
        && v.sourceId === `suggestion_${v.consumer.suggestionNo}_${v.consumer.cardGeneration}_${v.consumer.desiredRevision}_${v.generation}`
        && v.draftKind === undefined && v.draftName === undefined && v.draftRevision === undefined
    if (v.provenance?.type === "milestone") return v.action === "send" && v.source?.type === "milestone-timer" && v.consumer?.type === "milestone"
        && v.consumer.kind === v.provenance.kind && v.consumer.intentRevision === v.provenance.intentRevision && v.consumer.deliveryId === v.source.deliveryId
        && v.sourceId === `milestone_timer_${v.source.deliveryId}` && v.draftKind === undefined && v.draftName === undefined && v.draftRevision === undefined
    if (v.provenance?.type === "schedule") return v.action === "send" && v.source?.type === "schedule-timer" && v.consumer?.type === "schedule"
        && v.consumer.scheduleNo === v.provenance.scheduleNo && v.consumer.planRevision === v.provenance.planRevision && v.consumer.deliveryId === v.source.deliveryId
        && v.sourceId === `schedule_timer_${v.source.deliveryId}` && v.draftKind === undefined && v.draftName === undefined && v.draftRevision === undefined
    if (v.provenance?.type === "event") return v.source !== undefined && v.consumer?.type === "event" && v.consumer.eventNo === v.provenance.eventNo && v.consumer.revision === v.provenance.revision
        && v.draftKind === undefined && v.draftName === undefined && v.draftRevision === undefined
        && (v.source.type === "human" ? v.source.messageId === v.sourceId && v.consumer.purpose === "card"
            : v.source.type === "dashboard-configuration" ? v.sourceId === v.source.jobId && v.consumer.purpose === "card"
            : v.source.type === "event-timer" && v.consumer.purpose === "reminder" && v.consumer.deliveryId === v.source.deliveryId && v.sourceId === `event_timer_${v.source.deliveryId}`)
    return !v.consumer && (!v.source || v.source.type === "human") && isId(v.sourceId)
        && v.draftKind !== undefined && v.draftName !== undefined && v.draftRevision !== undefined
        && (!v.source || v.source.messageId === v.sourceId)
        && (!v.provenance || v.provenance.type === "draft" && v.provenance.kind === v.draftKind && v.provenance.name === v.draftName && v.provenance.revision === v.draftRevision)
}
export const PublishingGrant = Schema.Struct(publishingGrantFields).check(Schema.makeFilter((value) => canonical(value) && boundProvenance(value)
    && (value.action === "send" ? value.messageId === undefined && value.expectedContent === undefined : !!value.messageId && !!value.expectedContent)))
export type PublishingGrant = typeof PublishingGrant.Type
export const PublishingAttempt = Schema.Struct({ ...publishingGrantFields, outcome: PublishingOutcome, createdAt: Millis, dispatchedAt: optional(Millis), noDispatch: optional(Schema.Literal(true)),
    finishedAt: optional(Millis), observation: optional(PublishingObservation), resolution: optional(PublishingResolution) }).check(Schema.makeFilter((value) => canonical(value) && boundProvenance(value)
    && (value.source?.type === "schedule-timer" || value.source?.type === "milestone-timer" ? value.dispatchExpiresAt === value.createdAt + 180000
        : value.source?.type === "event-timer" ? value.consumer?.type === "event" && value.dispatchExpiresAt > value.createdAt && value.dispatchExpiresAt === Math.min(value.createdAt + 180000, value.source.dueAt + 300000, value.source.dueAt + value.consumer.offsetMinutes! * 60000)
        : value.source?.type === "dashboard-message" || value.source?.type === "showcase" ? value.dispatchExpiresAt > value.createdAt && value.dispatchExpiresAt <= value.createdAt + 120000
        : value.dispatchExpiresAt === value.createdAt + 180000)
    && (value.dispatchedAt === undefined || value.dispatchedAt >= value.createdAt && value.dispatchedAt < value.dispatchExpiresAt)
    && (value.noDispatch !== true || value.outcome === "failed" && value.dispatchedAt === undefined)
    && (value.finishedAt === undefined || value.finishedAt >= value.createdAt)
    && (!value.observation || value.observation.observedAt >= value.createdAt && value.observation.messageId === value.messageId && value.observation.channelId === (value.threadId ?? value.channelId) && value.observation.botId === value.botId)
    && (!value.resolution || value.outcome === "uncertain" && value.resolution.attemptId === value.attemptId && value.resolution.generation === value.generation && value.resolution.sourceId === value.sourceId
        && value.observation?.observedAt === value.resolution.observedAt && (value.resolution.matched !== "previous" || value.expectedContent !== undefined)
        && (value.dispatchedAt === undefined || value.resolution.observedAt >= value.dispatchExpiresAt + value.nativeDeadlineMs + 5000)
        && equalPublishingContent(value.observation.content, value.resolution.matched === "intended" ? value.canonicalContent : value.expectedContent ?? { content: "" }))))
export type PublishingAttempt = typeof PublishingAttempt.Type
export const PublishingPost = Schema.Struct({ postNo: Int(1), generation: Int(1), channelId: Id, botId: Id, messageId: optional(Id), outcome: PublishingOutcome,
    createdAt: Millis, updatedAt: Millis, confirmedContent: optional(PublishingContent), confirmedCanonicalContent: optional(PublishingContent), confirmedDraftRevision: optional(Int(1)),
    attempt: PublishingAttempt, consumer: optional(PublishingConsumer),
}).check(Schema.makeFilter((value) => value.attempt.postNo === value.postNo && value.attempt.generation === value.generation
    && (value.attempt.threadId ?? value.attempt.channelId) === value.channelId && value.attempt.botId === value.botId && value.outcome === value.attempt.outcome
    && value.attempt.messageId === value.messageId
    && equalUnknown(value.consumer, value.attempt.consumer)
    && value.updatedAt >= value.createdAt && (value.confirmedContent === undefined ? value.confirmedCanonicalContent === undefined
        : !!value.confirmedCanonicalContent && equalPublishingContent(value.confirmedCanonicalContent, canonicalPublishingContent(value.confirmedContent)))
    && (value.outcome !== "sent" || !!value.messageId)))
export type PublishingPost = typeof PublishingPost.Type
