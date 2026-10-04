import { v } from "convex/values"
import type { AutomodRule, ModerationEvaluateResult, ModerationJoinResult } from "../contracts.js"
import { internalMutation } from "./_generated/server.js"
import { actionContext, reserveAction } from "./moderationActions.ts"
import { domains, domainMatches } from "./moderationDomain.ts"
import { config, receipt, state } from "./moderationStore.ts"
import { fail, object, requireId, requireServer, bool, fresh, ids, integer, text } from "./validation.ts"

export const evaluate = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationEvaluateResult> => {
    const input = object(request); const now = Date.now(); const serverId = requireId(input.serverId); requireServer(serverId)
    const messageId = requireId(input.messageId); const userId = requireId(input.userId); const channelId = requireId(input.channelId); const roleIds = ids(input.roleIds, 1000)
    if (input.event !== "create" && input.event !== "edit") fail(400, "Invalid request")
    const createdAt = integer(input.createdAt, 0, now + 60000)
    const timestamp = input.event === "edit" ? integer(input.editedAt, createdAt, now + 60000) : createdAt; fresh(timestamp, now)
    if (typeof input.content !== "string" || input.content.length > 20000 || typeof input.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(input.contentHash)) fail(400, "Invalid request")
    const content = input.content; const hash = input.contentHash; const userMentions = ids(input.mentionedUserIds, 1000)
    const roleMentions = input.mentionedRoleIds === null ? null : ids(input.mentionedRoleIds, 1000)
    const everyone = input.mentionedEveryone === null ? null : bool(input.mentionedEveryone)
    const targetIsStaff = bool(input.targetIsStaff); const context = actionContext(input.context)
    if (!context.botAuthorizedActions) fail(400, "Action permissions required")
    const current = await state(ctx, serverId); const settings = config(current)
    const earlierCase = await ctx.db.query("moderationCases").withIndex("by_server_source", q => q.eq("serverId", serverId).eq("sourceId", messageId)).take(3)
    const earlier = earlierCase.find(c => c.origin !== "manual")
    if (earlier) return { duplicate: true, blocked: earlier.blocksPublic }
    const claim = await receipt(ctx, serverId, `message:${messageId}`, now)
    const version = input.event === "create" ? "create" : `edit:${timestamp}:${hash}`
    const latestEdit = Math.max(0, ...claim.row.versions.filter(v => v.startsWith("edit:")).map(v => Number(v.split(":")[1])))
    if (claim.row.claimed || claim.row.versions.includes(version) || input.event === "edit" && timestamp < latestEdit
        || input.event === "create" && claim.row.createCounted) return { duplicate: true, blocked: claim.row.blocked }
    await ctx.db.patch(claim.row._id, { versions: [...claim.row.versions, version].slice(-2), createCounted: input.event === "create" || claim.row.createCounted })
    const protectedMember = targetIsStaff || context.targetProtected || Object.values(settings.staffRoleIds).some(list => list.some(id => roleIds.includes(id))) || userId === context.botId
    if (protectedMember) return { duplicate: false, blocked: false }
    if (input.event === "create" && settings.automodEnabled) {
        await ctx.db.insert("automodWindows", { serverId, userId, channelId, kind: "message", contentHash: hash, timestamp, expiresAt: now + 300000 })
    }
    // Counts only the rule's qualifying messages and stops once its threshold is reached
    const reaches = async (candidate: AutomodRule, sameContent: boolean) => {
        let count = 0
        for await (const w of ctx.db.query("automodWindows").withIndex("by_server_user_time", q => q.eq("serverId", serverId).eq("userId", userId)
            .gte("timestamp", now - candidate.windowSeconds * 1000)).order("desc")) {
            if (w.kind === "message" && (!candidate.channelIds.length || candidate.channelIds.includes(w.channelId!)) && !candidate.exemptChannelIds.includes(w.channelId!)
                && (!sameContent || w.contentHash === hash) && ++count >= candidate.threshold) return true
        }
        return false
    }
    const candidates = settings.automodEnabled ? (await ctx.db.query("automodRules").withIndex("by_server_name", q => q.eq("serverId", serverId)).take(101)).map(row => row.rule as AutomodRule)
        .filter(r => r.enabled && (!r.channelIds.length || r.channelIds.includes(channelId)) && !r.exemptChannelIds.includes(channelId) && !r.exemptRoleIds.some(id => roleIds.includes(id)))
        .sort((a, b) => b.priority - a.priority || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) : []
    let selected: AutomodRule | undefined
    for (const candidate of candidates) {
        const normalized = content.toLowerCase()
        const hits = candidate.type === "spam" ? input.event === "create" && await reaches(candidate, false)
            : candidate.type === "repeat" ? input.event === "create" && await reaches(candidate, true)
                : candidate.type === "mentions" ? everyone === true || userMentions.length + (roleMentions?.length ?? 0) >= candidate.threshold
                    : candidate.type === "words" || candidate.type === "invites" ? candidate.patterns.some(p => normalized.includes(p))
                        : candidate.domainMode === "allow" ? domains(content).some(host => !domainMatches([host], candidate.patterns)) : domainMatches(domains(content), candidate.patterns)
        if (hits) { selected = candidate; break }
    }
    const honeypot = settings.securityEnabled && settings.honeypotEnabled && settings.honeypotChannelIds.includes(channelId)
    if (!honeypot && !selected) return { duplicate: false, blocked: false }
    const enforce = honeypot ? settings.securityMode === "enforce" : settings.automodMode === "enforce"
    const desired = honeypot ? "quarantine" : selected!.action
    const durationSeconds = honeypot ? 900 : selected!.durationSeconds
    const strongerTimeout = ["timeout", "quarantine"].includes(desired) && context.currentTimeoutUntil && Date.parse(context.currentTimeoutUntil) >= now + durationSeconds * 1000
    const action = !enforce || strongerTimeout ? "log" : desired
    const result = await reserveAction(ctx, { serverId, sourceId: messageId, settings,
        input: { type: action, targetId: userId, channelId,
            ...(action === "delete" ? { messageIds: [messageId] } : {}), ...(["timeout", "quarantine"].includes(action) ? { durationSeconds } : {}),
            reason: honeypot ? "Honeypot triggered" : `Automod ${selected!.name}${enforce ? "" : " (dry run)"}` },
        context, origin: honeypot ? "security" : "automod", ...(honeypot ? { incident: "honeypot" as const } : {}),
        ...(selected ? { ruleName: selected.name } : {}), blocked: enforce, now })
    await ctx.db.patch(claim.row._id, { claimed: true, blocked: enforce })
    return { duplicate: false, blocked: enforce, ...result }
} })

export const join = internalMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationJoinResult> => {
    const input = object(request); const now = Date.now(); const serverId = requireId(input.serverId); requireServer(serverId); const userId = requireId(input.userId)
    const joinedAt = integer(input.joinedAt, 0, Number.MAX_SAFE_INTEGER); fresh(joinedAt, now); const targetIsStaff = bool(input.targetIsStaff); const context = actionContext(input.context)
    let settings = config(await state(ctx, serverId)); const claim = await receipt(ctx, serverId, `join:${userId}:${joinedAt}`, now)
    if (claim.duplicate) return { duplicate: true, settings }
    if (!settings.securityEnabled || targetIsStaff || context.targetProtected || userId === context.botId) return { duplicate: false, settings }
    if (settings.joinEnabled) {
        await ctx.db.insert("automodWindows", { serverId, userId, kind: "join", timestamp: joinedAt, expiresAt: now + 300000 })
    }
    const watched = settings.watchlistEnabled ? await ctx.db.query("securityWatchlist").withIndex("by_server_user", q => q.eq("serverId", serverId).eq("userId", userId)).unique() : null
    const joins = settings.joinEnabled ? await ctx.db.query("automodWindows")
        .withIndex("by_server_kind_time", q => q.eq("serverId", serverId).eq("kind", "join").gte("timestamp", now - settings.joinWindowSeconds * 1000)).take(101) : []
    const burst = joins.length >= settings.joinThreshold
    if (!watched && !burst) return { duplicate: false, settings }
    // One join-burst case covers every join inside the burst window
    const burstCase = burst && !watched ? await ctx.db.query("moderationCases").withIndex("by_server_incident", q => q.eq("serverId", serverId)
        .eq("incident", "join-burst").gte("createdAt", now - settings.joinWindowSeconds * 1000)).first() : null
    if (burstCase) return { duplicate: false, settings }
    const result = await reserveAction(ctx, { serverId, sourceId: `join:${userId}:${joinedAt}`, settings,
        input: { type: "log", targetId: userId, reason: watched ? "Watchlist member joined" : "Join burst detected" },
        context, origin: "security", incident: watched ? "watchlist" : "join-burst", now })
    await ctx.db.patch(claim.row._id, { claimed: true })
    if (burst && settings.joinDefcon2 && settings.securityMode === "enforce" && settings.defcon === 3) {
        settings = { ...settings, defcon: 2 }
        await ctx.db.patch((await state(ctx, serverId))._id, { config: settings })
    }
    return { duplicate: false, settings, ...result }
} })
