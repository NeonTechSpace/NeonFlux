import { v } from "convex/values"
import { ModerationEvaluateRequest, ModerationJoinRequest, type AutomodRule, type ModerationEvaluateResult, type ModerationJoinResult } from "@neonflux/contracts/moderation"
import { serviceMutation } from "./installations.ts"
import { reserveAction } from "./moderationActions.ts"
import { domains, domainMatches } from "./moderationDomain.ts"
import { deceptiveLink, protectedDomains } from "./moderationLinks.ts"
import { config, readSettings, receipt, state } from "./moderationStore.ts"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { decode, fresh, listsChannel, requireServer } from "./validation.ts"
import { metadataSettingsEvent } from "./metadataLogsStore.ts"

const byPriority = (a: AutomodRule, b: AutomodRule) => b.priority - a.priority || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
// The rule types that judge text alone: words, domains, invites and deceptive links
const contentTypes: readonly AutomodRule["type"][] = ["words", "domains", "invites", "deceptive-links"]
export function contentMatches(rule: AutomodRule, content: string) {
    if (rule.type === "deceptive-links") return deceptiveLink(content, [...protectedDomains, ...rule.patterns])
    if (rule.type === "words" || rule.type === "invites") return rule.patterns.some(p => content.toLowerCase().includes(p))
    if (rule.type !== "domains") return false
    return rule.domainMode === "allow" ? domains(content).some(host => !domainMatches([host], rule.patterns)) : domainMatches(domains(content), rule.patterns)
}
/** The name of the first enabled content rule that matches text NeonFlux would post for a member, or null. Exempt roles apply, and a channel limits rules to those covering it */
export async function blockingContentRule(ctx: QueryCtx | MutationCtx, serverId: string, content: string, roleIds: readonly string[], channelId?: string): Promise<string | null> {
    if (!config(await readSettings(ctx, serverId)).automodEnabled) return null
    const rules = (await ctx.db.query("automodRules").withIndex("by_server_name", q => q.eq("serverId", serverId)).take(101)).map(row => row.rule as AutomodRule)
    return rules.filter(r => r.enabled && contentTypes.includes(r.type) && !r.exemptRoleIds.some(id => roleIds.includes(id))
        && (channelId === undefined || (!r.channelIds.length || listsChannel(r.channelIds, channelId)) && !listsChannel(r.exemptChannelIds, channelId)))
        .sort(byPriority).find(r => contentMatches(r, content))?.name ?? null
}

export const evaluate = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ModerationEvaluateResult> => {
    const input = decode(ModerationEvaluateRequest, request); const now = Date.now(); requireServer(input.serverId)
    // Channel rules treat a message in a thread as in its parent channel too
    const { serverId, messageId, userId, channelId, parentChannelId, context, author } = input; const roleIds = [...new Set(input.roleIds)]
    const timestamp = input.event === "edit" ? input.editedAt! : input.createdAt; fresh(timestamp, now)
    const content = input.content; const hash = input.contentHash; const userMentions = [...new Set(input.mentionedUserIds)]
    const roleMentions = input.mentionedRoleIds === null ? null : [...new Set(input.mentionedRoleIds)]
    const everyone = input.mentionedEveryone; const targetIsStaff = input.targetIsStaff
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
        .sort(byPriority)
    let selected: AutomodRule | undefined
    for (const candidate of candidates) {
        const created = input.event === "create"
        const hits = candidate.type === "spam" ? created && await reaches(candidate, "message")
            : candidate.type === "repeat" ? created && await reaches(candidate, "message", true)
                : candidate.type === "mention-rate" ? created && mentions > 0 && await reaches(candidate, "mention")
                    : candidate.type === "link-rate" ? created && links > 0 && await reaches(candidate, "link")
                        : candidate.type === "mentions" ? everyone === true || userMentions.length + (roleMentions?.length ?? 0) >= candidate.threshold
                            : contentMatches(candidate, content)
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
    const input = decode(ModerationJoinRequest, request); const now = Date.now(); const { serverId, userId, joinedAt, targetIsStaff, context } = input; requireServer(serverId); fresh(joinedAt, now)
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
