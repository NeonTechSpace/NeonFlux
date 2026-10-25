import { Schema } from "effect"
import { Id, Ids, Int, IsoTime, List, Millis, NameInput, PermissionBits, Str, Text, origin } from "./common.ts"
import { PublishingContent, PublishingName } from "./publishing-base.ts"
import { ModerationActor, ModerationSource, RolesRoleSnapshot } from "./shared.ts"

// Tickets, see docs/BOT.md#tickets

/** SendMessages. Closing also stops posting in the ticket's threads and starting new ones: CreatePublicThreads, CreatePrivateThreads and SendMessagesInThreads */
export const TICKET_SEND = 2048n,
    TICKET_CLOSE_PERMISSIONS = TICKET_SEND | (1n << 35n) | (1n << 36n) | (1n << 38n)
/** ViewChannel */
export const TICKET_VIEW = 1024n
const optional = Schema.optionalKey
/** A name the backend trims and lowercases before matching */
const nameInput = NameInput
const claimToken = Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/))
/** A timeout end as Fluxer reports it, in UTC */
const timeoutTime = Schema.String.check(
    Schema.makeFilter(
        (value: string) =>
            /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)),
    ),
)
/** A permission bitfield that fits a signed 64-bit integer */
const signedBits = Schema.String.check(
    Schema.makeFilter((value: string) => /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n),
)
/** Closing owns SendMessages and at most the thread bits beside it, so a grant can never rewrite other permissions */
const ownedPermissions = Schema.String.check(
    Schema.makeFilter(
        (value: string) =>
            /^[1-9]\d{0,18}$/.test(value) &&
            (BigInt(value) & ~TICKET_CLOSE_PERMISSIONS) === 0n &&
            (BigInt(value) & TICKET_SEND) !== 0n,
    ),
)
const description = Schema.Union([Schema.Literal(""), Text(1000)])
/**
 * A category asks up to 25 intake questions, one per DM reply. A ticket stores every answer of up to 2000 characters, and a ticket
 * list reads 26 tickets in one transaction, which stays within Convex's 8 MiB read limit with 25
 */
export const TICKET_QUESTIONS = 25
/** Support roles per category, as many roles as Fluxer allows in a server */
export const TICKET_SUPPORT_ROLES = 250
export const TicketQuestions = List(Text(200), TICKET_QUESTIONS)
const roles = List(RolesRoleSnapshot, 1000)
const ticketNo = Int(1),
    generation = Int()
/** Categories per page of the chat list */
export const TICKET_CATEGORY_PAGE = 10
/** Ticket panels per page of the bot's panel index. A panel row is a few IDs */
export const TICKET_PANEL_PAGE = 500
/**
 * A category keeps its canned replies in its one stored document, at most 256 KiB of them as JSON. Pages of 20 categories then stay
 * within Convex's 8 MiB read limit, and any number of short replies fits
 */
export const TICKET_CANNED_BYTES = 262144
export const ticketCannedBytes = (replies: readonly unknown[]) =>
    new TextEncoder().encode(JSON.stringify(replies)).length

export const TicketVisibility = Schema.Literals(["private", "public"])
export type TicketVisibility = typeof TicketVisibility.Type
/** An overwrite never allows and denies the same permission */
export const TicketOverwrite = Schema.Struct({
    id: Id,
    type: Schema.Literals(["role", "member"]),
    allow: PermissionBits,
    deny: PermissionBits,
}).check(Schema.makeFilter((v) => (BigInt(v.allow) & BigInt(v.deny)) === 0n))
export type TicketOverwrite = typeof TicketOverwrite.Type
/**
 * At most one overwrite per role or member. A ticket channel holds the everyone role, every support role, NeonFlux and the requester,
 * and 500 leaves room for overwrites staff add while a transcript append with its channel stays under the 262,144-byte request limit
 */
const overwrites = List(TicketOverwrite, 500).check(
    Schema.makeFilter((rows) => new Set(rows.map((r) => r.type + ":" + r.id)).size === rows.length),
)
export const TicketChannelSnapshot = Schema.Struct({
    ...origin,
    channelId: Id,
    serverId: Id,
    type: Schema.Literal("text"),
    name: Text(100),
    parentId: Schema.NullOr(Id),
    overwrites,
})
export type TicketChannelSnapshot = typeof TicketChannelSnapshot.Type
/** Orders overwrites by type, then by ID, which the bot and the backend both use so one channel compares equal on both sides */
export const sortTicketOverwrites = (rows: readonly TicketOverwrite[]): TicketOverwrite[] =>
    [...rows].sort(
        (a, b) =>
            a.type.localeCompare(b.type) || (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0),
    )
export function ticketOverwritesEqual(a: readonly TicketOverwrite[], b: readonly TicketOverwrite[]) {
    const first = sortTicketOverwrites(a),
        second = sortTicketOverwrites(b)
    return (
        first.length === second.length &&
        first.every((row, index) => {
            const other = second[index]!
            return (
                row.id === other.id && row.type === other.type && row.allow === other.allow && row.deny === other.deny
            )
        })
    )
}
/** Staff may rename or move a ticket channel. Only its identity and owned overwrites bind the lifecycle */
export const sameTicketChannelIdentity = (a: TicketChannelSnapshot, b: TicketChannelSnapshot) =>
    a.channelId === b.channelId && a.serverId === b.serverId && a.type === b.type
/**
 * Whether only these people can view a server channel: the everyone role is denied ViewChannel there, and every overwrite
 * that allows it names one of the roles or members given. Administrators see every channel and count as staff
 */
export function ticketAudienceWithin(
    overwrites: readonly TicketOverwrite[],
    audience: { serverId: string; roleIds: readonly string[]; memberIds: readonly string[] },
) {
    const everyone = overwrites.find((row) => row.type === "role" && row.id === audience.serverId)
    return (
        everyone !== undefined &&
        (BigInt(everyone.deny) & TICKET_VIEW) !== 0n &&
        overwrites.every(
            (row) =>
                (BigInt(row.allow) & TICKET_VIEW) === 0n ||
                (row.type === "role" ? audience.roleIds.includes(row.id) : audience.memberIds.includes(row.id)),
        )
    )
}
/** Who may read a ticket's private text where it answers: staff are its support roles and the bot, readers add the requester */
export type TicketAudience = "staff" | "readers"
export const ticketAudience = (
    ticket: { readonly supportRoleIds: readonly string[]; readonly botId: string; readonly requesterId: string },
    audience: TicketAudience,
    serverId: string,
) => ({
    serverId,
    roleIds: ticket.supportRoleIds,
    memberIds: audience === "staff" ? [ticket.botId] : [ticket.botId, ticket.requesterId],
})
/** One channel snapshot equals another when its identity and every overwrite match */
export const ticketChannelsEqual = (a: TicketChannelSnapshot, b: TicketChannelSnapshot) =>
    sameTicketChannelIdentity(a, b) && ticketOverwritesEqual(a.overwrites, b.overwrites)
export const TicketActor = Schema.Struct({
    ...ModerationActor.fields,
    joinedAt: IsoTime,
    isBot: Schema.Boolean,
    timeoutUntil: Schema.NullOr(timeoutTime),
    privateChannelVerified: Schema.Boolean,
    privateChannelId: optional(Id),
    canView: Schema.Boolean,
    canReadHistory: Schema.Boolean,
    canSend: Schema.Boolean,
})
export type TicketActor = typeof TicketActor.Type
/**
 * botPostingPermissions holds the decimal SendMessages and thread permission bits the bot holds server-wide. A close owns
 * SendMessages and only these thread bits. destination is a fresh read of the server text channel a command was sent in,
 * which decides whether private ticket text may answer there
 */
export const TicketContext = Schema.Struct({
    ...origin,
    observedAt: Millis,
    actor: TicketActor,
    botId: Id,
    botAuthorized: Schema.Boolean,
    botPostingPermissions: optional(signedBits),
    parentVerified: optional(Schema.Boolean),
    channel: optional(TicketChannelSnapshot),
    destination: optional(TicketChannelSnapshot),
})
export type TicketContext = typeof TicketContext.Type
export const TicketSettings = Schema.Struct({ enabled: Schema.Boolean, retentionDays: Int(1, 365) })
export type TicketSettings = typeof TicketSettings.Type
export const TicketCannedReply = Schema.Struct({
    name: PublishingName,
    templateName: PublishingName,
    templateRevision: Int(1),
    content: PublishingContent,
})
export type TicketCannedReply = typeof TicketCannedReply.Type
const summaryFields = {
    name: PublishingName,
    revision: Int(1),
    enabled: Schema.Boolean,
    visibility: TicketVisibility,
    description: Str(1000),
}
const intakeFields = {
    parentId: Schema.NullOr(Id),
    supportRoleIds: Ids(TICKET_SUPPORT_ROLES),
    questions: List(Str(200), TICKET_QUESTIONS),
}
export const TicketCategory = Schema.Struct({
    ...summaryFields,
    ...intakeFields,
    cannedReplies: Schema.mutable(Schema.Array(TicketCannedReply)).check(
        Schema.makeFilter((rows) => ticketCannedBytes(rows) <= TICKET_CANNED_BYTES),
    ),
})
export type TicketCategory = typeof TicketCategory.Type
export const TicketCategorySummary = Schema.Struct(summaryFields)
export type TicketCategorySummary = typeof TicketCategorySummary.Type
export const TicketIntakeCategory = Schema.Struct({ ...summaryFields, ...intakeFields })
export type TicketIntakeCategory = typeof TicketIntakeCategory.Type
export const TicketIntake = Schema.Struct({
    intakeNo: Int(1),
    generation: Int(1),
    category: TicketIntakeCategory,
    requesterId: Id,
    joinedAt: IsoTime,
    answers: List(Str(2000), TICKET_QUESTIONS),
    state: Schema.Literals(["draft", "submitted", "cancelled", "expired"]),
    createdAt: Millis,
    expiresAt: Int(1),
    ticketNo: optional(ticketNo),
})
export type TicketIntake = typeof TicketIntake.Type
export const TicketState = Schema.Literals([
    "creating",
    "open",
    "closing",
    "closed",
    "reopening",
    "deleting",
    "retired",
    "failed",
    "uncertain",
])
export type TicketState = typeof TicketState.Type
export const TicketAction = Schema.Literals([
    "create",
    "introduction",
    "reply",
    "close-everyone",
    "close-requester",
    "reopen-requester",
    "reopen-everyone",
    "delete",
])
export type TicketAction = typeof TicketAction.Type
const grantFields = {
    attemptId: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,256}$/)),
    attemptNo: Int(1),
    ticketNo,
    generation: Int(1),
    sourceId: Id,
    actorId: Id,
    botId: Id,
    requesterId: Id,
    requesterJoinedAt: IsoTime,
    visibility: TicketVisibility,
    supportRoleIds: Ids(TICKET_SUPPORT_ROLES),
    action: TicketAction,
    dispatchExpiresAt: Int(1),
    nativeDeadlineMs: Schema.Literal(5000),
    channelId: optional(Id),
    expectedChannel: optional(TicketChannelSnapshot),
    desiredChannel: optional(TicketChannelSnapshot),
    targetOverwrite: optional(TicketOverwrite),
    ownedPermissions: optional(ownedPermissions),
    channelName: optional(Str(100)),
    parentId: optional(Schema.NullOr(Id)),
    overwrites: optional(overwrites),
    content: optional(PublishingContent),
    escalatedFrom: optional(Id),
}
/** escalatedFrom names the help post of an escalated ticket. Its creation is run by the staff member who escalated it, not the requester */
export const TicketActionGrant = Schema.Struct(grantFields)
export type TicketActionGrant = typeof TicketActionGrant.Type
export const TicketAttempt = Schema.Struct({
    ...grantFields,
    outcome: Schema.Literals(["pending", "succeeded", "failed", "uncertain"]),
    createdAt: Millis,
    claimedAt: optional(Millis),
    finishedAt: optional(Millis),
    noDispatch: optional(Schema.Literal(true)),
    messageId: optional(Id),
    observationAt: optional(Millis),
    resolved: optional(Schema.Literals(["before", "desired", "absent"])),
    redacted: optional(Schema.Literal(true)),
    nativeDeleteConfirmed: optional(Schema.Literal(true)),
})
export type TicketAttempt = typeof TicketAttempt.Type
const recordFields = {
    ticketNo,
    requesterId: Id,
    supportRoleIds: Ids(TICKET_SUPPORT_ROLES),
    state: TicketState,
    generation,
    botId: Id,
    channelId: optional(Id),
    retiredAt: optional(Millis),
}
/** A ticket's current attempt never carries its private content */
export const TicketRecord = Schema.Struct({
    ...recordFields,
    requesterJoinedAt: IsoTime,
    categoryName: PublishingName,
    categoryRevision: Int(1),
    visibility: TicketVisibility,
    channel: optional(TicketChannelSnapshot),
    claimedBy: optional(Id),
    priority: Schema.Literals(["low", "normal", "high", "urgent"]),
    createdAt: Millis,
    closedAt: optional(Millis),
    bodyExpiresAt: optional(Millis),
    erased: Schema.Boolean,
    entryCount: Int(0),
    currentAttempt: optional(TicketAttempt.check(Schema.makeFilter((v) => v.content === undefined))),
    transition: optional(Schema.Literals(["close", "reopen"])),
    completedSteps: optional(Int(0, 2)),
    /** The automatic transcript: saving while a save is due, failed after the last tries, with its message count once saved */
    transcript: optional(
        Schema.Struct({
            state: Schema.Literals(["saving", "saved", "failed"]),
            messageCount: Int(0),
        }),
    ),
})
export type TicketRecord = typeof TicketRecord.Type
export const TicketEntry = Schema.Struct({
    entryNo: Int(1),
    ticketNo,
    authorId: Id,
    kind: Schema.Literals(["reply", "note"]),
    createdAt: Millis,
    content: optional(PublishingContent),
    erased: Schema.Boolean,
    attemptNo: optional(Int(1)),
})
export type TicketEntry = typeof TicketEntry.Type
/** The bounds only validate requests and sit above any real Fluxer message */
export const TicketTranscriptMessage = Schema.Struct({
    messageId: Id,
    authorId: Id,
    authorName: Str(100),
    createdAt: optional(IsoTime),
    content: Str(8000),
    attachments: optional(List(Schema.Struct({ filename: Str(1000), size: Int(0), url: optional(Str(4000)) }), 100)),
    embeds: optional(List(Str(6000), 100)),
    stickers: optional(List(Str(100), 100)),
})
export type TicketTranscriptMessage = typeof TicketTranscriptMessage.Type
/** automatic marks the one transcript of a ticket that each close and capture bring up to date */
export const TicketTranscript = Schema.Struct({
    transcriptNo: Int(1),
    ticketNo,
    channelId: Id,
    capturedAt: Millis,
    messageCount: Int(0),
    truncated: Schema.Boolean,
    erased: Schema.Boolean,
    pages: Int(1),
    automatic: optional(Schema.Literal(true)),
})
export type TicketTranscript = typeof TicketTranscript.Type
export const TicketSource = Schema.Struct({ ...ModerationSource.fields, serverId: Id, context: TicketContext })
export type TicketSource = typeof TicketSource.Type

const configurationOperations = [
    Schema.Struct({
        type: Schema.Literal("settings"),
        enabled: optional(Schema.Boolean),
        retentionDays: optional(Int(1, 365)),
    }).check(Schema.makeFilter((v) => v.enabled !== undefined || v.retentionDays !== undefined)),
    Schema.Struct({
        type: Schema.Literal("category-create"),
        name: nameInput,
        visibility: TicketVisibility,
        description: optional(description),
        parentId: optional(Schema.NullOr(Id)),
        supportRoleIds: Ids(TICKET_SUPPORT_ROLES),
        roles: optional(roles),
    }),
    Schema.Struct({
        type: Schema.Literal("category-update"),
        name: nameInput,
        expectedRevision: Int(1),
        patch: Schema.Struct({
            enabled: optional(Schema.Boolean),
            visibility: optional(TicketVisibility),
            description: optional(description),
            parentId: optional(Schema.NullOr(Id)),
            supportRoleIds: optional(Ids(TICKET_SUPPORT_ROLES)),
            questions: optional(TicketQuestions),
        }).check(Schema.makeFilter((v) => Object.keys(v).length > 0)),
        roles: optional(roles),
    }),
    Schema.Struct({ type: Schema.Literal("category-delete"), name: nameInput, expectedRevision: Int(1) }),
    Schema.Struct({
        type: Schema.Literal("canned-set"),
        name: nameInput,
        expectedRevision: Int(1),
        cannedName: nameInput,
        templateName: nameInput,
        expectedTemplateRevision: Int(1),
    }),
    Schema.Struct({
        type: Schema.Literal("canned-remove"),
        name: nameInput,
        expectedRevision: Int(1),
        cannedName: nameInput,
    }),
] as const
/** The ticket settings and category changes that chat and dashboard jobs share */
export const TicketConfigurationOperation = Schema.Union(configurationOperations)
export type TicketConfigurationOperation = typeof TicketConfigurationOperation.Type
const ticketOp = { ticketNo, expectedGeneration: generation }
export const TicketManageOperation = Schema.Union([
    ...configurationOperations,
    Schema.Struct({ type: Schema.Literals(["claim", "unclaim"]), ...ticketOp }),
    Schema.Struct({
        type: Schema.Literal("priority"),
        ...ticketOp,
        priority: Schema.Literals(["low", "normal", "high", "urgent"]),
    }),
    Schema.Struct({ type: Schema.Literal("reply"), ...ticketOp, content: PublishingContent }),
    Schema.Struct({ type: Schema.Literal("canned-reply"), ...ticketOp, cannedName: nameInput }),
    Schema.Struct({ type: Schema.Literal("note"), ...ticketOp, content: Text(2000) }),
    Schema.Struct({ type: Schema.Literals(["close", "reopen"]), ...ticketOp }),
    Schema.Struct({ type: Schema.Literals(["delete", "erase"]), ...ticketOp, confirm: Schema.Literal(true) }),
    Schema.Struct({ type: Schema.Literal("abandon"), ...ticketOp }),
    /** Brings the ticket's automatic transcript up to date in the background */
    Schema.Struct({ type: Schema.Literal("transcript-capture"), ...ticketOp }),
    /** A posted reaction panel for a category, which replaces the category's old one */
    Schema.Struct({ type: Schema.Literal("panel-save"), categoryName: nameInput, channelId: Id, messageId: Id }),
    Schema.Struct({ type: Schema.Literal("panel-remove"), categoryName: nameInput }),
    /** Staff turn a help desk post into a ticket for its author, whose membership the bot read just before */
    Schema.Struct({
        type: Schema.Literal("escalate"),
        categoryName: nameInput,
        requesterId: Id,
        requesterJoinedAt: IsoTime,
        postId: Id,
    }),
])
export type TicketManageOperation = typeof TicketManageOperation.Type
export const TicketManageRequest = Schema.Struct({ ...TicketSource.fields, operation: TicketManageOperation })
export type TicketManageRequest = typeof TicketManageRequest.Type
export const TicketPanel = Schema.Struct({
    categoryName: PublishingName,
    channelId: Id,
    messageId: Id,
    createdAt: Millis,
})
export type TicketPanel = typeof TicketPanel.Type
const duplicate = Schema.Struct({ duplicate: Schema.Literal(true) })
export const TicketManageResult = Schema.Union([
    duplicate,
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings: TicketSettings }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("category"), category: TicketCategory }),
    /** panel is the category's reaction panel, removed with it */
    Schema.Struct({
        duplicate: Schema.Literal(false),
        type: Schema.Literal("deleted"),
        name: PublishingName,
        panel: optional(TicketPanel),
    }),
    Schema.Struct({
        duplicate: Schema.Literal(false),
        type: Schema.Literal("ticket"),
        ticket: TicketRecord,
        grant: optional(TicketActionGrant),
    }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("entry"), entry: TicketEntry }),
    /** replaced is the panel the new one took the place of, whose message the bot deletes once */
    Schema.Struct({
        duplicate: Schema.Literal(false),
        type: Schema.Literal("panel"),
        panel: TicketPanel,
        replaced: optional(TicketPanel),
    }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("panel-removed"), panel: TicketPanel }),
])
export type TicketManageResult = typeof TicketManageResult.Type
const intakeOp = { intakeNo: Int(1), expectedGeneration: Int(1) }
export const TicketIntakeRequest = Schema.Struct({
    ...TicketSource.fields,
    operation: Schema.Union([
        Schema.Struct({ type: Schema.Literal("open"), categoryName: nameInput, expectedCategoryRevision: Int(1) }),
        Schema.Struct({ type: Schema.Literal("answer"), ...intakeOp, question: Int(1), answer: Text(2000) }),
        Schema.Struct({ type: Schema.Literal("clear"), ...intakeOp, question: Int(1) }),
        Schema.Struct({ type: Schema.Literal("cancel"), ...intakeOp }),
        Schema.Struct({
            type: Schema.Literal("submit"),
            ...intakeOp,
            expectedCategoryRevision: Int(1),
            visibility: TicketVisibility,
        }),
    ]),
})
export type TicketIntakeRequest = typeof TicketIntakeRequest.Type
export const TicketIntakeResult = Schema.Union([
    duplicate,
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("intake"), intake: TicketIntake }),
    Schema.Struct({
        duplicate: Schema.Literal(false),
        type: Schema.Literal("ticket"),
        ticket: TicketRecord,
        grant: TicketActionGrant,
    }),
])
export type TicketIntakeResult = typeof TicketIntakeResult.Type
/** A member's live draft on any server, so a plain DM reply can find it. Server and intake numbers only */
export const TicketOpenIntake = Schema.Struct({ serverId: Id, intakeNo: Int(1) })
export type TicketOpenIntake = typeof TicketOpenIntake.Type
export const TicketOpenIntakesRequest = Schema.Struct({ userId: Id })
export type TicketOpenIntakesRequest = typeof TicketOpenIntakesRequest.Type
export const TicketOpenIntakesResult = List(TicketOpenIntake, 10)
export type TicketOpenIntakesResult = typeof TicketOpenIntakesResult.Type
export const TicketQueryRequest = Schema.Struct({
    serverId: Id,
    context: TicketContext,
    operation: Schema.Union([
        Schema.Struct({ type: Schema.Literal("settings") }),
        /** One page of categories in name order after a name, or only the categories that are on */
        Schema.Struct({
            type: Schema.Literal("categories"),
            after: optional(nameInput),
            enabled: optional(Schema.Literal(true)),
        }),
        Schema.Struct({ type: Schema.Literal("category"), name: nameInput }),
        Schema.Struct({ type: Schema.Literal("category-config"), name: nameInput }),
        Schema.Struct({ type: Schema.Literal("intake"), intakeNo: Int(1) }),
        Schema.Struct({ type: Schema.Literals(["ticket", "private-intake"]), ticketNo }),
        /** The ticket whose channel this is */
        Schema.Struct({ type: Schema.Literal("ticket"), channelId: Id }),
        Schema.Struct({ type: Schema.Literal("tickets"), beforeTicketNo: optional(Int(1)) }),
        Schema.Struct({
            type: Schema.Literal("entries"),
            ticketNo,
            kind: Schema.Literals(["reply", "note"]),
            beforeEntryNo: optional(Int(1)),
        }),
        Schema.Struct({ type: Schema.Literal("attempt"), ticketNo, attemptNo: Int(1) }),
        Schema.Struct({ type: Schema.Literal("transcripts"), ticketNo, beforeTranscriptNo: optional(Int(1)) }),
        Schema.Struct({ type: Schema.Literal("transcript"), ticketNo, transcriptNo: Int(1), page: optional(Int(1)) }),
        /** Up to 100 page texts from fromPage on, for a transcript file */
        Schema.Struct({ type: Schema.Literal("transcript-pages"), ticketNo, transcriptNo: Int(1), fromPage: Int(1) }),
    ]),
})
export type TicketQueryRequest = typeof TicketQueryRequest.Type
export const TicketQueryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings: TicketSettings }),
    Schema.Struct({
        type: Schema.Literal("categories"),
        categories: List(TicketCategorySummary, TICKET_CATEGORY_PAGE),
        nextAfter: optional(PublishingName),
    }),
    Schema.Struct({ type: Schema.Literal("category"), category: TicketCategorySummary }),
    Schema.Struct({ type: Schema.Literal("category-config"), category: TicketCategory }),
    Schema.Struct({ type: Schema.Literal("intake"), intake: TicketIntake }),
    Schema.Struct({ type: Schema.Literal("ticket"), ticket: TicketRecord }),
    Schema.Struct({
        type: Schema.Literal("private-intake"),
        ticketNo,
        questions: List(Str(200), TICKET_QUESTIONS),
        answers: List(Str(2000), TICKET_QUESTIONS),
        erased: Schema.Boolean,
    }),
    /** hidden is set outside a DM when tickets whose readers differ from the channel's were left out */
    Schema.Struct({
        type: Schema.Literal("tickets"),
        tickets: List(TicketRecord, 20),
        nextBeforeTicketNo: optional(Int(1)),
        hidden: optional(Schema.Literal(true)),
    }),
    Schema.Struct({
        type: Schema.Literal("entries"),
        entries: List(TicketEntry, 20),
        nextBeforeEntryNo: optional(Int(1)),
    }),
    Schema.Struct({ type: Schema.Literal("attempt"), attempt: TicketAttempt }),
    Schema.Struct({
        type: Schema.Literal("transcripts"),
        transcripts: List(TicketTranscript, 20),
        nextBeforeTranscriptNo: optional(Int(1)),
    }),
    Schema.Struct({ type: Schema.Literal("transcript"), transcript: TicketTranscript, page: Int(1), text: Str(1500) }),
    Schema.Struct({
        type: Schema.Literal("transcript-pages"),
        transcript: TicketTranscript,
        texts: List(Str(1500), 100),
        nextPage: optional(Int(1)),
    }),
])
export type TicketQueryResult = typeof TicketQueryResult.Type
/** The backend matches the attempt, its generation and source, and refuses a mismatch as a conflict */
export const TicketBinding = Schema.Struct({
    serverId: Id,
    ticketNo,
    generation: Schema.Finite,
    attemptId: Schema.String,
    sourceId: Schema.String,
})
export type TicketBinding = typeof TicketBinding.Type
export const TicketDispatchRequest = Schema.Struct({ ...TicketBinding.fields, claimToken, context: TicketContext })
export type TicketDispatchRequest = typeof TicketDispatchRequest.Type
export const TicketDispatchResult = Schema.Struct({
    claimed: Schema.Boolean,
    dispatchExpiresAt: Int(1),
    nativeDeadlineMs: Schema.Literal(5000),
})
export type TicketDispatchResult = typeof TicketDispatchResult.Type
/** Only a failed attempt that never dispatched carries noDispatch */
export const TicketOutcomeRequest = Schema.Struct({
    ...TicketBinding.fields,
    claimToken: optional(claimToken),
    outcome: Schema.Literals(["succeeded", "failed", "uncertain"]),
    noDispatch: optional(Schema.Literal(true)),
    channelId: optional(Id),
    channel: optional(TicketChannelSnapshot),
    messageId: optional(Id),
    observedAt: optional(Millis),
    channelAbsent: optional(Schema.Literal(true)),
    nativeDeleteConfirmed: optional(Schema.Literal(true)),
}).check(Schema.makeFilter((v) => v.noDispatch === undefined || v.outcome === "failed"))
export type TicketOutcomeRequest = typeof TicketOutcomeRequest.Type
export const TicketOutcomeResult = Schema.Struct({
    recorded: Schema.Boolean,
    ticket: TicketRecord,
    grant: optional(TicketActionGrant),
})
export type TicketOutcomeResult = typeof TicketOutcomeResult.Type
/** An observation names the channel snapshot exactly when the channel is present */
export const TicketReconcileRequest = Schema.Struct({
    ...TicketSource.fields,
    ticketNo,
    expectedGeneration: generation,
    /** Left out when retention already removed the last action, which only a confirmed absent channel may settle */
    attemptId: optional(Schema.String),
    observation: Schema.Struct({
        ...origin,
        observedAt: Millis,
        channelId: Id,
        channelAbsent: Schema.Boolean,
        channel: optional(TicketChannelSnapshot),
    }).check(Schema.makeFilter((v) => v.channelAbsent === (v.channel === undefined))),
})
export type TicketReconcileRequest = typeof TicketReconcileRequest.Type
export const TicketReconcileResult = Schema.Struct({ recorded: Schema.Boolean, ticket: TicketRecord })
export type TicketReconcileResult = typeof TicketReconcileResult.Type
/**
 * One chunk of new messages of the ticket channel or one of its public threads, oldest first, for the automatic transcript.
 * after is the last message already saved from that source, or null for its first chunk. A chunk is one Fluxer history page
 * at most, and the bot keeps its serialized size under 200,000 bytes, below the backend's 262,144-byte request limit
 */
export const TicketTranscriptAppendRequest = Schema.Struct({
    serverId: Id,
    ticketNo,
    dueAt: Millis,
    botId: Id,
    channel: TicketChannelSnapshot,
    source: Schema.Struct({ id: Id, thread: optional(Str(100)) }),
    after: Schema.NullOr(Id),
    messages: List(TicketTranscriptMessage, 100).check(Schema.makeFilter((rows) => rows.length > 0)),
})
export type TicketTranscriptAppendRequest = typeof TicketTranscriptAppendRequest.Type
/** duplicate means the saved transcript already holds the chunk */
export const TicketTranscriptAppendResult = Schema.Struct({ duplicate: Schema.Boolean, transcriptNo: Int(1) })
export type TicketTranscriptAppendResult = typeof TicketTranscriptAppendResult.Type
/** saved after every source was read to its end, absent when the ticket channel is gone, failed when a read failed */
export const TicketTranscriptDoneRequest = Schema.Struct({
    serverId: Id,
    ticketNo,
    dueAt: Millis,
    outcome: Schema.Literals(["saved", "failed", "absent"]),
})
export type TicketTranscriptDoneRequest = typeof TicketTranscriptDoneRequest.Type
export const TicketTranscriptDoneResult = Schema.Struct({ recorded: Schema.Boolean })
export type TicketTranscriptDoneResult = typeof TicketTranscriptDoneResult.Type
export const TicketWorkRequest = Schema.Struct({
    serverId: Id,
    operation: Schema.Union([
        Schema.Struct({ type: Schema.Literal("due") }),
        Schema.Struct({ type: Schema.Literal("cursor"), ticketNo, sourceId: Id }),
        Schema.Struct({ type: Schema.Literal("panels"), after: optional(PublishingName) }),
    ]),
})
export type TicketWorkRequest = typeof TicketWorkRequest.Type
export const TicketDueTranscript = Schema.Struct({ ticketNo, dueAt: Millis, channelId: Id, botId: Id })
export type TicketDueTranscript = typeof TicketDueTranscript.Type
export const TicketWorkResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("due"), tickets: List(TicketDueTranscript, 10) }),
    Schema.Struct({ type: Schema.Literal("cursor"), lastMessageId: Schema.NullOr(Id) }),
    Schema.Struct({
        type: Schema.Literal("panels"),
        panels: List(TicketPanel, TICKET_PANEL_PAGE),
        nextAfter: optional(PublishingName),
    }),
])
export type TicketWorkResult = typeof TicketWorkResult.Type
