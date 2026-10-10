import type { FunctionReference } from "convex/server"
import type { MemberContentContext, MemberRequestJob } from "../contracts.js"
import type { Doc, Id } from "./_generated/dataModel.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import { internal } from "./_generated/api.js"
import { epoch } from "./rolesDomain.ts"
import { shape } from "./publishingDomain.ts"
import { bool, fail, ids, requireId } from "./validation.ts"
import { ringWork } from "./workSignal.ts"

// Website requests of showcases and profiles. They share the dashboard job table under their own families, and the bot
// handles them with a fresh read of the member, as role picker requests do
export type MemberContentFamily = "member-showcase" | "member-profile"
export const MEMBER_REQUEST_MS = 120000
// Request records follow the dashboard job retention of one day
export const MEMBER_REQUEST_RETENTION_MS = 86400000
export const MEMBER_REQUEST_RATE = 5, MEMBER_REQUEST_PENDING = 2, MEMBER_REQUEST_QUEUE = 50
export const MEMBER_LINKS = 3, MEMBER_LINK_LENGTH = 500

// Control and text direction characters, which could hide or reorder text in a post
const hidden = (code: number, multiline: boolean) => code < 32 && !(multiline && code === 10) || code === 127 || code >= 0x202a && code <= 0x202e || code >= 0x2066 && code <= 0x2069 || code === 0xfeff
export function memberText(value: unknown, maximum: number, label: string, options: { multiline?: boolean, empty?: boolean } = {}): string {
    if (typeof value !== "string") fail(400, `${label} must be text`)
    const text = value.replace(/\r\n/g, "\n").trim()
    if (!options.empty && !text.length || text.length > maximum || [...text].some(char => hidden(char.codePointAt(0)!, options.multiline === true)))
        fail(400, `${label} needs ${options.empty ? "up to" : "1 to"} ${maximum} characters${options.multiline ? "" : " on one line"}`)
    return text
}
export function memberLinks(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > MEMBER_LINKS) fail(400, `Add up to ${MEMBER_LINKS} links`)
    const links = value.map(link => {
        if (typeof link !== "string" || link.length > MEMBER_LINK_LENGTH) fail(400, `Links have up to ${MEMBER_LINK_LENGTH} characters`)
        let url: URL
        try { url = new URL(link) } catch { fail(400, "Links must be full web addresses") }
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || link !== link.trim()) fail(400, "Links must be full web addresses")
        // The normalized form, so characters such as < are encoded and a link never renders as a mention
        if (url.href.length > MEMBER_LINK_LENGTH) fail(400, `Links have up to ${MEMBER_LINK_LENGTH} characters`)
        return url.href
    })
    if (new Set(links).size !== links.length) fail(400, "Each link can appear once")
    return links
}
/** Member text in a bot post never mentions anyone: The bot sends no mentions, and mention syntax is broken up so it does not render as one either */
export const neutralMentions = (text: string) => text.replace(/<([@#])/g, "<​$1").replace(/@(everyone|here)/gi, "@​$1")

export function memberContentContext(value: unknown): MemberContentContext {
    const input = shape(value, ["userId", "userName", "roleIds", "isBot", "timeoutUntil", "botId"], ["userId", "userName", "roleIds", "isBot", "timeoutUntil", "botId"])
    if (typeof input.userName !== "string" || !input.userName.trim() || input.userName.length > 100) fail(400, "Invalid member name")
    return { userId: requireId(input.userId), userName: input.userName, roleIds: ids(input.roleIds, 1000), isBot: bool(input.isBot), timeoutUntil: input.timeoutUntil === null ? null : epoch(input.timeoutUntil), botId: requireId(input.botId) }
}

export function publicMemberJob<O>(row: Doc<"dashboardConfigurationJobs">): MemberRequestJob<O> {
    return { id: row._id, actorId: row.actorId, operation: row.operation as O, state: row.state === "queued" || row.state === "applied" ? row.state : "failed",
        createdAt: row.createdAt, expiresAt: row.expiresAt, ...(row.error ? { error: row.error } : {}) }
}
export async function memberRequestJob(ctx: Pick<QueryCtx, "db">, serverId: string, family: MemberContentFamily, jobId: unknown, actorId?: unknown) {
    const id = typeof jobId === "string" ? ctx.db.normalizeId("dashboardConfigurationJobs", jobId) : null, job = id ? await ctx.db.get(id) : null
    if (!job || job.family !== family || job.serverId !== serverId || actorId !== undefined && job.actorId !== actorId) fail(403, "Member request grant mismatch")
    return job
}
/** Up to four queued requests the bot can still act on, oldest first */
export async function readyMemberRequests(ctx: Pick<QueryCtx, "db">, serverId: string, family: MemberContentFamily) {
    const rows = await ctx.db.query("dashboardConfigurationJobs").withIndex("by_family_work", q => q.eq("serverId", serverId).eq("family", family).eq("state", "queued")).take(8)
    return rows.filter(row => row.expiresAt > Date.now()).slice(0, 4)
}
/** The member's recent requests, newest first */
export const recentMemberRequests = (ctx: Pick<QueryCtx, "db">, serverId: string, family: MemberContentFamily, userId: string) =>
    ctx.db.query("dashboardConfigurationJobs").withIndex("by_family_actor", q => q.eq("serverId", serverId).eq("family", family).eq("actorId", userId)).order("desc").take(10)

// Per member, five requests a minute with two pending at once. Per server and feature, a bounded queue
export async function queueMemberRequest(ctx: MutationCtx, session: Doc<"dashboardSessions">, input: { serverId: string, requestId: string, family: MemberContentFamily, operation: unknown },
    expire: FunctionReference<"mutation", "internal", { id: Id<"dashboardConfigurationJobs"> }>, expireDelayMs = 0): Promise<{ jobId: string }> {
    const { serverId, family, operation } = input, now = Date.now()
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.requestId)) fail(400, "Invalid request")
    const existing = await ctx.db.query("dashboardConfigurationJobs").withIndex("by_request", q => q.eq("sessionId", session._id).eq("serverId", serverId).eq("requestId", input.requestId)).unique()
    if (existing) {
        if (existing.family !== family || JSON.stringify(existing.operation) !== JSON.stringify(operation)) fail(409, "Request already used")
        return { jobId: existing._id }
    }
    const recent = await ctx.db.query("dashboardConfigurationJobs").withIndex("by_family_actor", q => q.eq("serverId", serverId).eq("family", family).eq("actorId", session.userId).gt("createdAt", now - 60000)).take(MEMBER_REQUEST_RATE + 1)
    if (recent.length >= MEMBER_REQUEST_RATE) fail(429, "Too many requests. Wait a minute and try again")
    if (recent.filter(row => row.state === "queued" && row.expiresAt > now).length >= MEMBER_REQUEST_PENDING) fail(429, "Wait for your earlier requests to finish")
    const queued = await ctx.db.query("dashboardConfigurationJobs").withIndex("by_family_work", q => q.eq("serverId", serverId).eq("family", family).eq("state", "queued")).take(MEMBER_REQUEST_QUEUE)
    if (queued.length >= MEMBER_REQUEST_QUEUE) fail(429, "The bot is busy. Try again in a minute")
    const expiresAt = Math.min(now + MEMBER_REQUEST_MS, session.expiresAt, session.lifetimeAt), cleanupAt = now + MEMBER_REQUEST_RETENTION_MS
    const id = await ctx.db.insert("dashboardConfigurationJobs", { serverId, family, actorId: session.userId, sessionId: session._id, requestId: input.requestId, expectedConfigRevision: 0, operation, state: "queued", createdAt: now, expiresAt, cleanupAt })
    await ctx.scheduler.runAt(expiresAt + expireDelayMs, expire, { id })
    await ctx.scheduler.runAt(cleanupAt, internal.dashboardConfiguration.cleanup, { id })
    await ringWork(ctx)
    return { jobId: id }
}
/** Removes a member's queued requests of one family in a server and returns how many. The queue holds at most MEMBER_REQUEST_QUEUE */
export async function cancelMemberRequests(ctx: MutationCtx, serverId: string, family: MemberContentFamily, userId: string) {
    const queued = await ctx.db.query("dashboardConfigurationJobs").withIndex("by_family_work", q => q.eq("serverId", serverId).eq("family", family).eq("state", "queued")).take(MEMBER_REQUEST_QUEUE)
    const own = queued.filter(job => job.actorId === userId)
    for (const job of own) await ctx.db.delete(job._id)
    return own.length
}
export async function finishMemberRequest(ctx: MutationCtx, job: Doc<"dashboardConfigurationJobs">, error?: string) {
    await ctx.db.patch(job._id, error ? { state: "failed", error } : { state: "applied" })
}
export const expiredMemberRequest = "The bot did not handle this request in time. Try again"
export const unavailableMemberRequest = "The bot could not read your membership or finish the request. Try again shortly"
