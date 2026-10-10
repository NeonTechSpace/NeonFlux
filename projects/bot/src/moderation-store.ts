import type * as C from "@neonflux/backend/contracts"
import { snowflakes } from "@neontechspace/fluxerly/effect"
import { Data, Effect, Schema } from "effect"
import { createBackendRequest } from "./backend-http.ts"
import type { BackendConfig } from "./config.ts"
import { validOwnedPostingBits } from "./safety-permissions.ts"

const integer = (min: number, max = Number.MAX_SAFE_INTEGER) => Schema.Number.check(Schema.makeFilter((n) => Number.isSafeInteger(n) && n >= min && n <= max))
const id = Schema.String.check(Schema.makeFilter((value) => snowflakes.isValid(value) && value !== "0"))
const key = Schema.String.check(Schema.makeFilter((value) => /^[a-zA-Z0-9_-]{1,128}$/.test(value)))
const text = (max: number, empty = false) => Schema.String.check(Schema.makeFilter((value) => value.length <= max && (empty || !!value.replace(/[\u000c\u202e]/g, "").trim())))
const ids = Schema.mutable(Schema.Array(id)).check(Schema.isMaxLength(20), Schema.makeFilter((values) => new Set(values).size === values.length))
const time = integer(0)
const iso = Schema.String.check(Schema.makeFilter((value) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value))))
const nullableIso = Schema.Union([Schema.Null, iso])
const action = Schema.Literals(["log", "warn", "kick", "ban", "unban", "timeout", "untimeout", "delete", "purge", "slowmode", "lock", "unlock", "quarantine", "release"])
const outcome = Schema.Literals(["succeeded", "failed", "uncertain"])
const name = Schema.String.check(Schema.makeFilter((value) => /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value)))
const bits = Schema.String.check(Schema.makeFilter((value) => /^(0|[1-9]\d{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n))
// A lock owns SendMessages and at most the thread bits beside it, so a grant can never rewrite other permissions
const ownedLockBits = Schema.String.check(Schema.makeFilter((value) => /^[1-9]\d{0,18}$/.test(value) && validOwnedPostingBits(value)))
const overwrite = Schema.Struct({ exists: Schema.Boolean, allow: bits, deny: bits }).check(Schema.makeFilter((value) => value.exists || (value.allow === "0" && value.deny === "0")))
const observation = Schema.Struct({ observedAt: time, timeoutUntil: Schema.optionalKey(nullableIso), banned: Schema.optionalKey(Schema.Boolean), banExpiresAt: Schema.optionalKey(nullableIso), memberPresent: Schema.optionalKey(Schema.Boolean), overwrite: Schema.optionalKey(overwrite), slowmodeSeconds: Schema.optionalKey(integer(0, 21600)) })
export const automodRuleTypes = ["spam", "repeat", "mentions", "words", "domains", "invites", "mention-rate", "link-rate", "deceptive-links"] as const satisfies readonly C.AutomodRuleType[]
const settings = Schema.Struct({
    staffRoleIds: Schema.Struct({ moderation: ids, cases: ids, automod: ids, security: ids, appeals: ids }),
    logChannelId: Schema.Union([Schema.Null, id]), manualModerationEnabled: Schema.Boolean,
    automodEnabled: Schema.Boolean, automodMode: Schema.Literals(["dry-run", "enforce"]), automodBotMessagesEnabled: Schema.Boolean,
    securityEnabled: Schema.Boolean, securityMode: Schema.Literals(["dry-run", "enforce"]),
    joinEnabled: Schema.Boolean, joinThreshold: integer(2, 100), joinWindowSeconds: integer(1, 300), joinDefcon2: Schema.Boolean,
    honeypotEnabled: Schema.Boolean, honeypotChannelIds: ids, watchlistEnabled: Schema.Boolean, appealsEnabled: Schema.Boolean,
    defcon: Schema.Literals([1, 2, 3]),
})
const rule = Schema.Struct({
    name, type: Schema.Literals(automodRuleTypes), domainMode: Schema.Literals(["block", "allow"]), enabled: Schema.Boolean,
    priority: integer(-100, 100), action: Schema.Literals(["log", "delete", "warn", "timeout"]), threshold: integer(1, 100),
    windowSeconds: integer(1, 300), durationSeconds: integer(1, 31536000),
    patterns: Schema.mutable(Schema.Array(text(200))).check(Schema.isMaxLength(20)), channelIds: ids, exemptChannelIds: ids, exemptRoleIds: ids,
})
export const moderationSettingsSchema = settings
export const automodRuleSchema = rule
const source = Schema.String.check(Schema.makeFilter((value) => (snowflakes.isValid(value) && value !== "0") || /^join:[1-9]\d{0,18}:\d{1,16}$/.test(value)))
const caseSchema = Schema.Struct({
    caseNo: integer(1), actionId: key, sourceId: source, action, origin: Schema.Literals(["manual", "automod", "security"]),
    incident: Schema.optionalKey(Schema.Literals(["join-burst", "honeypot", "watchlist"])),
    actorId: Schema.optionalKey(id), targetId: Schema.optionalKey(id), channelId: Schema.optionalKey(id), reason: text(512, true), ruleName: Schema.optionalKey(name),
    linkedCaseNo: Schema.optionalKey(integer(1)), createdAt: time, expiresAt: time, outcome: Schema.Literals(["pending", "succeeded", "failed", "uncertain"]),
    logOutcome: Schema.Literals(["none", "pending", "sent", "failed", "uncertain"]), notificationOutcome: Schema.Literals(["none", "pending", "sent", "failed", "uncertain"]), erased: Schema.Boolean, voided: Schema.Boolean, observation: Schema.optionalKey(observation),
    corrections: Schema.mutable(Schema.Array(Schema.Struct({ actorId: id, createdAt: time, previousReason: text(512, true), reason: text(512, true), type: Schema.Literals(["reason", "void"]) }))).check(Schema.isMaxLength(20)),
})
const grant = Schema.Struct({
    actionId: key, caseNo: integer(1), sourceId: source, action,
    targetId: Schema.optionalKey(id), channelId: Schema.optionalKey(id), messageIds: Schema.optionalKey(Schema.mutable(Schema.Array(id)).check(Schema.isMinLength(1), Schema.isMaxLength(100), Schema.makeFilter((values) => new Set(values).size === values.length))),
    durationSeconds: Schema.optionalKey(integer(1, 63072000)), reason: text(512), expectedTimeoutUntil: Schema.optionalKey(nullableIso), restoreTimeoutUntil: Schema.optionalKey(nullableIso),
    overwrite: Schema.optionalKey(overwrite), expectedOverwrite: Schema.optionalKey(overwrite), ownedPermissions: Schema.optionalKey(ownedLockBits), recoveryId: Schema.optionalKey(key),
    slowmodeSeconds: Schema.optionalKey(integer(0, 21600)), expectedSlowmodeSeconds: Schema.optionalKey(integer(0, 21600)),
})
const log = Schema.Struct({ logId: key, channelId: id, caseNo: integer(1), action, outcome, targetId: Schema.optionalKey(id), reason: text(512, true) })
const recovery = Schema.Struct({
    recoveryId: key, generation: integer(1), type: Schema.Literals(["timeout", "lock", "ban"]), targetId: Schema.optionalKey(id), channelId: Schema.optionalKey(id),
    caseNo: integer(1), status: Schema.Literals(["pending", "active", "uncertain"]), expectedTimeoutUntil: Schema.optionalKey(nullableIso), previousTimeoutUntil: Schema.optionalKey(nullableIso),
    previousOverwrite: Schema.optionalKey(overwrite), expectedOverwrite: Schema.optionalKey(overwrite), knownDeadline: Schema.optionalKey(time), createdAt: time,
})
const entry = Schema.Struct({ userId: id, reason: text(512, true), createdAt: time })
const appeal = Schema.Struct({ appealNo: integer(1), caseNo: integer(1), userId: id, text: text(2000, true), createdAt: time, status: Schema.Literals(["open", "accepted", "rejected", "withdrawn"]), decisionReason: Schema.optionalKey(text(512, true)), decidedAt: Schema.optionalKey(time), erased: Schema.Boolean })
const page = { page: integer(1), totalPages: integer(1) }
const list = <A>(schema: Schema.Codec<A>) => Schema.mutable(Schema.Array(schema)).check(Schema.isMaxLength(10))
const managed = Schema.Union([
    Schema.Struct({ duplicate: Schema.Literal(true) }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("settings"), settings }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("case"), case: caseSchema, grant: Schema.optionalKey(grant) }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("rule"), rule }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("deleted"), name }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("watchlist"), entry }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("watchlist-removed"), userId: id }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("erased"), cases: integer(0), appeals: integer(0) }),
    Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("private-role"), roleId: Schema.NullOr(id) }),
])
const queried = Schema.Union([
    Schema.Struct({ type: Schema.Literal("settings"), settings, openAppeals: Schema.optionalKey(Schema.Number) }), Schema.Struct({ type: Schema.Literal("case"), case: caseSchema }),
    Schema.Struct({ type: Schema.Literal("cases"), cases: list(caseSchema), nextBeforeCaseNo: Schema.optionalKey(integer(1)) }), Schema.Struct({ type: Schema.Literal("rule"), rule }),
    Schema.Struct({ type: Schema.Literal("rules"), rules: list(rule), ...page }), Schema.Struct({ type: Schema.Literal("watchlist"), entries: list(entry), ...page }),
    Schema.Struct({ type: Schema.Literal("watchlist-entry"), entry }),
    Schema.Struct({ type: Schema.Literal("recoveries"), recoveries: list(recovery), ...page }),
    Schema.Struct({ type: Schema.Literal("recovery"), recovery }),
])
const evaluated = Schema.Struct({ duplicate: Schema.Boolean, blocked: Schema.Boolean, case: Schema.optionalKey(caseSchema), grant: Schema.optionalKey(grant) })
const joined = Schema.Struct({ duplicate: Schema.Boolean, settings, case: Schema.optionalKey(caseSchema), grant: Schema.optionalKey(grant) })
const acknowledged = Schema.Struct({ recorded: Schema.Boolean })
const notice = Schema.Struct({ noticeId: key, caseNo: integer(1), targetId: id, reason: text(512) })
const completed = Schema.Struct({ recorded: Schema.Boolean, log: Schema.optionalKey(log), notice: Schema.optionalKey(notice) })
const observed = Schema.Struct({ settings, uncertainActions: integer(0), uncertainLogs: integer(0) })
const reconciled = Schema.Struct({ recorded: Schema.Boolean, case: caseSchema })
const gated = Schema.Struct({ allowed: Schema.Boolean, defcon: Schema.Literals([1, 2, 3]), messageProtectionEnabled: Schema.Boolean, joinProtectionEnabled: Schema.Boolean, botMessageProtectionEnabled: Schema.Boolean })
const appealCase = Schema.Struct({ caseNo: integer(1), action, createdAt: time, outcome: Schema.Literals(["pending", "succeeded", "failed", "uncertain"]), reason: text(512, true) })
const memberAppeal = Schema.Union([Schema.Struct({ duplicate: Schema.Literal(true) }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("appeal"), appeal }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("appeals"), appeals: list(appeal), ...page }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("cases"), cases: list(appealCase), nextBeforeCaseNo: Schema.optionalKey(integer(1)) })])
const staffAppeal = Schema.Union([Schema.Struct({ duplicate: Schema.Literal(true) }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("appeal"), appeal }), Schema.Struct({ duplicate: Schema.Literal(false), type: Schema.Literal("appeals"), appeals: list(appeal), ...page })])

export class ModerationStoreError extends Data.TaggedError("ModerationStoreError")<{ readonly operation: string, readonly status: number | null, readonly code?: string }> {}
export interface ModerationStore {
    manage(input: C.ModerationManageRequest): Effect.Effect<C.ModerationManageResult, ModerationStoreError>
    query(input: C.ModerationQueryRequest): Effect.Effect<C.ModerationQueryResult, ModerationStoreError>
    evaluate(input: C.ModerationEvaluateRequest): Effect.Effect<C.ModerationEvaluateResult, ModerationStoreError>
    join(input: C.ModerationJoinRequest): Effect.Effect<C.ModerationJoinResult, ModerationStoreError>
    dispatch(input: C.ModerationDispatchRequest): Effect.Effect<{ recorded: boolean }, ModerationStoreError>
    outcome(input: C.ModerationOutcomeRequest): Effect.Effect<C.ModerationOutcomeResult, ModerationStoreError>
    logOutcome(input: C.ModerationLogOutcomeRequest): Effect.Effect<{ recorded: boolean }, ModerationStoreError>
    noticeOutcome(input: C.ModerationNoticeOutcomeRequest): Effect.Effect<{ recorded: boolean }, ModerationStoreError>
    reconcile(input: C.ModerationReconcileRequest): Effect.Effect<C.ModerationReconcileResult, ModerationStoreError>
    observe(input: C.ModerationObserveRequest): Effect.Effect<C.ModerationObserveResult, ModerationStoreError>
    gate(input: C.ModerationGateRequest): Effect.Effect<C.ModerationGateResult, ModerationStoreError>
    memberAppeal(input: C.AppealMemberRequest): Effect.Effect<C.AppealMemberResult, ModerationStoreError>
    staffAppeal(input: C.AppealStaffRequest): Effect.Effect<C.AppealStaffResult, ModerationStoreError>
}

// A grant is accepted only together with its own case and the source that requested it
function boundGrant(result: { case?: C.ModerationCase, grant?: C.ModerationActionGrant, duplicate?: boolean }, sourceId?: string) {
    const value = result.grant
    if (!value) return true
    const record = result.case
    return !result.duplicate && !!record && record.actionId === value.actionId && record.caseNo === value.caseNo
        && record.sourceId === value.sourceId && (!sourceId || value.sourceId === sourceId)
        && record.action === value.action && record.targetId === value.targetId && record.channelId === value.channelId
}

function equalIds(actual: readonly string[], expected: readonly string[]) {
    return actual.length === expected.length && actual.every((value) => expected.includes(value))
}

export function createModerationStore(config: BackendConfig): ModerationStore {
    const post = createBackendRequest(config)
    function request<A>(path: string, body: unknown, schema: Schema.Codec<A>, matches: (result: A) => boolean = () => true) {
        return post(path, body).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" })),
            Effect.filterOrFail(matches, () => new ModerationStoreError({ operation: path, status: null })),
            Effect.mapError((error) => new ModerationStoreError({ operation: path, status: "status" in error && typeof error.status === "number" ? error.status : null, ...("code" in error && error.code ? { code: error.code } : {}) })),
        )
    }
    return {
        manage: (input) => request("/moderation/manage", input, managed, (result) => {
            if (result.duplicate) return true
            const op = input.operation
            // The grant must be the one this request created: same source, action, target, channel, messages and recovery
            if (op.type === "action") return result.type === "case" && boundGrant(result, input.messageId) && result.case.action === op.action.type
                && result.case.targetId === op.action.targetId && result.case.channelId === op.action.channelId
                && result.case.linkedCaseNo === op.action.linkedCaseNo
                && (!result.grant || (equalIds(result.grant.messageIds ?? [], op.action.messageIds ?? [])
                    && (!op.action.recoveryId || result.grant.recoveryId === op.action.recoveryId)))
            if (op.type === "settings") return result.type === "settings"
            if (op.type === "case-reason") return result.type === "case" && !result.grant && result.case.caseNo === op.caseNo
            if (op.type === "case-void") return result.type === "case" && result.case.action === "log" && result.case.linkedCaseNo === op.caseNo
                && result.case.caseNo !== op.caseNo && boundGrant(result, input.messageId)
            if (op.type === "rule-create" || op.type === "rule-update") {
                return result.type === "rule" && result.rule.name === (op.type === "rule-create" ? op.rule.name : op.name)
            }
            if (op.type === "rule-delete") return result.type === "deleted" && result.name === op.name
            if (op.type === "watchlist-add") return result.type === "watchlist" && result.entry.userId === op.userId
            if (op.type === "watchlist-remove") return result.type === "watchlist-removed" && result.userId === op.userId
            return result.type === "erased"
        }),
        query: (input) => request("/moderation/query", input, queried, (result) => {
            const op = input.operation
            if (op.type === "case-show" || op.type === "recovery-case") return result.type === "case" && result.case.caseNo === op.caseNo
            if (op.type === "rule-show") return result.type === "rule" && result.rule.name === op.name
            if (op.type === "settings") return result.type === "settings"
            if (op.type === "watchlist-show") return result.type === "watchlist-entry" && result.entry.userId === op.userId
            if (op.type === "recovery-target") return result.type === "recovery" && result.recovery.targetId === op.targetId && result.recovery.type === "timeout"
            if (op.type === "recovery-channel") return result.type === "recovery" && result.recovery.channelId === op.channelId && result.recovery.type === "lock"
            if (op.type === "case-list") return result.type === "cases" && (!op.userId || result.cases.every((record) => record.targetId === op.userId))
            const types = { "rule-list": "rules", "watchlist-list": "watchlist", "recovery-list": "recoveries" }
            return result.type === types[op.type]
        }),
        // Automation may only act on the evaluated author and message, and never bans or kicks. A webhook or bot message may only be
        // logged or deleted, with no member target
        evaluate: (input) => request("/moderation/evaluate", input, evaluated, (result) => boundGrant(result, input.messageId)
            && (!result.grant || ((input.author ? ["log", "delete"] : ["log", "warn", "delete", "timeout", "quarantine"]).includes(result.grant.action)
                && result.grant.targetId === (input.author ? undefined : input.userId) && (result.grant.channelId === undefined || result.grant.channelId === input.channelId)
                && (result.grant.action !== "delete" || equalIds(result.grant.messageIds ?? [], [input.messageId]))))),
        join: (input) => request("/moderation/join", input, joined, (result) => boundGrant(result, `join:${input.userId}:${input.joinedAt}`)
            && (!result.grant || (["log", "quarantine"].includes(result.grant.action) && result.grant.targetId === input.userId && result.grant.channelId === undefined))),
        dispatch: (input) => request("/moderation/outcome", input, acknowledged),
        outcome: (input) => request("/moderation/outcome", input, completed, (result) =>
            (!result.log || (result.log.logId === input.actionId && result.log.caseNo === input.caseNo))
            && (!result.notice || (result.notice.noticeId === input.actionId && result.notice.caseNo === input.caseNo))),
        logOutcome: (input) => request("/moderation/log-outcome", input, acknowledged),
        noticeOutcome: (input) => request("/moderation/notice-outcome", input, acknowledged),
        reconcile: (input) => request("/moderation/reconcile", input, reconciled, (result) => result.case.actionId === input.actionId),
        observe: (input) => request("/moderation/observe", input, observed),
        gate: (input) => request("/moderation/gate", input, gated),
        // Private appeal results must belong to the requester and the requested appeal or case
        memberAppeal: (input) => request("/appeals/member", input, memberAppeal, (result) => {
            const op = input.operation
            if (result.duplicate) return true
            if (result.type === "appeal") return result.appeal.userId === input.requesterId
                && (op.type === "submit" ? result.appeal.caseNo === op.caseNo : (op.type === "show" || op.type === "withdraw") && result.appeal.appealNo === op.appealNo)
            if (result.type === "cases") return op.type === "cases"
            return op.type === "list" && result.appeals.every((value) => value.userId === input.requesterId)
        }),
        staffAppeal: (input) => request("/appeals/staff", input, staffAppeal, (result) => {
            const op = input.operation
            if (result.duplicate) return true
            return result.type === "appeal" ? op.type !== "list" && result.appeal.appealNo === op.appealNo : op.type === "list"
        }),
    }
}

export function moderationErrorMessage(error: ModerationStoreError) {
    switch (error.status) {
        case 400: return "Some values in the command are not valid. Check them and try again"
        case 403: return "Your current permissions or DEFCON mode do not allow this operation"
        case 404: return "NeonFlux could not find that case, appeal, rule or entry. Check the number or name"
        case 409: return "That already exists or changed in the meantime. Look at it again before you retry"
        case 429: return "A limit was reached. Remove an entry you no longer need, or wait a minute and try again"
        default: return "NeonFlux couldn't confirm the operation. Check its status before attempting it again"
    }
}
