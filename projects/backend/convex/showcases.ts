import { v } from "convex/values"
import { internalMutation, mutation, query } from "./_generated/server.js"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { internal } from "./_generated/api.js"
import type { PublishingGrant } from "@neonflux/contracts/publishing-base"
import { ShowcaseCompleteRequest, ShowcaseFailRequest, ShowcaseListRequest, ShowcaseManageRequest, ShowcaseReadyRequest, ShowcaseSettingsRequest, ShowcaseStartRequest, type Showcase, type ShowcaseCompleteResult,
    type ShowcaseFailResult, type ShowcaseListResult, type ShowcaseMemberOperation, type ShowcaseOperation, type ShowcaseReadyResult, type ShowcaseSettings, type ShowcaseStartResult, type ShowcaseState } from "@neonflux/contracts/showcases"
import type { DashboardMemberQueueResult, DashboardShowcaseMember } from "../dashboard-contracts.js"
import { serviceMutation, serviceQuery } from "./installations.ts"
import { memberSession } from "./dashboard.ts"
import { configurationRevision } from "./configurationRevision.ts"
import { changeConfiguration } from "./configurationChange.ts"
import { accessAllowed, applyMemberAccess, readAccess } from "./memberAccess.ts"
import { expiredMemberRequest, finishMemberRequest, memberContentContext, memberRequestJob, publicMemberJob, queueMemberRequest, readyMemberRequests, recentMemberRequests, unavailableMemberRequest } from "./memberContent.ts"
import { memberGrant } from "./rolePickerStore.ts"
import { actor } from "./moderationDomain.ts"
import { config, readSettings } from "./moderationStore.ts"
import { blockingContentRule } from "./protection.ts"
import { age, publicAttempt, reservePublishing } from "./publishing.ts"
import { publisherSettings } from "./schedulesStore.ts"
import { renderShowcase, SHOWCASE_FAMILY, SHOWCASE_FEATURE, SHOWCASE_MEMBER_VIEW, showcaseMemberOperation, showcaseOperation, showcaseText } from "./showcasesDomain.ts"
import { decode, fail, source } from "./validation.ts"

type Read = Pick<QueryCtx, "db">
export const defaultShowcaseSettings = (): ShowcaseSettings => ({ enabled: false, channelId: null, maxPerMember: null, intervalMinutes: null })
const settingsRow = (ctx: Read, serverId: string) => ctx.db.query("showcaseSettings").withIndex("by_server", q => q.eq("serverId", serverId)).unique()
export async function readShowcaseSettings(ctx: Read, serverId: string): Promise<ShowcaseSettings> {
    const row = await settingsRow(ctx, serverId)
    return row ? { enabled: row.enabled, channelId: row.channelId, maxPerMember: row.maxPerMember, intervalMinutes: row.intervalMinutes } : defaultShowcaseSettings()
}
const showcaseRow = (ctx: Read, serverId: string, showcaseNo: number) => ctx.db.query("showcases").withIndex("by_number", q => q.eq("serverId", serverId).eq("showcaseNo", showcaseNo)).unique()
const postRow = (ctx: Read, serverId: string, postNo: number) => ctx.db.query("publishingPosts").withIndex("by_server_post", q => q.eq("serverId", serverId).eq("postNo", postNo)).unique()

// A showcase's status follows its latest publishing attempt, so a staff reconcile or resolve shows here at once
export async function publicShowcase(ctx: Read, row: Doc<"showcases">): Promise<Showcase> {
    const attempt = await ctx.db.get(row.attemptId), post = await postRow(ctx, row.serverId, row.postNo)
    return { showcaseNo: row.showcaseNo, authorId: row.authorId, title: row.title, text: row.text, links: row.links, channelId: row.channelId, postNo: row.postNo,
        ...(post?.messageId ? { messageId: post.messageId } : {}), status: attempt?.outcome === "pending" ? "posting" : attempt?.unresolved ? "unconfirmed" : post?.messageId ? "posted" : "failed",
        createdAt: row.createdAt, updatedAt: row.updatedAt }
}
async function showcaseState(ctx: Read, serverId: string): Promise<ShowcaseState> {
    return { revision: await configurationRevision(ctx as QueryCtx, serverId, "showcase"), settings: await readShowcaseSettings(ctx, serverId), access: await readAccess(ctx, serverId, SHOWCASE_FEATURE) }
}
// Chat commands and dashboard saves share these rules
export async function applyShowcaseConfiguration(ctx: MutationCtx, serverId: string, op: ShowcaseOperation): Promise<ShowcaseState> {
    if (op.type !== "settings") await applyMemberAccess(ctx, serverId, SHOWCASE_FEATURE, op)
    else {
        const row = await settingsRow(ctx, serverId), { type, ...patch } = op
        if (row) await ctx.db.patch(row._id, patch)
        else await ctx.db.insert("showcaseSettings", { serverId, ...defaultShowcaseSettings(), ...patch, nextShowcaseNo: 1 })
    }
    return showcaseState(ctx, serverId)
}
/** A tracked post of a showcase changes only through its author's requests */
export async function protectedShowcasePost(ctx: Read, serverId: string, postNo: number) {
    if (await ctx.db.query("showcases").withIndex("by_post", q => q.eq("serverId", serverId).eq("postNo", postNo)).first()) fail(409, "Published post retained by a showcase")
}
/** A deleted showcase forgets its tracked post, so its text leaves publishing records once their retention ends */
export async function removeShowcase(ctx: MutationCtx, row: Doc<"showcases">) {
    const post = await postRow(ctx, row.serverId, row.postNo)
    await ctx.db.delete(row._id)
    if (post) await ctx.db.delete(post._id)
}

export const manage = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ShowcaseState> => {
    const input = decode(ShowcaseManageRequest, request)
    const identity = source(input, Date.now()), who = actor(input.actor), op = showcaseOperation(input.operation)
    if (!who.nativePermissionAuthorized) fail(403, "Manage Server permission required")
    return changeConfiguration(ctx, identity.serverId, "showcase", { kind: "chat", createdAt: identity.createdAt, actor: { userId: who.userId, source: "command" }, operation: op },
        () => applyShowcaseConfiguration(ctx, identity.serverId, op))
} })
export const settings = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ShowcaseState> => {
    return showcaseState(ctx, decode(ShowcaseSettingsRequest, request).serverId)
} })
/** The ten newest showcases of the server or of one member, for !showcase list */
export const list = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ShowcaseListResult> => {
    const { serverId, authorId } = decode(ShowcaseListRequest, request)
    const rows = authorId === undefined ? await ctx.db.query("showcases").withIndex("by_number", q => q.eq("serverId", serverId)).order("desc").take(11)
        : await ctx.db.query("showcases").withIndex("by_author", q => q.eq("serverId", serverId).eq("authorId", authorId)).order("desc").take(11)
    return { showcases: await Promise.all(rows.slice(0, 10).map(row => publicShowcase(ctx, row))), more: rows.length > 10 }
} })

// Website member requests. Each one rechecks the session, the installation and that showcases are on
export const request = mutation({ args: { sessionToken: v.string(), serverId: v.string(), requestId: v.string(), operation: v.any() }, handler: async (ctx, input): Promise<DashboardMemberQueueResult> => {
    const session = await memberSession(ctx, input.sessionToken, input.serverId, "showcase"), operation = showcaseMemberOperation(input.operation)
    if (operation.type !== "create") {
        const row = await showcaseRow(ctx, input.serverId, operation.showcaseNo)
        if (!row || row.authorId !== session.userId) fail(404, "Showcase not found")
    }
    // The expiry runs after the post's dispatch window and its native deadline closed, so a post in flight settles first
    return queueMemberRequest(ctx, session, { serverId: input.serverId, requestId: input.requestId, family: SHOWCASE_FAMILY, operation }, internal.showcases.expireRequest, 10000)
} })
export const member = query({ args: { sessionToken: v.string(), serverId: v.string() }, handler: async (ctx, { sessionToken, serverId }): Promise<DashboardShowcaseMember> => {
    const session = await memberSession(ctx, sessionToken, serverId, "showcase")
    const rows = await ctx.db.query("showcases").withIndex("by_author", q => q.eq("serverId", serverId).eq("authorId", session.userId)).order("desc").take(SHOWCASE_MEMBER_VIEW)
    return { serverId, settings: await readShowcaseSettings(ctx, serverId), showcases: await Promise.all(rows.map(row => publicShowcase(ctx, row))),
        requests: (await recentMemberRequests(ctx, serverId, SHOWCASE_FAMILY, session.userId)).map(publicMemberJob<ShowcaseMemberOperation>) }
} })

const unconfirmed = (postNo: number) => `Fluxer did not confirm the last post of this showcase, and it is never sent again automatically. Ask staff to check it with !publish reconcile ${postNo}`
// Settles a send or edit from its publishing attempt. A pending attempt waits for its outcome or the expiry
async function settleShowcase(ctx: MutationCtx, job: Doc<"dashboardConfigurationJobs">, fix?: string) {
    let attempt = (await ctx.db.get(job.attemptId!))!
    if (attempt.outcome === "pending") { await age(ctx, attempt, Date.now()); attempt = (await ctx.db.get(attempt._id))! }
    if (attempt.outcome === "pending") return
    const op = job.operation as Exclude<ShowcaseMemberOperation, { type: "delete" }>, provenance = attempt.provenance as { showcaseNo: number }
    const row = await showcaseRow(ctx, job.serverId, provenance.showcaseNo)
    // An edit that may have reached Fluxer keeps the new content, which is most likely what the message shows
    if (row && op.type === "edit" && attempt.outcome !== "failed") await ctx.db.patch(row._id, { title: op.title, text: op.text, links: op.links, updatedAt: Date.now() })
    if (row && op.type === "create" && attempt.outcome === "failed") await removeShowcase(ctx, row)
    await finishMemberRequest(ctx, job, attempt.outcome === "sent" ? undefined : attempt.outcome === "uncertain" ? unconfirmed(attempt.postNo)
        : `The showcase could not be ${op.type === "create" ? "posted" : "updated"}. ${fix ?? "Ask a server manager to check that NeonFlux can send messages and embed links in the showcase channel"}`)
}
export const expireRequest = internalMutation({ args: { id: v.id("dashboardConfigurationJobs") }, handler: async (ctx, { id }) => {
    const job = await ctx.db.get(id)
    if (job?.family !== SHOWCASE_FAMILY || job.state !== "queued") return
    if (job.attemptId) await settleShowcase(ctx, job)
    else await finishMemberRequest(ctx, job, expiredMemberRequest)
} })

// Bot routes. The bot reads the member fresh, then the backend decides with the current settings, access lists, limits and automod rules
export const ready = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ShowcaseReadyResult> => {
    const { serverId } = decode(ShowcaseReadyRequest, request)
    return { jobs: (await readyMemberRequests(ctx, serverId, SHOWCASE_FAMILY)).map(publicMemberJob<ShowcaseMemberOperation>) }
} })
const grantOf = (attempt: Doc<"publishingAttempts">) => { const { outcome, createdAt, finishedAt, noDispatch, dispatchedAt, observation, resolution, ...grant } = publicAttempt(attempt); return grant as PublishingGrant }
export const start = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ShowcaseStartResult> => {
    const input = decode(ShowcaseStartRequest, request), serverId = input.serverId, now = Date.now()
    const job = await memberRequestJob(ctx, serverId, SHOWCASE_FAMILY, input.jobId, input.actorId), member = memberContentContext(input.member)
    const done = async (): Promise<ShowcaseStartResult> => ({ job: publicMemberJob((await ctx.db.get(job._id))!) })
    const finish = async (error?: string) => { await finishMemberRequest(ctx, job, error); return done() }
    if (job.state !== "queued") return done()
    if (member.userId !== job.actorId || member.isBot) fail(403, "Member request grant mismatch")
    // A reserved post continues with its grant until the bot claims it, which happens once, and otherwise waits for its outcome
    if (job.attemptId) {
        const attempt = (await ctx.db.get(job.attemptId))!
        if (attempt.outcome === "pending" && attempt.dispatchedAt === undefined && now < attempt.dispatchExpiresAt) return { ...await done(), grant: grantOf(attempt) }
        await settleShowcase(ctx, job)
        return done()
    }
    if (!await memberGrant(ctx, job, now)) return finish("Your sign-in expired before the bot could act. Sign in again and retry")
    const op = job.operation as ShowcaseMemberOperation, settings = await readShowcaseSettings(ctx, serverId)
    const row = op.type === "create" ? null : await showcaseRow(ctx, serverId, op.showcaseNo)
    if (op.type !== "create") {
        if (!row || row.authorId !== member.userId) return finish("That showcase was not found")
        const attempt = (await ctx.db.get(row.attemptId))!
        if (attempt.outcome === "pending") return finish("This showcase is still being posted. Try again in a minute")
        if (attempt.unresolved) return finish(unconfirmed(row.postNo))
    }
    // Members can always delete their own showcase and its message. A showcase whose send staff recorded as failed has no message
    const messageId = row ? (await postRow(ctx, serverId, row.postNo))?.messageId : undefined
    if (op.type === "delete") {
        if (messageId) return { ...await done(), remove: { channelId: row!.channelId, messageId } }
        await removeShowcase(ctx, row!)
        return finish()
    }
    if (row && !messageId) return finish("This showcase has no message to change. Delete it and post it again")
    if (!settings.enabled) return finish("Showcases are turned off in this server")
    if (config(await readSettings(ctx, serverId)).defcon !== 3) return finish("The server is in lockdown, so showcases are paused")
    if ((await publisherSettings(ctx, serverId))?.enabled === false) return finish("Publishing is turned off in this server, so showcases cannot be posted")
    if (!accessAllowed(await readAccess(ctx, serverId, SHOWCASE_FEATURE), member)) return finish("You cannot post showcases in this server")
    if (member.timeoutUntil !== null && Date.parse(member.timeoutUntil) > now) return finish("You cannot post showcases while you are timed out")
    const channelId = row?.channelId ?? settings.channelId
    if (!channelId) return finish("No showcase channel is set yet. Ask a server manager to choose one")
    const content = { title: op.title, text: op.text, links: op.links }
    const rule = await blockingContentRule(ctx, serverId, showcaseText(content), member.roleIds, channelId)
    if (rule) return finish(`The server's automod rule ${rule} blocked this showcase. Change the text or links and try again`)
    const reservation = { serverId, actorId: member.botId, botId: member.botId, channelId, sourceId: `showcase_${job._id}`, source: { type: "showcase" as const, jobId: job._id, createdAt: job.createdAt },
        content: renderShowcase(content, member.userName), expiresAt: job.expiresAt }
    let attemptId: string
    if (row) {
        const post = (await postRow(ctx, serverId, row.postNo))!
        if (post.botId !== member.botId) return finish("This showcase was posted by another NeonFlux bot account, so it cannot be changed now")
        attemptId = (await reservePublishing(ctx, { ...reservation, provenance: { type: "showcase", showcaseNo: row.showcaseNo }, existing: post })).grant.attemptId
        await ctx.db.patch(row._id, { attemptId: ctx.db.normalizeId("publishingAttempts", attemptId)! })
    } else {
        const own = await ctx.db.query("showcases").withIndex("by_author", q => q.eq("serverId", serverId).eq("authorId", member.userId)).order("desc").take(settings.maxPerMember ?? 1)
        if (settings.maxPerMember !== null && own.length >= settings.maxPerMember) return finish(`You have ${settings.maxPerMember} showcases, the most this server allows. Delete one first`)
        const wait = own[0] && settings.intervalMinutes !== null ? own[0].createdAt + settings.intervalMinutes * 60000 - now : 0
        if (wait > 0) return finish(`This server allows one showcase every ${settings.intervalMinutes} minutes. Try again in ${Math.ceil(wait / 60000)} minutes`)
        const counter = (await settingsRow(ctx, serverId))!, showcaseNo = counter.nextShowcaseNo
        await ctx.db.patch(counter._id, { nextShowcaseNo: showcaseNo + 1 })
        const reserved = await reservePublishing(ctx, { ...reservation, provenance: { type: "showcase", showcaseNo } })
        attemptId = reserved.grant.attemptId
        await ctx.db.insert("showcases", { serverId, showcaseNo, authorId: member.userId, ...content, channelId, postNo: reserved.post.postNo,
            attemptId: ctx.db.normalizeId("publishingAttempts", attemptId)!, createdAt: now, updatedAt: now })
    }
    const attempt = ctx.db.normalizeId("publishingAttempts", attemptId)!
    await ctx.db.patch(job._id, { attemptId: attempt })
    return { ...await done(), grant: grantOf((await ctx.db.get(attempt))!) }
} })
export const complete = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ShowcaseCompleteResult> => {
    const { serverId, jobId, removed, fix } = decode(ShowcaseCompleteRequest, request)
    const job = await memberRequestJob(ctx, serverId, SHOWCASE_FAMILY, jobId)
    const op = job.operation as ShowcaseMemberOperation
    if (op.type !== "delete") { if (job.state === "queued" && job.attemptId) await settleShowcase(ctx, job, fix) }
    // A deleted message removes its showcase even when the request expired meanwhile
    else if (removed === true) {
        const row = await showcaseRow(ctx, serverId, op.showcaseNo)
        if (row?.authorId === job.actorId) await removeShowcase(ctx, row)
        if (job.state === "queued") await finishMemberRequest(ctx, job)
    } else if (job.state === "queued") await finishMemberRequest(ctx, job, `The showcase message could not be deleted. ${fix ?? "Try again shortly"}`)
    return { job: publicMemberJob((await ctx.db.get(job._id))!) }
} })
export const failRequest = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<ShowcaseFailResult> => {
    const input = decode(ShowcaseFailRequest, request), job = await memberRequestJob(ctx, input.serverId, SHOWCASE_FAMILY, input.jobId)
    // A request with a reserved post settles from its attempt instead, so a post in flight is never reported as failed
    if (job.state === "queued" && !job.attemptId) await finishMemberRequest(ctx, job, unavailableMemberRequest)
    return null
} })

/** Dispatch rechecks that the request is still open, its sign-in grant holds and showcases are on before the bot sends or edits */
export async function showcasePublishingFence(ctx: MutationCtx, attempt: Doc<"publishingAttempts">) {
    const id = attempt.source?.type === "showcase" ? ctx.db.normalizeId("dashboardConfigurationJobs", attempt.source.jobId) : null, job = id ? await ctx.db.get(id) : null
    if (!job || job.family !== SHOWCASE_FAMILY || job.serverId !== attempt.serverId || job.state !== "queued" || job.attemptId !== attempt._id || !await memberGrant(ctx, job)) fail(403, "Showcase request expired")
    if (!(await readShowcaseSettings(ctx, attempt.serverId)).enabled) fail(403, "Showcases are off")
}
