import assert from "node:assert/strict"
import { test, beforeEach, afterEach, mock } from "node:test"
import { ConvexError } from "convex/values"
import { convexTest } from "convex-test"
import schema from "../convex/schema.ts"
import { api, internal } from "../convex/_generated/api.js"
import { botCall } from "./bot-service.ts"

const modules = {
    "../convex/dashboard.ts": () => import("../convex/dashboard.ts"),
    "../convex/dashboardRoles.ts": () => import("../convex/dashboardRoles.ts"),
    "../convex/dashboardMessages.ts": () => import("../convex/dashboardMessages.ts"),
    "../convex/dashboardMetadata.ts": () => import("../convex/dashboardMetadata.ts"),
    "../convex/dashboardViews.ts": () => import("../convex/dashboardViews.ts"),
    "../convex/metadataLogs.ts": () => import("../convex/metadataLogs.ts"),
    "../convex/roles.ts": () => import("../convex/roles.ts"),
    "../convex/publishing.ts": () => import("../convex/publishing.ts"),
    "../convex/generalSettings.ts": () => import("../convex/generalSettings.ts"),
    "../convex/responses.ts": () => import("../convex/responses.ts"),
    "../convex/botService.ts": () => import("../convex/botService.ts"),
    "../convex/installations.ts": () => import("../convex/installations.ts"),
    "../convex/_generated/api.js": () => import("../convex/_generated/api.js"),
    "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
}
const prior = { ...process.env }
let permission = "32", userId = "20", clientId = "30"
beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout"] })
    permission = "32"; userId = "20"; clientId = "30"
    process.env.NEONFLUX_SERVER_ID = "10"
    process.env.FLUXER_CLIENT_ID = "30"
    process.env.NEONFLUX_BOT_API_SECRET = "synthetic-dashboard-test-secret-000000000"
    delete process.env.NEONFLUX_SERVER_MODE; delete process.env.NEONFLUX_SERVER_IDS
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === "https://fluxer.app/.well-known/fluxer") return Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-provider-token")
        if (url.endsWith("/v1/oauth2/@me")) return Response.json({ application: { id: clientId }, scopes: ["identify", "guilds"], user: { id: userId, username: "Test member", bot: false, system: false } })
        if (url.endsWith("/v1/guilds/10")) return Response.json({ id: "10", owner_id: "99", channels: [{ id: "50", guild_id: "10", name: "general", type: 0 }], roles: [{ id: "40", name: "Member", position: 1, hoist: true, hoist_position: 7 }] })
        if (url.endsWith("/v1/users/@me/guilds?limit=100")) return Response.json([{ id: "10", name: "Test server", icon: "a_icon1", owner_id: "99", permissions: permission }])
        throw new Error("Unexpected synthetic provider route")
    })
})
afterEach(() => {
    mock.restoreAll()
    mock.timers.reset()
    for (const key of ["NEONFLUX_SERVER_ID", "NEONFLUX_SERVER_MODE", "NEONFLUX_SERVER_IDS", "NEONFLUX_BOT_API_SECRET", "FLUXER_CLIENT_ID"]) {
        if (prior[key] === undefined) delete process.env[key]
        else process.env[key] = prior[key]
    }
})
const backend = () => convexTest({ schema, modules, transactionLimits: true })
const installation = (t: ReturnType<typeof backend>, operation: "join" | "leave", serverId: string) => botCall(t, `/service/installations/${operation}`, { serverId })
const metadataRecipient = (ownerId = "99", channelId = "50") => ({ originServerId: "10", observedAt: Date.now(), actor: { originServerId: "10", userId: ownerId, roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }, member: { originServerId: "10", userId: ownerId, joinedAt: "2020-01-01T00:00:00Z", roleIds: [], isBot: false, timeoutUntil: null, canView: true, canReadHistory: true }, botMember: { originServerId: "10", userId: "999", joinedAt: "2020-01-01T00:00:00Z", roleIds: [], isBot: true, timeoutUntil: null, canView: true, canReadHistory: true }, channelId, channelType: 0, botId: "999", botAuthorized: true, actorAuthorized: true, actorKind: "human", botKind: "bot" })

test("Logging dashboard jobs share reactive configuration revisions and emit one safe settings snapshot", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }), args = { sessionToken: admitted.sessionToken, serverId: "10" }
    const initial = await t.query(api.dashboardMetadata.snapshot, args)
    assert.equal(initial.settings.configRevision, 0); assert.deepEqual(initial.settings.eventRoutes, [])
    assert.deepEqual(await t.run(ctx => ctx.db.query("metadataLogSettings").collect()), [])
    const input = { ...args, requestId: "00000000-0000-4000-8000-000000000001", expectedConfigRevision: 0, operation: { type: "module", expectedRevision: 1, enabled: true } }
    const queued = await t.action(api.dashboardMetadata.queue, input)
    assert(queued.queued); assert.equal((await t.action(api.dashboardMetadata.queue, input)).jobId, queued.jobId)
    await assert.rejects(t.action(api.dashboardMetadata.queue, { ...input, operation: { ...input.operation, enabled: false } }))
    const request = { serverId: "10", originServerId: "10", jobId: queued.jobId, actorId: "20", managerAuthorized: true, observedAt: Date.now() }
    const applied = await t.mutation(internal.dashboardMetadata.execute, { request })
    assert.equal(applied.job.state, "applied"); assert.equal(applied.settings!.configRevision, 1)
    const records = await t.run(ctx => ctx.db.query("metadataLogRecords").collect())
    assert.equal(records.length, 1); assert.deepEqual(records[0]!.event.source, { kind: "dashboard", jobId: queued.jobId, scope: "metadata" }); assert.deepEqual(records[0]!.event.actor, { kind: "configuration", userId: "20" })
    assert.deepEqual(records[0]!.event.changedFields, ["enabled"]); assert.match(records[0]!.presentation!.embed.title, /Settings changed/)
    assert(!JSON.stringify(applied).includes("synthetic-provider-token"))
    await t.mutation(internal.dashboardMetadata.execute, { request })
    assert.equal((await t.run(ctx => ctx.db.query("metadataLogRecords").collect())).length, 1)
    assert.equal((await t.query(api.dashboardMetadata.snapshot, args)).settings.configRevision, 1)
    assert.deepEqual(await t.action(api.dashboardMetadata.queue, { ...input, requestId: "00000000-0000-4000-8000-000000000002" }), { queued: false, conflict: true, revision: 1 })
    await assert.rejects(t.mutation(internal.metadataLogs.admit, { request: { serverId: "10", event: records[0]!.event } }))
})

test("Manage Server logging configuration keeps route-owner native authority separate and rejects browser evidence", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }), args = { sessionToken: admitted.sessionToken, serverId: "10" }
    const operation = { type: "route", category: "membership", expectedRevision: 1, enabled: true, channelId: "50", ownerId: "99" }
    const input = { ...args, requestId: "00000000-0000-4000-8000-000000000003", expectedConfigRevision: 0, operation }
    await assert.rejects(t.action(api.dashboardMetadata.queue, { ...input, operation: { ...operation, recipientOwner: metadataRecipient() } }))
    const queued = await t.action(api.dashboardMetadata.queue, input), request = { serverId: "10", originServerId: "10", jobId: queued.jobId, actorId: "20", managerAuthorized: true, observedAt: Date.now() }
    await assert.rejects(t.mutation(internal.dashboardMetadata.execute, { request }))
    const recipientOwner = metadataRecipient()
    for (const invalid of [{ ...recipientOwner, actor: { ...recipientOwner.actor, isOwner: false } }, { ...recipientOwner, botAuthorized: false }, { ...recipientOwner, channelId: "51" }, { ...recipientOwner, actor: { ...recipientOwner.actor, userId: "20" } }]) await assert.rejects(t.mutation(internal.dashboardMetadata.execute, { request: { ...request, recipientOwner: invalid } }))
    const applied = await t.mutation(internal.dashboardMetadata.execute, { request: { ...request, recipientOwner } })
    assert.equal(applied.job.state, "applied"); assert.equal(applied.settings!.routes.find(route => route.category === "membership")!.ownerId, "99")
    assert.equal(applied.settings!.configRevision, 1)
    const disabled = await t.action(api.dashboardMetadata.queue, { ...args, requestId: "00000000-0000-4000-8000-000000000004", expectedConfigRevision: 1, operation: { type: "event-route", eventType: "member-add", expectedRevision: 1, enabled: false } })
    const result = await t.mutation(internal.dashboardMetadata.execute, { request: { ...request, jobId: disabled.jobId } })
    assert.equal(result.job.state, "applied"); assert.equal(result.settings!.eventRoutes[0]!.enabled, false)
})

test("Logging jobs reject chat drift, revoked sessions, foreign scopes and stale native manager proof", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }), args = { sessionToken: admitted.sessionToken, serverId: "10" }
    const queued = await t.action(api.dashboardMetadata.queue, { ...args, requestId: "00000000-0000-4000-8000-000000000005", expectedConfigRevision: 0, operation: { type: "module", expectedRevision: 1, enabled: true } })
    const request = { serverId: "10", originServerId: "10", jobId: queued.jobId, actorId: "20", managerAuthorized: true, observedAt: Date.now() }
    await assert.rejects(t.mutation(internal.dashboardMetadata.execute, { request: { ...request, observedAt: Date.now() - 60001 } }))
    await t.mutation(internal.metadataLogs.manage, { request: { serverId: "10", messageId: "100", createdAt: Date.now(), context: metadataRecipient(), operation: { type: "module", expectedRevision: 1, enabled: false } } })
    assert.equal((await t.mutation(internal.dashboardMetadata.execute, { request })).job.state, "conflict")
    const next = await t.action(api.dashboardMetadata.queue, { ...args, requestId: "00000000-0000-4000-8000-000000000006", expectedConfigRevision: 1, operation: { type: "module", expectedRevision: 2, enabled: true } })
    await t.mutation(api.dashboard.logout, { sessionToken: admitted.sessionToken })
    assert.equal((await t.mutation(internal.dashboardMetadata.execute, { request: { ...request, jobId: next.jobId } })).job.state, "failed")
    await assert.rejects(t.query(api.dashboardMetadata.snapshot, args))
    assert.equal((await t.run(ctx => ctx.db.query("metadataLogSettings").collect()))[0]!.configRevision, 1)
})
test("Manage Server admits scoped reactive reads without exposing provider credentials", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" })
    assert.deepEqual(admitted.servers, [{ id: "10", name: "Test server", icon: "https://fluxerusercontent.com/icons/10/a_icon1.webp?size=128&animated=false" }])
    assert.equal(admitted.mode, "single")
    assert.equal(JSON.stringify(admitted).includes("synthetic-provider-token"), false)
    const state = await t.query(api.dashboardViews.general, { sessionToken: admitted.sessionToken, serverId: "10" })
    assert.deepEqual(state, { serverId: "10", prefix: "!", revision: 0 })
    await assert.rejects(t.query(api.dashboardViews.general, { sessionToken: admitted.sessionToken, serverId: "11" }))
    await assert.rejects(t.query(api.dashboardViews.general, { sessionToken: "a".repeat(64), serverId: "10" }))
    await t.mutation(api.dashboard.logout, { sessionToken: admitted.sessionToken })
    await assert.rejects(t.query(api.dashboardViews.general, { sessionToken: admitted.sessionToken, serverId: "10" }))
})
test("Rejects a foreign OAuth app and preserves ordinary member verification admission", async () => {
    const t = backend()
    clientId = "31"
    await assert.rejects(t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }))
    clientId = "30"; permission = "0"
    const admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" })
    assert.deepEqual(admitted.servers, [])
    await assert.rejects(t.query(api.dashboardViews.general, { sessionToken: admitted.sessionToken, serverId: "10" }))
})
test("Prefix chat changes are shared immediately and stale browser saves preserve newer state", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" })
    const args = { sessionToken: admitted.sessionToken, serverId: "10" }
    const response = await botCall(t, "/general/manage", { serverId: "10", actorId: "20", managerAuthorized: true, prefix: "?", expectedRevision: 0 })
    assert.equal(response.status, 200)
    assert.deepEqual(await t.query(api.dashboardViews.general, args), { serverId: "10", prefix: "?", revision: 1 })
    assert.deepEqual(await t.action(api.dashboard.save, { ...args, section: "general", expectedRevision: 0, prefix: "$" }), { saved: false, conflict: true, revision: 1 })
    assert.deepEqual(await t.query(api.dashboardViews.general, args), { serverId: "10", prefix: "?", revision: 1 })
    assert.deepEqual(await t.action(api.dashboard.save, { ...args, section: "general", expectedRevision: 1, prefix: "$" }), { saved: true, revision: 2 })
    permission = "0"
    await assert.rejects(t.action(api.dashboard.save, { ...args, section: "general", expectedRevision: 2, prefix: "!" }))
    await assert.rejects(t.query(api.dashboardViews.general, args))
})
test("Expired session cannot read or save even before scheduled invalidation runs", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" })
    mock.method(Date, "now", () => admitted.expiresAt)
    await assert.rejects(t.query(api.dashboardViews.general, { sessionToken: admitted.sessionToken, serverId: "10" }))
    await assert.rejects(t.action(api.dashboard.save, { sessionToken: admitted.sessionToken, serverId: "10", section: "general", expectedRevision: 0, prefix: "?" }))
    await t.finishAllScheduledFunctions(() => mock.timers.tick(300000))
    assert.deepEqual(await t.run(ctx => ctx.db.query("dashboardSessions").collect()), [])
})

test("Dashboard reservations use queued native role safety, fresh manager grants and configuration revisions", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" })
    const args = { sessionToken: admitted.sessionToken, serverId: "10", section: "autorole" as const, expectedRevision: 0,
        operation: { type: "settings", patch: { reservations: [{ userId: "123", roleIds: ["40"] }], autoroleEnabled: true } } }
    const queued = await t.action(api.dashboardRoles.queue, args)
    assert.equal(queued.queued, true)
    const request = { serverId: "10", originServerId: "10", jobId: queued.jobId, actorId: "20", managerAuthorized: true, observedAt: Date.now(), roles: [{ originServerId: "10", roleId: "40", permissions: "0", botCanManage: true, actorCanManage: true }] }
    await assert.rejects(t.mutation(internal.dashboardRoles.execute, { request: { ...request, roles: request.roles.map(role => ({ ...role, actorCanManage: false })) } }))
    const result = await t.mutation(internal.dashboardRoles.execute, { request })
    assert.equal(result.job.state, "applied")
    const current = await t.query(api.dashboardViews.roles, { sessionToken: admitted.sessionToken, serverId: "10" })
    assert.deepEqual(current.roles.settings.reservations, args.operation.patch.reservations)
    assert.equal(current.roles.revision, 1)
    assert.deepEqual(await t.action(api.dashboardRoles.queue, args), { queued: false, conflict: true, revision: 1 })
    const revoke = await t.action(api.dashboardRoles.queue, { ...args, expectedRevision: 1, operation: { type: "settings", patch: { reservations: [] } } })
    const failed = await t.mutation(internal.dashboardRoles.execute, { request: { ...request, jobId: revoke.jobId, managerAuthorized: false } })
    assert.equal(failed.job.state, "failed")
    assert.deepEqual((await t.query(api.dashboardViews.roles, { sessionToken: admitted.sessionToken, serverId: "10" })).roles.settings.reservations, args.operation.patch.reservations)
})
test("A dashboard manager configures and publishes through one exact native publishing claim", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }), args = { sessionToken: admitted.sessionToken, serverId: "10" }
    const queued = await t.action(api.dashboardRoles.queue, { ...args, section: "verification", expectedRevision: 0,
        operation: { type: "panel-create", name: "rules", kind: "verification", exclusive: false, mappings: [{ emoji: "✅", roleId: "40", prerequisiteRoleIds: [], exclusionRoleIds: [] }] }, publication: { channelId: "50", content: { content: "Read and accept the rules", embed: { title: "Rules", fields: [{ name: "Accept", value: "Use the reaction" }] } } } })
    assert.equal(queued.queued, true)
    const post = async (route: string, body: object) => {
        const response = await botCall(t, route, { serverId: "10", ...body })
        assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
        return response.json()
    }
    const executed = await post("/dashboard-roles/execute", { originServerId: "10", jobId: queued.jobId, actorId: "20", managerAuthorized: true, observedAt: Date.now(), roles: [{ originServerId: "10", roleId: "40", permissions: "0", botCanManage: true, actorCanManage: true }] })
    assert.equal(executed.job.state, "configured")
    const context = { originServerId: "10", jobId: queued.jobId!, actorId: "20", managerAuthorized: true, observedAt: Date.now(), botId: "60", channelId: "50" }
    const reserved = await post("/dashboard-roles/reserve", context), grant = reserved.grant
    assert.equal(grant.source.type, "dashboard-role")
    assert.equal(grant.provenance.panelName, "rules")
    assert.equal((await post("/dashboard-roles/reserve", context)).grant, null)
    const binding = { serverId: "10", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId }
    await assert.rejects(t.mutation(internal.publishing.dispatch, { request: { ...binding, claimToken: "a".repeat(32), dashboardContext: { ...context, actorId: "21" } } }))
    const claimed = await t.mutation(internal.publishing.dispatch, { request: { ...binding, claimToken: "a".repeat(32), dashboardContext: context } })
    assert.equal(claimed.claimed, true)
    assert.equal((await t.mutation(internal.publishing.dispatch, { request: { ...binding, claimToken: "b".repeat(32), dashboardContext: context } })).claimed, false)
    await t.mutation(internal.publishing.outcome, { request: { ...binding, claimToken: "a".repeat(32), outcome: "sent", messageId: "70" } })
    assert.equal((await post("/dashboard-roles/complete", { jobId: queued.jobId })).job.state, "applied")
    const snapshot = await t.query(api.dashboardViews.roles, args)
    assert.equal(snapshot.roles.panels[0]!.published!.messageId, "70")
    assert.equal(snapshot.roles.revision, 2)
    assert.equal((await t.run(ctx => ctx.db.query("roleReferences").collect()))[0]!.postNo, grant.postNo)
})
test("Queued roles changes preserve later chat changes and fresh native permission loss", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }), args = { sessionToken: admitted.sessionToken, serverId: "10" }
    const queued = await t.action(api.dashboardRoles.queue, { ...args, section: "reaction", expectedRevision: 0, operation: { type: "settings", patch: { panelsEnabled: true } } })
    await t.mutation(internal.roles.manage, { request: { serverId: "10", messageId: "80", createdAt: Date.now(), actor: { originServerId: "10", userId: "99", roleIds: [], isOwner: true, isAdministrator: false, nativePermissionAuthorized: true }, operation: { type: "settings", patch: { verificationEnabled: true } } } })
    const executed = await t.mutation(internal.dashboardRoles.execute, { request: { serverId: "10", jobId: queued.jobId, actorId: "20", managerAuthorized: true, observedAt: Date.now(), roles: [] } })
    assert.equal(executed.job.state, "conflict")
    assert.equal((await t.query(api.dashboardViews.roles, args)).roles.settings.panelsEnabled, false)
    const second = await t.action(api.dashboardRoles.queue, { ...args, section: "reaction", expectedRevision: 1, operation: { type: "settings", patch: { panelsEnabled: true } } })
    assert.equal((await t.mutation(internal.dashboardRoles.execute, { request: { serverId: "10", jobId: second.jobId, actorId: "20", managerAuthorized: false, observedAt: Date.now(), roles: [] } })).job.state, "failed")
})
test("Custom responses match and render arguments with the current shared prefix", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" })
    await t.mutation(internal.responses.manage, { request: { serverId: "10", messageId: "90", createdAt: Date.now(), actorId: "20", adminAuthorized: true, kind: "custom", operation: { type: "create", name: "hello", reply: { type: "text", text: "Hi {args}" } } } })
    await t.action(api.dashboard.save, { sessionToken: admitted.sessionToken, serverId: "10", section: "general", expectedRevision: 0, prefix: "??" })
    const event = { serverId: "10", createdAt: Date.now(), channelId: "50", userId: "20", userName: "Test member", roleIds: [] }
    assert.deepEqual(await t.mutation(internal.responses.evaluate, { request: { ...event, messageId: "91", content: "!hello friends" } }), { send: false })
    const evaluated = await t.mutation(internal.responses.evaluate, { request: { ...event, messageId: "92", content: "??hello friends" } })
    assert.equal(evaluated.send, true)
    if (evaluated.send) assert.deepEqual(evaluated.reply, { type: "text", text: "Hi friends" })
})
test("Hosted discovery redirects are bounded and never forward bearer credentials", async () => {
    const originalFetch = globalThis.fetch
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "https://fluxer.app/.well-known/fluxer") {
            assert.equal(new Headers(init?.headers).has("Authorization"), false)
            return new Response(null, { status: 308, headers: { Location: "https://api.fluxer.app/.well-known/fluxer" } })
        }
        if (String(input) === "https://api.fluxer.app/.well-known/fluxer") {
            assert.equal(new Headers(init?.headers).has("Authorization"), false)
            assert.equal(init?.redirect, "error")
            return Response.json({ endpoints: { api_public: "https://api.fluxer.app" } })
        }
        assert.equal(init?.redirect, "error")
        return originalFetch(input, init)
    })
    assert.equal((await backend().action(api.dashboard.admit, { accessToken: "synthetic-provider-token" })).servers[0]!.id, "10")
})

test("Catalog uses fresh scoped OAuth guild membership and returns only bounded names and IDs", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }), args = { sessionToken: admitted.sessionToken, serverId: "10" }
    assert.deepEqual(await t.action(api.dashboard.catalog, args), { serverId: "10", ownerId: "99", channels: [{ id: "50", name: "general", type: 0 }], roles: [{ id: "40", name: "Member", position: 1, hoist: true, hoistPosition: 7 }] })
    await assert.rejects(t.action(api.dashboard.catalog, { ...args, serverId: "11" }))
    await assert.rejects(t.query(api.dashboardViews.general, args))
    const second = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" })
    permission = "0"
    await assert.rejects(t.action(api.dashboard.catalog, { ...args, sessionToken: second.sessionToken }))
    await assert.rejects(t.query(api.dashboardViews.general, { ...args, sessionToken: second.sessionToken }))
})
test("Standalone dashboard content validates and queue retries retain one existing publishing attempt and claim", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }), args = { sessionToken: admitted.sessionToken, serverId: "10", requestId: "00000000-0000-4000-8000-000000000001", channelId: "50", content: { content: "Hello", embed: { title: "News", fields: [{ name: "Topic", value: "Details", inline: true }] } } }
    const queued = await t.action(api.dashboardMessages.queue, args)
    assert.deepEqual(await t.action(api.dashboardMessages.queue, args), queued)
    await assert.rejects(t.action(api.dashboardMessages.queue, { ...args, content: { content: "Different" } }))
    await assert.rejects(t.action(api.dashboardMessages.queue, { ...args, requestId: "00000000-0000-4000-8000-000000000002", content: { content: "", embed: { color: 12 } } }))
    await assert.rejects(t.action(api.dashboardMessages.queue, { ...args, requestId: "00000000-0000-4000-8000-000000000002", content: { content: "", embed: { image: { url: "javascript:alert(1)" } } } }))
    assert.equal((await t.query(api.dashboardViews.messages, { sessionToken: args.sessionToken, serverId: "10" })).jobs.length, 1)
    const context = { originServerId: "10", jobId: queued.jobId, actorId: "20", managerAuthorized: true, observedAt: Date.now(), botId: "60", channelId: "50" }
    await assert.rejects(t.mutation(internal.dashboardMessages.reserve, { request: { serverId: "10", ...context, actorId: "21" } }))
    const reserved = await t.mutation(internal.dashboardMessages.reserve, { request: { serverId: "10", ...context } }), grant = reserved.grant!
    assert.deepEqual(grant.content, args.content)
    assert.equal(grant.source?.type, "dashboard-message")
    assert.equal(grant.provenance?.type, "dashboard-message")
    assert.equal((await t.mutation(internal.dashboardMessages.reserve, { request: { serverId: "10", ...context } })).grant, null)
    const binding = { serverId: "10", postNo: grant.postNo, attemptId: grant.attemptId, generation: grant.generation, sourceId: grant.sourceId }
    await assert.rejects(t.mutation(internal.publishing.dispatch, { request: { ...binding, claimToken: "a".repeat(32), dashboardContext: { ...context, channelId: "51" } } }))
    assert.equal((await t.mutation(internal.publishing.dispatch, { request: { ...binding, claimToken: "a".repeat(32), dashboardContext: context } })).claimed, true)
    assert.equal((await t.mutation(internal.publishing.dispatch, { request: { ...binding, claimToken: "b".repeat(32), dashboardContext: context } })).claimed, false)
    await assert.rejects(t.mutation(internal.publishing.outcome, { request: { ...binding, claimToken: "b".repeat(32), outcome: "sent", messageId: "70" } }))
    await t.mutation(internal.publishing.outcome, { request: { ...binding, claimToken: "a".repeat(32), outcome: "sent", messageId: "70" } })
    const result = await t.mutation(internal.dashboardMessages.complete, { request: { serverId: "10", jobId: queued.jobId } })
    assert.equal(result.job.state, "sent")
    assert.equal(result.job.messageId, "70")
    assert.equal((await t.run(ctx => ctx.db.query("publishingPosts").collect())).length, 1)
    assert.equal((await t.run(ctx => ctx.db.query("publishingAttempts").collect())).length, 1)
    const tracked = (await t.run(ctx => ctx.db.query("publishingPosts").collect()))[0]!
    assert.equal(tracked.messageId, "70")
    assert.deepEqual(tracked.confirmedContent, args.content)
})
test("Standalone dashboard jobs reject revoked provider, native authority and logged-out dispatch grants", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }), args = { sessionToken: admitted.sessionToken, serverId: "10", requestId: "00000000-0000-4000-8000-000000000001", channelId: "50", content: { content: "Hello" } }
    permission = "0"
    await assert.rejects(t.action(api.dashboardMessages.queue, args))
    assert.equal((await t.run(ctx => ctx.db.query("dashboardMessageJobs").collect())).length, 0)
    permission = "32"
    const second = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }), queued = await t.action(api.dashboardMessages.queue, { ...args, sessionToken: second.sessionToken })
    const context = { jobId: queued.jobId, actorId: "20", managerAuthorized: true, observedAt: Date.now(), botId: "60", channelId: "50" }
    await assert.rejects(t.mutation(internal.dashboardMessages.reserve, { request: { serverId: "10", ...context, managerAuthorized: false } }))
    const { grant } = await t.mutation(internal.dashboardMessages.reserve, { request: { serverId: "10", ...context } })
    await t.mutation(api.dashboard.logout, { sessionToken: second.sessionToken })
    await assert.rejects(t.mutation(internal.publishing.dispatch, { request: { serverId: "10", postNo: grant!.postNo, attemptId: grant!.attemptId, generation: grant!.generation, sourceId: grant!.sourceId, claimToken: "a".repeat(32), dashboardContext: context } }))
    assert.equal((await t.run(ctx => ctx.db.query("publishingAttempts").collect()))[0]!.dispatchedAt, undefined)
})
test("Unknown dashboard delivery expires as uncertain and remains owned without replay", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }), queued = await t.action(api.dashboardMessages.queue, { sessionToken: admitted.sessionToken, serverId: "10", requestId: "00000000-0000-4000-8000-000000000001", channelId: "50", content: { content: "Hello" } })
    const context = { jobId: queued.jobId, actorId: "20", managerAuthorized: true, observedAt: Date.now(), botId: "60", channelId: "50" }
    const { grant } = await t.mutation(internal.dashboardMessages.reserve, { request: { serverId: "10", ...context } })
    await t.mutation(internal.publishing.dispatch, { request: { serverId: "10", postNo: grant!.postNo, attemptId: grant!.attemptId, generation: grant!.generation, sourceId: grant!.sourceId, claimToken: "a".repeat(32), dashboardContext: context } })
    mock.method(Date, "now", () => grant!.dispatchExpiresAt + 10000)
    const completed = await t.mutation(internal.dashboardMessages.complete, { request: { serverId: "10", jobId: queued.jobId } })
    assert.equal(completed.job.state, "uncertain")
    assert.deepEqual(await t.query(internal.dashboardMessages.ready, { request: { serverId: "10" } }), { jobs: [] })
    await assert.rejects(t.mutation(internal.dashboardMessages.reserve, { request: { serverId: "10", ...context, observedAt: Date.now() } }))
    assert.equal((await t.run(ctx => ctx.db.query("publishingAttempts").collect()))[0]!.unresolved, true)
})
test("Multi-server sessions report their mode and only well-formed server icons, without storing icons", async () => {
    delete process.env.NEONFLUX_SERVER_ID; process.env.NEONFLUX_SERVER_MODE = "multi"
    const providerFetch = globalThis.fetch
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith("/v1/users/@me/guilds?limit=100")
        ? Response.json([{ id: "10", name: "Test server", icon: "../escape", owner_id: "99", permissions: "32" }, { id: "12", name: "Second server", icon: "b2", owner_id: "20", permissions: "0" }, { id: "13", name: "Unlisted", icon: null, owner_id: "20" }])
        : providerFetch(input, init))
    const t = backend()
    for (const serverId of ["10", "12"]) assert.equal((await installation(t, "join", serverId)).status, 200)
    const admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" })
    assert.equal(admitted.mode, "multi")
    assert.deepEqual(admitted.servers, [{ id: "10", name: "Test server", icon: null }, { id: "12", name: "Second server", icon: "https://fluxerusercontent.com/icons/12/b2.webp?size=128&animated=false" }])
    assert.deepEqual((await t.run(ctx => ctx.db.query("dashboardSessions").collect()))[0]!.servers, [{ id: "10", name: "Test server" }, { id: "12", name: "Second server" }])
})
test("Multi-server dashboards list installed servers the user manages and drop removed servers", async () => {
    delete process.env.NEONFLUX_SERVER_ID; process.env.NEONFLUX_SERVER_MODE = "multi"
    const providerFetch = globalThis.fetch
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith("/v1/users/@me/guilds?limit=100")
        ? Response.json([{ id: "10", name: "Managed", icon: null, owner_id: "99", permissions: "32" }, { id: "12", name: "Owned", icon: null, owner_id: "20", permissions: "0" },
            { id: "13", name: "Not installed", icon: null, owner_id: "20" }, { id: "14", name: "Member only", icon: null, owner_id: "99", permissions: "0" }])
        : providerFetch(input, init))
    const t = backend()
    for (const serverId of ["10", "12", "14"]) assert.equal((await installation(t, "join", serverId)).status, 200)
    const admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }), args = { sessionToken: admitted.sessionToken, serverId: "12" }
    const listed = async () => (await t.action(api.dashboard.refresh, { sessionToken: admitted.sessionToken })).servers.map(server => server.id)
    assert.deepEqual(admitted.servers.map(server => server.id), ["10", "12"])
    assert.equal((await t.query(api.dashboardViews.general, args)).serverId, "12")
    for (const serverId of ["13", "14"]) await assert.rejects(t.query(api.dashboardViews.general, { ...args, serverId }))
    assert.equal((await installation(t, "leave", "12")).status, 200)
    await assert.rejects(t.query(api.dashboardViews.general, args))
    await assert.rejects(t.action(api.dashboard.catalog, args), (error: unknown) => error instanceof ConvexError && (error.data as { status?: number }).status === 403)
    assert.deepEqual(await listed(), ["10"])
    assert.deepEqual((await t.run(ctx => ctx.db.query("dashboardSessions").collect()))[0]!.servers.map(server => server.id), ["10"])
    assert.equal((await installation(t, "join", "12")).status, 200)
    assert.deepEqual(await listed(), ["10", "12"])
    assert.equal((await t.query(api.dashboardViews.general, args)).serverId, "12")
})
// Every dashboard query reads the session row, so a write to it reruns all of the session's live queries
test("Renewals leave the session row alone until access changes or read access has run down by a minute", async () => {
    let now = 1_800_000_000_000
    mock.method(Date, "now", () => now)
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" })
    const row = async () => (await t.run(ctx => ctx.db.query("dashboardSessions").collect()))[0]!
    const before = await row()
    now += 59_000
    assert.equal((await t.action(api.dashboard.refresh, { sessionToken: admitted.sessionToken })).expiresAt, before.expiresAt)
    await t.action(api.dashboard.save, { sessionToken: admitted.sessionToken, serverId: "10", section: "general", expectedRevision: 0, prefix: "?" })
    assert.deepEqual(await row(), before)
    now += 1_000
    const renewed = await t.action(api.dashboard.refresh, { sessionToken: admitted.sessionToken })
    assert.equal(renewed.expiresAt, now + 300_000)
    assert.deepEqual(await row(), { ...before, expiresAt: now + 300_000 })
    // Losing a server is written at once, without waiting for the next lease step
    permission = "0"
    now += 1_000
    assert.deepEqual((await t.action(api.dashboard.refresh, { sessionToken: admitted.sessionToken })).servers, [])
    assert.deepEqual((await row()).servers, [])
    await assert.rejects(t.query(api.dashboardViews.general, { sessionToken: admitted.sessionToken, serverId: "10" }))
})
test("Section views return only their own data, and template choices carry names and revisions without content", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }), args = { sessionToken: admitted.sessionToken, serverId: "10" }
    const content = { content: "Synthetic saved message" }
    await t.run(async ctx => {
        for (const [kind, name] of [["template", "welcome"], ["template", "zeta"], ["draft", "notes"]] as const)
            await ctx.db.insert("publishingDrafts", { serverId: "10", kind, name, revision: 2, content, canonicalContent: content, createdAt: 1, updatedAt: 1 })
    })
    assert.deepEqual(await t.query(api.dashboardViews.templates, { ...args, limit: 1 }), { serverId: "10", templates: [{ kind: "template", name: "welcome", revision: 2 }, { kind: "draft", name: "notes", revision: 2 }], more: true })
    assert.equal((await t.query(api.dashboardViews.templates, { ...args, limit: 50 })).more, false)
    await assert.rejects(t.query(api.dashboardViews.templates, { ...args, limit: 501 }))
    assert.deepEqual(Object.keys(await t.query(api.dashboardViews.messages, args)).sort(), ["jobs", "serverId"])
    assert.deepEqual(Object.keys(await t.query(api.dashboardViews.roles, args)).sort(), ["general", "roles", "serverId"])
    await assert.rejects(t.query(api.dashboardViews.overview, { ...args, serverId: "11" }))
})
test("The overview reports each feature as on, needing setup or off", async () => {
    const t = backend(), admitted = await t.action(api.dashboard.admit, { accessToken: "synthetic-provider-token" }), args = { sessionToken: admitted.sessionToken, serverId: "10" }
    const states = async () => Object.fromEntries((await t.query(api.dashboardViews.overview, args)).sections.map(section => [section.id, section.state]))
    const fresh = await states()
    assert.equal(Object.keys(fresh).length, 29)
    assert.deepEqual({ custom: fresh.custom, moderation: fresh.moderation, cleanup: fresh.cleanup, publishing: fresh.publishing, voice: fresh.voice, analytics: fresh.analytics, rolepicker: fresh.rolepicker, sticky: fresh.sticky, sidebar: fresh.sidebar, temproles: fresh.temproles, alerts: fresh.alerts, onboarding: fresh.onboarding, lfg: fresh.lfg, youtube: fresh.youtube },
        { custom: "setup", moderation: "on", cleanup: "off", publishing: "on", voice: "off", analytics: "on", rolepicker: "off", sticky: "off", sidebar: "off", temproles: "off", alerts: "off", onboarding: "off", lfg: "off", youtube: "off" })
    await t.run(async ctx => {
        await ctx.db.insert("responseDefinitions", { serverId: "10", kind: "custom", name: "hello", reply: { type: "text", text: "Synthetic reply" }, channelIds: [], roleIds: [], cooldownSeconds: 0, priority: 0, enabled: true, createdAt: 1, updatedAt: 1 })
        await ctx.db.insert("rolePickerSettings", { serverId: "10", enabled: true, menus: [] })
        await ctx.db.insert("stickyMessages", { serverId: "10", channelId: "50", content: "Synthetic sticky", intervalSeconds: 30, messageId: null, revision: 1, updatedAt: 1, updatedBy: "20" })
        await ctx.db.insert("sidebarLinks", { serverId: "10", channelId: "51", revision: 1, updatedAt: 1, updatedBy: "20" })
        await ctx.db.insert("alertSettings", { serverId: "10", invites: false, bots: true, webhooks: false, privileges: false, impersonation: false, expectedBotIds: [], expectedWebhookIds: [], updatedAt: 1, updatedBy: "20" })
        await ctx.db.insert("lfgSettings", { serverId: "10", enabled: true, channelId: "52", generatorChannelId: null, expiryMinutes: 60, maxSize: 10, memberGroups: 1, serverGroups: 20, nextGroupNo: 1 })
    })
    const configured = await states()
    assert.equal(configured.custom, "on")
    assert.equal(configured.rolepicker, "setup")
    assert.equal(configured.sticky, "on"); assert.equal(configured.sidebar, "on")
    // Looking for group needs both its channel and a voice generator
    assert.equal(configured.lfg, "setup")
    // An alert that is on reaches staff only once metadata logs route the security category
    assert.equal(configured.alerts, "setup")
    await t.run(ctx => ctx.db.insert("metadataLogSettings", { serverId: "10", enabled: true, revision: 2, routes: [{ category: "security", enabled: true, revision: 2, channelId: "52", ownerId: "20" }], messageChannelIds: [], excludedChannelIds: [],
        retained: 0, nextRecordNo: 1, categories: { membership: 0, resources: 0, messages: 0, audit: 0, settings: 0, operations: 0 }, queued: 0, reserved: 0, failed: 0, uncertain: 0, admissions: 0, admissionWindowStartedAt: 0, refused: 0, suppressed: 0, operationNextAt: 0, receipts: 0 }))
    assert.equal((await states()).alerts, "on")
})
