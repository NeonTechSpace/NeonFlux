import { Schema } from "effect"
import { Id, Ids, Int, IsoTime, List, Millis, PermissionBits, Str, Text, origin } from "./common.ts"
import { PublishingContent, PublishingName } from "./publishing-base.ts"
import { ModerationActor, ModerationSource, RolesRoleSnapshot } from "./shared.ts"

// Tickets, see docs/BOT.md#tickets

/** SendMessages. Closing also stops posting in the ticket's threads and starting new ones: CreatePublicThreads, CreatePrivateThreads and SendMessagesInThreads */
export const TICKET_SEND = 2048n, TICKET_CLOSE_PERMISSIONS = TICKET_SEND | (1n << 35n) | (1n << 36n) | (1n << 38n)
const optional = Schema.optionalKey
/** A name the backend trims and lowercases before matching */
const nameInput = Schema.String.check(Schema.makeFilter((value: string) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value.trim().toLowerCase())))
const claimToken = Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/))
/** A timeout end as Fluxer reports it, in UTC */
const timeoutTime = Schema.String.check(Schema.makeFilter((value: string) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value))))
/** A permission bitfield that fits a signed 64-bit integer */
const signedBits = Schema.String.check(Schema.makeFilter((value: string) => /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n))
/** Closing owns SendMessages and at most the thread bits beside it, so a grant can never rewrite other permissions */
const ownedPermissions = Schema.String.check(Schema.makeFilter((value: string) => /^[1-9]\d{0,18}$/.test(value)
    && (BigInt(value) & ~TICKET_CLOSE_PERMISSIONS) === 0n && (BigInt(value) & TICKET_SEND) !== 0n))
const description = Schema.Union([Schema.Literal(""), Text(1000)])
/** A category asks at most five intake questions */
export const TicketQuestions = List(Text(200), 5)
const roles = List(RolesRoleSnapshot, 1000)
const ticketNo = Int(1), generation = Int()

export const TicketVisibility = Schema.Literals(["private", "public"])
export type TicketVisibility = typeof TicketVisibility.Type
/** An overwrite never allows and denies the same permission */
export const TicketOverwrite = Schema.Struct({ id: Id, type: Schema.Literals(["role", "member"]), allow: PermissionBits, deny: PermissionBits })
    .check(Schema.makeFilter(v => (BigInt(v.allow) & BigInt(v.deny)) === 0n))
export type TicketOverwrite = typeof TicketOverwrite.Type
/** At most one overwrite per role or member */
const overwrites = List(TicketOverwrite, 100).check(Schema.makeFilter(rows => new Set(rows.map(r => r.type + ":" + r.id)).size === rows.length))
export const TicketChannelSnapshot = Schema.Struct({ ...origin, channelId: Id, serverId: Id, type: Schema.Literal("text"), name: Text(100), parentId: Schema.NullOr(Id), overwrites })
export type TicketChannelSnapshot = typeof TicketChannelSnapshot.Type
export const TicketActor = Schema.Struct({ ...ModerationActor.fields, joinedAt: IsoTime, isBot: Schema.Boolean, timeoutUntil: Schema.NullOr(timeoutTime), privateChannelVerified: Schema.Boolean,
    privateChannelId: optional(Id), canView: Schema.Boolean, canReadHistory: Schema.Boolean, canSend: Schema.Boolean })
export type TicketActor = typeof TicketActor.Type
/** botPostingPermissions holds the decimal SendMessages and thread permission bits the bot holds server-wide. A close owns SendMessages and only these thread bits */
export const TicketContext = Schema.Struct({ ...origin, observedAt: Millis, actor: TicketActor, botId: Id, botAuthorized: Schema.Boolean, botPostingPermissions: optional(signedBits),
    parentVerified: optional(Schema.Boolean), channel: optional(TicketChannelSnapshot) })
export type TicketContext = typeof TicketContext.Type
export const TicketSettings = Schema.Struct({ enabled: Schema.Boolean, retentionDays: Int(1, 365) })
export type TicketSettings = typeof TicketSettings.Type
export const TicketCannedReply = Schema.Struct({ name: PublishingName, templateName: PublishingName, templateRevision: Int(1), content: PublishingContent })
export type TicketCannedReply = typeof TicketCannedReply.Type
const summaryFields = { name: PublishingName, revision: Int(1), enabled: Schema.Boolean, visibility: TicketVisibility, description: Str(1000) }
const intakeFields = { parentId: Schema.NullOr(Id), supportRoleIds: Ids(20), questions: List(Str(200), 5) }
export const TicketCategory = Schema.Struct({ ...summaryFields, ...intakeFields, cannedReplies: List(TicketCannedReply, 20) })
export type TicketCategory = typeof TicketCategory.Type
export const TicketCategorySummary = Schema.Struct(summaryFields)
export type TicketCategorySummary = typeof TicketCategorySummary.Type
export const TicketIntakeCategory = Schema.Struct({ ...summaryFields, ...intakeFields })
export type TicketIntakeCategory = typeof TicketIntakeCategory.Type
export const TicketIntake = Schema.Struct({ intakeNo: Int(1), generation: Int(1), category: TicketIntakeCategory, requesterId: Id, joinedAt: IsoTime, answers: List(Str(2000), 5),
    state: Schema.Literals(["draft", "submitted", "cancelled", "expired"]), createdAt: Millis, expiresAt: Int(1), ticketNo: optional(ticketNo) })
export type TicketIntake = typeof TicketIntake.Type
export const TicketState = Schema.Literals(["creating", "open", "closing", "closed", "reopening", "deleting", "retired", "failed", "uncertain"])
export type TicketState = typeof TicketState.Type
export const TicketAction = Schema.Literals(["create", "introduction", "reply", "close-everyone", "close-requester", "reopen-requester", "reopen-everyone", "delete"])
export type TicketAction = typeof TicketAction.Type
const grantFields = { attemptId: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,256}$/)), attemptNo: Int(1), ticketNo, generation: Int(1), sourceId: Id, actorId: Id, botId: Id,
    requesterId: Id, requesterJoinedAt: IsoTime, visibility: TicketVisibility, supportRoleIds: Ids(20), action: TicketAction, dispatchExpiresAt: Int(1),
    nativeDeadlineMs: Schema.Literal(5000), channelId: optional(Id), expectedChannel: optional(TicketChannelSnapshot), desiredChannel: optional(TicketChannelSnapshot),
    targetOverwrite: optional(TicketOverwrite), ownedPermissions: optional(ownedPermissions), channelName: optional(Str(100)), parentId: optional(Schema.NullOr(Id)),
    overwrites: optional(overwrites), content: optional(PublishingContent), escalatedFrom: optional(Id) }
/** escalatedFrom names the help post of an escalated ticket. Its creation is run by the staff member who escalated it, not the requester */
export const TicketActionGrant = Schema.Struct(grantFields)
export type TicketActionGrant = typeof TicketActionGrant.Type
export const TicketAttempt = Schema.Struct({ ...grantFields, outcome: Schema.Literals(["pending", "succeeded", "failed", "uncertain"]), createdAt: Millis, claimedAt: optional(Millis),
    finishedAt: optional(Millis), noDispatch: optional(Schema.Literal(true)), messageId: optional(Id), observationAt: optional(Millis),
    resolved: optional(Schema.Literals(["before", "desired", "absent"])), redacted: optional(Schema.Literal(true)), nativeDeleteConfirmed: optional(Schema.Literal(true)) })
export type TicketAttempt = typeof TicketAttempt.Type
const recordFields = { ticketNo, requesterId: Id, supportRoleIds: Ids(20), state: TicketState, generation, botId: Id, channelId: optional(Id), retiredAt: optional(Millis) }
/** A ticket's current attempt never carries its private content */
export const TicketRecord = Schema.Struct({ ...recordFields, requesterJoinedAt: IsoTime, categoryName: PublishingName, categoryRevision: Int(1), visibility: TicketVisibility,
    channel: optional(TicketChannelSnapshot), claimedBy: optional(Id), priority: Schema.Literals(["low", "normal", "high", "urgent"]), createdAt: Millis, closedAt: optional(Millis),
    bodyExpiresAt: optional(Millis), erased: Schema.Boolean, entryCount: Int(0, 200), currentAttempt: optional(TicketAttempt.check(Schema.makeFilter(v => v.content === undefined))),
    transition: optional(Schema.Literals(["close", "reopen"])), completedSteps: optional(Int(0, 2)) })
export type TicketRecord = typeof TicketRecord.Type
export const TicketLocator = Schema.Struct(recordFields)
export type TicketLocator = typeof TicketLocator.Type
export const TicketEntry = Schema.Struct({ entryNo: Int(1), ticketNo, authorId: Id, kind: Schema.Literals(["reply", "note"]), createdAt: Millis, content: optional(PublishingContent),
    erased: Schema.Boolean, attemptNo: optional(Int(1)) })
export type TicketEntry = typeof TicketEntry.Type
export const TicketTranscriptMessage = Schema.Struct({ messageId: Id, authorId: Id, createdAt: optional(IsoTime), content: Str(2000), omittedAttachments: Int(0, 100) })
export type TicketTranscriptMessage = typeof TicketTranscriptMessage.Type
/** One public thread of the ticket channel with its captured messages, oldest first like the channel's */
export const TicketTranscriptThread = Schema.Struct({ threadId: Id, name: Text(100), messages: List(TicketTranscriptMessage, 500) })
export type TicketTranscriptThread = typeof TicketTranscriptThread.Type
export const TicketTranscript = Schema.Struct({ transcriptNo: Int(1), ticketNo, channelId: Id, capturedAt: Millis, messageCount: Int(0, 500), truncated: Schema.Boolean, erased: Schema.Boolean,
    pages: Int(1) })
export type TicketTranscript = typeof TicketTranscript.Type
export const TicketSource = Schema.Struct({ ...ModerationSource.fields, serverId: Id, context: TicketContext })
export type TicketSource = typeof TicketSource.Type

const configurationOperations = [
    Schema.Struct({ type: Schema.Literal("settings"), enabled: optional(Schema.Boolean), retentionDays: optional(Int(1, 365)) })
        .check(Schema.makeFilter(v => v.enabled !== undefined || v.retentionDays !== undefined)),
    Schema.Struct({ type: Schema.Literal("category-create"), name: nameInput, visibility: TicketVisibility, description: optional(description), parentId: optional(Schema.NullOr(Id)),
        supportRoleIds: Ids(20), roles }),
    Schema.Struct({ type: Schema.Literal("category-update"), name: nameInput, expectedRevision: Int(1), patch: Schema.Struct({ enabled: optional(Schema.Boolean),
        visibility: optional(TicketVisibility), description: optional(description), parentId: optional(Schema.NullOr(Id)), supportRoleIds: optional(Ids(20)), questions: optional(TicketQuestions) })
        .check(Schema.makeFilter(v => Object.keys(v).length > 0)), roles: optional(roles) }),
    Schema.Struct({ type: Schema.Literal("category-delete"), name: nameInput, expectedRevision: Int(1) }),
    Schema.Struct({ type: Schema.Literal("canned-set"), name: nameInput, expectedRevision: Int(1), cannedName: nameInput, templateName: nameInput, expectedTemplateRevision: Int(1) }),
    Schema.Struct({ type: Schema.Literal("canned-remove"), name: nameInput, expectedRevision: Int(1), cannedName: nameInput }),
] as const
/** The ticket settings and category changes that chat and dashboard jobs share */
export const TicketConfigurationOperation = Schema.Union(configurationOperations)
export type TicketConfigurationOperation = typeof TicketConfigurationOperation.Type
const ticketOp = { ticketNo, expectedGeneration: generation }
export const TicketManageOperation = Schema.Union([...configurationOperations,
    Schema.Struct({ type: Schema.Literals(["claim", "unclaim"]), ...ticketOp }),
    Schema.Struct({ type: Schema.Literal("priority"), ...ticketOp, priority: Schema.Literals(["low", "normal", "high", "urgent"]) }),
    Schema.Struct({ type: Schema.Literal("reply"), ...ticketOp, content: PublishingContent }),
    Schema.Struct({ type: Schema.Literal("canned-reply"), ...ticketOp, cannedName: nameInput }),
    Schema.Struct({ type: Schema.Literal("note"), ...ticketOp, content: Text(2000) }),
    Schema.Struct({ type: Schema.Literals(["close", "reopen"]), ...ticketOp }),
    Schema.Struct({ type: Schema.Literals(["delete", "erase"]), ...ticketOp, confirm: Schema.Literal(true) }),
    Schema.Struct({ type: Schema.Literal("abandon"), ...ticketOp }),
    /** Staff turn a help desk post into a ticket for its author, whose membership the bot read just before */
    Schema.Struct({ type: Schema.Literal("escalate"), categoryName: nameInput, requesterId: Id, requesterJoinedAt: IsoTime, postId: Id }),
])
export type TicketManageOperation = typeof TicketManageOperation.Type
export const TicketManageRequest = Schema.Struct({ ...TicketSource.fields, operation: TicketManageOperation })
export type TicketManageRequest = typeof TicketManageRequest.Type
const duplicate = Schema.Struct({ duplicate: Schema.Literal(true) })
export const TicketManageResult = Schema.Union([duplicate,
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings: TicketSettings }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("category"), category: TicketCategory }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("deleted"), name: PublishingName }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("ticket"), ticket: TicketRecord, grant: optional(TicketActionGrant) }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("entry"), entry: TicketEntry }),
])
export type TicketManageResult = typeof TicketManageResult.Type
const intakeOp = { intakeNo: Int(1), expectedGeneration: Int(1) }
export const TicketIntakeRequest = Schema.Struct({ ...TicketSource.fields, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("open"), categoryName: nameInput, expectedCategoryRevision: Int(1) }),
    Schema.Struct({ type: Schema.Literal("answer"), ...intakeOp, question: Int(1), answer: Text(2000) }),
    Schema.Struct({ type: Schema.Literal("clear"), ...intakeOp, question: Int(1) }),
    Schema.Struct({ type: Schema.Literal("cancel"), ...intakeOp }),
    Schema.Struct({ type: Schema.Literal("submit"), ...intakeOp, expectedCategoryRevision: Int(1), visibility: TicketVisibility }),
]) })
export type TicketIntakeRequest = typeof TicketIntakeRequest.Type
export const TicketIntakeResult = Schema.Union([duplicate,
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("intake"), intake: TicketIntake }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("ticket"), ticket: TicketRecord, grant: TicketActionGrant }),
])
export type TicketIntakeResult = typeof TicketIntakeResult.Type
/** A member's live draft on any server, so a plain DM reply can find it. Server and intake numbers only */
export const TicketOpenIntake = Schema.Struct({ serverId: Id, intakeNo: Int(1) })
export type TicketOpenIntake = typeof TicketOpenIntake.Type
export const TicketOpenIntakesRequest = Schema.Struct({ userId: Id })
export type TicketOpenIntakesRequest = typeof TicketOpenIntakesRequest.Type
export const TicketOpenIntakesResult = List(TicketOpenIntake, 10)
export type TicketOpenIntakesResult = typeof TicketOpenIntakesResult.Type
export const TicketQueryRequest = Schema.Struct({ serverId: Id, context: TicketContext, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings") }),
    Schema.Struct({ type: Schema.Literal("categories") }),
    Schema.Struct({ type: Schema.Literal("category"), name: nameInput }),
    Schema.Struct({ type: Schema.Literal("category-config"), name: nameInput }),
    Schema.Struct({ type: Schema.Literal("intake"), intakeNo: Int(1) }),
    Schema.Struct({ type: Schema.Literal("intakes"), beforeIntakeNo: optional(Int(1)) }),
    Schema.Struct({ type: Schema.Literals(["ticket", "private-intake"]), ticketNo }),
    Schema.Struct({ type: Schema.Literal("locate"), ticketNo }),
    Schema.Struct({ type: Schema.Literal("tickets"), beforeTicketNo: optional(Int(1)), own: optional(Schema.Boolean) }),
    Schema.Struct({ type: Schema.Literal("entries"), ticketNo, kind: Schema.Literals(["reply", "note"]), beforeEntryNo: optional(Int(1)) }),
    Schema.Struct({ type: Schema.Literal("attempt"), ticketNo, attemptNo: Int(1) }),
    Schema.Struct({ type: Schema.Literal("transcripts"), ticketNo, beforeTranscriptNo: optional(Int(1)) }),
    Schema.Struct({ type: Schema.Literal("transcript"), ticketNo, transcriptNo: Int(1), page: optional(Int(1)) }),
]) })
export type TicketQueryRequest = typeof TicketQueryRequest.Type
export const TicketQueryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings: TicketSettings }),
    Schema.Struct({ type: Schema.Literal("categories"), categories: List(TicketCategorySummary, 20) }),
    Schema.Struct({ type: Schema.Literal("category"), category: TicketCategorySummary }),
    Schema.Struct({ type: Schema.Literal("category-config"), category: TicketCategory }),
    Schema.Struct({ type: Schema.Literal("intake"), intake: TicketIntake }),
    Schema.Struct({ type: Schema.Literal("intakes"), intakes: List(TicketIntake, 20), nextBeforeIntakeNo: optional(Int(1)) }),
    Schema.Struct({ type: Schema.Literal("ticket"), ticket: TicketRecord }),
    Schema.Struct({ type: Schema.Literal("locate"), ticket: TicketLocator }),
    Schema.Struct({ type: Schema.Literal("private-intake"), ticketNo, questions: List(Str(200), 5), answers: List(Str(2000), 5), erased: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("tickets"), tickets: List(TicketRecord, 20), nextBeforeTicketNo: optional(Int(1)) }),
    Schema.Struct({ type: Schema.Literal("entries"), entries: List(TicketEntry, 20), nextBeforeEntryNo: optional(Int(1)) }),
    Schema.Struct({ type: Schema.Literal("attempt"), attempt: TicketAttempt }),
    Schema.Struct({ type: Schema.Literal("transcripts"), transcripts: List(TicketTranscript, 20), nextBeforeTranscriptNo: optional(Int(1)) }),
    Schema.Struct({ type: Schema.Literal("transcript"), transcript: TicketTranscript, page: Int(1), text: Str(1500) }),
])
export type TicketQueryResult = typeof TicketQueryResult.Type
/** The backend matches the attempt, its generation and source, and refuses a mismatch as a conflict */
export const TicketBinding = Schema.Struct({ serverId: Id, ticketNo, generation: Schema.Number, attemptId: Schema.String, sourceId: Schema.String })
export type TicketBinding = typeof TicketBinding.Type
export const TicketDispatchRequest = Schema.Struct({ ...TicketBinding.fields, claimToken, context: TicketContext })
export type TicketDispatchRequest = typeof TicketDispatchRequest.Type
export const TicketDispatchResult = Schema.Struct({ claimed: Schema.Boolean, dispatchExpiresAt: Int(1), nativeDeadlineMs: Schema.Literal(5000) })
export type TicketDispatchResult = typeof TicketDispatchResult.Type
/** Only a failed attempt that never dispatched carries noDispatch */
export const TicketOutcomeRequest = Schema.Struct({ ...TicketBinding.fields, claimToken: optional(claimToken), outcome: Schema.Literals(["succeeded", "failed", "uncertain"]),
    noDispatch: optional(Schema.Literal(true)), channelId: optional(Id), channel: optional(TicketChannelSnapshot), messageId: optional(Id), observedAt: optional(Millis),
    channelAbsent: optional(Schema.Literal(true)), nativeDeleteConfirmed: optional(Schema.Literal(true)) })
    .check(Schema.makeFilter(v => v.noDispatch === undefined || v.outcome === "failed"))
export type TicketOutcomeRequest = typeof TicketOutcomeRequest.Type
export const TicketOutcomeResult = Schema.Struct({ recorded: Schema.Boolean, ticket: TicketRecord, grant: optional(TicketActionGrant) })
export type TicketOutcomeResult = typeof TicketOutcomeResult.Type
/** An observation names the channel snapshot exactly when the channel is present */
export const TicketReconcileRequest = Schema.Struct({ ...TicketSource.fields, ticketNo, expectedGeneration: generation, attemptId: Schema.String,
    observation: Schema.Struct({ ...origin, observedAt: Millis, channelId: Id, channelAbsent: Schema.Boolean, channel: optional(TicketChannelSnapshot) })
        .check(Schema.makeFilter(v => v.channelAbsent === (v.channel === undefined))) })
export type TicketReconcileRequest = typeof TicketReconcileRequest.Type
export const TicketReconcileResult = Schema.Struct({ recorded: Schema.Boolean, ticket: TicketRecord })
export type TicketReconcileResult = typeof TicketReconcileResult.Type
/** A transcript holds at most 500 messages across the channel and its threads */
export const TicketTranscriptUploadRequest = Schema.Struct({ ...TicketSource.fields, ticketNo, expectedGeneration: generation, capturedAt: Millis,
    messages: List(TicketTranscriptMessage, 500), threads: optional(List(TicketTranscriptThread, 10)), truncated: Schema.Boolean })
    .check(Schema.makeFilter(v => v.messages.length + (v.threads ?? []).reduce((sum, thread) => sum + thread.messages.length, 0) <= 500))
export type TicketTranscriptUploadRequest = typeof TicketTranscriptUploadRequest.Type
export const TicketTranscriptUploadResult = Schema.Struct({ duplicate: Schema.Boolean, transcript: TicketTranscript })
export type TicketTranscriptUploadResult = typeof TicketTranscriptUploadResult.Type
