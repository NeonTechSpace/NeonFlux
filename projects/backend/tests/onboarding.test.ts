import assert from "node:assert/strict"
import { afterEach, beforeEach, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import type { OnboardingStep } from "@neonflux/contracts/onboarding"
import { withChecklist } from "../convex/onboarding.ts"
import { botCall } from "./bot-service.ts"

const secret = "synthetic-onboarding-secret-not-a-credential-000", prior = { server: process.env.NEONFLUX_SERVER_ID, secret: process.env.NEONFLUX_BOT_API_SECRET }
let drain: (() => Promise<void>) | undefined
beforeEach(() => { process.env.NEONFLUX_SERVER_ID = "1"; process.env.NEONFLUX_BOT_API_SECRET = secret; drain = undefined })
afterEach(async () => {
    await drain?.()
    for (const [key, value] of [["NEONFLUX_SERVER_ID", prior.server], ["NEONFLUX_BOT_API_SECRET", prior.secret]] as const) if (value === undefined) delete process.env[key]; else process.env[key] = value
})
const modules = Object.fromEntries(["schema", "botService", "onboarding", "greetings", "greetingLifecycle", "publishing", "roles", "roleParticipation", "roleLifecycle", "moderation", "analytics", "_generated/api", "_generated/server"]
    .map(name => [`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`, () => import(`../convex/${name}.${name.startsWith("_generated") ? "js" : "ts"}`)]))
const admin = { originServerId: "1", userId: "10", roleIds: [], isOwner: false, isAdministrator: true, nativePermissionAuthorized: true }
const safe = (roleId: string, permissions = "0") => ({ roleId, permissions, botCanManage: true, actorCanManage: true })
// Verification grants 50, the colors panel 51, the langs menu 52, and 53 is the completion role
const snapshots = ["50", "51", "52", "53"].map(id => safe(id))

function fixture(context: TestContext) {
    let now = 1700000000000, sequence = 1000
    context.mock.method(Date, "now", () => now)
    context.mock.timers.enable({ apis: ["setTimeout"] })
    const t = convexTest({ schema, modules, transactionLimits: true })
    drain = () => t.finishAllScheduledFunctions(() => context.mock.timers.tick(0))
    const call = async (path: string, body: unknown, expected = 200): Promise<any> => {
        const response = await botCall(t, path, body), result = await response.json()
        assert.equal(response.status, expected, JSON.stringify(result))
        return result
    }
    const manage = (operation: unknown, expected = 200, extra: Record<string, unknown> = {}) => call("/onboarding/manage", { serverId: "1", messageId: String(++sequence), createdAt: now, actor: admin, operation, ...extra }, expected)
    const member = (userId: string, roleIds: string[], joinedAt = new Date(now - 60000).toISOString()) => ({ userId, joinedAt, roleIds, isBot: false, timeoutUntil: null, botId: "999", botAuthorized: true, roles: snapshots })
    // Published panels and a role picker menu, written directly since their own tests cover publishing
    const features = () => t.run(async ctx => {
        await ctx.db.insert("roleSettings", { serverId: "1", config: { panelsEnabled: true, verificationEnabled: true, autoroleEnabled: false, humansOnly: true, autoroleIds: [], revision: 1 }, nextPanelRevision: 3 })
        for (const [name, kind, roleId, channelId] of [["rules", "verification", "50", "30"], ["colors", "reaction", "51", "31"]] as const) {
            const mappings = [{ emoji: "✅", roleId, prerequisiteRoleIds: [], exclusionRoleIds: [] }]
            await ctx.db.insert("rolePanels", { serverId: "1", name, kind, revision: 1, enabled: true, exclusive: false, mappings, withdrawing: false,
                published: { revision: 1, publishedAt: now, postNo: 1, postGeneration: 1, channelId, messageId: "70", botId: "999", content: { content: "Panel" }, mappings, exclusive: false } })
        }
        await ctx.db.insert("rolePickerSettings", { serverId: "1", enabled: true, menus: [{ name: "langs", mode: "multi", roleIds: ["52"] }] })
    })
    const acknowledge = (userId: string, joinedAt: string) => t.run(ctx => ctx.db.insert("roleAcknowledgments", { serverId: "1", userId, joinedAt, rulesRevision: 1, panelName: "rules", acknowledgedAt: now }))
    return { t, call, manage, member, features, acknowledge, now: () => now, advance: (ms: number) => { now += ms } }
}
const steps: OnboardingStep[] = [{ type: "rules" }, { type: "panel", name: "colors" }, { type: "menu", name: "langs" }, { type: "link", channelId: "32", text: "Say hello" }]

test("Checklist changes need the owner or an Administrator, name existing panels and menus and keep at most five distinct steps", async context => {
    const f = fixture(context)
    await f.manage({ type: "module", enabled: true }, 403, { actor: { ...admin, isAdministrator: false } })
    await f.manage({ type: "step-add", step: { type: "panel", name: "colors" } }, 404)
    await f.manage({ type: "step-add", step: { type: "menu", name: "langs" } }, 404)
    await f.features()
    for (const step of steps) await f.manage({ type: "step-add", step })
    await f.manage({ type: "step-add", step: { type: "panel", name: "colors" } }, 409)
    await f.manage({ type: "step-add", step: { type: "link", channelId: "33", text: "x".repeat(101) } }, 400)
    await f.manage({ type: "step-add", step: { type: "link", channelId: "33", text: "Read the guide" } })
    await f.manage({ type: "step-add", step: { type: "link", channelId: "34", text: "One too many" } }, 400)
    await f.manage({ type: "step-remove", position: 5 })
    // The completion role passes the self-service role rules, so a role with Administrator is refused
    assert.equal((await f.manage({ type: "role", roleId: "53" }, 403, { roles: [safe("53", "8")] })).code, "ROLE_NOT_ELIGIBLE")
    const view = await f.manage({ type: "role", roleId: "53" }, 200, { roles: snapshots })
    assert.deepEqual(view.settings, { enabled: false, delivery: "welcome", steps, completionRoleId: "53" })
    // Each step a member finishes by a role is listed with its roles, and link steps are not
    assert.deepEqual(view.roleSteps, [["50"], ["51"], ["52"]])
    assert.equal(view.revision, 7)
    const audit = await f.t.run(ctx => ctx.db.query("auditLogEntries").collect())
    assert.equal(audit.filter(row => row.feature === "onboarding").length, 7)
    // Turning the checklist off still works at DEFCON 1, while other changes wait
    await f.t.run(async ctx => { await ctx.db.insert("moderationSettings", { serverId: "1", config: { manualModerationEnabled: true, staffRoleIds: { moderation: [], cases: [], automod: [], security: [], appeals: [] }, logChannelId: null, automodEnabled: false,
        automodMode: "dry-run", automodBotMessagesEnabled: false, securityEnabled: false, securityMode: "dry-run", joinEnabled: false, joinThreshold: 10, joinWindowSeconds: 10, joinDefcon2: false, honeypotEnabled: false,
        honeypotChannelIds: [], watchlistEnabled: false, appealsEnabled: true, defcon: 1 }, nextCaseNo: 1, nextAppealNo: 1 } as never) })
    await f.manage({ type: "module", enabled: true }, 403)
    await f.manage({ type: "module", enabled: false })
})

test("Progress comes from the features' records, and a completion is recorded and counted once", async context => {
    const f = fixture(context)
    await f.features()
    await f.manage({ type: "steps", steps })
    await f.manage({ type: "role", roleId: "53" }, 200, { roles: snapshots })
    const newcomer = f.member("20", [])
    // While the checklist is off nothing is recorded
    assert.deepEqual(await f.call("/onboarding/member", { serverId: "1", context: { ...newcomer, roleIds: ["50", "51", "52"] } }), {
        enabled: false, complete: false, steps: [{ text: "Accept the server rules in <#30>", state: "open" }, { text: "Pick your colors roles in <#31>", state: "done" },
            { text: "Choose your langs roles in the role picker on the NeonFlux website", state: "done" }, { text: "<#32> Say hello", state: "info" }] })
    await f.manage({ type: "module", enabled: true })
    const open = await f.call("/onboarding/member", { serverId: "1", context: newcomer })
    assert.deepEqual(open.steps.map((step: { state: string }) => step.state), ["open", "open", "open", "info"])
    assert.equal(open.complete, false)
    // Holding the verification role alone is not accepting the rules
    assert.equal((await f.call("/onboarding/member", { serverId: "1", context: { ...newcomer, roleIds: ["50", "51", "52"] } })).complete, false)
    await f.acknowledge("20", newcomer.joinedAt)
    const done = await f.call("/onboarding/member", { serverId: "1", context: { ...newcomer, roleIds: ["50", "51", "52"] } })
    assert.equal(done.complete, true); assert.equal(done.completedAt, f.now())
    assert.equal(done.grant.roleId, "53"); assert.match(done.grant.sourceId, /^onboarding_/)
    f.advance(1000)
    assert.equal((await f.call("/onboarding/member", { serverId: "1", context: { ...newcomer, roleIds: ["50"] } })).completedAt, f.now() - 1000)
    // Counts only: one completion for today, no member named in analytics
    const days = await f.t.run(ctx => ctx.db.query("analyticsDays").collect())
    assert.deepEqual(days.map(row => [row.joins, row.leaves, row.onboarded]), [[0, 0, 1]])
    assert.equal((await f.call("/analytics/summary", { serverId: "1" })).onboarded, 1)
    // A rejoined member is a new membership, so the earlier completion and rules acceptance do not carry over
    const rejoined = { ...newcomer, joinedAt: new Date(f.now()).toISOString(), roleIds: ["50", "51", "52"] }
    assert.equal((await f.call("/onboarding/member", { serverId: "1", context: rejoined })).complete, false)
    // A panel that is no longer published leaves the checklist rather than blocking it
    await f.t.run(async ctx => { const panel = (await ctx.db.query("rolePanels").collect()).find(row => row.name === "colors")!; await ctx.db.patch(panel._id, { enabled: false }) })
    assert.deepEqual((await f.call("/onboarding/get", { serverId: "1" })).roleSteps, [["50"], ["52"]])
})

test("The completion role goes through the shared role ownership and is never reserved twice", async context => {
    const f = fixture(context)
    await f.features()
    await f.manage({ type: "steps", steps: [{ type: "panel", name: "colors" }] })
    await f.manage({ type: "role", roleId: "53" }, 200, { roles: snapshots })
    await f.manage({ type: "module", enabled: true })
    const newcomer = f.member("20", ["50", "51"])
    await f.acknowledge("20", newcomer.joinedAt)
    const progress = await f.call("/onboarding/member", { serverId: "1", context: newcomer })
    const evaluate = (sourceId: string, expected = 200, current = newcomer) => f.call("/roles/evaluate", { serverId: "1", sourceId, createdAt: f.now(), context: current, operation: { type: "onboarding", roleId: "53" } }, expected)
    await evaluate("onboarding_other", 409)
    // A member who did not finish has nothing to receive
    await evaluate(progress.grant.sourceId, 409, f.member("21", ["50", "51"]))
    const reserved = await evaluate(progress.grant.sourceId)
    assert.equal(reserved.status, "reserved")
    assert.deepEqual([reserved.grant.action, reserved.grant.consumerKey, reserved.grant.roleId], ["add", "onboarding", "53"])
    // The pending change is not repeated, and the progress names no further change for it
    assert.deepEqual([(await evaluate(progress.grant.sourceId)).status, (await evaluate(progress.grant.sourceId)).duplicate], ["blocked", true])
    assert.equal((await f.call("/onboarding/member", { serverId: "1", context: newcomer })).grant, undefined)
})

test("A new member's greeting carries the checklist of its route", async context => {
    const f = fixture(context)
    await f.features()
    const owner = { ...admin, isOwner: true }
    let n = 0
    const next = () => ({ serverId: "1", messageId: String(5000 + ++n), createdAt: f.now() })
    await f.call("/publishing/manage", { ...next(), actor: owner, operation: { type: "draft-create", kind: "template", name: "greeting" } })
    await f.call("/publishing/manage", { ...next(), actor: owner, operation: { type: "draft-update", kind: "template", name: "greeting", expectedRevision: 1, edit: { type: "content", content: "Welcome {user.name}" } } })
    await f.call("/greetings/manage", { ...next(), actor: owner, operation: { type: "configure", route: "welcome", templateName: "greeting", expectedTemplateRevision: 2, channelId: "35", timing: "join" } })
    await f.call("/greetings/manage", { ...next(), actor: owner, operation: { type: "module", route: "welcome", enabled: true } })
    await f.manage({ type: "steps", steps })
    await f.manage({ type: "module", enabled: true })
    const join = (userId: string) => {
        const joinedAt = new Date(f.now()).toISOString()
        return f.call("/greetings/observe", { serverId: "1", operation: { type: "join", eventJoinedAt: joinedAt, observedAt: f.now(),
            member: { userId, userName: "Synthetic", serverName: "Synthetic Server", joinedAt, isBot: false, roleIds: [], timeoutUntil: null } } })
    }
    await join("20")
    const content = async () => (await f.t.run(ctx => ctx.db.query("greetingDeliveries").order("desc").first()))!.content.content
    assert.equal(await content(), "Welcome Synthetic\n\n**Getting started**\n1. Accept the server rules in <#30>\n2. Pick your colors roles in <#31>\n"
        + "3. Choose your langs roles in the role picker on the NeonFlux website\n4. <#32> Say hello\nSend !onboarding in the server to see what is left")
    // A checklist sent by DM leaves the channel welcome as it is
    await f.manage({ type: "delivery", delivery: "dm" })
    f.advance(1000)
    await join("21")
    assert.equal(await content(), "Welcome Synthetic")
})

test("A checklist that does not fit the greeting falls back to the hint, or adds nothing", () => {
    const checklist = { list: "**Getting started**\n1. Accept the server rules", hint: "Send !onboarding in the server to see what is left" }
    assert.equal(withChecklist({ content: "Hi" }, checklist).content, `Hi\n\n${checklist.list}\n${checklist.hint}`)
    assert.equal(withChecklist({ content: "x".repeat(1940) }, checklist).content, `${"x".repeat(1940)}\n\n${checklist.hint}`)
    assert.equal(withChecklist({ content: "x".repeat(1990) }, checklist).content, "x".repeat(1990))
    assert.deepEqual(withChecklist({ content: "Hi" }, undefined), { content: "Hi" })
})
