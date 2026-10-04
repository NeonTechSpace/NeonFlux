import { v } from "convex/values"
import {
    ModerationEvaluateRequest,
    ModerationJoinRequest,
    type AutomodRule,
    type ModerationEvaluateResult,
    type ModerationJoinResult,
} from "@neonflux/contracts/moderation"
import { serviceMutation } from "./serviceGuard.ts"
import { reserveAction } from "./moderationActions.ts"
import { domains, domainMatches, gateFor } from "./moderationDomain.ts"
import { config, receipt, state } from "./moderationStore.ts"
import { decode, fresh, listsChannel } from "./validation.ts"

const byPriority = (a: AutomodRule, b: AutomodRule) =>
    b.priority - a.priority || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
function contentMatches(rule: AutomodRule, content: string) {
    if (rule.type === "words" || rule.type === "invites")
        return rule.patterns.some((p) => content.toLowerCase().includes(p))
    if (rule.type !== "domains") return false
    return rule.domainMode === "allow"
        ? domains(content).some((host) => !domainMatches([host], rule.patterns))
        : domainMatches(domains(content), rule.patterns)
}

export const evaluate = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ModerationEvaluateResult> => {
        const input = decode(ModerationEvaluateRequest, request)
        const now = Date.now()
        // Channel rules treat a message in a thread as in its parent channel too
        const { serverId, messageId, userId, channelId, parentChannelId, context } = input
        const roleIds = [...new Set(input.roleIds)]
        const timestamp = input.event === "edit" ? input.editedAt! : input.createdAt
        fresh(timestamp, now)
        const content = input.content
        const hash = input.contentHash
        const userMentions = [...new Set(input.mentionedUserIds)]
        const roleMentions = input.mentionedRoleIds === null ? null : [...new Set(input.mentionedRoleIds)]
        const everyone = input.mentionedEveryone
        const targetIsStaff = input.targetIsStaff
        const current = await state(ctx, serverId)
        const settings = config(current)
        // A member message may carry its gate request. While message protection is off nothing is stored for it
        const gate = input.gate ? gateFor(settings, input.gate.actor, input.gate.command) : undefined
        const answer = (result: ModerationEvaluateResult): ModerationEvaluateResult =>
            gate ? { ...result, gate } : result
        if (gate && !gate.messageProtectionEnabled) return answer({ duplicate: false, blocked: false })
        const earlierCase = await ctx.db
            .query("moderationCases")
            .withIndex("by_server_source", (q) => q.eq("serverId", serverId).eq("sourceId", messageId))
            .take(3)
        const earlier = earlierCase.find((c) => c.origin !== "manual")
        if (earlier) return answer({ duplicate: true, blocked: earlier.blocksPublic })
        const claim = await receipt(ctx, serverId, `message:${messageId}`, now)
        const version = input.event === "create" ? "create" : `edit:${timestamp}:${hash}`
        const latestEdit = Math.max(
            0,
            ...claim.row.versions.filter((v) => v.startsWith("edit:")).map((v) => Number(v.split(":")[1])),
        )
        if (
            claim.row.claimed ||
            claim.row.versions.includes(version) ||
            (input.event === "edit" && timestamp < latestEdit) ||
            (input.event === "create" && claim.row.createCounted)
        )
            return answer({ duplicate: true, blocked: claim.row.blocked })
        await ctx.db.patch(claim.row._id, {
            versions: [...claim.row.versions, version].slice(-2),
            createCounted: input.event === "create" || claim.row.createCounted,
        })
        const protectedMember =
            targetIsStaff ||
            context.targetProtected ||
            Object.values(settings.staffRoleIds).some((list) => list.some((id) => roleIds.includes(id))) ||
            userId === context.botId
        if (protectedMember) return answer({ duplicate: false, blocked: false })
        const rules = settings.automodEnabled
            ? (
                  await ctx.db
                      .query("automodRules")
                      .withIndex("by_server_name", (q) => q.eq("serverId", serverId))
                      .take(101)
              ).map((row) => row.rule as AutomodRule)
            : []
        if (input.event === "create" && settings.automodEnabled) {
            const where = {
                serverId,
                userId,
                channelId,
                ...(parentChannelId ? { parentChannelId } : {}),
                timestamp,
                expiresAt: now + 300000,
            }
            await ctx.db.insert("automodWindows", { ...where, kind: "message", contentHash: hash })
        }
        // Counts only the rule's qualifying messages and stops once its threshold is reached. Repeat rules read only windows of
        // the same content, so the member's other messages in the window are never read
        const reaches = async (candidate: AutomodRule, sameContent = false) => {
            let count = 0
            const since = now - candidate.windowSeconds * 1000
            const windows = sameContent
                ? ctx.db
                      .query("automodWindows")
                      .withIndex("by_server_user_hash_time", (q) =>
                          q
                              .eq("serverId", serverId)
                              .eq("userId", userId)
                              .eq("contentHash", hash)
                              .gte("timestamp", since),
                      )
                : ctx.db
                      .query("automodWindows")
                      .withIndex("by_server_user_kind_time", (q) =>
                          q.eq("serverId", serverId).eq("userId", userId).eq("kind", "message").gte("timestamp", since),
                      )
            for await (const w of windows.order("desc")) {
                if (
                    w.kind === "message" &&
                    (!candidate.channelIds.length ||
                        listsChannel(candidate.channelIds, w.channelId, w.parentChannelId)) &&
                    !listsChannel(candidate.exemptChannelIds, w.channelId, w.parentChannelId) &&
                    (!sameContent || w.contentHash === hash) &&
                    ++count >= candidate.threshold
                )
                    return true
            }
            return false
        }
        const candidates = rules
            .filter(
                (r) =>
                    r.enabled &&
                    (!r.channelIds.length || listsChannel(r.channelIds, channelId, parentChannelId)) &&
                    !listsChannel(r.exemptChannelIds, channelId, parentChannelId) &&
                    !r.exemptRoleIds.some((id) => roleIds.includes(id)),
            )
            .sort(byPriority)
        let selected: AutomodRule | undefined
        for (const candidate of candidates) {
            const created = input.event === "create"
            const hits =
                candidate.type === "spam"
                    ? created && (await reaches(candidate))
                    : candidate.type === "repeat"
                      ? created && (await reaches(candidate, true))
                      : candidate.type === "mentions"
                        ? everyone === true || userMentions.length + (roleMentions?.length ?? 0) >= candidate.threshold
                        : contentMatches(candidate, content)
            if (hits) {
                selected = candidate
                break
            }
        }
        const honeypot =
            settings.securityEnabled &&
            settings.honeypotEnabled &&
            listsChannel(settings.honeypotChannelIds, channelId, parentChannelId) &&
            // A dry-run honeypot never replaces a matching automod rule that enforces
            (settings.securityMode === "enforce" || !selected || settings.automodMode !== "enforce")
        if (!honeypot && !selected) return answer({ duplicate: false, blocked: false })
        const enforce = honeypot ? settings.securityMode === "enforce" : settings.automodMode === "enforce"
        const desired = honeypot ? "quarantine" : selected!.action
        const durationSeconds = honeypot ? 900 : selected!.durationSeconds
        const strongerTimeout =
            ["timeout", "quarantine"].includes(desired) &&
            context.currentTimeoutUntil &&
            Date.parse(context.currentTimeoutUntil) >= now + durationSeconds * 1000
        // What NeonFlux cannot act on, by the checks reserveAction would refuse, is logged instead so the finding stays
        const cannotAct =
            desired !== "log" &&
            (!context.botActionAuthorized ||
                (context.botAuthorizedActions !== undefined && !context.botAuthorizedActions.includes(desired)) ||
                (["warn", "timeout", "quarantine"].includes(desired) &&
                    (!context.botCanManageTarget || !context.actorCanManageTarget)))
        const action = !enforce || strongerTimeout || cannotAct ? "log" : desired
        const dryRun = enforce ? "" : " (dry run)"
        const unable = enforce && cannotAct ? " (NeonFlux could not act)" : ""
        const result = await reserveAction(ctx, {
            serverId,
            sourceId: messageId,
            settings,
            input: {
                type: action,
                targetId: userId,
                channelId,
                ...(action === "delete" ? { messageIds: [messageId] } : {}),
                ...(["timeout", "quarantine"].includes(action) ? { durationSeconds } : {}),
                reason: honeypot ? `Honeypot triggered${unable}` : `Automod ${selected!.name}${dryRun}${unable}`,
            },
            context,
            origin: honeypot ? "security" : "automod",
            ...(honeypot ? { incident: "honeypot" as const } : {}),
            ...(selected ? { ruleName: selected.name } : {}),
            blocked: enforce,
            now,
        })
        await ctx.db.patch(claim.row._id, { claimed: true, blocked: enforce })
        return answer({ duplicate: false, blocked: enforce, ...result })
    },
})

export const join = serviceMutation({
    args: { request: v.any() },
    handler: async (ctx, { request }): Promise<ModerationJoinResult> => {
        const input = decode(ModerationJoinRequest, request)
        const now = Date.now()
        const { serverId, userId, joinedAt, targetIsStaff, context } = input
        fresh(joinedAt, now)
        let settings = config(await state(ctx, serverId))
        const claim = await receipt(ctx, serverId, `join:${userId}:${joinedAt}`, now)
        if (claim.duplicate) return { duplicate: true, settings }
        if (!settings.securityEnabled || targetIsStaff || context.targetProtected || userId === context.botId)
            return { duplicate: false, settings }
        if (settings.joinEnabled) {
            await ctx.db.insert("automodWindows", {
                serverId,
                userId,
                kind: "join",
                timestamp: joinedAt,
                expiresAt: now + 300000,
            })
        }
        const watched = settings.watchlistEnabled
            ? await ctx.db
                  .query("securityWatchlist")
                  .withIndex("by_server_user", (q) => q.eq("serverId", serverId).eq("userId", userId))
                  .unique()
            : null
        const joins = settings.joinEnabled
            ? await ctx.db
                  .query("automodWindows")
                  .withIndex("by_server_kind_time", (q) =>
                      q
                          .eq("serverId", serverId)
                          .eq("kind", "join")
                          .gte("timestamp", now - settings.joinWindowSeconds * 1000),
                  )
                  .take(101)
            : []
        const burst = joins.length >= settings.joinThreshold
        if (!watched && !burst) return { duplicate: false, settings }
        // One join-burst case covers every join inside the burst window
        const burstCase =
            burst && !watched
                ? await ctx.db
                      .query("moderationCases")
                      .withIndex("by_server_incident", (q) =>
                          q
                              .eq("serverId", serverId)
                              .eq("incident", "join-burst")
                              .gte("createdAt", now - settings.joinWindowSeconds * 1000),
                      )
                      .first()
                : null
        if (burstCase) return { duplicate: false, settings }
        const result = await reserveAction(ctx, {
            serverId,
            sourceId: `join:${userId}:${joinedAt}`,
            settings,
            input: {
                type: "log",
                targetId: userId,
                reason: watched ? "Watchlist member joined" : "Join burst detected",
            },
            context,
            origin: "security",
            incident: watched ? "watchlist" : "join-burst",
            now,
        })
        await ctx.db.patch(claim.row._id, { claimed: true })
        if (burst && settings.joinDefcon2 && settings.securityMode === "enforce" && settings.defcon === 3) {
            settings = { ...settings, defcon: 2 }
            await ctx.db.patch((await state(ctx, serverId))._id, { config: settings })
        }
        return { duplicate: false, settings, ...result }
    },
})
