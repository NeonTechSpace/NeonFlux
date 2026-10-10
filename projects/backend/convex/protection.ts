import { v } from "convex/values"
import type { AutomodRule, ModerationEvaluateResult, ModerationJoinResult } from "../contracts.js"
import { serviceMutation } from "./installations.ts"
import { actionContext, reserveAction } from "./moderationActions.ts"
import { domains, domainMatches } from "./moderationDomain.ts"
import { deceptiveLink, protectedDomains } from "./moderationLinks.ts"
import { config, receipt, state } from "./moderationStore.ts"
import { fail, object, requireId, requireServer, bool, fresh, ids, integer, listsChannel, parentChannel, text } from "./validation.ts"
import { metadataSettingsEvent } from "./metadataLogsStore.ts"

export const evaluate = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationEvaluateResult> => {
    const input = object(request); const now = Date.now(); const serverId = requireId(input.serverId); requireServer(serverId)
    const messageId = requireId(input.messageId); const userId = requireId(input.userId); const channelId = requireId(input.channelId); const roleIds = ids(input.roleIds, 1000)
    // Channel rules treat a message in a thread as in its parent channel too
    const parentChannelId = parentChannel(input.parentChannelId, channelId)
    if (input.event !== "create" && input.event !== "edit") fail(400, "Invalid request")
    const createdAt = integer(input.createdAt, 0, now + 60000)
    const timestamp = input.event === "edit" ? integer(input.editedAt, createdAt, now + 60000) : createdAt; fresh(timestamp, now)
    if (typeof input.content !== "string" || input.content.length > 20000 || typeof input.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(input.contentHash)) fail(400, "Invalid request")
    const content = input.content; const hash = input.contentHash; const userMentions = ids(input.mentionedUserIds, 1000)
    const roleMentions = input.mentionedRoleIds === null ? null : ids(input.mentionedRoleIds, 1000)
    const everyone = input.mentionedEveryone === null ? null : bool(input.mentionedEveryone)
    const targetIsStaff = bool(input.targetIsStaff); const context = actionContext(input.context)
    if (!context.botAuthorizedActions) fail(400, "Action permissions required")
    if (input.author !== undefined && input.author !== "bot" && input.author !== "webhook") fail(400, "Invalid request")
    const author = input.author as "bot" | "webhook" | undefined
    const current = await state(ctx, serverId); const settings = config(current)
    // A webhook or another bot is checked only while automod checks bot messages, and nothing is stored for it otherwise
    if (author && !(settings.automodEnabled && settings.automodBotMessagesEnabled)) return { duplicate: false, blocked: false }
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
    const rules = settings.automodEnabled ? (await ctx.db.query("automodRules").withIndex("by_server_name", q => q.eq("serverId", serverId)).take(101)).map(row => row.rule as AutomodRule) : []
    const mentions = userMentions.length + (roleMentions?.length ?? 0) + (everyone ? 1 : 0)
    const links = domains(content).length
    if (input.event === "create" && settings.automodEnabled) {
        const where = { serverId, userId, channelId, ...(parentChannelId ? { parentChannelId } : {}), timestamp, expiresAt: now + 300000 }
        await ctx.db.insert("automodWindows", { ...where, kind: "message", contentHash: hash })
        // Mention and link counts are kept only while a rule counts them
        const counted = (type: AutomodRule["type"]) => rules.some(r => r.enabled && r.type === type)
        if (mentions && counted("mention-rate")) await ctx.db.insert("automodWindows", { ...where, kind: "mention", count: mentions })
        if (links && counted("link-rate")) await ctx.db.insert("automodWindows", { ...where, kind: "link", count: links })
    }
    // Adds up the rule's qualifying rows and stops once its threshold is reached. Every mention and link row counts at least one,
    // so a rule reads at most 100 of them. Repeat rules read only windows of the same content, so the member's other messages
    // in the window are never read
    const reaches = async (candidate: AutomodRule, kind: "message" | "mention" | "link", sameContent = false) => {
        let count = 0
        const since = now - candidate.windowSeconds * 1000
        const windows = sameContent
            ? ctx.db.query("automodWindows").withIndex("by_server_user_hash_time", q => q.eq("serverId", serverId).eq("userId", userId).eq("contentHash", hash).gte("timestamp", since))
            : ctx.db.query("automodWindows").withIndex("by_server_user_kind_time", q => q.eq("serverId", serverId).eq("userId", userId).eq("kind", kind).gte("timestamp", since))
        for await (const w of windows.order("desc")) {
            if (w.kind === kind && (!candidate.channelIds.length || listsChannel(candidate.channelIds, w.channelId, w.parentChannelId)) && !listsChannel(candidate.exemptChannelIds, w.channelId, w.parentChannelId)
                && (!sameContent || w.contentHash === hash) && (count += w.count ?? 1) >= candidate.threshold) return true
        }
        return false
    }
    const candidates = rules
        .filter(r => r.enabled && (!r.channelIds.length || listsChannel(r.channelIds, channelId, parentChannelId)) && !listsChannel(r.exemptChannelIds, channelId, parentChannelId) && !r.exemptRoleIds.some(id => roleIds.includes(id)))
        .sort((a, b) => b.priority - a.priority || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    let selected: AutomodRule | undefined
    for (const candidate of candidates) {
        const normalized = content.toLowerCase()
        const created = input.event === "create"
        const hits = candidate.type === "spam" ? created && await reaches(candidate, "message")
            : candidate.type === "repeat" ? created && await reaches(candidate, "message", true)
                : candidate.type === "mention-rate" ? created && mentions > 0 && await reaches(candidate, "mention")
                    : candidate.type === "link-rate" ? created && links > 0 && await reaches(candidate, "link")
                        : candidate.type === "deceptive-links" ? deceptiveLink(content, [...protectedDomains, ...candidate.patterns])
                            : candidate.type === "mentions" ? everyone === true || userMentions.length + (roleMentions?.length ?? 0) >= candidate.threshold
                                : candidate.type === "words" || candidate.type === "invites" ? candidate.patterns.some(p => normalized.includes(p))
                                    : candidate.domainMode === "allow" ? domains(content).some(host => !domainMatches([host], candidate.patterns)) : domainMatches(domains(content), candidate.patterns)
        if (hits) { selected = candidate; break }
    }
    // Honeypots quarantine a member, so they apply to members only
    const honeypot = !author && settings.securityEnabled && settings.honeypotEnabled && listsChannel(settings.honeypotChannelIds, channelId, parentChannelId)
    if (!honeypot && !selected) return { duplicate: false, blocked: false }
    const enforce = honeypot ? settings.securityMode === "enforce" : settings.automodMode === "enforce"
    // A webhook or bot has no member to warn or time out, so a warning only logs and a timeout deletes the message
    const desired = honeypot ? "quarantine" : author ? ({ log: "log", warn: "log", delete: "delete", timeout: "delete" } as const)[selected!.action] : selected!.action
    const durationSeconds = honeypot ? 900 : selected!.durationSeconds
    const strongerTimeout = ["timeout", "quarantine"].includes(desired) && context.currentTimeoutUntil && Date.parse(context.currentTimeoutUntil) >= now + durationSeconds * 1000
    const action = !enforce || strongerTimeout ? "log" : desired
    const dryRun = enforce ? "" : " (dry run)"
    const result = await reserveAction(ctx, { serverId, sourceId: messageId, settings,
        input: { type: action, ...(author ? {} : { targetId: userId }), channelId,
            ...(action === "delete" ? { messageIds: [messageId] } : {}), ...(["timeout", "quarantine"].includes(action) ? { durationSeconds } : {}),
            reason: honeypot ? "Honeypot triggered" : author ? `Automod ${selected!.name}, ${author} ${userId}${dryRun}` : `Automod ${selected!.name}${dryRun}` },
        context, origin: honeypot ? "security" : "automod", ...(honeypot ? { incident: "honeypot" as const } : {}),
        ...(selected ? { ruleName: selected.name } : {}), blocked: enforce, now })
    await ctx.db.patch(claim.row._id, { claimed: true, blocked: enforce })
    return { duplicate: false, blocked: enforce, ...result }
} })

export const join = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationJoinResult> => {
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
        await metadataSettingsEvent(ctx, { serverId, messageId: String(result.case.caseNo) }, null, "security", ["defcon"])
    }
    return { duplicate: false, settings, ...result }
} })
