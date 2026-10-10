import { changeConfiguration } from "./configurationChange.ts"
import { v } from "convex/values"
import { Schema } from "effect"
import { Millis } from "@neonflux/contracts/common"
import { ModerationDispatchRequest, ModerationGateRequest, ModerationLogOutcomeRequest, ModerationManageOperation, ModerationManageRequest, ModerationNoticeOutcomeRequest, ModerationObserveRequest,
    ModerationOutcomeRequest, ModerationQueryRequest, ModerationReconcileRequest, type ModerationGateResult, type ModerationLogOutcomeResult, type ModerationManageResult, type ModerationObserveResult,
    type ModerationOutcomeResult, type ModerationQueryResult, type ModerationReconcileResult, type ModerationSettings, type StaffClass, type StaffLogGrant, type WarningNoticeGrant } from "@neonflux/contracts/moderation"
import { internalMutation } from "./_generated/server.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import type { MutationCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import { actor, administrator, authorize, BATCH, DAY, lockMask, rule, rulePatch, settingsPatch } from "./moderationDomain.ts"
import { ownedOverwriteEqual, reserveAction } from "./moderationActions.ts"
import { caseByNo, config, paged, publicCase, publicRecovery, publicRule, readSettings, receipt, retireRecovery, state } from "./moderationStore.ts"
import { decode, fail, requireReadMember, requireServer, fresh, name, source } from "./validation.ts"
import { protectedStaffRoles } from "./rolesStore.ts"
import { metadataCoreReceipt, metadataSettingsEvent } from "./metadataLogsStore.ts"
import { metadataChangedFields } from "./metadataLogsDomain.ts"
import { retentionPass } from "./retentionStore.ts"

function criticalOperation(op: ModerationManageOperation) {
    if (op.type === "action") return ["release", "unlock", "untimeout", "unban"].includes(op.action.type)
    // Lowering DEFCON or switching protections off stays available in a lockdown
    const switches = ["manualModerationEnabled", "automodEnabled", "automodBotMessagesEnabled", "securityEnabled", "joinEnabled", "honeypotEnabled", "watchlistEnabled"]
    if (op.type === "settings") return Object.entries(op.patch).every(([key, value]) => key === "defcon" || switches.includes(key) && value === false)
    return false
}
function scopeFor(type: string): StaffClass {
    return type.startsWith("rule-") ? "automod" : type.startsWith("watchlist-") || type.startsWith("recovery-") ? "security" : type.startsWith("case-") || type === "erase" ? "cases" : "moderation"
}
function privateRead(input: { privateChannelVerified?: boolean }) { if (input.privateChannelVerified !== true) fail(403, "Private channel required") }
function recoveryScope(row: { origin: string, action: string }): StaffClass { return row.origin === "security" || ["lock", "unlock", "quarantine", "release"].includes(row.action) ? "security" : "moderation" }

export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationManageResult> => {
    const input = decode(ModerationManageRequest, request); const now = Date.now(); const identity = source(input, now); const who = actor(input.actor); const op = input.operation
    const type = op.type; const current = await state(ctx, identity.serverId); const settings = config(current); const critical = criticalOperation(op)
    if (type === "settings") { if (!administrator(who)) fail(403, "Administrator permission required"); if (settings.defcon === 1 && !critical) fail(403, "DEFCON restriction") }
    else authorize(who, settings, op.type === "action" && ["quarantine", "release", "lock", "unlock"].includes(op.action.type) ? "security" : scopeFor(type), critical)
    if ((type === "erase" || type === "private-role") && !who.isOwner) fail(403, "Owner permission required")
    const claim = await receipt(ctx, identity.serverId, `manual:${identity.messageId}`, now)
    if (op.type === "settings") await metadataCoreReceipt(ctx, identity, who.userId, op.patch, claim.duplicate)
    if (claim.duplicate) return { duplicate: true }
    if (type === "settings" || type.startsWith("rule-") || type === "watchlist-add" || type === "watchlist-remove" || type === "private-role") {
        const result = await changeConfiguration(ctx, identity.serverId, "moderation", { kind: "chat", createdAt: identity.createdAt, actor: { userId: who.userId, source: "command" }, operation: op },
            () => applyConfiguration(ctx, identity.serverId, op, now))
        if (op.type === "settings" && !result.duplicate && result.type === "settings") {
            const tracked = metadataChangedFields.settings as readonly string[]
            const changed = Object.keys(op.patch).filter(key => tracked.includes(key)
                && JSON.stringify(settings[key as keyof ModerationSettings]) !== JSON.stringify(result.settings[key as keyof ModerationSettings]))
            if (changed.length) await metadataSettingsEvent(ctx, identity, who.userId, "moderation", changed)
        }
        return result
    }
    if (op.type === "action") {
        const action = { ...op.action, ...(op.action.messageIds ? { messageIds: [...new Set(op.action.messageIds)] } : {}) }
        if (!settings.manualModerationEnabled && !critical && !["quarantine", "lock"].includes(action.type)) fail(403, "Manual moderation disabled")
        if (action.linkedCaseNo) {
            const linked = await caseByNo(ctx, identity.serverId, action.linkedCaseNo)
            if (action.targetId && linked.targetId !== action.targetId || action.channelId && linked.channelId !== action.channelId) fail(409, "Linked case target mismatch")
        }
        const result = await reserveAction(ctx, { serverId: identity.serverId, sourceId: identity.messageId, settings, actor: who, input: action, context: op.context, origin: "manual", now })
        return { duplicate: false, type: "case", ...result }
    }
    if (op.type === "case-reason" || op.type === "case-void") {
        const row = await caseByNo(ctx, identity.serverId, op.caseNo)
        if (row.erased || row.correctionCount >= 20) fail(409, "Case cannot be corrected")
        if (op.type === "case-void" && row.voided) fail(409, "Case already voided")
        const reason = op.type === "case-reason" ? op.reason : row.reason
        await ctx.db.insert("moderationCorrections", { caseId: row._id, actorId: who.userId, createdAt: now, previousReason: row.reason, reason, type: op.type === "case-reason" ? "reason" : "void" })
        await ctx.db.patch(row._id, { reason, voided: op.type === "case-void" ? true : row.voided, correctionCount: row.correctionCount + 1 })
        if (op.type === "case-void") {
            const result = await reserveAction(ctx, { serverId: identity.serverId, sourceId: identity.messageId, settings, actor: who,
                input: { type: "log", ...(row.targetId ? { targetId: row.targetId } : {}), reason: `Case ${row.caseNo} voided`, linkedCaseNo: row.caseNo },
                context: { botActionAuthorized: true, actorCanManageTarget: true, botCanManageTarget: true, targetProtected: false, botId: who.userId },
                origin: "manual", now })
            return { duplicate: false, type: "case", ...result }
        }
        return { duplicate: false, type: "case", case: await publicCase(ctx, (await ctx.db.get(row._id))!) }
    }
    if (op.type === "erase") {
        const row = await caseByNo(ctx, identity.serverId, op.caseNo)
        const corrections = await ctx.db.query("moderationCorrections").withIndex("by_case", q => q.eq("caseId", row._id)).take(21)
        for (const correction of corrections) await ctx.db.delete(correction._id)
        await ctx.db.patch(row._id, { reason: "[Erased by owner]", erased: true, correctionCount: 0, ...(row.grant ? { grant: { ...row.grant, reason: "[Erased by owner]" } } : {}) })
        const appeals = await ctx.db.query("moderationAppeals").withIndex("by_case_user", q => q.eq("serverId", identity.serverId).eq("caseNo", row.caseNo)).take(21)
        for (const appeal of appeals) await ctx.db.patch(appeal._id, { text: "[Erased by owner]", decisionReason: "[Erased by owner]", erased: true })
        return { duplicate: false, type: "erased", cases: 1, appeals: appeals.length }
    }
    fail(400, "Invalid operation")
} })

export const query = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationQueryResult> => {
    const input = decode(ModerationQueryRequest, request); const serverId = input.serverId; requireServer(serverId); const who = actor(input.actor); const op = input.operation
    const settings = config(await readSettings(ctx, serverId)); const type = op.type
    if (op.type === "recovery-case") {
        const row = await caseByNo(ctx, serverId, op.caseNo)
        if (!row.recoveryId) fail(403, "Recovery case required")
        authorize(who, settings, recoveryScope(row), true); privateRead(input)
        return { type: "case", case: await publicCase(ctx, row) }
    }
    authorize(who, settings, scopeFor(type), true)
    // !appeal status also counts the open appeals among the server's newest 500
    if (op.type === "settings") return { type: "settings", settings, ...(op.appeals ? { openAppeals: (await ctx.db.query("moderationAppeals").withIndex("by_server_appeal", q => q.eq("serverId", serverId)).order("desc").take(500)).filter(row => row.status === "open").length } : {}) }
    if (type.startsWith("case-") || type.startsWith("watchlist-")) privateRead(input)
    const page = "page" in op ? op.page ?? 1 : 1
    if (op.type === "case-show") return { type: "case", case: await publicCase(ctx, await caseByNo(ctx, serverId, op.caseNo)) }
    if (op.type === "case-list") {
        const before = op.beforeCaseNo ?? Number.MAX_SAFE_INTEGER, userId = op.userId
        const rows = userId === undefined ? await ctx.db.query("moderationCases").withIndex("by_server_case", q => q.eq("serverId", serverId).lt("caseNo", before)).order("desc").take(11)
            : await ctx.db.query("moderationCases").withIndex("by_server_user", q => q.eq("serverId", serverId).eq("targetId", userId).lt("caseNo", before)).order("desc").take(11)
        const selected = rows.slice(0, 10); return { type: "cases", cases: await Promise.all(selected.map(row => publicCase(ctx, row))), ...(rows.length > 10 ? { nextBeforeCaseNo: selected.at(-1)!.caseNo } : {}) }
    }
    if (op.type === "rule-show") {
        const ruleName = name(op.name), row = await ctx.db.query("automodRules").withIndex("by_server_name", q => q.eq("serverId", serverId).eq("name", ruleName)).unique()
        if (!row) fail(404, "Rule not found")
        return { type: "rule", rule: publicRule(row) }
    }
    if (op.type === "rule-list") {
        const result = paged(await ctx.db.query("automodRules").withIndex("by_server_name", q => q.eq("serverId", serverId)).take(101), page)
        return { type: "rules", rules: result.rows.map(publicRule), page, totalPages: result.totalPages }
    }
    const entry = ({ userId, reason, createdAt }: { userId: string, reason: string, createdAt: number }) => ({ userId, reason, createdAt })
    if (op.type === "watchlist-list") {
        const result = paged(await ctx.db.query("securityWatchlist").withIndex("by_server_user", q => q.eq("serverId", serverId)).take(1001), page)
        return { type: "watchlist", entries: result.rows.map(entry), page, totalPages: result.totalPages }
    }
    if (op.type === "watchlist-show") {
        const userId = op.userId, row = await ctx.db.query("securityWatchlist").withIndex("by_server_user", q => q.eq("serverId", serverId).eq("userId", userId)).unique()
        if (!row) fail(404, "Watchlist entry not found")
        return { type: "watchlist-entry", entry: entry(row) }
    }
    if (op.type === "recovery-list") {
        const result = paged(await ctx.db.query("securityRecoveries").withIndex("by_server", q => q.eq("serverId", serverId)).take(1001), page)
        return { type: "recoveries", recoveries: result.rows.map(publicRecovery), page, totalPages: result.totalPages }
    }
    const rows = op.type === "recovery-target" ? await ctx.db.query("securityRecoveries").withIndex("by_server_target", q => q.eq("serverId", serverId).eq("targetId", op.targetId)).take(1001)
        : await ctx.db.query("securityRecoveries").withIndex("by_server_channel", q => q.eq("serverId", serverId).eq("channelId", op.channelId)).take(1001)
    const row = rows.filter(r => r.type === (type === "recovery-target" ? "timeout" : "lock")).sort((a,b) => b.generation - a.generation)[0]
    if (!row) fail(404, "Recovery not found")
    return { type: "recovery", recovery: publicRecovery(row) }
} })

async function boundCase(ctx: MutationCtx, input: { serverId: string, caseNo: number }, actionId: string) {
    requireServer(input.serverId)
    const id = ctx.db.normalizeId("moderationCases", actionId); const row = id ? await ctx.db.get(id) : null
    if (!row || row.serverId !== input.serverId || row.caseNo !== input.caseNo) fail(409, "Action changed")
    return row
}
// The same route records a dispatch claim and an outcome
const OutcomeRequest = Schema.Union([ModerationDispatchRequest, ModerationOutcomeRequest])
export const outcome = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationOutcomeResult> => {
    const input = decode(OutcomeRequest, request); const row = await boundCase(ctx, input, input.actionId)
    // The bot claims the grant right before it dispatches the provider action. Only the first claim may dispatch
    if ("dispatch" in input) { if (row.outcome !== "pending" || row.dispatched) fail(409, "Action changed"); await ctx.db.patch(row._id, { dispatched: true }); return { recorded: false } }
    if (row.outcome !== "pending") { if (row.outcome !== input.outcome) fail(409, "Outcome already recorded"); return { recorded: false } }
    const result: { recorded: boolean, log?: StaffLogGrant, notice?: WarningNoticeGrant } = { recorded: true }
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
                    if (owned) await ctx.db.patch(recovery._id, { expectedTimeoutUntil: actual, knownDeadline: Date.parse(actual), status: "active" })
                    else await retireRecovery(ctx, recovery)
                    if (owned && row.targetId) {
                        const older = await ctx.db.query("securityRecoveries").withIndex("by_server_target", q => q.eq("serverId", row.serverId).eq("targetId", row.targetId)).take(1001)
                        for (const old of older) if (old.type === "timeout" && old.generation < recovery.generation) await retireRecovery(ctx, old)
                    }
                } else {
                    const banExpiry = input.banExpiresAt
                    await ctx.db.patch(recovery._id, { status: "active", ...(recovery.type === "ban" && banExpiry ? { knownDeadline: Date.parse(banExpiry) } : {}) })
                }
            } else if (input.outcome === "failed" && ["release", "unlock"].includes(row.action) && recovery.reversalState) {
                await ctx.db.patch(recovery._id, { status: recovery.reversalState.status, reversalState: undefined })
            } else if (input.outcome === "failed") await retireRecovery(ctx, recovery)
            else await ctx.db.patch(recovery._id, { status: "uncertain" })
        }
    }
    if (input.outcome === "succeeded" && ["unban", "untimeout"].includes(row.action) && row.targetId) {
        const recoveries = await ctx.db.query("securityRecoveries").withIndex("by_server_target", q => q.eq("serverId", row.serverId).eq("targetId", row.targetId)).take(1001)
        for (const recovery of recoveries) if (recovery.generation < row.caseNo && recovery.type === (row.action === "unban" ? "ban" : "timeout")) await retireRecovery(ctx, recovery)
    }
    if (row.logChannelId) {
        await ctx.db.patch(row._id, { logOutcome: "pending" })
        result.log = { logId: row._id, channelId: row.logChannelId, caseNo: row.caseNo, action: row.action as NonNullable<ModerationOutcomeResult["log"]>["action"],
            outcome: input.outcome as "succeeded" | "failed" | "uncertain", reason: row.reason, ...(row.targetId ? { targetId: row.targetId } : {}) }
    }
    if (row.action === "warn" && row.targetId && input.outcome === "succeeded") {
        await ctx.db.patch(row._id, { notificationOutcome: "pending" })
        result.notice = { noticeId: row._id, caseNo: row.caseNo, targetId: row.targetId, reason: row.reason }
    }
    return result
} })
function deliveryMutation(kind: "log" | "notice") {
    return serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationLogOutcomeResult> => {
        const input = kind === "log" ? decode(ModerationLogOutcomeRequest, request) : decode(ModerationNoticeOutcomeRequest, request)
        const row = await boundCase(ctx, input, "logId" in input ? input.logId : input.noticeId), messageId = input.sentMessageId
        const field = kind === "log" ? "logOutcome" : "notificationOutcome"
        if (row[field] !== "pending") { if (row[field] !== input.outcome) fail(409, "Outcome already recorded"); return { recorded: false } }
        await ctx.db.patch(row._id, { [field]: input.outcome, ...(messageId ? { [kind === "log" ? "logMessageId" : "noticeMessageId"]: messageId } : {}) })
        return { recorded: true }
    } })
}
export const logOutcome = deliveryMutation("log")
export const noticeOutcome = deliveryMutation("notice")

export const reconcile = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationReconcileResult> => {
    const input = decode(ModerationReconcileRequest, request); const now = Date.now(); const identity = source(input, now); const who = actor(input.actor); const settings = config(await state(ctx, identity.serverId))
    const id = ctx.db.normalizeId("moderationCases", input.actionId); const row = id ? await ctx.db.get(id) : null
    if (!row || row.serverId !== identity.serverId) fail(404, "Case not found")
    authorize(who, settings, row.recoveryId ? recoveryScope(row) : "cases", true)
    privateRead(input)
    // The read server and member are evidence for this check only and are not kept
    const { originServerId: _origin, memberUserId: _member, ...observation } = input.observation; const observedAt = observation.observedAt
    if (observedAt < row.createdAt) fail(400, "Invalid request")
    fresh(observedAt, now)
    if (observation.memberPresent !== undefined) {
        if (!row.targetId) fail(400, "Member observation requires a target")
        requireReadMember(input.observation, row.targetId)
    }
    const claim = await receipt(ctx, identity.serverId, `manual:${identity.messageId}`, now)
    if (claim.duplicate || (row.observation?.observedAt ?? -1) >= observedAt) return { recorded: false, case: await publicCase(ctx, row) }
    await ctx.db.patch(row._id, { observation })
    if (row.recoveryId) {
        const recovery = await ctx.db.get(row.recoveryId)
        if (recovery && recovery.generation === row.caseNo && recovery.status !== "pending") {
            const timeoutEnded = recovery.type === "timeout" && Object.hasOwn(observation, "timeoutUntil") && (observation.timeoutUntil === null
                || observation.timeoutUntil !== recovery.expectedTimeoutUntil || Date.parse(observation.timeoutUntil!) <= now)
            const ended = recovery.type === "ban" && observation.banned === false || timeoutEnded
                || recovery.type === "lock" && observation.overwrite && recovery.expectedOverwrite && !ownedOverwriteEqual(observation.overwrite, recovery.expectedOverwrite, lockMask(recovery))
            if (ended) await retireRecovery(ctx, recovery)
            else if (recovery.type === "ban" && observation.banExpiresAt) await ctx.db.patch(recovery._id, { knownDeadline: Date.parse(observation.banExpiresAt) })
        }
    }
    return { recorded: true, case: await publicCase(ctx, (await ctx.db.get(row._id))!) }
} })

// The bot sends the server. A continuation also carries the startup cutoff
const ObserveRequest = Schema.Struct({ ...ModerationObserveRequest.fields, cutoff: Schema.optionalKey(Millis) })
export const observe = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationObserveResult> => {
    // Runs once when the bot starts: anything still pending was interrupted by the previous process
    // Continuations keep the startup cutoff so actions reserved by the current process stay pending
    const input = decode(ObserveRequest, request); const serverId = input.serverId; requireServer(serverId)
    const now = Date.now(), cutoff = input.cutoff ?? now; if (cutoff > now) fail(400, "Invalid request")
    const rows = await ctx.db.query("moderationCases").withIndex("by_outcome", q => q.eq("serverId", serverId).eq("outcome", "pending")).filter(q => q.lte(q.field("createdAt"), cutoff)).take(BATCH)
    let uncertainActions = 0; let uncertainLogs = 0
    for (const row of rows) {
        await ctx.db.patch(row._id, { outcome: "uncertain" }); uncertainActions++
        const recovery = row.recoveryId ? await ctx.db.get(row.recoveryId) : null
        if (recovery?.generation === row.caseNo) await ctx.db.patch(recovery._id, { status: "uncertain" })
    }
    const logs = await ctx.db.query("moderationCases").withIndex("by_log_outcome", q => q.eq("serverId", serverId).eq("logOutcome", "pending")).filter(q => q.lte(q.field("createdAt"), cutoff)).take(BATCH)
    for (const row of logs) { await ctx.db.patch(row._id, { logOutcome: "uncertain" }); uncertainLogs++ }
    const notices = await ctx.db.query("moderationCases").withIndex("by_notice_outcome", q => q.eq("serverId", serverId).eq("notificationOutcome", "pending")).filter(q => q.lte(q.field("createdAt"), cutoff)).take(BATCH)
    for (const row of notices) await ctx.db.patch(row._id, { notificationOutcome: "uncertain" })
    if (rows.length === BATCH || logs.length === BATCH || notices.length === BATCH) await ctx.scheduler.runAfter(0, internal.moderation.observe, { request: { serverId, cutoff } })
    return { settings: config(await state(ctx, serverId)), uncertainActions, uncertainLogs }
} })
export const gate = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationGateResult> => {
    const input = decode(ModerationGateRequest, request); const serverId = input.serverId; requireServer(serverId); const who = actor(input.actor); const settings = config(await readSettings(ctx, serverId))
    const staff = administrator(who) || who.nativePermissionAuthorized && Object.values(settings.staffRoleIds).some(ids => ids.some(id => who.roleIds.includes(id)))
    const allowed = settings.defcon === 3
        || settings.defcon === 2 && (input.command === "appeal" || ["staff", "critical"].includes(input.command) && staff)
        || settings.defcon === 1 && input.command === "critical" && administrator(who)
    return { defcon: settings.defcon, allowed,
        messageProtectionEnabled: settings.automodEnabled || settings.securityEnabled && settings.honeypotEnabled,
        joinProtectionEnabled: settings.securityEnabled && (settings.joinEnabled || settings.watchlistEnabled),
        botMessageProtectionEnabled: settings.automodEnabled && settings.automodBotMessagesEnabled }
} })

export async function cleanupModeration(ctx: MutationCtx, now: number) {
    let removed = 0; let continuation = false
    // Readers already ignore these through recoveryElapsed, so deleting them can wait for the next run
    const elapsed = await ctx.db.query("securityRecoveries").withIndex("by_status_deadline", q => q.eq("status", "active").gt("knownDeadline", 0).lte("knownDeadline", now)).take(BATCH)
    for (const recovery of elapsed) await retireRecovery(ctx, recovery)
    continuation ||= elapsed.length === BATCH
    const receipts = await ctx.db.query("moderationReceipts").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(BATCH)
    for (const row of receipts) { await ctx.db.delete(row._id); removed++ }
    continuation ||= receipts.length === BATCH
    const windows = await ctx.db.query("automodWindows").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(BATCH)
    for (const row of windows) { await ctx.db.delete(row._id); removed++ }
    continuation ||= windows.length === BATCH
    const appeals = await ctx.db.query("moderationAppeals").withIndex("by_expiry", q => q.gt("expiresAt", 0).lte("expiresAt", now)).take(BATCH)
    for (const row of appeals) { if (row.status === "open") continue; await ctx.db.delete(row._id); removed++ }
    continuation ||= appeals.length === BATCH
    const cases = await ctx.db.query("moderationCases").withIndex("by_expiry", q => q.lte("expiresAt", now)).take(BATCH)
    for (const row of cases) {
        // A live recovery snapshot or appeal keeps its case readable
        if (row.recoveryId && await ctx.db.get(row.recoveryId)) { await ctx.db.patch(row._id, { expiresAt: now + DAY }); continue }
        const appeals = await ctx.db.query("moderationAppeals").withIndex("by_case_user", q => q.eq("serverId", row.serverId).eq("caseNo", row.caseNo)).take(21)
        if (appeals.length) { await ctx.db.patch(row._id, { expiresAt: Math.max(now + DAY, ...appeals.map(a => a.expiresAt ?? now + DAY)) }); continue }
        for (const correction of await ctx.db.query("moderationCorrections").withIndex("by_case", q => q.eq("caseId", row._id)).take(21)) await ctx.db.delete(correction._id)
        await ctx.db.delete(row._id); removed++
        const settings = await readSettings(ctx, row.serverId)
        if (settings) await ctx.db.patch(settings._id, { casesRemoved: (settings.casesRemoved ?? 0) + 1 })
    }
    continuation ||= cases.length === BATCH
    return { removed, more: continuation }
}

// One pass that continues itself while a batch is full. The cron runs it through the retention chain in retention.ts
export const cleanup = internalMutation({ args: {}, handler: async ctx => {
    const { removed, more } = await retentionPass(ctx, cleanupModeration)
    if (more) await ctx.scheduler.runAfter(0, internal.moderation.cleanup, {})
    return { removed }
} })

// Dashboard jobs and presets apply their stored operation
export async function applyModerationConfiguration(ctx: MutationCtx, serverId: string, op: Record<string, unknown>, now: number): Promise<ModerationManageResult> {
    return applyConfiguration(ctx, serverId, decode(ModerationManageOperation, op), now)
}
async function applyConfiguration(ctx: MutationCtx, serverId: string, op: ModerationManageOperation, now: number): Promise<ModerationManageResult> {
    const identity = { serverId }, current = await state(ctx, serverId), settings = config(current)
    if (op.type === "settings") {
        const next = settingsPatch(settings, op.patch)
        const staffRoleIds = op.patch.staffRoleIds
        if (staffRoleIds !== undefined) {
            await protectedStaffRoles(ctx, identity.serverId, [...new Set(Object.values(staffRoleIds).flat())])
        }
        await ctx.db.patch(current._id, { config: next })
        return { duplicate: false, type: "settings", settings: next }
    }
    if (op.type === "rule-create" || op.type === "rule-update" || op.type === "rule-delete") {
        const ruleName = op.type === "rule-create" ? rule(op.rule).name : name(op.name)
        const existing = await ctx.db.query("automodRules").withIndex("by_server_name", q => q.eq("serverId", identity.serverId).eq("name", ruleName)).unique()
        if (op.type === "rule-create") {
            if (existing) fail(409, "Rule already exists")
            if ((await ctx.db.query("automodRules").withIndex("by_server_name", q => q.eq("serverId", identity.serverId)).take(101)).length >= 100) fail(429, "Rule capacity reached")
            const data = rule(op.rule); await ctx.db.insert("automodRules", { serverId: identity.serverId, name: data.name, rule: data }); return { duplicate: false, type: "rule", rule: data }
        }
        if (!existing) fail(404, "Rule not found")
        if (op.type === "rule-delete") { await ctx.db.delete(existing._id); return { duplicate: false, type: "deleted", name: ruleName } }
        const data = rulePatch(existing.rule, op.patch); await ctx.db.patch(existing._id, { rule: data }); return { duplicate: false, type: "rule", rule: data }
    }
    if (op.type === "watchlist-add" || op.type === "watchlist-remove") {
        const userId = op.userId; const old = await ctx.db.query("securityWatchlist").withIndex("by_server_user", q => q.eq("serverId", identity.serverId).eq("userId", userId)).unique()
        if (op.type === "watchlist-remove") { if (!old) fail(404, "Watchlist entry not found"); await ctx.db.delete(old._id); return { duplicate: false, type: "watchlist-removed", userId } }
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
