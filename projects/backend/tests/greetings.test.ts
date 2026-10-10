import assert from "node:assert/strict"
import { beforeEach, afterEach, test, type TestContext } from "node:test"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { internal } from "../convex/_generated/api.js"
import type { GreetingsGrant, GreetingsMemberContext } from "@neonflux/contracts/greetings"
import { botCall } from "./bot-service.ts"
const secret = "synthetic-greetings-secret-not-a-credential-0000", oldServer = process.env.NEONFLUX_SERVER_ID, oldSecret = process.env.NEONFLUX_BOT_API_SECRET
let drainScheduled: (() => Promise<void>) | undefined
beforeEach(() => { process.env.NEONFLUX_SERVER_ID = "1"; process.env.NEONFLUX_BOT_API_SECRET = secret; drainScheduled = undefined })
afterEach(async () => { await drainScheduled?.(); if (oldServer === undefined) delete process.env.NEONFLUX_SERVER_ID; else process.env.NEONFLUX_SERVER_ID = oldServer; if (oldSecret === undefined) delete process.env.NEONFLUX_BOT_API_SECRET; else process.env.NEONFLUX_BOT_API_SECRET = oldSecret })
const modules = {
    "../convex/schema.ts": () => import("../convex/schema.ts"), "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/greetings.ts": () => import("../convex/greetings.ts"), "../convex/greetingLifecycle.ts": () => import("../convex/greetingLifecycle.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"), "../convex/roles.ts": () => import("../convex/roles.ts"), "../convex/roleParticipation.ts": () => import("../convex/roleParticipation.ts"), "../convex/roleLifecycle.ts": () => import("../convex/roleLifecycle.ts"),
    "../convex/moderation.ts": () => import("../convex/moderation.ts"), "../convex/_generated/api.js": () => import("../convex/_generated/api.js"), "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const owner = { originServerId: "1", userId: "10", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }
const roleSnapshots = [{ roleId: "40", permissions: "0", botCanManage: true, actorCanManage: true }]
async function read(response: Response): Promise<any> { assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); return response.json() }
async function status(response: Response, expected: number) { assert.equal(response.status, expected); assert.equal(JSON.stringify(await response.json()).includes(secret), false) }
function fixture(test: TestContext) {
    let now = 1700000000000, sequence = 1000
    test.mock.method(Date, "now", () => now)
    const t = convexTest({ schema, modules, transactionLimits: true })
    test.mock.timers.enable({ apis: ["setTimeout"] })
    drainScheduled = () => t.finishAllScheduledFunctions(() => test.mock.timers.tick(0))
    const source = () => ({ serverId: "1", messageId: String(++sequence), createdAt: now })
    const http = (path: string, body: unknown, auth = true) => botCall(t, path, body, auth ? {} : { secret: null })
    const manage = (operation: any, actor = owner) => http("/greetings/manage", { ...source(), actor, operation })
    const query = (operation: any, actor = owner) => http("/greetings/query", { serverId: "1", actor, operation })
    const member = (extra: Partial<GreetingsMemberContext> = {}): GreetingsMemberContext => ({ userId: "20", userName: "Synthetic User", serverName: "Synthetic Server", joinedAt: new Date(now).toISOString(), isBot: false, roleIds: [], timeoutUntil: null, ...extra })
    const join = (current = member(), extra = {}) => http("/greetings/observe", { serverId: "1", operation: { type: "join", eventJoinedAt: current.joinedAt, observedAt: now, member: current, ...extra } })
    const pub = (operation: any) => http("/publishing/manage", { ...source(), actor: owner, operation })
    const template = async (content: any = { content: "Welcome {user.name} to {server.name}" }, name = "greeting") => { await read(await pub({ type: "draft-create", kind: "template", name })); await read(await pub({ type: "draft-update", kind: "template", name, expectedRevision: 1, edit: { type: "content", content: content.content } })); if (content.embed) await read(await pub({ type: "draft-update", kind: "template", name, expectedRevision: 2, edit: { type: "embed", embed: content.embed } })); return content.embed ? 3 : 2 }
    const configure = async (destination = "welcome", timing = "join", templateName = "greeting", expectedTemplateRevision = 2) => { await read(await manage({ type: "configure", route: destination, templateName, expectedTemplateRevision, ...(destination !== "dm" ? { channelId: "30" } : {}), ...(destination !== "goodbye" ? { timing } : {}) })); return read(await manage({ type: "module", route: destination, enabled: true })) }
    const pending = (extra = {}) => http("/greetings/pending", { serverId: "1", ...extra })
    const binding = (grant: any) => ({ serverId: "1", deliveryId: grant.deliveryId, route: grant.route, routeRevision: grant.routeRevision, userId: grant.userId, joinedAt: grant.joinedAt, memberGeneration: grant.memberGeneration })
    const context = (candidate: any, current: GreetingsMemberContext | null = member()) => ({ botId: "999", botAuthorized: true, observedAt: now, member: current, memberAbsent: current === null, ...(candidate.route !== "dm" ? { channelId: "30" } : {}) })
    const reserve = (candidate: any, current: GreetingsMemberContext | null = member()) => http("/greetings/reserve", { ...binding(candidate), context: context(candidate, current) })
    const dispatch = (grant: GreetingsGrant, current: GreetingsMemberContext | null = member(), extra = {}) => http("/greetings/dispatch", { ...binding(grant), claimToken: "a".repeat(32), context: context(grant, current), ...extra })
    const outcome = (grant: GreetingsGrant, value = "sent", extra = {}) => http("/greetings/outcome", { ...binding(grant), claimToken: "a".repeat(32), outcome: value, ...(value === "sent" ? { messageId: "500", channelId: grant.channelId ?? "600" } : {}), ...extra })
    const roleMember = (current: GreetingsMemberContext) => ({ userId: current.userId, joinedAt: current.joinedAt, isBot: current.isBot, roleIds: current.roleIds, timeoutUntil: current.timeoutUntil, botId: "999", botAuthorized: true, roles: roleSnapshots })
    const roleManage = (operation: any) => http("/roles/manage", { ...source(), actor: owner, operation })
    const verification = async () => {
        const panel = (await read(await roleManage({ type: "panel-create", name: "rules", kind: "verification", mappings: [{ emoji: "✅", roleId: "40", prerequisiteRoleIds: [], exclusionRoleIds: [] }], roles: roleSnapshots }))).panel
        await read(await pub({ type: "draft-create", kind: "draft", name: "rulespost" })); await read(await pub({ type: "draft-update", kind: "draft", name: "rulespost", expectedRevision: 1, edit: { type: "content", content: "Synthetic rules" } }))
        const sent = await read(await pub({ type: "send", kind: "draft", name: "rulespost", expectedRevision: 2, channelId: "30", context: { botId: "999", channelId: "30", botAuthorized: true, actorAuthorized: true } })), g = sent.grant, b = { serverId: "1", postNo: g.postNo, attemptId: g.attemptId, sourceId: g.sourceId, generation: g.generation, claimToken: "b".repeat(32) }
        await read(await http("/publishing/dispatch", b)); await read(await http("/publishing/outcome", { ...b, outcome: "sent", messageId: "900" }))
        const bound = (await read(await roleManage({ type: "panel-bind", name: "rules", expectedRevision: panel.revision, postNo: g.postNo, expectedPostGeneration: 1 }))).panel
        await read(await roleManage({ type: "settings", patch: { verificationEnabled: true }, roles: roleSnapshots })); return bound
    }
    const verify = async (panel: any, current: GreetingsMemberContext) => {
        const s = source(), operation = { type: "verify", name: "rules", revision: panel.revision }
        return read(await http("/roles/evaluate", { serverId: "1", sourceId: `command_${s.messageId}_0`, createdAt: now, context: roleMember(current), operation }))
    }
    return { t, source, http, manage, query, member, join, pub, template, configure, pending, binding, context, reserve, dispatch, outcome, verification, verify, roleManage, roleMember, advance: (ms: number) => { now += ms }, now: () => now }
}
async function reserved(f: ReturnType<typeof fixture>, current = f.member()): Promise<GreetingsGrant> { const candidates = (await read(await f.pending())).candidates; assert(candidates.length); const result = await read(await f.reserve(candidates[0], current)); assert.equal(result.status, "reserved"); return result.grant }

test("Legacy greeting grant projection and reservation normalize the retained snapshot without rewriting it", async test => {
    const f = fixture(test), rich = { content: "Welcome", embed: { title: "Hello" } }
    const revision = await f.template(rich); await f.configure("welcome", "join", "greeting", revision)
    const current = f.member(); await read(await f.join(current)); const g = await reserved(f, current)
    assert.equal(g.content.embed!.color, undefined)
    assert.equal(g.canonicalContent.embed!.color, 0)
    await f.t.run(async c => {
        const row = (await c.db.query("greetingDeliveries").collect())[0]!
        const grant = structuredClone(row.grant!); delete grant.canonicalContent.embed!.color
        await c.db.patch(row._id, { grant })
    })
    const before = await f.t.run(c => c.db.query("greetingDeliveries").first())
    const projected = (await read(await f.query({ type: "delivery", deliveryNo: g.deliveryNo }))).delivery
    assert.equal(projected.grant.canonicalContent.embed.color, 0)
    assert.equal((await read(await f.reserve(g, current))).grant.canonicalContent.embed.color, 0)
    assert.deepEqual(await f.t.run(c => c.db.query("greetingDeliveries").first()), before)
})

test("Greeting HTTP authenticates before input, binds server and keeps disabled defaults without observation storage", async test => {
    const f = fixture(test)
    for (const path of ["manage", "query", "member", "observe", "pending", "discover", "reserve", "dispatch", "outcome", "defer"]) { await status(await f.http("/greetings/" + path, "private malformed body", false), 401); await status(await f.http("/greetings/" + path, { serverId: "2" }), 403) }
    const settings = (await read(await f.query({ type: "settings" }))).settings; assert.equal(settings.claimsPerMinute, 10); for (const r of Object.values(settings.routes) as any[]) assert.equal(r.enabled, false)
    assert.equal((await read(await f.join())).recorded, false); assert.equal((await f.t.run(c => c.db.query("greetingMembers").collect())).length, 0)
    await status(await f.manage({ type: "settings", claimsPerMinute: 5 }, { ...owner, isOwner: false }), 403)
    await status(await f.http("/greetings/manage", { serverId: "1", data: "x".repeat(65537) }), 413)
})
test("Greeting management snapshots exact template revision and independent route revision with source dedup", async test => {
    const f = fixture(test); await f.template(); await f.configure()
    const before = (await read(await f.query({ type: "settings" }))).settings
    const request = { ...f.source(), actor: owner, operation: { type: "settings", claimsPerMinute: 60 } }
    assert.equal((await read(await f.http("/greetings/manage", request))).duplicate, false); assert.equal((await read(await f.http("/greetings/manage", request))).duplicate, true)
    await f.configure("dm"); const after = (await read(await f.query({ type: "settings" }))).settings; assert.deepEqual(after.routes.welcome, before.routes.welcome)
    await read(await f.pub({ type: "draft-update", kind: "template", name: "greeting", expectedRevision: 2, edit: { type: "content", content: "Changed" } })); assert.equal((await read(await f.query({ type: "settings" }))).settings.routes.welcome.templateRevision, 2)
    await status(await f.manage({ type: "configure", route: "welcome", templateName: "greeting", expectedTemplateRevision: 2, channelId: "30" }), 409)
    await read(await f.pub({ type: "draft-delete", kind: "template", name: "greeting", expectedRevision: 3 })); await read(await f.join()); assert((await reserved(f)).content.content.includes("Synthetic User"))
})
test("Route clear is critical, removes only its snapshot and preserves claimed history", async test => {
    const f = fixture(test); await f.template(); await f.configure(); await f.configure("dm")
    await read(await f.join()); const g = await reserved(f); await read(await f.dispatch(g))
    const before = (await read(await f.query({ type: "settings" }))).settings
    await read(await f.http("/moderation/manage", { ...f.source(), actor: owner, operation: { type: "settings", patch: { defcon: 1 } } }))
    await status(await f.manage({ type: "clear", route: "welcome" }, { ...owner, isOwner: false }), 403)
    const cleared = (await read(await f.manage({ type: "clear", route: "welcome" }))).settings
    assert.deepEqual(cleared.routes.welcome, { revision: before.routes.welcome.revision + 1, enabled: false, timing: "join" })
    assert.deepEqual(cleared.routes.dm, before.routes.dm)
    await read(await f.manage({ type: "clear", route: "dm" })); await drainScheduled?.()
    const rows = await f.t.run(c => c.db.query("greetingDeliveries").collect())
    assert.equal(rows.find(r => r.route === "dm")!.state, "cancelled")
    assert.equal(rows.find(r => r.route === "welcome")!.state, "reserved")
    assert.equal((await read(await f.outcome(g))).recorded, true)
    const state = await f.t.run(c => c.db.query("greetingSettings").first()); assert.equal(state!.activatedAt.welcome, 0); assert.equal(state!.activatedAt.dm, 0)
})
test("Greeting placeholders are fixed text only and renderer escapes one pass", async test => {
    const f = fixture(test); await f.template({ content: "{user.name}:{user.id}:{server.name}:{server.id}:{channel.id}" }); await f.configure()
    const current = f.member({ userName: "*{user.id}* @all", serverName: "#Server" }); await read(await f.join(current)); const grant = await reserved(f, current)
    assert.equal(grant.content.content, "\\*{user.id}\\* \\@all:20:\\#Server:1:30")
    await status(await f.manage({ type: "configure", route: "dm", templateName: "greeting", expectedTemplateRevision: 2 }), 400)
    const bad = await f.template({ content: "{user.tag}" }, "bad"); await status(await f.manage({ type: "configure", route: "welcome", templateName: "bad", expectedTemplateRevision: bad, channelId: "30" }), 400)
    const media = await f.template({ content: "Static", embed: { image: { url: "https://example.test/{user.id}" } } }, "media"); await status(await f.manage({ type: "configure", route: "welcome", templateName: "media", expectedTemplateRevision: media, channelId: "30" }), 400)
})
test("Rendered overflow is recorded as non-dispatched failure without suppressing another route", async test => {
    const f = fixture(test); await f.template({ content: "x".repeat(1990) + "{user.id}" }); await f.configure(); await f.template({ content: "hello" }, "small"); await f.configure("dm", "join", "small")
    const current = f.member({ userId: "9223372036854775807" }); assert.equal((await read(await f.join(current))).admitted, 2)
    const rows = (await read(await f.query({ type: "deliveries" }))).deliveries; assert.equal(rows.find((r: any) => r.route === "welcome").state, "failed"); assert.equal(rows.find((r: any) => r.route === "welcome").noDispatch, true); assert.equal((await read(await f.pending())).candidates[0].route, "dm")
})
test("Join admission rejects stale future bot and mismatched epochs without configuration backfill", async test => {
    const f = fixture(test); await f.template(); await f.configure(); const current = f.member()
    await status(await f.join({ ...current, joinedAt: new Date(f.now() - 900001).toISOString() }), 400); await status(await f.join({ ...current, joinedAt: new Date(f.now() + 60001).toISOString() }), 400)
    await status(await f.join({ ...current, isBot: true }), 403); await status(await f.join(current, { eventJoinedAt: new Date(f.now() - 1).toISOString() }), 403)
    f.advance(1000); await read(await f.manage({ type: "module", route: "welcome", enabled: false })); await read(await f.manage({ type: "module", route: "welcome", enabled: true })); assert.equal((await read(await f.join(current))).admitted, 0)
})
test("Same raw epoch dedup survives replacement and fractional lexical precision stays exact", async test => {
    const f = fixture(test); await f.template(); await f.configure(); const current = f.member({ joinedAt: "2023-11-14T22:13:20.000000Z" })
    await read(await f.join(current)); const original = await reserved(f, current); await f.configure(); assert.equal((await read(await f.join(current))).admitted, 0)
    await read(await f.join({ ...current, joinedAt: "2023-11-14T22:13:20.000001Z" })); const row = (await read(await f.http("/greetings/member", { serverId: "1", userId: "20" }))).member; assert.notEqual(row.generation, original.memberGeneration); assert.equal(row.joinedAt, "2023-11-14T22:13:20.000001Z")
})
test("Atomic admission blocks DEFCON and timeout greetings while retaining enabled observed presence", async test => {
    const f = fixture(test); await f.template(); await f.configure(); await read(await f.http("/moderation/manage", { ...f.source(), actor: owner, operation: { type: "settings", patch: { defcon: 2 } } }))
    assert.equal((await read(await f.join())).admitted, 0)
    await read(await f.http("/moderation/manage", { ...f.source(), actor: owner, operation: { type: "settings", patch: { defcon: 3 } } })); assert.equal((await read(await f.join(f.member({ userId: "21", timeoutUntil: new Date(f.now() + 10000).toISOString() })))).admitted, 0)
})
test("One-time claims and combined evenly spaced pacing govern independent destinations", async test => {
    const f = fixture(test); await f.template(); await f.configure(); await f.configure("dm"); const current = f.member(); await read(await f.join(current)); const list = (await read(await f.pending())).candidates
    const a = (await read(await f.reserve(list[0], current))).grant, b = (await read(await f.reserve(list[1], current))).grant
    const first = await read(await f.dispatch(a, current)); assert.equal(first.claimed, true); assert.equal(first.nextClaimAt, f.now() + 6000); assert.equal((await read(await f.dispatch(a, current))).claimed, false); assert.equal((await read(await f.dispatch(b, current))).claimed, false)
    f.advance(6000); assert.equal((await read(await f.dispatch(b, current))).claimed, true)
})
test("Claim capability and exact binding reject cross-user revision and destination outcomes", async test => {
    const f = fixture(test); await f.template(); await f.configure(); const current = f.member(); await read(await f.join(current)); const g = await reserved(f, current); await read(await f.dispatch(g, current))
    await status(await f.outcome(g, "sent", { claimToken: "b".repeat(32) }), 409); await status(await f.outcome(g, "sent", { userId: "21" }), 409); await status(await f.outcome(g, "sent", { routeRevision: g.routeRevision + 1 }), 409); await status(await f.outcome(g, "sent", { channelId: "31" }), 409)
    assert.equal((await read(await f.outcome(g))).recorded, true); assert.equal((await read(await f.outcome(g))).recorded, false); await status(await f.outcome(g, "uncertain"), 409)
})
test("Claimed rejection cannot claim failure without actual non-dispatch evidence", async test => {
    const f = fixture(test); await f.template(); await f.configure(); const current = f.member(); await read(await f.join(current)); const g = await reserved(f, current); await read(await f.dispatch(g, current))
    await status(await f.outcome(g, "failed"), 400); assert.equal((await read(await f.outcome(g, "failed", { noDispatch: true }))).recorded, true)
})
test("Unclaimed expiry cannot dispatch and claim winning first ages uncertain with no resend", async test => {
    const f = fixture(test); await f.template(); await f.configure(); const current = f.member(); await read(await f.join(current)); const g = await reserved(f, current); f.advance(180000)
    assert.equal((await read(await f.dispatch(g, current))).claimed, false); assert.equal((await read(await f.query({ type: "delivery", deliveryNo: g.deliveryNo }))).delivery.noDispatch, true)
    const next = f.member({ userId: "21" }); await read(await f.join(next)); const g2 = await reserved(f, next); await read(await f.dispatch(g2, next)); f.advance(190001); await f.t.mutation(internal.greetingLifecycle.cleanup, {})
    const row = (await read(await f.query({ type: "delivery", deliveryNo: g2.deliveryNo }))).delivery; assert.equal(row.state, "uncertain"); assert.equal(row.noDispatch, undefined); assert.equal((await read(await f.dispatch(g2, next))).claimed, false)
})
test("Late verified identity is retained without rewriting uncertain history and conflicts reject", async test => {
    const f = fixture(test); await f.template(); await f.configure(); const current = f.member(); await read(await f.join(current)); const g = await reserved(f, current); await read(await f.dispatch(g, current)); await read(await f.outcome(g, "uncertain")); const before = (await read(await f.query({ type: "delivery", deliveryNo: g.deliveryNo }))).delivery
    f.advance(1000); assert.equal((await read(await f.outcome(g))).recorded, true); const after = (await read(await f.query({ type: "delivery", deliveryNo: g.deliveryNo }))).delivery; assert.equal(after.state, "uncertain"); assert.equal(after.finishedAt, before.finishedAt); assert.equal(after.messageId, "500"); await status(await f.outcome(g, "sent", { messageId: "501" }), 409)
})
test("DM identity stays target-bound and reported channel is retained with verified message ID", async test => {
    const f = fixture(test); await f.template(); await f.configure("dm"); const current = f.member(); await read(await f.join(current)); const g = await reserved(f, current); assert.equal(g.channelId, undefined); await read(await f.dispatch(g, current)); await read(await f.outcome(g, "uncertain", { messageId: "501", channelId: "600" })); const row = (await read(await f.query({ type: "delivery", deliveryNo: g.deliveryNo }))).delivery; assert.equal(row.channelId, "600"); assert.equal(row.state, "uncertain")
})
test("Route disable fences unclaimed work without cancelling another route or claimed history", async test => {
    const f = fixture(test); await f.template(); await f.configure(); await f.configure("dm"); const current = f.member(); await read(await f.join(current)); const candidates = (await read(await f.pending())).candidates
    const welcome = candidates.find((x: any) => x.route === "welcome"), dm = candidates.find((x: any) => x.route === "dm"), g = (await read(await f.reserve(welcome, current))).grant
    await read(await f.manage({ type: "module", route: "dm", enabled: false })); assert.equal((await read(await f.dispatch(g, current))).claimed, true); await read(await f.manage({ type: "module", route: "welcome", enabled: false })); assert.equal((await read(await f.reserve(dm, current))).status, "cancelled"); await read(await f.outcome(g))
})
test("Eligibility deferral is at least sixty seconds and does not reopen a reserved grant", async test => {
    const f = fixture(test); await f.template(); await f.configure(); const current = f.member(); await read(await f.join(current)); const c = (await read(await f.pending())).candidates[0]
    await read(await f.http("/greetings/defer", { ...f.binding(c), reason: "eligibility" })); let pending = await read(await f.pending()); assert.equal(pending.candidates.length, 0); assert.equal(pending.nextCheckAt, f.now() + 60000)
    f.advance(60000); const g = await reserved(f, current); assert.equal((await read(await f.http("/greetings/defer", { ...f.binding(g), reason: "eligibility" }))).deferred, false)
})
test("An explicit user mention renders only the greeted member", async test => {
    const f = fixture(test); await f.template({ content: "Welcome {user.mention}" }); await f.configure()
    const current = f.member(); await read(await f.join(current)); const grant = await reserved(f, current)
    assert.equal(grant.content.content, "Welcome <@20>")
})
test("A confirmed departure without a stored join record admits one goodbye", async test => {
    const f = fixture(test); await f.template({ content: "Goodbye {user.name}" }); await f.configure("goodbye")
    const operation = { type: "departed", userId: "20", userName: "Old Member", serverName: "Synthetic Server", observedAt: f.now(), memberAbsent: true }
    const departed = await read(await f.http("/greetings/observe", { serverId: "1", operation }))
    assert.equal(departed.recorded, true); assert.equal(departed.admitted, 1); assert.equal(departed.member.present, false)
    assert.equal((await read(await f.http("/greetings/observe", { serverId: "1", operation }))).admitted, 0)
    const c = (await read(await f.pending())).candidates[0], g = (await read(await f.reserve(c, null))).grant
    assert.equal(g.route, "goodbye"); assert.equal(g.content.content, "Goodbye Old Member")
})
test("Never-observed removal is suppressed and exact known absence admits only one goodbye", async test => {
    const f = fixture(test); await f.template({ content: "Goodbye {user.id}" }); await f.configure("goodbye"); const current = f.member()
    assert.equal((await read(await f.http("/greetings/member", { serverId: "1", userId: "20" }))).member, null)
    assert.equal((await read(await f.http("/greetings/observe", { serverId: "1", operation: { type: "absent", userId: "20", joinedAt: current.joinedAt, expectedGeneration: 1, observedAt: f.now(), memberAbsent: true } }))).admitted, 0)
    const join = await read(await f.join(current)), operation = { type: "absent", userId: "20", joinedAt: current.joinedAt, expectedGeneration: join.member.generation, observedAt: f.now(), memberAbsent: true }
    const absent = await read(await f.http("/greetings/observe", { serverId: "1", operation })); assert.equal(absent.admitted, 1)
    assert.equal((await read(await f.http("/greetings/observe", { serverId: "1", operation: { ...operation, expectedGeneration: absent.member.generation } }))).admitted, 0)
    const c = (await read(await f.pending())).candidates[0], g = (await read(await f.reserve(c, null))).grant; assert.equal(g.route, "goodbye"); assert.equal((await read(await f.dispatch(g, null))).claimed, true)
})
test("Fresh member200 and rejoin cancel obsolete goodbye without synthetic join admission", async test => {
    const f = fixture(test); await f.template(); await f.configure("goodbye"); const current = f.member(); const joined = await read(await f.join(current))
    const absent = await read(await f.http("/greetings/observe", { serverId: "1", operation: { type: "absent", userId: "20", joinedAt: current.joinedAt, expectedGeneration: joined.member.generation, observedAt: f.now(), memberAbsent: true } })); const c = (await read(await f.pending())).candidates[0]
    f.advance(1000); await read(await f.http("/greetings/observe", { serverId: "1", operation: { type: "present", expectedGeneration: absent.member.generation, observedAt: f.now(), member: f.member() } })); assert.equal((await read(await f.reserve(c, null))).status, "terminal")
    assert.equal((await f.t.run(c => c.db.query("greetingDeliveries").collect())).length, 1)
})
test("Older observedAt or generation cannot replace newer membership", async test => {
    const f = fixture(test); await f.template(); await f.configure(); const old = f.member(), first = await read(await f.join(old)); f.advance(1000); const second = await read(await f.join(f.member()))
    await status(await f.http("/greetings/observe", { serverId: "1", operation: { type: "present", expectedGeneration: first.member.generation, observedAt: f.now(), member: old } }), 409)
    await status(await f.http("/greetings/observe", { serverId: "1", operation: { type: "present", expectedGeneration: second.member.generation, observedAt: f.now() - 1, member: old } }), 409)
})
test("Verified wake accepts preexisting unowned access only with current acknowledgment and fresh role", async test => {
    const f = fixture(test); await f.template(); await f.configure("welcome", "verified"); const panel = await f.verification(), current = f.member({ roleIds: ["40"] }); await read(await f.join(current)); assert.equal((await read(await f.pending())).candidates.length, 0)
    const ack = await f.verify(panel, current); assert.equal(ack.acknowledgment.accessConfirmed, true); assert.equal((await read(await f.pending({ userId: "20" }))).candidates.length, 1)
    const candidate = (await read(await f.pending())).candidates[0]; assert.equal((await read(await f.reserve(candidate, { ...current, roleIds: [] }))).status, "waiting")
    await read(await f.http("/greetings/observe", { serverId: "1", operation: { type: "present", expectedGeneration: candidate.memberGeneration, observedAt: f.now(), member: current } })); const g = await reserved(f, current); assert.equal((await read(await f.dispatch(g, current))).claimed, true)
})
test("Bounded startup discovery wakes an already-current acknowledgment without granting native access", async test => {
    const f = fixture(test); await f.template(); await f.configure("welcome", "verified"); const panel = await f.verification(), current = f.member({ roleIds: ["40"] }); await f.verify(panel, current); await read(await f.join(current))
    assert.equal((await read(await f.pending())).candidates.length, 0); const discovered = await read(await f.http("/greetings/discover", { serverId: "1", userId: "20" })); assert.equal(discovered.examined, 1); assert.equal(discovered.queued, 1)
    const c = (await read(await f.pending())).candidates[0]; assert.equal((await read(await f.reserve(c, { ...current, roleIds: [] }))).status, "waiting")
})
test("Disabled verification and uncertain role addition do not fail open", async test => {
    const f = fixture(test); await f.template(); await f.configure("welcome", "verified"); const panel = await f.verification(), current = f.member(); await read(await f.join(current)); const evaluation = await f.verify(panel, current), g = evaluation.grant
    const binding = { serverId: "1", attemptId: g.attemptId, ownershipId: g.ownershipId, generation: g.generation, sourceId: g.sourceId, claimToken: "c".repeat(32) }
    await read(await f.http("/roles/dispatch", { ...binding, context: f.roleMember(current) })); await read(await f.http("/roles/outcome", { ...binding, outcome: "uncertain" }))
    const c = (await read(await f.pending())).candidates[0]; assert.equal((await read(await f.reserve(c, { ...current, roleIds: ["40"] }))).status, "waiting")
    await read(await f.roleManage({ type: "settings", patch: { verificationEnabled: false }, roles: roleSnapshots })); assert.equal((await read(await f.http("/greetings/discover", { serverId: "1" }))).queued, 0)
})
test("Claim repeats fresh security eligibility before dispatch", async test => {
    const f = fixture(test); await f.template(); await f.configure(); const current = f.member(); await read(await f.join(current)); const g = await reserved(f, current)
    await read(await f.http("/moderation/manage", { ...f.source(), actor: owner, operation: { type: "settings", patch: { defcon: 2 } } })); assert.equal((await read(await f.dispatch(g, current))).claimed, false)
    await read(await f.http("/moderation/manage", { ...f.source(), actor: owner, operation: { type: "settings", patch: { defcon: 3 } } })); await read(await f.dispatch(g, current))
    assert.equal((await read(await f.outcome(g))).recorded, true)
})
test("Staff preview uses invoking member only and creates no delivery admission", async test => {
    const f = fixture(test); await f.template(); await f.configure(); const p = { type: "preview", route: "welcome", userId: "10", userName: "Staff", serverName: "Server", channelId: "30" }
    assert.equal((await read(await f.query(p))).content.content, "Welcome Staff to Server"); await status(await f.query({ ...p, userId: "20" }), 403); assert.equal((await f.t.run(c => c.db.query("greetingDeliveries").collect())).length, 0)
})
test("Public history uses monotonic numeric identity without a provider cursor", async test => {
    const f = fixture(test); await f.template(); await f.configure(); for (let i = 0; i < 12; i++) await read(await f.join(f.member({ userId: String(100 + i) })))
    const a = await read(await f.query({ type: "deliveries" })); assert.equal(a.deliveries.length, 10); assert.equal(a.nextBeforeDeliveryNo, 3); assert.equal(a.nextCursor, undefined)
    const b = await read(await f.query({ type: "deliveries", beforeDeliveryNo: a.nextBeforeDeliveryNo })); assert.deepEqual(b.deliveries.map((d: any) => d.deliveryNo), [2, 1]); assert.equal(b.nextBeforeDeliveryNo, undefined)
})
test("Finite terminal retention cleans unknown ephemeral audit without replay", async test => {
    const f = fixture(test); await f.template(); await f.configure(); const current = f.member(); await read(await f.join(current)); const g = await reserved(f, current); await read(await f.dispatch(g, current)); await read(await f.outcome(g, "uncertain")); f.advance(30 * 86400000 + 1); await f.t.mutation(internal.greetingLifecycle.cleanup, {})
    await status(await f.query({ type: "delivery", deliveryNo: g.deliveryNo }), 404); await status(await f.join(current), 400)
})
test("Full expired-pending batch with open claimed windows cannot schedule cleanup spin", async test => {
    const f = fixture(test); await f.template(); await f.configure(); await read(await f.manage({ type: "settings", claimsPerMinute: 60 }))
    for (let i = 0; i < 32; i++) { const current = f.member({ userId: String(100 + i) }); await read(await f.join(current)); const g = await reserved(f, current); await read(await f.dispatch(g, current)); await f.t.run(c => c.db.patch(c.db.normalizeId("greetingDeliveries", g.deliveryId)!, { pendingExpiresAt: f.now() - 1 })); f.advance(1000) }
    await f.t.mutation(internal.greetingLifecycle.cleanup, {}); const jobs = await f.t.run(c => c.db.system.query("_scheduled_functions").collect()); assert.equal(jobs.filter(j => j.name.includes("greetingLifecycle")).length, 0); assert.equal((await f.t.run(c => c.db.query("greetingDeliveries").collect())).filter(r => r.state === "reserved").length, 32)
})
test("Exact epoch wake ignores preceding old-epoch waiting deliveries", async test => {
    const f = fixture(test); await f.template(); await f.configure("welcome", "verified"); const panel = await f.verification(), current = f.member({ roleIds: ["40"] }); await read(await f.join(current)); const original = (await f.t.run(c => c.db.query("greetingDeliveries").first()))!
    await f.t.run(async c => { for (let i = 0; i < 5; i++) { const { _id, _creationTime, ...row } = original; await c.db.insert("greetingDeliveries", { ...row, deliveryNo: 100 + i, joinedAt: new Date(f.now() - 1000 - i).toISOString() }) } }); await f.verify(panel, current)
    assert.equal((await read(await f.pending())).candidates.length, 1)
})
test("Deleted membership tombstone cannot turn duplicate claimed reserve into a crash", async test => {
    const f = fixture(test); await f.template(); await f.configure("goodbye"); const current = f.member(), joined = await read(await f.join(current))
    await read(await f.http("/greetings/observe", { serverId: "1", operation: { type: "absent", userId: "20", joinedAt: current.joinedAt, expectedGeneration: joined.member.generation, observedAt: f.now(), memberAbsent: true } })); const c = (await read(await f.pending())).candidates[0], g = (await read(await f.reserve(c, null))).grant; await read(await f.dispatch(g, null))
    await f.t.run(async ctx => { const m = await ctx.db.query("greetingMembers").first(); await ctx.db.delete(m!._id) }); assert.equal((await read(await f.reserve(c, null))).status, "terminal")
})
test("Due waiting discovery advances deferral and advertises one bounded future server wake", async test => {
    const f = fixture(test); await f.template(); await f.configure("welcome", "verified"); await read(await f.join())
    const result = await read(await f.http("/greetings/discover", { serverId: "1" })); assert.equal(result.examined, 1); assert.equal(result.queued, 0); assert.equal((await read(await f.pending())).nextCheckAt, f.now() + 60000)
    assert.equal((await read(await f.http("/greetings/discover", { serverId: "1" }))).examined, 0)
})
test("Internal multi-page scans bind a fixed cutoff across controlled clock advancement", async test => {
    const f = fixture(test); await f.template(); await f.configure(); for (let i = 0; i < 12; i++) await read(await f.join(f.member({ userId: String(100 + i) })))
    const first = await read(await f.pending()); assert.equal(first.candidates.length, 10); assert(first.nextCursor); f.advance(1000)
    await status(await f.pending({ cursor: first.nextCursor }), 400); const second = await read(await f.pending({ cursor: first.nextCursor, scanAt: first.scanAt })); assert.equal(second.candidates.length, 2); assert.equal(second.scanAt, first.scanAt)
})
