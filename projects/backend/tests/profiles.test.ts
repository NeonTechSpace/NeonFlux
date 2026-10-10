import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { afterEach, beforeEach, mock, test } from "node:test"
import { ConvexError } from "convex/values"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api, internal } from "../convex/_generated/api.js"
import type { MemberContentContext, MemberDataDeletePage, ModerationActor, ProfileJob, ProfileMemberOperation, ProfileShowResult, ProfileState } from "../contracts.js"
import { defaultSettings } from "../convex/moderationDomain.ts"
import { botCall } from "./bot-service.ts"

const modules = Object.fromEntries([
    ...readdirSync(new URL("../convex/", import.meta.url)).filter(name => name.endsWith(".ts")).map(name => [`../convex/${name}`, () => import(`../convex/${name}`)]),
    ["../convex/_generated/api.js", () => import("../convex/_generated/api.js")], ["../convex/_generated/server.js", () => import("../convex/_generated/server.js")],
])
const secret = "synthetic-profile-secret-not-a-credential-0000000"
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

const manager = { originServerId: "10", userId: "99", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true } as unknown as ModerationActor
const member = (roleIds: string[] = []): MemberContentContext => ({ userId: "20", userName: "Synthetic member", roleIds, isBot: false, timeoutUntil: null, botId: "999" })
const statusOf = (error: unknown) => error instanceof ConvexError ? (error.data as { status?: number }).status : undefined
const saved: ProfileMemberOperation = { type: "save", bio: "I draw <@&40> maps", links: ["https://example.org/art"], color: 0x3d66b8 }

async function fixture() {
    const t = convexTest({ schema, modules, transactionLimits: true })
    let sequence = 1000, request = 0, session: string | undefined
    const raw = (path: string, body: Record<string, unknown>) => botCall(t, path, { serverId: "10", ...body }, { serverId: "10" })
    const http = async (path: string, body: Record<string, unknown>) => { const response = await raw(path, body); assert.equal(response.status, 200, await response.clone().text()); return response.json() }
    assert.equal((await botCall(t, "/service/installations/join", { serverId: "10" })).status, 200)
    const manage = (operation: unknown) => http("/profile/manage", { originServerId: "10", messageId: String(++sequence), createdAt: now, actor: manager, managerAuthorized: true, operation }) as Promise<ProfileState>
    // Sign-in lists member servers with the features on at that time, so the member signs in on first use
    const token = async () => session ??= (await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" })).sessionToken
    const ask = async (operation: unknown) => (await t.mutation(api.profiles.request, { sessionToken: await token(), serverId: "10", requestId: `00000000-0000-4000-8000-${String(++request).padStart(12, "0")}`, operation })).jobId
    const view = async () => t.query(api.profiles.member, { sessionToken: await token(), serverId: "10" })
    const apply = async (jobId: string, roleIds: string[] = []) => (await http("/profile/apply", { jobId, actorId: "20", member: member(roleIds) })).job as ProfileJob
    const show = async (callerRoles: string[] = [], targetRoles: string[] = []) => await http("/profile/show", { channelId: "40", caller: { userId: "21", roleIds: callerRoles }, target: { userId: "20", userName: "Member <@1>", roleIds: targetRoles } }) as ProfileShowResult
    return { t, raw, http, token, manage, ask, view, apply, show }
}

test("Members save a profile on the website after the bot's fresh read, and !profile shows it as an embed without mentions", async () => {
    const f = await fixture()
    assert.deepEqual(await f.show(), { type: "refused", reason: "off" })
    assert.deepEqual((await f.manage({ type: "settings", enabled: true, cooldownSeconds: 30 })).settings, { enabled: true, cooldownSeconds: 30 })
    await assert.rejects(f.ask({ ...saved, bio: "x".repeat(301) }), error => statusOf(error) === 400)
    await assert.rejects(f.ask({ ...saved, links: ["javascript:alert(1)"] }), error => statusOf(error) === 400)
    assert.deepEqual(await f.show(), { type: "refused", reason: "missing" })
    const jobId = await f.ask(saved)
    // Nothing is saved until the bot handles the request
    assert.equal((await f.view()).profile, null)
    assert.equal((await f.apply(jobId)).state, "applied")
    assert.deepEqual((await f.view()).profile, { userId: "20", bio: saved.bio, links: saved.links, color: saved.color, updatedAt: now })
    assert.deepEqual(await f.show(), { type: "profile", cooldownSeconds: 30, content: { content: "", embed: { title: "Member <​@1>", description: "I draw <​@&40> maps\n\nhttps://example.org/art", color: 0x3d66b8 } } })
    await f.t.mutation(api.profiles.remove, { sessionToken: (await f.t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" })).sessionToken, serverId: "10" })
    assert.equal((await f.view()).profile, null)
})

test("Deleting a profile on the website or with !mydata delete also removes saves still waiting for the bot", async () => {
    const f = await fixture()
    await f.manage({ type: "settings", enabled: true })
    const lateApply = async (jobId: string) => (await f.raw("/profile/apply", { jobId, actorId: "20", member: member() })).status
    assert.equal((await f.apply(await f.ask(saved))).state, "applied")
    const waiting = await f.ask({ ...saved, bio: "Second" })
    await f.t.mutation(api.profiles.remove, { sessionToken: await f.token(), serverId: "10" })
    assert.deepEqual((await f.http("/profile/ready", {})).jobs, [])
    // The bot read the save before the deletion, and applying it now changes nothing
    assert.equal(await lateApply(waiting), 403)
    assert.equal((await f.view()).profile, null)
    // !mydata delete removes a waiting save even before any profile is stored
    const first = await f.ask({ ...saved, bio: "Third" })
    const response = await botCall(f.t, "/service/member-data/delete", { userId: "20", userName: "Synthetic member", serverId: "10", cursor: null })
    assert.equal(response.status, 200)
    assert.deepEqual(((await response.json()) as MemberDataDeletePage).deleted, [{ feature: "Profile saves waiting for the bot", count: 1 }])
    assert.equal(await lateApply(first), 403)
    assert.equal((await f.view()).profile, null)
})

test("Access lists and automod rules decide who may save and show a profile", async () => {
    const f = await fixture()
    await f.manage({ type: "settings", enabled: true })
    await f.manage({ type: "access-add", list: "block", kind: "role", ids: ["60"] })
    assert.equal((await f.apply(await f.ask(saved), ["60"])).error, "You cannot use profiles in this server")
    assert.equal((await f.apply(await f.ask(saved))).state, "applied")
    // A blocked caller cannot run !profile, and a blocked member's profile is not shown
    assert.deepEqual(await f.show(["60"]), { type: "refused", reason: "access" })
    assert.deepEqual(await f.show([], ["60"]), { type: "refused", reason: "missing" })
    await f.t.run(async ctx => {
        await ctx.db.insert("moderationSettings", { serverId: "10", config: { ...defaultSettings(), automodEnabled: true }, nextCaseNo: 1, nextAppealNo: 1 })
        await ctx.db.insert("automodRules", { serverId: "10", name: "art-links", rule: { name: "art-links", type: "domains", enabled: true, priority: 0, action: "delete", durationSeconds: 60, patterns: ["example.org"],
            domainMode: "block", channelIds: [], exemptChannelIds: [], exemptRoleIds: [], threshold: 1, windowSeconds: 10 } })
    })
    // A rule added after saving still blocks the profile when it is shown
    assert.deepEqual(await f.show(), { type: "refused", reason: "automod", rule: "art-links" })
    assert.equal((await f.apply(await f.ask({ ...saved, bio: "New" }))).error, "The server's automod rule art-links blocked this profile. Change the bio or links and try again")
    // An expired request fails, and its profile stays as it was
    const late = await f.ask({ ...saved, links: [] })
    now += 120000
    await f.t.mutation(internal.profiles.expireRequest, { id: late as never })
    assert.equal((await f.view()).requests[0]!.error, "The bot did not handle this request in time. Try again")
    assert.equal((await f.view()).profile?.bio, saved.bio)
})
