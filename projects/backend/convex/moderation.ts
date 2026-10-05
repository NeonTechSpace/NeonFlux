import { bumpConfigurationRevision } from "./configurationRevision.ts"
import { v } from "convex/values"
import type { ModerationManageResult, ModerationQueryResult, ModerationOutcomeResult, ModerationReconcileResult, ModerationObserveResult, ModerationGateResult, StaffClass, ModerationSettings, ProviderObservation } from "../contracts.js"
import { internalMutation, internalQuery } from "./_generated/server.js"
import type { MutationCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import { actor, administrator, authorize, BATCH, DAY, overwrite, rule, rulePatch, settingsPatch, timeout } from "./moderationDomain.ts"
import { actionContext, actionInput, ownedOverwriteEqual, reserveAction } from "./moderationActions.ts"
import { caseByNo, config, paged, publicCase, publicRecovery, publicRule, readSettings, receipt, retireRecovery, state } from "./moderationStore.ts"
import { fail, object, requireId, requireReadMember, requireServer, bool, fresh, integer, name, source, text, token } from "./validation.ts"
import { protectedStaffRoles } from "./rolesStore.ts"
import { metadataCoreReceipt, metadataSettingsEvent } from "./metadataLogsStore.ts"
import { metadataChangedFields } from "./metadataLogsDomain.ts"

function criticalOperation(op: Record<string, unknown>) {
    if (op.type === "action") return ["release", "unlock", "untimeout", "unban"].includes(String(object(op.action).type))
    // Lowering DEFCON or switching protections off stays available in a lockdown
    const switches = ["manualModerationEnabled", "automodEnabled", "securityEnabled", "joinEnabled", "honeypotEnabled", "watchlistEnabled"]
    if (op.type === "settings") return Object.entries(object(op.patch)).every(([key, value]) => key === "defcon" || switches.includes(key) && value === false)
    return false
}
function scopeFor(type: string): StaffClass {
    return type.startsWith("rule-") ? "automod" : type.startsWith("watchlist-") || type.startsWith("recovery-") ? "security" : type.startsWith("case-") || type === "erase" ? "cases" : "moderation"
}
function privateRead(input: Record<string, unknown>) { if (input.privateChannelVerified !== true) fail(403, "Private channel required") }
function recoveryScope(row: { origin: string, action: string }): StaffClass { return row.origin === "security" || ["lock", "unlock", "quarantine", "release"].includes(row.action) ? "security" : "moderation" }

export const manage = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationManageResult> => {
    const input = object(request); const now = Date.now(); const identity = source(input, now); const who = actor(input.actor); const op = object(input.operation)
    const type = String(op.type); const current = await state(ctx, identity.serverId); const settings = config(current); const critical = criticalOperation(op)
    if (type === "settings") { if (!administrator(who)) fail(403, "Administrator permission required"); if (settings.defcon === 1 && !critical) fail(403, "DEFCON restriction") }
    else authorize(who, settings, type === "action" && ["quarantine", "release", "lock", "unlock"].includes(String(object(op.action).type)) ? "security" : scopeFor(type), critical)
    if (type === "erase" && !who.isOwner) fail(403, "Owner permission required")
    const claim = await receipt(ctx, identity.serverId, `manual:${identity.messageId}`, now)
    if (type === "settings") await metadataCoreReceipt(ctx, identity, who.userId, op.patch, claim.duplicate)
    if (claim.duplicate) return { duplicate: true }
    if (type === "settings" || type.startsWith("rule-") || type === "watchlist-add" || type === "watchlist-remove") {
        const result = await applyModerationConfiguration(ctx, identity.serverId, op, now)
        await bumpConfigurationRevision(ctx, identity.serverId, "moderation", { kind: "chat", createdAt: identity.createdAt })
        if (type === "settings" && !result.duplicate && result.type === "settings") {
            const tracked = metadataChangedFields.settings as readonly string[]
            const changed = Object.keys(object(op.patch)).filter(key => tracked.includes(key)
                && JSON.stringify(settings[key as keyof ModerationSettings]) !== JSON.stringify(result.settings[key as keyof ModerationSettings]))
            if (changed.length) await metadataSettingsEvent(ctx, identity, who.userId, "moderation", changed)
        }
        return result
    }
    if (type === "action") {
        const action = actionInput(op.action)
        if (!settings.manualModerationEnabled && !critical && !["quarantine", "lock"].includes(action.type)) fail(403, "Manual moderation disabled")
        if (action.linkedCaseNo) {
            const linked = await caseByNo(ctx, identity.serverId, action.linkedCaseNo)
            if (action.targetId && linked.targetId !== action.targetId || action.channelId && linked.channelId !== action.channelId) fail(409, "Linked case target mismatch")
        }
        const result = await reserveAction(ctx, { serverId: identity.serverId, sourceId: identity.messageId, settings, actor: who, input: action, context: actionContext(op.context), origin: "manual", now })
        return { duplicate: false, type: "case", ...result }
    }
    if (type === "case-reason" || type === "case-void") {
        const row = await caseByNo(ctx, identity.serverId, integer(op.caseNo, 1, Number.MAX_SAFE_INTEGER))
        if (row.erased || row.correctionCount >= 20) fail(409, "Case cannot be corrected")
        if (type === "case-void" && row.voided) fail(409, "Case already voided")
        const reason = type === "case-reason" ? text(op.reason) : row.reason
        await ctx.db.insert("moderationCorrections", { caseId: row._id, actorId: who.userId, createdAt: now, previousReason: row.reason, reason, type: type === "case-reason" ? "reason" : "void" })
        await ctx.db.patch(row._id, { reason, voided: type === "case-void" ? true : row.voided, correctionCount: row.correctionCount + 1 })
        if (type === "case-void") {
            const result = await reserveAction(ctx, { serverId: identity.serverId, sourceId: identity.messageId, settings, actor: who,
                input: { type: "log", ...(row.targetId ? { targetId: row.targetId } : {}), reason: `Case ${row.caseNo} voided`, linkedCaseNo: row.caseNo },
                context: actionContext({ botActionAuthorized: true, actorCanManageTarget: true, botCanManageTarget: true, targetProtected: false, botId: who.userId }),
                origin: "manual", now })
            return { duplicate: false, type: "case", ...result }
        }
        return { duplicate: false, type: "case", case: await publicCase(ctx, (await ctx.db.get(row._id))!) }
    }
    if (type === "erase") {
        const row = await caseByNo(ctx, identity.serverId, integer(op.caseNo, 1, Number.MAX_SAFE_INTEGER))
        const corrections = await ctx.db.query("moderationCorrections").withIndex("by_case", q => q.eq("caseId", row._id)).take(21)
        for (const correction of corrections) await ctx.db.delete(correction._id)
        await ctx.db.patch(row._id, { reason: "[Erased by owner]", erased: true, correctionCount: 0, ...(row.grant ? { grant: { ...row.grant, reason: "[Erased by owner]" } } : {}) })
        const appeals = await ctx.db.query("moderationAppeals").withIndex("by_case_user", q => q.eq("serverId", identity.serverId).eq("caseNo", row.caseNo)).take(21)
        for (const appeal of appeals) await ctx.db.patch(appeal._id, { text: "[Erased by owner]", decisionReason: "[Erased by owner]", erased: true })
        return { duplicate: false, type: "erased", cases: 1, appeals: appeals.length }
    }
    fail(400, "Invalid operation")
} })

export const query = internalQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationQueryResult> => {
    const input = object(request); const serverId = requireId(input.serverId); requireServer(serverId); const who = actor(input.actor); const op = object(input.operation)
    const settings = config(await readSettings(ctx, serverId)); const type = String(op.type)
    if (type === "recovery-case") {
        const row = await caseByNo(ctx, serverId, integer(op.caseNo, 1, Number.MAX_SAFE_INTEGER))
        if (!row.recoveryId) fail(403, "Recovery case required")
        authorize(who, settings, recoveryScope(row), true); privateRead(input)
        return { type: "case", case: await publicCase(ctx, row) }
    }
    authorize(who, settings, scopeFor(type), true)
    if (type === "settings") return { type: "settings", settings }
    if (type.startsWith("case-") || type.startsWith("watchlist-")) privateRead(input)
    const page = op.page === undefined ? 1 : integer(op.page, 1, 1100)
    if (type === "case-show") return { type: "case", case: await publicCase(ctx, await caseByNo(ctx, serverId, integer(op.caseNo, 1, Number.MAX_SAFE_INTEGER))) }
    if (type === "case-list") {
        const before = op.beforeCaseNo === undefined ? Number.MAX_SAFE_INTEGER : integer(op.beforeCaseNo, 1, Number.MAX_SAFE_INTEGER)
        const rows = op.userId === undefined ? await ctx.db.query("moderationCases").withIndex("by_server_case", q => q.eq("serverId", serverId).lt("caseNo", before)).order("desc").take(11)
            : await ctx.db.query("moderationCases").withIndex("by_server_user", q => q.eq("serverId", serverId).eq("targetId", requireId(op.userId)).lt("caseNo", before)).order("desc").take(11)
        const selected = rows.slice(0, 10); return { type: "cases", cases: await Promise.all(selected.map(row => publicCase(ctx, row))), ...(rows.length > 10 ? { nextBeforeCaseNo: selected.at(-1)!.caseNo } : {}) }
    }
    if (type === "rule-show") {
        const row = await ctx.db.query("automodRules").withIndex("by_server_name", q => q.eq("serverId", serverId).eq("name", name(op.name))).unique()
        if (!row) fail(404, "Rule not found")
        return { type: "rule", rule: publicRule(row) }
    }
    if (type === "rule-list") {
        const result = paged(await ctx.db.query("automodRules").withIndex("by_server_name", q => q.eq("serverId", serverId)).take(101), page)
        return { type: "rules", rules: result.rows.map(publicRule), page, totalPages: result.totalPages }
    }
    const entry = ({ userId, reason, createdAt }: { userId: string, reason: string, createdAt: number }) => ({ userId, reason, createdAt })
    if (type === "watchlist-list") {
        const result = paged(await ctx.db.query("securityWatchlist").withIndex("by_server_user", q => q.eq("serverId", serverId)).take(1001), page)
        return { type: "watchlist", entries: result.rows.map(entry), page, totalPages: result.totalPages }
    }
    if (type === "watchlist-show") {
        const row = await ctx.db.query("securityWatchlist").withIndex("by_server_user", q => q.eq("serverId", serverId).eq("userId", requireId(op.userId))).unique()
        if (!row) fail(404, "Watchlist entry not found")
        return { type: "watchlist-entry", entry: entry(row) }
    }
    if (type === "recovery-list") {
        const result = paged(await ctx.db.query("securityRecoveries").withIndex("by_server", q => q.eq("serverId", serverId)).take(1001), page)
        return { type: "recoveries", recoveries: result.rows.map(publicRecovery), page, totalPages: result.totalPages }
    }
    if (type === "recovery-target" || type === "recovery-channel") {
        const rows = type === "recovery-target" ? await ctx.db.query("securityRecoveries").withIndex("by_server_target", q => q.eq("serverId", serverId).eq("targetId", requireId(op.targetId))).take(1001)
            : await ctx.db.query("securityRecoveries").withIndex("by_server_channel", q => q.eq("serverId", serverId).eq("channelId", requireId(op.channelId))).take(1001)
        const row = rows.filter(r => r.type === (type === "recovery-target" ? "timeout" : "lock")).sort((a,b) => b.generation - a.generation)[0]
        if (!row) fail(404, "Recovery not found")
        return { type: "recovery", recovery: publicRecovery(row) }
    }
    fail(400, "Invalid operation")
} })

async function boundCase(ctx: MutationCtx, input: Record<string, unknown>, idField: string) {
    const serverId = requireId(input.serverId); requireServer(serverId)
    const id = ctx.db.normalizeId("moderationCases", token(input[idField])); const row = id ? await ctx.db.get(id) : null
    if (!row || row.serverId !== serverId || row.caseNo !== integer(input.caseNo, 1, Number.MAX_SAFE_INTEGER)) fail(409, "Action changed")
    return row
}
export const outcome = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationOutcomeResult> => {
    const input = object(request); const row = await boundCase(ctx, input, "actionId")
    // The bot claims the grant right before it dispatches the provider action. Only the first claim may dispatch
    if (input.dispatch === true) { if (row.outcome !== "pending" || row.dispatched) fail(409, "Action changed"); await ctx.db.patch(row._id, { dispatched: true }); return { recorded: false } }
    if (!["succeeded", "failed", "uncertain"].includes(String(input.outcome))) fail(400, "Invalid outcome")
    if (row.outcome !== "pending") { if (row.outcome !== input.outcome) fail(409, "Outcome already recorded"); return { recorded: false } }
    const result: ModerationOutcomeResult = { recorded: true }
    await ctx.db.patch(row._id, { outcome: input.outcome as "succeeded" | "failed" | "uncertain" })
    if (row.recoveryId) {
        const recovery = await ctx.db.get(row.recoveryId)
        if (recovery && recovery.generation === row.caseNo) {
            if (input.outcome === "succeeded") {
                if (["release", "unlock"].includes(row.action)) await retireRecovery(ctx, recovery)
                else if (recovery.type === "timeout") {
                    const actual = timeout(input.timeoutUntil)
                    if (!actual) fail(400, "Timeout outcome required")
                    const owned = actual !== recovery.previousTimeoutUntil
                    if (owned) await ctx.db.patch(recovery._id, { expectedTimeoutUntil: actual, knownDeadline: Date.parse(actual), status: "active" })
                    else await retireRecovery(ctx, recovery)
                    if (owned && row.targetId) {
                        const older = await ctx.db.query("securityRecoveries").withIndex("by_server_target", q => q.eq("serverId", row.serverId).eq("targetId", row.targetId)).take(1001)
                        for (const old of older) if (old.type === "timeout" && old.generation < recovery.generation) await retireRecovery(ctx, old)
                    }
                } else {
                    const banExpiry = Object.hasOwn(input, "banExpiresAt") ? timeout(input.banExpiresAt) : undefined
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
    return internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<{ recorded: boolean }> => {
        const input = object(request); const row = await boundCase(ctx, input, kind === "log" ? "logId" : "noticeId")
        if (!["sent", "failed", "uncertain"].includes(String(input.outcome))) fail(400, "Invalid outcome")
        if (input.sentMessageId !== undefined && input.outcome !== "sent") fail(400, "Invalid outcome")
        const messageId = input.sentMessageId === undefined ? undefined : requireId(input.sentMessageId)
        const field = kind === "log" ? "logOutcome" : "notificationOutcome"
        if (row[field] !== "pending") { if (row[field] !== input.outcome) fail(409, "Outcome already recorded"); return { recorded: false } }
        await ctx.db.patch(row._id, { [field]: String(input.outcome), ...(messageId ? { [kind === "log" ? "logMessageId" : "noticeMessageId"]: messageId } : {}) })
        return { recorded: true }
    } })
}
export const logOutcome = deliveryMutation("log")
export const noticeOutcome = deliveryMutation("notice")

export const reconcile = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationReconcileResult> => {
    const input = object(request); const now = Date.now(); const identity = source(input, now); const who = actor(input.actor); const settings = config(await state(ctx, identity.serverId))
    const id = ctx.db.normalizeId("moderationCases", token(input.actionId)); const row = id ? await ctx.db.get(id) : null
    if (!row || row.serverId !== identity.serverId) fail(404, "Case not found")
    authorize(who, settings, row.recoveryId ? recoveryScope(row) : "cases", true)
    privateRead(input)
    const value = object(input.observation); const observedAt = integer(value.observedAt, row.createdAt, now + 60000); fresh(observedAt, now)
    if (Object.hasOwn(value, "memberPresent")) {
        if (!row.targetId) fail(400, "Member observation requires a target")
        requireReadMember(value, row.targetId)
    }
    const observation: ProviderObservation = { observedAt,
        ...(Object.hasOwn(value, "timeoutUntil") ? { timeoutUntil: timeout(value.timeoutUntil) } : {}), ...(Object.hasOwn(value, "banned") ? { banned: bool(value.banned) } : {}),
        ...(Object.hasOwn(value, "memberPresent") ? { memberPresent: bool(value.memberPresent) } : {}), ...(Object.hasOwn(value, "overwrite") ? { overwrite: overwrite(value.overwrite) } : {}),
        ...(Object.hasOwn(value, "banExpiresAt") ? { banExpiresAt: timeout(value.banExpiresAt) } : {}),
        ...(Object.hasOwn(value, "slowmodeSeconds") ? { slowmodeSeconds: integer(value.slowmodeSeconds, 0, 21600) } : {}) }
    const claim = await receipt(ctx, identity.serverId, `manual:${identity.messageId}`, now)
    if (claim.duplicate || (row.observation?.observedAt ?? -1) >= observedAt) return { recorded: false, case: await publicCase(ctx, row) }
    await ctx.db.patch(row._id, { observation })
    if (row.recoveryId) {
        const recovery = await ctx.db.get(row.recoveryId)
        if (recovery && recovery.generation === row.caseNo && recovery.status !== "pending") {
            const timeoutEnded = recovery.type === "timeout" && Object.hasOwn(observation, "timeoutUntil") && (observation.timeoutUntil === null
                || observation.timeoutUntil !== recovery.expectedTimeoutUntil || Date.parse(observation.timeoutUntil!) <= now)
            const ended = recovery.type === "ban" && observation.banned === false || timeoutEnded
                || recovery.type === "lock" && observation.overwrite && recovery.expectedOverwrite && !ownedOverwriteEqual(observation.overwrite, recovery.expectedOverwrite)
            if (ended) await retireRecovery(ctx, recovery)
            else if (recovery.type === "ban" && observation.banExpiresAt) await ctx.db.patch(recovery._id, { knownDeadline: Date.parse(observation.banExpiresAt) })
        }
    }
    return { recorded: true, case: await publicCase(ctx, (await ctx.db.get(row._id))!) }
} })

export const observe = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationObserveResult> => {
    // Runs once when the bot starts: anything still pending was interrupted by the previous process
    // Continuations keep the startup cutoff so actions reserved by the current process stay pending
    const input = object(request); const serverId = requireId(input.serverId); requireServer(serverId)
    const cutoff = input.cutoff === undefined ? Date.now() : integer(input.cutoff, 0, Date.now())
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
export const gate = internalQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationGateResult> => {
    const input = object(request); const serverId = requireId(input.serverId); requireServer(serverId); const who = actor(input.actor); const settings = config(await readSettings(ctx, serverId))
    if (!["public", "staff", "critical", "appeal"].includes(String(input.command))) fail(400, "Invalid request")
    const staff = administrator(who) || who.nativePermissionAuthorized && Object.values(settings.staffRoleIds).some(ids => ids.some(id => who.roleIds.includes(id)))
    const allowed = settings.defcon === 3
        || settings.defcon === 2 && (input.command === "appeal" || ["staff", "critical"].includes(String(input.command)) && staff)
        || settings.defcon === 1 && input.command === "critical" && administrator(who)
    return { defcon: settings.defcon, allowed,
        messageProtectionEnabled: settings.automodEnabled || settings.securityEnabled && settings.honeypotEnabled,
        joinProtectionEnabled: settings.securityEnabled && (settings.joinEnabled || settings.watchlistEnabled) }
} })

export const cleanup = internalMutation({ args: {}, handler: async ctx => {
    const now = Date.now(); let removed = 0; let continuation = false
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
    }
    continuation ||= cases.length === BATCH
    if (continuation) await ctx.scheduler.runAfter(0, internal.moderation.cleanup, {})
    return { removed }
} })

export async function applyModerationConfiguration(ctx: MutationCtx, serverId: string, op: Record<string, unknown>, now: number): Promise<ModerationManageResult> {
    const identity = { serverId }, current = await state(ctx, serverId), settings = config(current), type = String(op.type)
    if (type === "settings") {
        const next = settingsPatch(settings, op.patch)
        const staffRoleIds = object(op.patch).staffRoleIds
        if (staffRoleIds !== undefined) {
            await protectedStaffRoles(ctx, identity.serverId, [...new Set(Object.values(object(staffRoleIds)).flatMap(value => value as string[]))])
        }
        await ctx.db.patch(current._id, { config: next })
        return { duplicate: false, type: "settings", settings: next }
    }
    if (type.startsWith("rule-")) {
        const ruleName = type === "rule-create" ? rule(op.rule).name : name(op.name)
        const existing = await ctx.db.query("automodRules").withIndex("by_server_name", q => q.eq("serverId", identity.serverId).eq("name", ruleName)).unique()
        if (type === "rule-create") {
            if (existing) fail(409, "Rule already exists")
            if ((await ctx.db.query("automodRules").withIndex("by_server_name", q => q.eq("serverId", identity.serverId)).take(101)).length >= 100) fail(429, "Rule capacity reached")
            const data = rule(op.rule); await ctx.db.insert("automodRules", { serverId: identity.serverId, name: data.name, rule: data }); return { duplicate: false, type: "rule", rule: data }
        }
        if (!existing) fail(404, "Rule not found")
        if (type === "rule-delete") { await ctx.db.delete(existing._id); return { duplicate: false, type: "deleted", name: ruleName } }
        if (type !== "rule-update") fail(400, "Invalid operation")
        const data = rulePatch(existing.rule, op.patch); await ctx.db.patch(existing._id, { rule: data }); return { duplicate: false, type: "rule", rule: data }
    }
    if (type === "watchlist-add" || type === "watchlist-remove") {
        const userId = requireId(op.userId); const old = await ctx.db.query("securityWatchlist").withIndex("by_server_user", q => q.eq("serverId", identity.serverId).eq("userId", userId)).unique()
        if (type === "watchlist-remove") { if (!old) fail(404, "Watchlist entry not found"); await ctx.db.delete(old._id); return { duplicate: false, type: "watchlist-removed", userId } }
        const entry = { userId, reason: text(op.reason), createdAt: old?.createdAt ?? now }
        if (old) await ctx.db.patch(old._id, entry)
        else await ctx.db.insert("securityWatchlist", { serverId: identity.serverId, ...entry })
        return { duplicate: false, type: "watchlist", entry }
    }
    fail(400, "Invalid moderation configuration")
}
