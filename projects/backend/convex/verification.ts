import { v } from "convex/values"
import { action, internalMutation, internalQuery } from "./_generated/server.js"
import { requireInstalled, serviceMutation, serviceQuery } from "./installations.ts"
import type { MutationCtx, QueryCtx } from "./_generated/server.js"
import type { Doc } from "./_generated/dataModel.js"
import { internal } from "./_generated/api.js"
import type { VerificationView } from "../verification-contracts.js"
import { VerificationClaimRequest, VerificationDeliveryRequest, VerificationIssueRequest, VerificationReadyRequest, VerificationRequestRequest, VerificationReviewRequest, type VerificationClaimResult,
    type VerificationDeliveryResult, type VerificationIssueResult, type VerificationReady, type VerificationReadyResult, type VerificationReviewResult } from "@neonflux/contracts/verification"
import { verifiedDashboardIdentity } from "./dashboard.ts"
import { verificationHash, VERIFICATION_ATTEMPTS, VERIFICATION_ISSUE_COOLDOWN, VERIFICATION_LINK_TTL, VERIFICATION_SOLVE_TTL } from "./captchaDomain.ts"
import { createMotionCaptcha, motionAnswer, motionRound, MOTION_CAPTCHA_INSTRUCTION } from "./motionCaptcha.ts"
import { memberContext, rolesSource } from "./rolesDomain.ts"
import { rolePanel, rolesAdmin } from "./rolesStore.ts"
import { participationAvailability, rolePolicy } from "./roleClaims.ts"
import { decode, fail, requireServer } from "./validation.ts"
import { ringWork } from "./workSignal.ts"
import { verifyTurnstileToken } from "./turnstile.ts"

type Read = MutationCtx | QueryCtx
const clearedCaptcha = { motionSeed: undefined, pathAnswers: undefined, pathSelections: undefined, pathRound: undefined }
async function rowById(ctx: Read, challengeId: string) {
    const id = ctx.db.normalizeId("verificationLinks", challengeId), row = id ? await ctx.db.get(id) : null
    if (!row) fail(404, "Verification request not found")
    return row
}
async function current(ctx: Read, row: Doc<"verificationLinks">) {
    // Public verification actions reach this without a bot request, so it checks the installation itself
    await requireInstalled(ctx, row.serverId)
    const policy = await rolePolicy(ctx, row.serverId), panel = await rolePanel(ctx, row.serverId, row.panelName)
    // Links bind to their panel revision and publication, so unrelated role settings and panel edits leave them valid
    if (!policy.settings.verificationEnabled || !policy.settings.advancedVerificationEnabled || policy.defcon !== 3 || panel.kind !== "verification" || !panel.enabled || panel.withdrawing || panel.revision !== row.rulesRevision || panel.published?.revision !== row.rulesRevision || panel.published.messageId !== row.publishedMessageId) fail(403, "Advanced verification unavailable or rules changed")
    return panel
}
// Motion rows store only a private seed. The current round is regenerated for each view.
function challenge(row: Doc<"verificationLinks">): { imageDataUri?: string, motionFrames?: string } {
    if (!row.motionSeed) return {}
    const { imageDataUri, motionFrames } = motionRound(row.motionSeed, row.pathRound ?? 0)
    return { imageDataUri, motionFrames }
}
function view(row: Doc<"verificationLinks">): VerificationView {
    const expired = row.status === "issued" && Date.now() >= row.linkExpiresAt || row.status === "started" && Date.now() >= (row.solveExpiresAt ?? 0)
    return { challengeId: row._id, serverId: row.serverId, panelName: row.panelName, status: expired ? "expired" : row.status,
        linkExpiresAt: row.linkExpiresAt, expiresAt: row.solveExpiresAt ?? row.linkExpiresAt,
        attemptsRemaining: Math.max(0, VERIFICATION_ATTEMPTS - row.attempts), instruction: MOTION_CAPTCHA_INSTRUCTION, captchaKind: "motion", round: row.pathRound ?? 0, roundCount: 2,
        ...(row.status === "started" && !expired ? challenge(row) : {}), ...(row.deliveryOutcome ? { deliveryOutcome: row.deliveryOutcome } : {}) }
}
const identityArgs = { userId: v.string(), sessionId: v.string() }
async function owned(ctx: Read, userId: string, sessionId: string, challengeId?: string, linkHash?: string) {
    const identity = ctx.db.normalizeId("dashboardSessions", sessionId), session = identity ? await ctx.db.get(identity) : null
    if (!session || session.userId !== userId || session.expiresAt <= Date.now() || session.lifetimeAt <= Date.now()) fail(401, "Sign in again")
    const row = challengeId ? await rowById(ctx, challengeId) : await ctx.db.query("verificationLinks").withIndex("by_hash", q => q.eq("linkHash", linkHash!)).unique()
    if (!row || row.userId !== userId || row.sessionId !== undefined && row.sessionId !== sessionId) fail(403, "Verification request belongs to another account or session")
    await current(ctx, row)
    return row
}
export const inspectPrivate = internalQuery({ args: { ...identityArgs, linkHash: v.string() }, handler: async (ctx, args): Promise<VerificationView> => view(await owned(ctx, args.userId, args.sessionId, undefined, args.linkHash)) })
export const startPrivate = internalMutation({ args: { ...identityArgs, linkHash: v.string() }, handler: async (ctx, args): Promise<VerificationView> => {
    let row = await owned(ctx, args.userId, args.sessionId, undefined, args.linkHash)
    if (row.status !== "issued") return view(row)
    const now = Date.now()
    if (now >= row.linkExpiresAt) { await ctx.db.patch(row._id, { status: "expired" }); return view({ ...row, status: "expired" }) }
    const captcha = createMotionCaptcha()
    await ctx.db.patch(row._id, { status: "started", sessionId: args.sessionId, startedAt: now, solveExpiresAt: now + VERIFICATION_SOLVE_TTL, ...captcha })
    row = (await ctx.db.get(row._id))!
    return view(row)
} })
export const answerPrivate = internalMutation({ args: { ...identityArgs, challengeId: v.string(), selected: v.array(v.number()), round: v.optional(v.number()) }, handler: async (ctx, args): Promise<VerificationView> => {
    const row = await owned(ctx, args.userId, args.sessionId, args.challengeId)
    const result = motionAnswer(row, args.selected, args.round, Date.now())
    await ctx.db.patch(row._id, { ...result, ...(result.status === "solved" ? { solvedAt: Date.now() } : {}), ...(result.status !== "started" ? clearedCaptcha : {}) })
    // A solved proof waits for the bot to grant the verification role
    if (result.status === "solved") await ringWork(ctx)
    return view((await ctx.db.get(row._id))!)
} })
export const inspect = action({ args: { sessionToken: v.string(), linkToken: v.string() }, handler: async (ctx, args): Promise<VerificationView> => {
    const identity = await verifiedDashboardIdentity(ctx, args.sessionToken)
    return ctx.runQuery(internal.verification.inspectPrivate, { ...identity, linkHash: await verificationHash(args.linkToken) })
} })
export const start = action({ args: { sessionToken: v.string(), linkToken: v.string(), turnstileToken: v.string() }, handler: async (ctx, args): Promise<VerificationView> => {
    const identity = await verifiedDashboardIdentity(ctx, args.sessionToken)
    const binding = { ...identity, linkHash: await verificationHash(args.linkToken) }
    const existing = await ctx.runQuery(internal.verification.inspectPrivate, binding)
    if (existing.status === "expired") return existing
    await verifyTurnstileToken(args.turnstileToken)
    return ctx.runMutation(internal.verification.startPrivate, binding)
} })
export const answer = action({ args: { sessionToken: v.string(), challengeId: v.string(), selected: v.array(v.number()), round: v.optional(v.number()) }, handler: async (ctx, args): Promise<VerificationView> => {
    const identity = await verifiedDashboardIdentity(ctx, args.sessionToken)
    return ctx.runMutation(internal.verification.answerPrivate, { ...identity, challengeId: args.challengeId, selected: args.selected, ...(args.round !== undefined ? { round: args.round } : {}) })
} })

export const issue = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<VerificationIssueResult> => {
    const input = decode(VerificationIssueRequest, request)
    const now = Date.now(), source = rolesSource(input, now), member = memberContext(input.context), policy = await rolePolicy(ctx, source.serverId), panel = await rolePanel(ctx, source.serverId, input.panelName, input.revision)
    await participationAvailability(ctx, source.serverId, member)
    if (member.isBot || !policy.settings.verificationEnabled || !policy.settings.advancedVerificationEnabled || policy.defcon !== 3 || panel.kind !== "verification" || !panel.enabled || panel.withdrawing || panel.published?.revision !== panel.revision || panel.published.messageId !== input.messageId) fail(403, "Current advanced verification reaction required")
    const previous = await ctx.db.query("verificationLinks").withIndex("by_member", q => q.eq("serverId", source.serverId).eq("userId", member.userId)).order("desc").take(32)
    if (previous.some(row => row.createdAt > now - VERIFICATION_ISSUE_COOLDOWN || row.joinedAt === member.joinedAt && row.rulesRevision === panel.revision
        && (row.status === "started" && (row.solveExpiresAt ?? 0) > now || (row.status === "solved" || row.status === "redeemed") && row.deliveryOutcome !== "failed"))) return { issued: false }
    if (previous.length >= 32 || previous.filter(row => row.createdAt > now - 3600000).length >= 5) fail(429, "Verification request limit reached. Contact server staff for assistance")
    // A cheap server-wide bound: at most 500 links per hour, read through the creation index
    if ((await ctx.db.query("verificationLinks").withIndex("by_server", q => q.eq("serverId", source.serverId).gt("createdAt", now - 3600000)).take(500)).length >= 500) fail(429, "Verification capacity reached")
    for (const row of previous) if (row.status === "issued" || row.status === "started") await ctx.db.patch(row._id, { status: "expired", ...clearedCaptcha })
    const linkHash = await verificationHash(input.linkToken), linkExpiresAt = now + VERIFICATION_LINK_TTL
    if (await ctx.db.query("verificationLinks").withIndex("by_hash", q => q.eq("linkHash", linkHash)).unique()) fail(409, "Verification link collision")
    const id = await ctx.db.insert("verificationLinks", { serverId: source.serverId, userId: member.userId, joinedAt: member.joinedAt, panelName: panel.name, rulesRevision: panel.revision, publishedMessageId: panel.published.messageId, linkHash, sourceId: source.sourceId, createdAt: now, lastIssuedAt: now, linkExpiresAt, expiresAt: now + 86400000, status: "issued", attempts: 0 })
    await ctx.db.patch(id, { sourceId: `verify_${id}` })
    await ctx.scheduler.runAt(now + 86400000, internal.verification.expire, { challengeId: id })
    return { issued: true, challengeId: id, expiresAt: linkExpiresAt }
} })
export const ready = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<VerificationReadyResult> => {
    const { serverId } = decode(VerificationReadyRequest, request); requireServer(serverId)
    const policy = await rolePolicy(ctx, serverId)
    if (!policy.settings.verificationEnabled || !policy.settings.advancedVerificationEnabled || policy.defcon !== 3) return { requests: [] }
    // Redeemed proofs stay discoverable until the bot confirms the role or settles a departed member, so a restart between
    // role reservation and dispatch is retried within the same window
    const rows = [...await ctx.db.query("verificationLinks").withIndex("by_ready", q => q.eq("serverId", serverId).eq("status", "solved").eq("deliveryOutcome", undefined)).take(10),
        ...await ctx.db.query("verificationLinks").withIndex("by_ready", q => q.eq("serverId", serverId).eq("status", "redeemed").eq("deliveryOutcome", undefined)).take(10)]
        .sort((a, b) => a.createdAt - b.createdAt).slice(0, 10)
    const requests: VerificationReady[] = []
    for (const row of rows) {
        const panel = await ctx.db.query("rolePanels").withIndex("by_server_name", q => q.eq("serverId", serverId).eq("name", row.panelName)).unique()
        if ((row.solveExpiresAt ?? 0) + 180000 <= Date.now() || !panel?.enabled || panel.withdrawing || panel.revision !== row.rulesRevision || panel.published?.messageId !== row.publishedMessageId) {
            await ctx.db.patch(row._id, { status: "expired" })
            continue
        }
        requests.push({ challengeId: row._id, userId: row.userId, joinedAt: row.joinedAt, panelName: row.panelName, revision: row.rulesRevision, messageId: row.publishedMessageId })
    }
    return { requests }
} })
export const request = serviceQuery({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<VerificationReady> => {
    const input = decode(VerificationRequestRequest, request), row = await rowById(ctx, input.challengeId)
    if (row.serverId !== input.serverId) fail(404, "Verification request not found")
    await current(ctx, row)
    return { challengeId: row._id, userId: row.userId, joinedAt: row.joinedAt, panelName: row.panelName, revision: row.rulesRevision, messageId: row.publishedMessageId }
} })
export const review = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<VerificationReviewResult> => {
    const input = decode(VerificationReviewRequest, request), row = await rowById(ctx, input.challengeId), member = memberContext(input.context)
    const reviewer = await rolesAdmin(ctx, row.serverId, input.actor)
    if (row.serverId !== input.serverId || row.userId !== member.userId || row.joinedAt !== member.joinedAt || member.isBot) fail(409, "Verification member or panel changed")
    await current(ctx, row); await participationAvailability(ctx, row.serverId, member)
    if (row.deliveryClaimedAt !== undefined || row.status === "redeemed" || row.status === "solved") fail(409, "Use existing role recovery for a claimed verification request")
    await ctx.db.patch(row._id, { status: "solved", solvedAt: Date.now(), solveExpiresAt: Date.now(), reviewedBy: reviewer.userId, reviewedAt: Date.now(), ...clearedCaptcha })
    return { reviewed: true }
} })
export const claim = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<VerificationClaimResult> => {
    const input = decode(VerificationClaimRequest, request), row = await rowById(ctx, input.challengeId), member = memberContext(input.context)
    if (row.serverId !== input.serverId || row.userId !== member.userId || row.joinedAt !== member.joinedAt) fail(409, "Verification member or panel changed")
    await current(ctx, row); await participationAvailability(ctx, row.serverId, member)
    if (row.status !== "solved" && row.status !== "redeemed" || row.deliveryOutcome !== undefined || (row.solveExpiresAt ?? 0) + 180000 <= Date.now()) return { claimed: false }
    await ctx.db.patch(row._id, { deliveryClaimedAt: Date.now(), deliveryClaimToken: input.claimToken })
    return { claimed: true, sourceId: row.sourceId, createdAt: row.solvedAt! }
} })
export const delivery = serviceMutation({ args: { request: v.any() }, handler: async (ctx, { request }): Promise<VerificationDeliveryResult> => {
    // The bot records a confirmed role or a member who left, which ends discovery of this proof
    const input = decode(VerificationDeliveryRequest, request), row = await rowById(ctx, input.challengeId)
    if (row.serverId !== input.serverId) fail(404, "Verification request not found")
    if (row.deliveryOutcome !== undefined || row.status !== "solved" && row.status !== "redeemed") return { recorded: false }
    await ctx.db.patch(row._id, { deliveryOutcome: input.outcome })
    return { recorded: true }
} })
export const expire = internalMutation({ args: { challengeId: v.id("verificationLinks") }, handler: async (ctx, args) => {
    const row = await ctx.db.get(args.challengeId)
    if (row && row.expiresAt <= Date.now()) await ctx.db.delete(row._id)
} })
