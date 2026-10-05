import assert from "node:assert/strict"
import test from "node:test"
import { Permissions } from "@neontechspace/fluxerly/effect"
import { createTestBot } from "@neontechspace/fluxerly/effect/testing"
import { Clock, Effect, Redacted } from "effect"
import type { DashboardRoleJob } from "@neonflux/backend/dashboard-contracts"
import type { PublishingDispatchRequest, PublishingGrant, RolesManageResult } from "@neonflux/backend/contracts"
import { createDashboardPanelPublisher, processDashboardRolesPass } from "../src/dashboard-roles.ts"
import { platform, token } from "./moderation-fixture.ts"
import { publishingBoundary } from "./publishing-fixture.ts"

test("Native dashboard publication preserves Manage Server authority and seeds only the bound panel message", async t => {
    for (const resume of [false, true]) await t.test(resume ? "Resume confirmed delivery" : "Fresh delivery", async st => {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
            const bot = yield* createTestBot({ token: "synthetic-dashboard-native-token" }), p = platform(bot, { actorOwner: false, actorPermissions: Permissions.ManageGuild | Permissions.ViewChannel | Permissions.SendMessages })
            const f = bot.fixtures, now = yield* Clock.currentTimeMillis, messageId = f.nextId()
            const job: DashboardRoleJob = { id: "synthetic_dashboard_job", actorId: f.ids.user, section: "reaction", expectedRevision: 0, state: "configured", createdAt: now, expiresAt: now + 120000,
                operation: { type: "panel-create", name: "colors", kind: "reaction", exclusive: false, mappings: [{ emoji: "✅", roleId: p.targetRole.id, prerequisiteRoleIds: [], exclusionRoleIds: [] }] }, publication: { channelId: f.ids.channel, content: { content: "Choose a color" } } }
            const grant: PublishingGrant = { attemptId: "synthetic_dashboard_attempt", postNo: 1, generation: 1, sourceId: `dashboard_${job.id}`, actorId: f.ids.user, botId: f.ids.bot,
                action: "send", channelId: f.ids.channel, source: { type: "dashboard-role", jobId: job.id, createdAt: now }, provenance: { type: "dashboard-role", jobId: job.id, panelName: "colors", panelRevision: 1 },
                content: { content: "Choose a color" }, canonicalContent: { content: "Choose a color" }, dispatchExpiresAt: now + 180000, nativeDeadlineMs: 5000 }
            const bound: RolesManageResult = { duplicate: false, type: "panel", panel: { name: "colors", kind: "reaction", revision: 1, enabled: true, exclusive: false,
                mappings: job.operation.type === "panel-create" ? job.operation.mappings : [], withdrawing: false,
                published: { revision: 1, publishedAt: now, postNo: 1, postGeneration: 1, channelId: f.ids.channel, messageId, botId: f.ids.bot, content: grant.content, mappings: job.operation.type === "panel-create" ? job.operation.mappings : [], exclusive: false } } }
            const routes: string[] = []
            st.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
                const path = new URL(String(input)).pathname, body = JSON.parse(String(init?.body))
                routes.push(path)
                assert.equal(body.actorId ?? f.ids.user, f.ids.user)
                if (path === "/dashboard-roles/reserve") {
                    assert.equal(body.managerAuthorized, true)
                    assert.equal(Object.hasOwn(body, "isAdministrator"), false)
                    return Response.json({ grant: resume ? null : grant, attempt: null })
                }
                if (path === "/dashboard-roles/complete") return Response.json({ job: { ...job, state: "applied" }, result: bound })
                throw new Error("Unexpected dashboard native fixture route")
            })
            p.replies.remove()
            const send = bot.rest.respond("POST /channels/:id/messages", { body: f.message({ id: messageId, channel_id: f.ids.channel, author: f.botUser(), content: grant.content.content }) })
            const reactions = bot.rest.respond("PUT /channels/:id/messages/:id/reactions/:emoji/@me", { status: 204 })
            const remote = publishingBoundary({ dispatch: input => {
                assert.equal((input as PublishingDispatchRequest).dashboardContext?.managerAuthorized, true)
                assert.equal(input.dashboardContext?.jobId, job.id)
                return Effect.succeed({ claimed: true, dispatchExpiresAt: grant.dispatchExpiresAt, nativeDeadlineMs: 5000 })
            } })
            const config = { token, serverId: f.ids.guild, backend: { siteUrl: "https://synthetic-dashboard.convex.site", secret: Redacted.make("synthetic-dashboard-service-secret") } }
            yield* createDashboardPanelPublisher(config, bot.client, remote.store)(job, null)
            assert.deepEqual(routes, ["/dashboard-roles/reserve", "/dashboard-roles/complete"])
            assert.equal(send.requests().length, resume ? 0 : 1)
            assert.equal(remote.calls.some(call => call.method === "query"), false)
            assert.equal(reactions.requests().length, 1)
            assert.equal(reactions.requests()[0]!.path.includes(messageId), true)
        })))
    })
})
