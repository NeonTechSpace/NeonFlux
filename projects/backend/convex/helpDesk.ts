import { v } from "convex/values"
import { serviceMutation, serviceQuery } from "./installations.ts"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import type { HelpDeskAnswer, HelpDeskAnswersResult, HelpDeskGetResult, HelpDeskGuardResult, HelpDeskManageResult, HelpDeskOpenedResult, HelpDeskOperation, HelpDeskSettings, HelpDeskWorkResult } from "../contracts.js"
import type { ConfigurationIdentity } from "./configurationRevision.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { actor } from "./moderationDomain.ts"
import { shape } from "./publishingDomain.ts"
import { fail, integer, requireId, source } from "./validation.ts"
import { HELPDESK_ANSWER_LIMIT, HELPDESK_DEFAULT_GREETING, HELPDESK_DEFAULT_NUDGE_HOURS, HELPDESK_DEFAULT_TAG, HELPDESK_FORUM_LIMIT, HELPDESK_GUARD_INTERVAL_MS, HELPDESK_GUARD_SOON_MS,
    HELPDESK_GUARD_THRESHOLD, HELPDESK_NUDGES_PER_PASS, HELPDESK_WARN_INTERVAL_MS, helpDeskAnswerName, helpDeskNudgeDelay, helpDeskOperation } from "./helpDeskDomain.ts"

type Read = QueryCtx | MutationCtx
export const readHelpDesk = (ctx: Read, serverId: string) => ctx.db.query("helpDeskSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
export const readHelpDeskAnswers = (ctx: Read, serverId: string) => ctx.db.query("helpDeskAnswers").withIndex("by_name", q => q.eq("serverId", serverId)).take(HELPDESK_ANSWER_LIMIT)
const answerRow = (ctx: Read, serverId: string, name: string) => ctx.db.query("helpDeskAnswers").withIndex("by_name", q => q.eq("serverId", serverId).eq("name", name)).unique()
export const publicHelpDeskAnswer = (row: Doc<"helpDeskAnswers">): HelpDeskAnswer => ({ name: row.name, title: row.title, content: row.content, updatedAt: row.updatedAt })
/** The settings a server without a row has, so the first change starts from the defaults */
export function publicHelpDesk(row: Doc<"helpDeskSettings"> | null): HelpDeskSettings {
    return row ? { forumIds: row.forumIds, greeting: row.greeting, solvedTag: row.solvedTag, nudgeHours: row.nudgeHours, guardChannelId: row.guardChannelId, autoArchive: row.autoArchive, revision: row.revision }
        : { forumIds: [], greeting: HELPDESK_DEFAULT_GREETING, solvedTag: HELPDESK_DEFAULT_TAG, nudgeHours: HELPDESK_DEFAULT_NUDGE_HOURS, guardChannelId: null, autoArchive: false, revision: 0 }
}
const guarded = (settings: Pick<HelpDeskSettings, "guardChannelId" | "autoArchive">) => settings.guardChannelId !== null || settings.autoArchive

// The bot reads the settings once when a server starts and keeps them in memory, so new posts and messages cost no backend call
export const get = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<HelpDeskGetResult> => {
    const input = shape(request, ["serverId"], ["serverId"])
    return { settings: publicHelpDesk(await readHelpDesk(ctx, String(input.serverId))) }
} })

/** One saved answer by name, or the whole library */
export const answers = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<HelpDeskAnswersResult> => {
    const input = shape(request, ["serverId", "name"], ["serverId"]), serverId = String(input.serverId)
    if (input.name === undefined) return { answers: (await readHelpDeskAnswers(ctx, serverId)).map(publicHelpDeskAnswer) }
    const row = await answerRow(ctx, serverId, helpDeskAnswerName(input.name))
    return { answers: row ? [publicHelpDeskAnswer(row)] : [] }
} })

// Settings need the server manager. Answers need help desk staff, which the bot reads as the owner, Administrator, Manage Server or Manage Threads
export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<HelpDeskManageResult> => {
    const input = shape(request, ["serverId", "messageId", "createdAt", "actor", "authorized", "operation"], ["serverId", "messageId", "createdAt", "actor", "authorized", "operation"])
    const identity = source(input, Date.now()), who = actor(input.actor), op = helpDeskOperation(input.operation)
    const answer = op.type === "answer-set" || op.type === "answer-remove"
    if (!who.nativePermissionAuthorized || input.authorized !== "manager" && !(answer && input.authorized === "staff")) fail(403, answer ? "Help desk staff permission required" : "Manage Server permission required")
    return changeConfiguration(ctx, identity.serverId, "helpdesk", { kind: "chat", createdAt: identity.createdAt, actor: { userId: who.userId, source: "command" }, operation: op },
        () => applyHelpDeskManagement(ctx, { serverId: identity.serverId, actorId: who.userId, createdAt: identity.createdAt, source: { kind: "chat", messageId: identity.messageId } }, op))
} })

// Chat and dashboard share these rules
export async function applyHelpDeskManagement(ctx: MutationCtx, identity: ConfigurationIdentity, op: HelpDeskOperation): Promise<HelpDeskManageResult> {
    const serverId = identity.serverId, now = Date.now()
    if (op.type === "answer-set") {
        const row = await answerRow(ctx, serverId, op.name), fields = { title: op.title, content: op.content, updatedAt: now, updatedBy: identity.actorId }
        if (row) await ctx.db.patch(row._id, fields)
        else if ((await readHelpDeskAnswers(ctx, serverId)).length >= HELPDESK_ANSWER_LIMIT) fail(429, `A server can save at most ${HELPDESK_ANSWER_LIMIT} answers`)
        else await ctx.db.insert("helpDeskAnswers", { serverId, name: op.name, ...fields })
        return { type: "answer", answer: publicHelpDeskAnswer((await answerRow(ctx, serverId, op.name))!) }
    }
    if (op.type === "answer-remove") {
        const row = await answerRow(ctx, serverId, op.name)
        if (!row) fail(404, "No saved answer has this name")
        await ctx.db.delete(row._id)
        return { type: "answer-removed", name: op.name }
    }
    const row = await readHelpDesk(ctx, serverId), current = publicHelpDesk(row)
    let next: HelpDeskSettings
    if (op.type === "forum-add") {
        if (current.forumIds.includes(op.channelId)) fail(409, "This forum already uses the help desk")
        if (current.forumIds.length >= HELPDESK_FORUM_LIMIT) fail(429, `The help desk serves at most ${HELPDESK_FORUM_LIMIT} forums`)
        next = { ...current, forumIds: [...current.forumIds, op.channelId] }
    } else if (op.type === "forum-remove") {
        if (!current.forumIds.includes(op.channelId)) fail(404, "This forum does not use the help desk")
        next = { ...current, forumIds: current.forumIds.filter(id => id !== op.channelId) }
    } else {
        const { type: _type, ...patch } = op
        next = { ...current, ...patch }
    }
    const { revision: _revision, ...settings } = next
    // A guard that turns on runs its first pass at once, and one that turns off stops
    const guardDueAt = !guarded(settings) ? undefined : guarded(current) && row?.guardDueAt !== undefined ? row.guardDueAt : now
    const fields = { ...settings, guardDueAt, revision: current.revision + 1, updatedAt: now, updatedBy: identity.actorId }
    if (row) await ctx.db.patch(row._id, fields)
    else await ctx.db.insert("helpDeskSettings", { serverId, ...settings, ...(guardDueAt === undefined ? {} : { guardDueAt }), revision: 1, updatedAt: now, updatedBy: identity.actorId })
    return { type: "settings", settings: publicHelpDesk(await readHelpDesk(ctx, serverId)) }
}

/** A new post in a help desk forum. Its reply reminder becomes due after the configured wait, and a post is recorded once */
export const opened = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<HelpDeskOpenedResult> => {
    const input = shape(request, ["serverId", "threadId", "forumId"], ["serverId", "threadId", "forumId"])
    const serverId = requireId(input.serverId), threadId = requireId(input.threadId), forumId = requireId(input.forumId), settings = publicHelpDesk(await readHelpDesk(ctx, serverId))
    if (settings.nudgeHours === null || !settings.forumIds.includes(forumId)) return { recorded: false }
    if (await ctx.db.query("helpDeskPosts").withIndex("by_thread", q => q.eq("serverId", serverId).eq("threadId", threadId)).unique()) return { recorded: false }
    await ctx.db.insert("helpDeskPosts", { serverId, threadId, forumId, nudgeAt: Date.now() + helpDeskNudgeDelay(settings.nudgeHours) })
    return { recorded: true }
} })

// One work pass. Due reminders are claimed by deleting them, so each post gets at most one reminder even if sending fails.
// A due thread budget pass is claimed by moving its next time an hour ahead
export const work = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<HelpDeskWorkResult> => {
    const serverId = requireId(shape(request, ["serverId"], ["serverId"]).serverId), now = Date.now(), row = await readHelpDesk(ctx, serverId), settings = publicHelpDesk(row)
    const due = await ctx.db.query("helpDeskPosts").withIndex("by_server_due", q => q.eq("serverId", serverId).lte("nudgeAt", now)).take(HELPDESK_NUDGES_PER_PASS + 1)
    const claimed = due.slice(0, HELPDESK_NUDGES_PER_PASS)
    for (const post of claimed) await ctx.db.delete(post._id)
    // Reminders of forums that left the help desk, or after reminders were turned off, are dropped unsent
    const nudges = settings.nudgeHours === null ? [] : claimed.filter(post => settings.forumIds.includes(post.forumId)).map(post => ({ threadId: post.threadId, forumId: post.forumId }))
    let pass: HelpDeskWorkResult["guard"] = null
    if (row && row.guardDueAt !== undefined && row.guardDueAt <= now) {
        await ctx.db.patch(row._id, { guardDueAt: now + HELPDESK_GUARD_INTERVAL_MS })
        pass = { channelId: row.guardChannelId, autoArchive: row.autoArchive, threshold: HELPDESK_GUARD_THRESHOLD }
    }
    return { nudges, more: due.length > HELPDESK_NUDGES_PER_PASS, guard: pass }
} })

// The bot reports a pass that found the server near the thread cap or left auto-archive changes for later. Staff are warned
// at most once a day, and a pass with changes left runs again in ten minutes
export const guard = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<HelpDeskGuardResult> => {
    const input = shape(request, ["serverId", "activeThreads", "more"], ["serverId", "activeThreads", "more"])
    const row = await readHelpDesk(ctx, requireId(input.serverId)), count = integer(input.activeThreads, 0, 100000), now = Date.now()
    if (typeof input.more !== "boolean") fail(400, "Invalid thread budget report")
    if (!row || row.guardDueAt === undefined) return { warn: false }
    const warn = row.guardChannelId !== null && count >= HELPDESK_GUARD_THRESHOLD && (row.warnedAt === undefined || now - row.warnedAt >= HELPDESK_WARN_INTERVAL_MS)
    await ctx.db.patch(row._id, { ...(warn ? { warnedAt: now } : {}), ...(input.more ? { guardDueAt: Math.min(row.guardDueAt, now + HELPDESK_GUARD_SOON_MS) } : {}) })
    return { warn }
} })
