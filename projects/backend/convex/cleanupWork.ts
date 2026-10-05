import { v } from "convex/values"
import type { CleanupGrant, CleanupPageItem, CleanupPolicy, CleanupTargetState, CleanupWorkResult } from "../contracts.js"
import { internalMutation } from "./_generated/server.js"
import { shape } from "./publishingDomain.ts"
import { advanceCleanup, cleanupBinding, cleanupBoundary, cleanupContext, cleanupEligibility, cleanupMessage, cleanupMessages, cleanupObservation, cleanupTargetBinding, CLEANUP_GRANT_MS, CLEANUP_RETENTION, CLEANUP_SETTLE_MS, emptyCleanupCounts } from "./cleanupDomain.ts"
import { ageCleanupTarget, cancelCleanupSweep, cleanupAutomation, cleanupCount, cleanupDisposition, cleanupGate, cleanupIntent, cleanupPolicy, cleanupProtection, cleanupSettings, cleanupState, cleanupSweep, cleanupTarget, finishCleanupTarget, publicCleanupPage, publicCleanupPolicy, publicCleanupSettings, publicCleanupSweep, publicCleanupTarget, readCleanupPage, readCleanupPageTargets, readCleanupSweep, sweepBinding, targetBinding } from "./cleanupStore.ts"
import { fail, requireId, requireServer, integer } from "./validation.ts"

export const work = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<CleanupWorkResult> => {
    const input = shape(request, ["serverId", "operation"], ["serverId", "operation"]), serverId = requireId(input.serverId); requireServer(serverId)
    const raw = shape(input.operation, ["type", "cursor", "channelId", "expectedRevision", "context", "binding", "pageNo", "before", "messages", "reason", "message", "claimToken", "outcome", "noDispatch", "observation"]), now = Date.now()
    if (raw.type === "list") {
        const op = shape(raw, ["type", "cursor"], ["type"]), state = await cleanupSettings(ctx, serverId)
        if (!state?.enabled) return { type: "policies", policies: [], hasMore: false, settings: publicCleanupSettings(state) }
        await cleanupGate(ctx, serverId)
        const cursor = op.cursor === undefined ? undefined : shape(op.cursor, ["cursor", "throughAt"], ["cursor", "throughAt"])
        const throughAt = cursor ? integer(cursor.throughAt, 0, now) : now
        if (cursor && (typeof cursor.cursor !== "string" || cursor.cursor.length > 8192)) fail(400, "Invalid cleanup discovery cursor")
        const page = await ctx.db.query("cleanupPolicies").withIndex("by_due", q => q.eq("serverId", serverId).eq("enabled", true).lte("nextCheckAt", throughAt)).paginate({ numItems: 20, cursor: cursor ? cursor.cursor as string : null })
        const settings = publicCleanupSettings(state), policies: CleanupPolicy[] = page.page.map(publicCleanupPolicy)
        return { type: "policies", policies, hasMore: !page.isDone, settings, ...(!page.isDone ? { nextCursor: { cursor: page.continueCursor, throughAt } } : {}) }
    }
    if (raw.type === "defer") {
        const op = shape(raw, ["type", "channelId", "expectedRevision", "reason"], ["type", "channelId", "expectedRevision", "reason"]), policy = await cleanupPolicy(ctx, serverId, requireId(op.channelId), op.expectedRevision)
        if (!["authority", "history", "malformed", "quota", "target"].includes(String(op.reason))) fail(400, "Invalid cleanup blocked reason")
        await ctx.db.patch(policy._id, { nextCheckAt: now + 60000, blockedReason: op.reason as string })
        return { type: "progress", recorded: true, complete: false }
    }
    if (raw.type === "start") {
        const op = shape(raw, ["type", "channelId", "expectedRevision", "context"], ["type", "channelId", "expectedRevision", "context"]), policy = await cleanupPolicy(ctx, serverId, requireId(op.channelId), op.expectedRevision), context = cleanupContext(op.context)
        await cleanupAutomation(ctx, serverId, context, policy.channelId)
        const state = await cleanupState(ctx, serverId)
        if (!state.enabled || !policy.enabled) fail(403, "Cleanup disabled")
        let sweep = policy.sweepNo === undefined ? null : await readCleanupSweep(ctx, serverId, policy.sweepNo)
        if (sweep?.state === "active" && (sweep.policyRevision !== policy.revision || sweep.moduleRevision !== state.revision || sweep.ownerId !== policy.ownerId)) { await cancelCleanupSweep(ctx, sweep); sweep = null }
        if (!sweep || sweep.state !== "active") {
            // Replace the previous target-free cycle's aggregate instead of accumulating empty audit rows
            if (sweep && !await ctx.db.query("cleanupTargets").withIndex("by_page", q => q.eq("serverId", serverId).eq("sweepNo", sweep!.sweepNo)).first()) { await ctx.db.delete(sweep._id); await cleanupCount(ctx, serverId, "retainedSweeps", -1) }
            await cleanupCount(ctx, serverId, "retainedSweeps", 1)
            const sweepNo = state.nextSweepNo, cutoffAt = now - policy.ageMs, id = await ctx.db.insert("cleanupSweeps", { serverId, channelId: policy.channelId, policyRevision: policy.revision, moduleRevision: state.revision, sweepNo, ownerId: policy.ownerId, cutoffAt, before: cleanupBoundary(cutoffAt), pageNo: 1, state: "active", counts: emptyCleanupCounts(), createdAt: now, updatedAt: now })
            await ctx.db.patch(state._id, { nextSweepNo: advanceCleanup(sweepNo) })
            sweep = (await ctx.db.get(id))!
        }
        const page = await readCleanupPage(ctx, serverId, sweep.sweepNo)
        await ctx.db.patch(policy._id, { sweepNo: sweep.sweepNo, nextCheckAt: now + 60000, blockedReason: undefined })
        const targets = page ? await readCleanupPageTargets(ctx, serverId, sweep.sweepNo, page.pageNo) : []
        for (const target of targets) await ageCleanupTarget(ctx, target)
        return { type: "sweep", sweep: publicCleanupSweep((await ctx.db.get(sweep._id))!), page: page ? publicCleanupPage(page) : null, targets: (page ? await readCleanupPageTargets(ctx, serverId, sweep.sweepNo, page.pageNo) : []).map(publicCleanupTarget) }
    }
    if (raw.type === "page") {
        const op = shape(raw, ["type", "binding", "pageNo", "before", "messages", "context"], ["type", "binding", "pageNo", "before", "messages", "context"]), binding = cleanupBinding(op.binding), context = cleanupContext(op.context), { policy, sweep, state } = await cleanupIntent(ctx, serverId, binding, context), pageNo = integer(op.pageNo, 1, Number.MAX_SAFE_INTEGER), before = requireId(op.before)
        if (sweep.pageNo !== pageNo || sweep.before !== before) fail(409, "Cleanup page cursor changed")
        const messages = cleanupMessages(op.messages, policy.channelId, serverId, before), existing = await readCleanupPage(ctx, serverId, sweep.sweepNo)
        if (existing) {
            if (existing.items.length !== messages.length || messages.some((message, i) => Object.entries(message).some(([key, value]) => key !== "originServerId" && existing.items[i]!.message[key as keyof typeof existing.items[number]["message"]] !== value))) fail(409, "Cleanup persisted page changed")
            return { type: "page", page: publicCleanupPage(existing), targets: (await readCleanupPageTargets(ctx, serverId, sweep.sweepNo, pageNo)).map(publicCleanupTarget), quotaPaused: false }
        }
        const items: CleanupPageItem[] = []
        for (const message of messages) { const reason = await cleanupDisposition(ctx, serverId, message, publicCleanupPolicy(policy), sweep.cutoffAt); items.push({ message, disposition: reason ? "skipped" : "eligible", ...(reason ? { reason } : {}) }) }
        const eligible = items.filter(x => x.disposition === "eligible")
        let nextTargetNo = state.nextTargetNo
        for (const item of eligible) {
            item.targetNo = nextTargetNo
            await ctx.db.insert("cleanupTargets", { serverId, ...binding, pageNo, targetNo: nextTargetNo, messageId: item.message.messageId, ownerId: policy.ownerId, state: "queued", message: item.message, active: true, replayBlocked: false, createdAt: now, updatedAt: now })
            nextTargetNo = advanceCleanup(nextTargetNo)
        }
        await cleanupCount(ctx, serverId, "retainedTargets", eligible.length)
        await ctx.db.patch(state._id, { nextTargetNo })
        const id = await ctx.db.insert("cleanupPages", { serverId, ...binding, pageNo, before, ...(messages.length ? { nextBefore: messages.at(-1)!.messageId } : {}), empty: messages.length === 0, items, persistedAt: now })
        await ctx.db.patch(sweep._id, { counts: { ...sweep.counts, scanned: sweep.counts.scanned + messages.length, skipped: sweep.counts.skipped + items.length - eligible.length }, updatedAt: now })
        await ctx.db.patch(policy._id, { nextCheckAt: now + 60000, blockedReason: undefined })
        return { type: "page", page: publicCleanupPage((await ctx.db.get(id))!), targets: (await readCleanupPageTargets(ctx, serverId, sweep.sweepNo, pageNo)).map(publicCleanupTarget), quotaPaused: false }
    }
    if (raw.type === "advance") {
        const op = shape(raw, ["type", "binding", "pageNo"], ["type", "binding", "pageNo"]), binding = cleanupBinding(op.binding), sweep = await cleanupSweep(ctx, serverId, binding), pageNo = integer(op.pageNo, 1, Number.MAX_SAFE_INTEGER)
        if (sweep.state !== "active" || sweep.pageNo !== pageNo) fail(409, "Cleanup page changed")
        const page = await readCleanupPage(ctx, serverId, sweep.sweepNo)
        if (!page || page.pageNo !== pageNo) fail(409, "Cleanup page not persisted")
        const targets = await readCleanupPageTargets(ctx, serverId, sweep.sweepNo, pageNo)
        for (const row of targets) { const target = await ageCleanupTarget(ctx, row); if (target.state === "queued" || target.state === "reserved") return { type: "progress", recorded: false, complete: false } }
        await ctx.db.delete(page._id)
        await ctx.db.patch(sweep._id, { pageNo: advanceCleanup(pageNo), ...(page.nextBefore ? { before: page.nextBefore } : {}), updatedAt: now, ...(page.empty ? { state: "complete" as const, expiresAt: now + CLEANUP_RETENTION } : {}) })
        const policy = await cleanupPolicy(ctx, serverId, sweep.channelId)
        if (policy.sweepNo === sweep.sweepNo) await ctx.db.patch(policy._id, { nextCheckAt: now + 60000, blockedReason: undefined })
        return { type: "progress", recorded: true, complete: page.empty }
    }
    const binding = cleanupTargetBinding(raw.binding), original = await cleanupTarget(ctx, serverId, binding)
    if (raw.type === "outcome") {
        const op = shape(raw, ["type", "binding", "outcome", "claimToken", "noDispatch", "observation"], ["type", "binding", "outcome"])
        if (!["deleted", "failed", "uncertain", "absent", "skipped"].includes(String(op.outcome)) || op.noDispatch !== undefined && op.noDispatch !== true) fail(400, "Invalid cleanup outcome")
        const outcome = op.outcome as Exclude<CleanupTargetState, "queued" | "reserved" | "cancelled">, noDispatch = op.noDispatch === true
        if (original.claimedAt !== undefined) { if (op.claimToken !== original.claimToken) fail(403, "Cleanup claim mismatch") }
        else if (op.claimToken !== undefined || !noDispatch || outcome === "deleted" || outcome === "uncertain") fail(409, "Unclaimed cleanup outcome requires no dispatch")
        if ((outcome === "skipped" || outcome === "absent") && !noDispatch || outcome === "deleted" && noDispatch || outcome === "uncertain" && noDispatch) fail(400, "Cleanup outcome evidence mismatch")
        const observation = op.observation === undefined ? undefined : cleanupObservation(op.observation, binding.messageId, binding.channelId)
        if (outcome === "absent" && observation?.status !== "absent") fail(400, "Exact visible absence evidence required")
        if (observation && outcome !== "absent") fail(400, "Unexpected cleanup outcome observation")
        let row = await ageCleanupTarget(ctx, original)
        if (row.state !== "queued" && row.state !== "reserved") {
            if (row.state === "failed" && row.claimedAt !== undefined && !row.noDispatch && outcome === "uncertain") {
                if (row.reassessedAt === undefined) await ctx.db.patch(row._id, { reassessedAt: now, expiresAt: undefined, replayBlocked: true, updatedAt: now })
                return { type: "target", recorded: row.reassessedAt === undefined, target: publicCleanupTarget((await ctx.db.get(row._id))!) }
            }
            if (row.state === "uncertain" && row.claimedAt !== undefined && ["deleted", "failed", "uncertain"].includes(outcome)) {
                if (row.lateOutcome && row.lateOutcome !== outcome) fail(409, "Cleanup late outcome already recorded")
                if (!row.lateOutcome) {
                    await ctx.db.patch(row._id, { lateOutcome: outcome as "deleted" | "failed" | "uncertain", updatedAt: now })
                    const sweep = await readCleanupSweep(ctx, serverId, row.sweepNo)
                    if (sweep) await ctx.db.patch(sweep._id, { counts: { ...sweep.counts, submitted: sweep.counts.submitted + (row.reason === "operation-window-expired" && !noDispatch ? 1 : 0), acknowledged: sweep.counts.acknowledged + (outcome === "deleted" ? 1 : 0) }, updatedAt: now })
                }
                return { type: "target", recorded: !row.lateOutcome, target: publicCleanupTarget((await ctx.db.get(row._id))!) }
            }
            if (row.state !== outcome || !!row.noDispatch !== noDispatch) fail(409, "Cleanup outcome already recorded")
            return { type: "target", recorded: false, target: publicCleanupTarget(row) }
        }
        row = await finishCleanupTarget(ctx, row, outcome, noDispatch)
        if (observation) { await ctx.db.patch(row._id, { observation, ...(observation.status === "absent" ? { absenceObservedAt: now } : {}) }); row = (await ctx.db.get(row._id))! }
        return { type: "target", recorded: true, target: publicCleanupTarget(row) }
    }
    if (raw.type !== "reserve" && raw.type !== "claim") fail(400, "Unknown cleanup work operation")
    const claim = raw.type === "claim", op = shape(raw, claim ? ["type", "binding", "message", "context", "claimToken"] : ["type", "binding", "message", "context"], claim ? ["type", "binding", "message", "context", "claimToken"] : ["type", "binding", "message", "context"]), context = cleanupContext(op.context), { policy, sweep } = await cleanupIntent(ctx, serverId, binding, context)
    let row = await ageCleanupTarget(ctx, original)
    const message = cleanupMessage(op.message)
    if (message.messageId !== row.messageId || message.channelId !== row.channelId || message.serverId !== null && message.serverId !== serverId || message.authorId !== row.message.authorId || message.createdAt !== row.message.createdAt) fail(409, "Cleanup exact target mismatch")
    const reason = cleanupEligibility(message, publicCleanupPolicy(policy), sweep.cutoffAt) ?? (await cleanupProtection(ctx, serverId, row.channelId, row.messageId) ? "protected" : null)
    if (reason) {
        if (row.state === "queued" || row.state === "reserved" && row.claimedAt === undefined) { row = await finishCleanupTarget(ctx, row, "skipped", true, reason); return { type: "target", recorded: true, target: publicCleanupTarget(row) } }
        if (row.state === "skipped" && row.noDispatch) return { type: "target", recorded: false, target: publicCleanupTarget(row) }
        fail(409, "Claimed or settled cleanup target cannot be skipped by another invocation")
    }
    if (row.state !== "queued" && row.state !== "reserved") fail(409, "Cleanup target settled")
    if (row.state === "queued") {
        if (claim) fail(409, "Cleanup reservation required")
        const grant: CleanupGrant = { ...targetBinding(row), ownerId: row.ownerId, botId: context.botId, cutoffAt: sweep.cutoffAt, createdAt: message.createdAt!, authorId: message.authorId!, dispatchExpiresAt: now + CLEANUP_GRANT_MS, nativeDeadlineMs: 5000 }
        await ctx.db.patch(row._id, { state: "reserved", grant, updatedAt: now })
        await ctx.db.patch(sweep._id, { counts: { ...sweep.counts, attempted: sweep.counts.attempted + 1 }, updatedAt: now })
        return { type: "reserved", grant }
    }
    const grant = row.grant!
    if (grant.botId !== context.botId) fail(409, "Cleanup bot identity changed")
    if (!claim) { if (row.claimedAt !== undefined || now >= grant.dispatchExpiresAt) fail(409, "Cleanup reservation unavailable"); return { type: "reserved", grant } }
    if (typeof op.claimToken !== "string" || !/^[a-f0-9]{32,128}$/i.test(op.claimToken)) fail(400, "Invalid cleanup claim token")
    if (row.claimedAt !== undefined) return { type: "claimed", claimed: false, grant }
    if (now >= grant.dispatchExpiresAt) fail(409, "Cleanup claim expired")
    await ctx.db.patch(row._id, { claimedAt: now, claimToken: op.claimToken, replayBlocked: true, updatedAt: now })
    return { type: "claimed", claimed: true, grant }
} })
