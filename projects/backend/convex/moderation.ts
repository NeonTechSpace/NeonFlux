import { changeConfiguration } from "./configurationChange.ts"
import { v } from "convex/values"
import { Schema } from "effect"
import { Millis } from "@neonflux/contracts/common"
import {
    ModerationDispatchRequest,
    ModerationGateRequest,
    ModerationLogOutcomeRequest,
    ModerationManageOperation,
    ModerationManageRequest,
    ModerationNoticeOutcomeRequest,
    ModerationObserveRequest,
    ModerationOutcomeRequest,
    ModerationQueryRequest,
    ModerationReconcileRequest,
    type AutomodRule,
    type ModerationGateResult,
    type ModerationLogOutcomeResult,
    type ModerationManageResult,
    type ModerationObserveResult,
    type ModerationOutcomeResult,
    type ModerationQueryResult,
    type ModerationReconcileResult,
    type ModerationSettings,
    type ModerationNoticeGrant,
    type StaffClass,
    type StaffLogGrant,
} from "@neonflux/contracts/moderation"
import { serviceMutation, serviceQuery } from "./serviceGuard.ts"
import type { MutationCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { internal } from "./_generated/api.js"
import {
    actor,
    administrator,
    anyStaff,
    authorize,
    BATCH,
    CORRECTION_BATCH,
    gateFor,
    DAY,
    lockMask,
    retentionUntil,
    SERVER_PATTERNS,
    rule,
    rulePatch,
    settingsPatch,
} from "./moderationDomain.ts"
import { ownedOverwriteEqual, reserveAction } from "./moderationActions.ts"
import {
    caseByNo,
    config,
    correctionPage,
    deleteCorrections,
    paged,
    publicCase,
    publicRecovery,
    publicRule,
    readSettings,
    receipt,
    retireRecovery,
    state,
} from "./moderationStore.ts"
import { decode, fail, requireReadMember, requireServer, fresh, name, source } from "./validation.ts"
import { protectedStaffRoles } from "./rolesStore.ts"
import { metadataCoreReceipt, metadataSettingsEvent } from "./metadataLogsStore.ts"
import { metadataChangedFields } from "./metadataLogsDomain.ts"
import { ringWork } from "./workSignal.ts"

function criticalOperation(op: ModerationManageOperation) {
    if (op.type === "action") return ["release", "unlock", "untimeout", "unban"].includes(op.action.type)
    // Lowering DEFCON or switching protections off stays available in a lockdown
    const switches = [
        "manualModerationEnabled",
        "automodEnabled",
        "automodBotMessagesEnabled",
        "securityEnabled",
        "joinEnabled",
        "honeypotEnabled",
        "watchlistEnabled",
        "appealsEnabled",
    ]
    if (op.type === "settings")
        return Object.entries(op.patch).every(
            ([key, value]) => key === "defcon" || (switches.includes(key) && value === false),
        )
    return false
}
function scopeFor(type: string): StaffClass {
    return type.startsWith("rule-")
        ? "automod"
        : type.startsWith("watchlist-") || type.startsWith("recovery-")
          ? "security"
          : type.startsWith("case-") || type === "erase"
            ? "cases"
            : "moderation"
}
// Case and watchlist reads answer in a DM the bot verified, or in a server channel it read fresh that only Administrators and
// staff roles of this read can view, so the answer never reaches a member the backend would refuse it
function privateRead(
    input: { privateChannelVerified?: boolean; staffChannelRoleIds?: readonly string[] },
    settings: ModerationSettings,
    scope: StaffClass,
) {
    if (
        input.privateChannelVerified !== true &&
        !input.staffChannelRoleIds?.every((id) => settings.staffRoleIds[scope].includes(id))
    )
        fail(403, "Private or staff channel required")
}
/** The member's notice of a warning, timeout, kick or ban, marked pending so it is sent at most once. Bot accounts get none */
async function memberNotice(
    ctx: MutationCtx,
    row: Doc<"moderationCases">,
    timeoutUntil?: string | null,
): Promise<ModerationNoticeGrant | undefined> {
    if (!row.targetId || row.targetBot || !["warn", "timeout", "kick", "ban"].includes(row.action)) return undefined
    await ctx.db.patch(row._id, { notificationOutcome: "pending" })
    const settings = config(await readSettings(ctx, row.serverId))
    return {
        noticeId: row._id,
        caseNo: row.caseNo,
        targetId: row.targetId,
        action: row.action as ModerationNoticeGrant["action"],
        reason: row.reason,
        ...(row.grant?.durationSeconds ? { durationSeconds: row.grant.durationSeconds } : {}),
        ...(timeoutUntil ? { timeoutUntil } : {}),
        appeals: settings.appealsEnabled,
    }
}
function recoveryScope(row: { origin: string; action: string }): StaffClass {
    return row.origin === "security" || ["lock", "unlock", "quarantine", "release"].includes(row.action)
        ? "security"
        : "moderation"
}

export const manage = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ModerationManageResult> => {
        const input = decode(ModerationManageRequest, request)
        const now = Date.now()
        const identity = source(input, now)
        const who = actor(input.actor)
        const op = input.operation
        const type = op.type
        const current = await state(ctx, identity.serverId)
        const settings = config(current)
        const critical = criticalOperation(op)
        if (type === "settings") {
            if (!administrator(who)) fail(403, "Administrator permission required")
            if (settings.defcon === 1 && !critical) fail(403, "DEFCON restriction")
        } else
            authorize(
                who,
                settings,
                op.type === "action" && ["quarantine", "release", "lock", "unlock"].includes(op.action.type)
                    ? "security"
                    : scopeFor(type),
                critical,
            )
        if ((type === "erase" || type === "private-role") && !who.isOwner) fail(403, "Owner permission required")
        const claim = await receipt(ctx, identity.serverId, `manual:${identity.messageId}`, now)
        if (op.type === "settings") await metadataCoreReceipt(ctx, identity, who.userId, op.patch, claim.duplicate)
        if (claim.duplicate) return { duplicate: true }
        if (
            type === "settings" ||
            type.startsWith("rule-") ||
            type === "watchlist-add" ||
            type === "watchlist-remove" ||
            type === "private-role"
        ) {
            const result = await changeConfiguration(
                ctx,
                identity.serverId,
                "moderation",
                {
                    kind: "chat",
                    createdAt: identity.createdAt,
                    actor: { userId: who.userId, source: "command" },
                    operation: op,
                },
                () => applyConfiguration(ctx, identity.serverId, op, now),
            )
            if (op.type === "settings" && !result.duplicate && result.type === "settings") {
                const tracked = metadataChangedFields.settings as readonly string[]
                const changed = Object.keys(op.patch).filter(
                    (key) =>
                        tracked.includes(key) &&
                        JSON.stringify(settings[key as keyof ModerationSettings]) !==
                            JSON.stringify(result.settings[key as keyof ModerationSettings]),
                )
                if (changed.length) await metadataSettingsEvent(ctx, identity, who.userId, "moderation", changed)
            }
            return result
        }
        if (op.type === "action") {
            const action = {
                ...op.action,
                ...(op.action.messageIds ? { messageIds: [...new Set(op.action.messageIds)] } : {}),
            }
            if (!settings.manualModerationEnabled && !critical && !["quarantine", "lock"].includes(action.type))
                fail(403, "Manual moderation is off. The server owner or an Administrator can turn it on", "REFUSED")
            if (action.linkedCaseNo) {
                const linked = await caseByNo(ctx, identity.serverId, action.linkedCaseNo)
                if (
                    (action.targetId && linked.targetId !== action.targetId) ||
                    (action.channelId && linked.channelId !== action.channelId)
                )
                    fail(409, "Linked case target mismatch")
            }
            const result = await reserveAction(ctx, {
                serverId: identity.serverId,
                sourceId: identity.messageId,
                settings,
                actor: who,
                input: action,
                context: op.context,
                origin: "manual",
                now,
            })
            return { duplicate: false, type: "case", ...result }
        }
        if (op.type === "case-reason" || op.type === "case-void") {
            const row = await caseByNo(ctx, identity.serverId, op.caseNo)
            if (row.erased) fail(409, "Case cannot be corrected")
            if (op.type === "case-void" && row.voided) fail(409, "Case already voided")
            if (op.type === "case-void" && row.action !== "warn")
                fail(409, "Only a warning can be voided. Case " + row.caseNo + " is not one", "REFUSED")
            const reason = op.type === "case-reason" ? op.reason : row.reason
            await ctx.db.insert("moderationCorrections", {
                caseId: row._id,
                actorId: who.userId,
                createdAt: now,
                previousReason: row.reason,
                reason,
                type: op.type === "case-reason" ? "reason" : "void",
                serverId: identity.serverId,
                caseNo: row.caseNo,
                ...(row.targetId ? { targetId: row.targetId } : {}),
            })
            await ctx.db.patch(row._id, {
                reason,
                voided: op.type === "case-void" ? true : row.voided,
                correctionCount: row.correctionCount + 1,
            })
            if (op.type === "case-void") {
                const result = await reserveAction(ctx, {
                    serverId: identity.serverId,
                    sourceId: identity.messageId,
                    settings,
                    actor: who,
                    input: {
                        type: "log",
                        ...(row.targetId ? { targetId: row.targetId } : {}),
                        reason: `Case ${row.caseNo} voided`,
                        linkedCaseNo: row.caseNo,
                    },
                    context: {
                        botActionAuthorized: true,
                        actorCanManageTarget: true,
                        botCanManageTarget: true,
                        targetProtected: false,
                        botId: who.userId,
                    },
                    origin: "manual",
                    now,
                })
                return { duplicate: false, type: "case", ...result }
            }
            return { duplicate: false, type: "case", case: publicCase((await ctx.db.get(row._id))!) }
        }
        if (op.type === "erase") {
            const row = await caseByNo(ctx, identity.serverId, op.caseNo)
            // The case reads as erased at once, and a case with many corrections finishes deleting them in the next runs
            if ((await deleteCorrections(ctx, row._id, CORRECTION_BATCH)).more)
                await ctx.scheduler.runAfter(0, internal.moderationRetention.eraseCorrections, { caseId: row._id })
            await ctx.db.patch(row._id, {
                reason: "[Erased by owner]",
                erased: true,
                correctionCount: 0,
                ...(row.grant ? { grant: { ...row.grant, reason: "[Erased by owner]" } } : {}),
            })
            const appeals = await ctx.db
                .query("moderationAppeals")
                .withIndex("by_case_user", (q) => q.eq("serverId", identity.serverId).eq("caseNo", row.caseNo))
                .take(21)
            for (const appeal of appeals)
                await ctx.db.patch(appeal._id, {
                    text: "[Erased by owner]",
                    decisionReason: "[Erased by owner]",
                    erased: true,
                })
            return { duplicate: false, type: "erased", cases: 1, appeals: appeals.length }
        }
        fail(400, "Invalid operation")
    },
})

export const query = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ModerationQueryResult> => {
        const input = decode(ModerationQueryRequest, request)
        const serverId = input.serverId
        const who = actor(input.actor)
        const op = input.operation
        const settings = config(await readSettings(ctx, serverId))
        const type = op.type
        if (op.type === "recovery-case") {
            const row = await caseByNo(ctx, serverId, op.caseNo)
            if (!row.recoveryId) fail(403, "Recovery case required")
            authorize(who, settings, recoveryScope(row), true)
            privateRead(input, settings, recoveryScope(row))
            return { type: "case", case: publicCase(row) }
        }
        // Any staff role may read the settings, since each area's status commands share this one read
        if (op.type === "settings") {
            if (!anyStaff(who, settings)) fail(403, "Staff permission required")
            if (settings.defcon === 1 && !administrator(who)) fail(403, "DEFCON restriction")
        } else authorize(who, settings, scopeFor(type), true)
        // !appeal status also counts the open appeals, which an index keeps apart from closed ones, exactly up to 1000
        if (op.type === "settings") {
            const open = op.appeals
                ? (
                      await ctx.db
                          .query("moderationAppeals")
                          .withIndex("by_server_status", (q) => q.eq("serverId", serverId).eq("status", "open"))
                          .take(1001)
                  ).length
                : undefined
            return {
                type: "settings",
                settings,
                ...(open !== undefined
                    ? { openAppeals: Math.min(open, 1000), ...(open > 1000 ? { moreOpenAppeals: true as const } : {}) }
                    : {}),
            }
        }
        if (type.startsWith("case-") || type.startsWith("watchlist-")) privateRead(input, settings, scopeFor(type))
        const page = "page" in op ? (op.page ?? 1) : 1
        if (op.type === "case-show") return { type: "case", case: publicCase(await caseByNo(ctx, serverId, op.caseNo)) }
        if (op.type === "case-history") {
            const row = await caseByNo(ctx, serverId, op.caseNo)
            return {
                type: "case-history",
                caseNo: row.caseNo,
                erased: row.erased,
                ...(await correctionPage(ctx, row, op.after, 10)),
            }
        }
        if (op.type === "case-list") {
            const before = op.beforeCaseNo ?? Number.MAX_SAFE_INTEGER,
                userId = op.userId
            const rows =
                userId === undefined
                    ? await ctx.db
                          .query("moderationCases")
                          .withIndex("by_server_case", (q) => q.eq("serverId", serverId).lt("caseNo", before))
                          .order("desc")
                          .take(11)
                    : await ctx.db
                          .query("moderationCases")
                          .withIndex("by_server_user", (q) =>
                              q.eq("serverId", serverId).eq("targetId", userId).lt("caseNo", before),
                          )
                          .order("desc")
                          .take(11)
            const selected = rows.slice(0, 10)
            return {
                type: "cases",
                cases: selected.map(publicCase),
                ...(rows.length > 10 ? { nextBeforeCaseNo: selected.at(-1)!.caseNo } : {}),
            }
        }
        if (op.type === "rule-show") {
            const ruleName = name(op.name),
                row = await ctx.db
                    .query("automodRules")
                    .withIndex("by_server_name", (q) => q.eq("serverId", serverId).eq("name", ruleName))
                    .unique()
            if (!row) fail(404, "Rule not found")
            return { type: "rule", rule: publicRule(row) }
        }
        if (op.type === "rule-list") {
            const result = paged(
                await ctx.db
                    .query("automodRules")
                    .withIndex("by_server_name", (q) => q.eq("serverId", serverId))
                    .take(101),
                page,
            )
            return { type: "rules", rules: result.rows.map(publicRule), page, totalPages: result.totalPages }
        }
        const entry = ({ userId, reason, createdAt }: { userId: string; reason: string; createdAt: number }) => ({
            userId,
            reason,
            createdAt,
        })
        // The watchlist and recovery lists continue after the last row shown, so a page reads only its own rows and the next one
        if (op.type === "watchlist-list") {
            const after = op.afterUserId
            const rows = await ctx.db
                .query("securityWatchlist")
                .withIndex("by_server_user", (q) =>
                    after === undefined ? q.eq("serverId", serverId) : q.eq("serverId", serverId).gt("userId", after),
                )
                .take(11)
            const selected = rows.slice(0, 10)
            return {
                type: "watchlist",
                entries: selected.map(entry),
                ...(rows.length > 10 ? { nextAfterUserId: selected.at(-1)!.userId } : {}),
            }
        }
        if (op.type === "watchlist-show") {
            const userId = op.userId,
                row = await ctx.db
                    .query("securityWatchlist")
                    .withIndex("by_server_user", (q) => q.eq("serverId", serverId).eq("userId", userId))
                    .unique()
            if (!row) fail(404, "Watchlist entry not found")
            return { type: "watchlist-entry", entry: entry(row) }
        }
        if (op.type === "recovery-list") {
            const after = op.after
            const rows = await ctx.db
                .query("securityRecoveries")
                .withIndex("by_server", (q) =>
                    after === undefined
                        ? q.eq("serverId", serverId)
                        : q.eq("serverId", serverId).gt("_creationTime", after),
                )
                .take(11)
            const selected = rows.slice(0, 10)
            return {
                type: "recoveries",
                recoveries: selected.map(publicRecovery),
                ...(rows.length > 10 ? { nextAfter: selected.at(-1)!._creationTime } : {}),
            }
        }
        const rows =
            op.type === "recovery-target"
                ? await ctx.db
                      .query("securityRecoveries")
                      .withIndex("by_server_target", (q) => q.eq("serverId", serverId).eq("targetId", op.targetId))
                      .take(1001)
                : await ctx.db
                      .query("securityRecoveries")
                      .withIndex("by_server_channel", (q) => q.eq("serverId", serverId).eq("channelId", op.channelId))
                      .take(1001)
        const row = rows
            .filter((r) => r.type === (type === "recovery-target" ? "timeout" : "lock"))
            .sort((a, b) => b.generation - a.generation)[0]
        if (!row)
            fail(
                404,
                op.type === "recovery-target"
                    ? "NeonFlux has no timeout of its own on that member to release. It releases only timeouts it applied"
                    : "NeonFlux has no lock of its own on that channel to undo. It unlocks only channels it locked",
                "REFUSED",
            )
        return { type: "recovery", recovery: publicRecovery(row) }
    },
})

async function boundCase(ctx: MutationCtx, input: { serverId: string; caseNo: number }, actionId: string) {
    requireServer(input.serverId)
    const id = ctx.db.normalizeId("moderationCases", actionId)
    const row = id ? await ctx.db.get(id) : null
    if (!row || row.serverId !== input.serverId || row.caseNo !== input.caseNo) fail(409, "Action changed")
    return row
}
// The same route records a dispatch claim and an outcome
const OutcomeRequest = Schema.Union([ModerationDispatchRequest, ModerationOutcomeRequest])
export const outcome = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ModerationOutcomeResult> => {
        const input = decode(OutcomeRequest, request)
        const row = await boundCase(ctx, input, input.actionId)
        // The bot claims the grant right before it dispatches the provider action. Only the first claim may dispatch
        // A kick or ban notice is claimed with the dispatch and sent before the action, while the member can still be reached
        if ("dispatch" in input) {
            if (row.outcome !== "pending" || row.dispatched) fail(409, "Action changed")
            await ctx.db.patch(row._id, { dispatched: true })
            const notice = row.action === "kick" || row.action === "ban" ? await memberNotice(ctx, row) : undefined
            return { recorded: false, ...(notice ? { notice } : {}) }
        }
        if (row.outcome !== "pending") {
            if (row.outcome !== input.outcome) fail(409, "Outcome already recorded")
            return { recorded: false }
        }
        const result: { recorded: boolean; log?: StaffLogGrant; notice?: ModerationNoticeGrant } = { recorded: true }
        await ctx.db.patch(row._id, { outcome: input.outcome })
        if (row.recoveryId) {
            const recovery = await ctx.db.get(row.recoveryId)
            if (recovery && recovery.generation === row.caseNo) {
                if (input.outcome === "succeeded") {
                    if (["release", "unlock"].includes(row.action)) await retireRecovery(ctx, recovery)
                    else if (recovery.type === "timeout") {
                        const actual = input.timeoutUntil
                        if (!actual) fail(400, "Timeout outcome required")
                        const owned = actual !== recovery.previousTimeoutUntil
                        if (owned)
                            await ctx.db.patch(recovery._id, {
                                expectedTimeoutUntil: actual,
                                knownDeadline: Date.parse(actual),
                                status: "active",
                            })
                        else await retireRecovery(ctx, recovery)
                        if (owned && row.targetId) {
                            const older = await ctx.db
                                .query("securityRecoveries")
                                .withIndex("by_server_target", (q) =>
                                    q.eq("serverId", row.serverId).eq("targetId", row.targetId),
                                )
                                .take(1001)
                            for (const old of older)
                                if (old.type === "timeout" && old.generation < recovery.generation)
                                    await retireRecovery(ctx, old)
                        }
                    } else {
                        const banExpiry = input.banExpiresAt
                        await ctx.db.patch(recovery._id, {
                            status: "active",
                            ...(recovery.type === "ban" && banExpiry ? { knownDeadline: Date.parse(banExpiry) } : {}),
                        })
                    }
                } else if (
                    input.outcome === "failed" &&
                    ["release", "unlock"].includes(row.action) &&
                    recovery.reversalState
                ) {
                    await ctx.db.patch(recovery._id, {
                        status: recovery.reversalState.status,
                        reversalState: undefined,
                    })
                } else if (input.outcome === "failed") await retireRecovery(ctx, recovery)
                else await ctx.db.patch(recovery._id, { status: "uncertain" })
            }
        }
        if (input.outcome === "succeeded" && ["unban", "untimeout"].includes(row.action) && row.targetId) {
            const recoveries = await ctx.db
                .query("securityRecoveries")
                .withIndex("by_server_target", (q) => q.eq("serverId", row.serverId).eq("targetId", row.targetId))
                .take(1001)
            for (const recovery of recoveries)
                if (recovery.generation < row.caseNo && recovery.type === (row.action === "unban" ? "ban" : "timeout"))
                    await retireRecovery(ctx, recovery)
        }
        if (row.logChannelId) {
            await ctx.db.patch(row._id, { logOutcome: "pending" })
            result.log = {
                logId: row._id,
                channelId: row.logChannelId,
                caseNo: row.caseNo,
                action: row.action as NonNullable<ModerationOutcomeResult["log"]>["action"],
                outcome: input.outcome as "succeeded" | "failed" | "uncertain",
                reason: row.reason,
                ...(row.targetId ? { targetId: row.targetId } : {}),
                ...(row.grant?.durationSeconds ? { durationSeconds: row.grant.durationSeconds } : {}),
            }
        }
        // A warning or timeout notice follows the action, since the member stays in the server
        if ((row.action === "warn" || row.action === "timeout") && input.outcome === "succeeded") {
            const notice = await memberNotice(ctx, row, input.timeoutUntil)
            if (notice) result.notice = notice
        }
        return result
    },
})
function deliveryMutation(kind: "log" | "notice") {
    return serviceMutation({
        args: { request: v.any() },
        handler: async (ctx, { request }): Promise<ModerationLogOutcomeResult> => {
            const input =
                kind === "log"
                    ? decode(ModerationLogOutcomeRequest, request)
                    : decode(ModerationNoticeOutcomeRequest, request)
            const row = await boundCase(ctx, input, "logId" in input ? input.logId : input.noticeId)
            const field = kind === "log" ? "logOutcome" : "notificationOutcome"
            if (row[field] !== "pending") {
                if (row[field] !== input.outcome) fail(409, "Outcome already recorded")
                return { recorded: false }
            }
            await ctx.db.patch(row._id, { [field]: input.outcome })
            return { recorded: true }
        },
    })
}
export const logOutcome = deliveryMutation("log")
export const noticeOutcome = deliveryMutation("notice")

export const reconcile = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ModerationReconcileResult> => {
        const input = decode(ModerationReconcileRequest, request)
        const now = Date.now()
        const identity = source(input, now)
        const who = actor(input.actor)
        const settings = config(await state(ctx, identity.serverId))
        const id = ctx.db.normalizeId("moderationCases", input.actionId)
        const row = id ? await ctx.db.get(id) : null
        if (!row || row.serverId !== identity.serverId) fail(404, "Case not found")
        const scope = row.recoveryId ? recoveryScope(row) : "cases"
        authorize(who, settings, scope, true)
        privateRead(input, settings, scope)
        // The read server and member are evidence for this check only and are not kept
        const { originServerId: _origin, memberUserId: _member, ...observation } = input.observation
        const observedAt = observation.observedAt
        if (observedAt < row.createdAt) fail(400, "Invalid request")
        fresh(observedAt, now)
        if (observation.memberPresent !== undefined) {
            if (!row.targetId) fail(400, "Member observation requires a target")
            requireReadMember(input.observation, row.targetId)
        }
        const claim = await receipt(ctx, identity.serverId, `manual:${identity.messageId}`, now)
        if (claim.duplicate || (row.observation?.observedAt ?? -1) >= observedAt)
            return { recorded: false, case: publicCase(row) }
        await ctx.db.patch(row._id, { observation })
        if (row.recoveryId) {
            const recovery = await ctx.db.get(row.recoveryId)
            if (recovery && recovery.generation === row.caseNo && recovery.status !== "pending") {
                const timeoutEnded =
                    recovery.type === "timeout" &&
                    Object.hasOwn(observation, "timeoutUntil") &&
                    (observation.timeoutUntil === null ||
                        observation.timeoutUntil !== recovery.expectedTimeoutUntil ||
                        Date.parse(observation.timeoutUntil!) <= now)
                const ended =
                    (recovery.type === "ban" && observation.banned === false) ||
                    timeoutEnded ||
                    (recovery.type === "lock" &&
                        observation.overwrite &&
                        recovery.expectedOverwrite &&
                        !ownedOverwriteEqual(observation.overwrite, recovery.expectedOverwrite, lockMask(recovery)))
                if (ended) await retireRecovery(ctx, recovery)
                else if (recovery.type === "ban" && observation.banExpiresAt)
                    await ctx.db.patch(recovery._id, { knownDeadline: Date.parse(observation.banExpiresAt) })
            }
        }
        return { recorded: true, case: publicCase((await ctx.db.get(row._id))!) }
    },
})

// The bot sends the server. A continuation also carries the startup cutoff
const ObserveRequest = Schema.Struct({ ...ModerationObserveRequest.fields, cutoff: Schema.optionalKey(Millis) })
export const observe = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ModerationObserveResult> => {
        // Runs once when the bot starts: anything still pending was interrupted by the previous process
        // Continuations keep the startup cutoff so actions reserved by the current process stay pending
        const input = decode(ObserveRequest, request)
        const serverId = input.serverId
        const now = Date.now(),
            cutoff = input.cutoff ?? now
        if (cutoff > now) fail(400, "Invalid request")
        const rows = await ctx.db
            .query("moderationCases")
            .withIndex("by_outcome", (q) =>
                q.eq("serverId", serverId).eq("outcome", "pending").lte("createdAt", cutoff),
            )
            .take(BATCH)
        for (const row of rows) {
            await ctx.db.patch(row._id, { outcome: "uncertain" })
            const recovery = row.recoveryId ? await ctx.db.get(row.recoveryId) : null
            if (recovery?.generation === row.caseNo) await ctx.db.patch(recovery._id, { status: "uncertain" })
        }
        const logs = await ctx.db
            .query("moderationCases")
            .withIndex("by_log_outcome", (q) =>
                q.eq("serverId", serverId).eq("logOutcome", "pending").lte("createdAt", cutoff),
            )
            .take(BATCH)
        for (const row of logs) await ctx.db.patch(row._id, { logOutcome: "uncertain" })
        const notices = await ctx.db
            .query("moderationCases")
            .withIndex("by_notice_outcome", (q) =>
                q.eq("serverId", serverId).eq("notificationOutcome", "pending").lte("createdAt", cutoff),
            )
            .take(BATCH)
        for (const row of notices) await ctx.db.patch(row._id, { notificationOutcome: "uncertain" })
        if (rows.length === BATCH || logs.length === BATCH || notices.length === BATCH)
            await ctx.scheduler.runAfter(0, internal.moderation.observe, { request: { serverId, cutoff } })
        return { settings: config(await state(ctx, serverId)) }
    },
})
export const gate = serviceQuery({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ModerationGateResult> => {
        const input = decode(ModerationGateRequest, request)
        return gateFor(config(await readSettings(ctx, input.serverId)), input.actor, input.command)
    },
})

export async function cleanupModeration(ctx: MutationCtx, now: number) {
    let removed = 0
    let continuation = false
    // A row is due under the period it was stamped with. The server's current setting decides, so a longer period or keeping
    // until erased moves the row's expiry instead, also for rows stamped before the setting changed
    const retention = new Map<string, ModerationSettings>()
    const keptUntil = async (serverId: string, from: number) => {
        let settings = retention.get(serverId)
        if (!settings) {
            settings = config(await readSettings(ctx, serverId))
            retention.set(serverId, settings)
        }
        return retentionUntil(settings, from)
    }
    // Readers already ignore these through recoveryElapsed, so deleting them can wait for the next run
    const elapsed = await ctx.db
        .query("securityRecoveries")
        .withIndex("by_status_deadline", (q) =>
            q.eq("status", "active").gt("knownDeadline", 0).lte("knownDeadline", now),
        )
        .take(BATCH)
    for (const recovery of elapsed) await retireRecovery(ctx, recovery)
    continuation ||= elapsed.length === BATCH
    const receipts = await ctx.db
        .query("moderationReceipts")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(BATCH)
    for (const row of receipts) {
        await ctx.db.delete(row._id)
        removed++
    }
    continuation ||= receipts.length === BATCH
    const windows = await ctx.db
        .query("automodWindows")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(BATCH)
    for (const row of windows) {
        await ctx.db.delete(row._id)
        removed++
    }
    continuation ||= windows.length === BATCH
    const appeals = await ctx.db
        .query("moderationAppeals")
        .withIndex("by_expiry", (q) => q.gt("expiresAt", 0).lte("expiresAt", now))
        .take(BATCH)
    for (const row of appeals) {
        const until = await keptUntil(row.serverId, row.decidedAt ?? row.createdAt)
        if (until > now) {
            await ctx.db.patch(row._id, { expiresAt: until })
            continue
        }
        await ctx.db.delete(row._id)
        removed++
    }
    continuation ||= appeals.length === BATCH
    const cases = await ctx.db
        .query("moderationCases")
        .withIndex("by_expiry", (q) => q.lte("expiresAt", now))
        .take(BATCH)
    let correctionBudget = CORRECTION_BATCH
    for (const row of cases) {
        const until = await keptUntil(row.serverId, row.createdAt)
        if (until > now) {
            await ctx.db.patch(row._id, { expiresAt: until })
            continue
        }
        // A live recovery snapshot or appeal keeps its case readable
        if (row.recoveryId && (await ctx.db.get(row.recoveryId))) {
            await ctx.db.patch(row._id, { expiresAt: now + DAY })
            continue
        }
        const appeals = await ctx.db
            .query("moderationAppeals")
            .withIndex("by_case_user", (q) => q.eq("serverId", row.serverId).eq("caseNo", row.caseNo))
            .take(21)
        if (appeals.length) {
            await ctx.db.patch(row._id, {
                expiresAt: Math.max(now + DAY, ...appeals.map((a) => a.expiresAt ?? now + DAY)),
            })
            continue
        }
        // A case with more corrections than this run may still delete stays due for the next run
        const corrections = await deleteCorrections(ctx, row._id, correctionBudget)
        correctionBudget -= corrections.deleted
        if (corrections.more) {
            continuation = true
            break
        }
        await ctx.db.delete(row._id)
        removed++
        const settings = await readSettings(ctx, row.serverId)
        if (settings) await ctx.db.patch(settings._id, { casesRemoved: (settings.casesRemoved ?? 0) + 1 })
    }
    continuation ||= cases.length === BATCH
    return { removed, more: continuation }
}

// Dashboard jobs apply their stored operation
export async function applyModerationConfiguration(
    ctx: MutationCtx,
    serverId: string,
    op: Record<string, unknown>,
    now: number,
): Promise<ModerationManageResult> {
    return applyConfiguration(ctx, serverId, decode(ModerationManageOperation, op), now)
}
async function applyConfiguration(
    ctx: MutationCtx,
    serverId: string,
    op: ModerationManageOperation,
    now: number,
): Promise<ModerationManageResult> {
    const identity = { serverId },
        current = await state(ctx, serverId),
        settings = config(current)
    if (op.type === "settings") {
        const next = settingsPatch(settings, op.patch)
        const staffRoleIds = op.patch.staffRoleIds
        if (staffRoleIds !== undefined) {
            await protectedStaffRoles(ctx, identity.serverId, [...new Set(Object.values(staffRoleIds).flat())])
        }
        await ctx.db.patch(current._id, { config: next })
        // Stored cases and closed appeals take the new period in scheduled pages, so a large history never fails the change
        if ((settings.caseRetentionDays ?? null) !== (next.caseRetentionDays ?? null))
            await ctx.scheduler.runAfter(0, internal.moderationRetention.restamp, {
                serverId,
                table: "cases",
                after: 0,
            })
        // Leaving DEFCON 1 makes the log posts it held due again, and returning to DEFCON 3 the scheduled and milestone posts and
        // the level rewards. The wakes run as scheduled batches, so a large backlog can never make the DEFCON change itself fail
        if (settings.defcon === 1 && next.defcon !== 1)
            await ctx.scheduler.runAfter(0, internal.metadataLogsWork.wake, { serverId, afterRecordNo: 0 })
        if (settings.defcon !== 3 && next.defcon === 3) {
            // Suggestion cards and event reminders stay due while held, so the bot only needs to hear that they may go out again
            await ringWork(ctx)
            await ctx.scheduler.runAfter(0, internal.schedulesDelivery.wake, { serverId, throughAt: now, cursor: null })
            await ctx.scheduler.runAfter(0, internal.milestonesDelivery.wake, {
                serverId,
                throughAt: now,
                cursor: null,
            })
            await ctx.scheduler.runAfter(0, internal.levelingWork.wake, { serverId })
        }
        return { duplicate: false, type: "settings", settings: next }
    }
    if (op.type === "rule-create" || op.type === "rule-update" || op.type === "rule-delete") {
        const ruleName = op.type === "rule-create" ? rule(op.rule).name : name(op.name)
        const existing = await ctx.db
            .query("automodRules")
            .withIndex("by_server_name", (q) => q.eq("serverId", identity.serverId).eq("name", ruleName))
            .unique()
        // Every message reads all of a server's rules, so their patterns together stay within today's worst case of 100 rules of 20
        const capacity = async (data: AutomodRule) => {
            const others = (
                await ctx.db
                    .query("automodRules")
                    .withIndex("by_server_name", (q) => q.eq("serverId", identity.serverId))
                    .take(101)
            ).filter((row) => row.name !== data.name)
            if (op.type === "rule-create" && others.length >= 100) fail(429, "Rule capacity reached")
            const total = others.reduce((sum, row) => sum + row.rule.patterns.length, data.patterns.length)
            if (total > SERVER_PATTERNS)
                fail(429, `A server's automod rules hold at most ${SERVER_PATTERNS} patterns together`, "REFUSED")
        }
        if (op.type === "rule-create") {
            if (existing) fail(409, "Rule already exists")
            const data = rule(op.rule)
            await capacity(data)
            await ctx.db.insert("automodRules", { serverId: identity.serverId, name: data.name, rule: data })
            return { duplicate: false, type: "rule", rule: data }
        }
        if (!existing) fail(404, "Rule not found")
        if (op.type === "rule-delete") {
            await ctx.db.delete(existing._id)
            return { duplicate: false, type: "deleted", name: ruleName }
        }
        const data = rulePatch(existing.rule, op.patch)
        if (data.patterns.length > existing.rule.patterns.length) await capacity(data)
        await ctx.db.patch(existing._id, { rule: data })
        return { duplicate: false, type: "rule", rule: data }
    }
    if (op.type === "watchlist-add" || op.type === "watchlist-remove") {
        const userId = op.userId
        const old = await ctx.db
            .query("securityWatchlist")
            .withIndex("by_server_user", (q) => q.eq("serverId", identity.serverId).eq("userId", userId))
            .unique()
        if (op.type === "watchlist-remove") {
            if (!old) fail(404, "Watchlist entry not found")
            await ctx.db.delete(old._id)
            return { duplicate: false, type: "watchlist-removed", userId }
        }
        const entry = { userId, reason: op.reason, createdAt: old?.createdAt ?? now }
        if (old) await ctx.db.patch(old._id, entry)
        else await ctx.db.insert("securityWatchlist", { serverId: identity.serverId, ...entry })
        return { duplicate: false, type: "watchlist", entry }
    }
    if (op.type === "private-role") {
        // The everyone role would open private cases to every member
        const roleId = op.roleId
        if (roleId === serverId) fail(400, "Choose a role other than everyone")
        await ctx.db.patch(current._id, { privateDataRoleId: roleId ?? undefined })
        return { duplicate: false, type: "private-role", roleId }
    }
    fail(400, "Invalid moderation configuration")
}
