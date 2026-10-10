import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { ConvexError } from "convex/values"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api, internal } from "../convex/_generated/api.js"
import type { AutomodRule, MemberContentContext, ModerationActor, PublishingGrant, ShowcaseJob, ShowcaseMemberOperation, ShowcaseStartResult, ShowcaseState } from "../contracts.js"
import { defaultSettings } from "../convex/moderationDomain.ts"
import { botCall } from "./bot-service.ts"

const modules = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url)).filter(name => name.endsWith(".ts")).map(name => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")], ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const secret = "synthetic-showcase-secret-not-a-credential-000000"
const scopeKeys = ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_IDS", "NEONFLUX_SERVER_MODE", "NEONFLUX_BOT_API_SECRET", "FLUXER_CLIENT_ID"] as const
const prior = Object.fromEntries(scopeKeys.map(key => [key, process.env[key]]))
let now = 0
beforeEach(() => {
    now = 1700000000000
    mock.timers.enable({ apis: ["setTimeout"] })
    mock.method(Date, "now", () => now)
    delete process.env.NEONFLUX_SERVER_ID; delete process.env.NEONFLUX_SERVER_IDS
    process.env.NEONFLUX_SERVER_MODE = "multi"; process.env.FLUXER_CLIENT_ID = "30"; process.env.NEONFLUX_BOT_API_SECRET = secret
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === "https://fluxer.app/.well-known/fluxer") return Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
        if (url.endsWith("/v1/oauth2/@me")) return Response.json({ application: { id: "30" }, scopes: ["identify", "guilds"], user: { id: "20", username: "Synthetic member" } })
        if (url.endsWith("/v1/users/@me/guilds?limit=100")) return Response.json([{ id: "10", name: "Member server", icon: null, owner_id: "99", permissions: "0" }])
        throw new Error("Unexpected synthetic provider route")
    })
})
afterEach(() => {
    mock.restoreAll(); mock.timers.reset()
    for (const key of scopeKeys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key] }
})

const manager: ModerationActor = { originServerId: "10", userId: "99", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true } as ModerationActor
const member = (roleIds: string[] = [], userId = "20"): MemberContentContext => ({ userId, userName: "Synthetic <@1> member", roleIds, isBot: false, timeoutUntil: null, botId: "999" })
const statusOf = (error: unknown) => error instanceof ConvexError ? (error.data as { status?: number }).status : undefined
const content = { title: "My @everyone game", text: "Built over a weekend <@21>", links: ["https://example.org/shot.png", "https://example.org/repo"] }

async function fixture() {
    const t = convexTest({ schema, modules, transactionLimits: true })
    let sequence = 1000, request = 0
    const raw = (path: string, body: Record<string, unknown>) => botCall(t, path, { serverId: "10", ...body }, { serverId: "10" })
    const http = async (path: string, body: Record<string, unknown>) => { const response = await raw(path, body); assert.equal(response.status, 200, await response.clone().text()); return response.json() }
    assert.equal((await botCall(t, "/service/installations/join", { serverId: "10" })).status, 200)
    const manage = (operation: unknown, managerAuthorized = true) => raw("/showcase/manage", { originServerId: "10", messageId: String(++sequence), createdAt: now, actor: manager, managerAuthorized, operation })
    // Sign-in lists member servers with the features on at that time, so the member signs in on first use
    let session: string | undefined
    const token = async () => session ??= (await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" })).sessionToken
    const ask = async (operation: ShowcaseMemberOperation) => (await t.mutation(api.showcases.request, { sessionToken: await token(), serverId: "10", requestId: `00000000-0000-4000-8000-${String(++request).padStart(12, "0")}`, operation })).jobId
    const view = async () => t.query(api.showcases.member, { sessionToken: await token(), serverId: "10" })
    const start = async (jobId: string, who = member()) => await http("/showcase/start", { jobId, actorId: "20", member: who }) as ShowcaseStartResult
    // The bot's send or edit: claim the dispatch, then record what Fluxer answered
    const deliver = async (grant: PublishingGrant, outcome: "sent" | "uncertain" | "none", messageId = "500") => {
        const binding = { postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, claimToken: "c".repeat(32) }
        assert.equal((await http("/publishing/dispatch", binding)).claimed, true)
        if (outcome !== "none") await http("/publishing/outcome", { ...binding, outcome, ...(outcome === "sent" ? { messageId: grant.messageId ?? messageId } : {}) })
    }
    const complete = async (jobId: string, extra: Record<string, unknown> = {}) => (await http("/showcase/complete", { jobId, ...extra })).job as ShowcaseJob
    const post = async (operation: ShowcaseMemberOperation, messageId = "500") => {
        const jobId = await ask(operation), started = await start(jobId)
        assert.ok(started.grant, started.job.error)
        await deliver(started.grant, "sent", messageId)
        return complete(jobId)
    }
    const automod = (rule: Partial<AutomodRule>) => t.run(async ctx => {
        await ctx.db.insert("moderationSettings", { serverId: "10", config: { ...defaultSettings(), automodEnabled: true }, nextCaseNo: 1, nextAppealNo: 1 })
        await ctx.db.insert("automodRules", { serverId: "10", name: "slurs", rule: { name: "slurs", type: "words", enabled: true, priority: 0, action: "delete", durationSeconds: 60, patterns: ["forbidden"], domainMode: "block",
            channelIds: [], exemptChannelIds: [], exemptRoleIds: [], threshold: 1, windowSeconds: 10, ...rule } })
    })
    // Moving the clock past the five-minute sign-in admission needs a new sign-in
    const later = (ms: number) => { now += ms; session = undefined }
    return { t, raw, http, manage, ask, view, start, deliver, complete, post, automod, later }
}

test("Managers configure showcases in chat with the audit log, and members see the feature at sign-in", async () => {
    const f = await fixture()
    assert.equal((await f.manage({ type: "settings", enabled: true }, false)).status, 403)
    const big = await f.manage({ type: "settings", maxPerMember: 51 }); assert.equal(big.status, 400, await big.text())
    await assert.rejects(f.view(), error => statusOf(error) === 403)
    assert.equal((await f.manage({ type: "settings", enabled: true, channelId: "40", maxPerMember: 2, intervalMinutes: 10 })).status, 200)
    assert.equal((await f.manage({ type: "access-add", list: "block", kind: "user", ids: ["21"] })).status, 200)
    const state = await f.http("/showcase/settings", {}) as ShowcaseState
    assert.deepEqual(state, { revision: 2, settings: { enabled: true, channelId: "40", maxPerMember: 2, intervalMinutes: 10 }, access: { allowRoleIds: [], blockRoleIds: [], allowUserIds: [], blockUserIds: ["21"] } })
    const audit = await f.t.run(ctx => ctx.db.query("auditLogEntries").collect())
    assert.deepEqual(audit.map(row => row.feature), ["showcase", "showcase"])
    const refreshed = await f.t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" })
    assert.deepEqual(refreshed.memberServers?.map(server => server.features), [["showcase"]])
    const overview = await f.http("/setup/status", {}) as { sections: Array<{ id: string, state: string }> }
    assert.deepEqual(overview.sections.filter(row => row.id === "showcase" || row.id === "profile"), [{ id: "showcase", state: "on" }, { id: "profile", state: "off" }])
})

test("A website showcase posts through publishing as the bot, edits its message and deletes it", async () => {
    const f = await fixture()
    await f.manage({ type: "settings", enabled: true, channelId: "40" })
    const jobId = await f.ask({ type: "create", ...content }), started = await f.start(jobId)
    const grant = started.grant!
    // The bot posts as itself, the first HTTPS image link becomes the embed image and mention syntax is broken up
    assert.deepEqual([grant.action, grant.actorId, grant.botId, grant.channelId, grant.source, grant.provenance], ["send", "999", "999", "40", { type: "showcase", jobId, createdAt: now }, { type: "showcase", showcaseNo: 1 }])
    assert.deepEqual(grant.content, { content: "", embed: { title: "My @​everyone game", description: "Built over a weekend <​@21>\n\nhttps://example.org/shot.png\n\nhttps://example.org/repo",
        author: { name: "Synthetic <​@1> member" }, image: { url: "https://example.org/shot.png" } } })
    assert.equal((await f.view()).showcases[0]!.status, "posting")
    // A restart before the claim gets the same grant once more, never a second post
    assert.equal((await f.start(jobId)).grant?.attemptId, grant.attemptId)
    await f.deliver(grant, "sent")
    assert.equal((await f.complete(jobId)).state, "applied")
    let mine = (await f.view()).showcases
    assert.deepEqual(mine.map(row => [row.showcaseNo, row.status, row.messageId, row.title]), [[1, "posted", "500", content.title]])
    // Staff cannot edit or forget a showcase's tracked post with publishing commands
    const forgotten = await f.raw("/publishing/manage", { messageId: "1999", createdAt: now, actor: manager, operation: { type: "forget", postNo: mine[0]!.postNo, expectedGeneration: 1 } })
    assert.equal(forgotten.status, 409)
    // An edit changes the posted message and then the stored content
    const edit = await f.ask({ type: "edit", showcaseNo: 1, title: "Renamed", text: "New text", links: [] })
    const editing = await f.start(edit)
    assert.deepEqual([editing.grant?.action, editing.grant?.messageId, editing.grant?.content.embed?.title], ["edit", "500", "Renamed"])
    await f.deliver(editing.grant!, "sent")
    assert.equal((await f.complete(edit)).state, "applied")
    mine = (await f.view()).showcases
    assert.deepEqual([mine[0]!.title, mine[0]!.text, mine[0]!.links], ["Renamed", "New text", []])
    // Deleting removes the message through the bot, then the showcase and its tracked post
    const removal = await f.ask({ type: "delete", showcaseNo: 1 })
    assert.deepEqual((await f.start(removal)).remove, { channelId: "40", messageId: "500" })
    assert.equal((await f.complete(removal, { removed: false, fix: "Grant Manage Messages" })).error, "The showcase message could not be deleted. Grant Manage Messages")
    const again = await f.ask({ type: "delete", showcaseNo: 1 })
    await f.start(again)
    assert.equal((await f.complete(again, { removed: true })).state, "applied")
    assert.deepEqual((await f.view()).showcases, [])
    assert.deepEqual(await f.t.run(ctx => ctx.db.query("publishingPosts").collect()), [])
})

test("Limits, access lists, lockdown and automod rules refuse a showcase with their reason", async () => {
    const f = await fixture()
    await f.manage({ type: "settings", enabled: true, channelId: "40", maxPerMember: 2, intervalMinutes: 10 })
    await f.manage({ type: "access-add", list: "block", kind: "role", ids: ["60"] })
    const refused = async (who = member()) => { const jobId = await f.ask({ type: "create", ...content }), started = await f.start(jobId, who); assert.equal(started.grant, undefined); return started.job.error }
    assert.equal(await refused(member(["60"])), "You cannot post showcases in this server")
    assert.equal((await f.post({ type: "create", ...content })).state, "applied")
    assert.equal(await refused(), "This server allows one showcase every 10 minutes. Try again in 10 minutes")
    f.later(600000)
    assert.equal((await f.post({ type: "create", ...content }, "501")).state, "applied")
    f.later(600000)
    // The cap counts showcases that still exist
    assert.equal(await refused(), "You have 2 showcases, the most this server allows. Delete one first")
    await f.manage({ type: "settings", maxPerMember: null, intervalMinutes: null })
    await f.automod({ patterns: ["weekend"], exemptRoleIds: ["61"] })
    assert.equal(await refused(), "The server's automod rule slurs blocked this showcase. Change the text or links and try again")
    // Exempt roles pass, as they do for messages
    assert.ok((await f.start(await f.ask({ type: "create", ...content }), member(["61"]))).grant)
    await f.t.run(async ctx => { const row = (await ctx.db.query("moderationSettings").first())!; await ctx.db.patch(row._id, { config: { ...row.config, defcon: 2 } }) })
    assert.equal(await refused(member(["61"])), "The server is in lockdown, so showcases are paused")
})

test("An unconfirmed post is never sent again, blocks changes and stays with the member's data until resolved", async () => {
    const f = await fixture()
    await f.manage({ type: "settings", enabled: true, channelId: "40" })
    const jobId = await f.ask({ type: "create", ...content }), grant = (await f.start(jobId)).grant!
    await f.deliver(grant, "none")
    // The bot claimed the send but never reported, so the expiry after the dispatch window records it as unconfirmed
    assert.equal((await f.complete(jobId)).state, "queued")
    now += 130000
    await f.t.mutation(internal.showcases.expireRequest, { id: jobId as never })
    const job = (await f.view()).requests.find(row => row.id === jobId)!
    assert.equal(job.error, `Fluxer did not confirm the last post of this showcase, and it is never sent again automatically. Ask staff to check it with !publish reconcile ${grant.postNo}`)
    assert.equal((await f.view()).showcases[0]!.status, "unconfirmed")
    const removal = await f.ask({ type: "delete", showcaseNo: 1 })
    assert.equal((await f.start(removal)).job.error, job.error)
    const deleted = await (await botCall(f.t, "/service/member-data/delete", { userId: "20", userName: "member", serverId: "10", cursor: null })).json() as { kept: Array<{ feature: string }> }
    assert.deepEqual(deleted.kept.map(item => item.feature), ["Showcases"])
    // Staff record that nothing was sent, and the member deletes the showcase without a message to remove
    await f.http("/publishing/manage", { messageId: "1998", createdAt: now, actor: manager, operation: { type: "resolve", postNo: grant.postNo, expectedGeneration: 1, outcome: "failed" } })
    assert.equal((await f.view()).showcases[0]!.status, "failed")
    const cleared = await f.ask({ type: "delete", showcaseNo: 1 })
    assert.deepEqual([(await f.start(cleared)).job.state, (await f.view()).showcases], ["applied", []])
})

test("A send that fails removes the new showcase and names the fix", async () => {
    const f = await fixture()
    await f.manage({ type: "settings", enabled: true, channelId: "40" })
    const jobId = await f.ask({ type: "create", ...content }), grant = (await f.start(jobId)).grant!
    await f.http("/publishing/outcome", { postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId, outcome: "failed" })
    const job = await f.complete(jobId, { fix: "Grant Send Messages to the NeonFlux role" })
    assert.equal(job.error, "The showcase could not be posted. Grant Send Messages to the NeonFlux role")
    assert.deepEqual((await f.view()).showcases, [])
})
