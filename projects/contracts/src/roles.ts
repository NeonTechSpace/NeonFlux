import { Schema } from "effect"
import { Cursor, Id, Ids, Int, IsoTime, List, Millis, Token, origin } from "./common.ts"
import { PublishingContent } from "./publishing-base.ts"
import { ModerationActor, ModerationSource, RolesMemberContext, RolesRoleSnapshot } from "./shared.ts"

// Role panels, rules verification, autorole and reservations, see docs/BOT.md#role-panels-reaction-verification-autorole-and-reservations

/** A reserved grant may claim its native call for three minutes, and the native call itself gets five seconds */
export const ROLES_DISPATCH_WINDOW = 180000, ROLES_NATIVE_DEADLINE = 5000
const optional = Schema.optionalKey, flag = optional(Schema.Boolean)
const distinct = (values: ReadonlyArray<string>) => new Set(values).size === values.length
/** Backend row IDs and consumer keys in answers */
const key = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const nextCursor = optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)))
const panelName = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,31}$/))
/** A panel name a command typed. The backend trims and lowercases it */
const nameInput = Schema.String.check(Schema.makeFilter((value: string) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value.trim().toLowerCase())))
const snapshots = List(RolesRoleSnapshot, 1000)
/** An emoji a panel maps: up to 100 characters without surrounding space or line breaks */
export const RolesEmoji = Schema.String.check(Schema.makeFilter((value: string) => value !== "" && value === value.trim() && value.length <= 100 && !/[\r\n\u000c\u202e]/.test(value)))
/** The capability that binds one claimed native call or reaction page */
export const RolesClaimToken = Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/))

export const RolesReservation = Schema.Struct({ userId: Id, roleIds: Ids(20).check(Schema.isMinLength(1)) })
export type RolesReservation = typeof RolesReservation.Type
/** Up to 100 reservations, one per user, as a request sends them. The backend drops repeated role IDs */
export const RolesReservationsInput = List(RolesReservation, 100).check(Schema.makeFilter(rows => distinct(rows.map(row => row.userId))))
/** Reservations as the backend keeps them */
export const RolesReservations = RolesReservationsInput.check(Schema.makeFilter(rows => rows.every(row => distinct(row.roleIds))))
export const RolesSettings = Schema.Struct({ panelsEnabled: Schema.Boolean, verificationEnabled: Schema.Boolean, advancedVerificationEnabled: flag, autoroleEnabled: Schema.Boolean,
    humansOnly: Schema.Boolean, autoroleIds: Ids(20).check(Schema.makeFilter(distinct)), reservations: optional(RolesReservations), revision: Int(1) })
export type RolesSettings = typeof RolesSettings.Type
export const RolesPanelKind = Schema.Literals(["reaction", "verification"])
export type RolesPanelKind = typeof RolesPanelKind.Type
export const RolesMapping = Schema.Struct({ emoji: RolesEmoji, roleId: Id, prerequisiteRoleIds: Ids(20), exclusionRoleIds: Ids(20) }).check(Schema.makeFilter(value =>
    !value.prerequisiteRoleIds.includes(value.roleId) && !value.exclusionRoleIds.includes(value.roleId) && !value.prerequisiteRoleIds.some(id => value.exclusionRoleIds.includes(id))))
export type RolesMapping = typeof RolesMapping.Type
/** Up to 20 mappings with distinct emojis and roles, as a request sends them. The backend drops repeated prerequisite and exclusion roles */
export const RolesMappingsInput = List(RolesMapping, 20).check(Schema.makeFilter(list => distinct(list.map(row => row.emoji)) && distinct(list.map(row => row.roleId))))
/** Mappings as the backend keeps them */
export const RolesMappings = RolesMappingsInput.check(Schema.makeFilter(list => list.every(row => distinct(row.prerequisiteRoleIds) && distinct(row.exclusionRoleIds))))
export const RolesPanelSnapshot = Schema.Struct({ revision: Int(1), publishedAt: Millis, postNo: Int(1), postGeneration: Int(1), channelId: Id, messageId: Id, botId: Id,
    content: PublishingContent, mappings: RolesMappings, exclusive: Schema.Boolean })
export type RolesPanelSnapshot = typeof RolesPanelSnapshot.Type
export const RolesPanel = Schema.Struct({ name: panelName, kind: RolesPanelKind, revision: Int(1), enabled: Schema.Boolean, exclusive: Schema.Boolean, mappings: RolesMappings,
    published: optional(RolesPanelSnapshot), withdrawing: Schema.Boolean }).check(Schema.makeFilter(value => !value.published || value.published.revision <= value.revision))
export type RolesPanel = typeof RolesPanel.Type
export const RolesSource = Schema.Struct({ sourceId: Token, createdAt: Millis })
export type RolesSource = typeof RolesSource.Type
export const RolesOutcome = Schema.Literals(["pending", "succeeded", "failed", "uncertain"])
export type RolesOutcome = typeof RolesOutcome.Type
const grantFields = { attemptId: key, ownershipId: key, generation: Int(1), sourceId: key, action: Schema.Literals(["add", "remove"]), userId: Id, joinedAt: IsoTime, roleId: Id, botId: Id,
    expectedPresent: Schema.Boolean, consumerKey: key, dispatchExpiresAt: Int(1), nativeDeadlineMs: Schema.Literal(ROLES_NATIVE_DEADLINE) }
/** A reserved native role change. A removal expects the role present and an addition expects it absent */
export const RolesGrant = Schema.Struct(grantFields).check(Schema.makeFilter(value => value.expectedPresent === (value.action === "remove")))
export type RolesGrant = typeof RolesGrant.Type
export const RolesAttempt = Schema.Struct({ ...grantFields, outcome: RolesOutcome, createdAt: Millis, finishedAt: optional(Millis), noDispatch: optional(Schema.Literal(true)), dispatchedAt: optional(Millis) })
    .check(Schema.makeFilter(value => value.expectedPresent === (value.action === "remove") && value.dispatchExpiresAt === value.createdAt + ROLES_DISPATCH_WINDOW
        && (value.finishedAt === undefined || value.finishedAt >= value.createdAt)
        && (value.dispatchedAt === undefined || value.dispatchedAt >= value.createdAt && value.dispatchedAt < value.dispatchExpiresAt)
        && (!value.noDispatch || value.outcome === "failed" && value.dispatchedAt === undefined)))
export type RolesAttempt = typeof RolesAttempt.Type
/** A member's ownership of one role in one membership epoch. Generation 0 is a reference without any attempt */
export const RolesClaim = Schema.Struct({ ownershipId: key, userId: Id, joinedAt: IsoTime, roleId: Id, generation: Int(), owned: Schema.Boolean, status: Schema.Literals(["idle", "pending", "uncertain"]),
    consumerKeys: List(key, 100), attempt: optional(RolesAttempt) }).check(Schema.makeFilter(value => (value.generation !== 0 || !value.owned && value.status === "idle" && value.attempt === undefined)
        && (!value.attempt || value.attempt.ownershipId === value.ownershipId && value.attempt.userId === value.userId && value.attempt.joinedAt === value.joinedAt
            && value.attempt.roleId === value.roleId && value.attempt.generation === value.generation)))
export type RolesClaim = typeof RolesClaim.Type
export const RolesAcknowledgment = Schema.Struct({ acknowledged: Schema.Boolean, rulesRevision: optional(Int(1)), acknowledgedAt: optional(Millis), accessConfirmed: Schema.Boolean, accessRolePresent: Schema.Boolean })
export type RolesAcknowledgment = typeof RolesAcknowledgment.Type
/** A settings patch changes at least one setting. Stored row IDs and the settings revision a chat edit read are checked by the backend, which answers 404 or 409 */
export const RolesManageOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), patch: Schema.Struct({ panelsEnabled: flag, verificationEnabled: flag, advancedVerificationEnabled: flag, autoroleEnabled: flag, humansOnly: flag,
        autoroleIds: optional(Ids(20)), reservations: optional(RolesReservationsInput) }).check(Schema.makeFilter(patch => Object.keys(patch).length > 0)), roles: optional(snapshots), expectedRevision: optional(Schema.Number) }),
    Schema.Struct({ type: Schema.Literal("panel-create"), name: nameInput, kind: RolesPanelKind, mappings: optional(RolesMappingsInput), roles: optional(snapshots), exclusive: flag }),
    Schema.Struct({ type: Schema.Literal("panel-update"), name: nameInput, expectedRevision: Int(1), patch: Schema.Struct({ enabled: flag, exclusive: flag, mappings: optional(RolesMappingsInput) }), roles: optional(snapshots) }),
    Schema.Struct({ type: Schema.Literal("panel-bind"), name: nameInput, expectedRevision: Int(1), postNo: Int(1), expectedPostGeneration: Int(1) }),
    Schema.Struct({ type: Schema.Literal("withdraw"), name: nameInput, revision: Int(1), deletePanel: flag }),
    Schema.Struct({ type: Schema.Literal("autorole-withdraw"), revision: Int(1) }),
    Schema.Struct({ type: Schema.Literal("withdraw-next"), withdrawalId: Schema.String, expectedStep: Int() }),
    Schema.Struct({ ...origin, type: Schema.Literal("withdraw-departed"), withdrawalId: Schema.String, userId: Id, joinedAt: IsoTime, currentJoinedAt: Schema.NullOr(IsoTime), observedAt: Millis,
        memberUserId: optional(Schema.String) }),
])
export type RolesManageOperation = typeof RolesManageOperation.Type
export const RolesWithdrawal = Schema.Struct({ withdrawalId: key, consumerKey: key, step: Int(1), status: Schema.Literals(["pending", "blocked", "complete"]), remainingAtLeast: Int(), hasMore: Schema.Boolean,
    deletePanel: Schema.Boolean, targets: List(Schema.Struct({ userId: Id, joinedAt: IsoTime, roleId: Id }), 10), nextCursor }).check(Schema.makeFilter(value => value.remainingAtLeast >= value.targets.length
        && (value.status !== "complete" || value.remainingAtLeast === 0 && !value.hasMore && value.targets.length === 0)))
export type RolesWithdrawal = typeof RolesWithdrawal.Type
export const RolesManageRequest = Schema.Struct({ ...ModerationSource.fields, serverId: Id, actor: ModerationActor, operation: RolesManageOperation })
export type RolesManageRequest = typeof RolesManageRequest.Type
export const RolesManageResult = Schema.Union([Schema.Struct({ duplicate: Schema.Literal(true) }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings: RolesSettings }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("panel"), panel: RolesPanel }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("withdrawal"), withdrawal: RolesWithdrawal })])
export type RolesManageResult = typeof RolesManageResult.Type
export const RolesQueryRequest = Schema.Struct({ serverId: Id, actor: ModerationActor, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings") }), Schema.Struct({ type: Schema.Literal("panel-show"), name: nameInput }), Schema.Struct({ type: Schema.Literal("panel-list"), page: optional(Int(1, 6)) }),
    Schema.Struct({ type: Schema.Literal("claim-list"), userId: Id, joinedAt: IsoTime, cursor: optional(Cursor) }),
    Schema.Struct({ type: Schema.Literal("attempt-show"), attemptId: Schema.String }), Schema.Struct({ type: Schema.Literal("withdrawal-show"), withdrawalId: Schema.String, cursor: optional(Cursor) }),
    /** The newest unfinished role removal of the named panel, or of autorole without a name */
    Schema.Struct({ type: Schema.Literal("withdrawal-open"), name: optional(nameInput) }),
    Schema.Struct({ type: Schema.Literal("configuration-list"), name: optional(nameInput), cursor: optional(Cursor) }),
]) })
export type RolesQueryRequest = typeof RolesQueryRequest.Type
export const RolesQueryResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings: RolesSettings }), Schema.Struct({ type: Schema.Literal("panel"), panel: RolesPanel }),
    Schema.Struct({ type: Schema.Literal("panels"), panels: List(RolesPanel, 10), page: Int(1), totalPages: Int(1) }),
    Schema.Struct({ type: Schema.Literal("claims"), claims: List(RolesClaim, 10), nextCursor }),
    Schema.Struct({ type: Schema.Literal("attempt"), attempt: RolesAttempt }), Schema.Struct({ type: Schema.Literal("withdrawal"), withdrawal: RolesWithdrawal }),
    Schema.Struct({ type: Schema.Literal("configurations"), references: List(Schema.Struct({ consumerKey: key, roleId: Id, postNo: optional(Int(1)) }), 10), nextCursor }),
])
export type RolesQueryResult = typeof RolesQueryResult.Type
export const RolesEvaluateOperation = Schema.Union([
    Schema.Struct({ type: Schema.Literal("choose"), name: panelName, revision: Int(1), roleId: Id, selected: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("level-sync"), roleId: Id }),
    Schema.Struct({ type: Schema.Literal("reaction"), name: panelName, revision: Int(1), messageId: Id, presentEmojis: List(RolesEmoji, 20), panelVerified: Schema.Boolean }),
    Schema.Struct({ type: Schema.Literal("verify"), name: panelName, revision: Int(1), messageId: optional(Id), panelVerified: flag, reactionPresent: flag }),
    Schema.Struct({ type: Schema.Literal("join") }),
    Schema.Struct({ type: Schema.Literal("withdraw"), withdrawalId: Token, roleId: Id }),
    Schema.Struct({ type: Schema.Literal("withdraw-member"), consumerKey: Schema.String.check(Schema.isPattern(/^(panel:[a-z0-9][a-z0-9_-]{0,31}|autorole):[1-9]\d{0,15}$/)), roleId: Id }),
    /** A website role picker request. The queued member job binds the menu, role and direction */
    Schema.Struct({ type: Schema.Literal("pick"), jobId: Token, menu: panelName, roleId: Id, selected: Schema.Boolean }),
    /** A temporary role. The grant decides the direction: Added before its end time and removed after it. The source is the grant's sourceId */
    Schema.Struct({ type: Schema.Literal("temporary"), roleId: Id }),
    /** The onboarding completion role, added once. The source is the one the member's onboarding progress names */
    Schema.Struct({ type: Schema.Literal("onboarding"), roleId: Id }),
])
export type RolesEvaluateOperation = typeof RolesEvaluateOperation.Type
/** Where one member of a claimed reaction page sits. The backend compares generation and page step with the job */
export const RolesReactionJobBinding = Schema.Struct({ jobId: Schema.String, generation: Schema.Number, claimToken: RolesClaimToken, pageStep: Schema.Number, index: Int(0, 9) })
export type RolesReactionJobBinding = typeof RolesReactionJobBinding.Type
/** Level rewards, temporary roles and onboarding roles take no continuation, actor or reaction page */
export const RolesEvaluateRequest = Schema.Struct({ ...RolesSource.fields, serverId: Id, context: RolesMemberContext, operation: RolesEvaluateOperation, continuationAttemptId: optional(Schema.String),
    actor: optional(ModerationActor), reactionJob: optional(RolesReactionJobBinding) }).check(Schema.makeFilter(value => !["level-sync", "temporary", "onboarding"].includes(value.operation.type)
        || value.continuationAttemptId === undefined && value.actor === undefined && value.reactionJob === undefined))
export type RolesEvaluateRequest = typeof RolesEvaluateRequest.Type
export const RolesEvaluateResult = Schema.Struct({ duplicate: Schema.Boolean, status: Schema.Literals(["unchanged", "acknowledged", "reserved", "partial", "ambiguous", "blocked"]),
    acknowledgment: RolesAcknowledgment, grant: optional(RolesGrant) })
export type RolesEvaluateResult = typeof RolesEvaluateResult.Type
const attemptBinding = { serverId: Id, attemptId: Schema.String, ownershipId: Schema.String, generation: Schema.Number, sourceId: Schema.String }
export const RolesDispatchRequest = Schema.Struct({ ...attemptBinding, claimToken: RolesClaimToken, context: RolesMemberContext, actor: optional(ModerationActor) })
export type RolesDispatchRequest = typeof RolesDispatchRequest.Type
export const RolesDispatchResult = Schema.Struct({ claimed: Schema.Boolean, dispatchExpiresAt: Int(1), nativeDeadlineMs: Schema.Literal(ROLES_NATIVE_DEADLINE) })
export type RolesDispatchResult = typeof RolesDispatchResult.Type
export const RolesOutcomeRequest = Schema.Struct({ ...attemptBinding, claimToken: optional(RolesClaimToken), outcome: Schema.Literals(["succeeded", "failed", "uncertain"]) })
export type RolesOutcomeRequest = typeof RolesOutcomeRequest.Type
export const RolesOutcomeResult = Schema.Struct({ recorded: Schema.Boolean })
export type RolesOutcomeResult = typeof RolesOutcomeResult.Type
export const RolesReconcileRequest = Schema.Struct({ ...ModerationSource.fields, serverId: Id, actor: ModerationActor, attemptId: Schema.String, generation: Schema.Number,
    observation: Schema.Struct({ ...origin, observedAt: Millis, userId: Id, joinedAt: IsoTime, roleId: Id, present: Schema.Boolean }) })
export type RolesReconcileRequest = typeof RolesReconcileRequest.Type
export const RolesReconcileResult = Schema.Struct({ recorded: Schema.Boolean, claim: RolesClaim })
export type RolesReconcileResult = typeof RolesReconcileResult.Type
export const RolesMemberQueryRequest = Schema.Struct({ serverId: Id, context: RolesMemberContext })
export type RolesMemberQueryRequest = typeof RolesMemberQueryRequest.Type
/** A server keeps at most 50 reaction panels and one verification panel */
export const RolesMemberQueryResult = Schema.Struct({ settings: RolesSettings, panels: List(RolesPanel, 51).check(Schema.makeFilter(panels => panels.filter(panel => panel.kind === "verification").length <= 1
    && panels.filter(panel => panel.kind === "reaction").length <= 50 && distinct(panels.map(panel => panel.name)))), acknowledgment: RolesAcknowledgment })
export type RolesMemberQueryResult = typeof RolesMemberQueryResult.Type
export const RolesObserveRequest = Schema.Struct({ serverId: Id, mode: Schema.Literals(["restart", "aged"]) })
export type RolesObserveRequest = typeof RolesObserveRequest.Type
export const RolesObserveResult = Schema.Struct({ uncertainAttempts: Int() })
export type RolesObserveResult = typeof RolesObserveResult.Type
export const RolesPolicyRequest = Schema.Struct({ serverId: Id })
export type RolesPolicyRequest = typeof RolesPolicyRequest.Type
export const RolesPolicyResult = Schema.Struct({ settings: RolesSettings })
export type RolesPolicyResult = typeof RolesPolicyResult.Type
export const RolesReactionJob = Schema.Struct({ jobId: key, name: panelName, revision: Int(1), messageId: Id, channelId: Id, generation: Int(), pageStep: Int(),
    status: Schema.Literals(["queued", "running", "blocked", "complete", "cancelled"]), rerun: Schema.Boolean, leaseExpiresAt: optional(Int(1)) })
export type RolesReactionJob = typeof RolesReactionJob.Type
export const RolesReactionJobsRequest = Schema.Struct({ serverId: Id, operation: Schema.Union([
    Schema.Struct({ type: Schema.Literal("enqueue"), messageId: Id }),
    Schema.Struct({ type: Schema.Literal("list") }),
    Schema.Struct({ type: Schema.Literal("claim"), jobId: Schema.String, claimToken: RolesClaimToken }),
    Schema.Struct({ ...origin, type: Schema.Literal("skip"), binding: RolesReactionJobBinding, currentJoinedAt: Schema.NullOr(IsoTime), observedAt: optional(Millis), memberUserId: optional(Schema.String) }),
    Schema.Struct({ type: Schema.Literal("block"), binding: RolesReactionJobBinding }),
    Schema.Struct({ type: Schema.Literal("checkpoint"), jobId: Schema.String, generation: Schema.Number, claimToken: RolesClaimToken, pageStep: Schema.Number, blocked: Schema.Boolean }),
]) })
export type RolesReactionJobsRequest = typeof RolesReactionJobsRequest.Type
export const RolesReactionJobsResult = Schema.Union([
    Schema.Struct({ type: Schema.Literal("jobs"), jobs: List(RolesReactionJob, 51) }),
    Schema.Struct({ type: Schema.Literal("job"), job: RolesReactionJob }),
    Schema.Struct({ type: Schema.Literal("page"), claimed: Schema.Literal(false), job: RolesReactionJob }),
    Schema.Struct({ type: Schema.Literal("page"), claimed: Schema.Literal(true), job: RolesReactionJob, targets: List(Schema.Struct({ userId: Id, joinedAt: IsoTime, sourceId: key }), 10),
        hasMore: Schema.Boolean }),
])
export type RolesReactionJobsResult = typeof RolesReactionJobsResult.Type
